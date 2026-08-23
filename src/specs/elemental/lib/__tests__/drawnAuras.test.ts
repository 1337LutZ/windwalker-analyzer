// Every aura the log put on the player has somewhere to be drawn, or a stated reason not to.
//
// **The opposite question to the coverage ledger, and the one nobody was asking.**
// `analysis/__tests__/fixtureCoverage.test.ts` asks "which declared aura never fires", which catches an
// id wired to a number the game does not write — the 144998 failure. It cannot catch this: an aura
// declared with the *right* id, firing on every committed pull, that no chart draws. Both of a reader's
// trinkets went missing that way. Purified Bindings of Immerseus (`expanded-mind`, 146046) and Kardris'
// Toxic Totem (`toxic-power`, 148906) were declared correctly, procced on all three fixtures, and had no
// row in the timeline.
//
// It was invisible in the lane list too, because the four item lanes that *were* listed belong to
// trinkets these fixtures' players did not wear — so they are filtered out by `windows.length > 0` and
// the list looked as though it covered gear.
//
// **The sweep is shared with the Windwalker's counterpart and used to be a second copy of it.** The
// reading now lives in `~/lib/analysis/drawnAuras`, which argues its own location; what matters here is
// what the copy had got wrong. This guard swept applications and refreshes only, so it could not see an
// aura whose only event on the pull is a removal — and that is not a corner case on this spec, it is the
// Fire Elemental on all three fixtures and the pre-pull potion on `unbroken`. The test below names them.
// The Windwalker's copy counted removals and found its missing Bloodlust row that way, so this file was
// the half-blind one and the widening is the point of the merge rather than a side effect of it.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
	aurasPutOnPlayer,
	drawnLaneKeys,
	redundantExcuses,
	selfAuraEvents,
	staleExcuses,
	undrawnAuras,
} from '~/lib/analysis/drawnAuras';
import type { Analysis, FightDataset } from '~/lib/types';
import { analyse, registry } from '~/specs/elemental/lib';

/**
 * Auras that fire and are deliberately not lanes, each with the reason.
 *
 * A ledger rather than a filter, for the reason `SILENT_AURAS` is one: "not drawn" and "forgotten" look
 * identical in a report and have to be told apart in the source.
 */
const NOT_LANES: Record<string, string> = {
	// Drawn above the rows as its own counter, not among them — `timelineBanks`.
	'lightning-shield': 'drawn as the charge bank',
	// The player lived, moved or healed. None of it changes what the rotation wanted, and a row each
	// would push the rotation's own rows off the screen on a long pull.
	'astral-shift': 'defensive, no bearing on the rotation',
	'spiritwalkers-grace': 'movement, no bearing on the rotation',
	'ancestral-guidance': 'healing, no bearing on the rotation',
};

const FIXTURES = ['phased', 'unbroken', 'cleave'] as const;

const load = (name: string): FightDataset =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8')) as FightDataset;

/** Every declared aura the log put on the player, by key, with how many events say so. */
const firedOn = (dataset: FightDataset): Map<string, number> => aurasPutOnPlayer(dataset, registry);

const drawnOn = (dataset: FightDataset): Set<string> => drawnLaneKeys(analyse(dataset) as Analysis);

