import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatClock, formatCompact, formatInteger, formatPercentValue } from '~/lib/format';
import type { Analysis } from '~/lib/types';

import { DataGrid, Note, Prose, Section, SpellIcon, StatTile, StatTiles, type GridRow } from '../primitives';

/**
 * Touch of Karma: the defensive that does damage.
 *
 * It redirects what the player takes onto the target for ten seconds, so an unused charge is damage
 * not done as well as damage not avoided — which is why it earns a section rather than a row in the
 * cast table.
 *
 * What it *could* have returned is deliberately absent. The redirect is capped at a share of maximum
 * health, and that share cannot be pinned down from these logs — not because the fields are missing,
 * which is what this comment used to claim and is wrong, but because a player's `maxHitPoints` is
 * reported as 100. Deriving the pool from absolute damage against a percentage bar lands within
 * about ±10%, and one use on the reference pull redirected more than the derived pool. Rather than
 * print a ceiling that can exceed itself, the section reports what each use actually returned and
 * leaves the reader to judge the rest — see `KARMA_WINDOW_MS` in the engine for the measurements.
 *
 * The judgement it *can* support is the one that matters anyway: a Karma pressed into a quiet
 * stretch returns almost nothing, and the per-use table shows that directly.
 *
 * The Fortifying Brew column is reported and pointedly not celebrated. It arrived as a request to
 * flag the pairing "for the extra damage done", and the sim does not support that reading — see the
 * engine, which carries the numbers. The copy says what the overlap is instead of what it was hoped
 * to be, and the column only exists on a pull that actually has one.
 */
export default function TouchOfKarma({ analysis }: { analysis: Analysis }) {
	const { karma } = analysis;
	const { t } = useReportCopy(analysis);
	// Fixtures captured before this was measured carry no `fortifyingBrew` on a use and no count at
	// all, so both read `undefined` rather than `0` — hence the truthiness guard rather than a
	// comparison, which is the exact shape of a bug this file has already had once.
	const withFortifying = karma.withFortifyingBrew ?? 0;

	const rows = useMemo<GridRow[]>(
		() =>
			karma.uses.map((use, i) => ({
				key: `${use.t}-${i}`,
				// A use that redirected nothing is the fault this section exists to show.
				band: use.reflected === 0 ? ('warn' as const) : undefined,
				cells: {
					at: formatClock(use.t),
					reflected: (
						<b className={`font-semibold ${use.reflected === 0 ? 'text-miss' : 'text-ink'}`}>
							{formatCompact(use.reflected)}
						</b>
					),
					// Only when a ceiling is known. A dash would imply a number that could not be computed;
					// the column simply is not there until the reader supplies a health pool.
					...(use.capPct === null
						? {}
						: { capPct: <span className="text-ink-2">{formatPercentValue(use.capPct)}</span> }),
					hits: formatInteger(use.hits),
					// Neutral weight on purpose: an overlap is a fact about the pull, not a fault and not
					// an achievement, so it is neither banded nor coloured.
					...(withFortifying === 0
						? {}
						: {
								fortifying: <span className="text-ink-2">{use.fortifyingBrew ? t('karma.cells.yes') : '—'}</span>,
							}),
				},
			})),
		[karma.uses, withFortifying, t],
	);

	return (
		<Section id="karma" title={t('karma.title')}>
			<Prose>{t('karma.intent')}</Prose>

			{karma.casts === 0 ? (
				<div className="mt-5">
					<Note>{t('karma.none', { available: karma.available })}</Note>
				</div>
			) : (
				<>
					<div className="mt-4.5">
						<StatTiles>
							<StatTile value={`${karma.casts}`} suffix={`/${karma.available}`} label={t('karma.kpi.uses')} />
							<StatTile value={formatCompact(karma.reflected)} label={t('karma.kpi.reflected')} />
							<StatTile
								value={formatCompact(karma.casts > 0 ? karma.reflected / karma.casts : 0)}
								label={t('karma.kpi.perUse')}
							/>
						</StatTiles>
					</div>

					<div className="mt-5">
						<DataGrid
							caption={t('karma.caption')}
							columns={[
								{ key: 'at', label: t('karma.columns.at'), width: '96px' },
								{
									key: 'reflected',
									label: t('karma.columns.reflected'),
									align: 'right',
									width: '120px',
								},
								...(karma.capPerUse === null
									? []
									: [
											{
												key: 'capPct',
												label: t('karma.columns.capPct'),
												align: 'right' as const,
												width: '96px',
											},
										]),
								{ key: 'hits', label: t('karma.columns.hits'), align: 'right', width: '96px' },
								// Only on a pull that had one. A column of dashes would imply the overlap is
								// something to aim for, which is the opposite of what the note under it says.
								...(withFortifying === 0
									? []
									: [
											{
												key: 'fortifying',
												label: t('karma.columns.fortifying'),
												align: 'right' as const,
												width: '96px',
											},
										]),
							]}
							rows={rows}
							empty={t('karma.none', { available: karma.available })}
						/>
					</div>

					<div className="mt-5 flex flex-col gap-3.5">
						<Prose>
							<span className="inline-flex items-center gap-2 align-middle">
								<SpellIcon id={122470} size="sm" />
							</span>{' '}
							{t('karma.summary', {
								casts: karma.casts,
								available: karma.available,
								reflected: karma.reflected,
								share: karma.sharePct,
							})}
						</Prose>
						{/* With a health pool the section can say what the pull left on the table; without one it
						    says why it cannot, and where to change that. */}
						{karma.capPerUse === null ? (
							<Note>{t('karma.capUnset')}</Note>
						) : (
							<Prose>
								{t('karma.capSummary', {
									health: karma.capPerUse,
									casts: karma.casts,
									possible: karma.capPerUse * karma.casts,
									reflected: karma.reflected,
									pct: (karma.reflected / (karma.capPerUse * karma.casts)) * 100,
								})}
							</Prose>
						)}
						{/* Only when it happened, and stated as a correction rather than as a credit: the
						    overlap raises the redirect's ceiling and lowers what fills it at the same time. */}
						{withFortifying > 0 ? (
							<Note>
								{t('karma.fortifying', { count: withFortifying })} {t('karma.fortifyingNote')}
							</Note>
						) : null}
					</div>
				</>
			)}
		</Section>
	);
}
