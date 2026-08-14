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
 * health, and MoP Classic logs carry neither `combatantInfo` nor `maxHitPoints` on any event — I
 * checked damage-taken, healing and resource events on both an anonymous and an ordinary report.
 * Rather than print a ceiling derived from a guess at someone's health pool, the section reports
 * what each use actually returned and leaves the reader to judge the rest.
 *
 * The judgement it *can* support is the one that matters anyway: a Karma pressed into a quiet
 * stretch returns almost nothing, and the per-use table shows that directly.
 */
export default function TouchOfKarma({ analysis }: { analysis: Analysis }) {
	const { karma } = analysis;
	const { t } = useReportCopy(analysis);

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
				},
			})),
		[karma.uses],
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
					</div>
				</>
			)}
		</Section>
	);
}
