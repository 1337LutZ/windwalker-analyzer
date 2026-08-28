// Earth Shock is not pressed inside Ascendance, and the charges that pile up while it is not are not overcap.
//
// **The user's rule, and not one of the sim's — said first because everything else in this audit is the
// other way round.** `ui/shaman/elemental/apls/p5.apl.json`'s `Earth Shock Rules` names 114049 exactly
// once, as `spellTimeToReady(114049) >= 6s`, which is the `ascReady` hold *before* the cooldown and not a
// refusal during it. The sim will happily shock inside its own Ascendance. This rule is the user's, and it
// is recorded as theirs because a rule whose provenance is not written down is one nobody can check later.
//
// The argument for it: Ascendance takes the cooldown off Lava Burst for fifteen seconds, so every global
// inside the window is a Lava Burst the player would not otherwise have had. A shock spends one of them,
// and it spends it on emptying a shield the window has no use for emptying.
//
// The corollary is the second half of this file. A player told to hold the shock and then charged for the
// charges that stack up while they hold it has been marked down for following the instruction, so the
// overcap clock stops at the window's edges too. Only that clock: `dischargeScoredMs` beside it is a
// maintenance uptime of a debuff that keeps running whether or not a shock lands.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { complementOf, intersect, type Interval, unionMs } from '~/lib/analysis/intervals';
import type { Analysis, ElementalAuditResult, FightDataset, Window } from '~/lib/types';
import { analyse } from '~/specs/elemental/lib';

const load = (name: string): Analysis & ElementalAuditResult =>
	analyse(
		JSON.parse(readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8')) as FightDataset,
	) as Analysis & ElementalAuditResult;

const toIntervals = (windows: readonly Window[]): Interval[] => windows.map((w): Interval => [w.start, w.end]);
const ms = (windows: readonly Window[]) => unionMs(toIntervals(windows));

/**
 * The two committed pulls that press a shock inside the window, and the two that do not.
 *
 * Written out rather than discovered, because "which pulls can show this" is the finding: a rule that
 * fires on no committed pull is a rule nothing measured, and one that fires on all four has no control.
 */
const PRESSED_INSIDE: Record<string, number> = { phased: 204_259, addsThenBoss: 545_726 };
const PRESSED_OUTSIDE = ['cleave', 'unbroken'] as const;

describe('Earth Shock inside Ascendance', () => {
	it('faults the press, on the two committed pulls that make one', () => {
		for (const [name, t] of Object.entries(PRESSED_INSIDE)) {
			const el = load(name);
			const press = el.earthShock.presses.find((p) => p.t === t);
			expect(press, name).toBeDefined();
			// Inside the window by the audit's own published array, so the fixture fact and the rule's input
			// are the same reading rather than two.
			expect(
				toIntervals(el.lightningShield.ascendanceWindows).some(([start, end]) => t >= start && t <= end),
				name,
			).toBe(true);
			expect(press?.good, name).toBe(false);
		}
	});

	/**
	 * **And it stands alone on the press**, which is the half of the rule a reader feels.
	 *
	 * A shock that should not have been pressed at all is not also "below seven charges" or "the dot was
	 * short": those are the list's conditions for *when to spend*, and the answer here is not now. Telling
	 * a reader both is telling them to fix the smaller thing.
	 */
	it('is the only reason on the press, whatever else was true at the time', () => {
		for (const [name, t] of Object.entries(PRESSED_INSIDE)) {
			const press = load(name).earthShock.presses.find((p) => p.t === t);
			expect(press?.reasons, name).toEqual(['ascActive']);
		}
	});

	/**
	 * It keeps the press out of the shield's bad-spend ledger, and that follows from the line above rather
	 * than being arranged separately.
	 *
	 * `badSpends` reads `ES_STACK_REASONS` off the press's own verdict — "spent under the stacks this
	 * band's list asks for" — and the list did not ask for this press at any stack count.
	 */
	it('keeps the press out of the bad-spend ledger', () => {
		for (const [name, t] of Object.entries(PRESSED_INSIDE)) {
			expect(
				load(name).lightningShield.badSpends.map((s) => s.t),
				name,
			).not.toContain(t);
		}
	});

	/** The control: two pulls press no shock inside the window, and no press on them carries the reason. */
	it('names no press on the two pulls that never shock inside it', () => {
		for (const name of PRESSED_OUTSIDE) {
			const el = load(name);
			// Non-vacuous — both pulls do press Ascendance, so the window exists to be pressed inside.
			expect(ms(el.lightningShield.ascendanceWindows), name).toBeGreaterThan(0);
			expect(
				el.earthShock.presses.filter((p) => p.reasons.includes('ascActive')),
				name,
			).toEqual([]);
		}
	});

	/**
	 * The corollary: the overcap clock is the graded clock less the window, on every pull.
	 *
	 * Derived rather than pinned, so a fixture recapture moves both sides together — and the figures the
	 * derivation is worth are pinned underneath it.
	 */
	it('takes the window out of the overcap clock and out of nothing else', () => {
		for (const name of ['phased', 'unbroken', 'cleave', 'addsThenBoss'] as const) {
			const el = load(name);
			const contact = (el.timeline?.contactSegments ?? []).map(([start, end]): Interval => [start, end]);
			const graded = intersect(contact, complementOf(toIntervals(el.lightningShield.exemptWindows), el.durationMs));
			expect(el.lightningShield.gradedMs, name).toBe(
				unionMs(intersect(graded, complementOf(toIntervals(el.lightningShield.ascendanceWindows), el.durationMs))),
			);
			// Elemental Discharge's denominator is the clock *without* that cut, which is the whole of what
			// makes these two arrays rather than one.
			expect(el.earthShock.dischargeScoredMs, name).toBe(el.earthShock.dischargeScoredMs === 0 ? 0 : unionMs(graded));
		}
		// What it is worth on the pull where it is worth most: `phased` sits at seven through its own
		// Ascendance, and its overcap falls from 17 568ms to 12 352ms — which takes the section from `bad`
		// to `ok`, so this is a figure with a letter behind it rather than a rounding.
		expect(load('phased').lightningShield.overcapMs).toBe(12_352);
		// And the no-change end of it: `unbroken` presses Ascendance in its opener, before the shield has
		// reached the ceiling, so the cut takes none of its overcap at all.
		expect(load('unbroken').lightningShield.overcapMs).toBe(4514);
		expect(ms(load('unbroken').lightningShield.ascendanceWindows)).toBeGreaterThan(0);
	});
});
