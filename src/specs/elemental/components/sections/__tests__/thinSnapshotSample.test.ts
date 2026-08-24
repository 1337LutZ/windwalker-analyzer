// What the Snapshots section says to a pull that opened proc windows it could not claim.
//
// `thinShockSample.test.ts` is the same defect one section over, and its argument is this one's:
// "nothing happened" and "something happened and there is not enough of it to read" are different
// facts, and a reader acts on them differently. What makes this one worse is that the page proved the
// sentence false on the spot. `addsThenBoss` lists **six** proc windows in its own table and the
// sentence directly underneath them read *"No proc window was offered in this pull."*
//
// The two counts this section holds are not the same count, which is what let them come apart:
//
//   - `snapshots.windows` is every stretch where a trigger proc overlapped an intellect proc. Six here,
//     opening at 16 025, 26 834, 163 224, 265 710, 418 471 and 532 012ms. All six are drawn in the table.
//   - `refreshed + missed` is the narrower count `flameShockSnapshots` in `specs/elemental/lib/score.ts`
//     grades: only the windows the dot was also up through, because a window the dot was down through
//     was never a chance to refresh it. The dot's only window on the primary is 442 020–560 218ms — the
//     player is on a tower until then — so five of the six opened with it down and the sample is **one**.
//
// One is under `MIN_GRADED_SAMPLE`, so `metricOf` refuses the metric, the section has no reading,
// `gradeOf` answers `none` and `verdict()` reached for `verdict_none`. That key is the nothing-opened
// sentence, and three of the four committed pulls are the pulls it is true of.
//
// **Three facts, so three sentences.** Nothing opened; windows opened and the dot was down through all
// of them; windows opened, one or two had the dot up, and that is under the floor. The first keeps
// `verdict_none` unchanged, and the two new arms are `verdict_noneClaimable` and `verdict_tooFew`.
//
// **Which witnesses are real.** `addsThenBoss` is a committed capture and is the real witness for the
// thin arm — every figure above is read off it, not asserted about it. The three empty pulls are
// committed captures too. `verdict_noneClaimable` has **no** committed witness and is reached below on
// a hand-edited audit: `addsThenBoss` with its one claimable window taken away, which is the pull it
// would have been had the sixth window opened before the dot went up. The edit is the one
// `thinShockSample.test.ts` already makes for its own metric — two numbers moved on a copy of a real
// audit, nothing else touched.
//
// `createElement` rather than JSX so this stays a `.ts` file and is picked up by the project's own
// vitest include patterns, as its siblings do.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { rawFixtures } from '~/lib/analysis/fixtures';
import { formatClock } from '~/lib/format';
import { initI18n } from '~/lib/i18n/config';
import { MIN_GRADED_SAMPLE } from '~/lib/score';
import { getSpec } from '~/lib/spec';
import { resolveBands, type TargetModeChoice } from '~/lib/view/targetMode';
import type { Analysis, ElementalAuditResult } from '~/lib/types';

import { ScoreViewContext } from '~/components/report/scoreViewContext';
import { SpecContext } from '~/components/report/specContext';
import { analyse } from '~/specs/elemental/lib';

import Snapshots from '../Snapshots';

const ELEMENTAL_SPEC = getSpec('elemental')!;
initI18n();

type El = Analysis & ElementalAuditResult;

/** Every raw Elemental pull, found rather than listed, so a fifth fixture has to be read and pinned. */
const FIXTURES: string[] = rawFixtures('elemental').map(({ name }) => name.replace(/\.json$/, ''));

const cache = new Map<string, El>();
const analysed = (name: string): El => {
	const hit = cache.get(name);
	if (hit !== undefined) return hit;
	const found = rawFixtures('elemental').find((fixture) => fixture.name === `${name}.json`);
	if (found === undefined) throw new Error(`no raw Elemental fixture ${name}`);
	const el = analyse(found.dataset) as El;
	cache.set(name, el);
	return el;
};

const render = (analysis: El, choice: TargetModeChoice = 'auto'): string =>
	renderToStaticMarkup(
		createElement(
			SpecContext.Provider,
			{ value: ELEMENTAL_SPEC },
			createElement(
				ScoreViewContext.Provider,
				{ value: resolveBands(analysis.targets, choice) },
				createElement(Snapshots as never, { analysis }),
			),
		),
	);

