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

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';

import { analyse } from '../index';

const FIXTURES = ['unbroken', 'phased', 'cleave'] as const;
type Fixture = (typeof FIXTURES)[number];

const load = (name: Fixture): FightDataset =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8')) as FightDataset;

const el: Record<Fixture, Analysis & ElementalAuditResult> = {
	unbroken: analyse(load('unbroken')) as Analysis & ElementalAuditResult,
	phased: analyse(load('phased')) as Analysis & ElementalAuditResult,
	cleave: analyse(load('cleave')) as Analysis & ElementalAuditResult,
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
		expect(el.cleave.flameShock.presses.map((p) => p.band)).toEqual([1, 1, 2, 4, 1, 4, 1, 4, 4, 2]);
		// And the two pulls that never leave one enemy read 1 throughout, which is the same fact from the
		// other side — `score.ts` already says these two judge every refresh they have.
		expect(new Set(el.phased.flameShock.presses.map((p) => p.band))).toEqual(new Set([1]));
		expect(new Set(el.unbroken.flameShock.presses.map((p) => p.band))).toEqual(new Set([1]));
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
			for (const press of el[name].flameShock.presses) {
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
		const unjudged = el.cleave.flameShock.presses.filter((p) => !p.judged);
		expect(unjudged.map((p) => p.band)).toEqual([2, 4, 4, 4, 4, 2]);
		// Non-vacuous in both directions: the pull judges presses too, so this is a split rather than a pull
		// with nothing on one side of it.
		expect(el.cleave.flameShock.presses.filter((p) => p.judged).length).toBe(4);
	});
});
