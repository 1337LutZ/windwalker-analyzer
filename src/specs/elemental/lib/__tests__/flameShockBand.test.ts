// What target count each Flame Shock press was made at, per press — the number `judged` was hiding.
//
// `FlameShockPress.judged` is a boolean: true when the press was made at a count `flameShockWaste` has a
// rule at, which is band 1 alone. That is the right *grading* answer and a poor *reporting* one, because
// false covers three different pulls' worth of situation. A refresh at **two** enemies is `judged: false`
// and so is a refresh at thirteen, and a caption written off the flag alone can only say "not one enemy"
// or — worse, and this is what it said — "three or more enemies", which is untrue of the two-enemy case.
// `cleave` has two such presses.
//
// So the press now carries the band it was read at, which is one line at the audit
// (`const band = bandOf(aplTargetCountAt(t))`, with `judged` becoming `band === 1`) and the precedent is
// `EarthShockPress.band` — same field, same series, same argument for reading it per press rather than
// once per pull.
//
// **What can and cannot go red here.** The identity `judged === (band === 1)` cannot fail against the
// old code, because the old code had no `band` to compare against — it is a guard against the two
// drifting apart later, which is the failure `earthShockAoeBand.test.ts` was written after. So it is
// shown to fail against a deliberately wrong `band` instead: a whole-pull reading, which is the mistake
// `EarthShockPress.band`'s own doc warns about, gives every press on `cleave` one value and turns both
// the identity and the sequence below red.
//
// **And the grid it is asked over is discovered rather than spelled.** Every claim here is about a press,
// so every committed pull has presses that can answer it — but the loop said `['unbroken', 'phased',
// 'cleave']`, so when `addsThenBoss.json` landed its 31 presses were never put to the identity at all.
// The gate that used to read `phased`/`unbroken` by name now reads `targets.counts.max`, because a pull
// is single-target by its count series and not by its file name.

import { describe, expect, it } from 'vitest';

import { rawFixtures } from '~/lib/analysis/fixtures';
import type { Analysis, ElementalAuditResult } from '~/lib/types';

import { analyse } from '../index';

type El = Analysis & ElementalAuditResult;

/**
 * Every raw Elemental pull, found rather than listed, and the analysis memoised — the shape
 * `components/charts/__tests__/uptimeRow.test.ts` sets, for the same two reasons.
 *
 * The literal this replaced (`['unbroken', 'phased', 'cleave']`) stopped being the committed set the day
 * `addsThenBoss.json` landed, and the identity below is written *of a press*: `judged` and `band` are one
 * claim or a caption can contradict the grade beside it. Three of those names carry 25 presses and six
 * unjudged ones between them; the fourth carries 31 presses across all four bands and 19 unjudged, so it
 * is the pull that actually exercises the claim — and it was the one pull the grid never ran.
 */
const FIXTURES = rawFixtures('elemental').map(({ name }) => name.replace(/\.json$/, ''));

const analysed = new Map<string, El>();
const fx = (name: string): El => {
	const hit = analysed.get(name);
	if (hit !== undefined) return hit;
	const found = rawFixtures('elemental').find((fixture) => fixture.name === `${name}.json`);
	if (found === undefined) throw new Error(`no raw Elemental fixture ${name}`);
	const el = analyse(found.dataset) as El;
	analysed.set(name, el);
	return el;
};

/** The bands a pull's presses were made at, counted — the shape a per-press reading can be stated in. */
const bandCounts = (name: string): Record<number, number> => {
	const out: Record<number, number> = {};
	for (const press of fx(name).flameShock.presses) out[press.band] = (out[press.band] ?? 0) + 1;
	return out;
};

