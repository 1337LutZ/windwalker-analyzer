import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatClock, formatSeconds } from '~/lib/format';
import type { Analysis, ElementalAuditResult } from '~/lib/types';

import {
	CauseTag,
	DataGrid,
	Note,
	Prose,
	Section,
	SpellIcon,
	StatTile,
	StatTiles,
	type GridRow,
} from '~/components/primitives';
import StormlashTotems from '../charts/StormlashTotems';

/**
 * The raid's Stormlash Totems, read together.
 *
 * The buff does not stack, so the assignment is to stagger the totems — first, then second, then
 * third — and a totem laid on top of a running one is a totem wasted. Each shaman gets a row; the
 * overlap row on top marks where two ran at once.
 *
 * The chart is `StormlashTotems`, next door, rather than built here. This was the one section in
 * either spec that assembled an ApexCharts option object in-file, and it paid for it by carrying its
 * own copies of the row grid, the span floor and the whole rangeBar skeleton — 62 lines that were
 * identical to the Flame Shock chart's, and that drifted from them the moment either was fixed.
 *
 * **Two sources, named as two, which is the fix for the thing that made this section look finished and
 * show nothing.** The tiles and the chart read `stormlash.shamans` / `.totems` — the raid's *placements*,
 * off a separate fetch — and no committed pull carries that field, so both count zero on every log we
 * hold. The table below reads `stormlash.received`, which comes off the fight's own stream and is
 * populated. When the placements are missing and the table is not, the section says so rather than
 * leaving a reader to reconcile four totems in a table with a tile reading zero.
 */
export default function Stormlash({ analysis }: { analysis: Analysis }) {
	const el = analysis as Analysis & ElementalAuditResult;
	const { t } = useReportCopy(analysis);
	// Undefined on an `Analysis` captured before the field existed; `?? []` inside the memo rather than
	// beside it, so the dependency is the audit's own array and not a fresh one per render.
	const received = el.stormlash.received;

	const rows = useMemo<GridRow[]>(
		() =>
			(received ?? []).map((totem, i) => ({
				key: `${totem.t}-${i}`,
				/**
				 * **No band on any row, including the one rule 6 fires on, and that is deliberate.**
				 *
				 * Plan §80's own box makes the argument: "a reader cannot tell a hard rule from a preference
				 * by looking at a red cell". Rule 6 is the user's own hedge — "should *ideally* not be cast
				 * during Ascendance" — it enters no grade expression, and tinting its row the same colour the
				 * Flame Shock table paints a dropped dot would say the opposite. The state cell says it in
				 * words instead, and the note under the table says it is a preference.
				 */
				cells: {
					at: formatClock(totem.t),
					// The player first-person, everybody else by whatever the report's actor list could name
					// them — and the bare id where it could not, which is the same fallback the chart's rows
					// use rather than inventing a raid-mate.
					who: totem.source.own ? t('stormlash.you') : (totem.source.name ?? `#${totem.source.id}`),
					// The buff's own lifetime on this player, which is what the bar beside it draws. Shorter
					// than the totem's ten seconds wherever the kill cut it off.
					upFor: formatSeconds(totem.end - totem.t),
					// Only the player's own totem has anything here. `duringAscendance` is null for anybody
					// else's, and a row about a press this player did not make gets no verdict cell rather
					// than a reassuring one — the same em dash the Flame Shock table uses for a figure that
					// does not apply to a row.
					// The tag is the list's on both arms, and deliberately so: laying your own totem outside
					// Ascendance is what the list asks for, and laying it inside is a preference about which
					// global carries it rather than a mistake anybody made. A row about somebody else's totem
					// carries no judgment and so carries no tag.
					state:
						totem.duringAscendance === null ? (
							'—'
						) : (
							<span className="inline-flex items-baseline">
								<CauseTag cause="rotation" />
								<span>{t(`stormlash.state.${totem.duringAscendance ? 'duringAscendance' : 'yours'}`)}</span>
							</span>
						),
				},
			})),
		[received, t],
	);

	return (
		<Section id="stormlash" title={t('stormlash.title')}>
			<Prose>
				<span className="inline-flex items-center gap-2 align-middle">
					<SpellIcon id={120668} size="sm" />
				</span>{' '}
				{t('stormlash.intent')}
			</Prose>

			<div className="mt-4.5">
				<StatTiles>
					<StatTile value={`${el.stormlash.totems}`} label={t('stormlash.kpi.totems')} />
					<StatTile value={`${el.stormlash.overlaps.length}`} label={t('stormlash.kpi.overlaps')} />
				</StatTiles>
			</div>

			<div className="mt-5">
				<StormlashTotems analysis={analysis} />
			</div>

			{/* Only where the two sources actually disagree about whether this pull had any totems in it:
			    a pull whose placements were fetched needs no explanation, and a pull with neither reading
			    has nothing to explain. */}
			{el.stormlash.totems === 0 && (received?.length ?? 0) > 0 ? (
				<div className="mt-5">
					<Note>{t('stormlash.sourceNote')}</Note>
				</div>
			) : null}

			<div className="mt-5">
				<DataGrid
					caption={t('stormlash.caption')}
					columns={[
						{ key: 'at', label: t('stormlash.columns.at'), width: '96px' },
						{ key: 'who', label: t('stormlash.columns.who'), width: '160px' },
						{ key: 'upFor', label: t('stormlash.columns.upFor'), align: 'right', width: '96px' },
						{ key: 'state', label: t('stormlash.columns.state'), card: 'wide' },
					]}
					rows={rows}
					empty={t('stormlash.none')}
				/>
			</div>

			<div className="mt-5 flex flex-col gap-3.5">
				<Note>{t('stormlash.ascendanceNote')}</Note>
				<Note>{t('stormlash.note')}</Note>
			</div>
		</Section>
	);
}
