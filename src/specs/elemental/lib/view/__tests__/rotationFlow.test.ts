// What holds the Elemental reference to `ROTATION`, and its three stage headings to their copy.
//
// The failure this file is written against is the one the Windwalker's own `rotationFlow.test.ts`
// names: a reference table that keeps its own copy of the list, and a page that quietly draws a rung
// the list does not have. Nothing here is hand-written, so the assertions are about the derivation
// rather than about a transcription — that every rung is a row `ROTATION` still carries, that the
// three stages are the filing the section had before it was a chart, and that a band names a group
// with rows in it.
//
// **The forward half of a `KEY_SOURCES` entry that no longer exists lives here.** `rotation.group.*`
// used to be a computed family in `i18n/__tests__/keys.test.ts`, resolved against the groups
// `ROTATION` files its rows under. It stopped being computed when the band's copy key became a prop:
// a key that never sits inside a `t(...)` is a written key, not a family, so that guard had to go.
// What it was actually holding — that all three headings name a live group and resolve to real
// copy — is asserted below instead.

import { describe, expect, it } from 'vitest';

import i18n, { initI18n } from '~/lib/i18n/config';
import { flowKeys } from '~/lib/view/rotationFlow';
import { ROTATION } from '~/specs/elemental/lib/apl';

import { ROTATION_FLOW, STAGE_BANDS } from '../rotationFlow';

initI18n();
const t = i18n.getFixedT('en', 'report');

const GROUPS = ['cooldown', 'dot', 'filler'] as const;

describe('the Elemental rotation flow', () => {
	it('draws every row of ROTATION and nothing else', () => {
		expect(ROTATION.length).toBeGreaterThan(10);
		expect(ROTATION_FLOW).toHaveLength(ROTATION.length);
		expect(flowKeys(ROTATION_FLOW).sort()).toEqual(ROTATION.map((entry) => entry.key).sort());
	});

	/**
	 * Plain rungs all the way down, which is a fact about this list rather than a limitation of the
	 * drawing.
	 *
	 * A fork is one entry the reader's own build or the pack in front of them picks between, and
	 * `ROTATION` has none: the two talent rows it touches are single buttons a player either has or
	 * does not, so they are chips rather than alternatives. The Windwalker's four forks are what the
	 * shape exists for, and this asserts the Elemental is not quietly growing one nobody has written
	 * copy for.
	 */
	it('has no fork, so every rung carries one button', () => {
		expect(ROTATION_FLOW.filter((slot) => 'fork' in slot)).toEqual([]);
	});

	/** The icon comes off the id, so a rung pointing at the wrong spell is a wrong picture beside a right name. */
	it('carries each row’s own cast id', () => {
		const ids = ROTATION_FLOW.flatMap((slot) => ('fork' in slot ? [] : [[slot.entry.key, slot.entry.id]]));
		expect(ids).toEqual(GROUPS.flatMap((g) => ROTATION.filter((e) => e.group === g).map((e) => [e.key, e.id])));
	});

	/**
	 * The stages are the order, and the order is not `ROTATION`'s own.
	 *
	 * `ROTATION` is written in the p5 list's order and the three groups interleave through it, so filing
	 * the rows under their group reorders them. That was true of the column of cards this replaced and
	 * is asserted here rather than left implied, because it is the one place a reader of the chart is
	 * being shown something other than the file's sequence.
	 */
	it('reads cooldowns, then the dot, then the fillers', () => {
		const drawn = flowKeys(ROTATION_FLOW);
		const filed = GROUPS.flatMap((group) => ROTATION.filter((entry) => entry.group === group).map((e) => e.key));
		expect(drawn).toEqual(filed);
		// Non-vacuity: if the two orders happened to agree, this test would be checking nothing.
		expect(drawn).not.toEqual(ROTATION.map((entry) => entry.key));
	});

	/** A chip goes on a row a player may not have, and on no other. */
	it('chips exactly the talent rows', () => {
		const gated = ROTATION_FLOW.flatMap((slot) => ('fork' in slot ? slot.branches : [slot.entry]))
			.filter((entry) => entry.gated)
			.map((entry) => entry.key)
			.sort();
		expect(gated).toEqual(
			ROTATION.filter((entry) => entry.talent === true)
				.map((entry) => entry.key)
				.sort(),
		);
		expect(gated.length).toBeGreaterThan(0);
	});
});

describe('the stage headings', () => {
	it('sits above the first row of each group, in reading order', () => {
		const heads = GROUPS.flatMap((group) => {
			const first = ROTATION.find((entry) => entry.group === group);
			return first === undefined ? [] : [first.key];
		});
		expect([...STAGE_BANDS.keys()]).toEqual(heads);
	});

	/**
	 * Both directions, which is what the retired key source was for.
	 *
	 * That each band names a group `ROTATION` still files rows under — a heading over an empty stage is
	 * a heading over nothing — and that each key resolves to copy rather than to itself, which is what
	 * i18next hands back for a key that is not there and what a page would then print at a reader.
	 */
	it('names a live group, and every name resolves to real copy', () => {
		const filed = new Set(ROTATION.map((entry) => entry.group));
		expect([...STAGE_BANDS.values()]).toEqual(GROUPS.map((group) => `rotation.group.${group}`));
		for (const group of GROUPS) expect(filed, group).toContain(group);
		for (const key of STAGE_BANDS.values()) {
			expect(t(key), key).not.toBe(key);
			expect(t(key).length, key).toBeGreaterThan(2);
		}
	});
});
