// The counters a spec draws above the rows of its cast log, and the vocabulary it declares them in.
//
// A view module beside `resourceBars.ts` rather than anything inside the chart: the cast log is shared
// by both specs, and *which* counters a pull carries is the one thing about them only a spec can
// answer — the Windwalker's Tigereye Brew bank, the Elemental's Lightning Shield charge. The chart
// draws whatever it is handed, in the order it is handed them, and no longer reads either spec's audit
// fields through a cast to find out.
//
// **A bank and not a lane, on purpose.** Both of these behave like a resource: they fill from
// something, hold a ceiling, and are spent whole. So they are drawn like the energy and chi bars above
// them — a stepping curve against its own cap — rather than as an on-or-off window among the auras.
// Each one carries its own ceiling for the same reason: a bank that never reached twenty still had
// twenty to reach, and scaling to the pull's observed peak would draw a half-full bank as a full one.

import type { ResourceCurve } from '~/lib/types';

/**
 * The palette a bank draws in, named for what it means rather than for what it looks like — the
 * semantic tokens in `src/styles/global.css`, which is where the contrast and the colour-blind
 * separation were actually checked.
 *
 * Tokens and not class names: a `hover:decoration-${tone}` built at the call site is a class
 * Tailwind's scanner never sees and therefore never generates. The spec says which mechanic colour
 * its counter belongs to; the chart owns the literal classes each token turns into.
 */
export type BankTone = 'brew' | 'rune' | 'kick';

/** One counter a spec draws above its rows, and everything the chart needs to draw it. */
export interface TimelineBank {
	/**
	 * The bank's own name, which is also how its copy is found: `castLog.resource.<key>` labels the row
	 * and `castLog.resourceAria.<key>` describes it for a reader who cannot see it. It shares that
	 * namespace with the audited resource bars drawn above, so a bank must not take a bar's key.
	 */
	key: string;
	/** The section that argues about this bank, for the label's jump link (`#<section>-heading`). */
	section: string;
	/** The charge over the pull against its own ceiling — see the module doc on why the ceiling travels. */
	curve: ResourceCurve;
	/** The colour of the line and of the fill under it. */
	tone: BankTone;
	/**
	 * The colour the label underlines in on hover. Separate from `tone` because the Windwalker's bank
	 * uses two: the row is named for the brew and drawn in the proc colour that fills it.
	 */
	underline: BankTone;
	/**
	 * Whether time at the ceiling is a loss, and so worth shading in the colour every other section
	 * uses for one.
	 *
	 * A per-bank question and not a general one, which is why it is here rather than assumed by the
	 * chart: a full brew bank is a proc that had nowhere to go, while a full Lightning Shield is the
	 * state the rotation is trying to be in.
	 */
	ceilingIsWaste: boolean;
	/**
	 * Whether only the drops carry a number.
	 *
	 * For a counter whose gains are every filler cast, labelling all of them is a row of noise around
	 * the one figure worth reading, which is what a spend unloaded.
	 */
	labelSpendsOnly: boolean;
}

/**
 * What a lane's windows are worth labelling with, by lane key and then by the window's own start.
 *
 * The number is invisible from a bar's length: a Tigereye Brew that went out on eight stacks and one
 * that went out on ten are the same bar otherwise, and the difference is the whole argument of the
 * section beside the chart. Keyed by the window's start because that is what the engine identifies a
 * window by, and sound for the same reason the engine's own pairing is — two windows of one aura
 * cannot open on the same millisecond unless the aura logs under several ids.
 *
 * Keyed by lane and not handed over as "this spec's numbers", because the chart is shared: it asks
 * each lane it draws whether the spec has a figure for it, and a spec with none for any lane answers
 * with an empty map rather than with a special case.
 */
export type TimelineNotes = ReadonlyMap<string, ReadonlyMap<number, number>>;
