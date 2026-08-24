import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { SegmentMode } from '~/lib/analysis/segments';
import type { Analysis } from '~/lib/types';

import ChartKey from '../charts/ChartKey';
import ScrollableTrack from '../charts/ScrollableTrack';
import SegmentLane, { type LaneSpan } from '../charts/SegmentLane';
import { ChartFigure } from '../primitives';

/** What goes inside a bar wide enough to hold it. Never the only thing that says which mode it is. */
const SHORT: Record<SegmentMode, string> = {
	single: '1',
	cleave: '2',
	aoe: '3+',
	mixed: '~',
	idle: '—',
};

/**
 * The order the key names the modes in, and the only place that order is decided.
 *
 * Ascending by how many enemies were up, with the two that are not counts at the foot. That is the
 * order the ramp itself rises in, so the key reads as the scale it is describing rather than as the
 * order this pull happened to meet them.
 */
const KEY_ORDER: readonly SegmentMode[] = ['single', 'cleave', 'aoe', 'mixed', 'idle'];

/**
 * The pull cut into the stretches it was actually fought in, drawn once across the top of the report.
 *
 * A pull is not one shape. Galakras alternates add waves and boss-alone phases for seven minutes, and
 * Immerseus spends more than a third of itself with nothing up at all — and until this row the reader
 * was shown a single word for the whole of it. `analysis.segments` is that reading; this draws it.
 *
 * **It carries a count and a duration, and nothing else — no letter, no colour that means good or bad.**
 * Per-stretch scoring does not exist, and a chart that looked like it was grading would be inventing an
 * answer the analysis has not computed. The colours here mean a *quantity* and nothing else: `COUNT` in
 * `charts/tones.ts` is a ramp of one hue rising with the enemy count, kept apart from the four mechanic
 * tones precisely so that no bar on this lane can be read as a verdict.
 *
 * **One lane, not one row per mode.** It was five rows, on the argument that a single lane would have to
 * carry the mode in its hue and this report's hues are named for mechanics — `brew` is Tigereye Brew on
 * every other chart — so spending them on "two enemies" would give one colour two meanings. The premise
 * was right and the conclusion did not follow: what the argument ruled out was reusing *those* colours,
 * not having a lane. A ramp of its own answers it, and the lane buys back the thing five rows cost —
 * the order the pull happened in, which is what a reader opens a timeline for. `SegmentLane` carries
 * the rest of that argument, including why the count is written on the bars as well as coloured.
 *
 * **Hidden entirely when the pull has one stretch**, which is a whole-pull reading and already the
 * headline: one bar spanning one lane tells a reader nothing they did not have. Measured across the
 * fourteen Siege bosses that is Iron Juggernaut and Malkorok for the Windwalker, so it draws on twelve
 * of fourteen.
 *
 * `segments` is optional because every captured fixture predates it, so the absent case is the ordinary
 * one rather than a defensive check.
 */
export default function SegmentStrip({ analysis }: { analysis: Analysis }) {
	const { t } = useTranslation('report');
	const segments = analysis.segments?.segments;

	const spans = useMemo(
		(): LaneSpan[] =>
			(segments ?? []).map((segment) => ({
				startMs: segment.startMs,
				endMs: segment.endMs,
				tone: segment.mode,
				label: t('summary.shape.row', { context: segment.mode }),
				lengthLabel: t('summary.shape.length', { seconds: Math.round((segment.endMs - segment.startMs) / 1000) }),
				short: SHORT[segment.mode],
			})),
		[segments, t],
	);

	if (segments === undefined || segments.length < 2) return null;

	/**
	 * Only the modes this pull actually held.
	 *
	 * The same rule the exempt key follows on every other chart: a swatch for a bar the reader cannot
	 * find is a swatch they will go looking for. A pull that never left one enemy and a pull that never
	 * stopped moving get different keys, and both of them get true ones.
	 */
	const present = KEY_ORDER.filter((mode) => segments.some((segment) => segment.mode === mode));

	return (
		<div className="flex flex-col gap-3.5">
			<h3 className="m-0 font-mono text-sm font-semibold tracking-[0.14em] uppercase text-muted">
				{t('summary.shape.title')}
			</h3>
			<ChartFigure
				gap="wide"
				caption={present.map((mode) => (
					<ChartKey key={mode} count tone={mode}>
						{t('summary.shape.row', { context: mode })}
					</ChartKey>
				))}
				note={t('summary.shape.note')}
			>
				<ScrollableTrack durationMs={analysis.durationMs}>
					<SegmentLane spans={spans} durationMs={analysis.durationMs} label={t('summary.shape.chartLabel')} />
				</ScrollableTrack>
			</ChartFigure>
		</div>
	);
}
