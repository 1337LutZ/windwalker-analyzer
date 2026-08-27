// The APL parser, on the parts of the sim's format that would fail quietly.
//
// `scripts/sim-apl.mjs` flattens a wowsims priority list to the casts it attempts. Everything downstream —
// the committed snapshot, the drift test, the pull request a scheduled job opens — rests on that flatten
// being right, and every way it can be wrong produces a *plausible* list rather than an error. A group
// that silently resolved to nothing looks exactly like a group with no casts in it.
//
// So each test below is a shape the sim actually writes, taken from the three APLs this repository tracks.

import { describe, expect, it } from 'vitest';

import { castsFrom, driftOf, groupsOf, normaliseApl, spellsOf } from '../../../../scripts/sim-apl.mjs';

const cast = (id: number) => ({ action: { castSpell: { spellId: { spellId: id } } } });

describe('flattening an action tree', () => {
	it('reads casts in the order the list has them', () => {
		expect(castsFrom([cast(1), cast(2)]).map((c: { spellId: number }) => c.spellId)).toEqual([1, 2]);
	});

	/**
	 * **Conditions are walked through, not around.** They mention spells constantly — `spellCanCast`,
	 * `auraIsActive`, `spellTimeToReady` — and none of it is a cast. Collecting only the `castSpell` key
	 * gets that right without the parser having to know the condition grammar, which is the part of this
	 * format most likely to grow.
	 */
	it('does not mistake a spell named in a condition for a cast', () => {
		const rung = {
			action: {
				condition: { spellCanCast: { spellId: { spellId: 999 } } },
				castSpell: { spellId: { spellId: 1 } },
			},
		};
		expect(castsFrom([rung]).map((c: { spellId: number }) => c.spellId)).toEqual([1]);
	});

	/** A strict sequence is several casts, and the sim's Windwalker list opens with one. */
	it('reads every cast in a strict sequence', () => {
		const rung = { action: { strictSequence: { actions: [{ castSpell: { spellId: { spellId: 126456 } } }] } } };
		expect(castsFrom([rung]).map((c: { spellId: number }) => c.spellId)).toEqual([126456]);
	});

	/** A cast that is not a spell — a potion, a racial — is kept by name rather than dropped. */
	it('keeps a non-spell action', () => {
		const rung = { action: { castSpell: { spellId: { otherId: 'OtherActionPotion' } } } };
		expect(castsFrom([rung])).toEqual([{ other: 'OtherActionPotion', via: null, hidden: false }]);
	});
});

describe('a group reference', () => {
	const apl = {
		groups: [{ name: 'Cooldowns: On use', actions: [cast(33697), cast(26297)] }],
		priorityList: [cast(1), { action: { groupReference: { groupName: 'Cooldowns: On use' } } }],
	};

	/** Expanded where it appears, so the flattened order is the order the sim would reach them. */
	it('is expanded in place, and says which group it came from', () => {
		const casts = castsFrom(apl.priorityList, { groups: groupsOf(apl) });
		expect(casts.map((c: { spellId: number }) => c.spellId)).toEqual([1, 33697, 26297]);
		expect(casts[1]?.via).toBe('Cooldowns: On use');
	});

	/** A name with no group behind it resolves to nothing rather than throwing a scheduled job over. */
	it('is ignored when the group does not exist', () => {
		const casts = castsFrom([{ action: { groupReference: { groupName: 'Nothing' } } }], { groups: new Map() });
		expect(casts).toEqual([]);
	});

	/**
	 * The guard that matters most, because its absence is a hang rather than a wrong answer. The sim does
	 * not write a cycle; a parser that trusted it not to would spin a runner until the job timed out.
	 */
	it('does not recurse for ever on a cycle', () => {
		const groups = new Map([
			['a', [cast(1), { action: { groupReference: { groupName: 'b' } } }]],
			['b', [cast(2), { action: { groupReference: { groupName: 'a' } } }]],
		]);
		const casts = castsFrom([{ action: { groupReference: { groupName: 'a' } } }], { groups });
		expect(casts.map((c: { spellId: number }) => c.spellId)).toEqual([1, 2]);
	});
});

describe('a hidden row', () => {
	const apl = { priorityList: [{ hide: true, ...cast(5) }, cast(6)] };

	/** Carried into the snapshot with a flag, so dropping it later is visible rather than assumed. */
	it('stays in the flattened list, marked', () => {
		const casts = castsFrom(apl.priorityList);
		expect(casts.map((c: { hidden: boolean }) => c.hidden)).toEqual([true, false]);
	});

	/** And is dropped from the spell set, which is what the ladders are compared against. */
	it('is left out of the spells', () => {
		expect(spellsOf(normaliseApl(apl))).toEqual([6]);
	});

	/** Hiding a group hides everything it reaches, which is how the elixir-swap toggles are written. */
	it('hides the casts inside a group it references', () => {
		const groups = new Map([['Swap', [cast(7)]]]);
		const casts = castsFrom([{ hide: true, action: { groupReference: { groupName: 'Swap' } } }], { groups });
		expect(casts[0]?.hidden).toBe(true);
	});
});

describe('what changed between two snapshots', () => {
	const snap = (files: Record<string, unknown>) => ({ specs: { windwalker: { files } } });
	const file = (ids: number[]) => normaliseApl({ priorityList: ids.map((id) => cast(id)) });

	it('names a spell the sim started casting', () => {
		expect(driftOf(snap({ 'default.apl.json': file([1]) }), snap({ 'default.apl.json': file([1, 2]) }))).toEqual([
			'windwalker default.apl.json +2',
		]);
	});

	it('names a spell it stopped casting', () => {
		expect(driftOf(snap({ 'default.apl.json': file([1, 2]) }), snap({ 'default.apl.json': file([1]) }))).toEqual([
			'windwalker default.apl.json -2',
		]);
	});

	/** Order is drift too: the same buttons in a different sequence is a different rotation. */
	it('notices a reorder with no spell added or lost', () => {
		expect(driftOf(snap({ 'default.apl.json': file([1, 2]) }), snap({ 'default.apl.json': file([2, 1]) }))).toEqual([
			'windwalker default.apl.json reordered',
		]);
	});

	/** A whole APL appearing is as much a signal as a spell moving inside one. */
	it('notices a file appearing and disappearing', () => {
		expect(driftOf(snap({}), snap({ 'aoe.apl.json': file([1]) }))).toEqual(['windwalker aoe.apl.json added']);
		expect(driftOf(snap({ 'aoe.apl.json': file([1]) }), snap({}))).toEqual(['windwalker aoe.apl.json removed']);
	});

	it('says nothing when nothing moved', () => {
		expect(driftOf(snap({ 'default.apl.json': file([1]) }), snap({ 'default.apl.json': file([1]) }))).toEqual([]);
	});
});
