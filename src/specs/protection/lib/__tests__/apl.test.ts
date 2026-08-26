// The Protection ladder, run against the five committed pulls.
//
// Two kinds of assertion, and the split is deliberate. The first half is about the *transcription* —
// that the rungs are the list's rungs, that the band gates are the two substitutions the reader's list
// makes and nothing else — and it needs no pull at all. The second half is about the *walk*, and it is
// pinned against real captures because that is the only way to catch a condition that reads the wrong
// aura, a cooldown clock that never opens, or a window measured off a stream that turns out to be
// empty: each of those is silently green on a hand-built pull holding exactly the events it was written
// from.
//
// What is deliberately *not* pinned is a skip count as a target. The ladder describes what the sim's
// list wanted; it is not a score, `lib/score` grades nothing from it, and a figure asserted here is a
// figure somebody will be tempted to move by editing a rung.

import { describe, expect, it } from 'vitest';

import { rawFixtures } from '~/lib/analysis/fixtures';
import { getSpec } from '~/lib/spec';
import { ALL_BANDS } from '~/lib/spec/apl';
import type { Analysis } from '~/lib/types';

import { LADDER_ENTRIES, UNARBITRATED } from '../apl';

const PROTECTION = getSpec('protection')!;
const PULLS = rawFixtures('protection').map(({ name, dataset }): [string, Analysis] => [
	name,
	PROTECTION.analyse(dataset),
]);

describe('the Protection ladder is the list it says it is', () => {
	/**
	 * Seventeen rungs for fourteen buttons, and the three doubles are the whole design.
	 *
	 * Judgment carries two rules, Avenger's Shield two, Consecration two and Sacred Shield two — a rung's
	 * key is the *rule's* name and not the button's, which is what lets one button sit at two priorities.
	 * Asserted as a set rather than a count so a rename is a visible edit rather than a number that still
	 * adds up.
	 */
	it('names every rung the transcription has', () => {
		expect(LADDER_ENTRIES.map((entry) => entry.key)).toEqual([
			'judgment-sanctified-wrath',
			'avengers-shield-grand-crusader',
			'judgment',
			'avengers-shield',
			'consecration-multi',
			'holy-wrath',
			'hammer-of-the-righteous-holy-avenger',
			'crusader-strike-holy-avenger',
			'execution-sentence',
			'hammer-of-the-righteous',
			'crusader-strike',
			'hammer-of-wrath',
			'sacred-shield-refresh',
			'consecration',
			'lights-hammer',
			'holy-prism',
			'sacred-shield',
		]);
	});

	/**
	 * The band gates are exactly the reader's two substitutions, and nothing else carries one.
	 *
	 * This is the assertion that keeps the module doc honest. It claims the supplied list differs from
	 * `iron_juggernaut.apl.json` in two places — the builder and where Consecration sits — and that both
	 * are expressible as band gates. A third gated rung appearing here means somebody has banded
	 * something on a reading rather than on a diff, which is the departure the Elemental's own module
	 * spent three paragraphs regretting.
	 */
	it('gates four rungs and no others, in two matched pairs', () => {
		const gated = LADDER_ENTRIES.filter((entry) => entry.bands.length < ALL_BANDS.length);
		expect(gated.map((entry) => [entry.key, entry.bands])).toEqual([
			['consecration-multi', [2, 3, 4]],
			['hammer-of-the-righteous-holy-avenger', [2, 3, 4]],
			['crusader-strike-holy-avenger', [1]],
			['hammer-of-the-righteous', [2, 3, 4]],
			['crusader-strike', [1]],
			['consecration', [1]],
		]);
		// And the pairs partition the bands rather than overlapping or leaving a hole: at every target
		// count exactly one of each pair is in the list, which is what makes a band gate a transcription
		// of "this file presses that half" instead of a rung quietly missing at some count.
		for (const [single, multi] of [
			['crusader-strike-holy-avenger', 'hammer-of-the-righteous-holy-avenger'],
			['crusader-strike', 'hammer-of-the-righteous'],
			['consecration', 'consecration-multi'],
		]) {
			const a = LADDER_ENTRIES.find((entry) => entry.key === single)!.bands;
			const b = LADDER_ENTRIES.find((entry) => entry.key === multi)!.bands;
			expect([...a, ...b].sort()).toEqual([...ALL_BANDS]);
		}
	});

	/**
	 * Every talent-gated rung names the row it sits on, and two of them are not their own button.
	 *
	 * The gate is answered off `combatantinfo`'s talent list, so a rung that named its cast id instead
	 * would ask the wrong question — and for `judgment-sanctified-wrath` it would ask whether the player
	 * talented Judgment, which every Paladin has. That rung would then stand for a player who cannot get
	 * the benefit and demand a Judgment inside every Avenging Wrath on the pull.
	 */
	it('gates the talent rungs on their own rows rather than on their buttons', () => {
		const talented = LADDER_ENTRIES.filter((entry) => entry.talent).map((entry) => entry.key);
		expect(talented).toEqual([
			'judgment-sanctified-wrath',
			'execution-sentence',
			'sacred-shield-refresh',
			'lights-hammer',
			'holy-prism',
			'sacred-shield',
		]);
	});

	/** Four buttons delegated, each to a heading this spec's report really has. */
	it('delegates only to headings that exist', () => {
		const ids = Object.keys(UNARBITRATED).map(Number);
		expect(ids.sort((a, b) => a - b)).toEqual([20154, 20165, 31801, 62124, 105593]);
	});
});

