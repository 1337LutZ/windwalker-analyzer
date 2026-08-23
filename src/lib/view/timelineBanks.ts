// The counters a spec draws on its timelines, and the vocabulary it declares them in.
//
// A view module beside `resourceBars.ts` rather than anything inside the charts: the cast log and the
// summary timeline are shared by both specs, and *which* counters a pull carries is the one thing about
// them only a spec can answer — the Windwalker's Tigereye Brew bank, the Elemental's Lightning Shield
// charge. A chart draws whatever it is handed, in the order it is handed them, and no longer reads
// either spec's audit fields through a cast to find out.
//
// One mechanic, two drawings, and the difference is the chart rather than the counter. Both charts are
// looking at the same thing: something that accumulates from what the player did, holds a ceiling, is
// spent whole by a press, and can be lost unspent.
//
// - `TimelineBank` is the **curve**, for the cast log, where the counter gets a strip of its own above
//   the rows. **A bank and not a lane, on purpose:** it behaves like a resource, so it is drawn like the
//   energy and chi bars above it — a stepping curve against its own cap — rather than as an on-or-off
//   window among the auras. Each one carries its own ceiling for the same reason: a bank that never
//   reached twenty still had twenty to reach, and scaling to the pull's observed peak would draw a
//   half-full bank as a full one.
// - `TimelineCounter` is the **loads**, for the summary timeline, which has one row per thing and no
//   room for a curve. There the counter is a row of bars like any other, one per load, and the figure
//   the spend threw away is written into the bar.

import type { ResourceCurve, Window } from '~/lib/types';

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
	/**
	 * The stretches that were a fault, shaded behind the curve in the fault tone.
	 *
	 * Beside `ceilingIsWaste` rather than folded into it, because the two answer different questions.
	 * `ceilingIsWaste` asks the *chart* to derive the fault from the curve — every reading at the
	 * ceiling — which is right for a bank whose ceiling is a loss by definition. This is the spec
	 * handing over windows it worked out itself, which is the only way a fault with any judgement in it
	 * can reach the drawing: Lightning Shield's overcap is time at seven *past the reader's own leeway*,
	 * and a helper walking the curve has no leeway to apply. Without this the cast log could either
	 * redden every stretch at the ceiling — contradicting the section beside it — or say nothing.
	 *
	 * A zero-length window is a fault that happened at an instant rather than over a stretch (a spend
	 * below the ceiling), and is drawn as the thinnest mark the track can place. Same convention the
	 * Lightning Shield section's own bands use, so the two drawings mark the same moments.
	 *
	 * `text` is a short note drawn at the window's left edge in the fault colour — what the fault cost,
	 * where a number is what makes it legible. A mark an instant wide is invisible on a long pull without
	 * one, which is the whole reason the section writes the level a bad spend threw away beside it.
	 */
	faultWindows?: ReadonlyArray<Window & { text?: string }>;
}

/**
 * One load a counter built and then let go of — one bar on the summary timeline.
 *
 * A load and not a stack gain. The gains inside a load are the filler casts that built it, which is a
 * row of noise around the one figure worth reading: what the spend threw away. So "1→4, spend" is one
 * bar labelled 4 and "1→7, spend" one labelled 7.
 *
 * `held` is the charge the load had reached when it ended, which is also its peak by construction —
 * any fall closes the load and opens the next, so what is on the counter inside one only ever goes up.
 */
export interface CounterLoad {
	start: number;
	end: number;
	held: number;
	/**
	 * Whether the load ended in a spend, which is what decides whether `held` is written on the bar:
	 * the figure *is* the spend. A load that was lost, or that the log stopped in the middle of, is
	 * still drawn — the charge really was there — but carries no number, because a number would claim
	 * a press that never happened.
	 */
	spent: boolean;
	/**
	 * The load ended below the counter's ceiling — a spend that threw charge away, or a shield that fell
	 * off before it was full.
	 *
	 * Set only when the caller supplies a `cap`, because the ceiling is a fact about the aura and this
	 * module knows no auras. `spent` and this are independent: a spend below the cap is a wasted press, a
	 * *loss* below the cap is a wasted shield, and both are faults a reader can act on — which is why one
	 * flag covers them and the tooltip says which.
	 */
	belowCap?: boolean;
}

