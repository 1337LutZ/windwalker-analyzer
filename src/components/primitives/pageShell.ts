/**
 * The page's horizontal shape: how wide it gets and how far it is held off the edges.
 *
 * Split out from the vertical rhythm below because two things have to agree on it and only one of
 * them is the page. `StickySelectionBar` is `fixed` and full-bleed, so it re-creates the container
 * *inside* itself to line its content up with the report beneath — which only works while the two
 * spell the same max width and the same padding at the same breakpoints. That agreement was two
 * copies of a class string in two files, and nothing would have failed if one had drifted; the bar
 * would simply have stopped lining up.
 */
export const pageWidthClass = 'mx-auto w-full max-w-[1280px] px-4 sm:px-6 md:px-8 2xl:max-w-[1440px]';

/** The width above, plus the column and the vertical rhythm the page itself is laid out on. */
export const pageShellClass = `${pageWidthClass} flex flex-col gap-4 pt-8 pb-16 sm:gap-5 sm:pt-10 md:pt-12 md:pb-20`;
