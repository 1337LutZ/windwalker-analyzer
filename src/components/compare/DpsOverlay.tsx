import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Side } from '~/lib/compare';

import PullKey from './PullKey';

import { fmt } from '~/components/format';
import { ChartFigure } from '~/components/primitives';
import { smoothPath } from '~/components/charts/ResourceTrack';
import ChartEmpty from '~/components/charts/ChartEmpty';

import { WINDOW_SEC, ceilingOf, type DpsSeries } from '~/components/charts/dpsCurve';
import SegmentLane, { type LaneSpan } from '~/components/charts/SegmentLane';

/** Tall enough to read a shape off, and the same per-mille geometry the resource bars use. */
const HEIGHT = 120;
const SPAN = 1000;

/** How many horizontal rules to draw, the value axis included at nought. */
const RULES = 4;

/** One side of the overlay: its curve, the stretches it was fought in, and who it belongs to. */
export interface OverlayPull {
	series: DpsSeries | null;
	spans: readonly LaneSpan[];
	name: string;
}

/** The gutter the value labels sit in, so the lanes, the curve and the clock all share one width. */
const GUTTER = 'pr-9';

/**
 * Both pulls' damage on one clock, drawn by hand rather than by ApexCharts.
 *
 * ## Why this is a custom chart
 *
 * `conventions.md` sends charts to ApexCharts and forbids hand-built SVG, and this is a stated
 * exception rather than an oversight, and the rule now names it. Two reasons, and the second is the one
 * that matters.
 *
 * It is the shape the reader asked for: the resource bars are the house style for a curve over the
 * pull, and this is that picture with a second line on it.
 *
 * And **the smoothing is not decoration here.** `smoothPath` is a monotone cubic, which cannot
 * overshoot: between two readings the curve stays between their values. Apex's `smooth` is an
 * ordinary spline and will dip below a trough. On a quiet stretch after a burst that draws negative
 * damage per second, a quantity nobody had, and the fix is to clamp the axis and hope. The report
 * already refuses invented numbers everywhere else; borrowing the geometry the energy bar uses gets
 * the same guarantee for free.
 *
 * ## Why a timeline is compared at all, on a page that says it does not
 *
 * That rule is still right about what it was written for: a cast log from two pulls of different
 * length shares no moment, so drawing them together invites a reader to line up two things that never
 * lined up. A rate over time is not that. Each curve describes its own pull alone, how hard it was
 * hitting at each moment of *itself*, so two of them compare shapes rather than instants: the
 * opener, the trough where a phase took the boss away, the ramp at the end.
 *
 * **Absolute seconds, and the shorter line simply stops.** Normalising both to 0–100% would align the
 * shapes neatly and invent the thing the rule refuses: "halfway through" is not a shared moment, and
 * two pulls three minutes apart would be drawn as one fight at two speeds. Where a line ends is a
 * real fact about the pair, and the comparability note above already names a duration mismatch.
 *
 * ## The analysis mode
 *
 * The curve follows it, because the series does: under `parsing` the damage a ranking strikes off is
 * absent from the total and from the curve alike. No damage figure in this report was mode-aware
 * until the struck filter reached `aggregateDamage`.
 *
 * ## Drawing notes
 *
 * The `viewBox` is per-mille of the pull by height with `preserveAspectRatio="none"`, which is what
 * lets one path scale to any width without being rebuilt: the same trick `ResourceTrack` uses, and
 * with the same consequence: every label is HTML positioned by percentage, because an SVG `<text>`
 * inside a stretched viewBox is stretched with it and a two-digit number comes out smeared.
 *
 * Colour is never the only channel. The second pull is dashed as well as differently hued, which is
 * the same belt-and-braces `PullKey` applies by drawing the first mark filled and the second a ring.
 */