/**
 * One counter a spec draws as a row *among* the lanes of the summary timeline, one bar per load.
 *
 * Beside `timelineBanks` and not folded into it because the drawing is different, not because the
 * counter is — see the module doc. A spec with no counter answers with an empty array, which is the
 * whole point of the seam: the shared chart asks the spec and draws what comes back, rather than
 * testing an analysis for one spec's audit field and then having to know that field's name.
 *
 * No `key`: the chart merges its rows by `name`, and a counter row is merged with an aura row or a
 * press row of the same name exactly as two lanes of one name are. The name is the identity here.
 */
export interface TimelineCounter {
	/** The row's label, which is the ability's own name — ability names never come from the locale. */
	name: string;
	/** The spell whose icon stands for the row, from the spec's game model rather than from a literal. */
	id: number;
	tone: BankTone;
	loads: CounterLoad[];
	/**
	 * Stretches of this counter that were a fault in themselves, rather than a load that ended badly.
	 *
	 * Time at the ceiling and time with the counter gone are both faults a reader can act on, and neither
	 * is a property of one load: overcapping happens *inside* a load, and an absence happens *between*
	 * two. So they arrive as windows and are drawn over the loads in the fault tone — which is exactly
	 * what the spec's own section chart does, unifying fell-off, overcapped and spent-below-full into one
	 * red band with one key entry.
	 *
	 * Supplied by the spec because every part of that judgement is the spec's: what the ceiling is, how
	 * much grace sitting at it deserves, and whether an absence was the player's doing.
	 */
	faultWindows?: Array<readonly [number, number]>;
}

/**
 * A counter's step series cut into the loads it was spent in — the arithmetic behind `TimelineCounter`.
 *
 * Here rather than in either spec because it is the mechanic and not the spell: a counter that
 * accumulates and is spent whole cuts into loads the same way whatever fills it, and the first spec to
 * copy this walk would be the fourth copy of something in this repo that dropped its own reasoning on
 * the way (see `docs/conventions.md`). `points` is a step series of `[t, level]` after every event that
 * moved the counter; `endMs` closes a load the log stopped in the middle of.
 *
 * **A load ends at a decrease, not at zero.** A spend that leaves a charge behind — Fulmination leaves
 * one, the shield itself stays up — takes the counter 7 → 1 and never to zero on any pull the buff
 * survives, which is every pull it was meant to. Closing on `level === 0` therefore closed nothing:
 * both committed Elemental fixtures hold a minimum level of 1 across 85 and 87 readings, so a whole
 * fight came out as one bar carrying the only peak it ever reached — thirteen Earth Shocks drawn as one
 * bar labelled 7, which is exactly what a reader reported seeing. A decrease *is* the spend: nothing
 * else takes a charge off such a counter, and the thirteen decreases on the `unbroken` fixture are the
 * thirteen presses the audit found, at the levels its bad-spend list gives.
 *
 * Zero is still its own case and it draws nothing. A counter that fell off is absent rather than spent,
 * so the stretch until it comes back stays blank and the load that was lost carries no figure — the
 * same reading `CastTimeline`'s `stepsOf` takes of an empty counter.
 */
export function counterLoads(
	points: readonly (readonly [number, number])[],
	endMs: number,
	/**
	 * The counter's ceiling, when the caller knows it. Loads that ended under it are flagged `belowCap`.
	 *
	 * Optional rather than required so a counter with no meaningful ceiling — one that is spent at
	 * whatever it has reached — is drawn without inventing a fault for it.
	 */
	cap?: number,
): CounterLoad[] {
	const loads: CounterLoad[] = [];
	let start: number | null = null;
	let held = 0;
	for (const [t, level] of points) {
		if (start === null) {
			if (level > 0) {
				start = t;
				held = level;
			}
			continue;
		}
		if (level >= held) {
			held = level;
			continue;
		}
		// Down: the load is over. Spent if anything is left on the counter, lost if not, and either way
		// the next load starts from what remains.
		loads.push({
			start,
			end: t,
			held,
			spent: level > 0,
			...(cap !== undefined && held < cap ? { belowCap: true } : {}),
		});
		start = level > 0 ? t : null;
		held = level;
	}
	// Still charging when the log stopped. Drawn, because the charge really was there, and unlabelled,
	// because nothing unloaded it.
	// Not `belowCap`, whatever it is holding: the log stopped, the player did not. Charging as the pull
	// ends is not a fault and marking it one would charge them for the fight ending.
	if (start !== null) loads.push({ start, end: endMs, held, spent: false });
	return loads;
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
