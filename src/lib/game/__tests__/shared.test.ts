// The shared item-effect declarations, pinned against what a log actually writes.
//
// Every id here was checked against three anonymous 25H Siege raid nights (~75 gear sets, 1,317 distinct
// friendly ids) and against the client data the simulator ships — `assets/database/db.json`, which is
// generated from DBC, rather than the hand-written Go overrides beside it. That distinction is the whole
// reason this file exists: for five stacking trinkets the Go override splits the effect into a "payload"
// aura and a "hidden tracker" and **the log inverts it every time**, so a declaration copied from the
// sim's own item files names an id the game never emits. That is the 144998 failure — a lane measuring
// nothing forever, with nothing failing — and these assertions are what would fail.
//
// Read through the registry rather than off the array. `auraById` is the lookup the engine itself uses
// on every event, so a test that asks it "what is 138786" is asking the same question the analysis asks;
// indexing `SHARED_AURAS` by hand would test a list comprehension instead.
import { describe, expect, it } from 'vitest';

import { createRegistry } from '~/lib/game/registry';
import { SHARED_ABILITIES, SHARED_AURAS } from '~/lib/game/shared';

const registry = createRegistry({ abilities: SHARED_ABILITIES, auras: SHARED_AURAS });

describe('the tinker grants your highest stat, and logs a different id for each', () => {
	/**
	 * The bug this pins: the aura carried 96228 alone, commented "always the buff. Measured on the
	 * reference pulls" — and it was, on reference pulls whose players were all monks, for whom the
	 * highest stat is always agility. A shaman's is intellect, so all three committed Elemental pulls
	 * pressed the tinker and could not draw the buff it put up.
	 *
	 * 96230 is asserted first because it is the one that was missing and the *most* common of the three
	 * across the sweep (3,068 applications against 2,072 for agility).
	 */
	it('resolves all three stat ids to the one effect', () => {
		expect(registry.auraById(96_230)?.key).toBe('synapse-springs');
		expect(registry.auraById(96_229)?.key).toBe('synapse-springs');
		expect(registry.auraById(96_228)?.key).toBe('synapse-springs');
	});

	/** Which stat it landed as is readable, on the same terms as Re-Origination's three ids. */
	it('names the stat each id encodes', () => {
		expect(registry.variantOf(96_228)).toBe('Agility');
		expect(registry.variantOf(96_229)).toBe('Strength');
		expect(registry.variantOf(96_230)).toBe('Intellect');
	});

	/** The press is a different id from every one of them, which is why the aura is declared apart. */
	it('keeps the press and the buff apart', () => {
		expect(registry.abilityByCastId(126_734)?.key).toBe('synapse-springs');
		expect(registry.auraById(126_734)).toBeUndefined();
	});
});

describe('the raid haste cooldown names whichever spell was cast', () => {
	/**
	 * 90355 is the Beast Mastery hunter's pet ability, and the label was the *later* name for it. A 5.4
	 * log writes "Ancient Hysteria" (44 applications across the three raid nights); "Primal Rage" is what
	 * the id became afterwards. The id was always right — this is the only one of the five that a reader
	 * would have seen misnamed.
	 */
	it('calls 90355 what a 5.4 log calls it', () => {
		expect(registry.variantOf(90_355)).toBe('Ancient Hysteria');
	});

	it('still answers for the other four', () => {
		expect(registry.variantOf(2825)).toBe('Bloodlust');
		expect(registry.variantOf(32_182)).toBe('Heroism');
		expect(registry.variantOf(80_353)).toBe('Time Warp');
		expect(registry.variantOf(146_555)).toBe('Drums of Rage');
	});
});

describe('Unerring Vision of Lei-Shen has one effect and no counter', () => {
	/**
	 * `db.json` items 94524/95814/96186/96558/96930 each carry exactly one `itemEffects` entry, buff
	 * 138963 "Perfect Aim", with no `stackingAura`; `trinkets_phase_3_52.go:13` carries the same single
	 * id. So a "stacking" aura for this trinket cannot exist, and the `maxStacks: 10` that used to be
	 * declared for one was invented rather than misplaced.
	 */
	it('declares no stacking aura for it', () => {
		const uvls = registry.aura('unerring-vision');
		expect(uvls.ids).toEqual([138_963]);
		expect(uvls.maxStacks).toBeUndefined();
		// Nothing anywhere in the shared model claims a stack cap while naming this trinket.
		const naming = SHARED_AURAS.filter((aura) => aura.name.includes('Unerring Vision'));
		expect(naming.map((aura) => aura.maxStacks)).toEqual([undefined]);
	});

	/**
	 * And the id that used to be declared as its counter belongs to a different trinket entirely:
	 * Wushoolay's Final Choice, `db.json` item 94513 `itemEffects[0]` — "Wushoolay's Lightning", ten
	 * seconds, `maxCumulativeStacks: 1`, 45 **non-stacking** applications across the three raid nights.
	 *
	 * The key it still sits under is a misnomer held in place by one reader; the name, the id and the
	 * absent cap are the parts a report prints, and those are the parts asserted here.
	 */
	it('reads 138786 as the trinket it is', () => {
		const aura = registry.auraById(138_786);
		expect(aura?.name).toBe("Wushoolay's Lightning");
		expect(aura?.maxStacks).toBeUndefined();
		expect(aura?.durationMs).toBe(10_000);
	});
});

