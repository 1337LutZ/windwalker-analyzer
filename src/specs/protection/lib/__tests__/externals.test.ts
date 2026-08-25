// What the three committed pulls actually got from their raid, pinned.
//
// The figures here are the section's whole claim, and two of them were wrong before this file existed.
// `windowsBySource` opens a window on a cast *or* an application, because the two raid buffs it was
// written for log exactly one of those each. An external logs both — the caster's cast event carries the
// tank as its target, so a player-scoped fetch holds the cast and the buff it caused — and handed that
// stream unfiltered the walk opened every instance twice against one removal, leaving a window running
// after each pass and closing the wrong one on the next. The error compounded down the pull: Vigilance on
// `paragons` read 22 instances holding 470.7s of a 545s fight against a true 11 holding 110.5s.
//
// So the counts below are pinned against the raw event stream rather than against the reading that
// produced them, and the first suite does that comparison in the test rather than asserting a number
// somebody typed. A reading that drifts from the log's own apply events fails here whatever it says.

import { describe, expect, it } from 'vitest';

import { EXTERNALS, classesInPull } from '~/lib/analysis/externals';
import { rawFixture } from '~/lib/analysis/fixtures';
import { abilityIdOf, isAuraApply } from '~/lib/events';
import type { Analysis, ProtectionAudit } from '~/lib/types';
import { analyse } from '~/specs/protection/lib';

const PULLS = ['garrosh.json', 'paragons.json', 'fallenProtectors.json'] as const;

const auditOf = (name: string): Analysis & ProtectionAudit =>
	analyse(rawFixture('protection', name)) as Analysis & ProtectionAudit;

