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
 * The band fills are opaque `--color-band-*` tokens rather than an alpha of the tone. See the note
 * beside them in `styles/global.css`: a translucent band borrows the colour of whatever it is drawn
 * over, and that is a different thing on each of the four charts, so one class was producing four
 * reds.
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
 * A window washed over a bar, and the swatch that names it.
 *
 * The swatch is the token at **full** strength while the band is a wash, and that is a correction to
 * an earlier rule here rather than a relapse into the bug it fixed. What was wrong before was the
 * *token*: a band drawn in `miss` described by a chip drawn in something else. Matching the alpha as
 * well looked like the tidy answer and is wrong at a chip's size — twelve pixels of a 30% wash on a
 * dark ground is barely a colour, so the key stopped being legible in the course of making it
 * accurate. A band is hundreds of pixels wide and can afford to be faint; a chip cannot. One token,
 * two strengths, chosen for what each has to do.
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
	brew: { fill: 'fill-[var(--color-band-brew)]', swatch: 'bg-brew', text: 'text-brew' },
	rune: { fill: 'fill-[var(--color-band-rune)]', swatch: 'bg-rune', text: 'text-rune' },
	miss: { fill: 'fill-[var(--color-band-miss)]', swatch: 'bg-miss', text: 'text-miss' },
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
