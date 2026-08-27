import { useReportCopy } from '~/hooks/useReportCopy';
import type { Analysis } from '~/lib/types';
import { ROTATION_FLOW } from '~/specs/protection/lib/view/rotationFlow';

import { Note, Prose, Section } from '~/components/primitives';
import { FlowChart } from '~/components/rotation';

/**
 * What the legend prints above this chart, in order.
 *
 * The shortest of the three. This list has no fork in it and no band across its line, so naming either
 * would send a reader looking for a mark the chart never draws; what it does have is chips, on the six
 * rungs a pack decides and the six a talent gives you. See `FlowChart`'s `legend` prop.
 */
const LEGEND = ['rotation.flow.legend.spine', 'rotation.flow.legend.chip'];

/**
 * The Protection priority list itself: what to press, in what order, and what each rung is there to
 * prevent.
 *
 * The one section on this page that grades nothing. Everything above it says what happened in the four
 * minutes; this says what those four minutes were being measured against, so a reader told they passed
 * a button over has somewhere to go and read what that button was for. It sits directly under the
 * priority ladder for that reason, and the pair is the point: the ladder says what the list wanted at
 * each of your globals, and this is the list.
 *
 * ## Why this spec had none until now
 *
 * The port shipped nine shared sections and three of its own, and a rotation reference was in neither
 * group — the Windwalker drew a flowchart out of components filed under itself, and the Elemental drew
 * a column of cards it had hand-rolled, so there was nothing a third spec could reach for. Promoting
 * the chart to `components/rotation` is what made this section a `FlowSlot[]` and a legend rather than
 * a fourth drawing.
 *
 * ## The one thing a reader has to be told before the list makes sense
 *
 * **Both holy power spenders are off the global cooldown.** `sim/paladin/protection/shield_of_the_righteous.go`
 * declares its cast with no GCD at all, and `word_of_glory.go` zeroes the GCD for this spec, so neither
 * Shield of the Righteous nor Eternal Flame costs a press this list arbitrates. That is why every rung
 * below is a generator, why nothing here reads the holy power bar, and why a reader scanning for their
 * spenders will not find them. It is `rotation.protEconomy`'s whole subject, and it is put above the
 * chart rather than in a note under it because a list of seventeen buttons with the two most-pressed
 * ones missing is a list that reads as broken until the sentence arrives.
 */
export default function Rotation({ analysis }: { analysis: Analysis }) {
	const { t } = useReportCopy(analysis);

	return (
		<Section id="rotation" title={t('rotation.title')}>
			<div className="flex flex-col gap-3.5">
				<Prose>{t('rotation.intent')}</Prose>
				<Prose>{t('rotation.protEconomy')}</Prose>
			</div>

			<h3 className="m-0 mt-7 mb-3 font-mono text-sm font-semibold tracking-[0.1em] uppercase text-muted">
				{t('rotation.flow.title')}
			</h3>

			<FlowChart flow={ROTATION_FLOW} legend={LEGEND} details />

			{/* The four things a rung cannot carry: where the spenders went, which two rungs the pack moves,
			    the clause Hammer of Wrath's own spell holds rather than its rule, and which of these buttons
			    a reader may simply not have. Separate notes rather than a closing paragraph, because a
			    reader checking one should not have to read past three.

			    `counts` follows `spenders` because they are the two halves of the same surprise: a list this
			    long with the two most-pressed buttons off it, and a list this long that still is not the
			    same list at one enemy and at three. */}
			<div className="mt-6 flex flex-col gap-2.5">
				<Note>{t('rotation.notes.spenders')}</Note>
				<Note>{t('rotation.notes.counts')}</Note>
				<Note>{t('rotation.notes.execute')}</Note>
				<Note>{t('rotation.notes.protTalents')}</Note>
			</div>
		</Section>
	);
}
