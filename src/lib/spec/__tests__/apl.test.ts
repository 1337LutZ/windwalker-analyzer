import { describe, expect, it } from 'vitest';

import type { CastMark, ResourceCurve, Window } from '~/lib/types';

import { aplAudit, type AplInputs } from '../apl';

/**
 * The ladder is the one part of this report that can call a specific press a mistake, so what it
 * stays quiet about matters as much as what it flags. Most of these tests are about the silence:
 * a condition the log cannot answer, a talent the player did not take, a button they could not
 * afford. Each of those is a reason to say nothing rather than a reason to say "wrong".
 */

const ID = {
	risingSunKick: 107428,
	tigerPalm: 100787,
	blackoutKick: 100784,
	jab: 100780,
	chiWave: 115098,
	fistsOfFury: 113656,
} as const;

const press = (t: number, id: number, onGcd = true): CastMark => ({ t, id, name: `#${id}`, onGcd });

/** A bar that holds one value for the whole pull, which is all most of these cases need it to do. */
const flat = (max: number, amount: number): ResourceCurve => ({ max, points: [[0, amount]] });

/** A window covering the whole pull, so an aura is simply up throughout. */
const throughout: Window[] = [{ start: 0, end: 600_000 }];

function inputs(over: Partial<AplInputs> = {}): AplInputs {
	return {
		casts: [],
		// Full energy by default: it makes every "is there room in the bar" condition false, which keeps
		// the chi rules under test from competing with the energy ones.
		energy: flat(100, 100),
		chi: flat(4, 0),
		regenPerSec: 10,
		gcdMs: 1000,
		// Tiger Power up and not expiring, so the refresh rule is decidably *not* wanted rather than
		// unknown — the tests that want the unknown ask for it explicitly.
		auras: { 'tiger-power': throughout },
		fofChannelSec: 4,
		singleTarget: true,
		...over,
	};
}

