import type { ReactNode } from 'react';

/**
 * The tile row itself: a 1px gap over the border colour is what draws the hairlines between tiles.
 *
 * `auto-fit` rather than a fixed 2/3/6 at the breakpoints, because the count is not always six. Six
 * is what the summary card at the top has; Touch of Karma and Rising Sun Kick have four, and in a
 * row built for six that left a third of the card as empty border colour — a gap that reads as a
 * tile which failed to render rather than as a row that ended. Collapsing the empty tracks lets the
 * tiles there stretch and the row finish where its last tile does.
 *
 * The 11rem floor is what decides how many fit: six across a 1280px column, three at the small
 * breakpoint, two on a phone — the same shape the explicit breakpoints gave, now derived from the
 * space instead of asserted.
 */
export default function StatTiles({ children }: { children: ReactNode }) {
	return (
		<div className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-px overflow-hidden rounded-sm border border-line bg-line">
			{children}
		</div>
	);
}
