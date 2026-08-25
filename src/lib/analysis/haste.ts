// What a pull's haste actually was, moment by moment, and what it does to the clock.
//
// Generic on purpose, and the genericity is the point rather than a courtesy: haste is a damage stat
// for most specs and a *denominator* for some, and which one it is belongs to the spec rather than to
// this file. Ported from `nspietz/prot-pala-analyzer`, where it was Protection's — Sanctity of Battle
// (25956) turns melee haste into cooldown reduction on every generator plus Shield of the Righteous
// and into a shorter global on top, so haste decides how many presses that pull had room for.
//
// Three terms, and a spec supplies the middle one:
//
//   1. **The rating**, off `combatantinfo`. Gear, and all of the gear.
//   2. **A flat class multiplier** over it, passed in. Protection's is Seal of Insight, which every
//      Protection Paladin runs; a spec with no such stance passes nothing and gets 1.
//   3. **Bloodlust**, for exactly as long as the aura is on the player.
//
// The report states all three rather than folding them into one number, because a reader checking a
// figure against their own character sheet needs to see which term they disagree with.
//
// **A fourth thing looks like it belongs and does not: the raid's melee haste buff.** Sanctity of
// Battle subscribes to `AddOnMeleeAndRangedHasteChanged`, and that buff never fires it —
// `registerExclusiveMeleeHaste` in `sim/core/buffs.go` (Unholy Aura, Swiftblade's Cunning) goes
// through `MultiplyMeleeSpeed`, which moves `MeleeSpeedMultiplier` and the swing timers and nothing
// else. Bloodlust is the contrast and the reason the distinction is not pedantry: it goes through
// `MultiplyAttackSpeed`, which *does* call `updateMeleeAndRangedHaste`. So a melee haste buff swings
// the weapon faster and leaves every cooldown here where it was.
//
// **What this does not replace.** `analyseCore` measures an `effectiveGcd` off the median observed gap
// between presses, and that stays: it is a measurement of the pull where this is a model of it, and a
// spec that has both gets to check one against the other. See `checkHaste`, which can only ever accuse
// the model of being too slow.

import type { Ability } from '~/lib/game/model';
import type { Window } from '~/lib/types';

/**
 * Rating per one percent of haste, from `sim/core/base_stats_auto_gen.go`.
 *
 * `HasteRatingPerHastePercent = 425.0`, and the sim divides by `425 * 100` because it works in
 * fractions rather than percent — 18363 rating on the reference pull is 43.2%.
 */
export const HASTE_RATING_PER_PCT = 425;

/**
 * Protection Paladin's Seal of Insight multiplier — the reference value this model was measured at,
 * and the reason the second term exists at all.
 *
 * Kept here beside the arithmetic rather than in the spec, because it is the evidence for the shape of
 * `buildHasteCurve` and not merely a number that spec happens to pass. A spec with a stance of its own
 * declares its own constant and passes it; a spec with none passes nothing.
 *
 * It is **measured**, not assumed.
 *
 * The sim says otherwise, and the sim is out of date: `sim/paladin/seal_of_insight.go` ends its aura
 * with `AttachMultiplyCastSpeed(1.1)` — ten percent, and *cast* speed, which is not the melee haste
 * `sanctity_of_battle.go` subscribes to. Read literally it says the seal does nothing to these
 * cooldowns at all. The reader's account is that the ten percent is pre-nerf and that the live seal is
 * five, on melee haste.
 *
 * Nine reference kills settle it, because a haste-scaled cooldown's floor is visible in the press
 * stream: press a button the instant it returns often enough and the shortest gap between presses is
 * the cooldown. With 18363 rating (43.21%) and this 5% over it — 1.5037 — the predicted floors and the
 * observed ones are the same numbers:
 *
 *   button           base     predicted   shortest observed   at rating alone
 *   Crusader Strike  4500ms   2993ms      2992ms              3142ms
 *   Judgment         6000ms   3990ms      3979ms              4190ms
 *   Holy Wrath       9000ms   5985ms      5984ms              6285ms
 *   Consecration     9000ms   5985ms      5987ms              6285ms
 *   Crusader Strike  under Bloodlust      2306ms  (2302ms predicted)
 *   Judgment         under Bloodlust      3063ms  (3069ms predicted)
 *   Holy Wrath       under Bloodlust      4604ms  (4604ms predicted)
 *
 * The size is pinned as well as the existence: at 4% the predicted Crusader Strike floor is 3021ms and
 * at 6% it is 2964ms, and neither survives an observed 2992ms across forty-two samples on one pull.
 *
 * And the global says the same thing on its own. Rating alone puts it at 1048ms, so no gap between
 * two on-GCD presses could be shorter than that; the nine kills put hundreds of gaps between 975ms and
 * 1024ms. Only a total at or above 1.5 gives the 1.0s floor, and rating alone does not reach it.
 */
