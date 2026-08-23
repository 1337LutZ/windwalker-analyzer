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
import { analyse as analyseElemental } from '~/specs/elemental/lib';
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
	 * Four effects, each confirmed by events on a committed fixture rather than by a sim citation.
	 *
	 * **This block used to end "none of them is drawn yet", and that has stopped being true — corrected
	 * rather than deleted, because a reader who remembers the old sentence is owed the reason it changed.**
	 * It said the model could now see these four but no chart could, since "both specs build their
	 * timeline from a curated list of aura keys, and adding a key to those lists is a change in
	 * `specs/*​/lib/index.ts`". That was an accurate description of the state `0e4f07c` left, and it was
	 * the description of a *queue*: the declaration had landed and the rows had not. `3745c92` drew them.
	 * All four are lanes in `specs/elemental/lib/index.ts` now — `JADE_SPIRIT`, `LIGHTWEAVE`,
	 * `TOXIC_POWER`, `EXPANDED_MIND` — and the test below asserts it, so the claim in this paragraph is
	 * checked rather than remembered.
	 *
	 * The sentence mattered because of where a reader arrives from: this is the file an audit of the item
	 * sweep is pointed at, so "not drawn yet" here reads as "the drawing never landed" — the same
	 * queue-that-was-emptied trap `index.ts`' `FIRE_ELEMENTAL_COOLDOWN_MS` docblock names, where a note
	 * explaining why something was left undone outlived the doing of it.
	 *
	 * **The Windwalker half of the old sentence is still true and is not a gap.** `3745c92` added rows to
	 * the Elemental only, and that spec's list is the one these four needed: all five keys in this block
	 * appear in the *Windwalker* column of `analysis/__tests__/fixtureCoverage.test.ts`' `SILENT_AURAS`,
	 * which is that guard saying they fire on no committed Windwalker pull. A row for an effect the
	 * fixture never procs would draw nothing.
	 *
	 * `essence-of-yulon` is the one worth naming twice: it is an **enemy debuff**, so a Buffs sweep cannot
	 * see it at all, and it is the busiest of the four. It was the last of the five without a row, and it
	 * outlasted the other four for a structural reason rather than by being forgotten — the guard that
	 * found them walks auras put on the *player*. Its own block below carries that finding.
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
	 * And each of the four has a row, which is the half the paragraph above used to say was missing.
	 *
	 * Read off the analysed pull rather than off the lane list in `index.ts`, so this is the same set a
	 * reader would see on the chart. Every declared-and-firing effect in this block is asserted on every
	 * pull that procs it — `lightweave` does not proc on `phased` (0 windows above), and an empty lane is
	 * dropped from the timeline, so that one pull is asked only for the other three.
	 */
	it('draws all four of them on the Elemental timeline', () => {
		for (const file of ELEMENTAL) {
			const analysis = analyseElemental(fixture('elemental', file)) as Analysis;
			const drawn = new Set(analysis.timeline?.lanes.map((l) => l.key) ?? []);
			for (const [key, counts] of expected) {
				// Only where the effect actually fired on this pull; a lane with no window is not drawn.
				if (counts[ELEMENTAL.indexOf(file)] === 0) continue;
				expect(drawn.has(key), `${file} ${key}`).toBe(true);
			}
		}
	});

	/**
	 * The debuff, counted on the enemy rather than on the player — which is why it needs its own reading
	 * and why `windowCount` above would have found nothing for it.
	 *
	 * **That "why" is the finding, not a caveat about this test's shape.** Three of the four guards that
	 * are supposed to make a missing row impossible read the player's own stream: `aurasPutOnPlayer` and
	 * `auraIdsPutOnPlayer` in `lib/analysis/drawnAuras`, and `windowCount` here. So an item effect that
	 * lands on the enemy is not merely unnoticed by them, it is *unreachable*, and this proc sat undrawn
	 * on all three pulls after the other four had rows. `specs/elemental/lib/__tests__/drawnAuras.test.ts`
	 * proves the blindness and proves that the `NOT_LANES` ledger has no slot for the class either; the
	 * resolution here was a row.
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

	/**
	 * And it has a row now — the last of the five, and the one no player-scoped guard could have asked for.
	 *
	 * Built from the union across every spawn that carried it rather than from the primary target alone,
	 * because a cloak proc lands on whatever the spell hit: `cleave` burns adds as readily as Iron Qon, and
	 * a primary-scoped walk would draw part of the row and label it the proc's uptime.
	 *
	 * Counts rather than a bare `has`, so a walk that silently collapsed the row to one long window fails
	 * here. They come out **equal to the application counts above on all three pulls, and that is a
	 * coincidence rather than a rule** — worth saying because it invites the wrong inference. The walk
	 * opens on refresh, so a refresh extends a window instead of adding one (`unbroken`'s first is
	 * 3 096 → 10 113 ms, well past the aura's declared four seconds), and windows on two spawns burning at
	 * once are merged. Both effects are live here and happen to cancel. Asserting the pair is the point:
	 * the two numbers are read by different walks and are free to disagree.
	 */
	it("draws Essence of Yu'lon on the Elemental timeline", () => {
		const drawn = ELEMENTAL.map((file) => {
			const analysis = analyseElemental(fixture('elemental', file)) as Analysis;
			return analysis.timeline?.lanes.find((l) => l.key === 'essence-of-yulon')?.windows.length;
		});
		// cleave / phased / unbroken, the order `ELEMENTAL` is in.
		expect(drawn).toEqual([13, 18, 16]);
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

describe('the two shared haste bands that can be up at once', () => {
	/**
	 * `bloodlust` and `berserking` are both shared auras and both drawn as a band across the cast log, so
	 * a pull that has them up together is the only thing that exercises the band's **overlap** composite.
	 * That composite is a drawing decision and not arithmetic — two translucent washes stacked read
	 * darker than either, and the fix chosen was one band per stretch rather than a lower alpha — which
	 * is exactly the kind of claim that needs a route to a real pull rather than a hand-built mark.
	 *
	 * Read off `analyse()`'s `timeline` rather than through `auraWindows` because those two arrays are
	 * what the band is drawn from; a window measured here that the timeline never publishes would prove
	 * nothing about the drawing.
	 */
	const timelineOf = (file: string) => analyseElemental(fixture('elemental', file)).timeline;

	/**
	 * Why the pull already on the preview page cannot show it: `phased` has a Heroism band and **no
	 * Berserking window at all**, so its one band never has a second under it.
	 */
	it('phased has a haste band and nothing to overlap it', () => {
		const timeline = timelineOf('phased.json');
		expect(timeline?.hasteWindows).toEqual([{ start: 1777, end: 41_785, id: 32_182, variant: 'Heroism' }]);
		expect(timeline?.berserkingWindows).toEqual([]);
	});

	/** And `unbroken` does: the Berserking window sits entirely inside the Bloodlust one. */
	it('unbroken nests a whole Berserking window inside its Bloodlust', () => {
		const timeline = timelineOf('unbroken.json');
		expect(timeline?.hasteWindows).toEqual([{ start: 785, end: 40_790, id: 2825, variant: 'Bloodlust' }]);
		const first = timeline?.berserkingWindows?.[0];
		expect(first?.start).toBe(3673);
		expect(first?.end).toBe(13_677);
		// Contained, not merely touching — so the composite is a full stretch of two bands and not a seam.
		expect(first!.start).toBeGreaterThan(785);
		expect(first!.end).toBeLessThan(40_790);
	});

	/**
	 * And the measurement is reachable by a person, which is the half no measurement can assert about
	 * itself: `/preview` is the only route in this app that renders a report without a WarcraftLogs
	 * token, so a pull that is not in its map cannot be looked at. Read off the page's source because the
	 * map is a local in Astro frontmatter — there is nothing to import.
	 */
	it('and the overlap pull is on the only token-free route', () => {
		const page = readFileSync(resolve(import.meta.dirname, '../../../pages/preview.astro'), 'utf8');
		const map = /const fixtures = \{([^}]*)\}/.exec(page);
		expect(map, 'preview.astro no longer declares a `fixtures` object literal').not.toBeNull();
		const names = map![1]!.split(',').map((n) => n.trim());
		expect(names).toContain('unbroken');
	});
});
