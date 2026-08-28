import { useEffect, useRef } from 'react';

import { readTheme, tip } from './apex';
import { COUNT, type CountTone } from './tones';
import type { Tone } from './tones';

/**
 * Which of the chart theme's colours tints the tooltip's title line.
 *
 * The count ramp is three steps of one violet and the theme has no entry for it, so the ramp reads as
 * `rune` — the violet the rest of the report already spends on procs — and `idle` reads as `track`, the
 * grey every chart uses for time it left out of its figures. The tint is never the only thing saying
 * which mode a bar is: the title line above it names it in words.
 */
const tipTone = (tone: CountTone): Tone => (tone === 'idle' ? 'track' : 'rune');

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
	const laneRef = useRef<HTMLDivElement>(null);
	const tipRef = useRef<HTMLDivElement>(null);

	/**
	 * The styled tooltip, hit-tested off the pointer — the same mechanism `TrackLane` uses, and now for
	 * the same reason.
	 *
	 * **A `title` attribute was not enough.** The browser's own tooltip waits about a second, cannot be
	 * styled, never opens on keyboard focus and does not exist on a touch screen — and on a bar a few
	 * pixels wide it is easy to cross without ever triggering. Every other chart in this report raises its
	 * own; this one was the outlier, which is why its tooltip read as broken next to theirs.
	 *
	 * The `title` stays as the fallback and is lifted off the bar while the styled tip is up, or the
	 * browser raises its own on top — the two-tooltip problem `TrackLane`'s comment names.
	 */
	useEffect(() => {
		const lane = laneRef.current;
		const node = tipRef.current;
		if (lane === null || node === null) return;
		const theme = readTheme();
		let over: { bar: Element; title: string } | null = null;
		const hide = () => {
			if (over !== null) over.bar.setAttribute('title', over.title);
			over = null;
			node.style.display = 'none';
		};
		const move = (event: PointerEvent) => {
			const bar = document
				.elementsFromPoint(event.clientX, event.clientY)
				.find((el): el is Element => el.hasAttribute('data-tip'));
			if (bar === undefined) {
				hide();
				return;
			}
			if (over?.bar !== bar) {
				if (over !== null) over.bar.setAttribute('title', over.title);
				// One row per target rather than one row of targets. A dozen names run together wrap into a
				// paragraph the eye has to parse; a column of them is a list, which is what it is. The label
				// rides the first row only, so the rest read as continuations of it rather than as new facts.
				const detail = (bar.getAttribute('data-detail') ?? '').split('\n').filter(Boolean);
				const detailLabel = bar.getAttribute('data-detail-label') ?? '';
				node.innerHTML = tip(theme, {
					title: bar.getAttribute('data-tip') ?? '',
					tone: (bar.getAttribute('data-tip-tone') ?? 'track') as Tone,
					rows: [
						[bar.getAttribute('data-len-label') ?? '', bar.getAttribute('data-len') ?? ''],
						...detail.map((name, i): [string, string] => [i === 0 ? detailLabel : '', name]),
					],
				});
				over = { bar, title: bar.getAttribute('title') ?? '' };
				bar.removeAttribute('title');
				node.style.display = 'block';
			}
			// Below and right of the cursor, folded back inside the viewport at either edge. Measured after
			// the content is written, so this is the size the tip will actually have.
			const x = Math.min(event.clientX + 14, window.innerWidth - node.offsetWidth - 14);
			const y = Math.min(event.clientY + 14, window.innerHeight - node.offsetHeight - 14);
			node.style.left = `${Math.max(14, x)}px`;
			node.style.top = `${Math.max(14, y)}px`;
		};
		hide();
		lane.addEventListener('pointermove', move);
		lane.addEventListener('pointerleave', hide);
		return () => {
			lane.removeEventListener('pointermove', move);
			lane.removeEventListener('pointerleave', hide);
			hide();
		};
		/**
		 * **Mounted once, and depending on the spans would be a bug rather than a nicety.**
		 *
		 * Everything the handler needs it reads off the DOM at pointer time — `elementsFromPoint` finds the
		 * bar, and the bar carries its own `data-*`. So new spans need no new listener. Keying this on
		 * `spans` instead tore the listener down and called `hide()` on every render, and this component
		 * re-renders on every published pull while a report is being read: the tooltip was being killed
		 * under the cursor a dozen times a run. That is why it read as not working at all.
		 */
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return (
		<>
			<div ref={laneRef} className="flex h-9 w-full gap-px" role="img" aria-label={label}>
				{spans.map((span) => {
					const width = ((span.endMs - span.startMs) / total) * 100;
					const { fill, ink } = COUNT[span.tone];
					return (
						<div
							key={span.startMs}
							style={{ width: `${width}%` }}
							// The fallback tooltip, and what the styled one is built from. Both are written rather than
							// one derived from the other, so a reader who never sees the styled tip is told the same
							// thing rather than a shorter version of it.
							title={[span.label, span.lengthLabel, span.detail].filter(Boolean).join('\n')}
							data-tip={span.label}
							data-tip-tone={tipTone(span.tone)}
							data-len-label="for"
							data-len={span.lengthLabel}
							data-detail-label="hits"
							{...(span.detail === undefined ? {} : { 'data-detail': span.detail })}
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
			{/* Fixed, above the chart's own stacking, and hidden until a pointer finds a bar. */}
			<div ref={tipRef} className="pointer-events-none fixed z-50 hidden" role="presentation" />
		</>
	);
}
