// The rule this module exists to keep: never turn silence into a zero.
//
// Every case below is one that was observed on a real Mists pull before it was written down here —
// the pre-pull buff that logs nothing, the buff whose only event is its own removal, the two hunters
// whose overlapping auras made a naive pairing invent a drop, and the death that strips everything
// at once. The numbers in the assertions are what the log actually supports, not what a tidier
// model would like it to say.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { WclEvent } from '~/lib/events';

import {
	narrowRaidBuffs,
	RAID_BUFF_EFFECT_KEYS,
	RAID_BUFF_NAMES,
	RAID_BUFF_PROVIDER_IDS,
	readRaidBuffs,
	type RaidBuffEffect,
} from '../raidBuffs';

const T0 = 1000;
const END = T0 + 100_000;
const ME = 10;

/** Horn of Winter, the +10% attack power row's commonest source. */
const HOW = 57330;
/** Trueshot Aura, the same effect from a second class — the multi-provider case. */
const TRUESHOT = 19506;
/** Legacy of the White Tiger: +5% crit, and the one a Monk supplies themselves. */
const LOTWT = 116781;
/** Moonkin Aura, +5% spell haste. */
const MOONKIN = 24907;
/** Burning Wrath: +10% spell power, and the shaman's own — the row this section did not have. */
const BURNING_WRATH = 77747;

function ev(t: number, type: string, id: number, source: number): WclEvent {
	return { timestamp: T0 + t, type, abilityGameID: id, sourceID: source, targetID: ME };
}

/** A `combatantinfo` addressed to the player as its source, the way the real one arrives. */
function pull(auras: Array<{ ability: number; source: number }>): WclEvent {
	return { timestamp: T0, type: 'combatantinfo', sourceID: ME, auras };
}

const rowOf = (events: WclEvent[], key: string) => readRaidBuffs(events, ME, T0, END).rows.find((r) => r.key === key)!;

