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
// **Why the sweep counts removals as well as applications, which the Elemental's does not.** Widening it
// added exactly one key on this fixture, and that key was `bloodlust`: the pull's haste cooldown went up
// before the bell, so its only event is the removal at 39.9s and an apply-only sweep cannot see it at all.
// The missing row and the blind spot were the same fact, which is a poor thing for a guard to share with
// the bug it is guarding against. "The log put this aura on the player" is the question; an application is
// only one kind of evidence for it.
//
// **One raw fixture, and that is a limit rather than a choice.** `__fixtures__/{strong,mixed,poor,waves,
// weave,cleave}.json` are pre-analysed `Analysis` objects with **no `events` array at all** — the capture
// harness writes `analyse()`'s output, not its input — so the left-hand side of this diff cannot be
// measured on them by any means, and their stored `timeline.lanes` are frozen output from whichever engine
// captured them. What they can still say is said in the last test but one: five of the six carry a
// non-empty `energizing.hasteWindows`, so the missing Bloodlust row was every pull's, not this one's.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Analysis, FightDataset } from '~/lib/types';
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
};

const dataset = JSON.parse(
	readFileSync(resolve(import.meta.dirname, '../../__fixtures__/dataset-ironJuggernaut.json'), 'utf8'),
) as FightDataset;

/** The pre-analysed pulls, which can answer only half of this and are asked only that half. */
const ANALYSED = ['strong', 'mixed', 'poor', 'waves', 'weave', 'cleave'] as const;

const analysed = (name: string): Analysis =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8')) as Analysis;

type RawEvent = { type: string; abilityGameID?: number; targetID?: number; sourceID?: number };

const selfAuraEvents = (types: RegExp): RawEvent[] =>
	(dataset.events as RawEvent[]).filter((e) => e.targetID === dataset.actor.id && types.test(e.type));

/**
 * Every declared aura the log put on the player, by key, with how many events say so.
 *
 * Applications *and* removals — see the module doc. A removal with no application in front of it is the
 * signature of a buff that went up before the fight's event window opened, which is ordinary for a raid
 * cooldown and for a pre-pull consumable, and is exactly the case the narrower reading misses.
 */
const putOnPlayer = (): Map<string, number> => {
	const out = new Map<string, number>();
	for (const event of selfAuraEvents(/^(apply|refreshbuff|remove)/)) {
		const aura = registry.auraById(event.abilityGameID ?? -1);
		if (aura === undefined) continue;
		out.set(aura.key, (out.get(aura.key) ?? 0) + 1);
	}
	return out;
};

const drawnKeys = (): Set<string> => new Set(analyse(dataset).timeline?.lanes.map((l) => l.key) ?? []);

describe('an aura that fired has somewhere to be drawn', () => {
	it('draws or accounts for everything the pull put on the player', () => {
		const on = putOnPlayer();
		// Not vacuous: this pull really does carry a dozen declared auras and more.
		expect(on.size).toBeGreaterThan(10);

		const drawn = drawnKeys();
		const orphans = [...on.keys()].filter((key) => !drawn.has(key) && NOT_LANES[key] === undefined).sort();
		expect(orphans).toEqual([]);
	});

	it('draws Dancing Steel, which fires all pull and nothing in this report reads', () => {
		// Named rather than left to the sweep because it is the sharpest case of the class: a weapon enchant
		// that procs from the first seconds to the last, under an id `shared.ts` had to correct the simulator
		// on, and which no metric here consumes — so nothing but the chart could ever have shown it, and
		// nothing but the chart's absence could ever have reported it missing.
		const events = selfAuraEvents(/^(applybuff|refreshbuff|removebuff)$/).filter((e) => e.abilityGameID === 120_032);
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
		// the bell, so the log carries **no application for it at all** — one bare removal, from another
		// actor, at 39.9s — and the row exists only because the core walks this aura with `openAtPull`.
		const group = new Set(registry.aura('bloodlust').ids);
		const events = selfAuraEvents(/^(apply|refreshbuff|remove)/).filter((e) => group.has(e.abilityGameID ?? -1));
		expect(events.map((e) => e.type)).toEqual(['removebuff']);
		expect(events[0]?.abilityGameID).toBe(80_353);
		expect(events[0]?.sourceID).not.toBe(dataset.actor.id);

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
		// The pre-analysed fixtures carry no events, so they cannot be swept — asserted rather than worked
		// around, because a sweep that silently skipped them would read as six pulls of coverage. If a future
		// capture starts writing the input alongside the output, this fails and the sweep above should grow to
		// cover them.
		for (const name of ANALYSED) {
			expect((analysed(name) as unknown as { events?: unknown }).events, `${name} should carry no events`).toBe(
				undefined,
			);
		}
		// What they do carry is the haste audit's own windows, which is evidence the cooldown was up on that
		// pull independent of any lane. Five of six, so the row this commit added is a row every one of them
		// wanted — and their stored `timeline.lanes` are the old engine's output, so the lane cannot be
		// checked there without re-capturing them.
		const withHaste = ANALYSED.filter((name) => (analysed(name).energizing?.hasteWindows ?? []).length > 0);
		expect(withHaste.length).toBe(5);
	});

	it('keeps the ledger honest — nothing excused that no longer fires', () => {
		// A reason for an aura that stopped appearing is a reason nobody will ever check again.
		const on = putOnPlayer();
		const stale = Object.keys(NOT_LANES).filter((key) => (on.get(key) ?? 0) === 0);
		expect(stale).toEqual([]);
	});
});
