// The Protection spell table, and the four things about it that no other spec in this tree has.
//
// `createRegistry` already refuses a duplicate key, an id claimed twice, a dangling aura link and a
// dot whose three numbers disagree — constructing the registry at all is most of this file's value,
// and it happens on import. What is asserted below is what the Paladin added to the model: a shared
// cooldown, an echo, a press the log only shows as an aura, and a cooldown that moves with haste.

import { describe, expect, it } from 'vitest';

import { GCD_MS, PROTECTION, registry, SOTR_COST } from '../data';
import { BASE_GCD_MS, GCD_FLOOR_MS, cooldownMsFor, gcdMsFor, hasteFromRating } from '~/lib/analysis/haste';

describe('the Protection spell table', () => {
	/** Construction is the test. `createRegistry` throws on every link it cannot resolve. */
	it('builds a registry', () => {
		expect(PROTECTION.abilities.length).toBeGreaterThan(10);
		expect(registry.ability('shield-of-the-righteous').gate).toBe('holy-power');
	});

	/**
	 * The two builders sit on one timer, and both halves say so.
	 *
	 * `sim/paladin/crusader_strike.go` and `hammer_of_the_righteous.go` both take
	 * `paladin.BuilderCooldown()`. Declared on one side only, a drift figure per button would report
	 * the same idle seconds twice — and nothing would fail, which is why the registry checks the pair
	 * agrees rather than trusting one file.
	 */
	it('declares the shared builder cooldown on both halves', () => {
		const cs = registry.ability('crusader-strike');
		const hotr = registry.ability('hammer-of-the-righteous');

		expect(cs.sharesCooldownWith).toBe('hammer-of-the-righteous');
		expect(hotr.sharesCooldownWith).toBe('crusader-strike');
		expect(cs.cooldownMs).toBe(hotr.cooldownMs);
	});

	/**
	 * An echo is a cast event that is not a press, and it must not resolve as one.
	 *
	 * Hammer of the Righteous logs a cast under its cleave id as well as its own — five of each on a
	 * reference pull, one press apiece. Counted as presses, one button reads as two.
	 *
	 * The fork declared a second echo, id 1, so an auto-attack's 116 cast events were explicitly not
	 * presses. That is a better treatment than either other spec has and it is not here: the melee
	 * entry it hung off named a shared thing, and moving it to `SHARED_ABILITIES` so all three specs
	 * could keep it would move the Windwalker's own cast counts. See the note in `data.ts`.
	 */
	it('knows an echoed cast from a press', () => {
		expect(registry.isEchoCast(88_263)).toBe(true);
		// And the echo id is not *also* a cast id, which is the ambiguity naming it removes.
		expect(registry.abilityByCastId(88_263)).toBeUndefined();
		// The cleave is still damage, and belongs in the damage table under the button that dealt it.
		expect(registry.abilityByDamageId(88_263)?.key).toBe('hammer-of-the-righteous');
		// The real press still resolves.
		expect(registry.abilityByCastId(53_595)?.key).toBe('hammer-of-the-righteous');
	});

	/**
	 * The press the log does not report at all.
	 *
	 * Traced through a whole pull, Execution Sentence shows up as thirty ticks of damage, three debuff
	 * applications and three removals — and no `cast` event under any id. Until that was found, every
	 * press of it was missing from the global count and the ladder's talent gate stayed shut for a
	 * player demonstrably using it.
	 */
	it('reads Execution Sentence off the debuff, because the log emits no cast for it', () => {
		const es = registry.ability('execution-sentence');
		expect(es.pressSeenAsAura).toBe('execution-sentence');
		// The aura it names has to exist, or the press is read off nothing.
		expect(registry.aura(es.pressSeenAsAura!).key).toBe('execution-sentence');
	});

	/**
	 * Which buttons haste shortens, and which it does not.
	 *
	 * Sanctity of Battle's mask covers the generators and Shield of the Righteous. The level 90 talents
	 * are outside it, and so is Avenging Wrath — declaring either as haste-scaled would shorten a
	 * cooldown the game does not, and hand the player lost casts they never had.
	 */
	it('scales the builders with haste and leaves the talents alone', () => {
		const scaled = PROTECTION.abilities.filter((a) => a.hasteScaled === true).map((a) => a.key);
		expect(scaled).toContain('crusader-strike');
		expect(scaled).toContain('judgment');
		expect(scaled).toContain('holy-wrath');
		expect(scaled).toContain('consecration');

		expect(registry.ability('execution-sentence').hasteScaled).toBeUndefined();
		expect(registry.ability('avenging-wrath').hasteScaled).toBeUndefined();
	});

	/** The spender costs three whatever the bar holds, which is what makes holding past three a choice. */
	it('spends a flat three holy power on Shield of the Righteous', () => {
		expect(SOTR_COST).toBe(3);
	});
});

