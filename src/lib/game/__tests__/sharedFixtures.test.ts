// What the shared declarations do to a real pull, measured on the committed fixtures.
//
// The tests beside this one in `shared.test.ts` check the declarations against the client data. These
// check them against events: an id can be right in DBC and still never reach the engine, which is
// exactly how the T16 two-piece stayed empty through fifty-three green tests. Every number below was
// read off a committed `FightDataset` and not off the declaration under test.
//
// Driven through `auraWindows` — the same call every lane in both specs is built from — rather than
// through a hand-rolled scan, so a window counted here is a window the report would draw.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { auraWindows } from '~/lib/analysis/auras';
import { createRegistry } from '~/lib/game/registry';
import { SHARED_ABILITIES, SHARED_AURAS } from '~/lib/game/shared';
import type { Analysis, FightDataset } from '~/lib/types';
import { analyse as analyseWindwalker } from '~/specs/windwalker';

const registry = createRegistry({ abilities: SHARED_ABILITIES, auras: SHARED_AURAS });

const fixture = (spec: string, file: string): FightDataset =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../specs/${spec}/__fixtures__/${file}`), 'utf8'));

/** Windows for one shared aura on one fixture, on the player's own stream, as a lane would build them. */
function windowCount(dataset: FightDataset, key: string): number {
	const t0 = dataset.fight.startTime;
	const own = dataset.events.filter((e) => (e as { targetID?: number }).targetID === dataset.actor.id);
	return auraWindows(own, registry.aura(key), t0, dataset.fight.endTime - t0).length;
}

const ELEMENTAL = ['cleave.json', 'phased.json', 'unbroken.json'] as const;

describe('the tinker buff on an Elemental pull', () => {
	/**
	 * The finding, and the reason a measurement can be right and still be wrong: the aura carried 96228
	 * alone, which is the *agility* id, and every reference pull it was measured on was a monk's. All
	 * three committed Elemental fixtures press the tinker (126734) and all three write **96230**, because
	 * a shaman's highest stat is intellect. So the press had a row and the buff it opened had nothing —
	 * on every Elemental pull in the repository, from the day the second spec existed.
	 */
	for (const file of ELEMENTAL) {
		it(`${file} opens a Synapse Springs window it could not open before`, () => {
			const dataset = fixture('elemental', file);
			expect(windowCount(dataset, 'synapse-springs')).toBeGreaterThan(0);
		});
	}

	/** And it is the intellect id doing it, not the agility one that was already declared. */
	it('opens them on 96230 and not on 96228', () => {
		const dataset = fixture('elemental', 'phased.json');
		const t0 = dataset.fight.startTime;
		const own = dataset.events.filter((e) => (e as { targetID?: number }).targetID === dataset.actor.id);
		const windows = auraWindows(own, registry.aura('synapse-springs'), t0, dataset.fight.endTime - t0);
		expect(windows.map((w) => w.id)).toEqual([96_230, 96_230, 96_230, 96_230]);
		expect(windows.map((w) => w.variant)).toEqual(['Intellect', 'Intellect', 'Intellect', 'Intellect']);
	});
});

describe('the item effects three Elemental pulls wear and nothing declared', () => {
	/**
	 * Four effects, each confirmed by events on a committed fixture rather than by a sim citation. None
	 * of them is drawn yet — both specs build their timeline from a curated list of aura keys, and adding
	 * a key to those lists is a change in `specs/*​/lib/index.ts` — but the model can now see them, which
	 * is the half that was missing.
	 *
	 * `essence-of-yulon` is the one worth naming twice: it is an **enemy debuff**, so a Buffs sweep
	 * cannot see it at all, and it is the busiest of the four.
	 */
	const expected: Array<[string, [number, number, number]]> = [
		// [aura key, windows on cleave / phased / unbroken]
		['jade-spirit', [10, 8, 5]],
		['toxic-power', [5, 6, 5]],
		['lightweave', [5, 0, 4]],
		// Purified Bindings of Immerseus, and the only one of the five found by asking the *other*
		// question: not "which declared aura never fires" but "which id do these pulls carry that nothing
		// declares". The first hole is what the coverage ledger guards; this was the second, and the same
		// blind spot held `combatantinfo`'s Leader of the Pack while the raid-buff row read it absent.
		['expanded-mind', [3, 2, 2]],
	];

	for (const [key, counts] of expected) {
		it(`${key} opens windows on the committed pulls`, () => {
			const measured = ELEMENTAL.map((file) => windowCount(fixture('elemental', file), key));
			expect(measured).toEqual(counts);
		});
	}

	/**
	 * The debuff, counted on the enemy rather than on the player — which is why it needs its own reading
	 * and why `windowCount` above would have found nothing for it.
	 */
	it("Essence of Yu'lon lands on the enemy on all three pulls", () => {
		const counts = ELEMENTAL.map((file) => {
			const dataset = fixture('elemental', file);
			const applies = dataset.events.filter(
				(e) =>
					(e as { abilityGameID?: number }).abilityGameID === 146_198 &&
					(e as { type?: string }).type === 'applydebuff' &&
					(e as { sourceID?: number }).sourceID === dataset.actor.id,
			);
			return applies.length;
		});
		expect(counts).toEqual([13, 18, 16]);
		expect(registry.auraById(146_198)?.kind).toBe('debuff');
	});
});

describe('the weapon enchant a Windwalker wears and nothing declared', () => {
	/**
	 * Dancing Steel, 28 events on the committed Windwalker pull and 13,024 across three raid nights —
	 * under 120032, which is an id neither the simulator nor `db.json` carries. Both name 118334/118335
	 * instead, and neither of those appears in any of the 1,317 distinct friendly ids the sweep saw.
	 */
	it('opens Dancing Steel windows on 120032', () => {
		const dataset = fixture('windwalker', 'dataset-ironJuggernaut.json');
		// Nine and not the twelve `applybuff` events the fixture holds: `auraWindows` closes a window on a
		// removal, and three of the twelve applications land while the buff is already up. Pinning the
		// window count rather than the event count is the point — an assertion counting the applies would
		// have derived both sides from the same scan and passed whatever the engine did with them.
		expect(windowCount(dataset, 'dancing-steel')).toBe(9);
		expect(registry.auraById(118_334)).toBeUndefined();
		expect(registry.auraById(118_335)).toBeUndefined();
	});
});

describe('what the Windwalker report says differently', () => {
	/**
	 * The one reader-visible change on any committed fixture, and it is the whole of it: the monk's
	 * Synapse Springs lane now says which stat each window granted. `AuraWindow.variant` exists so the
	 * timeline can "name the stat instead of drawing three indistinguishable bars" (`lib/types.ts`), and
	 * before the tinker declared its three ids there was no variant to name — the field was absent on
	 * every window of that lane.
	 *
	 * Asserted through `analyse()` and not through `auraWindows` so that it is the *report's* lane being
	 * read, which is the thing a person would see.
	 */
	it('names the stat on every Synapse Springs window', () => {
		const analysis = analyseWindwalker(fixture('windwalker', 'dataset-ironJuggernaut.json')) as Analysis;
		const lane = analysis.timeline?.lanes.find((l) => l.key === 'synapse-springs');
		expect(lane?.windows.map((w) => w.variant)).toEqual(['Agility', 'Agility', 'Agility', 'Agility']);
	});
});
