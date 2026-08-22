// The user's report: **"Chain Lightning paints no lines in the timeline"** (plan §44), and their guess
// at why — a sub-one-second cast being treated as not occupying a global.
//
// Three different bugs produce that one symptom, and the report cannot say which:
//
//   1. the presses are missing from the cast series, so there is nothing to rule;
//   2. the presses are there and carry no GCD occupancy, so `gcdRulesPath` skips them;
//   3. the presses and their occupancy are both right and the *drawing* puts the rule somewhere the
//      reader was not looking.
//
// It was **2 and 3, in that order, and neither for the reason the report gives.** Chain Lightning (421)
// and Lava Beam (114074) were absent from the Elemental registry, so `abilityByCastId` returned
// `undefined`, every mark read `onGcd: false` — `analyseCore`'s `?? false`, the safe default for a
// trinket — and `gcdRulesPath` `continue`d past all seventy of them. `618169c` declared the two
// abilities and closed that. Underneath it sat a second, independent defect: the rule was drawn at the
// press's *landing* while its icon was drawn at the commit, so a Chain Lightning's own global sat a
// cast time to the right of its own icon. `34aaf8b` moved every reader onto `commitOf`.
//
// The hypothesis in the report is **wrong, and measurably so**: 31 of this pull's 70 Chain Lightnings
// do complete inside a global (856ms at the fastest against a measured 1 127ms global), and every one
// of them is charged a full global all the same — `analyseCore`'s occupancy is
// `max(effectiveGcd, duration)`, and `effectiveGcd` is itself floored at `GCD_MIN_MS`. A fast cast has
// never been priced at its cast time. `gcdUtilisation.test.ts` pins that half; this file pins the lines.
//
// **Why this renders a real fixture.** The commit-instant behaviour is already asserted in
// `specs/windwalker/components/charts/__tests__/castTimeline.test.ts`, against a hand-built two-second
// Lightning Bolt — and it passed throughout, because a synthetic mark is handed the `onGcd: true` that
// was the actual bug. Only a press that has been through the registry can be missing from a chart for
// the reason this one was, so everything below is driven off `analyse(cleave)` and nothing is declared
// here but the spell id.
//
// `createElement` rather than JSX so this stays a `.ts` file and vitest's own include patterns pick it
// up, as the render tests beside it do.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { GCD_MIN_MS } from '~/lib/analysis/analyseCore';
import { initI18n } from '~/lib/i18n/config';
import { getSpec } from '~/lib/spec';
import type { Analysis, CastMark, FightDataset } from '~/lib/types';
import { SpecContext } from '~/components/report/specContext';
import { analyse as analyseElemental } from '~/specs/elemental/lib';

import CastTimeline from '../CastTimeline';
import { drawnCastsOf } from '../hidden';

initI18n();

/**
 * Named rather than left to `SpecContext`'s default, which is the build's pinned `DEFAULT_SPEC` — under
 * `PUBLIC_SPEC=windwalker` that would draw a Shaman pull with the monk's banks.
 */
const ELEMENTAL = getSpec('elemental')!;

/** The multi-target pull, and the only committed fixture that contains a Chain Lightning at all. */
const analysis: Analysis = analyseElemental(
	JSON.parse(
		readFileSync(resolve(import.meta.dirname, '../../../specs/elemental/__fixtures__/cleave.json'), 'utf8'),
	) as FightDataset,
);

const html = renderToStaticMarkup(
	createElement(SpecContext.Provider, { value: ELEMENTAL }, createElement(CastTimeline, { analysis })),
);

const span = analysis.durationMs;
const casts = drawnCastsOf(analysis.timeline?.casts ?? []);
const onGcd = casts.filter((c) => c.onGcd);
const CHAIN_LIGHTNING = 421;
const chainLightning = casts.filter((c) => c.id === CHAIN_LIGHTNING);

/** The instant a press was committed, which is where the chart puts everything about it. */
const commitOf = (c: CastMark): number => c.t - (c.castTimeMs ?? 0);
/** One rule in the path's `d`, per-mille of the pull — the form `gcdRulesPath` writes. */
const at = (ms: number): string => `M${((ms / span) * 1000).toFixed(3)} 0V1`;
/** Every rule the chart actually drew, read back off the rendered path. */
const rules = new Set(html.match(/M[\d.]+ 0V1/g) ?? []);

describe('the timeline rules a global for every Chain Lightning press', () => {
	/**
	 * The report, answered directly: seventy presses, seventy lines.
	 *
	 * The set equality is the load-bearing half. A count would pass on a chart that drew two hundred
	 * lines in the wrong places, and this pull is exactly the shape that hides that — 204 presses over
	 * 263s, so a line is never far from where one belongs.
	 */
	it('draws one rule per on-GCD press, at the commit, and one for each of the seventy', () => {
		expect(chainLightning.length).toBe(70);
		expect(chainLightning.filter((c) => !c.onGcd)).toEqual([]);
		expect(rules).toEqual(new Set(onGcd.map((c) => at(commitOf(c)))));
		expect(chainLightning.filter((c) => !rules.has(at(commitOf(c))))).toEqual([]);
	});

	/**
	 * The mechanism the report guessed at, measured on the pull it was reported from.
	 *
	 * A no-change guard, and labelled as one: a line is drawn per press that reads `onGcd`, and nothing
	 * on this path has ever consulted how long a cast took — so these lines were never the ones at risk,
	 * and a rule that priced a fast cast at its cast time would not have removed one of them either
	 * (verified on an isolated copy: the occupancy figure drops 3.50pp and every line stays). What the
	 * measurement is for is the *claim*: 31 of the 70 do finish inside a global, 856ms at the fastest, so
	 * the population the report was reasoning about exists and is pinned here rather than assumed away.
	 */
	it('rules the sub-second casts too, which is what the report suspected it did not', () => {
		const fast = chainLightning.filter((c) => (c.castTimeMs ?? 0) < GCD_MIN_MS);
		expect(fast.length).toBe(31); // no-change guard: the hypothesis in §44, not the defect
		expect(Math.min(...fast.map((c) => c.castTimeMs ?? 0))).toBe(856); // no-change guard
		expect(fast.filter((c) => !rules.has(at(commitOf(c))))).toEqual([]);
	});

	/**
	 * The second defect, from the other side: a rule at the landing is a rule at the wrong instant.
	 *
	 * 68 of the 70 landings carry no line at all. The two that do are not a leak — each is the
	 * millisecond the *next* Chain Lightning's `begincast` was logged, a chain cast with no gap between
	 * the two, so the line belongs to the press after it. That is asserted rather than excused, which is
	 * what stops this reading as a tolerance.
	 */
	it('rules nothing at a Chain Lightning landing that no other press committed at', () => {
		const ruledLandings = chainLightning.filter((c) => rules.has(at(c.t)));
		expect(ruledLandings.map((c) => c.t)).toEqual([52_996, 179_439]);
		expect(ruledLandings.filter((c) => !onGcd.some((o) => commitOf(o) === c.t))).toEqual([]);
	});
});
