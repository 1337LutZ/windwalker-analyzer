// Every aura the log put on the player has somewhere to be drawn, or a stated reason not to.
//
// **The opposite question to the coverage ledger, and the one nobody was asking here.**
// `analysis/__tests__/fixtureCoverage.test.ts` asks "which declared aura never fires", which catches an id
// wired to a number the game does not write. It is structurally blind to this: an aura declared with the
// *right* id, firing on the committed pull, that no chart draws. The Elemental lost both of a reader's
// trinkets that way and gained `drawnAuras.test.ts` for it — this is its Windwalker counterpart, and it was
// needed because that guard covers one spec while the gap is a property of hand-curated lane lists. This
// spec keeps its own: `GEAR_PROCS` and `ITEM_USES` are literals in `index.ts`, so an effect is drawn only
// if somebody typed its key.
//
// Measured before it was fixed, on `dataset-ironJuggernaut`: four auras the log put on the player had no
// row — `dancing-steel` (the weapon enchant, 18 applications), `bloodlust` (the pull's Time Warp),
// `diffuse-magic` and `tigereye-brew-bank`. The first two are now lanes and the last two are excused below.
//
// **Why the sweep counts removals as well as applications.** Widening it added exactly one key on this
// fixture, and that key was `bloodlust`: the pull's haste cooldown went up before it started, so its only
// event is the removal at 39.9s and an apply-only sweep cannot see it at all. The missing row and the blind
// spot were the same fact, which is a poor thing for a guard to share with the bug it is guarding against.
// "The log put this aura on the player" is the question; an application is only one kind of evidence for it.
//
// **And the sweep has an enemy half now, which found a fifth.** For most of this file's life it read
// `targetID === actor.id` and nothing else, so an aura the player put on the **boss** was unreachable
// rather than merely unswept — the Elemental's counterpart lost `essence-of-yulon` to exactly that and
// recorded the hole as a test it could not close alone. Widening it named `blackout-kick-dot`: declared,
// 18 applications and 35 refreshes on this pull, drawn nowhere, and invisible to every guard in the
// repository. It is ledgered below rather than drawn, and the argument is beside the entry.
//
// **The sweep itself now lives in `~/lib/analysis/drawnAuras`**, shared with the Elemental's guard, which
// had been written days apart as a second copy that swept applications only. That file argues its own
// location and carries the reasoning; the merge took this file's shape as the base because this is the
// reading that found something. It also cost the Elemental's guard its blind spot, which turned out to be
// hiding the Fire Elemental on all three of that spec's pulls.
//
// **One raw fixture, and that is a limit rather than a choice.** `__fixtures__/{strong,mixed,poor,waves,
// weave,cleave}.json` are pre-analysed `Analysis` objects with **no `events` array at all** — the capture
// harness writes `analyse()`'s output, not its input — so the left-hand side of this diff cannot be
// measured on them by any means, and their stored `timeline.lanes` are frozen output from whichever engine
// captured them. What they can still say is said in the last test but one: five of the six carry a
// non-empty `energizing.hasteWindows`, so the missing Bloodlust row was every pull's, not this one's.

import { describe, expect, it } from 'vitest';

import {
	aurasPutOnEnemies,
	aurasPutOnPlayer,
	drawnLaneKeys,
	enemyAuraEvents,
	mergeCounts,
	redundantExcuses,
	selfAuraEvents,
	staleExcuses,
	undrawnAuras,
} from '~/lib/analysis/drawnAuras';
import { capturedAnalyses, rawFixture, rawFixtures } from '~/lib/analysis/fixtures';
import type { FightDataset } from '~/lib/types';
import { analyse, registry } from '../index';

/**
 * Auras that are put on the player and are deliberately not lanes, each with the reason.
 *
 * A ledger rather than a filter, and the distinction is the whole point of the file: "not drawn" and
 * "forgotten" are the same thing in a report and can only be told apart in the source.
 */