describe('the priority ladder', () => {
	it('refuses an add fight rather than grading it against the single-target list', () => {
		expect(aplAudit(inputs({ singleTarget: false, casts: [press(1000, ID.jab)] }))).toBeNull();
	});

	it('refuses a log with no resource readings', () => {
		// Not an empty audit: "no mistakes" and "could not tell" are different answers, and a pull
		// fetched without `includeResources` has to produce the second one.
		expect(aplAudit(inputs({ chi: { max: 4, points: [] }, casts: [press(1000, ID.jab)] }))).toBeNull();
	});

	it('names Rising Sun Kick when a lower button was pressed with the chi to afford it', () => {
		const audit = aplAudit(inputs({ chi: flat(4, 2), casts: [press(5000, ID.jab)] }));
		expect(audit?.presses[0]).toMatchObject({ verdict: 'skipped', wanted: 'rising-sun-kick' });
		expect(audit?.skippedBy).toEqual([{ key: 'rising-sun-kick', id: ID.risingSunKick, count: 1 }]);
	});

	it('counts the same press as followed when it is the button the list wanted', () => {
		const audit = aplAudit(inputs({ chi: flat(4, 2), casts: [press(5000, ID.risingSunKick)] }));
		expect(audit?.presses[0]).toMatchObject({ verdict: 'followed', wanted: 'rising-sun-kick' });
		expect(audit?.followed).toBe(1);
		expect(audit?.skipped).toBe(0);
	});

	it('stops demanding Rising Sun Kick while it is on cooldown', () => {
		// Eight seconds, from the sim's own spell config. The second press is inside it.
		const audit = aplAudit(inputs({ chi: flat(4, 2), casts: [press(1000, ID.risingSunKick), press(3000, ID.jab)] }));
		expect(audit?.presses[1]?.wanted).not.toBe('rising-sun-kick');
	});

	it('demands it again once the cooldown is up', () => {
		const audit = aplAudit(inputs({ chi: flat(4, 2), casts: [press(1000, ID.risingSunKick), press(9500, ID.jab)] }));
		expect(audit?.presses[1]).toMatchObject({ verdict: 'skipped', wanted: 'rising-sun-kick' });
	});

	it('never demands a button the player could not pay for', () => {
		// One chi is not two. A kick that could not be cast is a resource problem, not a priority
		// mistake, and the sections that argue about energy and chi are where it belongs.
		const audit = aplAudit(inputs({ chi: flat(4, 1), casts: [press(5000, ID.jab)] }));
		expect(audit?.presses[0]?.wanted).not.toBe('rising-sun-kick');
	});

	it('knocks a point off the cost when the tier-16 four-piece is worn', () => {
		const one = { chi: flat(4, 1), casts: [press(5000, ID.jab)] };
		expect(aplAudit(inputs(one))?.presses[0]?.wanted).not.toBe('rising-sun-kick');
		expect(aplAudit(inputs({ ...one, chiCostReduction: 1 }))?.presses[0]).toMatchObject({
			verdict: 'skipped',
			wanted: 'rising-sun-kick',
		});
	});

	/**
	 * The regression the three-valued condition exists for.
	 *
	 * A log that never carried Tiger Power cannot say when it was about to fall off. Reading that as
	 * "never up, therefore always needs refreshing" would flag a correct press on every global.
	 */
	it('says nothing at all when Tiger Power is missing from the log', () => {
		const audit = aplAudit(inputs({ chi: flat(4, 1), auras: {}, casts: [press(5000, ID.jab)] }));
		expect(audit?.presses[0]).toMatchObject({ verdict: 'unknown', wanted: null });
		expect(audit?.unknown).toBe(1);
	});

	it('does not hold an unknown against the very button it is unsure about', () => {
		// The refresh rule cannot be evaluated, but the press *is* Tiger Palm — whatever the answer was,
		// pressing it cannot have been the mistake the unknown is hiding.
		const audit = aplAudit(inputs({ chi: flat(4, 1), auras: {}, casts: [press(5000, ID.tigerPalm)] }));
		expect(audit?.presses[0]?.verdict).toBe('followed');
	});

	it('wants Tiger Palm when Tiger Power is about to fall off', () => {
		const audit = aplAudit(
			inputs({
				chi: flat(4, 1),
				// Expires half a second after the press, inside the list's own one-second window.
				auras: { 'tiger-power': [{ start: 0, end: 5500 }] },
				casts: [press(5000, ID.jab)],
			}),
		);
		expect(audit?.presses[0]).toMatchObject({ verdict: 'skipped', wanted: 'tiger-palm-refresh' });
	});

	it('takes a free Blackout Kick over the generator', () => {
		const audit = aplAudit(
			inputs({
				chi: flat(4, 0),
				auras: { 'tiger-power': throughout, 'combo-breaker-blackout-kick': throughout },
				casts: [press(5000, ID.jab)],
			}),
		);
		// No chi at all, and the proc still wins: the press costs nothing, which is the whole point of it.
		expect(audit?.presses[0]).toMatchObject({ verdict: 'skipped', wanted: 'combo-breaker-kick' });
	});

	it('does not demand a talent the log never shows being pressed', () => {
		// Chi Wave sits above Jab, and its condition is satisfied here — but a player who did not take
		// it cannot press it, and this report cannot read a talent tree.
		const withRoom = { energy: flat(100, 0), chi: flat(4, 0), casts: [press(5000, ID.jab)] };
		expect(aplAudit(inputs(withRoom))?.presses[0]?.wanted).not.toBe('chi-wave');

		const took = aplAudit(inputs({ ...withRoom, casts: [press(2000, ID.chiWave), press(20_000, ID.jab)] }));
		expect(took?.presses[1]).toMatchObject({ verdict: 'skipped', wanted: 'chi-wave' });
	});

	/** Jab is gated by the room for the chi it returns and by energy — never by a chi cost it does not have. */
	it('gates Jab on headroom and energy, not on chi in hand', () => {
		const full = aplAudit(inputs({ chi: flat(4, 3), casts: [press(5000, ID.jab)] }));
		// Three of four chi: Jab would return two and throw one away, so the list does not want it.
		expect(full?.presses[0]?.wanted).not.toBe('jab');

		const broke = aplAudit(inputs({ energy: flat(100, 30), chi: flat(4, 0), casts: [press(5000, ID.jab)] }));
		// Room for the chi, but thirty energy does not pay for a forty-energy button.
		expect(broke?.presses[0]?.wanted).not.toBe('jab');

		const ready = aplAudit(inputs({ energy: flat(100, 100), chi: flat(4, 0), casts: [press(5000, ID.jab)] }));
		expect(ready?.presses[0]).toMatchObject({ verdict: 'followed', wanted: 'jab' });
	});

	it('holds the Combo Breaker palm out of the opener', () => {
		const proc = { 'tiger-power': throughout, 'combo-breaker-tiger-palm': throughout };
		// An empty bar, so the "there is room for the global it costs" half of the condition is true and
		// the clock is the only thing left deciding. On a full bar this rule is false for a reason the
		// test is not about, and the first assertion would pass while proving nothing.
		const room = { chi: flat(4, 0), energy: flat(100, 0), auras: proc };
		const opener = aplAudit(inputs({ ...room, casts: [press(20_000, ID.jab)] }));
		expect(opener?.presses[0]?.wanted).not.toBe('combo-breaker-palm');

		const later = aplAudit(inputs({ ...room, casts: [press(30_000, ID.jab)] }));
		expect(later?.presses[0]).toMatchObject({ verdict: 'skipped', wanted: 'combo-breaker-palm' });
	});

	it('takes an expiring Combo Breaker proc even with no room in the energy bar', () => {
		// The other half of that condition. A proc about to fall off is worth a global whatever the bar
		// is doing, which is why the rule is an `or` and not an `and`.
		const audit = aplAudit(
			inputs({
				chi: flat(4, 0),
				auras: { 'tiger-power': throughout, 'combo-breaker-tiger-palm': [{ start: 0, end: 30_500 }] },
				casts: [press(30_000, ID.jab)],
			}),
		);
		expect(audit?.presses[0]).toMatchObject({ verdict: 'skipped', wanted: 'combo-breaker-palm' });
	});

	it('ignores presses that cost no global', () => {
		const audit = aplAudit(inputs({ chi: flat(4, 2), casts: [press(5000, ID.risingSunKick, false)] }));
		expect(audit?.presses).toEqual([]);
	});

	it('calls a press nothing on the ladder wanted off-list rather than a mistake', () => {
		// No chi, full energy, no procs: every rule is either unaffordable or unwanted.
		const audit = aplAudit(inputs({ chi: flat(4, 0), energy: flat(100, 0), casts: [press(5000, 115203)] }));
		expect(audit?.presses[0]).toMatchObject({ verdict: 'off-list', wanted: null });
		expect(audit?.offList).toBe(1);
	});
});
