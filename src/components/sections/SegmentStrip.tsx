import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { FightSegment, SegmentMode } from '~/lib/analysis/segments';
import type { Analysis } from '~/lib/types';

import ChartKey from '../charts/ChartKey';
import FightReplay from './FightReplay';
import { segmentLabel, segmentLength } from './segmentCopy';
import ScrollableTrack from '../charts/ScrollableTrack';
import SegmentLane, { type LaneSpan } from '../charts/SegmentLane';
import { ChartFigure } from '../primitives';

/**
 * What goes inside a bar wide enough to hold it. Never the only thing that says which mode it is.
 *
 * `mixed` is absent on purpose: a bare `~` says only "it moved", which is the one thing the bar's own
 * hatch already says, and it left the longest stretch of some pulls as the least informative bar on
 * the chart — a reader looking at 86 seconds of Garrosh was told nothing about what was in it.
 * `shortOf` fills it from the segment's own median instead.
 */
const SHORT: Record<Exclude<SegmentMode, 'mixed'>, string> = {
	single: '1',
	cleave: '2',
	aoe: '3+',
	idle: '—',
};

/**
 * The count to write on a bar, which for a mixed stretch is the middle of what it held.
 *
 * `~2` reads as "about two, and it moved", which is both halves of what `mixed` means and is what the
 * segment already measured — `medianEnemies` is the median over the stretch's own clock. A count of
 * three or more takes the same `3+` the aoe bars use, so the two are read off one scale.
 */
function shortOf(segment: { mode: SegmentMode; medianEnemies: number }): string {
	if (segment.mode !== 'mixed') return SHORT[segment.mode];
	const median = Math.round(segment.medianEnemies);
	return median >= 3 ? '~3+' : `~${Math.max(1, median)}`;
}

/**
 * The order the key names the modes in, and the only place that order is decided.
 *
 * Ascending by how many enemies were up, with the two that are not counts at the foot. That is the
 * order the ramp itself rises in, so the key reads as the scale it is describing rather than as the
 * order this pull happened to meet them.
 */
/**
 * The order the modes are named in, rising with the count and ending on the two that are not counts.
 *
 * Exported so the segment tool's summary tiles run in the same order as this chart's key. A reader
 * comparing the two should not have to re-find `aoe` in a different place.
 */
export const KEY_ORDER: readonly SegmentMode[] = ['single', 'cleave', 'aoe', 'mixed', 'idle'];

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
export default function SegmentStrip({
	analysis,
	detailOf,
}: {
	analysis: Analysis;
	/**
	 * A third tooltip line per segment, when a caller has one.
	 *
	 * Optional so the report page is untouched — see `LaneSpan.detail`. The strip cannot compute this
	 * itself: which enemies a stretch was spent on is not on `Analysis`, and the caller that knows is the
	 * one still holding the dataset the analysis came from.
	 */
	detailOf?: (segment: FightSegment) => string | null | undefined;
}) {
	const { t } = useTranslation('report');
	const segments = analysis.segments?.segments;

	const spans = useMemo(
		(): LaneSpan[] =>
			(segments ?? []).map((segment) => ({
				startMs: segment.startMs,
				endMs: segment.endMs,
				tone: segment.mode,
				label: segmentLabel(segment, t),
				lengthLabel: segmentLength(segment, t),
				short: shortOf(segment),
				...(detailOf?.(segment) ? { detail: detailOf(segment) as string } : {}),
			})),
		[segments, t, detailOf],
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
			{/* Under the note, not up beside the heading.
			    The note is what tells a reader the grey is time they landed nothing in and that none of it
			    counts against them — which is the sentence that raises "so where *was* I", and the replay is
			    the answer to it. A button on the heading is offered before the chart has said anything worth
			    asking about; here it sits where the question forms.

			    `FightReplay` draws nothing when the analysis carried no track, so a pull fetched before
			    positions were read ends on the note rather than on a button that opens an empty dialog. */}
			<FightReplay analysis={analysis} />
		</div>
	);
}

export { segmentLabel, segmentLength };