describe('the stacking trinkets are a window and a counter, and the counter carries the cap', () => {
	/**
	 * Five pairs, each `itemEffects[0].buffId` against `itemEffects[0].stackingAura.buffId` in
	 * `db.json`. The window opens once per proc; the counter gains a stack on a fixed period inside it.
	 * Putting the cap on the window is what `wrath-of-darkspear` did, and it made a graded input — the
	 * Elemental snapshot audit's "at ten stacks" trigger — ask a non-stacking aura for ten stacks.
	 *
	 * **Each row asserts the window is declared before it asserts the window does not stack**, and that
	 * line is not ceremony. `auraById(window)?.maxStacks` is `undefined` for an aura that does not stack
	 * *and* for an id nothing declares at all, so without it a row pointed at the sim's payload half —
	 * `138758` for Ji-Kun rather than `138759` — passed this table while being exactly the inversion the
	 * table exists to name. The `simOnly` list below did catch that one, from the other side, and that
	 * is what hid the hole: the pair stayed covered while the pairs table was asserting nothing about
	 * it. The counter side needs no such line, `toBe(cap)` already failing on an `undefined`.
	 */
	const pairs: Array<[string, number, number, number]> = [
		// [item, window id, counter id, counter cap]
		["Renataki's Soul Charm", 138_756, 138_737, 10],
		['Fabled Feather of Ji-Kun', 138_759, 138_760, 10],
		["Wushoolay's Final Choice", 138_786, 138_788, 10],
		["Skeer's Bloodsoaked Talisman", 146_285, 146_293, 20],
		["Black Blood of Y'Shaarj", 146_184, 146_202, 10],
	];

	for (const [item, window, counter, cap] of pairs) {
		it(`${item}: the window does not stack and the counter caps at ${cap}`, () => {
			expect(registry.auraById(window), `${window} is the window, and has to be declared`).toBeDefined();
			expect(registry.auraById(window)?.maxStacks, `${window} is the window`).toBeUndefined();
			expect(registry.auraById(counter)?.maxStacks, `${counter} is the counter`).toBe(cap);
		});
	}

	/**
	 * Named separately because it is the one that a copy of the four above would get wrong: Skeer's
	 * counter is **twenty** stacks on a 500ms period, not ten on a second (`db.json` item 102308,
	 * `stackingAura.maxCumulativeStacks: 20`, `stackPeriodMs: 500`).
	 */
	it("Skeer's counter is twenty and not ten", () => {
		expect(registry.auraById(146_293)?.maxStacks).toBe(20);
		expect(registry.auraById(146_293)?.maxStacks).not.toBe(10);
	});

	/**
	 * Ticking Ebon Detonator is the trinket that looks like a sixth pair and is not: `db.json` item
	 * 102311 has `maxCumulativeStacks: 20` on the effect itself and no `stackingAura` beside it. The
	 * sim's 146311 "payload" is the sixth inversion and fires zero times in the sweep.
	 */
	it('Ticking Ebon Detonator carries its twenty stacks on the one id that logs', () => {
		expect(registry.auraById(146_310)?.maxStacks).toBe(20);
		expect(registry.auraById(146_311)).toBeUndefined();
	});
});

