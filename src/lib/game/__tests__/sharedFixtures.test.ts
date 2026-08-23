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
import { rawFixtures } from '~/lib/analysis/fixtures';
import { createRegistry } from '~/lib/game/registry';
import { SHARED_ABILITIES, SHARED_AURAS, SHARED_ITEM_SOURCES } from '~/lib/game/shared';
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

/**
 * Every raw Elemental fixture, found rather than listed.
 *
 * **This was `['cleave.json', 'phased.json', 'unbroken.json']`.** `RAW_PULLS` at the foot of this file has
 * always gone through `rawFixtures`, and this constant did not — so the gear census and the
 * equipped-iff-fired biconditional swept `addsThenBoss.json` from the day it landed while every window
 * count and the Essence of Yu'lon grids above went on describing three pulls. One of those grids says the
 * two Yu'lon readings are "free to disagree"; on the fourth pull they do, by six windows, and nothing was
 * asking.
 *
 * The grids below are keyed by file name rather than positional, because the order `rawFixtures` returns
 * is the directory's and a positional grid silently re-pairs itself when a name sorts before `cleave`.
 */
const ELEMENTAL = rawFixtures('elemental').map(({ name }) => name);

describe('the tinker buff on an Elemental pull', () => {
	/**
	 * The finding, and the reason a measurement can be right and still be wrong: the aura carried 96228
	 * alone, which is the *agility* id, and every reference pull it was measured on was a monk's. All
	 * **four** committed Elemental fixtures press the tinker (126734) and all four write **96230**, because
	 * a shaman's highest stat is intellect. So the press had a row and the buff it opened had nothing —
	 * on every Elemental pull in the repository, from the day the second spec existed. `addsThenBoss` opens
	 * nine such windows and is swept by this automatically now rather than by name.
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

describe('the item effects the Elemental pulls wear and nothing declared', () => {
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
	const expected: Array<[string, Record<string, number>]> = [
		// [aura key, windows per fixture file]
		['jade-spirit', { 'addsThenBoss.json': 17, 'cleave.json': 10, 'phased.json': 8, 'unbroken.json': 5 }],
		['toxic-power', { 'addsThenBoss.json': 0, 'cleave.json': 5, 'phased.json': 6, 'unbroken.json': 5 }],
		['lightweave', { 'addsThenBoss.json': 0, 'cleave.json': 5, 'phased.json': 0, 'unbroken.json': 4 }],
		// Purified Bindings of Immerseus, and the only one of the five found by asking the *other*
		// question: not "which declared aura never fires" but "which id do these pulls carry that nothing
		// declares". The first hole is what the coverage ledger guards; this was the second, and the same
		// blind spot held `combatantinfo`'s Leader of the Pack while the raid-buff row read it absent.
		['expanded-mind', { 'addsThenBoss.json': 0, 'cleave.json': 3, 'phased.json': 2, 'unbroken.json': 2 }],
	];

	/**
	 * **Three of the four rows read zero on `addsThenBoss`, and every one of those zeros is a gear fact.**
	 *
	 * That pull's shaman wears Wushoolay's Final Choice and Breath of the Hydra where the other three wear
	 * Kardris' Toxic Totem and Purified Bindings of Immerseus, so `toxic-power` and `expanded-mind` have
	 * nothing to fire; and its cloak carries enchant **4423**, plain Superior Intellect, exactly as
	 * `phased`'s does, so `lightweave` has nothing either. None of that is inferred here — the
	 * equipped-iff-fired biconditional at the foot of this file is what licenses reading a zero that way,
	 * and it is the reason a grid full of zeros is a measurement rather than a shrug.
	 */
	for (const [key, counts] of expected) {
		it(`${key} opens windows on the committed pulls`, () => {
			// The grid is the whole committed set, so a fifth fixture fails by name rather than being
			// dropped from a positional list.
			expect(Object.keys(counts).sort()).toEqual([...ELEMENTAL].sort());
			const measured = Object.fromEntries(
				ELEMENTAL.map((file) => [file, windowCount(fixture('elemental', file), key)]),
			);
			expect(measured).toEqual(counts);
		});
	}

	/**
	 * And each of the four has a row, which is the half the paragraph above used to say was missing.
	 *
	 * Read off the analysed pull rather than off the lane list in `index.ts`, so this is the same set a
	 * reader would see on the chart. Every declared-and-firing effect in this block is asserted on every
	 * pull that procs it — `lightweave` does not proc on `phased` and three of the four do not proc on
	 * `addsThenBoss` (0 windows above), and an empty lane is dropped from the timeline, so those pulls are
	 * asked only for what they actually carry.
	 *
	 * **That 0 is a gear fact and not a dry spell**, which this grid alone cannot say: `phased`'s cloak
	 * carries enchant 4423, plain Superior Intellect, where the other two carry 4892. The gear sweep at
	 * the foot of this file is what establishes it, and `docs/item-effect-sweep.md` is why it matters —
	 * reading a zero as "the declaration is wrong" is the mistake that whole document is about.
	 */
	it('draws all four of them on the Elemental timeline', () => {
		let drawnRows = 0;
		for (const file of ELEMENTAL) {
			const analysis = analyseElemental(fixture('elemental', file)) as Analysis;
			const drawn = new Set(analysis.timeline?.lanes.map((l) => l.key) ?? []);
			for (const [key, counts] of expected) {
				// Only where the effect actually fired on this pull; a lane with no window is not drawn.
				if (counts[file] === 0) continue;
				expect(drawn.has(key), `${file} ${key}`).toBe(true);
				drawnRows += 1;
			}
		}
		// Not vacuous, which now matters: `addsThenBoss` contributes exactly one of these rows, so a grid
		// that had gone all-zero would otherwise satisfy the loop above in silence.
		expect(drawnRows).toBe(12);
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
	it("Essence of Yu'lon lands on the enemy on all four pulls", () => {
		const counts = Object.fromEntries(
			ELEMENTAL.map((file) => {
				const dataset = fixture('elemental', file);
				const applies = dataset.events.filter(
					(e) =>
						(e as { abilityGameID?: number }).abilityGameID === 146_198 &&
						(e as { type?: string }).type === 'applydebuff' &&
						(e as { sourceID?: number }).sourceID === dataset.actor.id,
				);
				return [file, applies.length];
			}),
		);
		// `addsThenBoss` is the busiest by a wide margin — a nine-minute pull with add waves, where the
		// other three are single-regime and under four and a half minutes.
		expect(counts).toEqual({
			'addsThenBoss.json': 40,
			'cleave.json': 13,
			'phased.json': 18,
			'unbroken.json': 16,
		});
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
	 * here. They come out **equal to the application counts above on three of the four pulls, and that was
	 * always a coincidence rather than a rule** — the walk opens on refresh, so a refresh extends a window
	 * instead of adding one (`unbroken`'s first is 3 096 → 10 113 ms, well past the aura's declared four
	 * seconds), and windows on two spawns burning at once are merged. Both effects are live and on those
	 * three they happen to cancel.
	 *
	 * *** On `addsThenBoss` they do not cancel: 40 applications draw 34 windows. *** This docblock already
	 * said the two numbers "are read by different walks and are free to disagree", and it was right — it
	 * simply had no pull where they did, because the grid under it was a hardcoded three and the fourth
	 * fixture was never asked. Six of its forty applications land while a window on another spawn is
	 * already open, which is the merge doing exactly what the paragraph describes. So the prediction is
	 * confirmed rather than corrected, and the pair is now pinned per pull instead of as one shared list.
	 */
	it("draws Essence of Yu'lon on the Elemental timeline", () => {
		const drawn = Object.fromEntries(
			ELEMENTAL.map((file) => {
				const analysis = analyseElemental(fixture('elemental', file)) as Analysis;
				return [file, analysis.timeline?.lanes.find((l) => l.key === 'essence-of-yulon')?.windows.length];
			}),
		);
		expect(drawn).toEqual({
			'addsThenBoss.json': 34,
			'cleave.json': 13,
			'phased.json': 18,
			'unbroken.json': 16,
		});
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

// ------------------------------------------- what the five pulls were actually wearing

/**
 * *** "Absent from every fixture" is not "wrong", and `combatantinfo` is what tells the two apart. ***
 *
 * Every guard above this line asks whether a declared effect *fired*. None of them can say why one
 * did not, and the difference is the whole of the item sweep's second tier: an id nobody wore and an
 * id declared on the wrong number look identical in a count of zero. That confusion has been made
 * twice in this repository's own notes — `docs/plan.md` §98's box 5 argued a metric unmeasurable
 * because "138898 appears zero times in every fixture", and §51's own box warns against exactly that
 * step — and both times the fact that would have settled it was already in the committed fixture.
 *
 * **And 138898 is no longer zero.** `addsThenBoss.json` is the fourth Elemental pull and its shaman
 * wears Breath of the Hydra (96455): the trinket is in the kit and the proc opens nine windows in the
 * fight. So the row that this whole docblock used as its example of "worn or not worn is answerable"
 * has now been answered in both directions by the fixture set — three pulls that did not own it and one
 * that did — and `elemental/lib/apl.ts`' band-3 assumption has something to read.
 *
 * `combatantinfo` carries the player's whole kit: eighteen slots with the item id in each, the gems
 * socketed into them and the `permanentEnchant` on the slots that have one. So "did this trinket
 * proc" and "did this player own this trinket" are separate, answerable questions, and this test asks
 * the second one and lines it up against the first.
 *
 * **The result is a biconditional, and it holds on all thirty-nine gear-sourced shared effects: an
 * effect fires on exactly the pulls whose player equipped it.** There is not one case of equipped-and-
 * silent anywhere in the committed set, which is what licenses reading every zero above as "not worn".
 * It survived the arrival of a pull wearing three effects no earlier pull did — `wushoolays-lightning`,
 * its stack counter and `breath-of-hydra` — which is the strongest evidence the instrument has had, and
 * the only kind it can get: a biconditional that holds only on the gear it was written against is a
 * tautology, and this is the first time it was asked about gear it had never seen.
 * The sharpest row is `lightweave`: it opens windows on `cleave` and `unbroken` and none on `phased`,
 * and the reason is not luck — that pull's cloak carries enchant 4423, plain Superior Intellect, where
 * the other two carry 4892. `sharedFixtures`' own grid pins the 0 and could only ever have said "did
 * not proc".
 *
 * Source ids are the **item, gem and enchant** ids of the thing that grants the effect, taken from
 * `assets/database/db.json` (`items[].itemEffects[].buffId` and `.stackingAura.buffId`,
 * `enchants[].enchantEffects[].buffId`, keyed by `effectId` because that is the number
 * `permanentEnchant` writes) — every ilvl variant of each item, since a fixture wears the upgraded id
 * and not the base one: the Elemental pulls carry Kardris' Toxic Totem as **104544** and not 102300.
 * The three meta gems and Rune of Re-Origination are named by hand because `db.json` carries no
 * player-visible buff for them — the Rune's only item effect there is the hidden `139116` "Item -
 * Attacks Proc Highest Rating" marker, which is the sweep's own finding one table over.
 *
 * **Two rows are not this table's own transcription, and read `SHARED_ITEM_SOURCES` instead.**
 * `breath-of-hydra` and `re-origination` are the two whose ids something outside a test joins on — the
 * Elemental ladder gates `aoe.apl.json` rung 1 on owning the first, and the Windwalker rotation
 * reference warns on not owning the second — so they live in `game/shared.ts` beside the auras they
 * grant, and each had a hand-written copy here that could not see the reader's. Deriving them makes
 * the biconditional below a statement about the list those readers actually use: a variant narrowed
 * out of it stops matching a committed kit here, where narrowing it used to be silent.
 *
 * Five shared auras are deliberately outside the table. `blood-fury` and `berserking` are racials,
 * `bloodlust` and `skull-banner` are other players' raid cooldowns: none of the four is gear and none
 * has a slot to be read out of. `synapse-springs` is the one that is gear and still cannot be read,
 * which is this instrument's own ceiling and has its own test below.
 */
const GEAR_SOURCES: Array<[key: string, sources: number[], equippedOn: string[]]> = [
	// ------------------------------------------------ Throne of Thunder trinkets
	['unerring-vision', [94_524, 95_814, 96_186, 96_558, 96_930], []],
	// The two rows `addsThenBoss.json` was fetched for. Its shaman wears Wushoolay's Final Choice as
	// **96413** and Breath of the Hydra as **96455** — the heroic Throne of Thunder ids, three tiers of
	// upgrade below the base 94_513/94_521 — where all three pulls before it wore the same two Siege
	// trinkets. `breath-of-hydra` is the one the ladder was waiting on: `elemental/lib/apl.ts` reads
	// `auraIsKnown(138898)` as owned at three targets and up because nothing here could show otherwise.
	['wushoolays-lightning', [94_513, 95_669, 96_041, 96_413, 96_785], ['elemental/addsThenBoss.json']],
	['wushoolays-lightning-stacks', [94_513, 95_669, 96_041, 96_413, 96_785], ['elemental/addsThenBoss.json']],
	// Sourced from `game/shared.ts` rather than written out again: `elemental/lib/apl.ts` gates a rung on
	// owning it, so the ids are a fact a reader outside this file joins on. See `SHARED_ITEM_SOURCES`.
	['breath-of-hydra', [...SHARED_ITEM_SOURCES['breath-of-hydra']], ['elemental/addsThenBoss.json']],
	['chayes', [94_531, 95_772, 96_144, 96_516, 96_888], []],
	['juju-madness', [94_523, 95_665, 96_037, 96_409, 96_781], []],
	['rampage', [94_519, 95_757, 96_129, 96_501, 96_873], []],
	['eye-of-brutality', [94_529, 95_799, 96_171, 96_543, 96_915], []],
	['blades-of-renataki', [94_512, 95_625, 95_997, 96_369, 96_741], []],
	['blades-of-renataki-stacks', [94_512, 95_625, 95_997, 96_369, 96_741], []],
	['feathers-of-fury', [94_515, 95_726, 96_098, 96_470, 96_842], []],
	['feathers-of-fury-stacks', [94_515, 95_726, 96_098, 96_470, 96_842], []],
	['cloudburst', [94_514, 95_641, 96_013, 96_385, 96_757], []],
	// Rune of Re-Origination, and the one row `db.json` cannot source: see the docblock. Sourced from
	// `game/shared.ts` for the same reason the row above is — `windwalker/lib/view/rotationFlow.ts` asks
	// whether the monk owned it before it will warn that they did not.
	['re-origination', [...SHARED_ITEM_SOURCES['re-origination']], ['windwalker/dataset-ironJuggernaut.json']],

	// --------------------------------------------------- Siege of Orgrimmar trinkets
	['wrath-of-darkspear', [102_310, 104_652, 104_901, 105_150, 105_399, 105_648], []],
	['wrath-of-darkspear-stacks', [102_310, 104_652, 104_901, 105_150, 105_399, 105_648], []],
	['cruelty', [102_308, 104_636, 104_885, 105_134, 105_383, 105_632], []],
	['cruelty-stacks', [102_308, 104_636, 104_885, 105_134, 105_383, 105_632], []],
	['dextrous', [102_292, 104_476, 104_725, 104_974, 105_223, 105_472], []],
	['titanic-restoration', [102_299, 104_478, 104_727, 104_976, 105_225, 105_474], []],
	['tenacious', [102_295, 104_463, 104_712, 104_961, 105_210, 105_459], []],
	['ferocity', [102_302, 104_584, 104_833, 105_082, 105_331, 105_580], []],
	['restless-agility', [102_311, 104_616, 104_865, 105_114, 105_363, 105_612], []],
	['vicious', [102_301, 104_531, 104_780, 105_029, 105_278, 105_527], ['windwalker/dataset-ironJuggernaut.json']],
	[
		'expanded-mind',
		[102_293, 104_426, 104_675, 104_924, 105_173, 105_422],
		['elemental/cleave.json', 'elemental/phased.json', 'elemental/unbroken.json'],
	],
	[
		'toxic-power',
		[102_300, 104_544, 104_793, 105_042, 105_291, 105_540],
		['elemental/cleave.json', 'elemental/phased.json', 'elemental/unbroken.json'],
	],

	// ------------------------------------------------------------------ meta gems
	['fortitude', [95_344], []],
	[
		'tempus-repit',
		[95_347],
		['elemental/addsThenBoss.json', 'elemental/cleave.json', 'elemental/phased.json', 'elemental/unbroken.json'],
	],
	['capacitance', [95_346], ['windwalker/dataset-ironJuggernaut.json']],

	// ----------------------------------------------------------- legendary cloaks
	['spirit-of-chi-ji', [102_247], []],
	// Two cloaks, one effect id — `db.json` gives 146194 to both melee legendaries.
	['flurry-of-xuen', [102_248, 102_249], ['windwalker/dataset-ironJuggernaut.json']],
	[
		'essence-of-yulon',
		[102_246],
		['elemental/addsThenBoss.json', 'elemental/cleave.json', 'elemental/phased.json', 'elemental/unbroken.json'],
	],

	// ---------------------------------------------------- weapon and cloak enchants
	['windsong', [4441], []],
	['rivers-song', [4446], []],
	['swordguard-embroidery', [3730, 4118, 4894], []],
	['lord-blastingtons', [4699], []],
	['dancing-steel', [4444], ['windwalker/dataset-ironJuggernaut.json']],
	[
		'jade-spirit',
		[4442],
		['elemental/addsThenBoss.json', 'elemental/cleave.json', 'elemental/phased.json', 'elemental/unbroken.json'],
	],
	// The row that makes the point: `phased` wears 4423 on the cloak, the other two wear 4892.
	['lightweave', [3722, 4115, 4892], ['elemental/cleave.json', 'elemental/unbroken.json']],
];

/** The pulls that carry raw events, keyed the way the coverage guard's grids are. */
const RAW_PULLS: Array<[string, FightDataset]> = ['elemental', 'windwalker'].flatMap((spec) =>
	rawFixtures(spec).map(({ name, dataset }) => [`${spec}/${name}`, dataset] as [string, FightDataset]),
);

/** Every item, gem and slot-enchant id the pull's `combatantinfo` says the player had on. */
function equippedIds(dataset: FightDataset): Set<number> {
	const info = dataset.events.find((event) => (event as { type?: string }).type === 'combatantinfo') as
		| { gear?: Array<{ id?: number; permanentEnchant?: number; gems?: Array<{ id?: number }> }> }
		| undefined;
	const worn = new Set<number>();
	for (const slot of info?.gear ?? []) {
		if (slot.id) worn.add(slot.id);
		if (slot.permanentEnchant) worn.add(slot.permanentEnchant);
		for (const gem of slot.gems ?? []) if (gem.id) worn.add(gem.id);
	}
	return worn;
}

/**
 * Events carrying one of the aura's ids, scoped to the audited player either way round.
 *
 * `sourceID` as well as `targetID`, and not for tidiness: `essence-of-yulon` is an enemy **debuff**,
 * so the player is the source and never the target of the one row here that is not a buff. These
 * streams do carry off-actor events — eleven to twenty ids per pull — so an unscoped count could
 * credit this player with another raider's identical trinket.
 */
function firedOnPlayer(dataset: FightDataset, key: string): number {
	const ids = new Set(registry.aura(key).ids);
	const actor = dataset.actor.id;
	return dataset.events.filter((event) => {
		const e = event as { abilityGameID?: number; sourceID?: number; targetID?: number };
		return e.abilityGameID !== undefined && ids.has(e.abilityGameID) && (e.sourceID === actor || e.targetID === actor);
	}).length;
}

describe('absent from every fixture, because not one of the five players wore it', () => {
	/**
	 * The census half: which pulls equip each effect, read off the gear and pinned.
	 *
	 * A grid rather than a per-row `it`, so a fixture arriving with a trinket nobody has worn yet fails
	 * once, by name, showing what it brought — which is the moment to move that id out of the report's
	 * second tier and into its first. That is exactly what it did for `addsThenBoss.json`: one red, three
	 * rows named, and the trinket the ladder needed among them.
	 */
	it('reads the same kit out of every pull it did', () => {
		const measured = Object.fromEntries(
			GEAR_SOURCES.map(([key, sources]) => [
				key,
				RAW_PULLS.filter(([, dataset]) => sources.some((id) => equippedIds(dataset).has(id))).map(([name]) => name),
			]),
		);
		expect(measured).toEqual(Object.fromEntries(GEAR_SOURCES.map(([key, , equippedOn]) => [key, equippedOn])));
	});

	/**
	 * And the half that makes the zeros above readable: **equipped if and only if fired.**
	 *
	 * Asserted as one biconditional per row rather than as two lists, because the two failures it has to
	 * separate are opposite. A row that fires where nothing is equipped is a source-id list that has
	 * gone wrong; a row equipped and silent is the interesting one — a declaration on a number the game
	 * does not write, which is the 144998 shape and the only thing in this file that could catch it on
	 * gear the fixtures actually own.
	 */
	it('fires on exactly the pulls that equipped it', () => {
		for (const [key, sources] of GEAR_SOURCES) {
			for (const [name, dataset] of RAW_PULLS) {
				const equipped = sources.some((id) => equippedIds(dataset).has(id));
				expect(firedOnPlayer(dataset, key) > 0, `${name} ${key}: equipped=${equipped}`).toBe(equipped);
			}
		}
	});

	/**
	 * Not vacuous, and stated as the two totals the assertions above are silent about: a table of
	 * thirty-nine rows all reading `[]` would satisfy both.
	 */
	it('really does sweep five pulls, some of it equipped and most of it not', () => {
		expect(RAW_PULLS.map(([name]) => name)).toEqual([
			'elemental/addsThenBoss.json',
			'elemental/cleave.json',
			'elemental/phased.json',
			'elemental/unbroken.json',
			'windwalker/dataset-ironJuggernaut.json',
		]);
		expect(GEAR_SOURCES.length).toBe(39);
		expect(GEAR_SOURCES.filter(([, , on]) => on.length > 0).length).toBe(14);
		// Eighteen slots read on every pull, and a kit is dozens of ids — not an empty gear array.
		for (const [name, dataset] of RAW_PULLS) expect(equippedIds(dataset).size, name).toBeGreaterThan(20);
	});

	/**
	 * *** The glove tinker is the hole in this instrument, and it is worth a test rather than a note. ***
	 *
	 * Synapse Springs is enchant 4898 and it is gear like any other — but `combatantinfo` reports **one**
	 * `permanentEnchant` per slot, and on all **five** of these pulls the hand slot reports 4433, Superior
	 * Mastery. The tinker is a second enchant on the same item and there is nowhere in this event for it
	 * to go. So the gear reading says "no tinker" on five pulls that all press 126734 — which means the
	 * biconditional above is a statement about trinkets, gems, cloaks and slot enchants, and **not** a
	 * general licence to read gear as the whole of what a player is wearing.
	 *
	 * The count read "four" and the loop below has always walked `RAW_PULLS`, which is `rawFixtures` over
	 * both specs — four Elemental pulls and one Windwalker. So the sentence was one behind its own
	 * assertion from the moment `addsThenBoss.json` landed; the loop is asserted against the length now
	 * rather than counted in prose.
	 */
	it('cannot see the glove tinker, which every committed pull demonstrably had', () => {
		expect(RAW_PULLS.length).toBe(5);
		for (const [name, dataset] of RAW_PULLS) {
			const worn = equippedIds(dataset);
			expect(worn.has(4898), `${name} reports the tinker`).toBe(false);
			expect(worn.has(4433), `${name} hand slot enchant`).toBe(true);
			// Pressed all the same, on every pull.
			const pressed = dataset.events.filter(
				(event) => (event as { abilityGameID?: number }).abilityGameID === 126_734,
			).length;
			expect(pressed, `${name} presses Synapse Springs`).toBeGreaterThan(0);
		}
	});
});
