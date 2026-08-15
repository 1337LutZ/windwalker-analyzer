import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatClock, formatInteger, formatSeconds } from '~/lib/format';
import { wasteTone } from '~/lib/score/waste';
import type { Analysis } from '~/lib/types';

import ResourceChart from '../charts/ResourceChart';
import { cappedOf } from '../charts/capped';
import { DataGrid, Note, Prose, Section, StatTile, StatTiles, type GridRow } from '../primitives';
import LogLink from './LogLink';

/**
 * The energy bar over the pull, and the one number on this page that had to be split in two to be
 * fair.
 *
 * Raw time at the cap is not a fault. Energy fills while a boss is untargetable exactly as it does
 * while you are hitting one, and on the reference pulls most of the capping sits in intermissions
 * and in the seconds before the first hit — stretches where there is nothing to spend energy on and
 * therefore no decision to grade. So the headline figure is the engaged half, the downtime half is
 * reported beside it as context, and the section never adds them into a single accusation.
 *
 * There is no verdict here and `lib/score` grades no `energy` section, deliberately. A threshold
 * would have to say how many seconds at the cap are acceptable, and neither the sim nor the priority
 * list contains such a number — the APL spends energy when it has something worth spending it on and
 * pools it when it does not. What the section can do honestly is state the time, the split, and the
 * resolution the measurement was taken at.
 */
