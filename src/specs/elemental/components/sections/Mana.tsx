import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatClock, formatInteger, formatPercentValue, formatSeconds } from '~/lib/format';
import { resourceColorOf } from '~/lib/game/resources';
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
	const { t, verdict, toneOf } = useReportCopy(analysis);
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
				{/* `mana.clean` rather than a `verdict_none` variant, because "cannot say" and "there was nothing
				    to say" are the same state here and only one of them is true: with readings in hand, an empty
				    graded stretch means the pool never went under either number while the button for it was up.
				    Saying that plainly beats a hedge about missing data the log did not have. */}
				<Prose>
					{mana.starved.gradedMs === 0 && mana.strained.gradedMs === 0
						? t('mana.clean')
						: verdict('mana', {
								starved: mana.starvedPct,
								strained: mana.strainedPct,
								starvedMs: mana.starved.ms,
								rage: mana.strained.stretches,
							})}
				</Prose>
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
