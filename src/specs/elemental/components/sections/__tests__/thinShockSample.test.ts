// What the Earth Shock section says to a pull that pressed the shock two or three times.
//
// `unaskedVerdict.test.ts` is the floor below this one. There a section's rules were never *asked* of
// the pull — every metric outside its own target counts — and the sentence that fell out was "Earth
// Shock was never cast in this pull", printed over a table of shocks. This is the same falsehood
// reached by the other route: the rules were asked, the pull answered, and the answer is too thin to
// read.
//
// `earthShockGood` is a share over the presses made at one or two enemies, and `shareOf` hands that
// share its denominator as a sample size — which `metricOf` refuses under `MIN_GRADED_SAMPLE`. So at
// one or two judged shocks the metric has no value, the section has no letter, `gradeOf` answers
// `none`, and `verdict()` reached for `verdict_none`. That key is the never-pressed sentence, and it
// was being handed to a reader looking at their own presses.
//
// **The fix is a fourth arm and not a rewording of the third, and that is the whole argument of this
// file.** "You never pressed this" and "you pressed it, and there is not enough of it to read" are
// different facts, and a reader acts on them differently: the first asks for the button, the second
// asks for the table to be read a row at a time. The Windwalker's Tiger Palm folded the two together —
// its `verdict_none` *is* the too-few sentence — and the cost is that the section can no longer say
// the plain thing at all. Here both stay sayable.
//
// **No committed fixture reaches it.** The four pulls judge 7, 12, 13 and 20 shocks, so every audit
// below is hand-edited, and the premise test writes those four numbers out so the claim cannot rot.
// The edit is the one `countAgreement.test.ts` already makes for this exact metric — `judged` and
// `good` moved on a copy of `cleave`'s audit — so the floor is inherited rather than re-derived there
// and re-derived here. Nothing else in the audit moves, and the two numbers the new sentence reads are
// `judged` and the press count.
//
// `createElement` rather than JSX so this stays a `.ts` file and is picked up by the project's own
// vitest include patterns, as its siblings do.

import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { rawFixtures } from '~/lib/analysis/fixtures';
import { initI18n } from '~/lib/i18n/config';
import { formatClock } from '~/lib/format';
import { MIN_GRADED_SAMPLE } from '~/lib/score';
import { getSpec } from '~/lib/spec';
import { resolveBands, type TargetModeChoice } from '~/lib/view/targetMode';
import type { Analysis, ElementalAuditResult } from '~/lib/types';

import { ScoreViewContext } from '~/components/report/scoreViewContext';
import { SpecContext } from '~/components/report/specContext';
import { analyse } from '~/specs/elemental/lib';

import EarthShock from '../EarthShock';

const ELEMENTAL_SPEC = getSpec('elemental')!;
initI18n();

type El = Analysis & ElementalAuditResult;

/**
 * Every raw Elemental pull, found rather than listed, and the analysis memoised.
 *
 * Both grids in this file already named all four pulls, so neither was hiding a stale claim — but both
 * are of the form "every committed pull", and a four-name literal is a five-name claim waiting to be
 * wrong. Discovered, the pinned objects below fail on a fifth fixture instead of ignoring it. Memoised
 * because `addsThenBoss.json` is 4.4 MB and the two grids each want every pull.
 */
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

const render = (
	Component: (props: { analysis: Analysis }) => ReactNode,
	analysis: El,
	choice: TargetModeChoice = 'auto',
): string =>
	renderToStaticMarkup(
		createElement(
			SpecContext.Provider,
			{ value: ELEMENTAL_SPEC },
			createElement(
				ScoreViewContext.Provider,
				{ value: resolveBands(analysis.targets, choice) },
				createElement(Component as never, { analysis }),
			),
		),
	);

