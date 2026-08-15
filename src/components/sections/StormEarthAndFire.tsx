import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatClock, formatCompact, formatPercentValue, formatSeconds } from '~/lib/format';
import type { Analysis } from '~/lib/types';

import { DataGrid, Note, Prose, Section, SpellIcon, StatTile, StatTiles, type GridRow } from '../primitives';

/**
 * Storm, Earth and Fire: up to two spirits that mirror the monk onto other enemies.
 *
 * The section answers two questions and refuses to grade either, which is the whole reason it reads
 * the way it does.
 *
 * **Was it worth pressing?** The rule is the reader's — a second enemy under the monk's hands for
 * longer than ten seconds — and `lib/spec/windwalker` says where that number comes from. It decides
 * whether this section says anything at all rather than what verdict it hands down.
 *
 * **Were the presses spent well?** A spirit copies the monk onto *its* target, so the one way to
 * waste the cooldown after it goes out is to stand on an enemy a spirit is already handling. That is
 * measured from the spirits' own swings, never assumed, and when it cannot be measured the section
 * says so instead of printing a zero — `overlapMs` is null in that case, and "you never doubled up"
 * would be an invented compliment exactly as a fabricated fault is an invented accusation.
 *
 * Whether the section appears at all is decided in `Report`, by the `when` predicate beside its entry
 * in the section list, and deliberately not by returning null from here: the contents list is built
 * from that same list, so a component that silently rendered nothing would leave the nav pointing at
 * a heading that never existed. What this file owns is what to *say* once it has been asked.
 */
export default function StormEarthAndFire({ analysis }: { analysis: Analysis }) {
	const { sef } = analysis;
	const { t } = useReportCopy(analysis);

	const rows = useMemo<GridRow[]>(
		() =>
			(sef?.uses ?? []).map((use, i) => ({
				key: `${use.t}-${i}`,
				cells: {
					at: formatClock(use.t),
					// The enemy the press aimed at. The log names it by id and the report's actor list is the
					// only thing that can turn that into a name; an id it does not answer for is left unnamed
					// rather than labelled with a neighbouring add's name.
					target: use.name ?? t('sef.unnamedTarget'),
				},
			})),
		[sef?.uses, t],
	);

	// The committed fixtures were captured before this field existed, so it is `undefined` there rather
	// than `null` — a truthiness guard is the only one that catches both. `Report` already declines to
	// render this section at all in that case; the guard is what makes the component readable on its
	// own rather than a second opinion about when it should appear.
	if (!sef) {
		return (
			<Section id="sef" title={t('sef.title')}>
				<Note>{t('empty.section')}</Note>
			</Section>
		);
	}

	const used = sef.casts > 0;
	const hasDamage = sef.cloneDamage > 0;

	return (
		<Section id="sef" title={t('sef.title')}>
			<Prose>{t('sef.intent')}</Prose>

			{used ? (
				<>
					<div className="mt-4.5">
						<StatTiles>
							<StatTile value={`${sef.casts}`} label={t('sef.kpi.casts')} />
							<StatTile value={formatPercentValue(sef.uptimePct)} label={t('sef.kpi.uptime')} />
							{hasDamage ? <StatTile value={formatCompact(sef.cloneDamage)} label={t('sef.kpi.damage')} /> : null}
							{sef.overlapMs === null ? null : (
								<StatTile value={formatSeconds(sef.overlapMs)} label={t('sef.kpi.overlap')} />
							)}
						</StatTiles>
					</div>

					<div className="mt-5">
						<DataGrid
							caption={t('sef.caption')}
							columns={[
								{ key: 'at', label: t('sef.columns.at'), width: '96px' },
								{ key: 'target', label: t('sef.columns.target') },
							]}
							rows={rows}
							empty={t('sef.none')}
						/>
					</div>
				</>
			) : null}

			<div className="mt-5 flex flex-col gap-3.5">
				<Prose>
					<span className="inline-flex items-center gap-2 align-middle">
						<SpellIcon id={137639} size="sm" />
					</span>{' '}
					{used
						? t('sef.summary', { count: sef.casts, uptime: sef.uptimePct })
						: t('sef.skipped', { justified: sef.justifiedMs, longest: sef.longestSecondTargetMs })}
				</Prose>

				{used && hasDamage ? (
					<Prose>{t('sef.damage', { damage: sef.cloneDamage, share: sef.cloneSharePct })}</Prose>
				) : null}

				{/* Three states, and the middle one is the point of the section. Null is not zero: a pull whose
				    spirits left no actor to follow cannot be asked the question, and saying nothing went wrong
				    there would be a claim the log never made. */}
				{used ? (
					sef.overlapMs === null ? (
						<Note>{t('sef.overlapUnknown')}</Note>
					) : sef.overlapMs === 0 ? (
						<Prose>{t('sef.overlapNone')}</Prose>
					) : (
						<Prose>
							{t('sef.overlap', {
								overlap: sef.overlapMs,
								measured: sef.measuredMs,
								share: sef.overlapPct ?? 0,
							})}{' '}
							{t('sef.overlapWorst', {
								target: sef.overlaps[0]?.name ?? t('sef.unnamedTarget'),
								ms: sef.overlaps[0]?.ms ?? 0,
							})}
						</Prose>
					)
				) : null}

				{used ? (
					<Prose>
						{sef.justified
							? t('sef.justified', { justified: sef.justifiedMs, rule: sef.secondTargetMs })
							: t('sef.unjustified', { longest: sef.longestSecondTargetMs, rule: sef.secondTargetMs })}
					</Prose>
				) : null}

				{/* Said once, plainly: there is no grade here and no threshold behind one. */}
				<Note>{t('sef.notGraded')}</Note>
			</div>
		</Section>
	);
}