describe('readRaidBuffs', () => {
	it('reports an effect the log says nothing about as not reported, never as 0%', () => {
		const row = rowOf([], 'attackPower');
		expect(row.notReported).toBe(true);
		expect(row.uptimePct).toBe(0);
		expect(row.gaps).toEqual([]);
	});

	/**
	 * One row per effect the simulator groups, in `applyBuffEffects`' own order — which is what the
	 * module's docstring claimed while the table was in a different order with no spell-power group in
	 * it at all. No spec draws this order; `narrowRaidBuffs` below is what decides that.
	 */
	it('groups every provider of one effect into a single row', () => {
		const summary = readRaidBuffs([], ME, T0, END);
		expect(summary.rows.map((r) => r.key)).toEqual([
			'attackPower',
			'meleeHaste',
			'spellPower',
			'spellHaste',
			'crit',
			'mastery',
			'stats',
		]);
	});

	/**
	 * The group that was missing entirely, and the largest single multiplier on a caster's damage:
	 * `{stats.SpellPower, 1.10, true}`, sim/core/buffs.go. Measured here exactly as any other is.
	 */
	it('measures the spell power group', () => {
		const row = rowOf([ev(30_000, 'applybuff', BURNING_WRATH, 7)], 'spellPower');
		expect(row.notReported).toBe(false);
		expect(row.providers).toEqual(['Burning Wrath']);
		expect(row.uptimeMs).toBe(70_000);
		expect(row.gaps).toEqual([{ at: 0, seconds: 30 }]);
	});

	/**
	 * The case that makes the whole section possible. A buff applied before the pull emits no
	 * `applybuff` at all, so without the pull snapshot it reads as never applied.
	 */
	it('credits a buff the pull snapshot names even when it logs no events', () => {
		const row = rowOf([pull([{ ability: HOW, source: 4 }])], 'attackPower');
		expect(row.notReported).toBe(false);
		expect(row.fromPull).toBe(true);
		expect(row.uptimePct).toBe(100);
		expect(row.providers).toEqual(['Horn of Winter']);
	});

	/**
	 * The second, independent proof that a buff predates the pull — needed because the snapshot is
	 * demonstrably incomplete. An aura cannot be removed unless it was up, so a bare removal at 40s
	 * means it covered the first 40 seconds.
	 */
	it('reads a bare removal as a buff that was up from the pull', () => {
		const row = rowOf([ev(40_000, 'removebuff', HOW, 4)], 'attackPower');
		expect(row.fromPull).toBe(true);
		expect(row.uptimeMs).toBe(40_000);
		expect(row.gaps).toEqual([{ at: 40_000, seconds: 60 }]);
	});

	it('reads a bare refresh the same way', () => {
		const row = rowOf([ev(30_000, 'refreshbuff', HOW, 4)], 'attackPower');
		expect(row.fromPull).toBe(true);
		expect(row.uptimePct).toBe(100);
	});

	/** A buff that genuinely went out late: the leading gap is the finding, so it must be listed. */
	it('reports the stretch before a late application as a gap', () => {
		const row = rowOf([ev(25_000, 'applybuff', HOW, 4)], 'attackPower');
		expect(row.fromPull).toBe(false);
		expect(row.gaps).toEqual([{ at: 0, seconds: 25 }]);
		expect(row.uptimeMs).toBe(75_000);
	});

	/**
	 * Two hunters, one spell id. Pairing them as a single stream lets the first removal close the
	 * window while the second aura is still running — on a real pull that reported a buff which never
	 * dropped as 69% uptime. Tracked per caster and unioned, the survivor covers the gap.
	 */
	it("does not let one caster's removal end another caster's buff", () => {
		const events = [
			pull([
				{ ability: TRUESHOT, source: 6 },
				{ ability: TRUESHOT, source: 8 },
			]),
			ev(88_000, 'removebuff', TRUESHOT, 6),
		];
		const row = rowOf(events, 'attackPower');
		expect(row.uptimePct).toBe(100);
		expect(row.gaps).toEqual([]);
	});

	/** Two different spells supplying one effect cover for each other in exactly the same way. */
	it("treats a second provider as covering the first one's gap", () => {
		const events = [ev(0, 'applybuff', HOW, 4), ev(30_000, 'removebuff', HOW, 4), ev(20_000, 'applybuff', TRUESHOT, 6)];
		const row = rowOf(events, 'attackPower');
		expect(row.uptimePct).toBe(100);
		expect(row.providers).toEqual(['Horn of Winter', 'Trueshot Aura']);
	});

	it('measures a real drop against the whole pull, intermissions included', () => {
		const events = [
			pull([{ ability: MOONKIN, source: 7 }]),
			ev(20_000, 'removebuff', MOONKIN, 7),
			ev(60_000, 'applybuff', MOONKIN, 7),
		];
		const row = rowOf(events, 'spellHaste');
		expect(row.uptimeMs).toBe(60_000);
		expect(row.uptimePct).toBe(60);
		expect(row.gaps).toEqual([{ at: 20_000, seconds: 40 }]);
	});

	it('ignores a gap too short to have cost anything', () => {
		const events = [
			pull([{ ability: HOW, source: 4 }]),
			ev(10_000, 'removebuff', HOW, 4),
			ev(10_500, 'applybuff', HOW, 4),
		];
		expect(rowOf(events, 'attackPower').gaps).toEqual([]);
	});

	/**
	 * The same buff landing on the rest of the raid is in this stream too, because the monk cast it.
	 * Those removals belong to other people and must not close this player's window.
	 */
	it('ignores the same buff landing on somebody else', () => {
		const events: WclEvent[] = [
			pull([{ ability: LOTWT, source: ME }]),
			{ timestamp: T0 + 30_000, type: 'removebuff', abilityGameID: LOTWT, sourceID: ME, targetID: 4 },
		];
		const row = rowOf(events, 'crit');
		expect(row.uptimePct).toBe(100);
		expect(row.gaps).toEqual([]);
	});

	/**
	 * `byPlayer` is a fact about the log — this actor was one of the casters — and it is the one this
	 * pass can answer. `selfProvided` is a fact about the *spec*, so it is false on every row here and
	 * `narrowRaidBuffs` is where it gets its answer; see the suite below.
	 */
	it('records that the player was one of the casters, and claims nothing about their spec', () => {
		const row = rowOf([ev(40_000, 'applybuff', LOTWT, ME)], 'crit');
		expect(row.byPlayer).toBe(true);
		expect(row.selfProvided).toBe(false);
		expect(row.gaps).toEqual([{ at: 0, seconds: 40 }]);
		expect(readRaidBuffs([ev(40_000, 'applybuff', LOTWT, ME)], ME, T0, END).selfGaps).toBe(0);
	});

	it('does not call the player a caster when somebody else brought it', () => {
		const row = rowOf([pull([{ ability: MOONKIN, source: 7 }])], 'spellHaste');
		expect(row.byPlayer).toBe(false);
	});

	/**
	 * Regression, and it cost a real 6.5-second gap before it was caught. The stream carries the
	 * `cast` that applies a buff as well as the `applybuff` it produces — Legacy of the Emperor logs
	 * a cast of 115921 at the player — and a cast is not an apply, so "anything that is not an apply
	 * was already running" invented an instance covering the entire pull.
	 */
	it('does not read a cast of the buff as proof the buff was already up', () => {
		const events: WclEvent[] = [
			ev(72_970, 'removebuff', 117666, ME),
			ev(79_530, 'applybuff', 117666, ME),
			ev(79_540, 'cast', 115921, ME),
		];
		expect(rowOf(events, 'stats').gaps).toEqual([{ at: 72_970, seconds: 6.6 }]);
	});

	/** Legacy of the Emperor lands under a different id than the one the simulator casts. */
	it('accepts the applied-aura id for Legacy of the Emperor as well as the cast id', () => {
		const row = rowOf([ev(50_000, 'removebuff', 117666, ME)], 'stats');
		expect(row.notReported).toBe(false);
		expect(row.providers).toEqual(['Legacy of the Emperor']);
		expect(row.uptimeMs).toBe(50_000);
	});

	/** A corpse holds no buffs, so the section has to be able to say a death explains the gaps. */
	it("counts the player's own deaths", () => {
		const events: WclEvent[] = [
			{ timestamp: T0 + 40_000, type: 'death', targetID: ME },
			{ timestamp: T0 + 50_000, type: 'death', targetID: 99 },
		];
		expect(readRaidBuffs(events, ME, T0, END).deaths).toBe(1);
	});

	it('counts the effects it could not speak to', () => {
		expect(readRaidBuffs([], ME, T0, END).notReported).toBe(7);
		expect(readRaidBuffs([pull([{ ability: HOW, source: 4 }])], ME, T0, END).notReported).toBe(6);
	});
});

