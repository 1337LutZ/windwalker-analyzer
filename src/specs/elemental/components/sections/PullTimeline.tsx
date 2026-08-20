import { useReportCopy } from '~/hooks/useReportCopy';
import type { Analysis } from '~/lib/types';

import { LanesTimeline } from '~/components/charts';
import { Prose, Section } from '~/components/primitives';

/**
 * The pull at a glance: the Lightning Shield counter and the handful of auras that actually turned
 * the rotation on, all on one clock.
 *
 * A wrapper, so it carries no verdict — the chart is the evidence the graded sections argue from.
 * The Elemental's summary is deliberately narrow: the two cooldowns, the shield the shocks spend,
 * the dot, the fire-and-forget totem, and the two-piece.
 */
export default function PullTimeline({ analysis }: { analysis: Analysis }) {
	const { t } = useReportCopy(analysis);

	return (
		<Section id="timeline" title={t('timeline.title')}>
			<Prose>{t('timeline.eleIntent')}</Prose>

			<div className="mt-5">
				<LanesTimeline analysis={analysis} />
			</div>
		</Section>
	);
}