describe('the externals a pull received', () => {
	/**
	 * Every count, against the log's own applications rather than against a typed-in number.
	 *
	 * The comparison is deliberately naive — every `applybuff` under the id, landing on the player, from
	 * somebody who is not the player — because that is the definition the section claims to implement and
	 * a second implementation of the same walk would only ever agree with itself.
	 */
	it.each(PULLS)('%s counts exactly the applications the log carried', (name) => {
		const dataset = rawFixture('protection', name);
		const audit = auditOf(name);
		const me = dataset.actor.id;

		for (const row of audit.externals.rows) {
			const ids = new Set(EXTERNALS.find((entry) => entry.key === row.key)!.ids);
			const applied = dataset.events.filter((event) => {
				const id = abilityIdOf(event);
				return (
					id !== null &&
					ids.has(id) &&
					isAuraApply(event) &&
					event.targetID === me &&
					(event as { sourceID?: number }).sourceID !== me
				);
			});
			expect(row.count, `${name}/${row.key}`).toBe(applied.length);
		}
	});

	/**
	 * The headline figures, pinned.
	 *
	 * All three pulls field every one of the eleven classes, so the roster gate admits the whole
	 * catalogue on each and `available` is nine everywhere. That is a fact about these captures rather
	 * than about the gate, and it is why the gate gets a synthetic suite of its own below.
	 */
	it.each([
		['garrosh.json', 9, 7, 2],
		['paragons.json', 9, 7, 2],
		['fallenProtectors.json', 9, 4, 5],
	] as const)('%s offers %i externals, of which %i landed and %i did not', (name, available, used, unused) => {
		const { externals } = auditOf(name);
		expect(externals.available).toBe(available);
		expect(externals.used).toBe(used);
		expect(externals.unused).toBe(unused);
		expect(externals.classes).toHaveLength(11);
	});

	/**
	 * The per-external reading, spelled out so a drift names the button it happened to.
	 *
	 * The held figures are the log's own apply-to-remove spans and land within a few tens of
	 * milliseconds of the simulator's nominal durations rather than exactly on them: Pain Suppression
	 * reads 7 972ms against a declared 8 000, Vigilance eleven windows totalling 110 452ms against a
	 * nominal 132 000. The shortfall is the server stamping the removal a tick early and, on Vigilance,
	 * two windows overlapping and being counted once. That agreement to the tenth of a second is what
	 * says the ids in the catalogue are the right ones.
	 */
	it.each([
		['garrosh.json', 'pain-suppression', 1, 7_972],
		['garrosh.json', 'vigilance', 1, 12_000],
		['garrosh.json', 'hand-of-sacrifice', 2, 23_994],
		['garrosh.json', 'devotion-aura', 2, 12_024],
		['garrosh.json', 'power-word-barrier', 5, 40_763],
		['garrosh.json', 'smoke-bomb', 2, 9_974],
		['garrosh.json', 'life-cocoon', 0, 0],
		['garrosh.json', 'hand-of-purity', 0, 0],
		['paragons.json', 'pain-suppression', 4, 32_012],
		['paragons.json', 'vigilance', 11, 110_452],
		['paragons.json', 'hand-of-sacrifice', 5, 60_008],
		['paragons.json', 'life-cocoon', 2, 11_229],
		['paragons.json', 'smoke-bomb', 0, 0],
		['paragons.json', 'hand-of-purity', 0, 0],
		['fallenProtectors.json', 'devotion-aura', 1, 6_004],
		['fallenProtectors.json', 'power-word-barrier', 4, 20_634],
		['fallenProtectors.json', 'anti-magic-zone', 1, 2_964],
		['fallenProtectors.json', 'pain-suppression', 0, 0],
		['fallenProtectors.json', 'vigilance', 0, 0],
	] as const)('%s had %s land %i times for %i ms', (name, key, count, heldMs) => {
		const row = auditOf(name).externals.rows.find((entry) => entry.key === key)!;
		expect(row.count).toBe(count);
		expect(row.heldMs).toBe(heldMs);
	});

	/**
	 * The player's own Devotion Aura must not read as an external, and this is the case that proves it.
	 *
	 * The audited player is a Paladin, so they press the button themselves and it fans out to the whole
	 * raid: `garrosh` carries 130 events under 31821, of which 64 are the player's own applications going
	 * out to everyone including themselves. Counted without the source check, this row would read 4 rather
	 * than 2, and half of it would be the tank taking credit for their own cooldown.
	 */
	it('does not count the player pressing their own raid cooldown', () => {
		const dataset = rawFixture('protection', 'garrosh.json');
		const me = dataset.actor.id;
		const onMe = dataset.events.filter(
			(event) => abilityIdOf(event) === 31_821 && isAuraApply(event) && event.targetID === me,
		);
		expect(onMe).toHaveLength(4);

		const row = auditOf('garrosh.json').externals.rows.find((entry) => entry.key === 'devotion-aura')!;
		expect(row.count).toBe(2);
		expect(row.received.every((caster) => caster.id !== me)).toBe(true);
	});

	/**
	 * The one thing the fetch can say about an external going somewhere else.
	 *
	 * `fallenProtectors` is the clean case: Hand of Sacrifice never lands on this tank and the tank puts
	 * their own on somebody else, so the row is simultaneously a cooldown they did not get and one they
	 * gave away. Both halves are in the stream because the player is one end of each event.
	 */
	it('reads an external the player put on somebody else', () => {
		const row = auditOf('fallenProtectors.json').externals.rows.find((entry) => entry.key === 'hand-of-sacrifice')!;
		expect(row.count).toBe(0);
		expect(row.given).toHaveLength(1);
		expect(row.given[0]!.windows).toHaveLength(1);

		const paragons = auditOf('paragons.json').externals.rows.find((entry) => entry.key === 'hand-of-sacrifice')!;
		expect(paragons.given.map((who) => who.windows.length)).toEqual([2]);
	});

	/**
	 * A ground effect has no caster, and the row keeps it rather than inventing one.
	 *
	 * WarcraftLogs files Power Word: Barrier and Anti-Magic Zone under the persistent area, which arrives
	 * as the Environment actor at id `-1`. A reading that dropped those would lose two of the three
	 * externals `fallenProtectors` actually got.
	 */
	it('keeps a ground effect whose caster the log did not name', () => {
		const rows = auditOf('fallenProtectors.json').externals.rows;
		for (const key of ['power-word-barrier', 'anti-magic-zone']) {
			const row = rows.find((entry) => entry.key === key)!;
			expect(row.count).toBeGreaterThan(0);
			expect(row.received.map((caster) => caster.id)).toEqual([-1]);
		}
	});
});