describe('the ids the simulator has and the game does not are absent', () => {
	/**
	 * The guard, and the only test here whose list is independent of the declarations: every id below is
	 * one the sim names and a log never carries. Five are the "payload" halves of the stacking-trinket
	 * inversion, each measured at **zero** across three raid nights against a non-zero sibling; two are
	 * the Dancing Steel pair that both the Go *and* `db.json` name and that appears nowhere in 1,317
	 * distinct friendly ids; one is a hidden "Item -" marker.
	 *
	 * A declaration that reaches for the sim's own file rather than for the log fails here, which is the
	 * failure the T16 two-piece did not have.
	 */
	const simOnly: Array<[number, string]> = [
		[138_790, "Wushoolay's payload (log writes 138786 instead: 0 against 45)"],
		[138_758, "Ji-Kun's payload (log writes 138759 instead: 0 against 102)"],
		[146_311, "Ticking Ebon Detonator's payload (log writes 146310 instead: 0 against 683)"],
		[146_183, "Black Blood's payload (log writes 146184 instead: 0 against 1,424)"],
		[138_849, "Horridon's payload (log writes 138856 instead: 0 against 275)"],
		[118_334, 'Dancing Steel agility (log writes 120032 instead: 0 against 13,024)'],
		[118_335, 'Dancing Steel strength (same)'],
		[139_116, 'Rune of Re-Origination’s hidden "Item -" marker (0 against 818 for 139117/120/121)'],
		[144_998, "the T16 two-piece's ExposeToAPL handle, retired once already"],
	];

	for (const [id, why] of simOnly) {
		it(`does not declare ${id} — ${why}`, () => {
			expect(registry.auraById(id)).toBeUndefined();
			expect(registry.abilityByCastId(id)).toBeUndefined();
		});
	}

	/** And the log's own answer for the two that have one is declared, so this is not absence by silence. */
	it('declares what the log writes in their place', () => {
		expect(registry.auraById(120_032)?.key).toBe('dancing-steel');
		expect(registry.auraById(138_786)).toBeDefined();
		expect(registry.auraById(146_184)).toBeDefined();
	});
});

describe('the effects that log more than one id are one entry with variants', () => {
	/**
	 * Windsong is the plainest case in the file: one weapon enchant that rolls crit, haste or mastery and
	 * writes a different id for each (`db.json` enchant 4441 has three `enchantEffects`, all named
	 * "Windsong"). Declaring one of the three would have read as an enchant procing a third as often.
	 */
	it('reads all three Windsong ids as one enchant', () => {
		const keys = [104_423, 104_509, 104_510].map((id) => registry.auraById(id)?.key);
		expect(keys).toEqual(['windsong', 'windsong', 'windsong']);
		expect(registry.variantOf(104_423)).toBe('Haste');
		expect(registry.variantOf(104_509)).toBe('Crit');
		expect(registry.variantOf(104_510)).toBe('Mastery');
	});
});

describe('the legendary cloak that procs on the enemy', () => {
	/**
	 * Xing-Ho, Breath of Yu'lon is the one item effect in the shared model that is not a buff, and a
	 * Buffs sweep is structurally incapable of finding it: 146198 is invisible in `dataType: Buffs` and
	 * heavy in `dataType: Debuffs, hostilityType: Enemies`. All three committed Elemental fixtures carry
	 * `applydebuff 146198` on their bosses.
	 */
	it('is declared as a debuff and not a buff', () => {
		const aura = registry.aura('essence-of-yulon');
		expect(aura.kind).toBe('debuff');
		expect(aura.ids).toEqual([146_198]);
		expect(registry.auraById(146_198)?.kind).toBe('debuff');
	});
});

describe('the meta gem keeps its five-stack counter', () => {
	/** `windwalker/lib/index.ts` reads `CAPACITANCE.maxStacks` to size the charge meter. */
	it('caps at five', () => {
		expect(registry.aura('capacitance').maxStacks).toBe(5);
	});

	/** The payout is a damage id and belongs to no aura, on either of the two ids it can take. */
	it('does not model the Lightning Strike as an aura', () => {
		expect(registry.auraById(137_597)).toBeUndefined();
		expect(registry.auraById(141_004)).toBeUndefined();
	});
});

describe('the shared model itself stays well-formed', () => {
	/** `createRegistry` throws on a duplicate key or a doubly-claimed id; building it is the assertion. */
	it('builds', () => {
		expect(registry.auras.length).toBeGreaterThan(30);
		expect(registry.abilities.length).toBeGreaterThan(5);
	});

	/**
	 * An aura with no ids matches no event and can only ever be a lane that stays empty. Nothing in the
	 * shared model is allowed to be one — an entry that has nothing to measure belongs nowhere, which is
	 * the rule the retired 144998 established.
	 */
	it('declares at least one id for every aura', () => {
		const empty = SHARED_AURAS.filter((aura) => aura.ids.length === 0).map((aura) => aura.key);
		expect(empty).toEqual([]);
	});
});
