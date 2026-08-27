// What holds the Protection reference to its ladder, and every rung to the words under it.
//
// This flow is derived outright — `LADDER_ENTRIES.map(...)` and nothing else — so the seam the
// Windwalker's own `rotationFlow.test.ts` guards does not exist here: there is no hand-written prelude
// to drift out of step with the list. What can still go wrong is the half a type check cannot see. A
// rung added to `apl.ts` arrives on this page with no name, no condition line and no paragraph, and
// i18next answers a missing key with the key itself — so the page would print
// `rotation.entry.blinding-light.name` at a reader with the suite green.
//
// So the assertions split in two: the flow is the ladder, and the copy is the flow.

import { describe, expect, it } from 'vitest';

import i18n, { initI18n } from '~/lib/i18n/config';
import { ALL_BANDS } from '~/lib/spec/apl';
import { flowKeys } from '~/lib/view/rotationFlow';
import { LADDER_ENTRIES } from '~/specs/protection/lib/apl';

import { ROTATION_FLOW } from '../rotationFlow';

initI18n();
const t = i18n.getFixedT('en', 'report');

const ENTRIES = ROTATION_FLOW.flatMap((slot) => ('fork' in slot ? slot.branches : [slot.entry]));

describe('the Protection rotation flow', () => {
	it('is the ladder, in the ladder’s own order', () => {
		expect(LADDER_ENTRIES.length).toBe(17);
		expect(flowKeys(ROTATION_FLOW)).toEqual(LADDER_ENTRIES.map((entry) => entry.key));
		expect(ENTRIES.map((entry) => entry.id)).toEqual(LADDER_ENTRIES.map((entry) => entry.id));
	});

	/**
	 * No fork, and the reason is the shape of the list rather than an omission.
	 *
	 * The two rungs a target count decides between — the builder's single-target and cleave halves,
	 * Consecration high and low — are written as separate rungs at separate heights in `apl.ts`, because
	 * a band gate can take a rung off the list and cannot lift one up it. A fork could not say that: it
	 * draws alternatives side by side at one height, which is the one thing these two pairs are not.
	 */
	it('has no fork, so every rung carries one button', () => {
		expect(ROTATION_FLOW.filter((slot) => 'fork' in slot)).toEqual([]);
	});

	/**
	 * A chip on a rung a reader may not have, from either of the two reasons this spec has.
	 *
	 * Read off the entry rather than listed, so a band or a talent added in `apl.ts` puts a chip on that
	 * rung without anybody remembering to. Both halves are asserted non-empty, because a derivation that
	 * silently produced one kind and not the other would still pass a set comparison against itself.
	 */
	it('chips every rung a talent or a target count gates, and no other', () => {
		const gated = ENTRIES.filter((entry) => entry.gated).map((entry) => entry.key);
		const talents = LADDER_ENTRIES.filter((entry) => entry.talent);
		const banded = LADDER_ENTRIES.filter((entry) => entry.bands.length < ALL_BANDS.length);
		expect(talents.length).toBeGreaterThan(0);
		expect(banded.length).toBeGreaterThan(0);
		expect([...gated].sort()).toEqual([...new Set([...talents, ...banded].map((entry) => entry.key))].sort());
		// And the two reasons do not overlap, which is what lets one chip hold one sentence: a rung that
		// was both a talent and banded would need its chip to say two things at once.
		expect(talents.filter((entry) => banded.includes(entry))).toEqual([]);
	});
});

describe('the copy under every Protection rung', () => {
	/** i18next answers a missing key with the key, so "resolves" is the only thing worth asserting. */
	const resolves = (key: string) => {
		expect(t(key), key).not.toBe(key);
		expect(t(key).length, key).toBeGreaterThan(3);
	};

	it('names the button, the condition and the reason for all seventeen', () => {
		for (const entry of ENTRIES) {
			resolves(`rotation.entry.${entry.key}.name`);
			resolves(`rotation.entry.${entry.key}.test`);
			// `details` is true for this chart, so every rung has a panel and every panel needs a paragraph.
			// An empty one is worse than no button: it teaches a reader the affordance is not worth using.
			resolves(`rotation.entry.${entry.key}.why`);
		}
	});

	it('writes a chip for every gated rung and none for the rest', () => {
		for (const entry of ENTRIES) {
			if (entry.gated) resolves(`rotation.gate.${entry.key}`);
			// The other direction is the orphan hunt's, not this file's — a chip written for a rung that is
			// not gated is dead copy, and `i18n/__tests__/keys.test.ts` fails on it there.
		}
	});

	/**
	 * The section's own paragraphs, which are the four things a rung cannot carry.
	 *
	 * Written out rather than counted: a note that is dropped from the section leaves its copy behind as
	 * an orphan, which the key hunt catches, but a note *renamed* on both sides at once passes every
	 * guard in the tree. These are the four the section argues, by name.
	 */
	it('carries the four notes the section prints under the chart', () => {
		for (const note of ['spenders', 'counts', 'execute', 'protTalents']) resolves(`rotation.notes.${note}`);
		resolves('rotation.protEconomy');
	});
});
