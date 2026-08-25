import { describe, expect, it } from 'vitest';

import type { WclEvent } from '~/lib/types';

import { maxHealthFrom, readGear } from '../gear';

/**
 * The slot array as `combatantinfo` gives it: positional, eighteen long, empty slots included.
 *
 * Built by hand rather than taken from a fixture because every committed fixture is a fully
 * enchanted raider — the case this section exists to catch does not appear in any of them.
 */
const gearEvent = (
	gear: Array<Record<string, unknown>>,
	sourceID = 10,
	extra: Record<string, unknown> = {},
): WclEvent => ({ type: 'combatantinfo', timestamp: 0, sourceID, gear, ...extra }) as unknown as WclEvent;

const piece = (over: Record<string, unknown> = {}) => ({
	id: 100000,
	itemLevel: 550,
	quality: 4,
	icon: 'inv_chest_leather.jpg',
	...over,
});

/** Slot order, so a test can name the slot it means. Matches `SLOTS` in the module under test. */
const at = (index: number, item: Record<string, unknown>) => {
	const slots = Array.from({ length: 18 }, () => ({ id: 0 }) as Record<string, unknown>);
	slots[index] = item;
	return slots;
};

describe('readGear', () => {
	it('reads the slot names off the array position', () => {
		const gear = readGear([gearEvent(at(14, piece({ id: 102247, itemLevel: 608, quality: 5 })))], 10);
		const back = gear.slots.find((s) => s.slot === 'Back');

		expect(back?.id).toBe(102247);
		expect(back?.itemLevel).toBe(608);
		expect(back?.quality).toBe(5);
	});

	/** The whole point of the section. */
	it('names an enchantable slot that is filled and carries no enchant', () => {
		const gear = readGear([gearEvent(at(4, piece()))], 10);
		expect(gear.missingEnchants).toEqual(['Chest']);
	});

	it('says nothing about a slot that is enchanted', () => {
		const gear = readGear([gearEvent(at(4, piece({ permanentEnchant: 4419 })))], 10);
		expect(gear.missingEnchants).toEqual([]);
	});

	/**
	 * `0` reaches the field as often as the key is absent, and both mean the same thing. Treating
	 * zero as an enchant id would silently clear the warning this exists to raise.
	 */
	it('treats a zero enchant id as no enchant', () => {
		const gear = readGear([gearEvent(at(4, piece({ permanentEnchant: 0 })))], 10);
		expect(gear.missingEnchants).toEqual(['Chest']);
		expect(gear.slots.find((s) => s.slot === 'Chest')?.enchantID).toBeNull();
	});

	/** An empty slot has nothing to enchant. A monk with one weapon is not making a mistake. */
	it('does not fault an empty slot', () => {
		const gear = readGear([gearEvent(at(4, { id: 0 }))], 10);
		expect(gear.missingEnchants).toEqual([]);
	});

	/**
	 * Rings are enchantable only by an enchanter, and head, neck, waist and trinkets take no enchant
	 * at all in Mists. Faulting either group would invent a mistake out of a profession the player
	 * does not have, or out of a rule the game does not run.
	 */
	it('never faults a profession-gated or unenchantable slot', () => {
		const bare = [0, 1, 5, 10, 11, 12, 13].map((index) => readGear([gearEvent(at(index, piece()))], 10));
		expect(bare.flatMap((g) => g.missingEnchants)).toEqual([]);
	});

	it('averages item level over what is worn, ignoring the shirt and tabard', () => {
		const slots = Array.from({ length: 18 }, () => ({ id: 0 }) as Record<string, unknown>);
		slots[0] = piece({ itemLevel: 500 });
		slots[4] = piece({ itemLevel: 600 });
		// A shirt is ilvl 1 and would drag the average to 367 if it counted.
		slots[3] = piece({ itemLevel: 1 });

		expect(readGear([gearEvent(slots)], 10).averageItemLevel).toBe(550);
	});

	it('counts gems across the set', () => {
		const slots = Array.from({ length: 18 }, () => ({ id: 0 }) as Record<string, unknown>);
		slots[0] = piece({
			gems: [
				{ id: 76680, icon: 'a.jpg' },
				{ id: 76672, icon: 'b.jpg' },
			],
		});
		slots[4] = piece({ gems: [{ id: 76680, icon: 'a.jpg' }] });

		expect(readGear([gearEvent(slots)], 10).gems).toBe(3);
	});

	/**
	 * The set id is what lets a tier piece's Wowhead tooltip say how much of the set is worn, so it
	 * has to survive the trip from the raw event into the model rather than being dropped on the way.
	 */
	it('carries the set id through to the slot', () => {
		const gear = readGear([gearEvent(at(0, piece({ setID: 1174 })))], 10);
		expect(gear.slots.find((s) => s.slot === 'Head')?.setID).toBe(1174);
	});

	/**
	 * Most items are in no set at all, and every fixture captured before this field was read is
	 * missing it entirely. Both have to mean "not tier" and neither may throw — an absent key left as
	 * `undefined` would reach the tooltip as the string "undefined".
	 */
	it('treats an absent or zero set id as no set', () => {
		expect(readGear([gearEvent(at(0, piece()))], 10).slots.find((s) => s.slot === 'Head')?.setID).toBeNull();
		expect(
			readGear([gearEvent(at(0, piece({ setID: 0 })))], 10).slots.find((s) => s.slot === 'Head')?.setID,
		).toBeNull();
	});

	/** Someone else's gear is not this player's. */
	it('reads the combatant this report is about', () => {
		const events = [gearEvent(at(4, piece({ id: 111 })), 99), gearEvent(at(4, piece({ id: 222 })), 10)];
		expect(readGear(events, 10).slots.find((s) => s.slot === 'Chest')?.id).toBe(222);
	});

	/** Not reported is not the same as nothing equipped, and the UI branches on the difference. */
	it('comes back empty when the log carried no combatant info', () => {
		expect(readGear([], 10)).toEqual({
			slots: [],
			averageItemLevel: null,
			missingEnchants: [],
			gems: 0,
			masteryRating: null,
			stamina: null,
			hasteRating: null,
		});
	});

	/**
	 * Mastery is the only stat that turns a count of Tigereye Brew stacks into a damage figure —
	 * `damagePerStack := 0.05 + ww.getMasteryPercent()` in the simulator — so it is read here rather
	 * than through a second request.
	 */
	it('reads the mastery rating off the same event as the gear', () => {
		expect(readGear([gearEvent(at(0, piece()), 10, { mastery: 7200 })], 10).masteryRating).toBe(7200);
	});

	/**
	 * The case every Mists Classic report actually presents. `mastery` is on the event and is `0`,
	 * sitting beside a believable `critMelee` and `hasteMelee` — WarcraftLogs declining to fill the
	 * field, not a character with no mastery, which nobody at level 90 is. Reading it as a real zero
	 * would give every pull the same invented per-stack figure.
	 */
	it('treats a reported zero as not reported', () => {
		expect(readGear([gearEvent(at(0, piece()), 10, { mastery: 0 })], 10).masteryRating).toBeNull();
	});

	it('says nothing when the field is absent altogether', () => {
		expect(readGear([gearEvent(at(0, piece()))], 10).masteryRating).toBeNull();
	});

	/**
	 * Stamina, on the same terms as the mastery above it and for a sharper reason: it is the only
	 * absolute health figure a Mists Classic log carries anywhere, because the player's health bar on
	 * these reports is a percentage. Touch of Karma absorbs exactly one health pool, so without this
	 * the section scoring it has nothing to divide by.
	 */
	it('reads the stamina off the same event, and treats a reported zero as not reported', () => {
		expect(readGear([gearEvent(at(0, piece()), 10, { stamina: 42_553 })], 10).stamina).toBe(42_553);
		expect(readGear([gearEvent(at(0, piece()), 10, { stamina: 0 })], 10).stamina).toBeNull();
		expect(readGear([gearEvent(at(0, piece()))], 10).stamina).toBeNull();
	});

	/**
	 * And the melee haste rating, on the same terms and for a sharper reason than either.
	 *
	 * A spec whose cooldowns move with haste divides by this, so a reported zero read as a real rating
	 * would give every cooldown a third more length than it had and invent lost casts for a pull with
	 * none. `hasteRanged` and `hasteSpell` arrive beside it and agree; the melee one is the term
	 * Sanctity of Battle reads.
	 */
	it('reads the melee haste rating, and treats a reported zero as not reported', () => {
		expect(readGear([gearEvent(at(0, piece()), 10, { hasteMelee: 18_363 })], 10).hasteRating).toBe(18_363);
		expect(readGear([gearEvent(at(0, piece()), 10, { hasteMelee: 0 })], 10).hasteRating).toBeNull();
		expect(readGear([gearEvent(at(0, piece()))], 10).hasteRating).toBeNull();
	});
});

