import { COUNT, type CountTone } from './tones';

/** One stretch of the pull: where it sat, what it was, and what to call it. */
export interface LaneSpan {
	startMs: number;
	endMs: number;
	tone: CountTone;
	/** The row's name — "Two enemies" — used in the bar and as the first line of its tooltip. */
	label: string;
	/** The bar's own length, already formatted. The tooltip's second line. */
	lengthLabel: string;
	/** What goes inside the bar when it is wide enough: "1", "2", "3+". Never the only thing said. */
	short: string;
	/**
	 * A third tooltip line, when the caller has something to add — the enemies a stretch was spent on.
	 *
	 * Optional, and absent on the report page: the strip there answers "what shape was this pull", and a
	 * roster of enemy names is a different question that would make every bar's tooltip longer to no end.
	 * The segment tool asks that question directly, so it fills this in.
	 */
	detail?: string;
}

/**
 * The pull as one lane of coloured bars, in the container every other timeline in this report uses.
 *
 * **One lane and not one row per mode**, which is what this replaced. A row per mode grouped the
 * stretches — four separate `cleave` bars lined up on one row, so a reader could see at a glance that
 * the pull kept coming back to two enemies — and cost the thing a reader actually reads a timeline for,
 * which is the order the pull happened in. Five rows also spend five of the report's colours, and this
 * report has four, each named for a mechanic: see `COUNT` in `./tones` for why the ramp is its own
 * table rather than `brew` pressed into meaning "two enemies".
 *
 * **The colour is never the only thing carrying the count.** Every bar wide enough holds its own count
 * as text, every bar carries its name in a tooltip whatever its width, and the key under the chart
 * names each tone that was drawn. A reader who cannot separate the two middle steps of a violet ramp
 * loses nothing, which is the condition for a ramp being usable at all here.
 *
 * Plain positioned blocks rather than the hand-drawn SVG `ResourceTrack` uses: that component draws a
 * *curve*, which needs a path, and this draws rectangles that tile a line. `ScrollableTrack` sets the
 * width and supplies the clock underneath, so percentages are all this has to compute.
 */
export default function SegmentLane({
	spans,
	durationMs,
	label,
}: {
	spans: readonly LaneSpan[];
	durationMs: number;
	label: string;
}) {
	const total = Math.max(1, durationMs);

	return (
		<div className="flex h-9 w-full gap-px" role="img" aria-label={label}>
			{spans.map((span) => {
				const width = ((span.endMs - span.startMs) / total) * 100;
				const { fill, ink } = COUNT[span.tone];
				return (
					<div
						key={span.startMs}
						style={{ width: `${width}%` }}
						title={[span.label, span.lengthLabel, span.detail].filter(Boolean).join('\n')}
						className={`relative flex min-w-px items-center justify-center overflow-hidden first:rounded-l-sm last:rounded-r-sm ${fill}`}
					>
						{/* The one mode that is not a step on the ramp gets a texture rather than a step, so it cannot
						    be read as a count sitting between two others — see `COUNT`. Its own element rather than a
						    second background class on the bar: `background-image` and `background-color` set through
						    two utilities resolve by stylesheet order, not by the order they were concatenated in, so
						    a hatch written that way is one Tailwind release away from replacing the colour it was
						    meant to sit on. `styles/global.css` owns the pattern for the same reason the tones do. */}
						{span.tone !== 'mixed' ? null : <span className="hatch-mixed absolute inset-0" aria-hidden="true" />}
						{/* Roughly the width two characters need before they start clipping. Below it the bar says
						    nothing and the tooltip says everything, which is the same trade every other track in
						    this report makes for a span too short to letter. */}
						{width < 4 ? null : (
							// `relative`, so it stacks above the hatch: an absolutely-positioned sibling paints over
							// static content whatever the source order.
							<span className={`relative font-mono text-sm font-semibold tabular ${ink}`}>{span.short}</span>
						)}
					</div>
				);
			})}
		</div>
	);
}
