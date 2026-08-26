import { useReportCopy } from '~/hooks/useReportCopy';
import type { Analysis } from '~/lib/types';

import { LanesTimeline } from '~/components/charts';
import { Prose, Section } from '~/components/primitives';

/**
 * The pull at a glance: every aura the player carried and every press, on one clock.
 *
 * A wrapper and nothing else. It holds no threshold, prints no figure and reaches no finding — the
 * chart is the evidence the rest of the page argues from, and every heading below it is an argument
 * about some slice of what is drawn here.
 *
 * **Shared, because two specs had written the same file.** The Elemental's copy and Protection's were
 * identical but for which intent string they printed: same imports, same markup, same `Section` id,
 * same `LanesTimeline`. `intentKey` is the only thing that ever differed, so it is the only thing this
 * takes.
 *
 * **`LanesTimeline` and not a chart of any spec's own, which is what makes one shared wrapper
 * possible at all.** That component already reads `spec.timelineRowOrder` and `spec.summaryLaneKeys`
 * off the registry, so each spec's chart differs by what it declared rather than by what it drew.
 *
 * The Windwalker keeps its own `FightTimeline` and is deliberately not folded in here: that is a
 * four-track chart with monk spell ids written into it, and neither other spec has an analogue of any
 * of the four. A shared wrapper is right for components that differ by a string; it is the wrong
 * answer for one that differs by its whole subject.
 */
export default function PullTimeline({ analysis, intentKey }: { analysis: Analysis; intentKey: string }) {
	const { t } = useReportCopy(analysis);

	return (
		<Section id="timeline" title={t('timeline.title')}>
			<Prose>{t(intentKey)}</Prose>

			<div className="mt-5">
				<LanesTimeline analysis={analysis} />
			</div>
		</Section>
	);
}
