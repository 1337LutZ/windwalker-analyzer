import { useMemo } from 'react';
import { useReportCopy } from '~/hooks/useReportCopy';
import type { ExternalCaster, ExternalRow, ExternalsAudit } from '~/lib/analysis/externals';
import { formatInteger, formatSeconds } from '~/lib/format';
import type { Analysis } from '~/lib/types';

import ChartEmpty from '~/components/charts/ChartEmpty';
import ChartKey from '~/components/charts/ChartKey';
import WindowTracks, { type Track } from '~/components/charts/WindowTracks';
import type { VengeanceAudit } from '~/lib/analysis/vengeance';
import {
	Callout,
	CauseLegend,
	CauseTag,
	ChartFigure,
	DataGrid,
	Note,
	Prose,
	Section,
	StatTile,
	StatTiles,
	type GridRow,
} from '~/components/primitives';

/**
 * The damage-reduction cooldowns the raid could have put on this tank, and which of them it did.
 *
 * **This is the one heading on this page that recommends rather than describes, and the licence is
 * specific rather than a change of policy.** `specs/protection/lib/score.ts` grades two figures and
 * argues at length that everything else here is described, because a threshold on it would be an
 * opinion wearing a measurement's clothes. That argument holds for where a cooldown landed and it does
 * not hold for an external, for one reason: an external costs the tank nothing at all. Vengeance is
 * taken from damage captured before the tank's own reductions apply, so a cooldown that halves an
 * incoming hit does not halve the attack power that hit pays out. `lib/analysis/externals` carries the
 * citation into the simulator, line by line.
 *
 * So there is no trade to weigh here, which is what a threshold usually cannot say. A cooldown nobody
 * cast is a tank who was less safe for no gain anywhere, and naming it is an improvement rather than a
 * complaint about somebody's healing.
 *
 * **What keeps that honest is the roster.** Every count on this page is taken over the externals a
 * player in *this pull* could actually have cast. A raid with no priest missed no Pain Suppression,
 * and the table says so in a row rather than dropping it, because "nobody here could" and "somebody
 * here could and did not" are different reports and only the second is worth acting on.
 *
 * **The chart draws two things and the difference between them matters.** The upper rows are what
 * landed on this player. The lower ones are externals this player put on somebody *else* — which is
 * the only honest answer to "did the other tank get it instead", and a partial one. The fetch is
 * scoped to this player and carries every event they were either end of, so a cooldown they cast is
 * visible with its target and a cooldown a healer put on the co-tank is not in the stream at all. The
 * copy says that rather than letting a reader infer that nothing else happened.
 */
/**
 * The class name a reader would say out loud, from the spelling WarcraftLogs files actors under.
 *
 * Split on the case change rather than looked up, because a lookup would be a second list of the
 * eleven classes to keep in step with the first — and the only thing separating `DeathKnight` from
 * `Death Knight` is a space. The gate itself never uses this: it matches on the log's own spelling,
 * which is what the roster carries.
 */
/** Stable identity for the absent case, so the memo below does not rebuild on every render. */
const NO_ROWS: ExternalsAudit['rows'] = [];

const readableClass = (subType: string): string => subType.replaceAll(/([a-z])([A-Z])/g, '$1 $2');