export default function DpsOverlay({ a, b }: { a: OverlayPull; b: OverlayPull }) {
	const { t } = useTranslation('report');
	/**
	 * Which pull the pointer is on, or none.
	 *
	 * One piece of state for both halves of the figure, which is the point: hovering a lane fades the
	 * *other* pull's curve as well as its lane, so the two rows and the two lines read as two pulls
	 * rather than as four things. Null on leave, so nothing is emphasised until something is asked for.
	 */
	const [focus, setFocus] = useState<Side | null>(null);
	/** Faded when the pointer is on the other pull, and never when it is on neither. */
	const dimmed = (side: Side) => (focus !== null && focus !== side ? 'opacity-25' : 'opacity-100');
	const left = a.series;
	const right = b.series;
	if (left === null || right === null) return <ChartEmpty>{t('compare.dps.empty')}</ChartEmpty>;

	const span = Math.max(left.durationMs, right.durationMs, 1);
	const peak = Math.max(0, ...left.points.map((p) => p.y), ...right.points.map((p) => p.y));
	const ceiling = ceilingOf(peak);

	const path = (series: DpsSeries): string =>
		smoothPath(series.points.map(({ x, y }): [number, number] => [(x / span) * SPAN, HEIGHT - (y / ceiling) * HEIGHT]));

	// Nought is drawn as the axis itself rather than as a rule, so the lowest line is the baseline the
	// curves sit on instead of a stripe floating under them.
	const rules = Array.from({ length: RULES }, (_, i) => ((i + 1) / RULES) * ceiling);
	const ticks = Array.from({ length: 5 }, (_, i) => (i / 4) * span);

	return (
		<ChartFigure gap="wide" caption={t('compare.dps.caption', { window: WINDOW_SEC })}>
			{/*
			 * The stretches sit **above** the plot and are drawn on the *shared* span rather than on each
			 * pull's own duration, which is the whole of what makes them line up: a lane scaled to its own
			 * four minutes under a curve scaled to the other pull's nine would put a phase change under the
			 * wrong second of the line it is meant to explain. The shorter pull's lane therefore stops
			 * early, exactly where its curve does.
			 */}
			<div className={`${GUTTER} flex flex-col gap-1`}>
				{[[a, 'a'] as const, [b, 'b'] as const].map(([pull, side]) =>
					pull.spans.length === 0 ? null : (
						<div
							key={side}
							className={`relative transition-opacity duration-150 ${dimmed(side)}`}
							onPointerEnter={() => setFocus(side)}
							onPointerLeave={() => setFocus(null)}
						>
							<SegmentLane
								spans={pull.spans}
								durationMs={span}
								label={t('compare.dps.segments', { player: pull.name })}
							/>
							{/*
							 * The identity mark, laid **over** the lane rather than beside it.
							 *
							 * Beside it, the mark and its gap came out of the lane's own width, so the lanes were a
							 * dozen pixels narrower than the plot under them and every segment boundary sat left of
							 * the second it belonged to, which is the one thing these lanes exist to get right.
							 * Overlapping costs the first moments of the first stretch, which is a stretch label
							 * nobody reads, and buys back the alignment.
							 *
							 * No name on it: the names are the legend under the plot, and putting them here too is
							 * the same word four times on one figure. The screen-reader text stays, because a mark
							 * that means "this row is Player A" has to say so to a reader who cannot see the hue.
							 */}
							{/*
							 * A plain `title` rather than the report's own tooltip card, and the reason is ownership
							 * rather than taste. The styled tip on these lanes is `SegmentLane`'s: a `pointermove`
							 * listener on *its* root that hit-tests for `[data-tip]`. This mark is a sibling of that
							 * root, not a descendant, so the listener never sees it, and making it one would mean
							 * reaching into another component's pointer machinery to add a label that is one word.
							 *
							 * It also has to take pointer events to be hoverable at all, which costs the segment
							 * tooltip the ten pixels the mark covers. That is the right trade: a reader pointing at
							 * the mark is asking whose row this is, not how long the first stretch was.
							 */}
							<span title={pull.name} className="absolute top-1/2 left-1 z-10 -translate-y-1/2">
								<PullKey side={side} outlined>
									<span className="sr-only">{pull.name}</span>
								</PullKey>
							</span>
						</div>
					),
				)}
			</div>

			<div className="relative mt-1">
				{/* The value rules, as HTML so their labels are not stretched by the viewBox. Each stops at
				    the gutter the label sits in, so a rule never runs under its own number. */}
				{rules.map((value) => (
					<div
						key={value}
						className="pointer-events-none absolute right-9 left-0 flex items-center"
						style={{ top: `${(1 - value / ceiling) * 100}%` }}
					>
						<span className="h-px flex-1 bg-line" />
						<span className="tabular absolute right-0 translate-x-full pl-2 font-mono text-[11px] text-muted">
							{Math.round(value / 1000)}k
						</span>
					</div>
				))}
				{/*
				 * `relative` with no z-index of its own, which is enough: the rules above are absolutely
				 * positioned and would otherwise paint over the curves: a positioned element beats a static
				 * one whatever the source order. A rule crossing a line is meant to be read *under* it, the
				 * way graph paper sits under a plot.
				 */}
				<div className={`relative ${GUTTER}`}>
					<svg
						viewBox={`0 0 ${SPAN} ${HEIGHT}`}
						preserveAspectRatio="none"
						className="block h-[120px] w-full"
						role="img"
						aria-label={t('compare.dps.label', { a: a.name, b: b.name })}
					>
						{/* `non-scaling-stroke` so a 2px line stays 2px however far the viewBox is stretched. */}
						{[
							[right, 'b', 'var(--color-pull-b)', '5 4'] as const,
							[left, 'a', 'var(--color-pull-a)', undefined] as const,
						].map(([series, side, stroke, dash]) => (
							<g key={side} className={`transition-opacity duration-150 ${dimmed(side)}`}>
								<path
									d={path(series)}
									fill="none"
									stroke={stroke}
									strokeWidth={2}
									strokeDasharray={dash}
									vectorEffect="non-scaling-stroke"
								/>
								{/*
								 * A wide invisible copy of the same path, purely to be hovered.
								 *
								 * A two-pixel line is a two-pixel hit target, and on a dashed one the gaps are misses
								 * too, and asking a reader to land on that is asking them not to use the feature. The
								 * stroke is transparent rather than a low opacity so it can never be seen, and
								 * `pointerEvents="stroke"` keeps the fill from swallowing hovers over the whole area
								 * under the curve, which would make the two lines fight for the pointer.
								 */}
								<path
									d={path(series)}
									fill="none"
									stroke="transparent"
									strokeWidth={14}
									vectorEffect="non-scaling-stroke"
									pointerEvents="stroke"
									onPointerEnter={() => setFocus(side)}
									onPointerLeave={() => setFocus(null)}
								/>
							</g>
						))}
					</svg>
				</div>
			</div>

			<div className={`${GUTTER} mt-1 flex justify-between`}>
				{ticks.map((at) => (
					<span key={at} className="tabular font-mono text-[11px] text-muted">
						{fmt(at)}
					</span>
				))}
			</div>

			{/*
			 * The legend, under the plot and naming the two pulls once.
			 *
			 * The swatch is a real line in the curve's own stroke and dash rather than a filled chip,
			 * because the thing that tells the two curves apart *is* the dash. A solid block in the right
			 * hue would name the colour and leave the reader to guess which line was which on a greyscale
			 * screen. It is the same reasoning `PullKey` uses in drawing one mark filled and the other a
			 * ring, applied to the channel this chart actually varies.
			 */}
			<ul className="m-0 mt-3 flex list-none flex-wrap gap-x-5 gap-y-1 p-0">
				{[
					[a.name, 'a', 'var(--color-pull-a)', undefined] as const,
					[b.name, 'b', 'var(--color-pull-b)', '5 4'] as const,
				].map(([name, side, stroke, dash]) => (
					<li
						key={name}
						className={`flex items-center gap-2 text-sm text-ink-2 transition-opacity duration-150 ${dimmed(side)}`}
						onPointerEnter={() => setFocus(side)}
						onPointerLeave={() => setFocus(null)}
					>
						<svg aria-hidden="true" viewBox="0 0 24 2" className="h-0.5 w-6 shrink-0 overflow-visible">
							<path d="M0 1H24" fill="none" stroke={stroke} strokeWidth={2} strokeDasharray={dash} />
						</svg>
						{name}
					</li>
				))}
			</ul>
		</ChartFigure>
	);
}