/**
 * The other half of the seam: a spec's own reading of a measured pull.
 *
 * The reason it exists is the reason the six-row roster was wrong. The section reports **gaps**, and
 * before a spec could say which effects its damage rests on, an Elemental report drew a Monk's list —
 * a missing multiplier on attack power presented as a fault, and no row at all for spell power. The
 * two judgements this applies, the icon and `selfProvided`, are the two the stream cannot answer, and
 * a wrong `selfProvided` is the one that reads as an accusation.
 */
describe('narrowRaidBuffs', () => {
	/** A caster's list: no attack power, spell power added, and three the shaman brings themselves. */
	const CASTER: readonly RaidBuffEffect[] = [
		{ key: 'stats', iconId: 20217, selfProvided: false },
		{ key: 'spellPower', iconId: BURNING_WRATH, selfProvided: true },
		{ key: 'spellHaste', iconId: 51470, selfProvided: true },
		{ key: 'crit', iconId: 17007, selfProvided: false },
	];

	it("keeps only the spec's effects, in the order the spec declared them", () => {
		const narrowed = narrowRaidBuffs(readRaidBuffs([], ME, T0, END), CASTER);
		expect(narrowed.rows.map((r) => r.key)).toEqual(['stats', 'spellPower', 'spellHaste', 'crit']);
		// The order is the declaration's and not the measurement's, which had crit before stats.
		expect(narrowed.rows.map((r) => r.key)).not.toEqual(
			readRaidBuffs([], ME, T0, END)
				.rows.map((r) => r.key)
				.filter((key) => CASTER.some((e) => e.key === key)),
		);
	});

	/** An effect the spec did not declare is not a gap the reader can fix, so it is not on the page. */
	it('drops an effect the spec does not declare, and does not count it as missing', () => {
		const measured = readRaidBuffs([], ME, T0, END);
		expect(measured.rows.some((r) => r.key === 'attackPower')).toBe(true);
		const narrowed = narrowRaidBuffs(measured, CASTER);
		expect(narrowed.rows.some((r) => r.key === 'attackPower')).toBe(false);
		expect(narrowed.notReported).toBe(CASTER.length);
	});

	it("writes the spec's own icon over the measurement's placeholder", () => {
		const measured = readRaidBuffs([], ME, T0, END);
		expect(measured.rows.find((r) => r.key === 'spellPower')?.iconId).toBe(1459);
		const narrowed = narrowRaidBuffs(measured, CASTER);
		expect(narrowed.rows.find((r) => r.key === 'spellPower')?.iconId).toBe(BURNING_WRATH);
	});

	/**
	 * The whole point of the field. A shaman brings Burning Wrath themselves, so a gap in it is theirs
	 * to fix and the section says so; the same gap in the all-stats row is somebody else's roster.
	 */
	it("counts a gap as the player's own only in an effect their spec supplies", () => {
		const late = readRaidBuffs([ev(40_000, 'applybuff', BURNING_WRATH, ME)], ME, T0, END);
		const narrowed = narrowRaidBuffs(late, CASTER);
		expect(narrowed.rows.find((r) => r.key === 'spellPower')?.selfProvided).toBe(true);
		expect(narrowed.rows.find((r) => r.key === 'stats')?.selfProvided).toBe(false);
		expect(narrowed.selfGaps).toBe(1);
		// An effect nothing was logged about is silence, not a fault: `notReported` rows are never
		// counted as self-gaps however sure the spec is that it supplies them.
		expect(narrowRaidBuffs(readRaidBuffs([], ME, T0, END), CASTER).selfGaps).toBe(0);
	});

	it('passes the death count through, since it is a fact about the pull and not about the spec', () => {
		const measured = readRaidBuffs([{ timestamp: T0 + 40_000, type: 'death', targetID: ME }], ME, T0, END);
		expect(narrowRaidBuffs(measured, CASTER).deaths).toBe(1);
	});

	/** Every key used above is one the shared table actually groups — the typo case, caught by name. */
	it('is declared against keys the measurement carries', () => {
		for (const effect of CASTER) expect(RAID_BUFF_EFFECT_KEYS).toContain(effect.key);
	});
});

