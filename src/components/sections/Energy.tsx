import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatClock, formatInteger, formatPercentValue, formatSeconds } from '~/lib/format';
import type { Analysis } from '~/lib/types';

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

	return (
		<Section id="energy" title={t('energy.title')}>
			<Prose>{t('energy.intent')}</Prose>

			{capped ? (
				<>
					<div className="mt-4.5">
						<StatTiles>
							<StatTile value={formatSeconds(energy.engaged.cappedMs)} label={t('energy.kpi.engaged')} />
							{/* Only shown when a refill rate could be measured: an energy figure derived from a
							    rate nobody measured would be an invented number in a tile, which is the one
							    place on the page a reader cannot see the caveat under. */}
							{wasted === null ? null : <StatTile value={formatInteger(wasted)} label={t('energy.kpi.wasted')} />}
							<StatTile value={formatPercentValue(energy.engaged.pct)} label={t('energy.kpi.share')} />
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
