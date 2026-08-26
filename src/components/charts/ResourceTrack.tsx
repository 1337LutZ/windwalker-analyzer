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

/**
 * A smooth path through the points, without inventing a value outside them.
 *
 * Monotone cubic rather than a plain Catmull-Rom or a fixed-tension spline, and the difference
 * matters here: an ordinary spline overshoots on a sharp turn, and this bar has a hard ceiling and a
 * hard floor. A curve that bulges past a reading would draw 104 energy, which is not a quantity
 * anyone had and is exactly the sort of invented number the rest of this report refuses. Monotone
 * tangents cannot overshoot — between two readings the curve stays between their values.
 *
 * What it *does* soften is the drop at a spend. Energy falls instantly when a button is pressed and
 * the curve rounds that corner over the neighbouring samples, so a press reads as a steep slope
 * rather than a cliff. That is a real distortion and it is why this is opt-in: it suits energy, which
 * genuinely refills continuously and is sampled several times a global, and it is wrong for anything
 * counted in whole units.
 */
function smoothPath(pts: ReadonlyArray<readonly [number, number]>): string {
	if (pts.length < 3)
		return pts.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${px.toFixed(2)} ${py.toFixed(2)}`).join('');

	// Secant slopes between neighbours, then tangents clamped so no segment turns back on itself.
	const slope: number[] = [];
	for (let i = 0; i < pts.length - 1; i += 1) {
		const a = pts[i];
		const b = pts[i + 1];
		if (a === undefined || b === undefined) continue;
		const run = b[0] - a[0];
		slope.push(run === 0 ? 0 : (b[1] - a[1]) / run);
	}

	const tangent: number[] = [slope[0] ?? 0];
	for (let i = 1; i < slope.length; i += 1) {
		const prev = slope[i - 1] ?? 0;
		const next = slope[i] ?? 0;
		// A sign change is a peak or a trough — a reading the curve must pass through flat, or it would
		// sail past it.
		tangent.push(prev * next <= 0 ? 0 : (prev + next) / 2);
	}
	tangent.push(slope[slope.length - 1] ?? 0);

	// Fritsch–Carlson: pull any tangent back inside three times its secant, which is the condition that
	// makes the segment monotone and therefore incapable of overshooting.
	for (let i = 0; i < slope.length; i += 1) {
		const sec = slope[i] ?? 0;
		if (sec === 0) {
			tangent[i] = 0;
			tangent[i + 1] = 0;
			continue;
		}
		const a = (tangent[i] ?? 0) / sec;
		const b = (tangent[i + 1] ?? 0) / sec;
		const scale = Math.hypot(a, b);
		if (scale > 3) {
			tangent[i] = (3 / scale) * a * sec;
			tangent[i + 1] = (3 / scale) * b * sec;
		}
	}

	const first = pts[0];
	if (first === undefined) return '';
	let d = `M${first[0].toFixed(2)} ${first[1].toFixed(2)}`;
	for (let i = 0; i < pts.length - 1; i += 1) {
		const a = pts[i];
		const b = pts[i + 1];
		if (a === undefined || b === undefined) continue;
		const run = (b[0] - a[0]) / 3;
		d += `C${(a[0] + run).toFixed(2)} ${(a[1] + (tangent[i] ?? 0) * run).toFixed(2)},`;
		d += `${(b[0] - run).toFixed(2)} ${(b[1] - (tangent[i + 1] ?? 0) * run).toFixed(2)},`;
		d += `${b[0].toFixed(2)} ${b[1].toFixed(2)}`;
	}
	return d;
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
	smooth = false,
	minLabelGapMs = 0,
	showStepLabels = true,
	labelDecreases = false,
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
	 * Round the corners between readings, for a bar that really is continuous.
	 *
	 * Energy only. It refills on a clock and is sampled several times a global, so the straight
	 * segments between readings are the artefact and the curve is closer to what happened. Never for
	 * `steps`: a resource counted in whole units has no in-between to smooth.
	 */
	smooth?: boolean;
	/**
	 * Nearest two step labels may be, in fight time.
	 *
	 * Whether two numbers collide is a question about pixels, and this component is deliberately
	 * proportional — it has no idea how wide it will be drawn. So the caller, which owns the zoom,
	 * converts a comfortable pixel gap into milliseconds and passes it down. Zero labels everything,
	 * which is right for a bar that changes a handful of times.
	 */
	minLabelGapMs?: number;
	/**
	 * Whether to draw the value at each step on the floor of the row.
	 *
	 * True for a bar the reader counts — chi, the brew bank. False for one whose steps are noise and
	 * whose moments of interest are already marked another way, so the auto-labels would just be a
	 * run of numbers beside the mark that matters.
	 */
	showStepLabels?: boolean;
	/**
	 * Label only the decreases, with the level that was *unloaded* rather than the one that remained.
	 *
	 * For a counter the player spends — Lightning Shield, unloaded whole by Earth Shock. The gains are
	 * noise; the spends are the moments worth a number, and that number is what the spend threw away.
	 */
	labelDecreases?: boolean;
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
		if (labelDecreases === true) {
			// Only the spends, labelled with the level they unloaded. A decrease means a spend for a
			// counter the player cashes in whole, so the label is the level *before* the drop — the count
			// the spend threw away — placed at the moment the drop happened.
			for (let i = 1; i < points.length; i += 1) {
				const prev = points[i - 1];
				const cur = points[i];
				if (prev === undefined || cur === undefined || cur[1] >= prev[1]) continue;
				steps.push([cur[0], prev[1]]);
			}
		} else {
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
	}
	// Built once as points so a smooth path and a straight one read the same data.
	const xy = points.map(([t, amount]): [number, number] => [x(t), y(amount)]);
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
			: smooth
				? smoothPath(xy)
				: xy.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${px.toFixed(2)} ${py.toFixed(2)}`).join('');
	// Closed back along the baseline, so the area under the curve can be washed in without a second
	// pass over the points.
	const first = points[0];
	const last = points[points.length - 1];
	const area =
		first === undefined || last === undefined
			? ''
			: `${line}L${x(last[0]).toFixed(2)} ${HEIGHT}L${x(first[0]).toFixed(2)} ${HEIGHT}Z`;

	/**
	 * The ceiling, when it moves, as a step path across the whole width.
	 *
	 * Drawn as steps whatever `mode` the bar itself uses, because a ceiling does not ramp: a buff
	 * lands and the limit is higher from that instant. Interpolating between two ceilings would draw a
	 * slope no reader could point at a cause for.
	 *
	 * It runs to the end of the pull rather than to the last reading, since the last ceiling holds
	 * until the pull stops whether or not anything was sampled under it.
	 */
	const ceilingPath =
		curve.ceiling === undefined || curve.ceiling.length === 0
			? ''
			: curve.ceiling
					.map(([t, level], i) =>
						i === 0 ? `M${x(t).toFixed(2)} ${y(level).toFixed(2)}` : `H${x(t).toFixed(2)}V${y(level).toFixed(2)}`,
					)
					.join('') + `H${x(span).toFixed(2)}`;

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
				{area === '' ? null : <path d={area} fill={fill} stroke="none" />}
				{/* Shades above the area, not behind it.
				    
				    Painted behind, every band was seen *through* the resource's own wash, so the same class
				    produced a different colour on every chart: a red band under energy's teal read as a
				    murky slate, under the bank's violet as a dull plum, and the three stacked under the
				    Energizing Brew bar were barely there at all. Checking the class was not enough to catch
				    that — the token was identical in all four; what differed was the 18% laid over it.
				    
				    The area fill is decoration under the line. A band marks the thing the chart is arguing
				    about, so it goes on top and keeps its own colour, and consistency stops depending on
				    what each chart happens to wash itself in. */}
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
				{/* `non-scaling-stroke` keeps the line a hairline however wide the chart is stretched —
			    without it the horizontal squash would thin it and the vertical stretch would fatten it. */}
				{/* The ceiling above the line rather than under it, and dashed so it cannot be mistaken for a
				    second reading. It is a limit the pull was measured against, not a thing that was
				    measured — see `ResourceCurve.ceiling` for the one bar that has a moving one. */}
				{ceilingPath === '' ? null : (
					<path
						d={ceilingPath}
						fill="none"
						stroke={stroke}
						strokeWidth={1}
						strokeDasharray="4 3"
						strokeOpacity={0.55}
						vectorEffect="non-scaling-stroke"
					/>
				)}
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
			{mode === 'steps' && showStepLabels
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
