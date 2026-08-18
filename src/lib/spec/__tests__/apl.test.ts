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
	rushingJadeWind: 116847,
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
		// Five minutes, which is on the long side of entry 31's 75-second line rather than near it. Only
		// that rule reads the length, and it reads it as a switch: under the line the wind is wanted from
		// the bottom rung unconditionally, over it only when the bar is about to overflow. Every case here
		// but the one that names it wants the over-the-line reading, which is also what a raid pull is.
		pullMs: 300_000,
		// Tiger Power up and not expiring, so the refresh rule is decidably *not* wanted rather than
		// unknown — the tests that want the unknown ask for it explicitly.
		auras: { 'tiger-power': throughout },
		fofChannelSec: 4,
		// One target throughout unless a test says otherwise, which keeps every existing case reading
		// against the same list it was written for.
		targetsAt: () => 1,
		...over,
	};
}

describe('the priority ladder', () => {
	it('grades an add fight against the list the adds were in, rather than refusing it', () => {
		// This used to return null on the grounds that the ladder was the single-target list. It is not:
		// the APL bands on target count, so a wave fight gets judged against what the list wanted during
		// the waves. Refusing it meant a Galakras pull got no priority section at all.
		const audit = aplAudit(inputs({ targetsAt: () => 4, casts: [press(1000, ID.jab)] }));
		expect(audit).not.toBeNull();
		expect(audit?.presses).toHaveLength(1);
	});

	it('refuses a log with no resource readings', () => {
		// Not an empty audit: "no mistakes" and "could not tell" are different answers, and a pull
		// fetched without `includeResources` has to produce the second one.
		expect(aplAudit(inputs({ chi: { max: 4, points: [] }, casts: [press(1000, ID.jab)] }))).toBeNull();
	});

	/**
	 * The same refusal, applied to the part of a pull the curve does not cover.
	 *
	 * A bar opens at its first reading, and chi's first reading lands on the first press that carries
	 * one — up to 7.9 seconds into a pull on the reference logs. Before it the reader answered zero,
	 * which is not the absence of an answer but a specific claim: with no chi every spender on the list
	 * is unaffordable, so the walk falls past six rungs and hands the press a confident verdict against
	 * whatever it lands on. On the six committed fixtures that is between one and four presses each.
	 *
	 * The press here is a Blackout Kick made before any reading, with a full energy bar and a Rising Sun
	 * Kick sitting above it. Whether the kick was the button the list wanted turns entirely on chi that
	 * this log does not have, so the answer is silence.
	 */
	it('says nothing about a press made before the bars were ever read', () => {
		const audit = aplAudit(
			inputs({
				chi: { max: 4, points: [[5000, 3]] },
				casts: [press(1000, ID.blackoutKick)],
			}),
		);

		expect(audit?.presses[0]).toMatchObject({ verdict: 'unknown', wanted: null });
		expect(audit?.unknown).toBe(1);
	});

	/** And the same press once the curve covers it: a reading turns the silence back into a verdict. */
	it('judges the same press once a reading covers it', () => {
		const audit = aplAudit(
			inputs({
				chi: { max: 4, points: [[0, 3]] },
				casts: [press(1000, ID.blackoutKick)],
			}),
		);

		expect(audit?.presses[0]).toMatchObject({ verdict: 'skipped', wanted: 'rising-sun-kick-filler' });
		expect(audit?.unknown).toBe(0);
	});

	/**
	 * A regen rate the log could not measure used to read as zero seconds from the cap.
	 *
	 * Which is not "no data" — it is the claim that the bar is overflowing at this instant, and entry 31
	 * spends exactly that on Rushing Jade Wind. So every global of such a pull was handed a wanted wind
	 * it had no evidence for, while the three rungs above it that ask for *room* in the bar were all
	 * falsified by the same number.
	 */
	it('does not hand Rushing Jade Wind a global on a pull whose regen was never measured', () => {
		const base = {
			// Three of four, so the generator's "room for two chi" is false and the walk reaches the bottom
			// rungs. Rising Sun Kick is put on its cooldown by the press at zero, and the wind is pressed
			// once late in the pull so the talent gate opens without putting the rung on cooldown.
			chi: flat(4, 3),
			energy: flat(100, 99),
			casts: [press(0, ID.risingSunKick), press(5000, ID.jab), press(60_000, ID.rushingJadeWind)],
		};

		// A measured rate: a tenth of a second from the cap, which is the overflow entry 31 spends.
		const measured = aplAudit(inputs({ ...base, regenPerSec: 10 }));
		expect(measured?.presses[1]).toMatchObject({
			verdict: 'skipped',
			wanted: 'rushing-jade-wind',
			reason: 'energy-cap',
		});

		// The same pull with nothing to measure the rate from. It used to read as zero seconds to cap,
		// which is the strongest possible form of the same claim, and named the wind at that global too.
		const unmeasured = aplAudit(inputs({ ...base, regenPerSec: 0 }));
		expect(unmeasured?.presses[1]).toMatchObject({ verdict: 'unknown', wanted: null });
	});

	/**
	 * At one target the kick's rung is entry 21, not entry 18.
	 *
	 * Entry 18 carries a leading `Targets: More than 1` and so does not exist at a single enemy; the
	 * kick is claimed instead by the unconditional entry 21 below Tiger Palm's refresh. Same button,
	 * same cost, same cooldown, a different rule key — which is why these cases name the filler.
	 */
	it('names Rising Sun Kick when a lower button was pressed with the chi to afford it', () => {
		const audit = aplAudit(inputs({ chi: flat(4, 2), casts: [press(5000, ID.jab)] }));
		expect(audit?.presses[0]).toMatchObject({ verdict: 'skipped', wanted: 'rising-sun-kick-filler' });
		expect(audit?.skippedBy).toEqual([{ key: 'rising-sun-kick-filler', id: ID.risingSunKick, count: 1 }]);
	});

	it('counts the same press as followed when it is the button the list wanted', () => {
		const audit = aplAudit(inputs({ chi: flat(4, 2), casts: [press(5000, ID.risingSunKick)] }));
		expect(audit?.presses[0]).toMatchObject({ verdict: 'followed', wanted: 'rising-sun-kick-filler' });
		expect(audit?.followed).toBe(1);
		expect(audit?.skipped).toBe(0);
	});

	it('names entry 18 instead once there is a second target', () => {
		// The other side of that gate, and the only difference between the two readings of this press.
		const audit = aplAudit(inputs({ targetsAt: () => 2, chi: flat(4, 2), casts: [press(5000, ID.risingSunKick)] }));
		expect(audit?.presses[0]).toMatchObject({ verdict: 'followed', wanted: 'rising-sun-kick' });
	});

	it('stops demanding Rising Sun Kick while it is on cooldown', () => {
		// Eight seconds, from the sim's own spell config. The second press is inside it.
		const audit = aplAudit(inputs({ chi: flat(4, 2), casts: [press(1000, ID.risingSunKick), press(3000, ID.jab)] }));
		expect(audit?.presses[1]?.wanted).not.toBe('rising-sun-kick-filler');
	});

	it('demands it again once the cooldown is up', () => {
		const audit = aplAudit(inputs({ chi: flat(4, 2), casts: [press(1000, ID.risingSunKick), press(9500, ID.jab)] }));
		expect(audit?.presses[1]).toMatchObject({ verdict: 'skipped', wanted: 'rising-sun-kick-filler' });
	});

	it('never demands a button the player could not pay for', () => {
		// One chi is not two. A kick that could not be cast is a resource problem, not a priority
		// mistake, and the sections that argue about energy and chi are where it belongs.
		const audit = aplAudit(inputs({ chi: flat(4, 1), casts: [press(5000, ID.jab)] }));
		expect(audit?.presses[0]?.wanted).not.toBe('rising-sun-kick-filler');
	});

	it('knocks a point off the cost when the tier-16 four-piece is worn', () => {
		const one = { chi: flat(4, 1), casts: [press(5000, ID.jab)] };
		expect(aplAudit(inputs(one))?.presses[0]?.wanted).not.toBe('rising-sun-kick-filler');
		expect(aplAudit(inputs({ ...one, chiCostReduction: 1 }))?.presses[0]).toMatchObject({
			verdict: 'skipped',
			wanted: 'rising-sun-kick-filler',
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

	it('never names the unconditional kick at exactly two targets', () => {
		// Entry 21 carries `bands: [1, 3, 4]`, and the missing 2 states a fact the walk already had rather
		// than changing it: at exactly two targets entry 18 above is the same button at the same cost with
		// the same cooldown and an unconditionally true condition, so the only ways past it — `!ready` and
		// `!affordable` — are predicates entry 21 fails identically.
		//
		// One target used to be the same story and is not any more: entry 18's leading `Targets: More than
		// 1` takes it off the list there, so entry 21 is the kick's only rung and the cases above name it.
		//
		// Both of those routes are exercised here. It matters because the reference table renders off
		// these bands: without them a two-target reader is shown Rising Sun Kick on two rungs with nothing
		// to tell them apart, and with them no verdict may move.
		const onCooldown = aplAudit(
			inputs({
				targetsAt: () => 2,
				chi: flat(4, 4),
				casts: [press(1000, ID.risingSunKick), press(3000, ID.jab)],
			}),
		);
		const cannotAfford = aplAudit(inputs({ targetsAt: () => 2, chi: flat(4, 0), casts: [press(5000, ID.jab)] }));
		for (const audit of [onCooldown, cannotAfford]) {
			for (const p of audit?.presses ?? []) expect(p.wanted).not.toBe('rising-sun-kick-filler');
		}
	});

	/**
	 * Entry 31, which used to be a free fallthrough and is now a gate.
	 *
	 * `(currentTime + remainingTime) < 75s or energyTimeToCap <= 1s`, and the first half is a fact about
	 * the pull rather than the press — the two terms sum to the whole fight's length. So a long pull
	 * leaves this rung with the overflow check alone, which is the reading a raid log is always under.
	 *
	 * Each case puts Rising Sun Kick on cooldown and holds three chi, so every rung above the wind is
	 * either unaffordable or unwanted and this one is the first that could claim the global.
	 */
	it('wants the bottom Rushing Jade Wind rung only on a short pull or a filling bar', () => {
		const base = {
			chi: flat(4, 3),
			// Half a bar: five seconds from the cap at this regen, which is well clear of the rule's one.
			energy: flat(100, 50),
			// Longer than those five seconds, so Fists of Fury above stands down rather than claiming this.
			fofChannelSec: 6,
			casts: [press(1000, ID.risingSunKick), press(3000, ID.rushingJadeWind)],
		};
		const long = aplAudit(inputs(base));
		expect(long?.presses[1]).toMatchObject({ verdict: 'skipped', wanted: 'blackout-kick' });

		const short = aplAudit(inputs({ ...base, pullMs: 60_000 }));
		expect(short?.presses[1]).toMatchObject({ verdict: 'followed', wanted: 'rushing-jade-wind', reason: 'short-pull' });

		// The same long pull half a second from the cap: the wind is what the list spends the overflow on.
		const capping = aplAudit(inputs({ ...base, energy: flat(100, 95) }));
		expect(capping?.presses[1]).toMatchObject({
			verdict: 'followed',
			wanted: 'rushing-jade-wind',
			reason: 'energy-cap',
		});
	});

	it('wants the bottom Rushing Jade Wind rung during Bloodlust and Energizing Brew', () => {
		const audit = aplAudit(
			inputs({
				energy: flat(100, 50),
				chi: flat(4, 3),
				fofChannelSec: 6,
				auras: {
					'tiger-power': throughout,
					bloodlust: throughout,
					'energizing-brew': throughout,
				},
				casts: [press(0, ID.risingSunKick), press(1000, ID.rushingJadeWind)],
			}),
		);

		expect(audit?.presses[1]).toMatchObject({
			verdict: 'followed',
			wanted: 'rushing-jade-wind',
			reason: 'haste-window',
		});
	});
});