/** The graded sentence alone. Same reader and same argument as `unaskedVerdict.test.ts`'s. */
const verdictOf = (html: string): string => {
	const paragraphs = [...html.matchAll(/<p class="m-0 max-w-\[64ch\][^"]*">([\s\S]*?)<\/p>/g)];
	expect(paragraphs.length, 'no graded sentence found — has `Prose` changed shape?').toBeGreaterThan(0);
	return paragraphs.at(-1)?.[1] ?? '';
};

/** Nothing here may pass by printing a dotted key at the reader. `countAgreement.test.ts`'s guard. */
const noRawKey = (sentence: string) => expect(sentence).not.toMatch(/\bearthShock\.verdict/);

const NEVER_PRESSED = 'Earth Shock was never cast in this pull.';

const cleave = analysed('cleave');

/**
 * `cleave`'s audit with the judged count moved, and nothing else touched.
 *
 * The same hand edit `countAgreement.test.ts` makes to assert the floor. `good` follows `judged` so the
 * share is a clean 100% and the refusal cannot be mistaken for a value the thresholds rejected — what is
 * being tested is that there is no value at all.
 */
const withJudged = (judged: number): El =>
	({ ...cleave, earthShock: { ...cleave.earthShock, judged, good: judged } }) as El;

/** The audit with the presses taken away as well, which is the pull the never-pressed sentence is for. */
const withNoPresses = (): El =>
	({ ...cleave, earthShock: { ...cleave.earthShock, judged: 0, good: 0, presses: [] } }) as El;

describe('a pull whose shocks are too few to read', () => {
	/**
	 * The premise, so nothing below is vacuous, in both directions.
	 *
	 * No committed pull judges fewer than three shocks — the four numbers are written out, so a fixture
	 * arriving under the floor fails here rather than turning an assertion below into a test of a pull it
	 * was not written for. And the floor itself is read off the scorer rather than restated, because the
	 * only reason `withJudged(2)` is interesting is that two is under it.
	 */
	it('is a floor no committed pull is under, on a metric that publishes its sample', () => {
		expect(MIN_GRADED_SAMPLE).toBe(3);
		const judged = Object.fromEntries(FIXTURES.map((name) => [name, analysed(name).earthShock.judged]));
		expect(judged).toEqual({ addsThenBoss: 20, cleave: 7, phased: 12, unbroken: 13 });
		for (const [name, count] of Object.entries(judged)) {
			expect(count, `${name} judges fewer shocks than the floor`).toBeGreaterThanOrEqual(MIN_GRADED_SAMPLE);
		}
	});

	/**
	 * The defect: the section had no letter, so the reader was told the button was never pressed.
	 *
	 * Both counts under the floor, and the shocks left on the page at each. The row assertion is the half
	 * that makes the sentence a falsehood rather than merely a hedge — the presses the reader is being told
	 * do not exist are drawn directly above it, three of them, at times the table prints.
	 */
	it('does not tell a pull it never pressed a shock it pressed twelve times', () => {
		const early = cleave.earthShock.presses.filter((press) => press.good === false);
		expect(early).toHaveLength(2);

		for (const judged of [1, 2]) {
			const thin = withJudged(judged);
			const section = ELEMENTAL_SPEC.score(thin).sections['earthShock'];
			// **The metric and not the section, which is the same move the Windwalker's snapshot section made.**
			// `elementalDischargeUptime` sits on this card as a secondary — Fulmination is what applies the
			// debuff, so the two belong together — and `SectionScore.unmeasurable` is `every` over all of a
			// section's metrics, so a pull with the tier-16 set worn keeps a measurable section however few
			// shocks it holds. What must stay refused is the *shock* rule, which is what the sentence under
			// test is about; `thinSample.test.ts` in `specs/windwalker` carries the argument in full.
			const waste = section?.metrics.find((m) => m.key === 'earthShockWaste');
			expect(waste?.unmeasurable, `${judged} judged shocks should not grade`).toBe(true);

			const html = render(EarthShock, thin);
			const sentence = verdictOf(html);
			expect(sentence).not.toContain(NEVER_PRESSED);
			// And the table it would have been printed over is on the page, row by row.
			for (const press of early) expect(html).toContain(formatClock(press.t));
			noRawKey(sentence);
		}
	});

	/**
	 * What it says instead, and the two numbers that make it checkable against the page.
	 *
	 * The total is the same figure the exempt arm names and is phrased the same way, because it is the same
	 * problem: at one press a numeral in front of a plural noun reads *"1 presses"*. The count beside it is
	 * `judged`, so a reader can see which of the two the refusal is about — and it is the only number that
	 * moves between the two rows below.
	 */
	it('names the presses it counted and the presses it could not read', () => {
		for (const [judged, counted] of [
			[1, 'only 1 of those came with one or two enemies up'],
			[2, 'only 2 of those came with one or two enemies up'],
		] as const) {
			const sentence = verdictOf(render(EarthShock, withJudged(judged)));
			expect(sentence).toContain('Earth Shock was pressed in this pull — 12 in total');
			expect(sentence).toContain(counted);
			expect(sentence).toContain('too few to tell a habit from a coincidence');
			// The reader is sent to the table rather than left with a fraction, which is the whole difference
			// between this arm and the never-pressed one in what it asks them to do next.
			expect(sentence).toContain('own row in the table');
			expect(sentence).not.toMatch(/\b\d+ presses\b/);
			noRawKey(sentence);
		}
	});

	/**
	 * Nought judged is in this arm too, and it is the case that shows the gate is the presses rather than
	 * the sample.
	 *
	 * A pull whose every shock went out at three or more enemies judges none of them, and on a reading that
	 * includes one enemy that is a thin sample rather than an exemption — the shocks were pressed and the
	 * rules were asked, there is simply nothing of them at the counts the rules exist at. `sharePct` returns
	 * null there and the sample is nought, both under the floor, so the section still has no letter and the
	 * never-pressed sentence was still the fallback.
	 */
	it('holds at no judged shocks at all, while the presses are still on the page', () => {
		const sentence = verdictOf(render(EarthShock, withJudged(0)));
		expect(sentence).not.toContain(NEVER_PRESSED);
		expect(sentence).toContain('Earth Shock was pressed in this pull — 12 in total');
		expect(sentence).toContain('only 0 of those came with one or two enemies up');
		noRawKey(sentence);
	});

	/**
	 * And the sentence the fourth arm was added to protect, still reached by the pull it is true of.
	 *
	 * This is why it is a fourth arm and not a rewording of the third. Take the presses away as well and
	 * the plain sentence comes back, unchanged and correct — which is exactly what the Windwalker's Tiger
	 * Palm gave up when it folded the too-few case into this key.
	 */
	it('still says the plain thing to a pull that really never pressed it', () => {
		const sentence = verdictOf(render(EarthShock, withNoPresses()));
		expect(sentence).toBe(NEVER_PRESSED);
	});

	/**
	 * The exemption still wins, which it must: the two refusals are not interchangeable.
	 *
	 * Read as multi-target, `cleave`'s only Earth Shock metric is outside its own target counts, so
	 * `gradeOf` answers `exempt` and `verdict()` routes to the arm that says nothing asked for the button.
	 * A thin sample is a statement about how much of the pull there was to read; an exemption is a statement
	 * about what was asked of it. The new gate is read after the exempt one for that reason, and this is
	 * what holds the order.
	 */
	it('leaves the exempt sentence in front of the thin one', () => {
		const sentence = verdictOf(render(EarthShock, withJudged(1), 'multi'));
		expect(sentence).toContain('has no Earth Shock in it at all');
		expect(sentence).toContain('That is 12 in total');
		expect(sentence).not.toContain('too few to tell a habit from a coincidence');
		noRawKey(sentence);
	});

	/**
	 * The no-change guard, labelled: every committed pull is over the floor and keeps the sentence it had.
	 *
	 * Every committed pull grades `bad` on this metric today, so the guard is on that arm — a fix that reached past the
	 * floor and swallowed a real fault would fail here rather than read as a tidier diff.
	 */
	it('leaves every committed pull alone', () => {
		const expected: Record<string, string> = {
			addsThenBoss: 'Only 9 of 20 shocks were spent',
			cleave: '5 of 7 shocks were spent',
			// No "Only" on these two any more: dropping the false tier-16 charges takes `phased` to `good` and
			// `unbroken` to `ok`, and that prefix belongs to `verdict_bad` alone. `phased` has since gone to
			// `ok` on the Ascendance rule and keeps the prefix-free arm; its count is the one that moved.
			phased: '10 of 12 shocks were spent',
			unbroken: '10 of 13 shocks were spent',
		};
		// Every discovered pull has a sentence written down for it, so a fifth fixture has to be read and
		// pinned rather than skipped by a loop that never reaches it.
		expect(Object.keys(expected).sort()).toEqual([...FIXTURES].sort());
		for (const name of FIXTURES) {
			const sentence = verdictOf(render(EarthShock, analysed(name)));
			expect(sentence, name).toContain(expected[name]!); // no-change guard
			expect(sentence, name).not.toContain('too few to tell a habit from a coincidence');
			noRawKey(sentence);
		}
	});
});
