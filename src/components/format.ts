// What the view layer needs on top of `~/lib/format`, which is where every number-to-text formatter
// now lives: the rounding the charts do before they hand a value to ApexCharts (which wants numbers,
// not strings), and the one piece of WarcraftLogs vocabulary the UI has to translate.
//
// `fmt` and `n` are the old names, kept as aliases so the chart layer keeps building; new call sites
// should import `formatClock` and `formatInteger` from `~/lib/format` directly.

export { formatClock as fmt, formatInteger as n } from '~/lib/format';
export { r1 } from '~/lib/analysis/format';

/** Milliseconds as seconds, one decimal — a number, because chart axes and annotations take numbers. */
export const sec = (ms: number): number => Math.round(ms / 100) / 10;

/**
 * Classic's difficulty ids, used only when the API did not tell us the names.
 *
 * These ids are NOT portable between game flavours, which is exactly how this went wrong: the table
 * here used to be retail Mists' mapping, where 3/4/5/6 encode size *and* mode as `10 Normal`,
 * `25 Normal`, `10 Heroic`, `25 Heroic`. On Classic the id is the mode alone — 4 is Heroic at either
 * raid size — so a 10 Heroic pull rendered as "25 Normal", wrong on both halves.
 *
 * Size is a separate field on the fight and is never inferred from the difficulty.
 */
const CLASSIC_DIFFICULTY: Record<number, string> = {
	1: 'LFR',
	3: 'Normal',
	4: 'Heroic',
	5: 'Mythic',
	10: 'Dungeon',
};

/**
 * How a pull is labelled: `10 Heroic`.
 *
 * `names` comes from the report's own zone (`zone.difficulties`), which is the only thing that
 * actually knows what an id means for the zone in question — the table above is the fallback for a
 * report with no zone attached. A size of 0 means the API did not say, so the mode is shown alone
 * rather than inventing a raid size.
 */
export const difficultyLabel = (difficulty: number, size = 0, names: Record<number, string> = {}): string => {
	const mode = names[difficulty] ?? CLASSIC_DIFFICULTY[difficulty] ?? `difficulty ${difficulty}`;
	return size > 0 ? `${size} ${mode}` : mode;
};

/** Percentage of a whole, clamped so a stray zero denominator cannot produce NaN in a style value. */
export const share = (part: number, whole: number): number =>
	whole > 0 ? Math.max(0, Math.min(100, (part / whole) * 100)) : 0;