export const SEAL_OF_INSIGHT_HASTE = 1.05;

/**
 * Bloodlust, Heroism and Time Warp, from `sim/core/buffs.go`.
 *
 * `BloodlustAura` calls `MultiplyAttackSpeed(sim, 1.3)`, and attack speed is exactly the term
 * `TotalMeleeHasteMultiplier` multiplies the rating by — so unlike the seal above, this one is
 * verifiably the haste Sanctity of Battle reads. It multiplies rather than adds.
 */
export const BLOODLUST_HASTE = 1.3;

/**
 * What to divide by when the pull reports no rating at all.
 *
 * The old flat assumption, kept for exactly the case it was written for: a pull with no
 * `combatantinfo`, where the alternative is to divide by 1.0 and report a player who missed a third
 * of their globals. `HasteMeasure.assumed` says when this was used, and the report says so too.
 */
export const FALLBACK_HASTE = 1.5;

/** The global before haste touches it, in ms. */
export const BASE_GCD_MS = 1500;

/**
 * The floor the global cannot go below, in ms, and the cap that puts it there.
 *
 * `sanctity_of_battle.go` reduces the global by `min(0.5s, 1.5s - 1.5s / haste)` — a *capped*
 * reduction. At 50% haste the uncapped term is exactly 0.5s, so from there upwards the cap binds and
 * the global sits on 1.0s however fast the player gets. Bloodlust over a geared pull therefore buys
 * shorter cooldowns and not a shorter global.
 */
export const GCD_FLOOR_MS = 1000;
export const MAX_GCD_REDUCTION_MS = 500;

/**
 * The haste the cap binds at, and so the one number a player of this spec is actually aiming for.
 *
 * Derived rather than written down as 1.5, because the two constants above are what decide it: the
 * uncapped reduction reaches `MAX_GCD_REDUCTION_MS` exactly when `BASE_GCD_MS / haste` equals what is
 * left, and a hand-typed 1.5 would survive either of them being corrected. `data.test.ts` already
 * pins `gcdMsFor(1.5) === GCD_FLOOR_MS` from the other side.
 *
 * **It is a breakpoint and not a ceiling.** Above it the global does not improve again — the sim caps
 * the reduction at half a second and floors the result at `GCDMin` besides, two mechanisms landing on
 * the same 1.0s — while every cooldown `cooldownMsFor` scales keeps shortening with no cap at all. So
 * haste past this point still buys presses; it just stops buying room to make them in.
 */
export const GCD_FLOOR_HASTE = BASE_GCD_MS / (BASE_GCD_MS - MAX_GCD_REDUCTION_MS);

/** What a haste rating alone buys, as a multiplier. */
export function hasteFromRating(rating: number): number {
	return 1 + rating / (HASTE_RATING_PER_PCT * 100);
}

/**
 * The global at a given haste, in ms.
 *
 * The sim's arithmetic, in the sim's order: the *reduction* is capped and rounded, then subtracted.
 * Computing `1500 / haste` and clamping the result would agree at the two ends and disagree in the
 * middle, which is where a pull that never reaches 50% haste lives.
 */
export function gcdMsFor(haste: number): number {
	const uncapped = BASE_GCD_MS - BASE_GCD_MS / haste;
	return BASE_GCD_MS - Math.round(Math.min(MAX_GCD_REDUCTION_MS, uncapped));
}

/** A haste-scaled cooldown at a given haste, in ms. */
export function cooldownMsFor(baseMs: number, haste: number): number {
	return Math.round(baseMs / haste);
}

/**
 * The curve itself: haste at a moment, and the clock that follows from it.
 *
 * A function of time rather than a number, because Bloodlust moves it mid-pull. Everything that asks
 * "how long was this cooldown" has to ask at the moment of the *press*, not at the moment of the
 * question — `sim/core/cast.go` stamps `spell.CD.Set(sim.CurrentTime + cd)` when the button goes out,
 * so a cooldown that started before Bloodlust runs its full length and one started inside it does not.
 */
export interface HasteCurve {
	/** The multiplier at a fight-relative moment. */
	at: (t: number) => number;
	/** The global at that moment, in ms. */
	gcdMsAt: (t: number) => number;
	/** A cooldown as a press at that moment would stamp it, in ms. Unscaled abilities are unchanged. */
	cooldownMsAt: (ability: Ability, t: number) => number;
	/** What the report says about this pull's haste. */
	measure: HasteMeasure;
}

