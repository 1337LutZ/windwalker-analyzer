/**
 * What a colour means on a chart, and what the key beside it has to look like — the two written down
 * together, because they were written down apart and drifted.
 *
 * The energy track washed its stretches at the cap in `fill-miss/25` and then described them with a
 * `bg-miss` chip: the same token at four times the strength, so the key showed a colour the chart
 * never drew. Nothing caught it. The band's class lived in the section, the swatch's class lived in
 * the legend primitive, and only a reader holding both files open at once could see they disagreed.
 * Naming the pair once is the fix; `ResourceChart` is what stops a caller reaching past it.
 *
 * Both halves are spelled out in full rather than built from the tone at runtime. Tailwind only ships
 * a class it can see written, so `fill-${tone}/25` compiles to nothing at all — which is also why
 * this is a table and not a function.
 *
 * Its own module rather than exports beside a component: a component module has to export nothing but
 * components for React Fast Refresh to hot-swap it, and both the legend and the track import this.
 * The colours themselves are named for the mechanic rather than the hue; see `styles/global.css`.
 */

/** A mark drawn at full strength — a line, a bar, a tick — and the swatch that names it. */
export const SWATCH = {
	brew: 'bg-brew',
	rune: 'bg-rune',
	kick: 'bg-kick',
	miss: 'bg-miss',
	missSoft: 'bg-miss-soft',
} as const;

export type Tone = keyof typeof SWATCH;

/**
 * A window washed behind a bar, and the swatch that names it *at the same strength* — which is the
 * whole reason this table exists.
 *
 * `text` is the note drawn inside such a band, and it is the full-strength token deliberately: a
 * label has to be read, and a quarter-strength glyph on a dark ground cannot be.
 *
 * One wash per tone, also deliberately. A tone means a mechanic, and a mechanic drawn at 15% on one
 * chart and 25% on another is two colours pretending to be one — the haste window under the
 * Energizing Brew bar was that 15%, and it now agrees with every other amber band. What separates
 * overlapping bands is the order they are painted in, not their strength: widest claim first, the
 * thing being looked for last and therefore on top.
 *
 * Only the three tones a band is ever drawn in. `kick` is a bar, never a wash behind one, and
 * `missSoft` is already `miss` mixed into the ground — washing it again would leave nothing to see.
 */
export const BAND = {
	brew: { fill: 'fill-brew/20', swatch: 'bg-brew/20', text: 'text-brew' },
	rune: { fill: 'fill-rune/25', swatch: 'bg-rune/25', text: 'text-rune' },
	miss: { fill: 'fill-miss/25', swatch: 'bg-miss/25', text: 'text-miss' },
} as const satisfies Partial<Record<Tone, { fill: string; swatch: string; text: string }>>;

export type BandTone = keyof typeof BAND;

/**
 * The same colours as CSS values, for the two places a class cannot reach: the SVG `stroke` of the
 * bar and the `color-mix` washed under it. `ResourceTrack` is hand-drawn SVG, so both arrive as
 * inline style strings rather than as utilities.
 */
export const VAR: Record<Tone, string> = {
	brew: 'var(--color-brew)',
	rune: 'var(--color-rune)',
	kick: 'var(--color-kick)',
	miss: 'var(--color-miss)',
	missSoft: 'var(--color-miss-soft)',
};
