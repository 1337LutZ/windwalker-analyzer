// Every aura the log put on this player has somewhere to be drawn, or a stated reason not to.
//
// **This spec had no version of this guard, and the gap was not hypothetical.** Both other specs run
// one, and it could say nothing here while the audit published `lanes: []` — the honest answer for
// every aura was the same one. The moment lanes existed it became the guard that matters, and the
// first thing it would have caught is what a reader caught instead: the audit built its rows from a
// hand-written list of nine auras, so Synapse Springs, Skull Banner, Bloodlust, Rallying Cry, the
// trinket procs and the potion were all declared, all firing, and all drawing nothing.
//
// It found one more on its first run that nobody had reported. On `fallenProtectors` Ancestral Vigor
// carries 110 events and **every one is a `refreshbuff`**: a healer put it up before the pull and it
// never dropped, so there is no application to open a window from and `combatantinfo` does not list it
// either. `openOnRefresh` is what reaches that, and without it the aura ran the whole pull and drew
// nothing.
//
// The opposite question to `fixtureCoverage.test.ts`, which asks which declared aura never fires —
// that catches an id wired to a number the game does not write. This catches an aura declared with the
// *right* id, firing on a committed pull, that no chart draws.

import { describe, expect, it } from 'vitest';

import { rawFixtures } from '~/lib/analysis/fixtures';
import {
	aurasPutOnEnemies,
	aurasPutOnPlayer,
	drawnLaneKeys,
	mergeCounts,
	redundantExcuses,
	staleExcuses,
	undrawnAuras,
} from '~/lib/analysis/drawnAuras';
import { analyse, registry } from '~/specs/protection/lib';
import type { Analysis, FightDataset } from '~/lib/types';

/**
 * Auras that fire and deliberately have no lane, each with the reason.
 *
 * Kept to the shortest list that is true. Three of the four exclusions the audit makes are invisible
 * here because they are drawn *somewhere* — Vengeance as its own resource bar, Weakened Blows as one
 * row per enemy, and Censure never fires on these pulls at all — and `drawnLaneKeys` collapses the
 * per-enemy rows, so only the genuinely rowless key needs excusing.
 */
const NOT_LANES: Record<string, string> = {
	// Drawn as a press row instead, which is the only place it can be: the log emits no cast for this
	// button, so the debuff going up *is* the press — see `executionSentence.test.ts`. A second row for
	// the same instants, drawn as a bar on the enemy, would be the same evidence twice under one name.
	'execution-sentence': 'drawn as a press row; the debuff is the press',
};

const RAW = rawFixtures('protection');
const FIXTURES = RAW.map(({ name }) => name.replace(/\.json$/, ''));

const load = (name: string): FightDataset => {
	const found = RAW.find((fixture) => fixture.name === `${name}.json`);
	if (found === undefined) throw new Error(`no raw fixture protection/${name}.json`);
	return found.dataset;
};

/** Both halves: what the log put on the player, and what the player put on an enemy. */
const firedOn = (dataset: FightDataset) =>
	mergeCounts(aurasPutOnPlayer(dataset, registry), aurasPutOnEnemies(dataset, registry));

const drawnOn = (dataset: FightDataset): Set<string> => drawnLaneKeys(analyse(dataset) as Analysis);

describe('an aura that fired has somewhere to be drawn', () => {
	it.each(FIXTURES)('%s draws or accounts for everything it carried', (name) => {
		const dataset = load(name);
		const fired = firedOn(dataset);
		// Not vacuous: every committed pull moves at least a dozen declared auras, so an empty sweep here
		// would mean the reader is broken rather than that the spec is clean.
		expect(fired.size, name).toBeGreaterThan(10);

		expect(undrawnAuras(fired, drawnOn(dataset), NOT_LANES), name).toEqual([]);
	});

	/**
	 * The ledger cannot outlive what it excuses.
	 *
	 * An entry for an aura no pull fires any more is a note nobody can check, and an entry for one that
	 * *is* drawn is a note that would hide the row going missing again.
	 */
	it('excuses nothing that never fires and nothing that is already drawn', () => {
		const sweeps = FIXTURES.map((name) => firedOn(load(name)));
		expect(staleExcuses(NOT_LANES, sweeps)).toEqual([]);
		for (const name of FIXTURES) {
			expect(redundantExcuses(NOT_LANES, drawnOn(load(name))), name).toEqual([]);
		}
	});

	/**
	 * The specific regression, pinned by name rather than left to the sweep.
	 *
	 * These five were the ones a reader found missing, and a sweep that went green for some other reason
	 * would not say so. Bloodlust and Rallying Cry are absent from this list on purpose — they do not
	 * land on every pull, and the sweep above already covers them where they do.
	 */
	it.each(['synapse-springs', 'skull-banner', 'stormlash-totem'])('draws %s wherever it fired', (key) => {
		const carried = FIXTURES.filter((name) => firedOn(load(name)).has(key));
		expect(carried.length, `${key} fires on no committed pull`).toBeGreaterThan(0);
		for (const name of carried) expect(drawnOn(load(name)), `${name}/${key}`).toContain(key);
	});
});