/** The three inputs and what they came to, stated so the arithmetic above can be checked. */
export interface HasteMeasure {
	/** Melee haste rating from `combatantinfo`, or null when the pull reported none. */
	rating: number | null;
	/** What the rating alone buys. 1.0 when there is no rating to read. */
	fromRating: number;
	/** The spec's flat multiplier, carried rather than inlined so the report can name what it was. */
	classMultiplier: number;
	/** Rating and seal together — what the pull ran at outside Bloodlust. */
	base: number;
	/** `base` under Bloodlust, or null when no Bloodlust landed on this pull. */
	underLust: number | null;
	/** The global at `base`, in ms, and under Bloodlust. */
	gcdMs: number;
	gcdMsUnderLust: number | null;
	/** How long Bloodlust was up, in ms. */
	lustMs: number;
	/**
	 * What this pull's own presses say about all of the above, or null when nothing checked.
	 *
	 * `buildHasteCurve` leaves it null because it has no press stream to look at; the measure fills it
	 * in. See `checkHaste` for why it can only ever accuse the model of being too slow.
	 */
	check: HasteCheck | null;
	/**
	 * True when no rating was reported and `FALLBACK_HASTE` stood in for it.
	 *
	 * The one case where the denominator is not measured, and the report has to say so rather than
	 * print the same confident number it prints for every other pull.
	 */
	assumed: boolean;
}

/**
 * Builds the curve for one pull.
 *
 * `lust` is the Bloodlust aura's windows on the player, fight-relative — the same windows the
 * cooldown section grades Avenging Wrath against, so the two cannot disagree about when the haste was
 * there.
 */
export function buildHasteCurve(
	rating: number | null,
	lust: readonly Window[],
	/**
	 * The spec's own flat multiplier over the rating — a stance, a seal, a passive.
	 *
	 * Defaults to 1, which is "this spec has none" rather than "this spec was not asked". A spec that
	 * has one passes it; `SEAL_OF_INSIGHT_HASTE` above is the measured example and Protection's value.
	 */
	classMultiplier = 1,
): HasteCurve {
	const measured = rating !== null && rating > 0;
	const fromRating = measured ? hasteFromRating(rating) : 1;
	const base = measured ? fromRating * classMultiplier : FALLBACK_HASTE;
	const lustMs = lust.reduce((sum, window) => sum + Math.max(0, window.end - window.start), 0);
	const hasLust = lust.length > 0;

	const at = (t: number): number => {
		for (const window of lust) {
			if (t >= window.start && t < window.end) return base * BLOODLUST_HASTE;
		}
		return base;
	};

	return {
		at,
		gcdMsAt: (t) => gcdMsFor(at(t)),
		cooldownMsAt: (ability, t) => {
			const baseMs = ability.cooldownMs ?? 0;
			return ability.hasteScaled === true ? cooldownMsFor(baseMs, at(t)) : baseMs;
		},
		measure: {
			rating: measured ? rating : null,
			fromRating,
			classMultiplier,
			base,
			underLust: hasLust ? base * BLOODLUST_HASTE : null,
			gcdMs: gcdMsFor(base),
			gcdMsUnderLust: hasLust ? gcdMsFor(base * BLOODLUST_HASTE) : null,
			lustMs,
			check: null,
			assumed: !measured,
		},
	};
}

/**
 * One button's evidence about the divisor.
 *
 * The gap is between two presses of the same button, so it cannot be shorter than that button's
 * cooldown — which makes the shortest gap in a pull a *measurement* of the cooldown, provided the
 * player pressed it on cooldown at least once. `predictedMs` is what the model says that same gap's
 * cooldown was, asked at the press that started it, so a gap inside Bloodlust is compared against the
 * Bloodlust figure rather than against the base one.
 */
export interface HasteCheckRow {
	key: string;
	name: string;
	/** How many gaps between consecutive presses this row is drawn from. */
	samples: number;
	/** The gap with the smallest margin over its own prediction, in ms. */
	observedMs: number;
	predictedMs: number;
	/** `observed - predicted`. Negative means the button came back faster than the model allows. */
	deltaMs: number;
	/** True when that gap began inside Bloodlust, so the reader knows which figure it tested. */
	inBloodlust: boolean;
}