/**
 * The id the game writes, not the one the simulator declares.
 *
 * Leader of the Pack has two: **24932** is the raid-wide aura and **17007** is the druid's own. The sim
 * declares only 17007 and this model followed it, so the crit row measured the buff for the druids and
 * called it absent for everyone else — 51 of 77 player-report pairs across three anonymous 25H nights
 * carried 24932, against 3 pairs for 17007.
 *
 * The fixture assertion is the one that matters. `phased.json` has carried ability 24932 all along, so
 * the committed data could have caught this and nothing was asking it to. That is the same hole the
 * cast-id coverage guard closed for abilities, one aura over.
 */
describe('the crit buff’s two ids', () => {
	it('names the raid-wide aura, which is the one a non-druid gets', () => {
		expect(RAID_BUFF_NAMES.get(24932)).toBe('Leader of the Pack');
	});

	it('still names the druid’s own, because a druid reading their own report has that one', () => {
		expect(RAID_BUFF_NAMES.get(17007)).toBe('Leader of the Pack');
	});

	it('is declared for the id a committed fixture proves was up at the pull', () => {
		// Not in the event stream — in `combatantinfo`'s own aura list, which is the only record of anything
		// buffed before the bell and the field `readRaidBuffs` reads for exactly that reason. So the fixture
		// does not merely mention 24932: it proves the buff was on that shaman at the pull, while the crit
		// row was reporting the effect absent.
		const raw = readFileSync(resolve(import.meta.dirname, '../../../specs/elemental/__fixtures__/phased.json'), 'utf8');
		const dataset = JSON.parse(raw) as { events: Array<{ auras?: Array<{ ability?: number }> }> };
		const pullAuras = new Set(
			dataset.events
				.flatMap((e) => (e.auras ?? []).map((a) => a.ability))
				.filter((id): id is number => id !== undefined),
		);
		// Guard against the assertion quietly passing on a fixture that stopped carrying it.
		expect(pullAuras.has(24932), 'phased.json no longer carries 24932 at the pull; this test is now vacuous').toBe(
			true,
		);
		expect(RAID_BUFF_NAMES.has(24932)).toBe(true);
		// And the id the sim declares is not the one the fixture carries — the whole point.
		expect(pullAuras.has(17007)).toBe(false);
	});

	it('names both of Spirit Beast Blessing’s ids for the same reason, at lower confidence', () => {
		expect(RAID_BUFF_NAMES.get(127830)).toBe('Spirit Beast Blessing');
		expect(RAID_BUFF_NAMES.get(128997)).toBe('Spirit Beast Blessing');
	});
});

