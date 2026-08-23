import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatClock } from '~/lib/format';
import type { Analysis, ElementalAuditResult } from '~/lib/types';

import { DataGrid, Note, Prose, Section, SpellIcon, StatTile, StatTiles, type GridRow } from '~/components/primitives';

/**
 * Fire Elemental: the five-minute summon.
 *
 * The p5 list presses it prepull when Heroism is going up on the pull, synced with Ascendance, or in
 * the pull's last minute — and nowhere else. The section is about whether it went out at all and
 * whether each press was one of those three windows.
 */
export default function FireElemental({ analysis }: { analysis: Analysis }) {
	const el = analysis as Analysis & ElementalAuditResult;
	const { fireElemental } = el;
	const { t, toneOf } = useReportCopy(analysis);
	// `good` is the elemental out at the pull, `ok` is it not, and null is the pull being unable to say
	// — the three the notes below answer to. Read off the metric rather than off `fireElemental.prepull`
	// so the note and the summary card cannot end up making different claims about one pull.
	const prepullTone = toneOf('fireElementalPrepull');

	const rows = useMemo<GridRow[]>(
		() =>
			[...fireElemental.presses]
				.sort((a, b) => a.t - b.t)
				.map((press, i) => ({
					key: `${press.t}-${i}`,
					band: press.reason === null ? ('warn' as const) : undefined,
					cells: {
						at: formatClock(press.t),
						state: press.reason === null ? t('fireElemental.state.plain') : t(`fireElemental.state.${press.reason}`),
					},
				})),
		[fireElemental.presses, t],
	);

	return (
		<Section id="fire-elemental" title={t('fireElemental.title')}>
			<Prose>
				<span className="inline-flex items-center gap-2 align-middle">
					<SpellIcon id={2894} size="sm" />
				</span>{' '}
				{t('fireElemental.intent')}
			</Prose>

			<div className="mt-4.5">
				<StatTiles>
					<StatTile value={`${fireElemental.presses.length}`} label={t('fireElemental.kpi.used')} />
					<StatTile
						value={`${fireElemental.presses.filter((p) => p.reason !== null).length}`}
						label={t('fireElemental.kpi.inWindow')}
					/>
				</StatTiles>
			</div>

			<div className="mt-5">
				<DataGrid
					caption={t('fireElemental.caption')}
					columns={[
						{ key: 'at', label: t('fireElemental.columns.at'), width: '96px' },
						{ key: 'state', label: t('fireElemental.columns.state') },
					]}
					rows={rows}
					// One empty state, because there is no longer a case that needs two. A pull whose only
					// summon predates the pull used to have no press to list, so "never pressed in this pull"
					// sat beside a note saying it was already out — the report arguing with itself, which is
					// how the missed detection behind plan step 48 was reported. The second string existed to
					// paper over that. The prepull use is now a row of its own, so the contradiction is fixed
					// where it was rather than worded around, and this slot only renders when the elemental
					// really was never summoned.
					empty={t('fireElemental.none')}
				/>
			</div>

			<div className="mt-5 flex flex-col gap-3.5">
				{/* Three notes, not two, and which one shows is `lib/score`'s call rather than this
				    component's. `toneOf` returns null on an unmeasurable metric — see the hook — and that is
				    the case the old two-way read had no wording for: it printed "it was not out at the pull"
				    at a pull too short for a pre-pull summon to have left any trace of itself either way. */}
				<Note>
					{prepullTone === null
						? t('fireElemental.prepullUnknown')
						: prepullTone === 'good'
							? t('fireElemental.prepullYes')
							: t('fireElemental.prepullNo')}
				</Note>
			</div>
		</Section>
	);
}
