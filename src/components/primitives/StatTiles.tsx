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
/**
 * `strip` is the same block at the size of a label rather than a headline.
 *
 * The construction is the whole point of reusing this: one rounded border, `gap-px` over the line
 * colour, and the children clipped by it — cells that read as divisions of one thing rather than as a
 * row of separate controls. What a strip changes is only how the track is sized. The 11rem floor is
 * right for a tile carrying a 27px number and wrong for one carrying two words: five modes at 11rem
 * is 55rem and wraps onto three lines in a dialog that has the room for one.
 *
 * So `strip` lets the cells size to their own content and stay on one row where they fit. It is a
 * layout, not a second style — the border, the hairlines and the clipping are shared, which is what
 * keeps a strip from drifting away from the tiles it is a small version of.
 */
const layouts = {
	tiles: 'grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]',
	strip: 'flex flex-wrap',
};

export default function StatTiles({
	children,
	layout = 'tiles',
}: {
	children: ReactNode;
	/** `strip` for label-sized cells that hug their content — see `layouts`. */
	layout?: keyof typeof layouts;
}) {
	return (
		<div className={`${layouts[layout]} gap-px overflow-hidden rounded-sm border border-line bg-line`}>{children}</div>
	);
}