export default function Energy({ analysis }: { analysis: Analysis }) {
	const { energy } = analysis;
	const { t } = useReportCopy(analysis);

	const rows = useMemo<GridRow[]>(
		() =>
			(energy?.worst ?? []).map((cap, i) => ({
				key: `${cap.at}-${i}`,
				// Only the engaged stretches are banded. A cap through an intermission is a fact about the
				// fight, and colouring it the same as one taken with a boss in front of you would undo the
				// split the rest of the section exists to make.
				band: cap.engaged ? ('warn' as const) : undefined,
				cells: {
					at: <LogLink href={cap.link}>{formatClock(cap.at)}</LogLink>,
					held: <b className="font-semibold text-ink-2">{formatSeconds(cap.ms)}</b>,
					where: (
						<span className={cap.engaged ? 'text-brew' : 'text-ink-2'}>
							{t(cap.engaged ? 'energy.where.engaged' : 'energy.where.downtime')}
						</span>
					),
				},
			})),
		[energy, t],
	);

	// A fixture captured before the events query asked for resources has no `energy` key at all —
	// `undefined`, not an empty audit — and the heading still has to render, because `SectionNav`
	// lists every section unconditionally and a link with no heading behind it is a jump to nowhere.
	if (!energy) {
		return (
			<Section id="energy" title={t('energy.title')}>
				<Note>{t('empty.section')}</Note>
			</Section>
		);
	}

	// No samples is not "never capped": it is a log that carried no resource snapshots, and saying
	// "the bar never reached the top" about one would be a claim made out of missing data.
	if (energy.samples === 0) {
		return (
			<Section id="energy" title={t('energy.title')}>
				<Prose>{t('energy.intent')}</Prose>
				<div className="mt-5">
					<Note>{t('energy.none')}</Note>
				</div>
			</Section>
		);
	}

	const capped = energy.total.cappedMs > 0;
	const wasted = energy.engaged.wasted;
	const curve = analysis.resources?.energy;
	/**
	 * The clock both tiles below are fractions of: the time the player had something to hit.
	 *
	 * The same one the debuff section and Chi Brew's ceiling use, and the same one `energy.engaged` is
	 * now split on — so the numerator and the denominator of each tile come from one reading of the
	 * pull. It is published on `debuff` because that is the section that owns it; `durationMs` is the
	 * fixture fallback, which is what those pulls were measured on.
	 */
	const measuredMs = analysis.debuff.contactMs || analysis.durationMs;

	return (
		<Section id="energy" title={t('energy.title')}>
			<Prose>{t('energy.intent')}</Prose>

			{/* The bar itself, drawn by the same component and at the same scale as the timeline's energy
			    row, so the two are recognisably one reading rather than two charts of the same pull. The
			    numbers below are all derived from this line, and a reader who cannot see it has to take
			    them on trust — a run at the cap is a shape long before it is a figure.

			    Guarded separately from `energy` above: the audit and the curve are independent fields, and
			    a report captured before the events query asked for resources can carry the audit's empty
			    state without carrying a curve to draw. */}
			{curve === undefined || curve.points.length === 0 ? null : (
				<div className="mt-4.5">
					<ResourceChart
						curve={curve}
						durationMs={analysis.durationMs}
						tone="kick"
						smooth
						legend={t('energy.key.bar')}
						// The shaded stretches are regeneration that arrived on a full bar and went nowhere, so
						// the key says what was lost rather than what the bar was doing. It reads close enough
						// to the table's "full for" column to have borrowed it, and that is precisely why it
						// has its own string: one describes a colour, the other heads a column of durations.
						bands={[{ tone: 'miss', windows: cappedOf(curve), legend: t('energy.key.lost') }]}
						label={t('energy.chartLabel', {
							max: curve.max,
							capped: energy.total.cappedMs,
							duration: analysis.durationMs,
						})}
					/>
				</div>
			)}

			{capped ? (
				<>
					<div className="mt-4.5">
						<StatTiles>
							{/* Waste first, as in the chi section. Its denominator is the energy generated at the
							    measured refill rate over the time there was something to spend it on — so a log too
							    busy to measure a rate on gets the number with no colour rather than a colour built
							    on a guess.

							    Over contact time and not the pull's length, which is what this shipped with: the
							    pull's length credits the player with regen through every second they could not act,
							    and on a Galakras pull that is 117 seconds of energy nobody could ever have spent
							    padding the denominator of their own waste. */}
							{wasted === null ? null : (
								<StatTile
									value={formatInteger(wasted)}
									label={t('energy.kpi.wasted')}
									grade={wasteTone(wasted, (energy.regenPerSec ?? 0) * (measuredMs / 1000))}
								/>
							)}
							{/* Seconds, and only seconds. This tile used to sit beside a second one showing the
						    same quantity as a share of engaged time — two tiles, one fact, and the reader
						    left to work out that they were the same number twice. The share moved into the
						    sentence below, which has room to say what it is a share *of*; a bare percentage
						    in a tile does not.

						    Coloured as that share all the same, because a bare duration is the one thing a
						    reader cannot calibrate: eleven seconds is nothing on a nine-minute pull and most
						    of a short one. Same reading aid and same caveat as everywhere else on this page —
						    `lib/score` still grades no energy metric, because neither the sim nor the priority
						    list says how many seconds at the cap are acceptable, and this number never reaches
						    the scorecard or the headline. */}
							<StatTile
								value={formatSeconds(energy.engaged.cappedMs)}
								label={t('energy.kpi.engaged')}
								grade={wasteTone(energy.engaged.cappedMs, measuredMs)}
							/>
						</StatTiles>
					</div>

					<div className="mt-5 flex flex-col gap-3.5">
						<Prose>
							{energy.regenPerSec === null
								? t('energy.summaryNoRate', {
										capped: energy.total.cappedMs,
										duration: analysis.durationMs,
										pct: energy.total.pct,
									})
								: t('energy.summary', {
										capped: energy.total.cappedMs,
										duration: analysis.durationMs,
										pct: energy.total.pct,
										regen: energy.regenPerSec,
									})}
						</Prose>
						<Prose>
							{t('energy.split', {
								context: energy.engaged.cappedMs > 0 ? 'some' : 'none',
								engaged: energy.engaged.cappedMs,
								engagedPct: energy.engaged.pct,
								downtime: energy.downtime.cappedMs,
							})}{' '}
							{wasted !== null && wasted > 0 ? t('energy.wasted', { wasted }) : null}
						</Prose>
					</div>

					<div className="mt-5">
						<DataGrid
							caption={t('energy.caption')}
							minWidth="420px"
							columns={[
								{ key: 'at', label: t('energy.columns.at'), width: '96px' },
								{ key: 'held', label: t('energy.columns.held'), align: 'right', width: '110px' },
								{ key: 'where', label: t('energy.columns.where'), align: 'right' },
							]}
							rows={rows}
							empty={t('energy.noRows')}
						/>
					</div>
				</>
			) : (
				<div className="mt-5">
					<Prose>{t('energy.clean')}</Prose>
				</div>
			)}

			{/* Always shown, capped or not. The resolution is a property of how the bar was read, so it
			    qualifies "you never capped" exactly as much as it qualifies a number of seconds. */}
			<div className="mt-4">
				<Note>
					{t('energy.resolution', {
						samples: formatInteger(energy.samples),
						median: energy.medianGapMs,
						p99: energy.p99GapMs,
					})}
				</Note>
			</div>
		</Section>
	);
}
