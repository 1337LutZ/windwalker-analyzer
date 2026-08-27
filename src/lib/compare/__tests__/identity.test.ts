// One button, however many ids the log keys it under — and why an absent row is absent.
//
// Both read off the **raw** fixtures rather than the captured ones, because both need a talent list
// and `Analysis.talents` postdates every capture. `analyse()` runs here, so the lists are the real
// ones `combatantinfo` carried.

import { describe, expect, it } from 'vitest';

import { rawFixtures } from '~/lib/analysis/fixtures';
import { absenceOf, compare, identityFrom, mergeRows, type Pull } from '~/lib/compare';
import { getSpec } from '~/lib/spec';
import { resolveBands } from '~/lib/view/targetMode';

const spec = getSpec('windwalker')!;
const IDENTITY = identityFrom(spec.registry);
const RAW = new Map(rawFixtures('windwalker').map(({ name, dataset }) => [name.replace(/\.json$/, ''), dataset]));

function pull(name: string): Pull {
	const dataset = RAW.get(name);
	if (dataset === undefined) throw new Error(`no raw windwalker fixture ${name}`);
	const analysis = spec.analyse(dataset);
	const view = resolveBands(analysis.targets, 'auto', analysis.segments);
	return { analysis, scorecard: spec.score(analysis, view), view };
}

/** `sections` talented Rushing Jade Wind; `dataset-ironJuggernaut` took Invoke Xuen instead. */
const across = compare(pull('sections'), pull('dataset-ironJuggernaut'), IDENTITY);

describe('two ids, one button', () => {
	/**
	 * Jab logs `115693` dual-wielding and `115695` on a staff. One player carries one weapon, so a
	 * report about one player never sees the split — and the compare page saw it every time the two
	 * players armed differently, as two Jab rows each absent on one side.
	 */
	it('folds Jab into one row however the two players were armed', () => {
		const a = pull('sections').analysis;
		const b = pull('dataset-ironJuggernaut').analysis;
		const idOf = (analysis: typeof a) => analysis.casts.find((row) => /^jab$/i.test(row.name))?.id;
		expect(idOf(a)).not.toBe(idOf(b));

		expect(across.casts.filter((row) => /^jab$/i.test(row.name))).toHaveLength(1);
		expect(across.abilities.filter((row) => /^jab$/i.test(row.name))).toHaveLength(1);
		// And folded rather than dropped: the row carries both players' presses.
		const jab = across.casts.find((row) => /^jab$/i.test(row.name));
		expect(jab?.a?.count).toBeGreaterThan(0);
		expect(jab?.b?.count).toBeGreaterThan(0);
	});

	it('sums what it folds rather than keeping one half', () => {
		const rows = [
			{ id: 1, name: 'Jab', count: 3 },
			{ id: 2, name: 'Jab', count: 4 },
			{ id: 9, name: 'Other', count: 5 },
		];
		const merged = mergeRows(
			rows,
			(row) => row.name,
			(into, next) => ({ ...into, count: into.count + next.count }),
		);
		expect(merged).toEqual([
			{ id: 1, name: 'Jab', count: 7 },
			{ id: 9, name: 'Other', count: 5 },
		]);
	});

	it('never leaves two rows the log calls the same thing', () => {
		// Spear Hand Strike arrives under two cast ids the ability table does not carry, so the model
		// cannot fold them and the name has to. Two rows under one name is a distinction no reader
		// could act on.
		for (const list of [across.casts, across.abilities]) {
			const names = list.map((row) => row.name.toLowerCase());
			expect(new Set(names).size).toBe(names.length);
		}
	});
});

describe('why a button is missing', () => {
	it('says which of the two talents each player took', () => {
		const rjw = across.casts.find((row) => row.name === 'Rushing Jade Wind');
		const xuen = across.casts.find((row) => row.name.startsWith('Invoke Xuen'));
		expect(rjw?.absent).toEqual({ side: 'b', why: 'notTalented' });
		expect(xuen?.absent).toEqual({ side: 'a', why: 'notTalented' });
	});

	it('still says not pressed when both players took it', () => {
		// Diffuse Magic is on both talent lists, so one player simply never needed it.
		expect(across.casts.find((row) => row.name === 'Diffuse Magic')?.absent).toEqual({
			side: 'a',
			why: 'notPressed',
		});
	});

	it('reports nothing for a button both players pressed', () => {
		expect(across.casts.find((row) => /^jab$/i.test(row.name))?.absent).toBeNull();
	});
});

describe('absenceOf', () => {
	const taken = [116847, 122783];

	it('answers cannot-have before it asks any list', () => {
		// A racial is absent from the other character's log for a reason no talent list mentions, and
		// asking the lists first would answer "cannot say" to a question that has an answer.
		expect(absenceOf({ castIds: [20572], gatedBy: 'race', mine: null, theirs: null })).toBe('cannotHave');
		expect(absenceOf({ castIds: [126734], gatedBy: 'profession', mine: taken, theirs: taken })).toBe('cannotHave');
	});

	it('refuses to guess when either list is unreadable', () => {
		// `null` is a log with no `combatantinfo`; `undefined` is a capture from before the field. Reading
		// either as an empty list would turn a forgotten cooldown into a talent somebody chose against.
		expect(absenceOf({ castIds: [116847], mine: null, theirs: taken })).toBe('unknown');
		expect(absenceOf({ castIds: [116847], mine: undefined, theirs: taken })).toBe('unknown');
		expect(absenceOf({ castIds: [116847], mine: taken, theirs: null })).toBe('unknown');
	});

	it('says not taken only when the other player took it', () => {
		expect(absenceOf({ castIds: [116847], mine: [123904], theirs: taken })).toBe('notTalented');
	});

	it('says not pressed for a button neither of them talented', () => {
		// A button missing from both lists is not a talent one of them chose over the other — it is a
		// button neither talented, and its absence says nothing about the choice.
		expect(absenceOf({ castIds: [100780], mine: taken, theirs: taken })).toBe('notPressed');
	});
});