describe('the haste model', () => {
	/**
	 * The floor, and the reason it is the constant the spec declares as its global.
	 *
	 * `sanctity_of_battle.go` reduces the global by `min(0.5s, 1.5s - 1.5s / haste)` — a *capped*
	 * reduction — so from 50% haste upwards every player has the same 1.0s global however fast they
	 * get. Bloodlust over a geared pull buys shorter cooldowns and not a shorter global.
	 */
	it('floors the global at a second, and gets there at fifty percent haste', () => {
		expect(GCD_MS).toBe(GCD_FLOOR_MS);
		expect(gcdMsFor(1)).toBe(BASE_GCD_MS);
		expect(gcdMsFor(1.5)).toBe(GCD_FLOOR_MS);
		expect(gcdMsFor(1.95)).toBe(GCD_FLOOR_MS);
		// And in between it is the sim's arithmetic in the sim's order: cap the reduction, then subtract.
		expect(gcdMsFor(1.25)).toBe(1200);
	});

	/**
	 * The mask is a replacement for the generic path, and the two are one function.
	 *
	 * `SpellMaskSanctityOfBattleProtGcd` names four spells, and read as an exclusion list it would mean
	 * Avenger's Shield, Consecration and Holy Wrath keep a full global while their cooldowns shorten.
	 * It is not one: those four are exactly the spells carrying `IgnoreHaste: true`, which is the flag
	 * that makes `cast.go:130` skip a spell — everything without it already has its global divided by
	 * haste there. So Sanctity stands in for the generic path on the spells that opted out of it, and
	 * `gcdMsFor` is right to treat the global as one number for every button.
	 *
	 * Asserted across the range rather than argued in prose, because the identity is what makes the
	 * substitution exact rather than close: the cap on one side is the floor on the other.
	 */
	it('gives the same global as the generic divide, at every haste', () => {
		for (const haste of [1.01, 1.1, 1.25, 1.478, 1.5, 1.5519, 1.95, 3]) {
			expect(gcdMsFor(haste)).toBe(Math.round(Math.max(GCD_FLOOR_MS, BASE_GCD_MS / haste)));
		}
	});

	/**
	 * The rating conversion, checked against the reference pull the model was built on.
	 *
	 * `HasteRatingPerHastePercent = 425.0` in `sim/core/base_stats_auto_gen.go`, and 18363 rating is
	 * the 43.2% the author measured their own character at.
	 */
	it('converts rating at the sim’s own rate', () => {
		expect(hasteFromRating(18_363)).toBeCloseTo(1.4321, 4);
		expect(hasteFromRating(0)).toBe(1);
	});

	/**
	 * And the cooldown floors that settled the seal's size, which is the whole argument for 5%.
	 *
	 * A haste-scaled cooldown's floor is visible in the press stream: press a button the instant it
	 * returns and the shortest gap between presses *is* the cooldown. At 18363 rating with the seal
	 * over it — 1.5037 — these are the numbers nine reference kills observed, to the millisecond.
	 */
	it('predicts the cooldown floors the reference kills observed', () => {
		const haste = hasteFromRating(18_363) * 1.05;
		expect(cooldownMsFor(4500, haste)).toBe(2993); // Crusader Strike, observed 2992
		expect(cooldownMsFor(6000, haste)).toBe(3990); // Judgment, observed 3979
		expect(cooldownMsFor(9000, haste)).toBe(5985); // Holy Wrath, observed 5984
	});
});
