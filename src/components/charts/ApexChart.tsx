import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type ApexChartsInstance from 'apexcharts';
import type { ApexOptions } from 'apexcharts';

import '~/lib/i18n';

import { Skeleton } from '../primitives';
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
 * The bars the placeholder draws, as widths of the box they sit in.
 *
 * Long to short but with one step out of order, because a cleanly descending stack reads as
 * decoration and a ragged one reads as data — which is the whole job of this box: it stands in for a
 * chart, not for a form. Written out as literal class names because Tailwind emits only the values
 * it can find in the source, so an interpolated `w-[${n}%]` would generate nothing at all.
 */
const PLACEHOLDER_BARS = ['w-[86%]', 'w-[64%]', 'w-[73%]', 'w-[41%]', 'w-[27%]'];

/**
 * What fills the reserved box until ApexCharts has drawn into it.
 *
 * One animated element for the whole placeholder, not one per bar: a page carrying eight charts
 * resolves them at eight different moments, and eight independently breathing boxes is the slot
 * machine this replaces. `motion-safe:` is the guard rather than the blanket reduced-motion rule in
 * global.css — that rule collapses a running animation to nothing, whereas the honest answer to
 * "less motion" is not to start one.
 *
 * `overflow-hidden` because the same placeholder serves a 90px bar chart and a 400px timeline; on
 * the shortest of them the stack is clipped evenly top and bottom rather than bursting the box that
 * was reserved to stop the page moving.
 */
function ChartPlaceholder({ caption }: { caption: string }) {
	return (
		<div
			aria-hidden="true"
			className="absolute inset-0 flex flex-col justify-center gap-2.5 overflow-hidden rounded-sm border border-line bg-surface px-4 py-4 motion-safe:animate-pulse"
		>
			{PLACEHOLDER_BARS.map((width) => (
				<Skeleton key={width} className={`h-2 ${width}`} />
			))}
			<span className="mt-2 font-mono text-sm tracking-[0.1em] uppercase text-muted">{caption}</span>
		</div>
	);
}

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
	// The placeholder's caption is app-shell copy rather than anything the analysis says, so it comes
	// from the `ui` namespace — the same place the step titles and the settings dialog read from.
	const { t } = useTranslation('ui');
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
		<div
			className="relative w-full"
			style={{ height }}
			// Both only once there is a picture to describe. An undrawn chart announcing its own summary
			// is describing something that is not on the page, and a `role="img"` with nothing in it is a
			// placeholder claiming to be content — so until the draw lands this box is silent, and the
			// state it is in is announced once for the whole page by the fetch progress bar instead.
			role={ready ? 'img' : undefined}
			aria-label={ready ? label : undefined}
		>
			<div ref={host} className="h-full w-full" />
			{ready ? null : <ChartPlaceholder caption={t('chart.drawing')} />}
		</div>
	);
}
