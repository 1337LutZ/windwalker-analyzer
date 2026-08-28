import { useEffect, useRef, useState } from 'react';

/**
 * The height of the sticky bar a rail sits under, so a heading scrolled to is not hidden by it.
 *
 * Exported because both the margin below and any rail that offsets its own scrolling need the same
 * number, and two copies of it drift the moment the bar changes height.
 */
export const NAV_BAR_PX = 56;

/**
 * Which of a list of anchors the reader is currently looking at.
 *
 * **From an `IntersectionObserver`, never a scroll listener.** A scroll handler runs on every frame of
 * every scroll and has to measure the document to answer; an observer is told, once, when the answer
 * changes. The difference is a rail that does not stutter on a page holding a dozen charts.
 *
 * **The bottom margin is what makes the answer feel right.** Without it the highlight jumps to the next
 * anchor the instant a pixel of it appears, while the reader is still looking at the previous one. Cut to
 * the top 45% of the viewport, the highlight follows what is actually being read.
 *
 * **The topmost on screen, in the order given** — not the first the observer happened to report. Entries
 * arrive in whatever order the browser batched them, and the reader is at the highest one.
 *
 * @param ids Anchors in document order. That order is the tie-break, so it has to be the page's own.
 * @param resolve How an id becomes the element to watch. Defaults to `getElementById`. A caller whose id
 *   names a heading rather than the region around it passes its own — a heading is a few pixels tall, so
 *   a band tuned to catch one would spend most of a long section matching nothing.
 * @returns The current id, and a setter — a rail that scrolls on click answers immediately rather than
 *   waiting for a smooth scroll to arrive and the observer to notice.
 */
export function useCurrentAnchor(
	ids: readonly string[],
	resolve?: (id: string) => Element | null,
): [string | null, (id: string | null) => void] {
	const [current, setCurrent] = useState<string | null>(null);
	// Held in a ref so a caller can pass an inline arrow without memoising it: the effect below keys on
	// the ids alone, and a resolver in its dependency list would rebuild the observer on every render.
	const resolveRef = useRef(resolve);
	resolveRef.current = resolve;

	// A string rather than the array, for the same reason: a fresh array every render would rebuild the
	// observer every render. Spaces are safe as a separator — an anchor cannot contain one.
	const key = ids.join(' ');
	useEffect(() => {
		const list = key.length === 0 ? [] : key.split(' ');
		const watched = new Map<Element, string>();
		for (const id of list) {
			const node = resolveRef.current ? resolveRef.current(id) : document.getElementById(id);
			if (node) watched.set(node, id);
		}
		if (watched.size === 0) return;
		const onScreen = new Set<string>();
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					const id = watched.get(entry.target);
					if (id === undefined) continue;
					if (entry.isIntersecting) onScreen.add(id);
					else onScreen.delete(id);
				}
				const next = list.find((id) => onScreen.has(id));
				if (next !== undefined) setCurrent(next);
			},
			{ rootMargin: `-${NAV_BAR_PX}px 0px -55% 0px` },
		);
		for (const node of watched.keys()) observer.observe(node);
		return () => observer.disconnect();
	}, [key]);

	return [current, setCurrent];
}
