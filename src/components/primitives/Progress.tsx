import { Progress as BaseProgress } from '@base-ui/react/progress';

/**
 * The event fetch is several round trips and can run for seconds, so it gets a real bar rather than
 * a spinner: the page must never look like it has stopped.
 *
 * Base UI owns the accessibility of it — `role="progressbar"`, the min/max/now triple, the clamp on
 * a value outside the range, and the `aria-valuetext` a screen reader actually reads out. The label
 * is a live region on top of that, because the useful part is which of the several round trips is
 * in flight, and that is text rather than a number.
 */
export default function Progress({ pct, label }: { pct: number; label: string }) {
	return (
		<BaseProgress.Root value={pct} className="flex flex-col gap-2">
			<BaseProgress.Label aria-live="polite" className="block font-mono text-sm text-ink-2">
				{label}
			</BaseProgress.Label>
			<BaseProgress.Track className="h-1.5 w-full overflow-hidden rounded-sm bg-track">
				<BaseProgress.Indicator className="rounded-sm bg-kick transition-[width] duration-300" />
			</BaseProgress.Track>
		</BaseProgress.Root>
	);
}
