import { useReportCopy } from '~/hooks/useReportCopy';
import type { Analysis } from '~/lib/types';

import { FightTimeline } from '../charts';
import { Prose, Section } from '../primitives';

/**
 * Every mechanic on one clock, so the lining-up can be read off the shape before the numbers.
 *
 * A wrapper, so it carries no verdict — the chart is the evidence the graded sections argue from.
 * Whether the debuff track is named for a boss or for whatever else was being hit is a wording
 * choice, so it goes through i18next's context rather than a ternary over two English strings.
 */
export default function PullTimeline({ analysis }: { analysis: Analysis }) {
	const { t } = useReportCopy(analysis);
	const target = t('timeline.target', {
		context: analysis.primaryTarget.gameID ? 'boss' : undefined,
	});

	return (
		<Section id="timeline" title={t('timeline.title')}>
			<Prose>{t('timeline.intent', { target })}</Prose>
			{/* No cast-count gate here. The chart plots procs, brew windows, debuff windows and channels —
			    none of which are casts — so testing `casts.length` could refuse to draw a timeline that had
			    four populated tracks. `FightTimeline` counts its own rows and shows its own empty state,
			    which is the only check that knows what is actually on the chart. */}
			<div className="mt-5">
				<FightTimeline analysis={analysis} />
			</div>
		</Section>
	);
}
