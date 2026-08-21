import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatClock } from '~/lib/format';
import type { Analysis, ElementalAuditResult } from '~/lib/types';

import { DataGrid, Note, Prose, Section, SpellIcon, StatTile, StatTiles, type GridRow } from '~/components/primitives';

/**
 * Earth Shock: the Lightning Shield spender, judged against the sim's own rule.
 *
 * The p5 list's Earth Shock rule wants the press only when four things line up — Lightning Shield at
 * the ceiling (a stack spent is a stack of Fulmination the shield must rebuild), the Flame Shock dot
 * has time to live, Ascendance is not about to demand the shared shock timer, and no tier-16
 * two-piece proc is up. A press that fails one of them is a shock spent early; the section reports
 * which.
 */
export default function EarthShock({ analysis }: { analysis: Analysis }) {
	const el = analysis as Analysis & ElementalAuditResult;
	const { earthShock } = el;
	const { t, verdict } = useReportCopy(analysis);

	const rows = useMemo<GridRow[]>(
		() =>
			[...earthShock.presses]
				// The table is the bad-shock ledger, not the log: a shock the rule wanted needs no row, and
				// the reasons below are why the rest went out.
				.filter((press) => !press.good)
				.sort((a, b) => a.t - b.t)
				.map((press, i) => ({
					key: `${press.t}-${i}`,
					band: 'warn' as const,
					cells: {
						at: formatClock(press.t),
						stacks: press.lsStacks === null ? '—' : `${press.lsStacks}`,
						state: press.reasons.map((reason) => t(`earthShock.state.${reason}`)).join(', '),
					},
				})),
		[earthShock.presses, t],
	);

	return (
		<Section id="earth-shock" title={t('earthShock.title')}>
			<Prose>
				<span className="inline-flex items-center gap-2 align-middle">
					<SpellIcon id={8042} size="sm" />
				</span>{' '}
				{t('earthShock.intent')}
			</Prose>

			<div className="mt-4.5">
				<StatTiles>
					<StatTile
						value={`${earthShock.good}`}
						suffix={`/${earthShock.presses.length}`}
						label={t('earthShock.kpi.good')}
					/>
					<StatTile value={`${earthShock.belowFull}`} label={t('earthShock.kpi.belowFull')} />
				</StatTiles>
			</div>

			<div className="mt-5">
				<DataGrid
					caption={t('earthShock.caption')}
					columns={[
						{ key: 'at', label: t('earthShock.columns.at'), width: '96px' },
						{ key: 'stacks', label: t('earthShock.columns.stacks'), align: 'right', width: '110px' },
						{ key: 'state', label: t('earthShock.columns.state') },
					]}
					rows={rows}
					empty={t('earthShock.none')}
				/>
			</div>

			<div className="mt-5 flex flex-col gap-3.5">
				<Prose>{verdict('earthShock', { good: earthShock.good, casts: earthShock.presses.length })}</Prose>
				<Note>{t('earthShock.fulmination')}</Note>
			</div>
		</Section>
	);
}
