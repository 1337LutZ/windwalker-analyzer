import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatInteger, formatPercentValue } from '~/lib/format';
import type { Analysis, TargetMode } from '~/lib/types';

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
	// `undefined` is a report captured before the ladder existed; `null` is the ladder refusing to
	// judge this pull. Two different facts, and the section says a different thing for each.
	const apl = analysis.apl;

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

	// `null` is the refusal, and it means something specific: the pull was not concentrated enough on
	// one enemy for the single-target ladder to be the right list to judge it against.
	//
	// A reader who has forced the pull to read as multi-target gets the same refusal even when the
	// engine produced an audit: they are saying the adds mattered, and the single-target ladder is
	// then the wrong list whatever the damage concentration said. The reverse does not hold — forcing
	// `single` cannot conjure an audit the engine declined to run, and inventing one here would grade
	// presses against a list nobody checked the conditions of.
	if (apl === null || mode === 'multi') {
		return (
			<Section id="priority" title={t('priority.title')}>
				<Prose>{t('priority.intent')}</Prose>
				<div className="mt-5">
					<Note>{t('priority.multiTarget')}</Note>
				</div>
			</Section>
		);
	}

	const { followed, skipped, unknown, offList } = apl;
	const judged = followed + skipped;

	return (
		<Section id="priority" title={t('priority.title')}>
			<Prose>{t('priority.intent')}</Prose>

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
