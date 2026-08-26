import { useReportCopy } from '~/hooks/useReportCopy';
import { BLOODLUST_HASTE, GCD_FLOOR_HASTE, gcdMsFor } from '~/lib/analysis/haste';
import { formatInteger, formatMillis, formatMillisDelta, formatPercentValue } from '~/lib/format';
import type { Analysis, ProtectionAudit, ResourceCurve } from '~/lib/types';

import ResourceChart from '~/components/charts/ResourceChart';
import { DataGrid, Note, Prose, Section, StatTile, StatTiles, type GridRow } from '~/components/primitives';

/**
 * What the pull's haste was, and the one number a Protection Paladin is aiming at.
 *
 * **The finding this heading exists for is a breakpoint rather than a preference.** Sanctity of
 * Battle's global reduction is *capped* — `sim/paladin/sanctity_of_battle.go` sets it to
 * `min(0.5s, 1.5s - 1.5s / haste)` — so the reduction reaches its half-second ceiling at exactly 1.5x
 * melee haste and the global sits on a flat second from there upwards. The sim lands on the same
 * figure a second way besides, which is worth knowing because it means the floor survives a change to
 * either mechanism: `sim/core/cast.go` takes `max(GCDMin, gcd)` with `GCDMin = time.Second * 1`. Fifty
 * percent haste is where a Paladin stops buying room between presses. It is not where they stop
 * buying presses — every cooldown `cooldownMsFor` scales keeps shortening past it, with no cap at
 * all, which is why the table of buttons at the foot of this page is the other half of the argument.
 *
 * **Nothing here is scored, and that is `score.ts`'s ruling rather than an omission.** That module
 * grades two figures and spends its header saying why everything else is described instead. Haste is
 * a fact about the character that walked in: a player under the breakpoint has not made a mistake,
 * they have a gear decision to make, and a colour claiming otherwise would be the invented threshold
 * this spec was ported to stop printing. So every tile below is uncoloured — including the one that
 * would be easiest to tint, the distance to the breakpoint, where green-for-past would be wrong in
 * both directions at once: past it the globals stop improving, and short of it the cooldowns are
 * still shortening.
 *
 * **Two readings of one number, which is the only way a wrong divisor gets caught.** The whole page
 * divides by this pull's haste — `cooldownAt` stamps every drift figure with it, `lostCasts` counts
 * against it — so a model that is quietly wrong would make every one of those numbers wrong in the
 * same direction, with nothing on the page disagreeing. Two things disagree with it here. The global
 * is modelled from the rating and *measured* off the median gap between presses. And each haste-scaled
 * button's shortest gap is a measurement of its own cooldown, which `checkHaste` compares with what
 * the model says that gap's cooldown was. See `lib/analysis/haste` for why that second check can only
 * ever accuse the model of being too slow.
 *
 * **The breakpoint is named in words and not drawn on the chart, and the chart is the reason.**
 * `ResourceTrack` shades *time* windows — a `ShadeWindow` is a start and an end on the fight's own
 * timeline — so there is no existing way to lay a horizontal line across one at a value, and a haste
 * threshold is exactly that. Writing a chart primitive for one section's benefit is the thing this
 * tree declines to do; the figure is in a tile and in the sentence under the chart instead.
 */
