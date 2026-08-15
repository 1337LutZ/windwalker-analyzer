import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatInteger, formatPercentValue } from '~/lib/format';
import type { Analysis, TargetMode } from '~/lib/types';
import { bandForMode } from '~/lib/view/targetMode';

import { DataGrid, Note, Prose, Section, SpellIcon, StatTile, StatTiles, type GridRow } from '../primitives';

/**
 * The sim's priority list, run against the pull press by press.
 *
 * Every other section measures one thing in isolation — how many brews, how much uptime, how much
 * energy went nowhere. This one asks the question none of those can: *at the moment you spent that
 * global, was there a better button?* The model behind it is `lib/spec/apl.ts`, transcribed from
 * `ui/monk/windwalker/apls/default.apl.json` in wowsims-mop with the conditions and costs read out
 * of the Go sim rather than from memory.
 *
 * The section is deliberately more careful about what it will not say than about what it will.
 * Three refusals, all of them visible to the reader:
 *
 * - **A pull that is not single-target is not graded at all.** The ladder is the single-target list;
 *   at two or more enemies the sim's own list changes shape, and grading Spinning Crane Kicks against
 *   the single-target order would mark correct play as a mistake.
 * - **A press whose ladder could not be evaluated is `unknown`, never `followed`.** If a rule above
 *   the press depends on something this log does not carry, the answer is that the report cannot say.
 * - **Nothing here counts a press the player could not afford.** A button the list wanted and the
 *   player had no chi for is a resource problem, and the energy and chi sections already argue it.
 *
 * There is no verdict and `lib/score` grades nothing from it. A threshold would have to say how many
 * out-of-order presses are acceptable, and neither the sim nor the priority list contains such a
 * number — the ladder is a description of what the list wanted, not a target to hit.
 */
export default function PriorityLadder({ analysis, mode }: { analysis: Analysis; mode?: TargetMode | null }) {
	const { t } = useReportCopy(analysis);
	/**
	 * The audit this reading calls for.
	 *
	 * `auto` — or a choice that agrees with the pull — reads the walk the engine already did at the live
	 * target count. An override reads the walk forced to that count, which the engine precomputed for
	 * exactly this: the inputs are not on `Analysis`, so the choice cannot be answered by recomputing
	 * here.
	 *
	 * Which band each reading means is `bandForMode`'s to say, not this component's. It was a ternary
	 * here until `Rotation` needed the same answer to decide which rungs of the list to draw, and two
	 * copies of it could disagree — which would send a reader from a skip in this section to a reference
	 * list that never contained the button they were told they passed over.
	 *
	 * Falls back to the natural audit when a report predates `aplForced`, which keeps an older analysis
	 * rendering rather than showing a reader a refusal caused by the shape of the file they loaded.
	 */
	const forced = bandForMode(mode ?? null);
	const apl = forced === null ? analysis.apl : (analysis.aplForced?.[forced] ?? analysis.apl);

	const rows = useMemo<GridRow[]>(
		() =>
			(apl?.skippedBy ?? []).map((skip) => ({
				key: skip.key,
				band: 'warn' as const,
				cells: {
					button: (
						<span className="flex items-center gap-2">
							<SpellIcon id={skip.id} size="sm" />
							<span>{t(`priority.rule.${skip.key}`)}</span>
						</span>
					),
					count: <b className="font-semibold text-ink-2">{formatInteger(skip.count)}</b>,
				},
			})),
		[apl, t],
	);

	// A report captured before the ladder existed carries nothing here — `undefined`, not an empty
	// audit — and the heading still has to render, because `SectionNav` lists every section
	// unconditionally and a link with no heading behind it is a jump to nowhere.
	if (apl === undefined) {
		return (
			<Section id="priority" title={t('priority.title')}>
				<Prose>{t('priority.intent')}</Prose>
				<div className="mt-5">
					<Note>{t('empty.section')}</Note>
				</div>
			</Section>
		);
	}

	// `null` now means only one thing: the log carried no resource readings, so there was no bar to
	// reconstruct and nothing to walk. It used to also mean "add fight", and forcing `multi` used to
	// land here on purpose — the ladder was the single-target list and the reader saying the adds
	// mattered was saying it was the wrong list. The ladder bands on target count now, so an add fight
	// gets judged against the entries the adds were in, and both of those refusals are gone.
	if (apl === null) {
		return (
			<Section id="priority" title={t('priority.title')}>
				<Prose>{t('priority.intent')}</Prose>
				<div className="mt-5">
					<Note>{t('priority.noResources')}</Note>
				</div>
			</Section>
		);
	}

	const { followed, skipped, unknown, offList } = apl;
	const judged = followed + skipped;

	return (
		<Section id="priority" title={t('priority.title')}>
			<Prose>{t('priority.intent')}</Prose>

			{/* Said here rather than left to the control at the top of the page: by the time a reader has
			    scrolled to this section the toggle is off screen, and a set of verdicts is worthless
			    without knowing which list produced them. Attributed to the reader's choice — "you are
			    reading this pull as" — because that is what it is. The copy this replaced asserted a
			    property of the pull instead, and said it even when the reader had picked the mode. */}
			{forced === null ? null : (
				<div className="mt-5">
					<Note>{t(mode === 'single' ? 'priority.forced_single' : 'priority.forced_multi')}</Note>
				</div>
			)}

			<div className="mt-4.5">
				<StatTiles>
					<StatTile
						value={judged === 0 ? '—' : formatPercentValue((followed / judged) * 100)}
						label={t('priority.kpi.followed')}
					/>
					<StatTile value={formatInteger(skipped)} label={t('priority.kpi.skipped')} />
					<StatTile value={formatInteger(unknown)} label={t('priority.kpi.unknown')} />
				</StatTiles>
			</div>

			<div className="mt-5 flex flex-col gap-3.5">
				<Prose>{t('priority.summary', { followed, judged, skipped })}</Prose>
				{/* Named rather than folded into the percentage above, because they are the opposite of a
				    mistake: presses the ladder deliberately declines to judge, and a reader who cannot see
				    how many there were cannot tell a confident answer from a thin one. */}
				<Prose>{t('priority.unjudged', { unknown, offList })}</Prose>
			</div>

			{rows.length === 0 ? (
				<div className="mt-5">
					<Prose>{t('priority.clean')}</Prose>
				</div>
			) : (
				<div className="mt-5">
					<DataGrid
						caption={t('priority.caption')}
						minWidth="420px"
						columns={[
							{ key: 'button', label: t('priority.columns.button') },
							{ key: 'count', label: t('priority.columns.count'), align: 'right', width: '140px' },
						]}
						rows={rows}
						empty={t('priority.noRows')}
					/>
				</div>
			)}

			<div className="mt-4 flex flex-col gap-2.5">
				<Note>{t('priority.scope')}</Note>
				{/* The measurement's own limit, beside every number it produced. A reader cannot weigh a
				    "you passed this over" without knowing the bar behind it was reconstructed. */}
				<Note>{t('priority.reconstructed')}</Note>
			</div>
		</Section>
	);
}