/**
 * The mage's two ids, and the fault the missing one was printing.
 *
 * Mists splits the mage's raid buff across **1459 Arcane Brilliance** and **61316 Dalaran Brilliance**
 * — the same spell learned from the Dalaran tome, and the same buff: Wowhead's `mop-classic` tooltip
 * for 61316 carries no description of its own but *links to spell 1459* for it, "increasing their spell
 * power by 10% and their critical strike chance by 5%", and its buff line reads "Increases spell power
 * by 10%. Increases critical strike chance by 5%." So it belongs to both groups 1459 belongs to, for
 * the reason 1459 does: `sim/core/buffs.go:502-508` registers `{stats.SpellPower, 1.10, true}` and the
 * `PhysicalCritPercent`/`SpellCritPercent` pair in one `makeExclusiveBuff` call. The simulator names
 * only 1459 — 61316 occurs nowhere in that tree, and nowhere in its database either — so the log is the
 * only witness that the second id is what a real raid writes, and two of the four committed pulls
 * write it.
 *
 * **It was printing a fabricated fault, on the row the Elemental report draws.** Neither pull carrying
 * 61316 has any other crit provider on it: with only 1459 declared the crit row read *not reported* on
 * `cleave` and on `unbroken`, and the section named the effect in its "not reported" note, while the
 * pull snapshot proves the buff was on that shaman from before the bell. The spell-power row survived
 * only because the shaman brings Burning Wrath themselves — a spec without a self-provider would have
 * had the same silence there.
 */
