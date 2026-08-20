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
	/**
	 * The rail, and the one tone here that is not a judgement.
	 *
	 * A chart sometimes has to draw a stretch it deliberately did not grade — the Fire Elemental
	 * holding the one Fire totem slot, so the Searing Totem could not have been up and its absence is
	 * not a drop. Every other tone in this table means something about how the pull went, and painting
	 * that stretch in one of them would say the player got it wrong. `track` is the resource charts'
	 * own rail: structural, present, uncoloured by an opinion.
	 *
	 * It is far darker than the four above and that is the point rather than an oversight — the tone
	 * is a *ground*, drawn as a wide region, and the note beside `--color-band-lust` in
	 * `styles/global.css` sets out why a region that size can afford a contrast a mark could not. The
	 * legend chip is the same token at full strength, which is the rule the rest of this table follows.
	 */
	track: 'bg-track',
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
	track: 'var(--color-track)',
};

/**
 * The one tone an *exempt* stretch is drawn in: time the section's denominator dropped, so the
 * reader is neither credited nor charged for it.
 *
 * A constant rather than three copies of the string, because three copies is how the tree ended up
 * with two answers to one question. `DebuffTimeline`'s "nothing to hit" row was `muted` and
 * `SearingTotemUptime`'s "Fire Elemental out" row was `track`; both read as faded grey, and a reader
 * moving between two charts of one pull had no way to know the two bands meant the same thing.
 *
 * `track` is the survivor and `muted` is the one that went, for two reasons that are not taste.
 * `muted` is one of the *text* colours — `--color-muted` is the dim ink beside `ink` and `ink-2`,
 * mixed off `#a1a9a4` and built to be read at 14px — so painting a wide band in it puts the exempt
 * ground brighter than the up and down rows that are the chart's actual argument. `track` is already
 * documented above as the one tone here that is not a judgement, and it is a ground: dark enough to
 * sit behind the rows rather than in front of them. It is also in `SWATCH`, so the key beside the
 * chart can name it; `muted` is not, and adding a text token to the mark table would break the
 * pairing rule this module exists to hold.
 *
 * **One tone, two labels.** Exempt is one concept for everything a chart decides about it — the
 * colour, the order, the fact that it is a ground — because every such stretch is exactly "a second
 * the denominator dropped", and a reader comparing two charts should not have to learn two visual
 * languages for that. It is two *labels* wherever a chart has two causes, because the causes are not
 * the same fact about the pull: the fight taking the target away is nothing the player did, while the
 * Fire Elemental holding the one Fire totem slot is the player's own cooldown. Neither is a fault and
 * both are uncounted, so they share the tone; only one of them is a thing the reader chose, so they
 * keep their own names.
 *
 * Widening is *not* part of the concept, and `SearingTotemUptime` is the exception that shows why: an
 * exempt row is a ground and so takes `widen: false`, unless a tile above the chart counts its spans
 * one by one, in which case it is also a counted row and must not be gated. See `Track.widen`.
 */
export const EXEMPT = 'track' satisfies Tone;