export default function Haste({ analysis }: { analysis: Analysis }) {
	const { haste, measuredGcd } = analysis as Analysis & ProtectionAudit;
	const { t } = useReportCopy(analysis);

	// Signed, so one subtraction decides both the word and the number: positive is haste past the
	// breakpoint, negative is haste still buying room. Taken on the multiplier rather than on the
	// global, because the global is the same 1000ms either side of a near miss and cannot say which
	// side the pull is on.
	const past = haste.base - GCD_FLOOR_HASTE;
	const lustWindows = analysis.timeline?.hasteWindows ?? [];

	/**
	 * The pull's haste as a bar, in whole percent.
	 *
	 * Percent rather than the multiplier because `ResourceTrack` draws its step labels as the raw
	 * value: a bar labelled `1.5518752941176471` is not a bar anybody can read, and rounding the
	 * multiplier to two places would label it `1.55` — which is the same figure the tiles print as
	 * `55.19%` in a spelling nothing else on the page uses.
	 *
	 * Steps and not a line, for the reason chi is: haste here takes exactly two values and holds each
	 * until something changes it. A diagonal between them would draw a haste the player had for no part
	 * of the pull.
	 */
	const pct = (multiplier: number): number => Math.round((multiplier - 1) * 100);
	const curve: ResourceCurve = {
		max: pct(haste.underLust ?? haste.base),
		points: [
			[0, pct(haste.base)],
			...lustWindows.flatMap((window): Array<[number, number]> => [
				[window.start, pct(haste.underLust ?? haste.base)],
				[window.end, pct(haste.base)],
			]),
			[analysis.durationMs, pct(haste.base)],
		],
	};

	/**
	 * The three terms, each shown with what it had reached by then rather than with what it added.
	 *
	 * Cumulative because the breakpoint is a threshold on the total, and a column of multipliers
	 * cannot say which term crossed it. On the reference character it is the seal that does: 20,314
	 * rating alone is 47.8% and a 1,015ms global, and the five percent over it is what reaches the
	 * floor. A reader who sees only `×1.05` beside `47.8%` has to do that arithmetic themselves.
	 */
	const terms: GridRow[] = [
		{
			key: 'gear',
			cells: {
				term: <b className="font-semibold text-ink">{t('haste.terms.gear')}</b>,
				adds: <span className="text-ink-2">{haste.rating === null ? '—' : formatInteger(haste.rating)}</span>,
				haste: <span className="text-ink-2">{formatPercentValue((haste.fromRating - 1) * 100)}</span>,
				gcd: <b className="font-semibold text-ink-2">{formatMillis(gcdMsFor(haste.fromRating))}</b>,
			},
		},
		{
			key: 'seal',
			cells: {
				term: <b className="font-semibold text-ink">{t('haste.terms.seal')}</b>,
				adds: <span className="text-ink-2">+{formatPercentValue((haste.classMultiplier - 1) * 100)}</span>,
				haste: <span className="text-ink-2">{formatPercentValue((haste.base - 1) * 100)}</span>,
				gcd: <b className="font-semibold text-ink-2">{formatMillis(haste.gcdMs)}</b>,
			},
		},
	];
	// The third row only where the cooldown actually landed. A pull without one is not a pull that
	// reached 101% haste and never used it, and a greyed row saying so would read as a button held.
	if (haste.underLust !== null && haste.gcdMsUnderLust !== null) {
		terms.push({
			key: 'lust',
			cells: {
				term: <b className="font-semibold text-ink">{t('haste.terms.lust')}</b>,
				adds: <span className="text-ink-2">+{formatPercentValue((BLOODLUST_HASTE - 1) * 100)}</span>,
				haste: <span className="text-ink-2">{formatPercentValue((haste.underLust - 1) * 100)}</span>,
				gcd: <b className="font-semibold text-ink-2">{formatMillis(haste.gcdMsUnderLust)}</b>,
			},
		});
	}

	const check = haste.check;
	/**
	 * One row per button the pull pressed often enough for its floor to be a floor.
	 *
	 * Banded where the gap came back sooner than the model allows, which is the only direction this
	 * table can find anything in: a gap *longer* than the cooldown is a button that was not pressed on
	 * cooldown, which every other part of this report is already busy measuring.
	 */
	const checkRows: GridRow[] = (check?.rows ?? []).map((row) => ({
		key: row.key,
		band: row.deltaMs < -(check?.toleranceMs ?? 0) ? ('warn' as const) : undefined,
		cells: {
			ability: <b className="font-semibold text-ink">{row.name}</b>,
			samples: <span className="text-ink-2">{formatInteger(row.samples)}</span>,
			observed: (
				<span className="text-ink-2">
					{formatMillis(row.observedMs)}
					{row.inBloodlust ? <em className="ml-1.5 text-sm not-italic text-muted">{t('haste.check.lust')}</em> : null}
				</span>
			),
			modelled: <span className="text-ink-2">{formatMillis(row.predictedMs)}</span>,
			margin: <b className="font-semibold text-ink-2">{formatMillisDelta(row.deltaMs)}</b>,
		},
	}));

	return (
		<Section id="haste" title={t('haste.title')}>
			<Prose>{t('haste.intent')}</Prose>

			<div className="mt-4.5">
				<StatTiles>
					{/* The rating exactly as `combatantinfo` reported it, so a reader can check it against their
					    own character sheet without converting anything. A pull that reported none says so in
					    the caption rather than printing the number the model stood in for it. */}
					<StatTile
						value={haste.rating === null ? '—' : formatInteger(haste.rating)}
						label={t('haste.kpi.rating')}
						caption={haste.assumed ? t('haste.kpi.assumed') : undefined}
					/>
					<StatTile value={formatPercentValue((haste.base - 1) * 100)} label={t('haste.kpi.haste')} />
					<StatTile
						value={formatPercentValue(Math.abs(past) * 100)}
						label={past >= 0 ? t('haste.kpi.past') : t('haste.kpi.short')}
					/>
					<StatTile value={formatMillis(haste.gcdMs)} label={t('haste.kpi.gcd')} />
				</StatTiles>
			</div>

			<div className="mt-5 flex flex-col gap-3.5">
				<Prose>
					{t('haste.summary', {
						context: past >= 0 ? undefined : 'short',
						breakpoint: (GCD_FLOOR_HASTE - 1) * 100,
						distance: Math.abs(past) * 100,
						floor: gcdMsFor(GCD_FLOOR_HASTE),
					})}
				</Prose>
			</div>

			{/* Only where a haste cooldown actually landed. With one value for the whole pull the chart is
			    a flat line, which repeats the tile above it and shows nothing the tile cannot. */}
			{haste.underLust === null ? null : (
				<div className="mt-5">
					<ResourceChart
						curve={curve}
						durationMs={analysis.durationMs}
						mode="steps"
						tone="kick"
						legend={t('haste.key.bar')}
						// The same tone the Windwalker's Energizing Brew track shades a haste cooldown in, so one
						// mechanic keeps one colour across two specs' charts.
						bands={[
							{
								tone: 'brew',
								windows: lustWindows.map((w) => ({ start: w.start, end: w.end })),
								legend: t('haste.key.lust'),
							},
						]}
						label={t('haste.chartLabel', {
							base: (haste.base - 1) * 100,
							lust: (haste.underLust - 1) * 100,
							lustMs: haste.lustMs,
						})}
					/>
				</div>
			)}

			<div className="mt-5">
				<DataGrid
					caption={t('haste.terms.caption')}
					columns={[
						{ key: 'term', label: t('haste.terms.columns.term'), width: '180px' },
						{ key: 'adds', label: t('haste.terms.columns.adds'), width: '110px' },
						{ key: 'haste', label: t('haste.terms.columns.haste'), align: 'right', width: '110px' },
						{ key: 'gcd', label: t('haste.terms.columns.gcd'), align: 'right', width: '110px' },
					]}
					rows={terms}
				/>
			</div>

			{/* The global, twice, from the two ends. `measuredGcd` is the raw median rather than the
			    `effectiveGcd` the rest of the report divides by, because that one is clamped to this spec's
			    own declared global at both ends and so agrees with the model whatever the presses did. */}
			<div className="mt-5">
				<Note>
					{measuredGcd.medianMs === null
						? t('haste.gcdNote_none', { modelled: haste.gcdMs })
						: t('haste.gcdNote', {
								modelled: haste.gcdMs,
								observed: measuredGcd.medianMs,
								samples: measuredGcd.samples,
							})}
				</Note>
			</div>

			<div className="mt-5 flex flex-col gap-3.5">
				<DataGrid
					caption={t('haste.check.caption')}
					columns={[
						{ key: 'ability', label: t('haste.check.columns.ability'), width: '190px' },
						{ key: 'samples', label: t('haste.check.columns.samples'), align: 'right', width: '80px' },
						{ key: 'observed', label: t('haste.check.columns.observed'), align: 'right', card: 'wide' },
						{ key: 'modelled', label: t('haste.check.columns.modelled'), align: 'right', width: '110px' },
						{ key: 'margin', label: t('haste.check.columns.margin'), align: 'right', width: '110px' },
					]}
					rows={checkRows}
					empty={t('haste.check.none')}
				/>
				<Prose>
					{t('haste.reading', {
						context: check?.verdict ?? 'unmeasured',
						worst: check?.rows[0]?.name ?? '',
						margin: Math.abs(check?.worstMs ?? 0),
						tolerance: check?.toleranceMs ?? 0,
					})}
				</Prose>
				{/* The two buttons that are haste-scaled and are not in the table. Stated rather than left
				    to be noticed, because a reader who knows the spell table will read their absence as a
				    bug — and the reasons are exactly what makes the rest of the table mean anything. */}
				<Note>{t('haste.avengersShieldNote')}</Note>
			</div>
		</Section>
	);
}
