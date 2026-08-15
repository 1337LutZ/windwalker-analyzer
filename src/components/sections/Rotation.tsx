import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import type { Analysis, TargetMode } from '~/lib/types';
import { bandForMode } from '~/lib/view/targetMode';
import { CROSSOVERS, flowKeys, pressedButtons, rotationFlow } from '~/lib/view/rotationFlow';

import { Note, Prose, Section } from '../primitives';
import { FlowChart } from '../rotation';

/**
 * The rotation itself: what to press, in what order, what decides each fork, and what every
 * condition is there to prevent.
 *
 * The one section on the page that grades nothing. Every other section says what happened in this
 * pull; this one says what the pull was being measured against, so a reader who has just been told
 * their Tigereye Brew averaged six stacks has somewhere to go and find out what ten would have taken.
 *
 * It sits second to last, above the method and below everything that judges the pull, because it is
 * reference rather than argument.
 *
 * ## It is a reference, and it is still not the same list for everyone
 *
 * It used to render identically for every log, and that was two separate lies. It listed the rungs
 * the priority list only reaches from two enemies up to a reader on a single-target kill, where they
 * cannot fire; and it listed talents as buttons to press at a reader who did not bring them. Both are
 * now filtered, and neither filter is this component's decision — the bands come off `LADDER` through
 * `lib/view/rotationFlow`, and the talent evidence is the mutual exclusion the sim declares.
 *
 * ## The rungs are a drawing, and the paragraphs are still there
 *
 * A fallthrough chain is a graph and it is now drawn as one — `components/rotation/FlowChart` — which
 * is a reversal of what this file used to argue, so both halves are worth writing down.
 *
 * What was right in the old argument was the obstacle: every rung carries two paragraphs, the
 * condition the list tests and what that condition is protecting, and they average 282 characters
 * together and reach 528 on the Tigereye Brew branches. Nothing that holds 282 characters is a node.
 * What was wrong was the conclusion drawn from it — that the chain therefore has to be a column of
 * cards. The paragraphs do not have to be *in* the node. Each rung now carries a one-line `test`
 * beside its `when` and `why`, the box holds that, and the two paragraphs move a keypress away into a
 * disclosure the box owns. Nothing was cut; `FlowNode` documents the trade in full.
 *
 * The mechanical half of the old note survives intact and is why the chart is borders rather than
 * SVG: `charts/ResourceTrack.tsx` records that under `preserveAspectRatio="none"` an SVG `<text>`
 * stretches with its box, and `docs/conventions.md` forbids column labels in SVG text outright
 * because they render at 6px on a phone. A line is a border, and a border stays attached to a box
 * that has just wrapped to six lines at 360px — which a viewBox could only do by measuring every
 * node's height after layout on every resize, and which is precisely what a graph-layout dependency
 * would have signed this section up for.
 */
