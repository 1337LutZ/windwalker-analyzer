import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatClock, formatInteger, formatPercentValue, formatSeconds } from '~/lib/format';
import { resourceColorOf } from '~/lib/game/resources';
import type { Grade } from '~/lib/score';
import type { Analysis, ElementalAuditResult, ManaAudit, ManaLowStretch, PoolResourceAudit } from '~/lib/types';

import ResourceChart, { type TrackBand } from '~/components/charts/ResourceChart';
import { EXEMPT } from '~/components/charts/tones';
import { DataGrid, Note, Prose, Section, SpellIcon, StatTile, StatTiles, type GridRow } from '~/components/primitives';
import LogLink from '~/components/sections/LogLink';

/**
 * Mana: the pool every cast comes out of, and the two buttons that refill it.
 *
 * The spec's own section rather than the generic `Resource` one it replaced. The bar was already
 * drawn there — a pool whose ceiling is no fault and whose floor is — but nothing graded it, and the
 * user asked for the two faults by name: *"Mana section should flag if a user was low mana and did
 * not use Thunderstorm / Mana cooldowns."*
 *
 * **Both faults are omissions, and the whole shape of this section follows from that.** The player is
 * charged for *not* pressing something, so before a second of it can be charged the pull has to be
 * shown to have offered the press — which is why the stretches with both buttons still coming back are
 * drawn in the exempt grey and named in the key rather than left out silently, and why a stretch too
 * short for the priority order to have looked at the pool is not counted at all. `ManaAudit` carries
 * that reasoning; this file only draws it.
 *
 * The bar is the same `resources.mana` object the cast log's row and the timeline are drawn from, and
 * every band below is an array the audit measured its own figures over — so the line a reader is
 * looking at and the numbers beside it cannot disagree.
 */