describe('an aura that fired has somewhere to be drawn', () => {
	it.each(FIXTURES)('%s draws or accounts for everything the player was given', (name) => {
		const dataset = load(name);
		const fired = firedOn(dataset);
		// Not vacuous: these pulls really do buff the player with a dozen declared auras or more.
		expect(fired.size).toBeGreaterThan(10);

		expect(undrawnAuras(fired, drawnOn(dataset), NOT_LANES)).toEqual([]);
	});

	it('counts removals, because two of these auras have no application on the pull at all', () => {
		// **The blind spot this guard used to share with the bug it guards against.** Sweeping applications
		// and refreshes only, it could not see an aura the player took before the bell — and on this spec
		// that is not a hypothetical. The Fire Elemental is pre-pulled on **all three** fixtures: its only
		// event is a single `removebuff` of 118291 when the summon expires just short of a minute in, with
		// no `applybuff` anywhere, so the narrow reading missed the spec's own signature cooldown on every
		// committed pull. `unbroken`'s Jade Serpent Potion is the same shape — and it is the sharper case,
		// because the other two pulls drink a second one later and the narrow sweep saw the key *there*, so
		// this was a hole that closed and reopened depending on the pull.
		//
		// Both are drawn — the engine recovers them with `auraWindows`' `openAtPull`, which is what the
		// `preexisting` flag on the window records — so the widening added no orphan here. That is the
		// finding rather than a let-off: an apply-only guard was passing on three pulls while unable to see
		// the row it was supposed to be checking, and would have gone on passing if the row disappeared.
		const NARROW = ['applied', 'refreshed', 'stacked'] as const;
		const removalOnly: Record<string, readonly string[]> = {
			'fire-elemental': FIXTURES,
			'jade-serpent-potion': ['unbroken'],
		};

		for (const [key, pulls] of Object.entries(removalOnly)) {
			const ids = new Set(registry.aura(key).ids);
			for (const name of pulls) {
				const dataset = load(name);
				// One bare removal and nothing else — no application, no refresh, no stack event.
				const events = selfAuraEvents(dataset).filter((e) => ids.has(e.abilityGameID ?? -1));
				expect(
					events.map((e) => e.type),
					`${name} ${key}`,
				).toEqual(['removebuff']);

				// The narrow reading does not have the key at all; the wide one does.
				expect(aurasPutOnPlayer(dataset, registry, NARROW).has(key), `${name} ${key} narrow`).toBe(false);
				expect(firedOn(dataset).get(key), `${name} ${key} wide`).toBe(1);

				// And it is drawn, as a window opened at the pull rather than at an application.
				const lane = analyse(dataset).timeline?.lanes.find((l) => l.key === key);
				expect(lane?.windows.length, `${name} ${key} lane`).toBe(1);
				expect(lane?.windows[0]?.start).toBe(0);
				expect(lane?.windows[0]?.preexisting).toBe(true);
			}
		}
	});

	it('draws the two trinkets that were missing, on every pull that procced them', () => {
		// Named rather than left to the sweep above, because these two are the report: a reader saw them in
		// their own log and could not find them here. `expanded-mind` is Purified Bindings of Immerseus and
		// `toxic-power` is Kardris' Toxic Totem.
		for (const name of FIXTURES) {
			const dataset = load(name);
			const fired = firedOn(dataset);
			const drawn = drawnOn(dataset);
			for (const key of ['expanded-mind', 'toxic-power'] as const) {
				expect(fired.get(key), `${name} should proc ${key}`).toBeGreaterThan(0);
				expect(drawn.has(key), `${name} should draw ${key}`).toBe(true);
			}
		}
	});

	it('gives the haste racials and Bloodlust rows of their own, not just the wash', () => {
		// These were excused as "drawn as the haste band" and that was wrong. The band is one full-height
		// shade behind everything: it cannot say which of the two was up, cannot be hovered for a duration,
		// and does not exist for a buff that is not haste. Both are kept — the wash is the region, the row
		// is the aura — so this asserts the row, which is the half that was missing.
		for (const name of FIXTURES) {
			const dataset = load(name);
			const fired = firedOn(dataset);
			const drawn = drawnOn(dataset);
			for (const key of ['bloodlust', 'berserking'] as const) {
				// Not every pull brings a troll, so this asserts the pairing rather than the presence.
				if ((fired.get(key) ?? 0) === 0) continue;
				expect(drawn.has(key), `${name} should draw ${key}`).toBe(true);
			}
			// Every pull has a raid haste cooldown of some kind, so the loop above is never a no-op.
			expect(fired.get('bloodlust') ?? 0).toBeGreaterThan(0);
		}
	});

	it('declares Blood Fury with a lane, though no fixture exercises it', () => {
		// **Stated rather than asserted as drawn.** Blood Fury is an orc racial and none of the three
		// fixture players is an orc, so `windows.length > 0` drops the lane and there is nothing to see. It
		// is the case with the strongest claim of the three all the same: it grants spell power, so it was
		// not in the haste wash either and had no representation anywhere in the report.
		//
		// What can be checked without a fixture is that the id is declared and reachable, which is what the
		// lane needs to work the first time an orc is analysed.
		expect(registry.aura('blood-fury').ids).toContain(33_697);
		for (const name of FIXTURES) expect(firedOn(load(name)).get('blood-fury') ?? 0).toBe(0);
	});

	/**
	 * **The class of aura this whole guard cannot see, recorded here because the guard cannot record it.**
	 *
	 * `essence-of-yulon` (146198) is the caster legendary cloak's proc. It fires on every committed pull —
	 * 13, 18 and 16 `applydebuff`, pinned in `lib/game/__tests__/sharedFixtures.test.ts` — and until
	 * recently it had no row and no entry above. It was not an oversight anybody could have caught here:
	 * the proc lands on the **enemy**, and every reading in this file walks `aurasPutOnPlayer`. An enemy
	 * debuff is not merely absent from the sweep, it is *unreachable* by it.
	 *
	 * That makes it the same shape as the third failure mode the undeclared-id ledger was built for — an
	 * id nothing accounts for, passing every guard in the repository — and the undeclared-id ledger has
	 * the identical hole, because `auraIdsPutOnPlayer` reads the same player-scoped stream. Two of the
	 * three guards in the family are blind to the class; the coverage ledger
	 * (`analysis/__tests__/fixtureCoverage.test.ts`) is the one that is not, which is why 146198 does not
	 * appear in its Elemental `SILENT_AURAS` column while the Windwalker's carries it.
	 *
	 * **And the ledger above has no slot for it, which is the part worth proving rather than asserting.**
	 * The obvious repair for a firing-but-undrawn aura is a `NOT_LANES` entry with a reason. That is not
	 * available: `staleExcuses` fails any entry whose key fires on no pull's sweep, and this key fires on
	 * none of them, so writing the reason down would break the guard that keeps reasons honest. Both
	 * halves are checked below, so neither can be assumed.
	 *
	 * So the resolution was a row — `lane(ESSENCE_OF_YULON, …)` in `index.ts` — and the structural gap is
	 * left **open and named**. Closing it means widening the sweep to auras the player put on *enemies*,
	 * which is a change to `lib/analysis/drawnAuras` and to both specs' copies of this file at once, and
	 * would demand a ledger decision for every enemy debuff on both. That is not this file's to do alone.
	 */
	it('cannot see an enemy debuff at all, and the ledger cannot excuse one either', () => {
		for (const name of FIXTURES) {
			const dataset = load(name);
			// Fires, plainly: the player's own applications of 146198 on whatever they were hitting.
			const applies = dataset.events.filter(
				(e) => e.abilityGameID === 146_198 && e.type === 'applydebuff' && e.sourceID === dataset.actor.id,
			);
			expect(applies.length, `${name} applies`).toBeGreaterThan(10);
			// And is invisible to this guard's sweep, on every kind of evidence it accepts.
			expect(firedOn(dataset).has('essence-of-yulon'), `${name} sweep`).toBe(false);
			// The sweep is not simply empty — it sees a dozen and more of the player's own auras.
			expect(firedOn(dataset).size, `${name} sweep size`).toBeGreaterThan(10);
			// It is drawn all the same, which is the resolution. Not by this guard's doing.
			expect(drawnOn(dataset).has('essence-of-yulon'), `${name} lane`).toBe(true);
		}

		// The dead end, demonstrated on a copy of the ledger rather than described: an entry for this key
		// is rejected as stale by the very check that keeps `NOT_LANES` from rotting.
		const withEntry = { ...NOT_LANES, 'essence-of-yulon': 'an enemy debuff, so this sweep cannot see it' };
		expect(
			staleExcuses(
				withEntry,
				FIXTURES.map((name) => firedOn(load(name))),
			),
		).toEqual(['essence-of-yulon']);
	});

	it('keeps the ledger honest — nothing excused that no longer fires, nothing excused that is drawn', () => {
		// A reason for an aura that stopped appearing is a reason nobody will ever check. Asserted across
		// the three pulls together, because a defensive is not pressed on every one.
		expect(
			staleExcuses(
				NOT_LANES,
				FIXTURES.map((name) => firedOn(load(name))),
			),
		).toEqual([]);

		// And the other direction, which is the one that bites here: `earth-elemental` is on this ledger
		// saying it has no row *yet*, and gaining one is the change most likely to be made next. An entry
		// that survives the lane it was excusing tells the next reader not to look, and nothing else in this
		// file notices — a drawn key satisfies the sweep, and a firing key satisfies the check above. So when
		// this fails naming `earth-elemental`, the lane landed and the entry above is what to delete.
		for (const name of FIXTURES) {
			expect(redundantExcuses(NOT_LANES, drawnOn(load(name))), `${name}`).toEqual([]);
		}
	});
});