describe('the roster gate', () => {
	/**
	 * Synthetic, because no committed pull can exercise it.
	 *
	 * All three captures are 25-man raids fielding every class, so `available` is nine on each and the
	 * gate never once refuses a row. That makes the pinned figures above silent about the thing the
	 * section turns on, and a guard that only runs on data that cannot fail it is not a guard.
	 */
	const actors = [
		{ id: 1, name: 'Tank', type: 'Player', subType: 'Paladin', petOwner: null },
		{ id: 2, name: 'Healer', type: 'Player', subType: 'Priest', petOwner: null },
		{ id: 3, name: 'Absent', type: 'Player', subType: 'Druid', petOwner: null },
		{ id: 4, name: 'Unresolved', type: 'Player', subType: 'Unknown', petOwner: null },
	];

	it('reads only the players who were in the pull', () => {
		expect(classesInPull([1, 2], actors, 1)).toEqual(['Priest']);
	});

	it('leaves the audited player out of their own class count', () => {
		expect(classesInPull([1], actors, 1)).toEqual([]);
		expect(classesInPull([1, 2, 3], actors, 1)).toEqual(['Druid', 'Priest']);
	});

	it('drops an actor whose class the report could not resolve', () => {
		expect(classesInPull([1, 4], actors, 1)).toEqual([]);
	});
});

describe('the catalogue', () => {
	/**
	 * Every entry either cites the simulator for its reduction or admits it has none.
	 *
	 * The rule this pins is the one that keeps the table honest: a `sim` row carries a multiplier read
	 * out of wowsims-mop, and a `log` row carries null rather than a number somebody remembered. Nothing
	 * in between is allowed, because a plausible-looking figure with no source is the failure this whole
	 * catalogue is arranged against.
	 */
	it('states a reduction exactly where the simulator models one', () => {
		for (const external of EXTERNALS) {
			if (external.evidence === 'sim') expect(external.takenMultiplier, external.key).not.toBeNull();
			else expect(external.takenMultiplier, external.key).toBeNull();
			expect(external.durationMs, external.key).toBeGreaterThan(0);
			expect(external.ids.length, external.key).toBeGreaterThan(0);
		}
	});

	/** The five reductions the simulator states, against the lines they are read from. */
	it('carries the simulator’s own multipliers', () => {
		const by = (key: string) => EXTERNALS.find((entry) => entry.key === key)!;
		// sim/core/buffs.go:966 — `DamageTakenMultiplier, 0.6`, an 8s aura on a 3min cooldown.
		expect(by('pain-suppression')).toMatchObject({ takenMultiplier: 0.6, durationMs: 8_000, cooldownMs: 180_000 });
		// sim/core/buffs.go:922 — `DamageTakenMultiplier, 0.7`, 12s on 2min.
		expect(by('vigilance')).toMatchObject({ takenMultiplier: 0.7, durationMs: 12_000, cooldownMs: 120_000 });
		// sim/core/buffs.go:858 — `DamageTakenMultiplier, 0.8`, 6s on 3min. Magic-only off a non-Holy caster.
		expect(by('devotion-aura')).toMatchObject({ takenMultiplier: 0.8, durationMs: 6_000, scope: 'magic' });
		// sim/death_knight/talents.go:239-252 — the six magic schools at 0.6, a 3s aura on a 2min cooldown.
		expect(by('anti-magic-zone')).toMatchObject({ takenMultiplier: 0.6, durationMs: 3_000, scope: 'magic' });
		// sim/paladin/talents.go:381 — `DamageTakenMultiplier, 0.9`, 6s on 30s.
		expect(by('hand-of-purity')).toMatchObject({ takenMultiplier: 0.9, durationMs: 6_000, cooldownMs: 30_000 });
	});

	/**
	 * The two the simulator models and this catalogue refuses, so a later reader does not re-add them.
	 *
	 * Guardian Spirit is `HealingTakenMultiplier, 1.4` plus a death save and touches no damage-taken
	 * multiplier at all; Rallying Cry raises maximum health, which `vengeance.ts` already reads as the
	 * thing that moves the cap. Neither is damage reduction, and the Vengeance argument that lets this
	 * catalogue recommend anything does not reach either of them.
	 */
	it('holds no healing or health cooldown', () => {
		const ids = new Set(EXTERNALS.flatMap((entry) => entry.ids));
		expect(ids.has(47_788)).toBe(false);
		expect(ids.has(97_462)).toBe(false);
		expect(ids.has(97_463)).toBe(false);
		// Hand of Protection: an immunity that drops its target off the threat table, so a tank who gets
		// one stops tanking. Listing it as a chance not taken would recommend a mistake.
		expect(ids.has(1_022)).toBe(false);
	});

	it('names a providing class the roster can actually match', () => {
		const known = new Set([
			'DeathKnight',
			'Druid',
			'Hunter',
			'Mage',
			'Monk',
			'Paladin',
			'Priest',
			'Rogue',
			'Shaman',
			'Warlock',
			'Warrior',
		]);
		for (const external of EXTERNALS) expect(known.has(external.providedBy), external.key).toBe(true);
	});
});
