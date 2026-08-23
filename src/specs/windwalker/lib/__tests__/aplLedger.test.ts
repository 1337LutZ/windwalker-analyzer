// The verdict ledger of the six committed pulls, read off the captures rather than written down.
//
// This file exists because a docblock lost an argument. `../apl.ts` carried a table of what the
// `UNARBITRATED` declaration moves per pull, and it was a *prediction* — the fixtures were analyses
// captured before the declaration existed, so the diff was worked out by hand and the note attached to
// it said, correctly at the time, that it was "not a diff the suite can see". `ba04cbe` re-captured the
// six and the prediction became observable. It was wrong on two of them, and wrong in the same direction
// both times: it under-counted how far `skipped` fell and denied that `followed` moved at all.
//
// The number was then re-derived from the wrong reason twice more. So the numbers moved here, where
// nothing can re-derive them: this file reads the fixtures and fails when the ledger moves, and the
// docblock argues about a table it no longer owns.
//
// ## What this is not
//
// It is not `unarbitrated.test.ts`, which runs `analyse` end to end on a synthetic pull and is the only
// thing that can fail when the declaration stops being *wired* — these captures are frozen `Analysis`
// output, so no change to `lib/index.ts` can move a byte of them. And it is not
// `analysis/__tests__/ladderCoverage.test.ts`, which reads the declaration and never a pull.
//
// What only this file can see is the shape of the six real pulls the docblock reasons about: that
// `off-list` really does arrive by both of its arms on the same capture, in what proportion, and that
// the two declared buttons are delegated on every press of them while the four charged buttons are
// delegated on none.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Analysis } from '~/lib/types';
import { UNARBITRATED } from '../apl';

const SEF = 137_639;
const KARMA = 122_470;
/** On the GCD, pressed on these pulls, and charged to a rung on purpose — see `../apl.ts`. */
const CHARGED = {
	115_080: 'Touch of Death',
	119_381: 'Leg Sweep',
	115_072: 'Expel Harm',
	101_545: 'Flying Serpent Kick',
};

const fixture = (name: string): Analysis =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8'));

/**
 * The ledger, as the captures read it.
 *
 * `delegated` + `fallThrough` is `offList`, and the split is the whole reason the column is worth
 * asserting: `reason: null` means the walk arbitrated the press and wanted none of it, `reason: 'sef'`
 * or `'karma'` means it never arbitrated it at all. Same column, opposite facts.
 */
const LEDGER = {
	waves: { presses: 247, followed: 126, skipped: 92, unknown: 0, offList: 29, delegated: 16, sef: 15, karma: 1 },
	cleave: { presses: 161, followed: 73, skipped: 72, unknown: 3, offList: 13, delegated: 6, sef: 4, karma: 2 },
	mixed: { presses: 200, followed: 95, skipped: 95, unknown: 1, offList: 9, delegated: 3, sef: 0, karma: 3 },
	strong: { presses: 409, followed: 252, skipped: 143, unknown: 0, offList: 14, delegated: 2, sef: 0, karma: 2 },
	poor: { presses: 217, followed: 101, skipped: 110, unknown: 2, offList: 4, delegated: 3, sef: 0, karma: 3 },
	weave: { presses: 117, followed: 77, skipped: 38, unknown: 1, offList: 1, delegated: 1, sef: 0, karma: 1 },
} as const;

type PullName = keyof typeof LEDGER;
const PULLS = Object.keys(LEDGER) as PullName[];

const audits = new Map(PULLS.map((name) => [name, fixture(name).apl]));

const auditOf = (name: PullName) => {
	const audit = audits.get(name);
	if (audit === null || audit === undefined) throw new Error(`${name}.json has no apl block`);
	return audit;
};

/** `reason` is optional on `AplPress`, and an absent one means the same as a null one: no pointer. */
const reasonOf = (press: { reason?: string | null }): string | null => press.reason ?? null;