export default function Rotation({ analysis, mode }: { analysis: Analysis; mode?: TargetMode | null }) {
	const { t } = useReportCopy(analysis);

	/**
	 * The rungs this reader's list actually has.
	 *
	 * `mode` is threaded from the control at the top of the report rather than read off the detection
	 * here, so the reference agrees with the verdicts above it even when the reader has overridden what
	 * the counts said — and `bandForMode` is the same mapping `PriorityLadder` judges through, which is
	 * what makes "agrees" a fact rather than a hope. Undefined `mode` (an older report, a fixture) is
	 * null and shows every band, because no basis to choose is not a reason to choose.
	 */
	const pressed = useMemo(() => pressedButtons(analysis.casts), [analysis.casts]);
	const flow = useMemo(() => rotationFlow({ band: bandForMode(mode ?? null), pressed }), [pressed, mode]);

	/**
	 * The same list with no reading applied, which is what the index of crossovers is measured against.
	 *
	 * Same talent evidence, so the denominator is this reader's list rather than an abstract nineteen —
	 * a monk the log proves took Rushing Jade Wind has no Spinning Crane Kick rungs at any count, and
	 * counting them would print a total they can never reach.
	 */
	const unfiltered = useMemo(() => rotationFlow({ band: null, pressed }), [pressed]);
	const drawn = useMemo(() => new Set(flowKeys(flow)), [flow]);

	return (
		<Section id="rotation" title={t('rotation.title')}>
			<div className="flex flex-col gap-3.5">
				<Prose>{t('rotation.intent')}</Prose>
				<Prose>{t('rotation.economy')}</Prose>
			</div>

			<h3 className="m-0 mt-7 mb-3 font-mono text-sm font-semibold tracking-[0.1em] uppercase text-muted">
				{t('rotation.flow.title')}
			</h3>
			<Prose>{t('rotation.flow.intent')}</Prose>
			{/* The four target counts collected above the chart rather than only as chips inside it. They
			    are the answer to the question a reader arrives with — at how many does the button change
			    — and nineteen rungs is too far to scan for "three" when the list has already been read
			    once. They stay unfiltered when the chart is not: a reader whose list has just lost a rung
			    needs the count that would bring it back, and that is the one thing a filtered index
			    could not tell them.

			    Unfiltered is not the same as unqualified, and that distinction is a bug fix. Read at
			    three enemies, `4+ · Crane Kick over Rising Sun Kick` named a rung the reading had taken
			    off the page, and the reader went looking for something that was not there. So each chip
			    asks the drawn chart whether its rung survived and says so when it did not — in words,
			    with a dashed edge behind them, never in colour alone. */}
			<div className="mt-3.5">
				<h4 className="m-0 mb-1.5 font-mono text-sm font-semibold tracking-[0.1em] uppercase text-muted">
					{t('rotation.crossover.title')}
				</h4>
				<p className="m-0 flex flex-wrap gap-1.5">
					{CROSSOVERS.map(({ copy, key }) =>
						drawn.has(key) ? (
							<span
								key={copy}
								className="inline-block rounded-sm border border-line bg-surface px-2 py-[3px] font-mono text-sm font-medium tracking-[0.06em] text-ink-2"
							>
								{t(`rotation.crossover.${copy}`)}
							</span>
						) : (
							<span
								key={copy}
								className="inline-block rounded-sm border border-dashed border-line bg-bg px-2 py-[3px] font-mono text-sm font-medium tracking-[0.06em] text-muted"
							>
								{t(`rotation.crossover.${copy}`)} · {t('rotation.crossover.outside')}
							</span>
						),
					)}
				</p>
			</div>

			{/* Said here rather than left to the control at the top of the page, on the same argument
			    `PriorityLadder` makes: by the time a reader has scrolled this far the toggle is off
			    screen, and a list with rungs missing from it is worse than useless without the sentence
			    saying which ones and why. The count beside it is the shortest version of the same fact,
			    and it is the number that visibly moves when the control does. */}
			<div className="mt-3.5 flex flex-col gap-2">
				<Note>{t('rotation.flow.count', { count: flow.length, total: unfiltered.length })}</Note>
				{mode === undefined || mode === null ? null : (
					<Note>{t(mode === 'single' ? 'rotation.flow.reading_single' : 'rotation.flow.reading_multi')}</Note>
				)}
			</div>

			<FlowChart flow={flow} />

			{/* The seven things a rung cannot carry: why the brew is spent where it is, why the channel
			    needs three conditions, why the same wind is on the list twice, why one kick matters to
			    everyone, which talents the list assumes, on what evidence a rung is left out, and one
			    correction the spec's own name invites. Separate notes rather than a closing paragraph,
			    because a reader checking one should not have to read past six.

			    `jadeWind` follows `channel` because they are the two ends of one fact: the Fists of Fury
			    rule is the only place in the whole list where the wind's energy cost is weighed against
			    anything, and a reader who has just read why the channel has three conditions is holding
			    the half of it that makes the other half mean something. */}
			<div className="mt-6 flex flex-col gap-2.5">
				<Note>{t('rotation.notes.snapshot')}</Note>
				<Note>{t('rotation.notes.channel')}</Note>
				<Note>{t('rotation.notes.jadeWind')}</Note>
				<Note>{t('rotation.notes.debuff')}</Note>
				<Note>{t('rotation.notes.talents')}</Note>
				<Note>{t('rotation.notes.inferred')}</Note>
				<Note>{t('rotation.notes.mastery')}</Note>
			</div>
		</Section>
	);
}
