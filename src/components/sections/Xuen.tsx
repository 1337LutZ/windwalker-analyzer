import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatClock, formatCompact, formatInteger, formatPercentValue, formatSeconds } from '~/lib/format';
import type { Analysis } from '~/lib/types';

import { DataGrid, Note, Prose, Section, SpellIcon, StatTile, StatTiles, type GridRow } from '../primitives';

/**
 * Invoke Xuen, the White Tiger: the one cooldown with nothing to line it up with.
 *
 * The sim's Windwalker APL never casts it by name. It is a major cooldown fired from a bare
 * `autocastOtherCooldowns` that carries no condition at all, so — unlike Fists of Fury, which is
 * graded against three — there is no placement to judge. Pressing it as soon as it is ready is the
 * entire standard, which is why this section is a count against the clock and an uptime, and offers
 * no per-use verdict column.
 *
 * The damage column is conditional for a reason. Xuen fights as a separate actor and is identified
 * in the log by Crackling Tiger Lightning, the one spell only it casts; if a report attributes that
 * differently the engine reports no pet damage rather than guessing, and a column of zeroes would
 * read as a pull of summons that did nothing. It is shown only once there is something to show.
 */
export default function Xuen({ analysis }: { analysis: Analysis }) {
	const { xuen } = analysis;
	const { t } = useReportCopy(analysis);

	// The committed fixtures were captured before this field existed, so on those it is `undefined`
	// rather than `null` — a truthiness guard is the only one that catches both.
	const hasDamage = Boolean(xuen && xuen.petDamage > 0);

	const rows = useMemo<GridRow[]>(
		() =>
			// The clock, and stated here rather than inherited from the engine's array. There is nothing
			// to rank: the section offers no per-use verdict, because pressing it as soon as it is ready
			// is the entire standard — so the only order these rows can carry is the one the summons
			// happened in, and this table is what guarantees it rather than what happens to receive it.
			[...(xuen?.uses ?? [])]
				.sort((a, b) => a.t - b.t)
				.map((use, i) => ({
					key: `${use.t}-${i}`,
					cells: {
						at: formatClock(use.t),
						window: formatSeconds(use.windowMs),
						...(hasDamage
							? {
									damage: <b className="font-semibold text-ink">{formatCompact(use.damage)}</b>,
									hits: formatInteger(use.hits),
								}
							: {}),
					},
				})),
		[xuen?.uses, hasDamage],
	);

	// The heading renders whatever the pull held, because the contents list is built from the same
	// list of sections and a link with no heading behind it is a jump to nowhere.
	if (!xuen) {
		return (
			<Section id="xuen" title={t('xuen.title')}>
				<Note>{t('empty.section')}</Note>
			</Section>
		);
	}

	const missed = Math.max(0, xuen.available - xuen.casts);

	return (
		<Section id="xuen" title={t('xuen.title')}>
			<Prose>{t('xuen.intent')}</Prose>

			{xuen.casts === 0 ? (
				<div className="mt-5">
					<Note>{t('xuen.none')}</Note>
				</div>
			) : (
				<>
					<div className="mt-4.5">
						<StatTiles>
							<StatTile value={`${xuen.casts}`} suffix={`/${xuen.available}`} label={t('xuen.kpi.uses')} />
							<StatTile value={formatPercentValue(xuen.uptimePct)} label={t('xuen.kpi.uptime')} />
							{hasDamage ? <StatTile value={formatCompact(xuen.petDamage)} label={t('xuen.kpi.damage')} /> : null}
						</StatTiles>
					</div>

					<div className="mt-5">
						<DataGrid
							caption={t('xuen.caption')}
							columns={[
								{ key: 'at', label: t('xuen.columns.at'), width: '96px' },
								{ key: 'window', label: t('xuen.columns.window'), align: 'right', width: '110px' },
								...(hasDamage
									? [
											{ key: 'damage', label: t('xuen.columns.damage'), align: 'right' as const, width: '120px' },
											{ key: 'hits', label: t('xuen.columns.hits'), align: 'right' as const, width: '96px' },
										]
									: []),
							]}
							rows={rows}
							empty={t('xuen.none')}
						/>
					</div>

					<div className="mt-5 flex flex-col gap-3.5">
						<Prose>
							<span className="inline-flex items-center gap-2 align-middle">
								<SpellIcon id={123904} size="sm" />
							</span>{' '}
							{t('xuen.summary', { count: xuen.casts, uptime: xuen.uptimePct })}{' '}
							{missed === 0 ? t('xuen.onCooldown') : t('xuen.held', { count: missed, drift: xuen.driftSec })}
						</Prose>
						{hasDamage ? (
							<Prose>{t('xuen.petDamage', { damage: xuen.petDamage, share: xuen.petSharePct })}</Prose>
						) : null}
						{xuen.uses.some((use) => use.truncated) ? <Note>{t('xuen.truncated')}</Note> : null}
						{/* Said once, plainly: there is no condition to have met, so nothing above is a verdict. */}
						<Note>{t('xuen.apl')}</Note>
					</div>
				</>
			)}
		</Section>
	);
}
