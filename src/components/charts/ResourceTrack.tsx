import type { ResourceCurve, Window } from '~/lib/types';

/**
 * One resource bar over the pull, drawn as a filled line, with windows shaded behind it.
 *
 * Built as SVG rather than through ApexCharts for the same reason `CastTimeline` is: everything here
 * is positioned as a proportion of the pull, so the whole chart is a handful of nodes that stretch
 * with their container instead of a library that has to be told to redraw. One `<path>` for the
 * curve, one for the fill under it, and one `<rect>` per shaded window.
 *
 * **The line is a reconstruction, not a measurement.** A log carries a reading roughly three times a
 * second — whenever an event happened to record the bar — so what is drawn between two readings is a
 * straight line and nothing more. A spike that rose and fell inside one gap is not here. The section
 * that draws this is responsible for saying so.
 */
/** A window a shade covers, optionally carrying a short note to draw inside it. */
export type ShadeWindow = Window & { text?: string };

export interface Shade {
	windows: readonly ShadeWindow[];
	className: string;
	label: string;
	/** Text colour for any note on this shade's windows — a `text-*` class, since notes are HTML. */
	textClassName?: string;
	/**
	 * Turn the note on its side.
	 *
	 * A stretch at the energy cap is usually narrower than the words describing it, so a horizontal
	 * note runs out over its neighbours and reads as belonging to the wrong band. Upright, it stays
	 * inside the band it belongs to however narrow that band is.
	 */
	upright?: boolean;
}

/** Tall enough to read a shape off, short enough to sit above a timeline without dominating it. */
const HEIGHT = 72;

