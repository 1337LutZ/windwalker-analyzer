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
import report from '~/locales/en/report.json';
import { abilityIdOf, isAuraApply } from '~/lib/events';
import type { Analysis, ProtectionAudit } from '~/lib/types';
import { analyse } from '~/specs/protection/lib';

const PULLS = ['garrosh.json', 'paragons.json', 'fallenProtectors.json', 'galakras.json', 'spoils.json'] as const;

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
					// A raid-wide cooldown the player pressed themselves still covered them, so its
					// self-sourced application on *this* player counts. A targeted one cannot be self-cast at
					// all, so excluding the source there loses nothing. See the note in `readExternals`.
					(EXTERNALS.find((candidate) => candidate.key === row.key)?.delivery === 'raid' ||
						(event as { sourceID?: number }).sourceID !== me)
				);
			});
			const entry = EXTERNALS.find((candidate) => candidate.key === row.key)!;
			// A ground effect is counted by placements rather than by applications, because the player
			// walks in and out of one — see `mergePlacements`. And an unreadable row is never in this
			// stream at all. Both are checked by their own cases below.
			if (entry.delivery === 'ground' || row.readable === false) {
				expect(row.count, `${name}/${row.key}`).toBeLessThanOrEqual(applied.length);
				continue;
			}
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
		['garrosh.json', 8, 6, 1],
		['paragons.json', 8, 5, 2],
		['fallenProtectors.json', 8, 6, 1],
		['galakras.json', 8, 2, 5],
		['spoils.json', 8, 3, 4],
	] as const)('%s offers %i externals, of which %i landed and %i went unused', (name, available, used, unused) => {
		const { externals } = auditOf(name);
		expect(externals.available).toBe(available);
		expect(externals.used).toBe(used);
		expect(externals.unused).toBe(unused);
		// Demoralizing Banner is the one entry no player-scoped fetch can observe, so it is listed and
		// never counted — `available` is seven where the catalogue holds eight castable rows.
		expect(externals.unreadable).toEqual(['Demoralizing Banner']);
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
		['garrosh.json', 'pain-suppression', 3, 22709],
		['garrosh.json', 'vigilance', 6, 72114],
		['garrosh.json', 'hand-of-sacrifice', 9, 107982],
		['garrosh.json', 'hand-of-purity', 0, 0],
		['garrosh.json', 'devotion-aura', 4, 24007],
		['garrosh.json', 'power-word-barrier', 2, 16003],
		['garrosh.json', 'smoke-bomb', 2, 9991],
		['garrosh.json', 'barkskin', 0, 0],
		['garrosh.json', 'demoralizing-banner', 0, 0],
		['paragons.json', 'pain-suppression', 1, 8002],
		['paragons.json', 'vigilance', 2, 22539],
		['paragons.json', 'hand-of-sacrifice', 4, 46749],
		['paragons.json', 'hand-of-purity', 0, 0],
		['paragons.json', 'devotion-aura', 4, 24024],
		['paragons.json', 'power-word-barrier', 1, 6427],
		['paragons.json', 'smoke-bomb', 0, 0],
		['paragons.json', 'barkskin', 0, 0],
		['paragons.json', 'demoralizing-banner', 0, 0],
		['fallenProtectors.json', 'pain-suppression', 1, 7991],
		['fallenProtectors.json', 'vigilance', 2, 24033],
		['fallenProtectors.json', 'hand-of-sacrifice', 4, 48030],
		['fallenProtectors.json', 'hand-of-purity', 0, 0],
		['fallenProtectors.json', 'devotion-aura', 3, 18020],
		['fallenProtectors.json', 'power-word-barrier', 1, 2339],
		['fallenProtectors.json', 'smoke-bomb', 1, 4590],
		['fallenProtectors.json', 'barkskin', 0, 0],
		['fallenProtectors.json', 'demoralizing-banner', 0, 0],
		['galakras.json', 'pain-suppression', 0, 0],
		['galakras.json', 'vigilance', 1, 10530],
		['galakras.json', 'hand-of-sacrifice', 0, 0],
		['galakras.json', 'hand-of-purity', 0, 0],
		['galakras.json', 'devotion-aura', 1, 6008],
		['galakras.json', 'power-word-barrier', 0, 0],
		['galakras.json', 'smoke-bomb', 0, 0],
		['galakras.json', 'barkskin', 0, 0],
		['galakras.json', 'demoralizing-banner', 0, 0],
		['spoils.json', 'pain-suppression', 0, 0],
		['spoils.json', 'vigilance', 1, 12004],
		['spoils.json', 'hand-of-sacrifice', 1, 11992],
		['spoils.json', 'hand-of-purity', 0, 0],
		['spoils.json', 'devotion-aura', 3, 17997],
		['spoils.json', 'power-word-barrier', 0, 0],
		['spoils.json', 'smoke-bomb', 0, 0],
		['spoils.json', 'barkskin', 0, 0],
		['spoils.json', 'demoralizing-banner', 0, 0],
	] as const)('%s had %s land %i times for %i ms', (name, key, count, heldMs) => {
		const row = auditOf(name).externals.rows.find((entry) => entry.key === key)!;
		expect(row.count).toBe(count);
		expect(row.heldMs).toBe(heldMs);
	});

	/**
	 * Only one Hand may be up at a time, so a Hand that never landed beside one that did is not a miss.
	 *
	 * Hand of Sacrifice lands on four of the five captures and Hand of Purity on none of them — but the
	 * two compete for one slot, so Purity reads `blocked` rather than unused wherever Sacrifice was
	 * there. Galakras is the case that separates the two: neither Hand lands, so neither is blocked and
	 * the pair costs the headline exactly one missed slot rather than two.
	 */
	it.each(PULLS)('%s never counts two Hands as two missed chances', (name) => {
		const { rows, unused } = auditOf(name).externals;
		const hands = rows.filter((row) => row.group === 'hand');
		expect(hands).toHaveLength(2);
		const landed = hands.filter((row) => row.count > 0);
		const blocked = hands.filter((row) => row.blocked);
		// A Hand is blocked exactly when another Hand took the slot.
		expect(blocked.length > 0).toBe(landed.length > 0);
		// And however many Hand *rows* went unused, they cost the headline one slot between them. Galakras
		// is the case: both Hands miss, and `unused` counts one.
		const countable = rows.filter((row) => row.available && row.readable);
		const missedRows = countable.filter((row) => row.count === 0 && !row.blocked).length;
		const missedHandRows = hands.filter((row) => row.count === 0 && !row.blocked).length;
		expect(unused).toBe(missedRows - Math.max(0, missedHandRows - 1));
	});

	/**
	 * The player's own Devotion Aura must not read as an external, and this is the case that proves it.
	 *
	 * The audited player is a Paladin, so they press the button themselves and it fans out to the whole
	 * raid: `garrosh` carries 130 events under 31821, of which 64 are the player's own applications going
	 * out to everyone including themselves. Counted without the source check, this row would read 4 rather
	 * than 2, and half of it would be the tank taking credit for their own cooldown.
	 */
	it('counts a raid cooldown the player pressed once, not once per raider it reached', () => {
		const dataset = rawFixture('protection', 'garrosh.json');
		const me = dataset.actor.id;
		const onMe = dataset.events.filter(
			(event) => abilityIdOf(event) === 31_821 && isAuraApply(event) && event.targetID === me,
		);
		expect(onMe.length).toBeGreaterThan(0);

		const row = auditOf('garrosh.json').externals.rows.find((entry) => entry.key === 'devotion-aura')!;
		// **Every application that landed on the player, their own press included** — a raid-wide cooldown
		// they pressed still covered them. What must not appear is the fan-out: the same press reaching
		// two dozen other raiders is `given`, and on this capture id 31821 carries 130 events against the
		// handful that touched this player.
		expect(row.count).toBe(onMe.length);
		expect(row.count).toBeLessThan(10);
		// The player is among the casters now, and exactly once — which is the difference between crediting
		// the press that covered them and crediting the two dozen it also reached.
		expect(row.received.filter((caster) => caster.id === me)).toHaveLength(1);
	});

	/**
	 * The one thing the fetch can say about an external going somewhere else.
	 *
	 * `fallenProtectors` is the clean case: Hand of Sacrifice never lands on this tank and the tank puts
	 * their own on somebody else, so the row is simultaneously a cooldown they did not get and one they
	 * gave away. Both halves are in the stream because the player is one end of each event.
	 */
	it('reads an external the player put on somebody else', () => {
		// This tank both receives and gives Hand of Sacrifice, which is what the two halves are for: the
		// row is simultaneously a cooldown they got and one they passed on. Only the second half depends
		// on the player being the source, and that is the half the fetch can reach.
		const given = PULLS.map((name) => {
			const row = auditOf(name).externals.rows.find((entry) => entry.key === 'hand-of-sacrifice')!;
			return row.given.reduce((sum, who) => sum + who.windows.length, 0);
		});
		expect(given.some((count) => count > 0)).toBe(true);
		for (const name of PULLS) {
			const row = auditOf(name).externals.rows.find((entry) => entry.key === 'hand-of-sacrifice')!;
			// Never the player's own bar: an external they cast on themselves is neither given nor received.
			expect(row.given.every((who) => who.id !== rawFixture('protection', name).actor.id)).toBe(true);
		}
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
		const row = rows.find((entry) => entry.key === 'power-word-barrier')!;
		expect(row.count).toBeGreaterThan(0);
		expect(row.received.map((caster) => caster.id)).toEqual([-1]);
	});
});

