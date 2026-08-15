import { gradeOf } from './model';
import type { Grade, Threshold } from './model';

/**
 * How a share of wasted resource reads as a colour.
 *
 * Deliberately *not* part of `lib/score`'s graded model, and the distinction matters. Nothing in the
 * simulator or the priority list says how much overflow is acceptable — the list spends a resource
 * when it has something worth spending it on and pools it when it does not — which is exactly why
 * neither energy nor chi carries a graded section. Inventing a threshold and calling it a verdict is
 * the failure this report is built to avoid.
 *
 * What this is instead: a reading aid on one tile, so a number a reader cannot calibrate carries some
 * hint of its own size. The bands are round numbers rather than quantiles of a sample, and they are
 * round on purpose — three reference pulls (1.4%, 2.4%, 3.4% of chi generated) is far too small to
 * derive a distribution from, and dressing three points up as percentiles would claim a precision
 * that does not exist.
 *
 * The copy beside it never says "good" or "bad". It states the number.
 */
/**
 * The bands, as data.
 *
 * All three tones below are the same comparison — `gradeOf` in `./model`, which the graded metrics
 * already run on — differing only in where the lines sit and which direction is better. Writing that
 * comparison out three times invited the three copies to drift, and drift here is invisible: a band
 * off by a point still returns a plausible colour.
 *
 * They stay three named functions rather than one taking a band, because the reason they were split
 * is that a caller passing the wrong bands gets a believable answer instead of an error. The names
 * are the type check. What is shared is the arithmetic, not the choice.
 */
const BANDS = {
	// Lower is better: this is a share of something thrown away.
	waste: { good: 2, ok: 5, higherIsBetter: false },
	usage: { good: 90, ok: 70, higherIsBetter: true },
	defensiveUse: { good: 80, ok: 50, higherIsBetter: true },
} as const satisfies Record<string, Threshold>;

/** A share, or null when there is no denominator to take one of. */
function share(part: number, whole: number): number | null {
	return whole > 0 ? (part / whole) * 100 : null;
}

export function wasteTone(wasted: number, generated: number): Grade | null {
	// No denominator, no opinion. A pull that generated nothing has not wasted a share of anything.
	const pct = share(wasted, generated);
	return pct === null ? null : gradeOf(BANDS.waste, pct);
}

/**
 * The same reading aid, the other way up: a share of something that should have been taken.
 *
 * Separate from `wasteTone` rather than a flag on it, because the two answer different questions and
 * a caller passing the wrong one would get a plausible colour rather than an error. Same caveat
 * applies and applies harder — nothing says how many Chi Brew charges a pull is *supposed* to spend,
 * only that a charge sitting at the ceiling is not recharging. These bands are a hint at the size of
 * a number, not a verdict anybody earned.
 */
export function usageTone(used: number, possible: number): Grade | null {
	// A ceiling of zero is not a target anyone missed.
	const pct = share(used, possible);
	return pct === null ? null : gradeOf(BANDS.usage, pct);
}

/**
 * `usageTone` again, and much more forgiving, for a cooldown whose worth the *encounter* sets.
 *
 * Touch of Karma is the case. Its charges are counted the same way Chi Brew's are — the opener plus
 * one per recharge inside the pull — but the two are not the same claim. A Chi Brew charge is worth
 * pressing whenever it is up; a Karma charge is worth pressing only while something is hitting you,
 * and a pull that offers three recharges rarely offers three stretches of incoming damage. Grading
 * that against `usageTone`'s 90/70 calls two presses out of three a failure, which faults a player
 * for the shape of the fight rather than for anything they did.
 *
 * So: nearly every charge is `good`, at least half is `ok`, and below half is worth a reader's eye
 * rather than a verdict. Round numbers, and the same caveat as everything else in this file — a hint
 * at the size of a number, never a judgement, and never anything `lib/score` counts. The graded
 * question about Touch of Karma is what the presses *returned*, which is a different tile.
 */
export function defensiveUseTone(used: number, possible: number): Grade | null {
	const pct = share(used, possible);
	return pct === null ? null : gradeOf(BANDS.defensiveUse, pct);
}