export default function ResourceTrack({
	curve,
	durationMs,
	shades = [],
	stroke,
	fill,
	label,
	mode = 'line',
	minLabelGapMs = 0,
}: {
	curve: ResourceCurve;
	durationMs: number;
	shades?: readonly Shade[];
	/** Token-backed colours, passed in so one component can draw energy and chi without knowing which. */
	stroke: string;
	fill: string;
	label: string;
	/**
	 * How the bar is shaped.
	 *
	 * `line` for energy, which is a continuous pool of a hundred and genuinely does slope between two
	 * readings. `steps` for chi, which is an integer that holds four — or five with Ascension, and the
	 * ceiling comes from the log rather than from a guess about talents. Sloping between two chi
	 * readings would draw a value the resource cannot hold: a diagonal through 2.5 chi is not a
	 * quantity anyone had. A step holds its value until the next reading says otherwise, which is what
	 * actually happened.
	 */
	mode?: 'line' | 'steps';
	/**
	 * Nearest two step labels may be, in fight time.
	 *
	 * Whether two numbers collide is a question about pixels, and this component is deliberately
	 * proportional — it has no idea how wide it will be drawn. So the caller, which owns the zoom,
	 * converts a comfortable pixel gap into milliseconds and passes it down. Zero labels everything,
	 * which is right for a bar that changes a handful of times.
	 */
	minLabelGapMs?: number;
}) {
	const span = Math.max(1, durationMs);
	const max = Math.max(1, curve.max);

	// `viewBox` in per-mille of the pull by height, with `preserveAspectRatio="none"`, so every x is a
	// proportion and the chart stretches to whatever width it is given — the same trick the cast
	// timeline's gridlines use, and what keeps a zoom step from rebuilding anything.
	const x = (t: number) => (t / span) * 1000;
	const y = (amount: number) => HEIGHT - (amount / max) * HEIGHT;

	const points = curve.points;
	// One entry per *change* in value, which is what gets a label: a hundred readings all holding two
	// chi is one step, and labelling each of them would draw a hundred twos on top of each other.
	// One entry per *change* in value, then thinned to what will fit: the brew bank moves three hundred
	// times in a pull, so at the wide end of the zoom ladder every label would overlap its neighbours
	// into a grey band. Dropping the ones with no room is what keeps the rest readable.
	const steps: Array<[number, number]> = [];
	if (mode === 'steps') {
		let lastLabelled = Number.NEGATIVE_INFINITY;
		for (let i = 0; i < points.length; i += 1) {
			const point = points[i];
			if (point === undefined) continue;
			if (i > 0 && point[1] === points[i - 1]?.[1]) continue;
			if (point[0] - lastLabelled < minLabelGapMs) continue;
			steps.push(point);
			lastLabelled = point[0];
		}
	}
	const line =
		mode === 'steps'
			? // Hold the value, then jump: horizontal to the next reading's moment, vertical to its value.
				points
					.map(([t, amount], i) => {
						const prev = points[i - 1];
						const step =
							prev === undefined
								? `M${x(t).toFixed(2)} ${y(amount).toFixed(2)}`
								: `H${x(t).toFixed(2)}V${y(amount).toFixed(2)}`;
						return step;
					})
					.join('')
			: points.map(([t, amount], i) => `${i === 0 ? 'M' : 'L'}${x(t).toFixed(2)} ${y(amount).toFixed(2)}`).join('');
	// Closed back along the baseline, so the area under the curve can be washed in without a second
	// pass over the points.
	const first = points[0];
	const last = points[points.length - 1];
	const area =
		first === undefined || last === undefined
			? ''
			: `${line}L${x(last[0]).toFixed(2)} ${HEIGHT}L${x(first[0]).toFixed(2)} ${HEIGHT}Z`;

	return (
		// A positioned wrapper so labels can be HTML rather than SVG `<text>`.
		//
		// The chart is stretched horizontally by `preserveAspectRatio="none"` — that is what lets one
		// path scale to any width without being rebuilt — and a `<text>` inside it is stretched with
		// everything else, which turns a two-digit number into a smeared one. `vector-effect` rescues a
		// stroke and does nothing for a glyph. HTML positioned by percentage sits in the same places and
		// renders as type.
		<div className="relative h-[72px] w-full">
			<svg
				className="block h-full w-full"
				viewBox={`0 0 1000 ${HEIGHT}`}
				preserveAspectRatio="none"
				role="img"
				aria-label={label}
			>
				{shades.map((shade) =>
					shade.windows.map((w) => (
						<rect
							key={`${shade.label}-${w.start}-${w.end}`}
							x={x(w.start)}
							y={0}
							width={Math.max(x(w.end) - x(w.start), 0.5)}
							height={HEIGHT}
							className={shade.className}
						/>
					)),
				)}
				{area === '' ? null : <path d={area} fill={fill} stroke="none" />}
				{/* `non-scaling-stroke` keeps the line a hairline however wide the chart is stretched —
			    without it the horizontal squash would thin it and the vertical stretch would fatten it. */}
				<path d={line} fill="none" stroke={stroke} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
			</svg>

			{/* Chi that went past the top of the bar, marked where the press happened.
			    
			    Energy waste is a rate over a stretch and is shaded as a band; chi waste is a discrete
			    event — one press, one number — so it gets a tick and a figure rather than a region. */}
			{(curve.wasted ?? []).map((w) => (
				<span
					key={`over-${w.t}`}
					className="pointer-events-none absolute top-0 flex flex-col items-start"
					style={{ left: `${(w.t / span) * 100}%` }}
				>
					<span className="h-2 w-[2px] bg-miss" />
					<span className="pl-[2px] font-mono text-[10px] leading-none text-miss">+{w.wasted}</span>
				</span>
			))}

			{/* The value at each step, on the floor of the row. Only for a bar small enough to count —
			    nobody counts a hundred energy — and never for zero, which is the absence of the resource
			    rather than a quantity worth labelling. */}
			{mode === 'steps'
				? steps.map(([at, amount], i) =>
						amount === 0 ? null : (
							<span
								key={`${at}-${i}`}
								className="pointer-events-none absolute bottom-0 pl-[3px] font-mono text-[10px] leading-none text-muted"
								style={{ left: `${(at / span) * 100}%` }}
							>
								{amount}
							</span>
						),
					)
				: null}

			{/* What a shaded stretch cost, at its left edge: a band can be narrower than its own label,
			    and a centred note on a two-pixel band drifts away from the thing it describes. */}
			{shades.map((shade) =>
				shade.windows.map((w) =>
					w.text === undefined ? null : (
						<span
							key={`${shade.label}-text-${w.start}`}
							className={`pointer-events-none absolute font-mono text-[10px] leading-none whitespace-nowrap ${
								shade.upright === true ? 'top-[3px] origin-top-left rotate-90' : 'top-0 pl-[3px]'
							} ${shade.textClassName ?? 'text-muted'}`}
							// Rotated about its own top-left, so the text runs down from the top of the band and
							// its start still marks the moment the loss began.
							style={{ left: `${(w.start / span) * 100}%`, ...(shade.upright === true ? { paddingLeft: 3 } : {}) }}
						>
							{w.text}
						</span>
					),
				),
			)}
		</div>
	);
}
