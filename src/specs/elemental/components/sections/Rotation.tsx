import { useReportCopy } from '~/hooks/useReportCopy';
import type { Analysis } from '~/lib/types';
import { ROTATION_FLOW, STAGE_BANDS } from '~/specs/elemental/lib/view/rotationFlow';

import { Note, Prose, Section } from '~/components/primitives';
import { FlowChart } from '~/components/rotation';

/**
 * What the legend prints above this chart, in order.
 *
 * Two lines rather than the Windwalker's three, and the missing one is the fork: nothing in `ROTATION`
 * is one entry the reader's build or the pack picks between, so a legend naming a dashed box would send
 * a reader looking for a mark this chart never draws. See `FlowChart`'s `legend` prop.
 */
const LEGEND = ['rotation.flow.legend.spine', 'rotation.flow.legend.stage', 'rotation.flow.legend.chip'];

/**
 * The Elemental priority list itself: what to press, in what order, and what each rule is there to
 * prevent.
 *
 * The one section on the page that grades nothing. Every other section says what happened in this
 * pull; this one says what the pull was measured against, so a reader told their Earth Shock went
 * out early has somewhere to read the rule it missed. It is the full list — the fillers the Priority
 * section walks *and* the off-GCD cooldowns between them — because a list with the cooldowns left
 * out is not the list a player follows.
 *
 * ## It is a chart now, and it is the same chart the other two specs draw
 *
 * This section used to hand-roll a column of bordered cards, which was the third answer in this
 * repository to the question of how a priority list is drawn. The chart in `components/rotation` is the
 * only answer now. What that buys here is the structure a column of cards has no way to show: each rung
 * as the decision it is, with the condition on one side, an edge labelled **yes**, and the button that
 * answer presses on the other.
 *
 * **The three stages survive the move intact**, because they are real structure rather than a way of
 * breaking up a long column. `FlowChart` draws each of them as a band across the line, which is the
 * same mark the Windwalker's target-count crossovers use and means the same thing: everything under
 * this band, down to the next one, is one part of the list.
 *
 * **`details` is false, and that is a fact about this spec's copy rather than a lesser chart.** The
 * Windwalker's rungs carry a short condition and a paragraph behind it, some of them several hundred
 * characters, and the disclosure exists because a node cannot hold that much text. Every rule here is
 * one line and there is nothing behind it, so a **why** button would open a panel repeating the box
 * beside it. `lib/view/rotationFlow` carries the copy convention this is the other half of.
 */
export default function Rotation({ analysis }: { analysis: Analysis }) {
	const { t } = useReportCopy(analysis);

	return (
		<Section id="rotation" title={t('rotation.title')}>
			<Prose>{t('rotation.intent')}</Prose>

			<h3 className="m-0 mt-7 mb-3 font-mono text-sm font-semibold tracking-[0.1em] uppercase text-muted">
				{t('rotation.flow.title')}
			</h3>

			<FlowChart flow={ROTATION_FLOW} legend={LEGEND} details={false} crossings={STAGE_BANDS} />

			{/* The two things a rung cannot carry: that two of the buttons on this list cost no global at
			    all, and that the raid's own cooldowns are not on it. Separate notes rather than a closing
			    paragraph, because a reader checking one should not have to read past the other. */}
			<div className="mt-6 flex flex-col gap-2.5">
				<Note>{t('rotation.notes.cooldowns')}</Note>
				<Note>{t('rotation.notes.raid')}</Note>
			</div>
		</Section>
	);
}