describe('the mage’s two ids', () => {
	/** The committed pull that carries 61316 and no other crit provider at all. */
	const cleave = (): { events: WclEvent[]; actor: { id: number }; fight: { startTime: number; endTime: number } } =>
		JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../specs/elemental/__fixtures__/cleave.json'), 'utf8'));

	it('supplies both of the effects 1459 supplies, and neither more nor fewer', () => {
		const groups = RAID_BUFF_EFFECT_KEYS.filter((key) => (RAID_BUFF_PROVIDER_IDS.get(key) ?? []).includes(61_316));
		expect(groups).toEqual(
			RAID_BUFF_EFFECT_KEYS.filter((key) => (RAID_BUFF_PROVIDER_IDS.get(key) ?? []).includes(1459)),
		);
		expect(groups).toEqual(['spellPower', 'crit']);
	});

	it('is named by the buff a Mists reader saw, not by the id it shares its text with', () => {
		expect(RAID_BUFF_NAMES.get(61_316)).toBe('Dalaran Brilliance');
	});

	it('does not take either row’s icon, which no regeneration has resolved for it', () => {
		// The rule §70 recorded: `iconId` is the first provider of its group, and a provider added at the
		// front of a group draws a blank until the generated map catches up. 1459 stays first in both.
		expect(RAID_BUFF_PROVIDER_IDS.get('spellPower')?.[0]).toBe(1459);
		expect(RAID_BUFF_PROVIDER_IDS.get('crit')?.[0]).toBe(24_932);
	});

	/**
	 * The fixture assertion, and the one that measures the fault rather than restating the declaration.
	 * `cleave.json`'s `combatantinfo` carries 61316 from another player and carries no 1459, no 24932, no
	 * 17007, no Legacy of the White Tiger — so the crit row it produced was silence about a buff the
	 * snapshot proves was up.
	 */
	it('turns the crit row on a committed pull from “not reported” into the buff that was up', () => {
		const dataset = cleave();
		const pullAuras = new Set(
			(dataset.events as Array<{ auras?: Array<{ ability?: number }> }>)
				.flatMap((e) => e.auras ?? [])
				.map((a) => a.ability)
				.filter((id): id is number => id !== undefined),
		);
		// Guard against the assertion going vacuous on a re-captured fixture.
		expect(pullAuras.has(61_316), 'cleave.json no longer carries 61316 at the pull; this test is now vacuous').toBe(
			true,
		);
		expect(pullAuras.has(1459)).toBe(false);
		for (const other of [24_932, 17_007, 90_309, 24_604, 116_781, 126_309]) expect(pullAuras.has(other)).toBe(false);

		const summary = readRaidBuffs(dataset.events, dataset.actor.id, dataset.fight.startTime, dataset.fight.endTime);
		const crit = summary.rows.find((r) => r.key === 'crit')!;
		expect(crit.notReported).toBe(false);
		expect(crit.providers).toEqual(['Dalaran Brilliance']);
		expect(crit.fromPull).toBe(true);
		// **Not 100%, and the number is the point.** The one gap opens at 106 254 ms, four milliseconds
		// before the death at 106 258 ms, and closes when the mage re-buffs 92 seconds later — a corpse
		// holds no buffs, which is why the summary counts deaths and the section says so in its own note.
		// Every other row on this pull shows the same signature at the same instant. So the row reads a
		// real drop measured off the stream, where before it read nothing at all.
		expect(crit.uptimePct).toBeCloseTo(64.96, 2);
		expect(crit.gaps).toEqual([{ at: 106_254, seconds: 92.2 }]);
		expect(summary.deaths).toBe(1);
		// And the spell-power row gains the provider it was already covering the effect without: the
		// shaman's own Burning Wrath held it at 100% throughout, which is what hid this on that row.
		expect(summary.rows.find((r) => r.key === 'spellPower')?.providers).toEqual([
			'Dalaran Brilliance',
			'Burning Wrath',
			'Dark Intent',
		]);
		expect(summary.rows.find((r) => r.key === 'spellPower')?.uptimePct).toBeCloseTo(100, 5);
	});

	/**
	 * The same pull without the death, so the number is the buff's own. `unbroken` carries 61316 in its
	 * snapshot and logs no aura event for it at all — the ordinary shape of a raid buff cast before the
	 * bell — so the crit row went from "not reported" to a full pull's uptime.
	 */
	it('reads a full pull on the other fixture that carries it, which has no death in it', () => {
		const dataset = JSON.parse(
			readFileSync(resolve(import.meta.dirname, '../../../specs/elemental/__fixtures__/unbroken.json'), 'utf8'),
		) as { events: WclEvent[]; actor: { id: number }; fight: { startTime: number; endTime: number } };
		const summary = readRaidBuffs(dataset.events, dataset.actor.id, dataset.fight.startTime, dataset.fight.endTime);
		const crit = summary.rows.find((r) => r.key === 'crit')!;
		expect(crit.notReported).toBe(false);
		expect(crit.providers).toEqual(['Dalaran Brilliance']);
		expect(crit.uptimePct).toBe(100);
		expect(crit.gaps).toEqual([]);
		// Nothing is left unreported on this pull now, where the crit row was the one silence in it.
		expect(summary.notReported).toBe(0);
	});

	/**
	 * The general case behind that pull: a raid whose mage cast the other id is a raid with the buff, and
	 * the report used to say it had neither half of it. Both effects, because both were silent.
	 */
	it('reports both effects for a raid whose only mage buff is the second id', () => {
		const events = [pull([{ ability: 61_316, source: 4 }])];
		expect(rowOf(events, 'crit').notReported).toBe(false);
		expect(rowOf(events, 'crit').uptimePct).toBe(100);
		expect(rowOf(events, 'spellPower').notReported).toBe(false);
		expect(rowOf(events, 'spellPower').uptimePct).toBe(100);
	});
});
