import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatClock, formatPercentValue, formatSeconds } from '~/lib/format';
import type { Analysis, ElementalAuditResult } from '~/lib/types';

import { DataGrid, Note, Prose, Section, SpellIcon, StatTile, StatTiles, type GridRow } from '~/components/primitives';
import FlameShockDepth from '../charts/FlameShockDepth';
import FlameShockUptime from '../charts/FlameShockUptime';

/**
 * The uptime a reader is looking at, rather than the one the audit holds.
 *
 * `formatPercentValue` prints two decimals, so every figure from here up renders as `100%` — and a
 * sentence under a tile reading 100% must not describe a gap. A band rather than an equality test
 * because the dot's last window can close a millisecond before the engaged clock does: the `unbroken`
 * fixture is 99.99946%, which prints as 100% and had no gap in it.
 *
 * A band open at the top rather than a range, and this half is a backstop rather than a live case.
 * `c85f6d4` intersects the dot's windows with the engaged clock before dividing, so the ratio can no
 * longer exceed 100 — it used to be a union of dot windows over engaged time and reached 100.21% on a
 * real pull. Kept because the consequence of a value over 100 falling through is wording that claims a
 * gap on a pull that had none, which is the worst failure this comparison has; a `>=` cannot produce
 * it and a range could. Do not narrow it back on the grounds that the ratio is now clipped.
 */
const FULL_UPTIME_PCT = 99.995;

/**
 * Flame Shock: the dot the whole rotation is written around.
 *
 * A thirty-second snapshot dot with no cooldown and no cast time. Its remaining time gates Lava
 * Burst, its refresh timing is what the snapshot section grades, and every proc-window reapplies it
 * to freeze the converted stats. A dropped Flame Shock is not one global but a cascade, so the
 * section is uptime first and the timing of every refresh second.
 */
export default function FlameShock({ analysis }: { analysis: Analysis }) {
	const el = analysis as Analysis & ElementalAuditResult;
	const { flameShock } = el;
	const { t, gradeOf } = useReportCopy(analysis);

	const rows = useMemo<GridRow[]>(
		() =>
			[...flameShock.presses]
				.sort((a, b) => a.t - b.t)
				.map((press, i) => {
					/**
					 * Three of the seven press kinds are faults; four are not.
					 *
					 * `late` (the dot dropped while the player was there), `early` (a healthy dot clipped) and a
					 * refresh under Ascendance (a global the list wanted on Lava Burst) earn the band. An
					 * `apply` is the opener and no decision at all; a `reapply` put the dot back up after the
					 * fight took the target away or after sub-second jitter, which is not a mistake either; and
					 * a `snapshot` refresh clipped the dot on purpose, for a new application worth more than
					 * 10% more per second, which is the list's own reason to press early.
					 *
					 * This used to read `press.remainingMs === null`, which was all three down-states at once —
					 * so a pull with one apply, six clean refreshes and 100% uptime had its opener banded as a
					 * fault and labelled "Late refresh".
					 */
					const faulted =
						press.kind === 'late' || press.kind === 'early' || (press.duringAscendance && press.remainingMs !== null);
					return {
						key: `${press.t}-${i}`,
						band: faulted ? ('warn' as const) : undefined,
						cells: {
							at: formatClock(press.t),
							// The dot's remaining time where there was one; otherwise how long it had been down on
							// the player's own watch, which is the number the three down-states are judged on.
							remaining:
								press.remainingMs !== null
									? formatSeconds(press.remainingMs)
									: press.kind === 'apply'
										? '—'
										: formatSeconds(press.exposedMs ?? 0),
							state:
								press.remainingMs === null
									? t(`flameShock.state.${press.kind}`)
									: press.duringAscendance
										? t('flameShock.state.duringAscendance')
										: t(`flameShock.state.${press.kind}`),
						},
					};
				}),
		[flameShock.presses, t],
	);

	/**
	 * Which wording the grade is said in — never which grade it is.
	 *
	 * The grade is still `lib/score`'s, from the uptime and the wasted-refresh share together, which
	 * means a pull that never let the dot off the target can still be graded on its refreshes alone.
	 * The graded sentences are written around an uptime figure with a gap in it, so on that pull they
	 * read as a complaint about a flawless keep-up; the `_full` variants say what happened instead.
	 * A pull with no dot window at all has nothing to claim and keeps `verdict_none`.
	 */
	const grade = gradeOf('flameShock');
	const fullUptime = flameShock.windows.length > 0 && flameShock.uptimePct >= FULL_UPTIME_PCT;
	const context = fullUptime && grade !== 'none' ? `${grade}_full` : grade;

	return (
		<Section id="flame-shock" title={t('flameShock.title')}>
			<Prose>
				<span className="inline-flex items-center gap-2 align-middle">
					<SpellIcon id={8050} size="sm" />
				</span>{' '}
				{t('flameShock.intent')}
			</Prose>

			<div className="mt-4.5">
				<StatTiles>
					<StatTile value={formatPercentValue(flameShock.uptimePct)} label={t('flameShock.kpi.uptime')} />
					<StatTile value={`${flameShock.applies}`} label={t('flameShock.kpi.applies')} />
					<StatTile value={`${flameShock.refreshes}`} label={t('flameShock.kpi.refreshes')} />
					<StatTile value={`${flameShock.windowed}`} label={t('flameShock.kpi.windowed')} />
					{/* The cleave rule's own tile, present only when the pull actually had a second target. */}
					{flameShock.multiTargetMs > 0 ? (
						<StatTile value={formatPercentValue(flameShock.multiDotUptimePct)} label={t('flameShock.kpi.multiDot')} />
					) : null}
				</StatTiles>
			</div>

			<div className="mt-5">
				<FlameShockUptime analysis={analysis} />
			</div>

			<div className="mt-5">
				<FlameShockDepth analysis={analysis} />
			</div>

			<div className="mt-5">
				<DataGrid
					caption={t('flameShock.caption')}
					columns={[
						{ key: 'at', label: t('flameShock.columns.at'), width: '96px' },
						{ key: 'remaining', label: t('flameShock.columns.remaining'), align: 'right', width: '110px' },
						{ key: 'state', label: t('flameShock.columns.state') },
					]}
					rows={rows}
					empty={t('flameShock.none')}
				/>
			</div>

			<div className="mt-5 flex flex-col gap-3.5">
				<Prose>
					{t('flameShock.verdict', {
						context,
						uptime: flameShock.uptimePct,
						casts: flameShock.applies + flameShock.refreshes,
						// The same subtraction `score.ts` makes for `flameShockWaste`, and it has to stay the same
						// one: the sentence and the grade underneath it are about the identical set of presses.
						wasted: flameShock.refreshes - flameShock.windowed - flameShock.ascPrep - flameShock.snapshotGain,
					})}
				</Prose>
				<Note>{t('flameShock.snapshotNote')}</Note>
			</div>
		</Section>
	);
}
