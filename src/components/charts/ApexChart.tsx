import { useEffect, useRef, useState } from 'react';
import type ApexChartsInstance from 'apexcharts';
import type { ApexOptions } from 'apexcharts';

import type { ChartTheme } from './apex';
import { COARSE_POINTER_QUERY, NARROW_QUERY, REDUCED_MOTION_QUERY, readTheme, trackCursor } from './apex';

/**
 * Everything the caller needs to know about the machine it is drawing on. Passed in rather than
 * read inside each chart so the whole app touches `window` in exactly one place.
 */
export interface ChartEnv {
	theme: ChartTheme;
	/** Phone-width. Charts drop tick counts, shrink labels and open on a shorter window. */
	narrow: boolean;
	/** False when the reader asked for reduced motion; every chart animation is then off. */
	animate: boolean;
	/** True on a touch device. Decides whether a drag pans or draws a zoom selection. */
	touch: boolean;
}

const matches = (query: string): boolean => window.matchMedia(query).matches;

/**
 * Mounts an ApexCharts instance into a div React never puts children into.
 *
 * ApexCharts reads `window` as soon as it is imported, and this site is prerendered to static
 * files, so the import has to happen inside the effect — during the build there is no window and
 * this component is nothing but a sized box. That box is also what the reader sees for the frame or
 * two before the library arrives, which is why it has a real height: a chart that pops in from zero
 * shifts everything under it.
 */
export default function ApexChart({
	build,
	height,
	label,
}: {
	/** Called with the live environment; must return a complete ApexCharts option object. */
	build: (env: ChartEnv) => ApexOptions;
	height: number;
	/** Describes the chart for a reader who cannot see it — the canvas itself is not readable. */
	label: string;
}) {
	const host = useRef<HTMLDivElement>(null);
	const [ready, setReady] = useState(false);

	useEffect(() => {
		const element = host.current;
		if (element === null) return;

		let chart: ApexChartsInstance | null = null;
		let untrack: (() => void) | null = null;
		let dropped = false;

		const narrowQuery = window.matchMedia(NARROW_QUERY);

		const draw = async () => {
			const { default: ApexCharts } = await import('apexcharts');
			// The reader may have navigated away, or crossed the breakpoint again, while the library
			// was in flight; either way this instance is already stale.
			if (dropped) return;
			chart = new ApexCharts(
				element,
				build({
					theme: readTheme(),
					narrow: narrowQuery.matches,
					animate: !matches(REDUCED_MOTION_QUERY),
					touch: matches(COARSE_POINTER_QUERY),
				}),
			);
			await chart.render();
			if (dropped) return;
			untrack = trackCursor(element);
			setReady(true);
		};

		void draw();

		// Crossing the breakpoint changes the tick counts and the opening zoom window, neither of
		// which ApexCharts can recompute on its own — so the chart is rebuilt rather than resized.
		const rebuild = () => {
			untrack?.();
			untrack = null;
			chart?.destroy();
			chart = null;
			setReady(false);
			void draw();
		};
		narrowQuery.addEventListener('change', rebuild);

		return () => {
			dropped = true;
			narrowQuery.removeEventListener('change', rebuild);
			untrack?.();
			chart?.destroy();
		};
	}, [build]);

	return (
		<div className="relative w-full" style={{ height }} role="img" aria-label={label}>
			<div ref={host} className="h-full w-full" />
			{ready ? null : (
				<div
					className="absolute inset-0 grid place-items-center rounded-sm border border-line bg-surface font-mono text-sm tracking-[0.1em] uppercase text-muted"
					aria-hidden="true"
				>
					Drawing chart
				</div>
			)}
		</div>
	);
}