export default function Mana({ analysis }: { analysis: Analysis }) {
	const el = analysis as Analysis & ElementalAuditResult;
	const { t, gradeOf, verdict, toneOf } = useReportCopy(analysis);
	const mana = el.mana as ManaAudit | undefined;
	// The bar itself, for the curve and for the sampling resolution the note quotes. A report captured
	// before the engine sampled resources carries no bar and one captured mid-refactor carries the curve
	// without its `kind` — either way there is nothing to draw, and the heading still has to render
	// because `SectionNav` lists every section unconditionally.
	const barAudit = analysis.resources?.['mana'];
	const bar: PoolResourceAudit | undefined =
		barAudit !== undefined && 'kind' in barAudit && barAudit.kind === 'pool' ? barAudit : undefined;

	/**
	 * Every charged stretch, both faults in one table, in time order and labelled with the button.
	 *
	 * One table rather than two: the reader's question is "when was I short and what should I have
	 * pressed", and splitting it by button asks them to merge two clocks in their head. The `press`
	 * column carries which one.
	 */
	const rows = useMemo<GridRow[]>(() => {
		if (mana === undefined) return [];
		const tagged: Array<{ w: ManaLowStretch; press: string }> = [
			...mana.starved.windows.map((w) => ({ w, press: t('mana.press.thunderstorm') })),
			...mana.strained.windows.map((w) => ({ w, press: t('mana.press.rage') })),
		];
		return tagged
			.sort((a, b) => a.w.start - b.w.start)
			.map(({ w, press }, i) => ({
				key: `${w.start}-${i}`,
				band: 'warn' as const,
				cells: {
					at: <LogLink href={w.link}>{formatClock(w.start)}</LogLink>,
					held: <b className="font-semibold text-ink-2">{formatSeconds(w.end - w.start)}</b>,
					low: formatPercentValue(w.pct),
					press,
				},
			}));
	}, [mana, t]);

	if (mana === undefined || bar === undefined || mana.samples === 0) {
		return (
			<Section id="mana" title={t('mana.title')}>
				<Prose>{t('mana.intent', { starved: mana?.starvedPct ?? 15, strained: mana?.strainedPct ?? 70 })}</Prose>
				<div className="mt-5">
					<Note>{t('mana.none')}</Note>
				</div>
			</Section>
		);
	}

	const barColor = resourceColorOf(bar.type);
	const shade = (windows: readonly ManaLowStretch[]) => windows.map(({ start, end }) => ({ start, end }));
	// Widest claim first, so the red that is being looked for paints on top of the ground it is measured
	// against — the ordering rule `BAND` states and the Lightning Shield chart already follows. The
	// exempt grey is the widest of the three: it is the part of the starved time nothing charges.
	const bands: TrackBand[] = [
		...(mana.bothOnCooldownWindows.length === 0
			? []
			: ([
					{
						tone: EXEMPT,
						// The audit's own array, not "the starved stretches minus the charged ones" worked out here.
						// A chart that re-derives the stretch its figure dropped is free to disagree with it, which
						// is the mistake `exemptTrack.test.ts` was written after three charts each made differently.
						windows: mana.bothOnCooldownWindows,
						legend: t('mana.key.exempt', { starved: mana.starvedPct }),
					},
				] satisfies TrackBand[])),
		...(mana.strained.windows.length === 0
			? []
			: ([
					{
						tone: 'brew',
						windows: shade(mana.strained.windows),
						legend: t('mana.key.strained', { strained: mana.strainedPct }),
					},
				] satisfies TrackBand[])),
		...(mana.starved.windows.length === 0
			? []
			: ([
					{
						tone: 'miss',
						windows: shade(mana.starved.windows),
						legend: t('mana.key.starved', { starved: mana.starvedPct }),
					},
				] satisfies TrackBand[])),
	];

	/**
	 * Which of the two halves the sentence below is allowed to speak for.
	 *
	 * Both primaries answer independently — `thunderstormMissed` is null unless `mana.starved.gradedMs > 0`
	 * and `shamanisticRageMissed` unless `mana.strained.gradedMs > 0` — and `section()` takes the worst of
	 * the metrics it *could* decide. So a pull that answered one half and not the other is graded on the
	 * survivor alone, and `verdict_good` asserted both: "You never sat under 15% with Thunderstorm up, and
	 * never under 70% with Shamanistic Rage up" printed over a Thunderstorm clock nothing had measured.
	 * That is the defect `lightningShield.verdict_good_noOvercap` and `searingTotem`'s `_noUptime` exist
	 * for, in the section that had no such variant.
	 *
	 * **All three grades are narrowed, and `good` used to be the only one.** The argument for stopping at
	 * `good` was that `ms` and `stretches` are both cut out of an empty `gradedMs`, so `ok` and `bad`
	 * print a true zero for the unread half rather than a figure that contradicts the tile beside it —
	 * thin there, not false. But a zero with nothing beside it is not read as an absence of data: *"You
	 * spent 0s under 15% with Thunderstorm up, and let Shamanistic Rage come back to a pool already under
	 * 70% once without pressing it"* tells a reader their Thunderstorm was clean, in the same sentence
	 * that faults their Rage. `addsThenBoss` is the pull that made that visible — the first committed one
	 * to reach an `ok` here, and its 15% line is never approached — so the `_noRage` / `_noThunderstorm`
	 * shape now covers every grade that has a sentence to narrow.
	 */
	const starvedRead = mana.starved.gradedMs > 0;
	const strainedRead = mana.strained.gradedMs > 0;
	/** Which half went unanswered, or null where the pull answered both of them or neither. */
	const unread: 'noRage' | 'noThunderstorm' | null =
		starvedRead === strainedRead ? null : starvedRead ? 'noRage' : 'noThunderstorm';
	/**
	 * Time under either line whatever was or was not in hand — the number that tells the three pulls an
	 * empty pair of clocks covers apart from each other.
	 *
	 * `gradedMs` is zero on all three: the pool never went near a line, it went low only while the button
	 * for it was still coming back, or it went low only inside the opening where no press can be placed
	 * either side of it. Only the first is clean, and `mana.clean` was printed over all three. The 70% line
	 * contains the 15% one, so the wider `lowMs` is the time spent under either of them and a maximum is
	 * the right join rather than a sum.
	 */
	const lowMs = Math.max(mana.starved.lowMs, mana.strained.lowMs);
	/**
	 * `count` is the Rage's own figure again, and it is here so a pull that passed over one press does not
	 * read *"1 times"*.
	 *
	 * i18next picks a plural off `count` and off nothing else, and `verdict()` spreads whatever it is
	 * handed straight into the interpolation payload — so this needs no change to the helper at all. It
	 * rides on the shared payload rather than on the arms that read it, because the payload is what both
	 * routes out of this component give the translator; an arm that names no count resolves its plural
	 * suffix, finds nothing stored under it, and falls back to the arm without one. That fallback is
	 * i18next's own resolution order rather than a coincidence, and it is pinned rather than assumed —
	 * see `__tests__/countAgreement.test.ts`.
	 *
	 * **Which arms need a singular is measured, and it is two of the four that print the figure.** Narrowed
	 * to the Rage's half alone, the section's letter *is* the Rage's metric, whose thresholds make `ok`
	 * exactly one press passed over and `bad` two or more — so the narrowed `ok` arm says "once" outright
	 * and the narrowed `bad` arm can never be handed a one. The un-narrowed pair is graded against the
	 * Thunderstorm too, so either of them can arrive with any count the Rage produces.
	 */
	const graded = {
		starved: mana.starvedPct,
		strained: mana.strainedPct,
		starvedMs: mana.starved.ms,
		rage: mana.strained.stretches,
		count: mana.strained.stretches,
		low: lowMs,
	};
	/**
	 * The six narrowed arms, as whole keys rather than a `context` — deliberately.
	 *
	 * `keys.test.ts` reads literal `t('…')` keys out of the source and joins them to `verdict()`'s own
	 * template, so the arms `verdict()` can resolve are hunted from both halves. These are chosen by a
	 * measurement *and* by the grade, and the context mechanism only carries one of those, so naming them
	 * in the key keeps that guard pointed at strings that exist.
	 *
	 * Thunks rather than a table of key names, for the same reason: the key has to sit inside the `t(` for
	 * the guard to see it. Assembling the key at the call site from the grade and the unread half would
	 * read the same and be invisible to it in both directions.
	 *
	 * That sentence used to spell the assembled key out in backticks, and **the guard counted it.** Its
	 * family scanner reads template literals out of the source text and does not care that this one is in
	 * a comment, so documenting the shape *created* the shape: a `mana.verdict_*_*` family with two holes
	 * and no key source, which `SHAPE_ONLY` is asserted to be empty of. Naming a key pattern in prose here
	 * is a code change — so it is named in words instead.
	 */
	const narrowed: Record<Grade, Record<'noRage' | 'noThunderstorm', () => string>> = {
		good: {
			noRage: () => t('mana.verdict_good_noRage', graded),
			noThunderstorm: () => t('mana.verdict_good_noThunderstorm', graded),
		},
		ok: {
			noRage: () => t('mana.verdict_ok_noRage', graded),
			noThunderstorm: () => t('mana.verdict_ok_noThunderstorm', graded),
		},
		bad: {
			noRage: () => t('mana.verdict_bad_noRage', graded),
			noThunderstorm: () => t('mana.verdict_bad_noThunderstorm', graded),
		},
	};
	const grade = gradeOf('mana');
	/**
	 * The sentence.
	 *
	 * **Both clocks empty is two different pulls and used to be one sentence.** With no time under either
	 * line the pull genuinely never asked for a press, which is `mana.clean`. With time under a line that
	 * none of the three availability tests could charge — the opening, or the button still coming back —
	 * the pull asked and this log cannot answer, and `mana.clean`'s *"Mana was not what limited this
	 * pull"* was a claim about a bar that had sat at 10%. That second pull is what `verdict()` is asked
	 * for here: both metrics are unmeasurable, so `gradeOf` answers `none` and the arm is
	 * `mana.verdict_none`. It had no copy behind it until this branch existed to need it, and i18next
	 * renders a missing context as the bare `mana.verdict` — the key itself, where the sentence belongs.
	 *
	 * A narrowed arm cannot be about either of them: it needs one half answered and the other not, and
	 * both of those pulls answered neither. Which is also why `none` and `exempt` are not in the table
	 * above — there is no grade there to pick an arm by.
	 */
	const sentence =
		!starvedRead && !strainedRead
			? lowMs === 0
				? t('mana.clean')
				: verdict('mana', graded)
			: unread !== null && grade !== 'none' && grade !== 'exempt'
				? narrowed[grade][unread]()
				: verdict('mana', graded);

	return (
		<Section id="mana" title={t('mana.title')}>
			<Prose>
				<span className="inline-flex items-center gap-2 align-middle">
					<SpellIcon id={51_490} size="sm" />
				</span>{' '}
				{t('mana.intent', { starved: mana.starvedPct, strained: mana.strainedPct })}
			</Prose>

			<div className="mt-4.5">
				<StatTiles>
					{/* The lowest the pool got, uncoloured: it is context for the two faults beside it rather than
					    a fault of its own. A pull can bottom out at 4% and be played perfectly if the buttons were
					    both away, which is exactly what `bothDown` below says when it says it. */}
					<StatTile value={mana.minPct === null ? '—' : formatPercentValue(mana.minPct)} label={t('mana.kpi.lowest')} />
					{/* Both tiles take their colour from the metric they are showing rather than from the section's
					    own verdict, so an unmeasurable one is grey instead of being given a grade it did not earn. */}
					<StatTile
						value={formatSeconds(mana.starved.ms)}
						label={t('mana.kpi.starved')}
						grade={toneOf('thunderstormMissed')}
					/>
					<StatTile
						value={`${mana.strained.stretches}`}
						label={t('mana.kpi.rage')}
						grade={toneOf('shamanisticRageMissed')}
					/>
				</StatTiles>
			</div>

			<div className="mt-4.5">
				<ResourceChart
					curve={bar.curve}
					durationMs={analysis.durationMs}
					tone="kick"
					color={barColor}
					smooth
					legend={t('mana.key.bar')}
					bands={bands}
					label={t('mana.chartLabel', {
						max: mana.max,
						min: mana.minPct ?? 100,
						starvedMs: mana.starved.ms,
						starved: mana.starvedPct,
					})}
				/>
			</div>

			<div className="mt-5">
				<DataGrid
					caption={t('mana.caption')}
					minWidth="460px"
					columns={[
						{ key: 'at', label: t('mana.columns.at'), width: '96px' },
						{ key: 'held', label: t('mana.columns.held'), align: 'right', width: '90px' },
						{ key: 'low', label: t('mana.columns.low'), align: 'right', width: '90px' },
						{ key: 'press', label: t('mana.columns.press'), align: 'right' },
					]}
					rows={rows}
					empty={t('mana.noRows')}
				/>
			</div>

			<div className="mt-5 flex flex-col gap-3.5">
				{/* Three sentences can land here and the difference between them is what this section is for:
				    the pull that was judged, the pull that never went under either number with the button for it
				    up, and the pull that went under one and gave this log nothing it could charge. Only the
				    middle one is clean, and saying so plainly beats a hedge; only the last one is a hedge, and
				    it beats telling a bar that sat at 10% that mana was not what limited it. */}
				<Prose>{sentence}</Prose>
				{/* Each of these appears only where its own number is non-zero, which is the whole discipline of
				    this section. A pull whose starvation did not coincide with shield downtime must not be told
				    that it did, and a pull nothing was withheld from must not be shown an excuse it did not use. */}
				{mana.bothOnCooldownMs > 0 ? (
					<Prose>{t('mana.bothDown', { ms: mana.bothOnCooldownMs, starved: mana.starvedPct })}</Prose>
				) : null}
				{mana.shieldDownMs > 0 ? <Prose>{t('mana.shield', { ms: mana.shieldDownMs })}</Prose> : null}
			</div>

			<div className="mt-4 flex flex-col gap-3">
				{mana.starved.unprovenMs + mana.strained.unprovenMs > 0 ? (
					<Note>{t('mana.opening', { ms: mana.starved.unprovenMs + mana.strained.unprovenMs })}</Note>
				) : null}
				{mana.earlyThunderstorms > 0 ? (
					<Note>{t('mana.early', { count: mana.earlyThunderstorms, starved: mana.starvedPct })}</Note>
				) : null}
				<Note>{t('mana.floor', { floor: formatSeconds(mana.floorMs) })}</Note>
				<Note>
					{t('mana.resolution', {
						samples: formatInteger(mana.samples),
						median: bar.medianGapMs,
						p99: bar.p99GapMs,
					})}
				</Note>
			</div>
		</Section>
	);
}