const NOT_LANES: Record<string, string> = {
	// Drawn above the rows as its own resource curve, not among them — `view/timelineBanks`, off
	// `brew.bankTimeline`. 127 applications on this pull, which is a row nobody wants as a row.
	'tigereye-brew-bank': 'drawn as the brew bank',
	// The player survived something. It changes nothing the rotation wanted, and a row for it would push
	// the rotation's own rows down the screen on a long pull.
	'diffuse-magic': 'defensive, no bearing on the rotation',
	// **The one thing the enemy half of the sweep found.** Blackout Kick's dot, 128531: 18 applications,
	// 35 refreshes and 18 removals on the committed pull, from 2.9s in to 52ms before the pull — so it is
	// up for very nearly the whole fight and a row for it would be one solid bar carrying no information.
	// It is also not unmeasured: 128531 is a `damageId` of `blackout-kick` (index.ts:518), so every point
	// of it is already in that press's row of the damage table, which is where a dot nobody decides
	// anything from belongs. A reader wanting the press itself has the cast timeline.
	'blackout-kick-dot': 'measured as Blackout Kick damage, and up all pull — a row would be one solid bar',
};

/**
 * Every raw pull this spec has committed, found rather than listed.
 *
 * **The listing was a hole in the guard family.** Two of the three aura guards named their fixtures as
 * literals while `analysis/__tests__/fixtureCoverage.test.ts` walked the directory, so a newly committed
 * pull was swept by one of the three and by the other two never. `~/lib/analysis/fixtures` is the shared
 * reading and argues its own shape; the sweep below iterates whatever it finds, and the pinned grids in
 * that coverage guard are where a new pull has to be acknowledged.
 *
 * There is one entry today, and it is one for a reason the next test but one records rather than works
 * around: the other six fixtures are captured `Analysis` objects with no `events` array.
 */
const RAW = rawFixtures('windwalker');

/**
 * The pull the named findings below are about.
 *
 * Named rather than swept, because Bloodlust's lone removal and Dancing Steel's eighteen applications
 * are facts about *this* log — a sweep would restate them as whatever the next pull happens to carry.
 * Resolved through discovery all the same, so a rename fails here instead of at a `readFileSync`.
 */
const dataset = rawFixture('windwalker', 'dataset-ironJuggernaut.json');

/** The pre-analysed pulls, which can answer only half of this and are asked only that half. */
const ANALYSED = capturedAnalyses('windwalker');

/**
 * Every declared aura the pull moved, by key, with how many events say so — **both halves**.
 *
 * Applications *and* removals — see the module doc. A removal with no application in front of it is the
 * signature of a buff that went up before the fight's event window opened, which is ordinary for a raid
 * cooldown and for a pre-pull consumable, and is exactly the case the narrower reading misses.
 *
 * **And the auras the player put on an enemy, not only the ones the log put on the player.**
 * `aurasPutOnPlayer` scopes to `targetID === actor.id`, so an enemy debuff was unreachable rather than
 * merely unswept — the hole both specs' copies of this file recorded in prose after `essence-of-yulon`
 * went missing on the Elemental side for exactly that reason. Widening it found one thing here:
 * `blackout-kick-dot`, ledgered above.
 *
 * The question stays "is this key drawn". A debuff is already drawn per enemy — several `AuraLane`s share
 * one `key` and differ by `target` — so `drawnLaneKeys` collapses them and a debuff on an add nobody
 * selected cannot demand a row of its own; what is caught is an aura drawn on no enemy at all. The enemy
 * half is source-filtered, so another monk's Rising Sun Kick on the same boss is not read as this one's.
 */
const swept = (pull: FightDataset): Map<string, number> =>
	mergeCounts(aurasPutOnPlayer(pull, registry), aurasPutOnEnemies(pull, registry));

/** The named pull's own reading, which is what the findings below are about. */
const putOnPlayer = (): Map<string, number> => swept(dataset);

