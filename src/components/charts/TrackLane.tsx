import { useEffect, useRef } from 'react';

import { readTheme, tip } from './apex';
import ScrollableTrack from './ScrollableTrack';
import { EXEMPT_KIND, laneFill, type LaneTone, type Tone } from './tones';

/** One thing a lane draws, in the order it takes precedence. Same shape a row took. */
export interface LaneSource {
	/** What this stretch is, in the key and as the title line of its tooltip. */
	label: string;
	tone: LaneTone;
	windows: ReadonlyArray<readonly [number, number]>;
	/** The tooltip's length row: "held for", "without it for", "for". */
	lengthLabel: string;
}

/**
 * Which of the chart theme's colours tints a tooltip's title line for a given lane tone.
 *
 * `tip()` takes a `keyof ChartTheme`, and the three exempt kinds are not in it — they are a ramp this
 * module owns rather than chart-theme entries. They all resolve to `track`, which is the theme's own
 * exempt colour: the title line says *which* kind in words, and tinting three greys three ways in a
 * tooltip would be re-encoding in colour what the sentence beside it already says.
 */
const tipTone = (tone: LaneTone): Tone => (tone in EXEMPT_KIND ? 'track' : (tone as Tone));

/** One bar: a stretch of the pull, resolved to exactly one source. */
export interface LaneBar {
	startMs: number;
	endMs: number;
	source: number;
}

/**
 * The sources flattened to one line, first one wins where two claim the same millisecond.
 *
 * Exported for the test rather than for a second caller: the flattening is the whole of what this
 * component decides, and asserting it through rendered markup would be asserting Tailwind. Precedence
 * is argument order, which is what lets a caller put "the thing was up but unmeasured" ahead of the
 * grounds it sits inside and have it paint over them — the one overlap these charts actually contain.
 */
export function laneBars(sources: readonly LaneSource[], durationMs: number): LaneBar[] {
	const bars: LaneBar[] = [];
	const claimed: Array<[number, number]> = [];

	const free = (start: number, end: number): Array<[number, number]> => {
		let pieces: Array<[number, number]> = [[start, end]];
		for (const [cs, ce] of claimed) {
			const next: Array<[number, number]> = [];
			for (const [ps, pe] of pieces) {
				if (ce <= ps || cs >= pe) {
					next.push([ps, pe]);
					continue;
				}
				if (cs > ps) next.push([ps, cs]);
				if (ce < pe) next.push([ce, pe]);
			}
			pieces = next;
		}
		return pieces.filter(([s, e]) => e > s);
	};

	sources.forEach((source, index) => {
		for (const [start, end] of source.windows) {
			const within = Math.min(end, durationMs);
			if (within <= start) continue;
			for (const [s, e] of free(start, within)) {
				bars.push({ startMs: s, endMs: e, source: index });
				claimed.push([s, e]);
			}
		}
	});

	return bars.sort((a, b) => a.startMs - b.startMs);
}

/**
 * A track chart's rows merged into one line, in the order the pull happened.
 *
 * **What this replaces and why.** `WindowTracks` gives every source its own row, which groups a
 * source's stretches together and costs the reader adjacency: on `cleave` the Flame Shock chart drew
 * seven rows, so a drop and the add wave that excused it sat on different lines a column apart and the
 * reader had to scan down to see they were the same moment. One line puts them next to each other,
 * which is the question a reader actually brings to an uptime chart, and takes 252px back to 36.
 *
 * **It is only usable where the sources tile the pull**, and that is a fact about the data rather than
 * a style choice. `FlameShockUptime` and `SearingTotemUptime` both do — measured on all four Elemental
 * fixtures, their up, down and exempt rows sum to the pull to the millisecond, and their
 * unmeasured-but-up row sits entirely inside the exempt grounds, so lifting it out and painting it over
 * them loses no time. `DebuffTimeline` does *not* on a captured fixture: its pre-contact-scoping
 * fallback derives the down track from drop durations rather than as a complement, so the three
 * sources leave gaps. It keeps its rows until those captures are re-taken.
 * `StormlashTotems` and `SpiritLanes` never will — their rows are *instances* that genuinely overlap in
 * time, which is a thing one line cannot say at all.
 *
 * **The colours are the reason this needed a palette change.** Three of Flame Shock's rows were one
 * grey, told apart by their labels, and a lane has no labels. `EXEMPT_KIND` in `./tones` is that
 * distinction moved into the colour, and its docblock carries which step goes where and the red one of
 * them has to stay clear of.
 *
 * **`ScrollableTrack` is inside this component rather than around it, and that is the fix for a real
 * omission.** The first draft handed the caller a bare line: no clock under it, no zoom, no drag — while
 * every other timeline in the report has all three, `WindowTracks` included, so replacing rows with a
 * lane silently took them away. Wrapping here rather than at the call site means a chart cannot adopt a
 * lane and forget them, which is exactly what happened when it could.
 */
