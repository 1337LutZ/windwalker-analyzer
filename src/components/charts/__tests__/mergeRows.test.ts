// A button and the buff it puts up are one row, including when no button owns the buff.
//
// The merge reads `Aura.appliedBy`, and for most auras that is the whole answer. **Bloodlust has no
// `appliedBy` and that is deliberate**: it is declared across five ids (2825 Bloodlust, 32182 Heroism,
// 80353 Time Warp, 90355 Ancient Hysteria, 146555 Drums of Rage) because the rotation only cares that
// raid haste is up, not which class brought it. No single button applies it, so the model has nothing to
// point at — and the press and the window drew as two rows carrying one name, which is what a reader
// reported.
//
// The fallback matches on the name, which is what the summary timeline has always done (`LanesTimeline`
// keys its row map by `lane.name`). So the two charts now answer the same way instead of one of them
// having a rule the other does not.

import { describe, expect, it } from 'vitest';

import type { AuraLane } from '~/lib/types';
import { mergeRows, type CastLane, type CastRow } from '../CastTimeline';

const press = (id: number, name: string): CastRow => ({
	lane: { id, name, casts: [], rows: 1, rowOf: new Map() } satisfies CastLane,
	nodes: null,
});

const lane = (key: string, name: string, id = 0): AuraLane =>
	({ key, name, id, group: 'buff', windows: [{ start: 0, end: 1000 }] }) as AuraLane;

/** A raid-buff row: same key as its siblings, told apart by the caster, and `own` on the player's. */
const casterLane = (key: string, name: string, source: number, own = false): AuraLane =>
	({
		key,
		name,
		id: 0,
		group: 'buff',
		windows: [{ start: 0, end: 1000 }],
		source: { id: source, name: `Player (${source})`, own },
	}) as AuraLane;

describe('merging a press onto its aura row', () => {
	it('merges Bloodlust by name, with nothing in the model to point at', () => {
		const { into, loose } = mergeRows([press(2825, 'Bloodlust')], [lane('bloodlust', 'Bloodlust')], new Map());
		expect([...into.keys()]).toEqual(['bloodlust']);
		expect(loose).toEqual([]);
	});

	it('still merges by the model when it has an answer', () => {
		// Berserking *does* declare `appliedBy`, so the id route is the one that fires. Asserted so the
		// fallback cannot quietly become the only path that works.
		const { into, loose } = mergeRows(
			[press(26_297, 'Berserking')],
			[lane('berserking', 'Berserking')],
			new Map([[26_297, 'berserking']]),
		);
		expect([...into.keys()]).toEqual(['berserking']);
		expect(loose).toEqual([]);
	});

	it('prefers the model over the name when the two disagree', () => {
		// An `appliedBy` is the spec being explicit and it wins. The name here would have found the other
		// lane, so this fails if the fallback is ever consulted first.
		const { into } = mergeRows(
			[press(1, 'Tiger Palm')],
			[lane('tiger-power', 'Tiger Power'), lane('tiger-palm-lane', 'Tiger Palm')],
			new Map([[1, 'tiger-power']]),
		);
		expect([...into.keys()]).toEqual(['tiger-power']);
	});

	it('refuses a name two different auras claim', () => {
		// Ambiguity is the one case a name cannot settle, and merging onto either would be a coin toss the
		// reader could not see. The press keeps its own row.
		const { into, loose } = mergeRows(
			[press(7, 'Shared Name')],
			[lane('one', 'Shared Name'), lane('two', 'Shared Name')],
			new Map(),
		);
		expect([...into.keys()]).toEqual([]);
		expect(loose).toHaveLength(1);
	});

	it('refuses a name whose aura is drawn once per enemy', () => {
		// The per-target case the original `lanesPerKey` guard existed for: the press stream cannot say which
		// add a given cast hit, so putting it on all of them would claim it hit every one. Those rows carry
		// no `source`, so the raid-buff route below cannot rescue them either — which is correct, and is why
		// this still reads as a refusal rather than as an unreachable branch.
		const { into, loose } = mergeRows(
			[press(8, 'Flame Shock')],
			[lane('flame-shock', 'Flame Shock', 1), lane('flame-shock', 'Flame Shock', 2)],
			new Map(),
		);
		expect([...into.keys()]).toEqual([]);
		expect(loose).toHaveLength(1);
	});
});

// A raid buff draws a row per caster, so several rows share one key and the merge has to pick one.
//
// **The reported bug: "stormlash cast of yourself is not merged with the buff aura".** The original rule
// merged only where exactly one lane carried the key, so the moment a second shaman's totem reached the
// player the shaman's own press fell out to a lane of its own — their cast on one row and the totem it
// placed on another, two readings of one totem.
//
// `source.own` is the engine's answer to which row is the player's, and it is the engine's rather than this
// component's because `CastTimeline` reads an `Analysis` and has no actor id to compare against.
describe('merging a press onto one of several rows sharing a key', () => {
	it('merges the player’s own Stormlash press onto their own totem’s row', () => {
		const { into, loose } = mergeRows(
			[press(120_668, 'Stormlash Totem')],
			[
				casterLane('stormlash-totem', 'Stormlash Totem', 2, true),
				casterLane('stormlash-totem', 'Stormlash Totem', 7),
				casterLane('stormlash-totem', 'Stormlash Totem', 9),
			],
			new Map([[120_668, 'stormlash-totem']]),
		);
		// Keyed by the row and not by the aura, so the two other shamans' rows do not answer to it.
		expect([...into.keys()]).toEqual(['stormlash-totem^2']);
		expect(loose).toEqual([]);
	});

	it('leaves the press loose when none of the rows is the player’s own', () => {
		// Every totem came from somebody else, so a press merged into one of their rows would credit this
		// player with a totem they did not lay. No committed fixture has the player carrying a Skull Banner,
		// which makes this the ordinary case for that buff rather than an edge.
		const { into, loose } = mergeRows(
			[press(114_207, 'Skull Banner')],
			[casterLane('skull-banner', 'Skull Banner', 52), casterLane('skull-banner', 'Skull Banner', 46)],
			new Map([[114_207, 'skull-banner']]),
		);
		expect([...into.keys()]).toEqual([]);
		expect(loose).toHaveLength(1);
	});

	it('refuses two rows both claiming to be the player’s own', () => {
		// A contradiction the engine should never emit — `own` is `source.id === actor.id` and the rows are
		// grouped by that id, so two of them is a grouping that failed. Guessing through it would put the
		// press on whichever came first, which is the coin toss the ambiguous-name case already refuses.
		const { into, loose } = mergeRows(
			[press(120_668, 'Stormlash Totem')],
			[
				casterLane('stormlash-totem', 'Stormlash Totem', 2, true),
				casterLane('stormlash-totem', 'Stormlash Totem', 2, true),
			],
			new Map([[120_668, 'stormlash-totem']]),
		);
		expect([...into.keys()]).toEqual([]);
		expect(loose).toHaveLength(1);
	});

	it('merges a lone caster row, whose key still carries the caster', () => {
		// One shaman on the pull is the single-lane case, and it must not fall back to the bare aura key:
		// the row's React key and the merge's key are the same function, so a press filed under
		// `stormlash-totem` would be drawn against a row called `stormlash-totem^2` and lost.
		const { into, loose } = mergeRows(
			[press(120_668, 'Stormlash Totem')],
			[casterLane('stormlash-totem', 'Stormlash Totem', 2, true)],
			new Map([[120_668, 'stormlash-totem']]),
		);
		expect([...into.keys()]).toEqual(['stormlash-totem^2']);
		expect(loose).toEqual([]);
	});
});
