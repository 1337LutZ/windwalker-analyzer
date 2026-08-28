import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { FightSegment } from '~/lib/analysis/segments';
import type { Analysis } from '~/lib/types';

import ChartKey from '../charts/ChartKey';
import FightReplay from './FightReplay';
import { KEY_ORDER, segmentLabel, segmentLength, shortOf } from './segmentCopy';
import ScrollableTrack from '../charts/ScrollableTrack';
import SegmentLane, { type LaneSpan } from '../charts/SegmentLane';
import { ChartFigure } from '../primitives';

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

	/**
	 * A pull with one stretch draws no chart — and still opens the replay.
	 *
	 * The lane is what goes: one bar spanning one lane is a whole-pull reading the headline already
	 * made, which is the argument the docstring above sets out and it has not changed. What did change
	 * is that this section became the way in to the pull's geometry, and a fight that held one rotation
	 * throughout is not a fight with nothing to look at — Iron Juggernaut and Malkorok are the two
	 * Windwalker pulls this hits, and both are worth seeing walked.
	 *
	 * So the heading and the button survive the refusal and the chart does not. `FightReplay` draws
	 * nothing of its own when the analysis carried no track, so a pull with one stretch *and* no
	 * positions still renders nothing at all rather than a bare heading.
	 */
	if (segments === undefined || segments.length < 2) {
		if (analysis.replay === undefined) return null;
		return (
			<div className="flex flex-col gap-3.5">
				<h3 className="m-0 font-mono text-sm font-semibold tracking-[0.14em] text-muted uppercase">
					{t('summary.shape.title')}
				</h3>
				<p className="m-0 max-w-[66ch] leading-relaxed text-muted">{t('summary.shape.oneStretch')}</p>
				<FightReplay analysis={analysis} />
			</div>
		);
	}

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

export { KEY_ORDER, segmentLabel, segmentLength, shortOf };
