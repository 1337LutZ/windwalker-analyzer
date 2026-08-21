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

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

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

/** Every declared aura the log applied to the player, by key, with how many times. */
const firedOn = (dataset: FightDataset): Map<string, number> => {
	const out = new Map<string, number>();
	for (const e of dataset.events) {
		const event = e as { type: string; abilityGameID?: number; targetID?: number };
		if (event.targetID !== dataset.actor.id) continue;
		if (!event.type.startsWith('apply') && event.type !== 'refreshbuff') continue;
		const aura = registry.auraById(event.abilityGameID ?? -1);
		if (aura === undefined) continue;
		out.set(aura.key, (out.get(aura.key) ?? 0) + 1);
	}
	return out;
};

describe('an aura that fired has somewhere to be drawn', () => {
	it.each(FIXTURES)('%s draws or accounts for everything the player was given', (name) => {
		const dataset = load(name);
		const fired = firedOn(dataset);
		// Not vacuous: these pulls really do buff the player with a dozen declared auras or more.
		expect(fired.size).toBeGreaterThan(10);

		const drawn = new Set(((analyse(dataset) as Analysis).timeline?.lanes ?? []).map((l) => l.key));
		const orphans = [...fired.keys()].filter((key) => !drawn.has(key) && NOT_LANES[key] === undefined).sort();
		expect(orphans).toEqual([]);
	});

	it('draws the two trinkets that were missing, on every pull that procced them', () => {
		// Named rather than left to the sweep above, because these two are the report: a reader saw them in
		// their own log and could not find them here. `expanded-mind` is Purified Bindings of Immerseus and
		// `toxic-power` is Kardris' Toxic Totem.
		for (const name of FIXTURES) {
			const dataset = load(name);
			const fired = firedOn(dataset);
			const drawn = new Set(((analyse(dataset) as Analysis).timeline?.lanes ?? []).map((l) => l.key));
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
			const drawn = new Set(((analyse(dataset) as Analysis).timeline?.lanes ?? []).map((l) => l.key));
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
		const everywhere = new Set(FIXTURES.flatMap((name) => [...firedOn(load(name)).keys()]));
		const stale = Object.keys(NOT_LANES).filter((key) => !everywhere.has(key));
		expect(stale).toEqual([]);
	});
});
