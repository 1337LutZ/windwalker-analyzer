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
 * `kick` is a bar, never a wash behind one, and `missSoft` is already `miss` mixed into the ground —
 * washing it again would leave nothing to see. Which leaves the three judgements and `track`.
 */
export const BAND = {
	brew: { fill: 'fill-[var(--color-band-brew)]', swatch: 'bg-brew', text: 'text-brew' },
	rune: { fill: 'fill-[var(--color-band-rune)]', swatch: 'bg-rune', text: 'text-rune' },
	miss: { fill: 'fill-[var(--color-band-miss)]', swatch: 'bg-miss', text: 'text-miss' },
	/**
	 * The exempt ground, washed under a bar rather than given a row of its own — see `EXEMPT` below.
	 *
	 * The gap this fills: a chart built from `WindowTracks` can hand an exempt stretch its own lane,
	 * and both charts that had one did. A chart built from `ResourceChart` cannot — the shield's step
	 * chart *is* the counter, so a stretch the denominator dropped has to be shaded behind it — and
	 * until this entry there was no exempt wash to reach for. The one chart that most needs to say
	 * "these seconds were not graded" was the one chart with no way to say it.
	 *
	 * **No `--color-band-track`, and that is not an oversight.** The three above are their tone mixed
	 * against the surface in `styles/global.css`, because a translucent band borrows the colour of
	 * whatever it is drawn over. `--color-track` is already an opaque ground — a flat `#41534b`, not
	 * derived from a spec hue — so it has nothing to mix and the wash and the mark are the same value.
	 * That is also what keeps the chip identical to `SWATCH.track`: one grey means exempt whether it is
	 * a row on a track chart or a band under a bar, which is the whole reason there is one `EXEMPT`.
	 *
	 * `text` is `ink-2` rather than the tone, which breaks this table's own "the note is the
	 * full-strength token" rule in the one case where following it would be unreadable — `--color-track`
	 * written on `--color-track` is nothing at all. An exempt band names itself in the key rather than
	 * inside itself, so this is a fallback for a caller that passes a note, not how the band is read.
	 */
	track: { fill: 'fill-[var(--color-track)]', swatch: 'bg-track', text: 'text-ink-2' },
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
 * **One tone, one label per cause.** Exempt is one concept for everything a chart decides about it —
 * the colour, the order, the fact that it is a ground — because every such stretch is exactly "a
 * second the denominator dropped", and a reader comparing two charts should not have to learn two
 * visual languages for that. It is a *label* per cause wherever a chart has more than one, because
 * the causes are not the same fact about the pull. There are three:
 *
 * - **the fight taking the target away** — an intermission, nothing the player did;
 * - **the Fire Elemental holding the one Fire totem slot** — the player's own cooldown;
 * - **an AoE phase** — the player acting correctly, against a different priority list.
 *
 * None is a fault and all are uncounted, so they share the tone; they are not the same thing to know
 * about a pull, so they keep their own names. That is also the answer to "can the existing vocabulary
 * carry a third kind": it can, and a third kind is a third label rather than a third grey. What it
 * could not carry was an exempt *wash* on a resource bar, which is what `BAND.track` above adds.
 *
 * The names have to do the distinguishing, because the colour deliberately does not. An intermission
 * and an AoE phase are the same grey and both mean "not your fault", but one is "you could not act"
 * and the other is "you were acting, against a different list" — a reader who cannot tell them apart
 * learns the wrong lesson from the same colour. Which is why a chart that draws both must name both in
 * its key, and why `exemptRows` in `./exempt` takes the label with the windows rather than after them.
 *
 * Widening is *not* part of the concept, and `SearingTotemUptime` is the exception that shows why: an
 * exempt row is a ground and so takes `widen: false`, unless a tile above the chart counts its spans
 * one by one, in which case it is also a counted row and must not be gated. See `Track.widen`.
 */
/**
 * The colour a **tooltip's title line** is drawn in, per tone — which is not always the tone.
 *
 * `tip()` tinted its title with `theme[content.tone]` so the heading would name the mark the reader
 * was hovering. That is right for the four judgements and wrong for the two grounds, because a ground
 * is a colour chosen to sit *behind* things and the tooltip draws it as 14px text on `surface`:
 *
 * | tone       | as text on `surface` |
 * | ---------- | -------------------- |
 * | `track`    | **1.31:1**           |
 * | `missSoft` | **1.94:1**           |
 * | `miss`     | 5.94:1               |
 * | `rune`     | 5.88:1               |
 * | `brew`     | 9.58:1               |
 * | `kick`     | 13.14:1              |
 *
 * WCAG AA wants 4.5:1 for text this size. 1.31:1 is not dim, it is invisible — the exempt rows ("Dot
 * up, not measured", "Nothing to hit", "Three or more enemies") had a title nobody could read.
 *
 * **This is the same finding `BAND.track.text` already recorded, in the one place it was not applied.**
 * That entry says `--color-track` written on `--color-track` is nothing at all and drops to `ink-2`;
 * the tooltip is the other surface a tone becomes text on, and it kept the tone. One rule, two call
 * sites, fixed in one of them — which is precisely the drift this module's header was written about.
 *
 * **Both substitutions say the right thing, so neither is only a contrast patch.** `track` is
 * documented above as the one tone here that is *not a judgement*, so an exempt title in plain ink is
 * the honest rendering rather than a workaround. `missSoft` is `miss` mixed into the ground and
 * decorates a `miss` bar, so its title belongs in `miss` — the category it is part of.
 *
 * Every other tone stays itself. `tip()` falls back to the tone for anything absent here, so a tone
 * added without a thought about legibility keeps today's behaviour rather than silently going grey.
 */
export const TIP_TITLE = {
	brew: 'brew',
	rune: 'rune',
	kick: 'kick',
	miss: 'miss',
	missSoft: 'miss',
	track: 'ink2',
} as const satisfies Record<Tone, Tone | 'ink2'>;

export const EXEMPT = 'track' satisfies Tone;

/**
 * The enemy count, as one ordered ramp — the only entry in this module that means a quantity.
 *
 * Every other tone here is named for a mechanic, and that is the rule the module exists to hold:
 * `brew` *is* Tigereye Brew wherever it appears, `miss` *is* a fault. "What you were fighting" needs
 * five bars on one lane and only one thing separates them, how many enemies were up — so it gets a
 * ramp of its own rather than four mechanic tones pressed into service, which would leave amber
 * meaning Tigereye Brew on one chart and two enemies on another.
 *
 * `single`, `cleave` and `aoe` are three steps of one hue because the count is ordered and rises with
 * them. `mixed` is deliberately off the ramp — no count held the stretch long enough to name, so there
 * is no step to put it on — and `idle` is `EXEMPT`, the same grey every chart uses for time it left out
 * of its figures. The values and the reasoning are in `styles/global.css`.
 *
 * Keyed by `SegmentMode` at the call site rather than typed against it here, for the reason the rest of
 * this module is untyped against its callers: `charts/` may not import from `analysis/`.
 */
export const COUNT = {
	single: { fill: 'bg-[var(--color-count-1)]', swatch: 'bg-[var(--color-count-1)]', ink: 'text-white' },
	cleave: { fill: 'bg-[var(--color-count-2)]', swatch: 'bg-[var(--color-count-2)]', ink: 'text-[#14101f]' },
	aoe: { fill: 'bg-[var(--color-count-3)]', swatch: 'bg-[var(--color-count-3)]', ink: 'text-[#1c1330]' },
	mixed: { fill: 'bg-[var(--color-count-mixed)]', swatch: 'bg-[var(--color-count-mixed)]', ink: 'text-white' },
	idle: { fill: 'bg-track', swatch: SWATCH.track, ink: 'text-ink-2' },
} as const;

export type CountTone = keyof typeof COUNT;
