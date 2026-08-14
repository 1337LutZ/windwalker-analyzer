/**
 * Wowhead's Mists Classic item pages, which is the branch this report reads logs from.
 *
 * Its own module rather than a second export beside `ItemIcon`: a component module has to export
 * nothing but components for React Fast Refresh to hot-swap it.
 */
export const itemUrl = (id: number): string => `https://www.wowhead.com/mop-classic/item=${id}`;