describe('the Windwalker verdict ledger, over the six committed pulls', () => {
	it.each(PULLS)('reads %s the way apl.ts says it does', (name) => {
		const audit = auditOf(name);
		const want = LEDGER[name];
		const tally = { followed: 0, skipped: 0, unknown: 0, offList: 0 };
		for (const press of audit.presses) {
			if (press.verdict === 'off-list') tally.offList += 1;
			else tally[press.verdict] += 1;
		}
		expect({ presses: audit.presses.length, ...tally }).toEqual({
			presses: want.presses,
			followed: want.followed,
			skipped: want.skipped,
			unknown: want.unknown,
			offList: want.offList,
		});
		// The summary fields are what the report renders; the tally above is what the presses say. A
		// capture where the two disagree is a capture the reader cannot check against the press list.
		expect([audit.followed, audit.skipped, audit.unknown, audit.offList]).toEqual([
			want.followed,
			want.skipped,
			want.unknown,
			want.offList,
		]);
	});

	/**
	 * Both arms of `off-list`, on every pull that has each.
	 *
	 * The docblock's claim is that the column is two facts, so the split has to be asserted rather than
	 * the total: a declaration that swallowed a fall-through, or a rung that stopped declining, would
	 * leave `offList` where it is and change what it means.
	 */
	it.each(PULLS)('splits %s off-list presses into delegated and fall-through', (name) => {
		const audit = auditOf(name);
		const offList = audit.presses.filter((p) => p.verdict === 'off-list');
		const delegated = offList.filter((p) => reasonOf(p) !== null);
		const want = LEDGER[name];
		expect({ delegated: delegated.length, fallThrough: offList.length - delegated.length }).toEqual({
			delegated: want.delegated,
			fallThrough: want.offList - want.delegated,
		});
		// A delegated press points somewhere and has no rung to point at instead.
		for (const press of delegated) {
			expect(press.wanted, `${name} delegated press at ${press.t}`).toBeNull();
			expect(reasonOf(press)).toBe(press.pressed === SEF ? 'sef' : 'karma');
		}
	});

	/**
	 * The declaration is exhaustive over the presses, in both directions.
	 *
	 * Every press of the two declared buttons is delegated — not most of them, and not only the ones a
	 * band happened to leave without a rung — and no press of anything else is. This is the assertion
	 * that would catch the declaration being read *after* a rung instead of before the first one, which
	 * is what makes the verdict a fact about the button rather than about the target count.
	 */
	it.each(PULLS)('delegates every press of the two declared buttons on %s and nothing else', (name) => {
		const audit = auditOf(name);
		const want = LEDGER[name];
		const declared = audit.presses.filter((p) => p.pressed === SEF || p.pressed === KARMA);
		expect(declared.filter((p) => p.pressed === SEF).length).toBe(want.sef);
		expect(declared.filter((p) => p.pressed === KARMA).length).toBe(want.karma);
		for (const press of declared) expect(press.verdict, `press of ${press.pressed} at ${press.t}`).toBe('off-list');

		// The other four on-GCD buttons with no rung stay faults, which is the half of the argument that
		// stops `off-list` being an amnesty. They may fall through the bottom of the ladder like anything
		// else; what they may never do is arrive there carrying a section name.
		for (const press of audit.presses) {
			if (press.pressed in CHARGED) {
				expect(reasonOf(press), `${CHARGED[press.pressed as keyof typeof CHARGED]} at ${press.t}`).not.toBe('sef');
				expect(reasonOf(press)).not.toBe('karma');
			}
		}
	});

	/**
	 * Every section id the captures use is one the ladder declares, and every id it declares is used.
	 *
	 * `ladderCoverage.test.ts` checks the declaration against the spec's button list; this checks it
	 * against six real pulls, which is where a third entry added without a section — or an entry kept
	 * after its button stopped being pressed — would show.
	 */
	it('uses exactly the two delegations the ladder declares', () => {
		const declaredIds = Object.keys(UNARBITRATED)
			.map(Number)
			.sort((a, b) => a - b);
		expect(declaredIds).toEqual([KARMA, SEF].sort((a, b) => a - b));

		const seen = new Map<number, Set<string>>();
		for (const name of PULLS) {
			for (const press of auditOf(name).presses) {
				const reason = reasonOf(press);
				if (press.verdict !== 'off-list' || reason === null) continue;
				const reasons = seen.get(press.pressed) ?? new Set<string>();
				reasons.add(reason);
				seen.set(press.pressed, reasons);
			}
		}
		expect([...seen.keys()].sort((a, b) => a - b)).toEqual(declaredIds);
		for (const [id, reasons] of seen) expect([...reasons]).toEqual([UNARBITRATED[id]]);
	});

	/**
	 * The totals the docblock quotes in prose, so the prose has something behind it too.
	 *
	 * 19 Storm, Earth and Fire presses across two pulls and 12 Touch of Karma presses across all six —
	 * the second of those is the stronger claim, because a button pressed on every pull in the set is the
	 * one whose delegation a reader is most likely to meet.
	 */
	it('delegates 19 Storm, Earth and Fire presses and 12 Touch of Karma presses in the set', () => {
		const count = (id: number, name: PullName) =>
			auditOf(name).presses.filter((p) => p.pressed === id && p.verdict === 'off-list' && reasonOf(p) !== null).length;
		const sum = (id: number) => PULLS.reduce((acc, name) => acc + count(id, name), 0);
		expect({ sef: sum(SEF), karma: sum(KARMA) }).toEqual({ sef: 19, karma: 12 });
		// Karma on all six; Storm, Earth and Fire only on the two pulls that had a second target worth one.
		expect(PULLS.filter((n) => count(KARMA, n) > 0)).toEqual(PULLS);
		expect(PULLS.filter((n) => count(SEF, n) > 0)).toEqual(['waves', 'cleave']);
	});
});
