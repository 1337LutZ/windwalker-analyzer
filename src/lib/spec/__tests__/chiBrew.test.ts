import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Analysis } from '~/lib/types';

const fixture = (name: string): Analysis =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8'));

/**
 * Chi Brew's two failures are opposite, and the audit has to keep them apart: chi returned onto a
 * full bar is a press made at the wrong moment, while charges sitting at the ceiling is the press
 * not being made at all. Summing them into one "wasted" number would advise a player to fix one by
 * doing more of the other.
 *
 * The charge walk is the part worth pinning. It was written once with the recharge landing at
 * whichever moment the walk happened to be looking at rather than at the moment the charge actually
 * came back, which charged the pull nothing for the gap between a charge returning and the next
 * press — the exact gap the audit exists to measure.
 */
describe('the Chi Brew audit', () => {
	it('reads whether the talent was taken from the talent list, not from the button', () => {
		for (const name of ['strong', 'mixed', 'poor']) {
			const brew = fixture(name).chiBrew;
			expect(brew, name).toBeTruthy();
			if (brew === undefined) continue;
			// Three states, and `null` is a real one: a log with no character snapshot cannot say. What it
			// must never do is report "not talented" on the strength of an unpressed button.
			expect([true, false, null], name).toContain(brew.talented);
			if (brew.casts > 0) expect(brew.talented, `${name} pressed it, so it was taken`).toBe(true);
		}
	});

	it('never claims more chi was wasted than was gained', () => {
		for (const name of ['strong', 'mixed', 'poor']) {
			const brew = fixture(name).chiBrew;
			if (brew === undefined) continue;
			expect(brew.chiWasted, name).toBeLessThanOrEqual(brew.chiGained);
			expect(brew.chiWasted, name).toBeGreaterThanOrEqual(0);
		}
	});

	it('keeps idle-charge time inside the pull', () => {
		for (const name of ['strong', 'mixed', 'poor']) {
			const analysis = fixture(name);
			const brew = analysis.chiBrew;
			if (brew === undefined) continue;
			expect(brew.cappedMs, name).toBeGreaterThanOrEqual(0);
			expect(brew.cappedMs, name).toBeLessThanOrEqual(analysis.durationMs);
			// The percentage has to be the same fact as the milliseconds, or the two lines of copy that
			// quote them disagree in front of the reader.
			expect(brew.cappedPct, name).toBeCloseTo((brew.cappedMs / analysis.durationMs) * 100, 0);
		}
	});

	/**
	 * A player who never presses it should be charged for nearly the whole pull, because both charges
	 * are full from the opening bell and never move. This is the assertion the landing-time bug failed:
	 * with the recharge stamped at the wrong moment it reported a fraction of the real idle time.
	 */
	it('charges an unpressed pull for essentially all of it', () => {
		const unused = ['strong', 'mixed', 'poor'].map(fixture).find((a) => (a.chiBrew?.casts ?? 1) === 0);
		if (unused?.chiBrew === undefined) return; // No such pull in the reference set; nothing to assert.
		expect(unused.chiBrew.cappedPct).toBeGreaterThan(95);
	});

	it('offers a use count the pull could actually have supported', () => {
		for (const name of ['strong', 'mixed', 'poor']) {
			const analysis = fixture(name);
			const brew = analysis.chiBrew;
			if (brew === undefined) continue;
			// Two charges in hand at the pull, plus one per recharge. A target below what the player
			// managed would be a target nobody could fail.
			expect(brew.possibleUses, name).toBeGreaterThanOrEqual(brew.casts);
		}
	});
});
