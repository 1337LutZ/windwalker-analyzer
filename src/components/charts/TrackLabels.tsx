import { useEffect, useRef, useState } from 'react';

import { SpellIcon } from '../primitives';

export interface Track {
	/** The spell whose icon stands for this row. */
	iconId: number;
	label: string;
}

/**
 * The row labels for a timeline chart, drawn as HTML over the space the chart reserved for them.
 *
 * ApexCharts draws axis labels as SVG `<text>`, which cannot hold an image — so to put a spell icon
 * beside each track name the labels have to leave the chart entirely. The chart hides its own y-axis
 * labels and reserves the column through `grid.padding.left`; this sits in that column.
 *
 * The alignment is **measured, not calculated**. Where the plot area actually starts depends on the
 * x-axis label height, the toolbar and the viewport, and a hard-coded offset would drift the moment
 * any of those changed — silently, into labels that name the wrong row, which is worse than no
 * labels at all. Reading the rendered grid's own box cannot drift: it is the thing being aligned to.
 */
export default function TrackLabels({ tracks, width }: { tracks: Track[]; width: number }) {
	const host = useRef<HTMLDivElement>(null);
	const [band, setBand] = useState<{ top: number; height: number } | null>(null);

	useEffect(() => {
		const element = host.current?.parentElement;
		if (!element || tracks.length === 0) return;

		const measure = () => {
			// The grid rect is the plot area proper — inside the axes, excluding the label gutter.
			const grid = element.querySelector('.apexcharts-grid');
			const outer = element.getBoundingClientRect();
			if (grid === null || outer.height === 0) return;
			const rect = grid.getBoundingClientRect();
			const next = { top: rect.top - outer.top, height: rect.height };
			// Only when it actually moved, and this guard is load-bearing rather than an optimisation.
			// These labels render *inside* the element being observed, so setting state unconditionally
			// meant every measurement mutated the subtree, which re-fired the observer, which measured
			// again — a render loop that locked the tab solid. A fresh object is never `===` to the last
			// one, so React could not break the cycle either; comparing the numbers is what breaks it.
			setBand((current) =>
				current !== null &&
				Math.abs(current.top - next.top) < 0.5 &&
				Math.abs(current.height - next.height) < 0.5
					? current
					: next,
			);
		};

		measure();
		// The chart mounts asynchronously and re-renders on resize and on crossing the narrow
		// breakpoint. Watching the subtree catches the mount; watching the box catches the rest.
		const mutations = new MutationObserver(measure);
		mutations.observe(element, { childList: true, subtree: true });
		const resize = new ResizeObserver(measure);
		resize.observe(element);
		return () => {
			mutations.disconnect();
			resize.disconnect();
		};
	}, [tracks.length]);

	// Hidden until measured, so labels never flash in the wrong place on the way to the right one.
	if (band === null) return <div ref={host} className="hidden" />;

	return (
		<div
			ref={host}
			aria-hidden="true"
			className="pointer-events-none absolute left-0 flex flex-col"
			style={{ top: band.top, height: band.height, width }}
		>
			{tracks.map((track) => (
				<div key={track.label} className="flex flex-1 items-center gap-2 pr-2">
					<SpellIcon id={track.iconId} size="sm" />
					<span className="truncate font-mono text-sm text-ink-2">{track.label}</span>
				</div>
			))}
		</div>
	);
}
