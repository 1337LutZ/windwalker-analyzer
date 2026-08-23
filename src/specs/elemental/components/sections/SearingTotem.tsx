import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatClock, formatPercentValue, formatSeconds } from '~/lib/format';
import type { Analysis, ElementalAuditResult } from '~/lib/types';

import { DataGrid, Note, Prose, Section, SpellIcon, StatTile, StatTiles, type GridRow } from '~/components/primitives';
import SearingTotemUptime from '../charts/SearingTotemUptime';

/**
 * Searing Totem: the sixty-second fire-and-forget.
 *
 * One global, a minute of ticks. The sim gates it on the Fire Elemental not being out and no totem
 * already ticking, so the section is uptime against engaged time, the dot-time a re-press threw away,
 * the placements that came under the Fire Elemental, and the ones too late to matter.
 */
export default function SearingTotem({ analysis }: { analysis: Analysis }) {
	const el = analysis as Analysis & ElementalAuditResult;
	const { searingTotem } = el;
	// The stretches three or more enemies were up, straight off the array the audit's own `gradedSpans` is
	// the complement of — the same one `SearingTotemUptime` shades. Read here only to decide whether the
	// note below has a band to explain.
	const aoeWindows = el.lightningShield.aoeWindows;
	const { t, gradeOf, unasked, verdict } = useReportCopy(analysis);

	/**
	 * Which question the verdict below is answering — because on one reading it is not the totem's uptime.
	 *
	 * The section is graded on two metrics and only one of them has a scope: `searingTotemUptime` is
	 * `bands: [1, 2]`, because `aoe.apl.json` has no fire-totem rung, while `searingTotemOverlaps` is asked
	 * at every enemy count (a totem laid under the elemental buys nothing however many enemies are up —
	 * that ruling is written out at the metric). So on a reading of three or more enemies the uptime is
	 * unasked, the overlap count is not, and `section()` reads the letter off the overlap count alone.
	 *
	 * **The letter is kept and narrowed rather than withheld, and this is the argument.** Zero overlaps is a
	 * true finding about the pull at every enemy count, and printing nothing would tell a reader the totem
	 * went unread when half of it did not — the same indistinguishability the header's *judged on N of M
	 * points* line is printed on every pull to avoid. What was wrong was never the letter but the sentence
	 * under it: `verdict_good` opens `{{uptime}} uptime`, so a `good` earned by an empty overlap ledger was
	 * being read out as a claim about a percentage nothing had measured. So the wording switches with the
	 * scope, leads with what was not measured, and says which figure the letter is about.
	 *
	 * Only over the three real grades. With the totem never cast the overlap count is unmeasurable too and
	 * `gradeOf` already answers `none`, which is the honest "never pressed" sentence and needs no variant.
	 */
	const grade = gradeOf('searingTotem');
	const uptimeUnasked = unasked('searingTotemUptime');
	const narrowed = uptimeUnasked && grade !== 'none' && grade !== 'exempt';

	const rows = useMemo<GridRow[]>(
		() =>
			[...searingTotem.presses]
				.sort((a, b) => a.t - b.t)
				.map((press, i) => {
					// A clip and an under-Fire-Elemental placement are both faults; a late placement is a
					// fault only past the ten-second line, which is how the press was flagged in the audit.
					const faulted = press.clipped || press.feOverlap || press.late;
					return {
						key: `${press.t}-${i}`,
						band: faulted ? ('warn' as const) : undefined,
						cells: {
							at: formatClock(press.t),
							remaining: press.remainingMs === null ? '—' : formatSeconds(press.remainingMs),
							state: press.feOverlap
								? t('searingTotem.state.feOverlap')
								: press.late
									? t('searingTotem.state.late')
									: press.remainingMs === null
										? t('searingTotem.state.fresh')
										: press.clipped
											? t('searingTotem.state.clip')
											: t('searingTotem.state.refresh'),
						},
					};
				}),
		[searingTotem.presses, t],
	);

	return (
		<Section id="searing-totem" title={t('searingTotem.title')}>
			<Prose>
				<span className="inline-flex items-center gap-2 align-middle">
					<SpellIcon id={3599} size="sm" />
				</span>{' '}
				{t('searingTotem.intent')}
			</Prose>

			<div className="mt-4.5">
				<StatTiles>
					{/* The tile keeps its number and gains the caption, rather than printing a dash: the figure is a
					    real measurement of the pull and dropping it would lose information a reader can use. What it
					    is not is a figure anything was measured against on this reading, and the caption is where
					    that is said — beside the number, not in a note below the table. */}
					<StatTile
						value={formatPercentValue(searingTotem.uptimePct)}
						label={
							uptimeUnasked ? `${t('searingTotem.kpi.uptime')} — ${t('metric.notAsked')}` : t('searingTotem.kpi.uptime')
						}
					/>
					<StatTile value={`${searingTotem.clipped}`} label={t('searingTotem.kpi.clipped')} />
					<StatTile value={formatSeconds(searingTotem.wastedMs)} label={t('searingTotem.kpi.wasted')} />
					<StatTile value={`${searingTotem.feOverlaps}`} label={t('searingTotem.kpi.overlaps')} />
					<StatTile value={`${searingTotem.latePlacements}`} label={t('searingTotem.kpi.late')} />
				</StatTiles>
			</div>

			<div className="mt-5">
				<SearingTotemUptime analysis={analysis} />
			</div>

			<div className="mt-5">
				<DataGrid
					caption={t('searingTotem.caption')}
					columns={[
						{ key: 'at', label: t('searingTotem.columns.at'), width: '96px' },
						{ key: 'remaining', label: t('searingTotem.columns.remaining'), align: 'right', width: '110px' },
						{ key: 'state', label: t('searingTotem.columns.state') },
					]}
					rows={rows}
					empty={t('searingTotem.none')}
				/>
			</div>

			<div className="mt-5 flex flex-col gap-3.5">
				<Prose>
					{narrowed
						? t('searingTotem.verdict', {
								context: `${grade}_noUptime`,
								uptime: searingTotem.uptimePct,
								overlaps: searingTotem.feOverlaps,
							})
						: /*
							 * `count` is the clipped-press figure, so the sentence agrees with it at every value it
							 * can take — *"1 presses clipped"* and *"0 presses clipped, throwing away 0s"* were both
							 * reachable, and the second one on two committed pulls.
							 *
							 * Only the un-narrowed route needs it. Clipping is not one of this section's two graded
							 * metrics, so the letter above the sentence says nothing about how many presses clipped
							 * — `phased` grades `ok` on uptime alone with nothing clipped at all — which is exactly
							 * why the figure has to carry its own agreement rather than borrow it from the grade. The
							 * narrowed route names the overlap count instead and no arm of it prints this one.
							 */
							verdict('searingTotem', {
								uptime: searingTotem.uptimePct,
								clipped: searingTotem.clipped,
								count: searingTotem.clipped,
								wasted: searingTotem.wastedMs,
							})}
				</Prose>
				{/* What the grey band on the graph above means, on the pulls that have one. Same gate and same
				    argument as `lightningShield.aoeNote` — see the note in the Flame Shock section. */}
				{aoeWindows.length === 0 ? null : <Note>{t('searingTotem.aoeNote')}</Note>}
				<Note>{t('searingTotem.gate')}</Note>
			</div>
		</Section>
	);
}