export default function Externals({ analysis }: { analysis: Analysis }) {
	// Optional, like every other audit field is read here: a report captured before this existed
	// carries no `externals`, and assuming one would throw on it.
	const { externals } = analysis as Analysis & { externals?: ExternalsAudit };
	// Optional for the same reason `externals` is: a capture taken before either section existed carries
	// neither, and the chart simply omits the line rather than the section refusing to draw.
	const { vengeance } = analysis as Analysis & { vengeance?: VengeanceAudit };
	const { t } = useReportCopy(analysis);

	const rows = externals?.rows ?? NO_ROWS;
	// Bound outside the memo so the split inside it depends on a number rather than on `analysis`.
	const actorID = analysis.actorID;

	/**
	 * The player's own presses, split out of `received` — which is what the second tone means.
	 *
	 * **A raid-wide external the player pressed lands on them like anybody else's**, so it arrives in
	 * `received` under their own actor id and drew in the same tone as the healer's Pain Suppression
	 * beside it. That is the row a reader came to this heading to find: Devotion Aura is on the Paladin's
	 * own bar, and a heading about what the raid brought has to say which of it the reader brought.
	 *
	 * Split here rather than in the audit, deliberately. `received` is "what protected you", and a press
	 * of your own protected you exactly as much — moving it out would take it off `count` and `heldMs`,
	 * which answer a different question and are right as they stand. What changes is only how the chart
	 * draws it.
	 *
	 * `id` and never a name: names come from the report's actor list, can be null, and two raiders can
	 * share one. See `ExternalCaster.id`.
	 */
	const mine = (row: ExternalRow): ExternalCaster[] => row.received.filter((caster) => caster.id === actorID);

	const tracks = useMemo((): Track[] => {
		const spans = (casters: readonly ExternalCaster[]): Array<[number, number]> =>
			casters.flatMap((caster) => caster.windows.map((w): [number, number] => [w.start, w.end]));
		const self = (row: ExternalRow) => row.received.filter((caster) => caster.id === actorID);
		const others = (row: ExternalRow) => row.received.filter((caster) => caster.id !== actorID);
		return [
			...rows
				.filter((row) => others(row).length > 0)
				.map((row): Track => ({
					label: row.name,
					tone: 'brew',
					windows: spans(others(row)),
					lengthLabel: t('externals.length.held'),
				})),
			// The player's own, in the pressed-it tone. Above the ones they gave away rather than below,
			// because this heading is about the reader's own pull first and about the raid's second.
			...rows
				.filter((row) => self(row).length > 0)
				.map((row): Track => ({
					label: t('externals.track.yours', { name: row.name }),
					tone: 'kick',
					windows: spans(self(row)),
					lengthLabel: t('externals.length.held'),
				})),
			...rows
				.filter((row) => row.given.length > 0)
				.map((row): Track => ({
					label: t('externals.track.given', {
						name: row.name,
						target: row.given.map((who) => who.name ?? `#${who.id}`).join(', '),
					}),
					tone: 'kick',
					windows: spans(row.given),
					lengthLabel: t('externals.length.given'),
				})),
		];
	}, [rows, actorID, t]);

	if (externals === undefined) {
		return (
			<Section id="externals" title={t('externals.title')}>
				<Prose>{t('externals.intent')}</Prose>
				<div className="mt-5">
					<Note>{t('empty.section')}</Note>
				</div>
			</Section>
		);
	}

	// Off the audit, never rebuilt here: the rule has three clauses — offered, observable, and not
	// blocked by a competing Hand — and a second copy of it in the view drifted from all three. See
	// `ExternalsAudit.missed`.
	const missing = externals?.missed ?? [];
	const heldMs = rows.reduce((most, row) => Math.max(most, row.heldMs), 0);
	// Two different questions, and the note under the chart wants the narrower one. `gave` is what the
	// player redirected *away* from themselves, which is the sentence `externals.given` prints; `pressed`
	// is every external they were the caster of, which is what the second tone on the chart means and so
	// what its key line has to appear for.
	const gave = rows.filter((row) => row.given.length > 0);
	const pressed = rows.filter((row) => row.given.length > 0 || mine(row).length > 0);

	/**
	 * Only the cooldowns somebody in this raid could actually have cast.
	 *
	 * **A row for a spell nobody brought is a row a reader cannot act on.** A raid with no warrior is
	 * told nothing useful by a Vigilance line reading "nobody in this pull" — it is a fact about the
	 * roster, not about the tank or the healers, and printing nine of them buries the two or three that
	 * are real. The count of what was left out is stated under the table instead, so the omission is
	 * visible without costing a line each.
	 *
	 * The gate is class presence, which is as far as the log will go: whether the warrior who *was* there
	 * had Vigilance talented is not in any stream this report reads, so a row can be offered by a raid
	 * that could not in fact have cast it. That errs towards showing one row too many rather than hiding
	 * a real chance, which is the right direction for a section that recommends.
	 */
	const offered = rows.filter((row) => row.available);
	// Off the audit rather than recomputed here, so the figure the note prints and the gate the table
	// filters on cannot drift apart — and so the synthetic roster suite can pin it.
	const absent = externals?.absent ?? 0;

	// No catalogue lookup here any more: every figure this table prints now comes off the row, because
	// the row is the half that knows which caster a pull actually had. See `ExternalRow.scope`.
	const grid: GridRow[] = offered.map((row) => {
		return {
			key: row.key,
			// Shaded where nobody cast it, which every row here could have been. The unavailable ones are
			// filtered out above rather than drawn unshaded.
			band: row.count === 0 ? ('warn' as const) : undefined,
			cells: {
				external: <b className="font-semibold text-ink">{row.name}</b>,
				brings: (
					<span className="text-ink-2">
						{t('externals.brings', { count: row.providers, className: readableClass(row.providedBy) })}
					</span>
				),
				cuts: (
					// Off the row and never off the catalogue entry: a Holy Paladin's Devotion Aura cuts all
					// damage where anybody else's cuts only magic, and the row is the half that knows which
					// caster this pull actually had. See `ExternalSpell.casterDependent`.
					<span className="text-ink-2">
						{t('externals.cuts', {
							context: row.takenMultiplier == null ? 'unknown' : row.scope,
							percent: row.takenMultiplier == null ? 0 : Math.round((1 - row.takenMultiplier) * 100),
						})}
					</span>
				),
				// A cooldown that never reached you is the one row here nobody can practise away and everybody
				// can talk about, which is what the tag says and what the note under the table asks for.
				landed:
					row.count === 0 ? (
						<span className="inline-flex items-baseline">
							<CauseTag cause="raid" />
							<span className="text-ink-2">{t('externals.never')}</span>
						</span>
					) : (
						<span className="text-ink-2">{formatInteger(row.count)}</span>
					),
				held: <b className="font-semibold text-ink-2">{row.heldMs === 0 ? '—' : formatSeconds(row.heldMs)}</b>,
			},
		};
	});

	return (
		<Section id="externals" title={t('externals.title')}>
			<Prose>{t('externals.intent')}</Prose>

			<div className="mt-4.5">
				<StatTiles>
					<StatTile value={formatInteger(externals.available)} label={t('externals.kpi.available')} />
					<StatTile value={formatInteger(externals.used)} label={t('externals.kpi.landed')} />
					<StatTile value={formatInteger(externals.unused)} label={t('externals.kpi.unused')} />
				</StatTiles>
			</div>

			{missing.length === 0 ? null : (
				<div className="mt-4">
					<Callout tone="brew" title={t('externals.recommendation.title')}>
						<p className="m-0">{t('externals.recommendation.body', { names: missing.join(', ') })}</p>
					</Callout>
				</div>
			)}

			<div className="mt-5">
				{tracks.length === 0 ? (
					<ChartEmpty>{t('externals.empty')}</ChartEmpty>
				) : (
					<ChartFigure
						gap="wide"
						caption={
							<>
								{vengeance === undefined ? null : <ChartKey tone="rune">{t('externals.key.vengeance')}</ChartKey>}
								<ChartKey tone="brew">{t('externals.key.landed')}</ChartKey>
								{pressed.length === 0 ? null : <ChartKey tone="kick">{t('externals.key.own')}</ChartKey>}
							</>
						}
					>
						<WindowTracks
							tracks={tracks}
							chartId="prot-externals"
							durationMs={analysis.durationMs}
							label={t('externals.chartLabel', { landed: externals.used, duration: analysis.durationMs })}
							// Vengeance behind the rows and inside the same plot rectangle, so a reader can look
							// straight down from a stretch of the curve to the cooldowns that were up under it.
							// That correlation is the section's whole subject: an external cuts the damage and
							// not the attack power, so the moments worth spending one are the moments the curve
							// is high — and stacked in a second chart above, the eye has to carry between plots
							// to ask which window sat under which part of it. See `WindowTracks`'s `behind`.
							{...(vengeance === undefined
								? {}
								: {
										behind: {
											curve: vengeance.curve,
											label: t('externals.key.vengeance'),
											stroke: 'var(--color-rune)',
											fill: 'color-mix(in srgb, var(--color-rune) 12%, transparent)',
										},
									})}
						/>
					</ChartFigure>
				)}
			</div>

			<div className="mt-5 flex flex-col gap-3.5">
				<Prose>
					{t('externals.summary', {
						context: externals.used === 0 ? 'none' : undefined,
						used: externals.used,
						available: externals.available,
						held: heldMs,
					})}
				</Prose>
				{gave.length === 0 ? null : (
					<Note>{t('externals.given', { names: gave.map((row) => row.name).join(', ') })}</Note>
				)}
				{externals.unreadable.length === 0 ? null : (
					<Note>{t('externals.unreadable', { names: externals.unreadable.join(', ') })}</Note>
				)}
				{absent === 0 ? null : <Note>{t('externals.absent', { count: absent })}</Note>}
				<Note>{t('externals.scope')}</Note>
			</div>

			<div className="mt-5">
				<DataGrid
					caption={t('externals.caption')}
					columns={[
						{ key: 'external', label: t('externals.columns.external'), width: '180px' },
						{ key: 'brings', label: t('externals.columns.brings'), card: 'wide' },
						{ key: 'cuts', label: t('externals.columns.cuts'), card: 'wide' },
						{ key: 'landed', label: t('externals.columns.landed'), align: 'right', width: '90px' },
						{ key: 'held', label: t('externals.columns.held'), align: 'right', width: '90px' },
					]}
					rows={grid}
				/>
			</div>

			{/* Only when one of them never reached the player, so a tank whose raid covered them is not sent
			    to have a conversation they do not need. */}
			{rows.some((row) => row.count === 0) ? (
				<div className="mt-3.5 flex flex-col gap-3.5">
					<CauseLegend causes={['raid']} />
					<Note>{t('externals.callNote')}</Note>
				</div>
			) : null}
		</Section>
	);
}