describe('an aura that fired has somewhere to be drawn', () => {
	it.each(RAW)('$name draws or accounts for everything the pull put on the player', ({ dataset: pull }) => {
		const on = swept(pull);
		// Not vacuous: this pull really does carry a dozen declared auras and more.
		expect(on.size).toBeGreaterThan(10);

		expect(undrawnAuras(on, drawnLaneKeys(analyse(pull)), NOT_LANES)).toEqual([]);
	});

	it('draws Dancing Steel, which fires all pull and nothing in this report reads', () => {
		// Named rather than left to the sweep because it is the sharpest case of the class: a weapon enchant
		// that procs from the first seconds to the last, under an id `shared.ts` had to correct the simulator
		// on, and which no metric here consumes — so nothing but the chart could ever have shown it, and
		// nothing but the chart's absence could ever have reported it missing.
		const events = selfAuraEvents(dataset).filter((e) => e.abilityGameID === 120_032);
		const count = (type: string): number => events.filter((e) => e.type === type).length;
		expect(count('applybuff')).toBe(12);
		expect(count('refreshbuff')).toBe(6);
		expect(count('removebuff')).toBe(10);

		const lane = analyse(dataset).timeline?.lanes.find((l) => l.key === 'dancing-steel');
		expect(lane?.group).toBe('proc');
		// A window per continuous lifetime rather than per application, which is what `auraWindows` means by
		// a window — the refreshes fold into the window they land in.
		expect(lane?.windows.length).toBeGreaterThan(0);
		expect(lane?.windows.length).toBeLessThanOrEqual(count('applybuff'));
	});

	it('gives the raid haste cooldown a row of its own, not just the wash behind the pull', () => {
		// **The row and the band are different claims, and only the band existed.** `hasteWindows` is drawn
		// as one full-height shade: it says a haste cooldown was up somewhere in here and cannot be hovered
		// for a start, an end or a duration.
		//
		// This pull is also the reason the sweep above counts removals. The raid's Time Warp went up before
		// the pull, so the log carries **no application for it at all** — one bare removal, from another
		// actor, at 39.9s — and the row exists only because the core walks this aura with `openAtPull`.
		const group = new Set(registry.aura('bloodlust').ids);
		const events = selfAuraEvents(dataset).filter((e) => group.has(e.abilityGameID ?? -1));
		expect(events.map((e) => e.type)).toEqual(['removebuff']);
		expect(events[0]?.abilityGameID).toBe(80_353);
		expect(events[0]?.sourceID).not.toBe(dataset.actor.id);
		// Both halves of that asserted rather than left to the module doc, so narrowing the now-shared sweep
		// fails here instead of quietly passing: the default reading has the key, and the narrow one does not.
		// Without the first line the sweep could stop counting removals and every other assertion here would
		// still be satisfied, which is the shape of failure this whole file exists to catch.
		expect(putOnPlayer().get('bloodlust')).toBe(1);
		expect(aurasPutOnPlayer(dataset, registry, ['applied', 'refreshed', 'stacked']).has('bloodlust')).toBe(false);

		const analysis = analyse(dataset);
		const lane = analysis.timeline?.lanes.find((l) => l.key === 'bloodlust');
		// Grouped as a press, not a proc: somebody pressed it, and the pull did not hand it over.
		expect(lane?.group).toBe('buff');
		// The window the removal implies, back to the pull — and flagged as such, which is the honesty the
		// wash could never carry either.
		expect(lane?.windows.length).toBe(1);
		expect(lane?.windows[0]?.preexisting).toBe(true);
		expect(lane?.windows[0]?.start).toBe(0);
		// The same reading the band draws, not a second walk of the same events.
		expect(lane?.windows).toEqual(analysis.energizing?.hasteWindows);
	});

	/**
	 * **The finding the enemy half of the sweep produced, and the proof that half is not empty.**
	 *
	 * `blackout-kick-dot` (128531) is declared, `appliedBy: 'blackout-kick'`, and is drawn by nothing: 18
	 * applications, 35 refreshes and 18 removals on this pull and no lane with that key anywhere. Nothing
	 * in this file could see it before, and not for want of trying — the sweep walked
	 * `targetID === actor.id`, and this lands on the boss. It is ledgered rather than drawn, for the reason
	 * written beside the entry, but the point here is that the guard now has an opinion about it at all.
	 *
	 * **A guard that sweeps nothing passes**, so the half is asserted as keys and as events rather than
	 * left to the total in the first test: an `actors` list that lost its `type` field would take every
	 * target into the friendly set, empty this half, and leave every other assertion in the file green.
	 */
	it('reads the auras the player put on the enemy, which is where the missing dot was', () => {
		const on = aurasPutOnEnemies(dataset, registry);
		expect([...on.keys()].sort()).toEqual(['blackout-kick-dot', 'rising-sun-kick-debuff', 'touch-of-karma']);
		expect(on.get('blackout-kick-dot')).toBe(71);
		// Not reachable by the reading this file used to be — which is what makes the widening the cause of
		// the finding rather than something else having changed.
		expect(aurasPutOnPlayer(dataset, registry).has('blackout-kick-dot')).toBe(false);
		// And still drawn nowhere, on any pull, which is what the ledger entry is for.
		const drawnAnywhere = new Set(RAW.flatMap(({ dataset: pull }) => [...drawnLaneKeys(analyse(pull))]));
		expect(drawnAnywhere.has('blackout-kick-dot')).toBe(false);
		// Nothing of anybody else's in the half, which is the source filter and not an accident of this pull.
		expect(enemyAuraEvents(dataset).length).toBe(145);
		expect(enemyAuraEvents(dataset).every((e) => e.sourceID === dataset.actor.id)).toBe(true);
	});

	it('declares Berserking and Blood Fury with lanes, though no fixture exercises them', () => {
		// **Stated rather than asserted as drawn.** Both are racials and this pull's monk is neither a troll
		// nor an orc, so `windows.length > 0` drops the rows and there is nothing to see. Blood Fury has the
		// strongest claim of the three all the same: it grants attack power, so it was never in the haste
		// wash either and had no representation anywhere in this report.
		//
		// What can be checked without a fixture is that the ids are declared and reachable, which is what the
		// lanes need to work the first time a troll or an orc is analysed.
		expect(registry.aura('berserking').ids).toEqual([26_297]);
		expect(registry.aura('blood-fury').ids).toEqual([33_697]);
		const on = putOnPlayer();
		expect(on.get('berserking') ?? 0).toBe(0);
		expect(on.get('blood-fury') ?? 0).toBe(0);
	});

	it('shows the missing haste row was every pull, on the half the pre-analysed fixtures can answer', () => {
		// **No assertion here that these carry no `events`, and its absence is the point.** It used to be one,
		// written when this file loaded the six by name; now `~/lib/analysis/fixtures` classifies a `.json` as
		// a capture *because* it has no `events` and throws on anything answering to neither shape, so the
		// check would restate its own precondition — two sides off one value, which is the shape of dead
		// assertion this repository keeps catching. Where the split is pinned as a fact is
		// `analysis/__tests__/fixtureCoverage.test.ts`s census, from the literal side. If a future capture
		// starts writing the input alongside the output, that census fails naming the file and `RAW` above
		// grows to sweep it.
		//
		// Not vacuous, which this file *can* say for itself: six captures, or the grid below is a grid of
		// nothing.
		expect(ANALYSED.length).toBe(6);
		// What they do carry is the haste audit's own windows, which is evidence the cooldown was up on that
		// pull independent of any lane. Five of the six, so the row this commit added is a row nearly every
		// one of them wanted — and their stored `timeline.lanes` are the old engine's output, so the lane
		// cannot be checked there without re-capturing them. Per name rather than as a count of five, so the
		// one pull that has no haste window is the one named.
		expect(
			Object.fromEntries(
				ANALYSED.map(({ name, analysis }) => [name, (analysis.energizing?.hasteWindows ?? []).length]),
			),
		).toEqual({
			'cleave.json': 0,
			'mixed.json': 1,
			'poor.json': 1,
			'strong.json': 1,
			'waves.json': 1,
			'weave.json': 1,
		});
	});

	it('keeps the ledger honest — nothing excused that no longer fires, nothing excused that is drawn', () => {
		// A reason for an aura that stopped appearing is a reason nobody will ever check again. Across every
		// raw pull rather than one, which is what `staleExcuses` takes an array for: a defensive is not
		// pressed on every pull, so an entry justified by the second fixture must not read as stale against
		// the first.
		expect(
			staleExcuses(
				NOT_LANES,
				RAW.map(({ dataset: pull }) => swept(pull)),
			),
		).toEqual([]);
		// And an entry that outlives the lane it was excusing, which no other assertion here can see: a
		// drawn key satisfies the sweep and a firing key satisfies the line above, so a row landing under a
		// reason saying there is no row would be silent. The union across pulls, because a lane drawn on any
		// pull is a lane.
		const drawnAnywhere = new Set(RAW.flatMap(({ dataset: pull }) => [...drawnLaneKeys(analyse(pull))]));
		expect(redundantExcuses(NOT_LANES, drawnAnywhere)).toEqual([]);
	});
});