describe('the Protection ladder walks the committed pulls', () => {
	it('sweeps the five, found rather than listed', () => {
		expect(PULLS.map(([name]) => name)).toEqual([
			'fallenProtectors.json',
			'galakras.json',
			'garrosh.json',
			'paragons.json',
			'spoils.json',
		]);
	});

	/**
	 * **Not one press on any of the five is `unknown`**, and that is the finding rather than a formality.
	 *
	 * Every condition on this ladder reads something off the log, and four of them can decline to answer:
	 * three auras that a pull may simply never have carried, plus the enemy-health stream that Hammer of
	 * Wrath's rung is built on and that the Windwalker's fetch does not carry at all. A single one of
	 * those coming back silent withholds the verdict on every press beneath it — the Elemental measured
	 * that at 88% of one pull — so a zero here is the evidence that all four inputs really arrived.
	 *
	 * It is also the assertion that would catch the cheapest way to break this file: renaming an aura key
	 * in `data.ts` without renaming it in the ladder. The rung would find no windows, answer `'unknown'`
	 * for the whole pull, and nothing else in the suite would notice.
	 */
	it('answers every press on every pull', () => {
		for (const [name, analysis] of PULLS) {
			expect(analysis.apl?.unknown, name).toBe(0);
			expect(analysis.apl?.characterUnread ?? false, name).toBe(false);
		}
	});

	/**
	 * The delegated buttons come back `off-list` with somewhere named, rather than charged to a rung.
	 *
	 * The taunt is the one that matters: 18 presses on `paragons` and 10 on `garrosh`, every one of them
	 * a global spent on the encounter rather than on damage. Without the declaration each would be walked
	 * down the list and charged to whichever filler rung claimed the global, which is the defect
	 * `UNARBITRATED` exists to remove — and the count is large enough that it would visibly move the
	 * section's headline.
	 */
	it('delegates the taunt instead of charging it to a filler', () => {
		const taunts = PULLS.map(([name, analysis]): [string, number] => [
			name,
			(analysis.apl?.presses ?? []).filter((press) => press.pressed === 62124).length,
		]);
		expect(taunts).toEqual([
			['fallenProtectors.json', 0],
			['galakras.json', 2],
			['garrosh.json', 10],
			['paragons.json', 18],
			['spoils.json', 4],
		]);
		for (const [name, analysis] of PULLS) {
			const delegated = (analysis.apl?.presses ?? []).filter((press) => press.pressed === 62124);
			expect(
				delegated.every((press) => press.verdict === 'off-list' && press.reason === 'globals'),
				name,
			).toBe(true);
		}
	});

	/**
	 * Forcing the band changes the walk, and it changes it in the one place the two lists differ.
	 *
	 * The counterfactual is the point of `aplForced` and it is easy to ship dead: a ladder whose gates
	 * are all `undefined` gives four identical walks, which is what the Elemental's did before it banded
	 * anything. Here band 1 has to differ from bands 2, 3 and 4 — it is the shipped file's builder and
	 * Consecration order — while 2, 3 and 4 have to agree with each other, because no rung on this ladder
	 * tells a second enemy from a fifth.
	 *
	 * Asserted as relations rather than as numbers, so a rung's condition can be corrected without
	 * anybody having to re-bless five counts.
	 */
	it('reads a pull differently at one target than at two, and the same at two as at five', () => {
		for (const [name, analysis] of PULLS) {
			const at = (band: 1 | 2 | 3 | 4) => analysis.aplForced?.[band];
			expect(at(2)?.followed, name).toBe(at(3)?.followed);
			expect(at(3)?.followed, name).toBe(at(4)?.followed);
			expect(at(1)?.followed, name).not.toBe(at(2)?.followed);
			// And every forced walk judges the same presses — a band gate moves which rung claims a global,
			// never whether the global was seen.
			const judged = (band: 1 | 2 | 3 | 4) => (at(band)?.followed ?? 0) + (at(band)?.skipped ?? 0);
			expect(
				ALL_BANDS.map(judged).every((total) => total === judged(1)),
				name,
			).toBe(true);
		}
	});

	/**
	 * Hammer of Wrath is wanted in the execute and nowhere else, which is the rung's whole content.
	 *
	 * The list writes it unconditionally because the *spell* carries the gate, so a transcription that
	 * took the list at its word would demand the button from the pull's first global. Read off the
	 * verdicts rather than off the window set: what matters is that the rung never claims a global
	 * outside the window, not that the window is a particular shape.
	 */
	it('never wants Hammer of Wrath outside the execute', () => {
		for (const [name, analysis] of PULLS) {
			const windows = (analysis.timeline?.lanes ?? []).length;
			expect(windows, name).toBeGreaterThan(0);
			const wanted = (analysis.apl?.presses ?? []).filter((press) => press.wanted === 'hammer-of-wrath');
			// Every pull's enemies reach the execute — all five captures are kills or near-kills — so the
			// rung has to claim something on each. A zero here would mean the health readings stopped
			// arriving, which is the failure this rung is most exposed to.
			expect(wanted.length > 0, name).toBe(true);
		}
	});
});
