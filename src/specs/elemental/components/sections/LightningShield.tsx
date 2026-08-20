import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatClock, formatSeconds } from '~/lib/format';
import type { Analysis, ElementalAuditResult } from '~/lib/types';

import { DataGrid, Note, Prose, Section, SpellIcon, StatTile, StatTiles, type GridRow } from '~/components/primitives';
import ResourceChart from '~/components/charts/ResourceChart';
import { resourceCurveFromPoints } from '~/components/charts/resourceCurve';

/**
 * Lightning Shield: the counter every Earth Shock is spent from.
 *
 * The shield is not a dot and not a clock — it is a seven-charge counter that builds on Rolling
 * Thunder and is spent whole by Earth Shock's Fulmination. The chart draws the counter itself, on
 * the same stepped scale the Tigereye Brew bank uses, and shades its two faults in red: sitting at
 * the ceiling so long the Rolling Thunder has nowhere to put its charge, and coming all the way off.
 * The table lists only the bad spends — a shock taken below the ceiling — because a spend at seven is
 * the whole game and needs no row.
 */
export default function LightningShield({ analysis }: { analysis: Analysis }) {
	const el = analysis as Analysis & ElementalAuditResult;
	const { lightningShield } = el;
	const { t, verdict } = useReportCopy(analysis);

	const curve = useMemo(
		() => resourceCurveFromPoints(lightningShield.points, lightningShield.maxStacks),
		[lightningShield.points, lightningShield.maxStacks],
	);

	const badRows = useMemo<GridRow[]>(
		() =>
			[...lightningShield.badSpends]
				.sort((a, b) => a.t - b.t)
				.map((spend, i) => ({
					key: `${spend.t}-${i}`,
					band: 'warn' as const,
					cells: {
						at: formatClock(spend.t),
						stacks: spend.stacks === null ? '—' : `${spend.stacks}`,
					},
				})),
		[lightningShield.badSpends],
	);

	return (
		<Section id="lightning-shield" title={t('lightningShield.title')}>
			<Prose>
				<span className="inline-flex items-center gap-2 align-middle">
					<SpellIcon id={324} size="sm" />
				</span>{' '}
				{t('lightningShield.intent')}
			</Prose>

			<div className="mt-4.5">
				<StatTiles>
					<StatTile value={formatSeconds(lightningShield.overcapMs)} label={t('lightningShield.kpi.overcap')} />
					<StatTile value={`${lightningShield.fellOff}`} label={t('lightningShield.kpi.fellOff')} />
					<StatTile value={`${lightningShield.badSpends.length}`} label={t('lightningShield.kpi.badSpends')} />
				</StatTiles>
			</div>

			<div className="mt-5">
				{curve === null ? (
					<Note>{t('lightningShield.none')}</Note>
				) : (
					<ResourceChart
						curve={curve}
						durationMs={analysis.durationMs}
						mode="steps"
						tone="kick"
						legend={t('lightningShield.key.shield')}
						bands={[
							{
								// The three faults share one colour and now one key entry: fell off, overcapped,
								// or spent below the ceiling are all "the shield went wrong" in the same red.
								tone: 'miss',
								windows: [
									...lightningShield.downWindows,
									...lightningShield.overcapWindows,
									...lightningShield.badSpends.map((spend) => ({
										start: spend.t,
										end: spend.t,
										text: spend.stacks === null ? undefined : `${spend.stacks}`,
									})),
								],
								legend: t('lightningShield.key.fault'),
							},
						]}
						label={t('lightningShield.chart')}
						labelDecreases
					/>
				)}
			</div>

			<div className="mt-5">
				<DataGrid
					caption={t('lightningShield.caption')}
					columns={[
						{ key: 'at', label: t('lightningShield.columns.at'), width: '96px' },
						{ key: 'stacks', label: t('lightningShield.columns.stacks'), align: 'right', width: '110px' },
					]}
					rows={badRows}
					empty={t('lightningShield.noBadSpends')}
				/>
			</div>

			<div className="mt-5 flex flex-col gap-3.5">
				<Prose>
					{verdict('lightningShield', { overcap: lightningShield.overcapMs, fellOff: lightningShield.fellOff })}
				</Prose>
				<Note>{t('lightningShield.leeway', { leeway: formatSeconds(lightningShield.leewayMs) })}</Note>
			</div>
		</Section>
	);
}