/**
 * What this pull's own presses say about the haste the report computed for it.
 *
 * The check is deliberately **one-sided**, and that is the whole of its honesty. A gap shorter than the
 * predicted cooldown is proof the model is wrong: nothing brings a button back sooner than its
 * cooldown, so the player must have had more haste than the three terms account for. A gap *longer*
 * than the prediction proves nothing at all — the player simply did not press on cooldown that time,
 * which is the ordinary case and is what the rest of the report is busy measuring. So this can report
 * "the pull was faster than the model" and can never report "the pull was slower".
 */
export interface HasteCheck {
	/** One row per button with enough presses to say anything, worst margin first. */
	rows: HasteCheckRow[];
	/** The smallest `deltaMs` across the rows, or null when nothing could be measured. */
	worstMs: number | null;
	/**
	 * `agrees` — every button came back no sooner than the model allows, within the tolerance.
	 * `faster` — at least one came back sooner than it can, so the divisor is too small.
	 * `unmeasured` — no button was pressed often enough for its gaps to mean anything.
	 */
	verdict: 'agrees' | 'faster' | 'unmeasured';
	toleranceMs: number;
}

/**
 * How far under a prediction a gap may sit before it counts as a contradiction, in ms.
 *
 * Timestamp jitter, and it is measured rather than picked: across the nine reference kills the largest
 * shortfall on a haste-scaled button is Judgment's, 11ms under a 3990ms prediction, with Crusader
 * Strike and Holy Wrath both at 1ms. Twenty-five gives that headroom twice over and still catches the
 * failures worth catching, which are not close calls — a missing 5% multiplier moves Crusader Strike
 * by 150ms and a missing Bloodlust moves it by 690ms.
 */
export const HASTE_CHECK_TOLERANCE_MS = 25;

/**
 * How many gaps a button needs before its shortest one is worth believing.
 *
 * One gap is not evidence: the pull may have pressed the button twice and waited both times. Three is
 * the point where a floor starts to be a floor rather than an accident, and it keeps the check quiet
 * about the buttons a Protection pull uses once or twice — Consecration on a short kill, Hammer of
 * Wrath outside the execute.
 */
export const HASTE_CHECK_MIN_SAMPLES = 3;

/**
 * Runs the check over one pull.
 *
 * The caller supplies press times per ability, and owes this function two things it cannot check for
 * itself. Presses of buttons that share a cooldown timer have to arrive merged, because a Hammer of
 * the Righteous a second after a Crusader Strike is not that cooldown coming back early. And an
 * ability whose cooldown a proc can reset has to be left out — Avenger's Shield under Grand Crusader
 * is a button that genuinely returns in no time at all, and would fail this check on every pull.
 */
export function checkHaste(
	curve: HasteCurve,
	presses: ReadonlyArray<{ ability: Ability; times: readonly number[] }>,
	options: { toleranceMs?: number; minSamples?: number } = {},
): HasteCheck {
	const toleranceMs = options.toleranceMs ?? HASTE_CHECK_TOLERANCE_MS;
	const minSamples = options.minSamples ?? HASTE_CHECK_MIN_SAMPLES;
	const rows: HasteCheckRow[] = [];

	for (const { ability, times } of presses) {
		if (ability.hasteScaled !== true || (ability.cooldownMs ?? 0) <= 0) continue;
		const sorted = [...times].sort((a, b) => a - b);
		let best: HasteCheckRow | null = null;
		let samples = 0;
		for (let i = 1; i < sorted.length; i++) {
			const from = sorted[i - 1] ?? 0;
			const gap = (sorted[i] ?? 0) - from;
			if (gap <= 0) continue;
			samples++;
			const predictedMs = curve.cooldownMsAt(ability, from);
			const deltaMs = gap - predictedMs;
			// The smallest margin rather than the shortest gap: a gap inside Bloodlust is held to a
			// shorter cooldown, so comparing raw lengths would always nominate the lust one.
			if (best === null || deltaMs < best.deltaMs) {
				best = {
					key: ability.key,
					name: ability.name,
					samples: 0,
					observedMs: gap,
					predictedMs,
					deltaMs,
					inBloodlust: curve.at(from) > curve.measure.base,
				};
			}
		}
		if (best !== null && samples >= minSamples) rows.push({ ...best, samples });
	}

	rows.sort((a, b) => a.deltaMs - b.deltaMs);
	const worstMs = rows[0]?.deltaMs ?? null;
	return {
		rows,
		worstMs,
		verdict: worstMs === null ? 'unmeasured' : worstMs < -toleranceMs ? 'faster' : 'agrees',
		toleranceMs,
	};
}