/** The graded sentence alone — the last `Prose` in the section. `thinShockSample.test.ts`'s reader. */
const verdictOf = (html: string): string => {
	const paragraphs = [...html.matchAll(/<p class="m-0 max-w-\[64ch\][^"]*">([\s\S]*?)<\/p>/g)];
	expect(paragraphs.length, 'no graded sentence found — has `Prose` changed shape?').toBeGreaterThan(0);
	return paragraphs.at(-1)?.[1] ?? '';
};

/** Nothing here may pass by printing a dotted key at the reader. */
const noRawKey = (sentence: string) => expect(sentence).not.toMatch(/\bflameShockSnapshots\.verdict/);

const NOTHING_OPENED = 'No proc window was offered in this pull.';
const THIN = 'too thin to tell a habit from a coincidence';

const adds = analysed('addsThenBoss');

/** `addsThenBoss`'s audit with the claimable window taken away, and nothing else touched. */
const withClaimable = (refreshed: number, missed: number): El =>
	({ ...adds, snapshots: { ...adds.snapshots, refreshed, missed } }) as El;

describe('a pull whose proc windows are too few to read', () => {
	/**
	 * The premise, in both directions, so nothing below is vacuous.
	 *
	 * The two counts are pinned per pull, because the whole defect is that they can disagree and only one
	 * committed pull makes them. The floor is read off the scorer rather than restated: the only reason a
	 * sample of one is interesting is that one is under it.
	 */
	it('lists six windows on the one pull whose share counts one of them', () => {
		expect(MIN_GRADED_SAMPLE).toBe(3);
		const counted = Object.fromEntries(
			FIXTURES.map((name) => {
				const { windows, refreshed, missed } = analysed(name).snapshots;
				return [name, { listed: windows.length, claimable: refreshed + missed }];
			}),
		);
		expect(counted).toEqual({
			addsThenBoss: { listed: 6, claimable: 1 },
			cleave: { listed: 0, claimable: 0 },
			phased: { listed: 0, claimable: 0 },
			unbroken: { listed: 0, claimable: 0 },
		});
		// The six windows, and the dot window that leaves five of them unclaimable. Read off the audit
		// rather than quoted from a comment, so the arithmetic in this file's header cannot rot.
		expect(adds.snapshots.windows.map((window) => window.start)).toEqual([
			16025, 26834, 163224, 265710, 418471, 532012,
		]);
		expect(adds.flameShock.windows).toEqual([{ start: 442020, end: 560218 }]);
		const dotUp = adds.flameShock.windows[0]!;
		expect(adds.snapshots.windows.filter((window) => window.start < dotUp.start)).toHaveLength(5);
	});

	/**
	 * The trap this section walks straight into, pinned before anything is read off it.
	 *
	 * The section has a letter — `ok` — while the metric behind that letter is refused and its value has
	 * parked at 0. So a gate on the section letter would have found a graded section here, and a sentence
	 * quoting the metric would have printed a fresh falsehood in place of the old one. `Snapshots` reads
	 * the refusal off the metric and its numbers off the audit for exactly this reason.
	 */
	it('has a section letter over a metric that was refused', () => {
		const section = ELEMENTAL_SPEC.score(adds, resolveBands(adds.targets, 'auto')).sections['flameShockSnapshots'];
		expect(section?.grade).toBe('ok');
		expect(section?.unmeasurable).toBe(true);
		const metric = section?.metrics.find((m) => m.key === 'flameShockSnapshots');
		expect(metric?.unmeasurable).toBe(true);
		expect(metric?.sampleSize).toBe(1);
		expect(metric?.value).toBe(0);
		expect(metric?.exempt).not.toBe(true);
	});

	/**
	 * The defect: the nothing-happened sentence, printed above the six windows that happened.
	 *
	 * The row assertion is the half that makes it a falsehood rather than a hedge — the windows the reader
	 * is being told do not exist are drawn directly above the sentence, six of them, at the times the table
	 * prints.
	 */
	it('does not tell a pull nothing opened while six windows are on the page', () => {
		const html = render(adds);
		const sentence = verdictOf(html);
		expect(sentence).not.toContain(NOTHING_OPENED);
		for (const window of adds.snapshots.windows) expect(html).toContain(formatClock(window.start));
		noRawKey(sentence);
	});

	/**
	 * What it says instead, and the two numbers that make it checkable against the page.
	 *
	 * The share is the narrow count, said as the narrow count — "up through 1 of the proc windows" rather
	 * than a fraction of the six — because the six are what the reader can see and the one is what the
	 * report could read. Phrased so no numeral needs agreement, at one window as at two, for the reason
	 * the exempt arm beside it gives.
	 */
	it('names the windows the dot was up through and sends the reader to the table', () => {
		const sentence = verdictOf(render(adds));
		expect(sentence).toContain('Your Flame Shock was up through 1 of the proc windows in the table above');
		expect(sentence).toContain('1 of those took a refresh');
		expect(sentence).toContain('Any others opened with the dot already down');
		expect(sentence).toContain(THIN);
		expect(sentence).toContain('read the table a window at a time');
		expect(sentence).not.toMatch(/\b1 windows\b/);
		noRawKey(sentence);
	});

	/**
	 * The third fact, on a **synthetic** audit, and labelled as one.
	 *
	 * No committed pull opens a window it could claim none of, so this is `addsThenBoss` with its one
	 * claimable window removed and its six listed windows left alone. It is a reachable pull, not a
	 * hypothetical: it is this capture with the sixth window falling before 442 020ms like the other five.
	 * Without an arm of its own the reader would get the nothing-opened sentence over six rows again, which
	 * is the same defect with a different denominator.
	 */
	it('says the dot was down rather than that nothing opened, on a synthetic audit', () => {
		const html = render(withClaimable(0, 0));
		const sentence = verdictOf(html);
		expect(sentence).not.toContain(NOTHING_OPENED);
		expect(sentence).not.toContain(THIN);
		expect(sentence).toContain('Every proc window in the table above opened with your Flame Shock already down');
		expect(sentence).toContain('None of them was a chance to refresh it');
		for (const window of adds.snapshots.windows) expect(html).toContain(formatClock(window.start));
		noRawKey(sentence);
	});

	/**
	 * And the sentence the two new arms were added to protect, still reached by the pulls it is true of.
	 *
	 * This is why they are new arms and not a rewording of the old one. `cleave`, `phased` and `unbroken`
	 * wear no trigger trinket, open no window at all, and get the plain sentence back unchanged.
	 */
	it('still says the plain thing to the three pulls that opened nothing', () => {
		for (const name of ['cleave', 'phased', 'unbroken']) {
			const sentence = verdictOf(render(analysed(name)));
			expect(sentence, name).toBe(NOTHING_OPENED);
		}
	});

	/**
	 * The exemption still wins, which it must: the two refusals are not interchangeable.
	 *
	 * Read as multi-target, this metric is outside its own target counts and `verdict()` routes to the arm
	 * that says nothing asked for the refresh. A thin sample is a statement about how much of the pull
	 * there was to read; an exemption is a statement about what was asked of it. The new route is taken
	 * off `unasked` for that reason, and this is what holds the order.
	 */
	it('leaves the exempt sentence in front of the thin one', () => {
		const sentence = verdictOf(render(adds, 'multi'));
		expect(sentence).toContain('the multi-target order has no Flame Shock refresh in it');
		expect(sentence).not.toContain(THIN);
		noRawKey(sentence);
	});

	/**
	 * The no-change guard, labelled: this is a copy and routing change, so no grade may move.
	 *
	 * Every committed pull's overall and its Snapshots letter, written out. A fix that reached past the
	 * refusal and changed what the scorer says would fail here rather than read as a tidier diff.
	 */
	it('moves no grade on any committed pull', () => {
		const graded = Object.fromEntries(
			FIXTURES.map((name) => {
				const el = analysed(name);
				const card = ELEMENTAL_SPEC.score(el, resolveBands(el.targets, 'auto'));
				return [name, { overall: card.overall, snapshots: card.sections['flameShockSnapshots']?.grade }];
			}),
		);
		expect(graded).toEqual({
			addsThenBoss: { overall: 'bad', snapshots: 'ok' },
			cleave: { overall: 'ok', snapshots: 'ok' },
			phased: { overall: 'good', snapshots: 'ok' },
			unbroken: { overall: 'ok', snapshots: 'ok' },
		});
	});
});