describe('every Flame Shock press says what target count it was made at', () => {
	/**
	 * **Per press, and `cleave` is the pull that can tell the difference.** It runs from one enemy to
	 * thirteen inside a single pull, so its ten presses sit under three different lists — and a whole-pull
	 * reading would hand all ten the same band, which is what the wrong implementation this was checked
	 * against does.
	 *
	 * Pinned as the sequence rather than as a set, because position is which press: the opener and the
	 * two refreshes after it are single-target, the pack arrives, and the last two presses are made at two
	 * enemies as it thins out.
	 */
	it('reads the band the press itself was made at, not the pull', () => {
		expect(fx('cleave').flameShock.presses.map((p) => p.band)).toEqual([1, 1, 2, 4, 1, 4, 1, 4, 4, 2]);
		// `addsThenBoss` is the same fact on a pull that spends 73.73% of itself above one enemy: 31 presses
		// spread over every band the ladder has, which is what a per-press reading looks like and what a
		// whole-pull one cannot produce. Counted rather than sequenced — position is which press on a
		// ten-press pull and noise on a thirty-one-press one — and the band-1 count is `judged`, below.
		expect(bandCounts('addsThenBoss')).toEqual({ 1: 12, 2: 5, 3: 6, 4: 8 });
		// And every pull that never leaves one enemy reads 1 throughout, which is the same fact from the
		// other side — `score.ts` already says these judge every refresh they have. Gated on the count
		// series rather than on the two names it was written as: a pull is single-target because
		// `counts.max` is 1, and a fifth fixture arriving under either name would have been asserted
		// against the wrong half.
		for (const name of FIXTURES) {
			if ((fx(name).targets?.counts.max ?? 1) > 1) continue;
			expect(new Set(fx(name).flameShock.presses.map((p) => p.band)), name).toEqual(new Set([1]));
		}
		// The partition itself, so a fifth fixture has to pick a side rather than slip past the gate above:
		// two of the four committed pulls never exceed one enemy and two of them do.
		expect(FIXTURES.filter((name) => (fx(name).targets?.counts.max ?? 1) === 1)).toEqual(['phased', 'unbroken']);
		expect(FIXTURES.filter((name) => (fx(name).targets?.counts.max ?? 1) > 1)).toEqual(['addsThenBoss', 'cleave']);
	});

	/**
	 * The band and the flag are one value, so a caption reading either cannot contradict the grade.
	 *
	 * `judged` is `band === 1` at the audit, so this holds by construction today; it exists for the moment
	 * somebody gives one of them a second reading. That is not hypothetical — `earthShockAoeBand.test.ts`
	 * was written after the section's press grading and the ladder's rung bands disagreed about which list
	 * one press was under, off two readings of the same series.
	 */
	it('keeps the flag and the band the same claim', () => {
		for (const name of FIXTURES) {
			for (const press of fx(name).flameShock.presses) {
				expect(press.judged, `${name} @${press.t} band ${press.band}`).toBe(press.band === 1);
			}
		}
	});

	/**
	 * **The case the field was added for: two enemies, not "three or more".**
	 *
	 * `cleave` makes two presses at exactly two enemies and neither is judged, so a sentence written off
	 * `judged` alone had to describe them as something they are not. There is a genuine band-3-or-more
	 * group as well — four presses at four — and the point is that the two groups are now distinguishable.
	 */
	it('separates a press at two enemies from a press at four', () => {
		const unjudged = fx('cleave').flameShock.presses.filter((p) => !p.judged);
		expect(unjudged.map((p) => p.band)).toEqual([2, 4, 4, 4, 4, 2]);
		// Non-vacuous in both directions: the pull judges presses too, so this is a split rather than a pull
		// with nothing on one side of it.
		expect(fx('cleave').flameShock.presses.filter((p) => p.judged).length).toBe(4);

		// The same split over every committed pull, so the group the field was added for cannot go empty
		// without a number moving here. `addsThenBoss` presses at exactly two enemies five times — five more
		// captions the retired `judged`-only wording would have called "three or more enemies" — and the two
		// single-target pulls have none, which is the other side of the partition above.
		const atTwo = Object.fromEntries(
			FIXTURES.map((name) => [name, fx(name).flameShock.presses.filter((p) => p.band === 2).length]),
		);
		expect(atTwo).toEqual({ addsThenBoss: 5, cleave: 2, phased: 0, unbroken: 0 });
		// And no unjudged press anywhere reads band 1: that is `judged === (band === 1)` from the failing
		// side, which is what makes the wording safe on a pull nobody has looked at.
		for (const name of FIXTURES)
			for (const press of fx(name).flameShock.presses.filter((p) => !p.judged))
				expect(press.band, `${name} @${press.t}`).toBeGreaterThanOrEqual(2);
	});
});
