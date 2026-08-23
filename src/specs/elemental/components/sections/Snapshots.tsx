import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatClock } from '~/lib/format';
import type { Analysis, ElementalAuditResult } from '~/lib/types';

import { DataGrid, Note, Prose, Section, SpellIcon, StatTile, StatTiles, type GridRow } from '~/components/primitives';

/**
 * Snapshots: the proc-window Flame Shock refreshes the sim's priority-7 rule wants.
 *
 * When one of the three triggers (the UVLS buff, the UVLS counter at ten, or Black Blood of
 * Y'Shaarj at ten) overlaps an intellect proc, the list wants Flame Shock reapplied inside it so the
 * snapshot freezes the proc's spellpower. A window the dot was up through with no refresh inside is
 * a missed snapshot; the section counts them and the refresh that each window did or did not get.
 */
export default function Snapshots({ analysis }: { analysis: Analysis }) {
	const el = analysis as Analysis & ElementalAuditResult;
	const { snapshots } = el;
	const { t, gradeOf, toneOf, unasked, verdict } = useReportCopy(analysis);

	/**
	 * Three facts, and `verdict_none` was asserting the first one over the evidence for the other two.
	 *
	 * A window in the table is a trigger proc overlapping an intellect proc. A window in the *share* is
	 * one the dot was also up through, because a window the dot was down through was never a chance to
	 * refresh it — `flameShockSnapshots` in `lib/score.ts` says so, and `shareOf` takes that narrower
	 * count as its sample. So the two can come apart, and on `addsThenBoss` they do: six windows
	 * listed, one of them with the dot up, and the sentence under all six read "No proc window was
	 * offered in this pull."
	 *
	 *   - Nothing opened at all. `verdict_none`, and it is exactly true — three of the four committed
	 *     pulls wear no trigger trinket and reach it.
	 *   - Windows opened and the dot was down through every one. `verdict_noneClaimable`: none of them
	 *     was a chance you passed over, and the table is still worth reading.
	 *   - Windows opened, the dot was up through one or two, and that is under `MIN_GRADED_SAMPLE`.
	 *     `verdict_tooFew`, the same fifth arm `earthShock` and `karma` grew for the same reason: "you
	 *     never had one" and "you had one or two and there is not enough of it to read" are different
	 *     facts, and a reader acts on them differently.
	 *
	 * **Read off the metric and not off the section letter.** They agree here today — the section holds
	 * this one metric — but a section letter can survive a metric its own sentence quotes being refused,
	 * which is how "1 of 2 catchable procs taken (0%)" shipped a spec over. `toneOf` is null for a
	 * refused reading and for an unasked one alike, so the exemption is taken off `unasked` and left to
	 * `verdict()`, which has its own arm for it. And nothing below reads the metric's *value*: a refused
	 * metric parks at 0, and the counts here come from the audit.
	 */
	const claimable = snapshots.refreshed + snapshots.missed;
	const refused = toneOf('flameShockSnapshots') === null && !unasked('flameShockSnapshots');
	const thin = refused && snapshots.windows.length > 0 ? (claimable === 0 ? 'noneClaimable' : 'tooFew') : null;

	const rows = useMemo<GridRow[]>(
		() =>
			[...snapshots.windows]
				.sort((a, b) => a.start - b.start)
				.map((window, i) => ({
					key: `${window.start}-${i}`,
					cells: {
						at: `${formatClock(window.start)}–${formatClock(window.end)}`,
						source: t(`flameShockSnapshots.source.${window.source}`),
					},
				})),
		[snapshots.windows, t],
	);

	return (
		<Section id="snapshots" title={t('flameShockSnapshots.title')}>
			<Prose>
				<span className="inline-flex items-center gap-2 align-middle">
					<SpellIcon id={8050} size="sm" />
				</span>{' '}
				{t('flameShockSnapshots.intent')}
			</Prose>

			<div className="mt-4.5">
				<StatTiles>
					<StatTile
						value={`${snapshots.refreshed}`}
						suffix={`/${snapshots.refreshed + snapshots.missed}`}
						label={t('flameShockSnapshots.kpi.refreshed')}
						caption={unasked('flameShockSnapshots') ? t('metric.notAsked') : undefined}
					/>
					<StatTile value={`${snapshots.missed}`} label={t('flameShockSnapshots.kpi.missed')} />
				</StatTiles>
			</div>

			<div className="mt-5">
				<DataGrid
					caption={t('flameShockSnapshots.caption')}
					columns={[
						{ key: 'at', label: t('flameShockSnapshots.columns.window'), width: '200px' },
						{ key: 'source', label: t('flameShockSnapshots.columns.source') },
					]}
					rows={rows}
					empty={t('flameShockSnapshots.none')}
				/>
			</div>

			<div className="mt-5 flex flex-col gap-3.5">
				{/* Both thin arms are reached by name rather than through `verdict()`, which picks its arm off
				    a grade — and a refused reading has no grade to pick from. The same call `EarthShock` and
				    `TouchOfKarma` make, for the same reason. */}
				<Prose>
					{thin !== null
						? t('flameShockSnapshots.verdict', {
								context: thin,
								caught: snapshots.refreshed,
								offered: claimable,
							})
						: verdict('flameShockSnapshots', {
								caught: snapshots.refreshed,
								offered: claimable,
							})}
				</Prose>
				{/* The one instruction the exempt sentence used to end on, said as a note instead.

				    It shipped as the tail of nine graded sentences — three arms each of the two narrowed
				    families and the three `verdict_exempt` arms — which put seventeen words of page navigation
				    after the reader's own figure in every one of them. One key now, and the verdict ends on the
				    pull. Still said per section rather than left to the control: by the time a reader is here the
				    toggle is off screen, which is the argument `PriorityLadder` and `Rotation` both make. */}
				{gradeOf('flameShockSnapshots') === 'exempt' ? <Note>{t('targets.switchReading')}</Note> : null}
				<Note>{t('flameShockSnapshots.measurable')}</Note>
			</div>
		</Section>
	);
}