export default function TrackLane({
	sources,
	durationMs,
	label,
}: {
	sources: readonly LaneSource[];
	durationMs: number;
	label: string;
}) {
	const bars = laneBars(sources, durationMs);
	const total = Math.max(1, durationMs);
	const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
	const clock = (ms: number) =>
		`${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}`;

	/**
	 * One tooltip for the whole lane, moved to the pointer and filled from a hit test.
	 *
	 * The same construction `CastTimeline` uses and for the same reasons, which is the point of copying
	 * it rather than designing a second one: exactly one node however many bars there are, each bar
	 * carrying its content in `data-*` attributes rather than in an element, `elementsFromPoint` at the
	 * cursor saying which bar to read, and the markup coming from `tip()` so this is the tooltip the
	 * ApexCharts charts already draw rather than a second design of one.
	 *
	 * Imperative and outside React's render: a pointer move is not a state change worth reconciling a
	 * few hundred bars for, and the content is rebuilt only when the bar under the cursor changes.
	 *
	 * The hovered bar's `title` is lifted off while the styled tip covers it and put straight back on the
	 * way out. The attribute stays as the fallback for a reader whose pointer never fires — a keyboard,
	 * a screen reader, a touch device — but left in place the browser raises its own tooltip on top of
	 * this one, which is the two-tooltip problem `CastTimeline` had first.
	 */
	const laneRef = useRef<HTMLDivElement>(null);
	const tipRef = useRef<HTMLDivElement>(null);
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
				node.innerHTML = tip(theme, {
					title: bar.getAttribute('data-tip') ?? '',
					tone: (bar.getAttribute('data-tip-tone') ?? 'track') as Tone,
					rows: [
						[bar.getAttribute('data-len-label') ?? '', bar.getAttribute('data-len') ?? ''],
						[bar.getAttribute('data-from-label') ?? '', bar.getAttribute('data-from') ?? ''],
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
	}, [bars.length, sources]);

	return (
		<>
			<ScrollableTrack durationMs={durationMs}>
				<div ref={laneRef} className="flex h-9 w-full gap-px" role="img" aria-label={label}>
					{bars.map((bar) => {
						const source = sources[bar.source];
						if (source === undefined) return null;
						const length = seconds(bar.endMs - bar.startMs);
						return (
							<div
								key={`${bar.startMs}-${bar.source}`}
								style={{ width: `${((bar.endMs - bar.startMs) / total) * 100}%` }}
								// The fallback tooltip, and what the styled one is built from. Both are here rather
								// than one being derived from the other, so a reader who never sees the styled tip is
								// told the same thing rather than a shorter version of it.
								title={`${source.label}\n${source.lengthLabel} ${length}`}
								data-tip={source.label}
								data-tip-tone={tipTone(source.tone)}
								data-len-label={source.lengthLabel}
								data-len={length}
								data-from-label="from"
								data-from={clock(bar.startMs)}
								// `min-w-px` rather than a widening floor: a sliver here is a clock boundary rather
								// than a stretch, and `WindowTracks` widens one only because a row's own bars are all
								// it has to show. A lane is continuous, so a bar too small to see costs a reader
								// nothing — its neighbours already tell them what that instant was.
								className={`min-w-px first:rounded-l-sm last:rounded-r-sm ${laneFill(source.tone)}`}
							/>
						);
					})}
				</div>
			</ScrollableTrack>
			{/* Fixed, above the chart's own stacking, and hidden until a pointer finds a bar. */}
			<div ref={tipRef} className="pointer-events-none fixed z-50 hidden" role="presentation" />
		</>
	);
}