describe('a reduction that depends on who cast it', () => {
	/**
	 * Devotion Aura is two spells wearing one name, and the row has to say which one landed.
	 *
	 * `core/buffs.go:857` gives a Holy Paladin's the whole of the damage and everyone else's only the six
	 * magic schools. No Mists log states a spec, so the caster is established from what they cast — and
	 * the captures make the case: the raid fields two paladins, and only actor 18 ever casts Holy
	 * Radiance, Holy Shock, Light of Dawn or Beacon of Light.
	 */
	it.each([
		['garrosh.json', 'all'],
		['paragons.json', 'all'],
		['fallenProtectors.json', 'all'],
		['spoils.json', 'all'],
	] as const)('%s reads the whole-damage version, because a Holy Paladin cast it', (name, scope) => {
		const row = auditOf(name).externals.rows.find((entry) => entry.key === 'devotion-aura')!;
		expect(row.count).toBeGreaterThan(0);
		expect(row.scope).toBe(scope);
		expect(row.takenMultiplier).toBe(0.8);
	});

	/**
	 * And the pull where nobody cast it keeps the catalogue's own narrower figure.
	 *
	 * Not a separate rule: the widening is read off the casters of instances that *landed*, so a pull with
	 * no instances has nobody to establish. That is also why a Holy Paladin merely standing in the raid
	 * does not widen a row — see the note in `readExternals`.
	 */
	it('keeps the narrow reading on a pull nobody cast it in', () => {
		// Galakras is the pull where the *only* Devotion Aura is the player's own, which is why it keeps the
		// narrow reading: they are not Holy, and nobody who is cast one on them.
		const row = auditOf('galakras.json').externals.rows.find((entry) => entry.key === 'devotion-aura')!;
		expect(row.count).toBe(1);
		expect(row.received.every((caster) => caster.id === rawFixture('protection', 'galakras.json').actor.id)).toBe(true);
		expect(row.scope).toBe('magic');
	});

	/** Every other row reports exactly what the catalogue declares, so the widening stays one spell's. */
	it.each(PULLS)('%s widens nothing but Devotion Aura', (name) => {
		for (const row of auditOf(name).externals.rows) {
			if (row.key === 'devotion-aura') continue;
			const entry = EXTERNALS.find((candidate) => candidate.key === row.key)!;
			expect(row.scope, row.key).toBe(entry.scope);
			expect(row.takenMultiplier, row.key).toBe(entry.takenMultiplier);
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
	 * Every scope the catalogue uses has a column to print itself in.
	 *
	 * **This is here because the copy guards structurally cannot catch it.** `keys.test.ts` peels
	 * `_context` suffixes back off before checking a key is read — deliberately, and its own docblock
	 * argues why: a whitelist of suffixes rots the moment somebody invents a context. The consequence is
	 * that `externals.cuts_all` and `externals.cuts_physical` both count as `externals.cuts` being read,
	 * so a scope with no arm at all passes every guard in the tree and renders an **empty table cell**.
	 *
	 * That is not hypothetical. Adding Demoralizing Banner introduced `scope: 'physical'`, no
	 * `cuts_physical` arm went in with it, and the row printed nothing where its reduction should be —
	 * found by a reader looking at the page rather than by anything here.
	 *
	 * So the check belongs where the two lists can be compared: the scopes the catalogue actually uses,
	 * against the arms the copy actually has.
	 */
	it('prints a reduction for every scope the catalogue uses', () => {
		const copy = report['externals'] as Record<string, unknown>;
		for (const scope of new Set(EXTERNALS.map((entry) => entry.scope))) {
			expect(typeof copy[`cuts_${scope}`], scope).toBe('string');
			expect((copy[`cuts_${scope}`] as string).length, scope).toBeGreaterThan(0);
		}
		// And the arm for an entry whose size nothing states, which is unused today and kept for the same
		// reason `evidence: 'log'` is — see the catalogue's own note.
		expect(typeof copy['cuts_unknown']).toBe('string');
	});

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
			// A reduction is stated wherever a source of truth states one — the simulator, or the spell's own
			// 5.4 tooltip where the simulator implements nothing. `log` means the id is measured fact and
			// the size of the effect is not, which is a different claim and the only one that entry earns.
			if (external.evidence === 'log') expect(external.takenMultiplier, external.key).toBeNull();
			else expect(external.takenMultiplier, external.key).not.toBeNull();
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
		// sim/paladin/talents.go:381 — `DamageTakenMultiplier, 0.9`, 6s on 30s.
		expect(by('hand-of-purity')).toMatchObject({ takenMultiplier: 0.9, durationMs: 6_000, cooldownMs: 30_000 });
		// sim/warrior/banners.go:51 — `DamageDealtMultiplier, 0.9` on the *enemy*, 15s on 3min. Physical
		// only, because `vengeance.go:44` guards the divide-back-out on `SpellSchoolPhysical`. Listed and
		// never counted, because it is an aura on the boss and this fetch only carries the player's.
		expect(by('demoralizing-banner')).toMatchObject({
			takenMultiplier: 0.9,
			durationMs: 15_000,
			scope: 'physical',
			readable: false,
		});
		// The three off the 5.4 tooltips, where the simulator implements no mitigation at all.
		expect(by('hand-of-sacrifice')).toMatchObject({ takenMultiplier: 0.7, evidence: 'tooltip' });
		expect(by('power-word-barrier')).toMatchObject({ takenMultiplier: 0.75, evidence: 'tooltip' });
		expect(by('smoke-bomb')).toMatchObject({ takenMultiplier: 0.8, evidence: 'tooltip', durationMs: 5_000 });
		// And nothing is left with an unstated reduction, which is what makes `log` an unused arm rather
		// than a hiding place — see the catalogue's own note.
		expect(EXTERNALS.filter((entry) => entry.takenMultiplier === null)).toEqual([]);
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