/**
 * The health pool that stamina buys, pinned against pulls that measured it rather than against the
 * arithmetic restated.
 *
 * A Touch of Karma use that drains its pool absorbs exactly one pool, so a drained use *states* the
 * answer — which makes this one of the few conversions in the repository that can be checked against
 * the game rather than against its own source. All three numbers below are absorbs off real Mists
 * Classic pulls, taken by presses with no maximum-health buff up, or with one whose factor is known.
 */
describe('maxHealthFrom', () => {
	it('agrees with the pools real Touch of Karma uses drained', () => {
		// Ranked Siege pull, no health buff at the press: 742,145 absorbed, to the unit.
		expect(maxHealthFrom(42_553)).toBe(742_145);
		// `dataset-ironJuggernaut`'s monk, whose Garrosh use drained 805,148 under Ancestral Vigor.
		expect((maxHealthFrom(41_825) ?? 0) * 1.1).toBeCloseTo(805_148, 0);
		// And the same base under Fortifying Brew's fifth: 890,557 absorbed on a ranked Malkorok pull.
		expect((maxHealthFrom(42_552) ?? 0) * 1.2).toBeCloseTo(890_557, 0);
	});

	it('says nothing without a stamina to convert', () => {
		expect(maxHealthFrom(null)).toBeNull();
		expect(maxHealthFrom(undefined)).toBeNull();
		expect(maxHealthFrom(0)).toBeNull();
	});
});
