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

import { aurasPutOnPlayer, drawnLaneKeys, selfAuraEvents, staleExcuses, undrawnAuras } from '~/lib/analysis/drawnAuras';
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
	// Declared for its **duration bound** and nothing else: `auraWindows`' `openAtPull` inference refuses
	// to recover a pre-pull window without one, and until this aura existed a pre-pulled Earth Elemental
	// was indistinguishable from a cooldown nobody pressed (§68). The Earth Elemental has never had a
	// timeline row — before that declaration or after it — so this excuses the status quo rather than a
	// regression. It is also the strongest candidate on this list for gaining one, and that belongs to
	// whoever owns the drawing: the Fire Elemental's own row is the worked precedent, and unlike the
	// three below there is a real rotational claim here, since the summon takes a global and holds the
	// earth totem slot for its minute.
	'earth-elemental': 'no timeline row yet — declared for the pre-pull inference, see §68',
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

	it('keeps the ledger honest — nothing excused that no longer fires', () => {
		// A reason for an aura that stopped appearing is a reason nobody will ever check. Asserted across
		// the three pulls together, because a defensive is not pressed on every one.
		expect(
			staleExcuses(
				NOT_LANES,
				FIXTURES.map((name) => firedOn(load(name))),
			),
		).toEqual([]);
	});
});
