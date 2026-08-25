import { useReportCopy } from '~/hooks/useReportCopy';
import type { Analysis } from '~/lib/types';

import { LanesTimeline } from '~/components/charts';
import { Prose, Section } from '~/components/primitives';

/**
 * The pull at a glance: what the Paladin turned on, what proc'd, and which enemies carried the debuff.
 *
 * A wrapper and nothing else. It holds no threshold, prints no figure and reaches no finding — the
 * chart is the evidence the rest of the page argues from, and every heading below it is an argument
 * about some slice of what is drawn here.
 *
 * **`LanesTimeline` and not a chart of this spec's own, which is the whole reason this file is four
 * lines of markup.** That component already reads `spec.timelineRowOrder` and `spec.summaryLaneKeys`
 * off the registry, and this spec has written both in `lib/view/timelineBanks.ts` since it was ported —
 * where nothing had ever read them, because the audit published `lanes: []` and there was no section
 * to draw them in. Both ends of that seam are now joined and neither needed a line of new drawing code.
 *
 * The Windwalker's `FightTimeline` is the component *not* to copy here, and the two `PullTimeline`s are
 * separate files rather than one shared component for exactly that reason: it is a four-track chart
 * with monk spell ids written into it, and a Paladin has no analogue of any of the four.
 *
 * **What this section deliberately does not say.** The target-mode control at the head of the report
 * renders on a Protection pull and moves nothing on it — neither of this spec's two thresholds
 * declares a target count it varies with — so no copy under this heading may imply that changing the
 * reading changes what is drawn. What is drawn is the log.
 */
export default function PullTimeline({ analysis }: { analysis: Analysis }) {
	const { t } = useReportCopy(analysis);

	return (
		<Section id="timeline" title={t('timeline.title')}>
			<Prose>{t('timeline.protIntent')}</Prose>

			<div className="mt-5">
				<LanesTimeline analysis={analysis} />
			</div>
		</Section>
	);
}
