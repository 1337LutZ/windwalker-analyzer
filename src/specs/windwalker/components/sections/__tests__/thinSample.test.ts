// What each graded Windwalker section says to a pull it cannot measure but did press.
//
// `specs/elemental/components/sections/__tests__/thinShockSample.test.ts` is the same file one spec
// over, and its argument is the one this inherits: **"you never pressed this" and "you pressed it, and
// there is not enough of it to read" are different facts, and a reader acts on them differently.** The
// first asks for the button; the second asks for the chart to be read a row at a time. A section that
// stores one sentence for both hands a reader a falsehood over their own presses, and a section that
// rewrites the one sentence to cover both loses the ability to say the plain thing at all.
//
// `metricOf` has two ways to refuse, and both land on the same key. A sample under the floor
// (`MIN_GRADED_SAMPLE`, via `shareOf`) and an empty clock (`gradedOver`) each leave the metric with no
// value, the section with no letter, `gradeOf` answering `none` and `verdict()` reaching for the arm a
// section writes for a pull that never pressed the button. The two refusals are **not** the same fact
// as each other either — a thin sample says there was too little of the thing to read, an empty clock
// says there was nothing to read it *against* — so they get one arm each rather than one between them.
//
// ## The sweep, and what it found
//
// Six Windwalker sections store a graded sentence. Each is asked the same question: can it tell a pull
// that never pressed the button from a pull it cannot measure, and is there a table of presses on the
// page while it answers?
//
//   - **`snapshots`** — could not. Presses on the page, and the never-arrived sentence over them at one
//     or two affordable procs. Fixed here by a fifth arm, `tooFew`, reached by name.
//   - **`debuff`** — could not, and worse than the Elemental's: the *same key* is printed by the
//     section's own nought-casts branch, where it is exactly true, and by the graded slot, where it is
//     not. Fixed here by a fifth arm, `noContact`, reached by name. See the judgement below.
//   - **`tigerPalm`** — already could, and it is the section the Elemental commit was written against.
//     `f832015` moved the plain sentence onto a key of its own and left the graded `none` arm holding
//     the thin-sample wording, gated on the press count rather than on the letter. `cleave` is the
//     committed witness: two band-1 presses out of twelve, refused, and the thin sentence printed over
//     the twelve. The only thing left owed is the arm's *name*, which still says `none`. Judged and
//     left: the name is not a label anyone chose but what `verdict()` assembles from a grade of `none`,
//     and the forward guard in `lib/i18n/__tests__/keys.test.ts` requires that stem on every section
//     that stores arms at all — so renaming means reaching it by name from `TigerPalm` and carrying a
//     second guard, to change a key no reader ever sees. The reason now sits on the key's own line in
//     that file, so the next reader need not re-open it.
//   - **`brew`** — can. Its plain arm is chosen on `brew.uses` at the call site and never off the
//     letter, so a pull whose short-brew sample is thin (`weave`, two required brews) keeps a graded
//     sentence about the brews it did spend and never reaches the plain one.
//   - **`karma`** — could not, and it was worse than either of the two above, because the defect was a
//     level deeper: the two sections here *described* a metric the scorer had refused, while this one
//     was **a grade the scorer should have refused and did not.** `karmaEmpty` was built with
//     `sharePct`, which declines only at a denominator of nought, so one empty Touch of Karma press
//     graded the pull `bad` off a denominator of one. Fixed in `lib/score.ts` by putting it through
//     `shareOf` like everything else, and by a fifth arm, `karma.verdict_tooFew`, reached by name. See
//     the judgement below — this is the only one of the three whose witnesses are committed captures.
//   - **`casts`** — can. Its only metric is refused where the pull recorded no globals at all, and its
//     plain arm is already written as an admission about the measurement rather than as a claim about
//     the player. It over-claims in neither direction, so it is justified rather than changed.
//
// The table-direction sweep that came with it found two inversions, both Elemental and both fixed in
// `report.json`: `earthShock`'s `ok` and `bad` arms said "the table below" while `EarthShock` renders
// its grid above the sentence. Every Windwalker directional phrase was checked against its component's
// render order and every one of them already pointed the right way.
//
// ## Which witnesses are synthetic, and the premise tests that keep that honest
//
// The six committed Windwalker fixtures are captured `Analysis` output rather than raw datasets, so
// they cannot be re-captured without a token nobody has.
//
// **On the snapshots and the debuff, every witness is synthetic.** No committed pull is under either
// refusal there — the affordable-proc counts are 4 to 14 and every contact span is minutes long — so
// every thin pull for those two is a hand edit of `cleave`'s audit, in the manner
// `specs/elemental/.../thinShockSample.test.ts` edits its own.
//
// **On the karma, every witness is real, and that is the whole weight of it.** A ninety-second
// cooldown on a four-minute pull leaves most captures under a floor of three presses, and five of
// these six are: `cleave` and `strong` took two, `waves` and `weave` took one, and only `mixed` and
// `poor` reached three. So nothing here is hand-edited, the wrong grades quoted below are the ones
// four committed pulls print today, and no synthetic pull is needed to reach any of them.
//
// Each half has a premise test that writes the real numbers out so the claim cannot rot, and each has
// a no-change test holding the pulls that were right to the sentences they print today.
//
// `createElement` rather than JSX so this stays a `.ts` file and is picked up by the project's own
// vitest include patterns, as its siblings do.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { initI18n } from '~/lib/i18n/config';
import { MIN_GRADED_SAMPLE } from '~/lib/score';
import { WEIGHTS } from '~/specs/windwalker/lib/score';
import { getSpec } from '~/lib/spec';
import { resolveBands, type TargetModeChoice } from '~/lib/view/targetMode';
import type { Analysis } from '~/lib/types';

import { ScoreViewContext } from '~/components/report/scoreViewContext';
import { SpecContext } from '~/components/report/specContext';

import BrewBankTimeline from '../BrewBankTimeline';
import CastsPerMinute from '../CastsPerMinute';
import RisingSunKick from '../RisingSunKick';
import SnapshotTable from '../SnapshotTable';
import TigerPalm from '../TigerPalm';
import TouchOfKarma from '../TouchOfKarma';

const WINDWALKER = getSpec('windwalker')!;
initI18n();

const FIXTURES = ['cleave', 'mixed', 'poor', 'strong', 'waves', 'weave'] as const;

const fixture = (name: string): Analysis =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../__fixtures__/${name}.json`), 'utf8')) as Analysis;

const render = (
	Component: (props: { analysis: Analysis }) => ReactNode,
	analysis: Analysis,
	choice: TargetModeChoice = 'auto',
): string =>
	renderToStaticMarkup(
		createElement(
			SpecContext.Provider,
			{ value: WINDWALKER },
			createElement(
				ScoreViewContext.Provider,
				{ value: resolveBands(analysis.targets, choice) },
				createElement(Component as never, { analysis }),
			),
		),
	);

const strip = (html: string): string =>
	html
		.replaceAll(/<[^>]*>/g, ' ')
		.replaceAll('&#x27;', "'")
		.replaceAll('&amp;', '&')
		.replaceAll('&quot;', '"')
		.replaceAll(/\s+/g, ' ')
		.trim();

/** Every `Prose` on the page, in render order. The graded sentence of each section is one of these. */
const prose = (html: string): string[] =>
	[...html.matchAll(/<p class="m-0 max-w-\[64ch\][^"]*">([\s\S]*?)<\/p>/g)].map((m) => strip(m[1] ?? ''));

/** Every `Note`. The two sections that refuse to draw anything at all speak through one of these. */
const notes = (html: string): string[] =>
	[...html.matchAll(/<p class="m-0 max-w-\[70ch\][^"]*">([\s\S]*?)<\/p>/g)].map((m) => strip(m[1] ?? ''));

/**
 * The tone one `StatTile` is painted in, by the label under it: the `line` of `border-l-line` and so on.
 *
 * A tile is coloured by the metric it shows rather than by its section's letter, so a floor reaching a
 * metric changes a colour on the page as well as a sentence. Read off the rendered class because that is
 * what a reader sees, and split on the tile's own opening so a chunk cannot borrow its neighbour's class.
 */
const tileTone = (html: string, label: string): string =>
	html
		.split('<div class="border-l-2')
		.filter((chunk) => chunk.includes(label))
		.map((chunk) => chunk.match(/border-l-([\w-]+)/)?.[1] ?? '')[0] ?? '';

/**
 * The graded sentence of a section that drew its evidence: the paragraph after the intent.
 *
 * Indexed rather than taken from the end, because two of these sections put a further sentence under
 * the verdict — the depth reading on the snapshots, the drop clause on the debuff — and the end would
 * pick that one up on some pulls and not others.
 */
const verdictOf = (html: string): string => {
	const all = prose(html);
	expect(all.length, 'no graded sentence found — has `Prose` changed shape?').toBeGreaterThan(1);
	return all[1] ?? '';
};

/** Nothing here may pass by printing a dotted key at the reader. `countAgreement.test.ts`'s guard. */
const noRawKey = (sentence: string) => expect(sentence).not.toMatch(/\b(snapshots|debuff|brew|karma|casts)\.verdict/);

const NEVER_ARRIVED =
	'No Re-Origination proc arrived with enough Tigereye Brew banked to be worth spending on, so there was nothing to catch.';
const NEVER_CAST = 'Rising Sun Kick was never cast in this pull.';
const TOO_FEW_PROCS = 'too few to tell a habit from a coincidence';
const NO_CONTACT = 'no time with an enemy in front of you was recorded to measure the debuff against';

const cleave = fixture('cleave');

/**
 * `cleave`'s proc audit with the affordable count moved, and nothing else touched.
 *
 * Six windows fired on that pull and five were affordable. Moving the affordable count moves what the
 * rules could be asked about; the windows stay on the chart, which is the half that makes the old
 * sentence a falsehood rather than merely a hedge. `unaffordable` follows so the two counts still add
 * up to the six rows the reader can see.
 */
const withAffordable = (opportunities: number, snapshotted: number): Analysis => ({
	...cleave,
	procs: {
		...cleave.procs,
		opportunities,
		snapshotted,
		unaffordable: cleave.procs.windows.length - opportunities,
	},
});

/** The debuff audit with the contact span emptied, which is the other of the two refusals. */
const withContact = (contactMs: number, engagedMs: number): Analysis => ({
	...cleave,
	debuff: { ...cleave.debuff, contactMs, engagedMs },
});

describe('a Windwalker pull with presses and nothing to read them by', () => {
	/**
	 * The premise, so nothing below is vacuous, in both directions.
	 *
	 * The floor is read off the scorer rather than restated, because the only reason two affordable procs
	 * are interesting is that two is under it. The six fixtures' own numbers are written out so a fixture
	 * arriving under either refusal fails here — where the reason is — rather than turning one of the
	 * no-change rows at the foot of this file into a test of a pull it was not written for.
	 */
	it('is two refusals no committed pull is under, on metrics that publish what they were measured by', () => {
		expect(MIN_GRADED_SAMPLE).toBe(3);
		const affordable = Object.fromEntries(FIXTURES.map((name) => [name, fixture(name).procs.opportunities]));
		expect(affordable).toEqual({ cleave: 5, mixed: 6, poor: 8, strong: 14, waves: 6, weave: 4 });
		for (const [name, count] of Object.entries(affordable)) {
			expect(count, `${name} offers fewer affordable procs than the floor`).toBeGreaterThanOrEqual(MIN_GRADED_SAMPLE);
		}
		for (const name of FIXTURES) {
			const { debuff } = fixture(name);
			expect(debuff.casts, `${name} cast no Rising Sun Kick`).toBeGreaterThan(0);
			expect(debuff.contactMs ?? debuff.engagedMs, `${name} recorded no contact`).toBeGreaterThan(0);
		}
	});

	/**
	 * The snapshots defect: no rate, so the reader was told no proc they could pay for ever arrived.
	 *
	 * Both counts under the floor and both catch counts at each, with the procs left on the page. The
	 * chart assertion is what makes the old sentence a falsehood rather than a hedge — the six windows the
	 * reader is being told did not happen are drawn directly above it, and the clause under the verdict
	 * counts the rest of them out loud.
	 */
	it('does not tell a pull no affordable proc arrived when two of them did', () => {
		expect(cleave.procs.windows).toHaveLength(6);
		for (const [total, caught] of [
			[1, 0],
			[1, 1],
			[2, 0],
			[2, 1],
			[2, 2],
		] as const) {
			const thin = withAffordable(total, caught);
			const label = `${caught} of ${total}`;
			const rate = WINDWALKER.score(thin, resolveBands(thin.targets, 'auto')).sections['snapshots']?.metrics.find(
				(m) => m.key === 'snapshotRate',
			);
			expect(rate?.unmeasurable, `${label} should not grade`).toBe(true);

			const sentence = verdictOf(render(SnapshotTable, thin));
			expect(sentence, label).not.toContain(NEVER_ARRIVED);
			expect(sentence, label).toContain(`${total} catchable in total, with ${caught} of those taken`);
			expect(sentence, label).toContain(TOO_FEW_PROCS);
			// The reader is sent to the chart rather than left with a fraction, which is the whole difference
			// between this arm and the never-arrived one in what it asks them to do next.
			expect(sentence, label).toContain('own row on the chart above');
			// Phrased so the numeral needs no agreement, at one as at two.
			expect(sentence, label).not.toMatch(/\b1 procs\b/);
			noRawKey(sentence);
		}
	});

	/**
	 * The pull that shows why the gate is the metric and not the section's letter.
	 *
	 * Depth is a *secondary* metric here, so `section()` calls the whole section unmeasurable only when
	 * depth is refused as well — and depth is measurable the moment one proc was caught. Two affordable
	 * procs with one caught therefore leaves a refused rate, no decided primary metric, and a letter of
	 * `ok` handed down by `section()`'s nothing-decided fallback. That letter chose the `ok` arm, and the
	 * arm read the rate the scorer had refused, so the sentence printed a share of nought beside a
	 * numerator of one. Reading the section's letter instead would have left that standing.
	 */
	it('does not print a share of nought beside a proc it says was caught', () => {
		const thin = withAffordable(2, 1);
		const section = WINDWALKER.score(thin, resolveBands(thin.targets, 'auto')).sections['snapshots'];
		expect(section?.grade, 'the letter this arm used to be chosen by').toBe('ok');
		expect(section?.unmeasurable, 'and the section is not unmeasurable, so `gradeOf` never said `none`').toBe(false);

		const sentence = verdictOf(render(SnapshotTable, thin));
		expect(sentence).not.toContain('1 of 2 catchable procs taken (0%)');
		expect(sentence).not.toMatch(/catchable procs taken/);
		noRawKey(sentence);
	});

	/**
	 * And the sentence the fifth arm was added to protect, still reached by the two pulls it is true of.
	 *
	 * This is why it is a fifth arm and not a rewording of the fourth. There are two shapes of pull the
	 * plain sentence belongs to and they take different routes to it: no proc fired at all, which the
	 * section refuses to draw anything for, and procs that fired with the bank never able to pay for one,
	 * which draws the chart and reaches the sentence through the graded slot. Both come back word for
	 * word.
	 */
	it('still says the plain thing to a pull no affordable proc arrived in', () => {
		const noProcs: Analysis = { ...cleave, procs: { ...cleave.procs, windows: [], opportunities: 0, snapshotted: 0 } };
		expect(notes(render(SnapshotTable, noProcs))[0]).toBe(NEVER_ARRIVED);

		const nothingAffordable = withAffordable(0, 0);
		const drawn = render(SnapshotTable, nothingAffordable);
		const sentence = verdictOf(drawn);
		expect(sentence.startsWith(NEVER_ARRIVED), sentence).toBe(true);
		expect(sentence).not.toContain(TOO_FEW_PROCS);
		// The six procs are still drawn, and the clause under the verdict accounts for every one of them.
		expect(sentence).toContain('6 more procs arrived with too few stacks banked');
		noRawKey(sentence);
	});

	/**
	 * The debuff defect, and both shapes of pull that reach it.
	 *
	 * `rskUptime` is handed its value together with the span it was measured over, and `metricOf` refuses
	 * an empty span outright. The component and the scorer read that span through different fallbacks —
	 * one treats a nought contact as absent and falls through to the engaged span, the other does not — so
	 * a pull with nought contact and a live engaged span is refused by the scorer while this section's own
	 * chart is still drawn off the wider one. Both shapes are here because the gate is the metric, which
	 * is what keeps the sentence and the letter agreeing whichever of the two a pull has.
	 */
	it('does not tell a pull it never cast the kick it cast twenty times', () => {
		for (const [contactMs, engagedMs] of [
			[0, 0],
			[0, cleave.debuff.engagedMs],
		] as const) {
			const thin = withContact(contactMs, engagedMs);
			const label = `contact ${contactMs}, engaged ${engagedMs}`;
			const uptime = WINDWALKER.score(thin, resolveBands(thin.targets, 'auto')).sections['debuff']?.metrics.find(
				(m) => m.key === 'rskUptime',
			);
			expect(uptime?.unmeasurable, `${label} should not grade`).toBe(true);

			const sentence = verdictOf(render(RisingSunKick, thin));
			expect(sentence, label).not.toContain(NEVER_CAST);
			expect(sentence, label).toContain('Rising Sun Kick was cast in this pull — 20 in total');
			expect(sentence, label).toContain(NO_CONTACT);
			// It claims nothing about the uptime, because there is none — and least of all a percentage.
			expect(sentence, label).not.toMatch(/uptime across \d+ casts/);
			noRawKey(sentence);
		}
	});

	/** And the debuff's plain sentence, on the pull that really never cast it. */
	it('still says the plain thing to a pull that never cast the kick', () => {
		const noCasts: Analysis = { ...cleave, debuff: { ...cleave.debuff, casts: 0 } };
		expect(notes(render(RisingSunKick, noCasts))[0]).toBe(NEVER_CAST);
	});

	/**
	 * The no-change guard, labelled: every committed pull is clear of both refusals and keeps its sentence.
	 *
	 * Both sections and all six pulls, on the opening clause the arm is recognisable by — a fix that
	 * reached past a refusal and swallowed a real reading would fail here rather than read as a tidier
	 * diff. The letters behind them are pinned by the fixtures' own scorecard tests; what these hold is
	 * that the *sentence* chosen off those letters has not moved.
	 */
	it('leaves all six committed pulls alone', () => {
		for (const [name, procs, kick] of [
			['cleave', '5 of 5 catchable procs taken', '87.02% uptime across 20 casts'],
			['mixed', '4 of 6 catchable procs taken', '95.39% uptime across 24 casts'],
			['poor', '2 of 8 catchable procs taken', '99.36% uptime across 26 casts'],
			['strong', '12 of 14 catchable procs taken', '90.66% uptime across 54 casts'],
			['waves', '5 of 6 catchable procs taken', '80.57% uptime across 32 casts'],
			['weave', '4 of 4 catchable procs taken', '99.15% uptime across 15 casts'],
		] as const) {
			const analysis = fixture(name);
			const snapshots = verdictOf(render(SnapshotTable, analysis));
			expect(snapshots, name).toContain(procs); // no-change guard
			expect(snapshots, name).not.toContain(TOO_FEW_PROCS);
			noRawKey(snapshots);

			const debuff = verdictOf(render(RisingSunKick, analysis));
			expect(debuff, name).toContain(kick); // no-change guard
			expect(debuff, name).not.toContain(NO_CONTACT);
			noRawKey(debuff);
		}
	});
});

/**
 * The other four graded sections, held to the half of the change that is easy to lose.
 *
 * Each one was swept for the same defect and each one already tells the two facts apart — the reasoning
 * per section is in this file's header. What is asserted here is the consequence a reader can check:
 * the plain sentence comes back word for word on the pull it is true of. That is the half `tigerPalm`
 * nearly gave up when it moved its thin-sample wording into the graded `none` arm, and the half both
 * new arms above exist to protect, so it is worth an assertion on every section that has one rather
 * than only on the two that changed.
 */
describe('the plain sentence, on every graded Windwalker section that has one', () => {
	it('comes back word for word when the button really was never pressed', () => {
		const brewless: Analysis = { ...cleave, brew: { ...cleave.brew, uses: 0 } };
		expect(prose(render(BrewBankTimeline, brewless))[1]).toContain('No Tigereye Brew was spent in this pull.');

		const karmaless: Analysis = { ...cleave, karma: { ...cleave.karma, casts: 0, uses: [] } };
		expect(notes(render(TouchOfKarma, karmaless))[0]).toBe(
			'Touch of Karma was never pressed, and the pull allowed 3 uses.',
		);

		const fillerless: Analysis = { ...cleave, filler: { ...cleave.filler, casts: 0, castList: [] } };
		expect(notes(render(TigerPalm, fillerless))[0]).toBe('Tiger Palm was never pressed in this pull.');

		// The ability rows are emptied alongside the global count, because on this section the two cannot
		// disagree: `gcdSlots` is derived from the span the player was on a target, so a pull with presses
		// always has globals. Leaving `cleave`'s rows in place would witness an impossible pull. Only the
		// opening is pinned — the two method notes under it are printed on every pull, graded or not.
		const globalless: Analysis = { ...cleave, casts: [], cpm: { ...cleave.cpm, gcdSlots: 0 } };
		const rate = prose(render(CastsPerMinute, globalless))[1] ?? '';
		expect(rate.startsWith('Too few globals passed to measure a rate.'), rate).toBe(true);
		expect(rate).not.toMatch(/casts per minute/);
	});

	/**
	 * And `tigerPalm`'s thin-sample sentence, on the committed pull that reaches it.
	 *
	 * The one place in this spec where the split is already load-bearing on a real capture rather than on
	 * a hand edit: `cleave` made twelve Tiger Palm presses and only two of them with one enemy up, which
	 * is under the floor, so the section has no letter and prints the sentence that names both counts —
	 * over the twelve presses the cards above it total.
	 */
	it('is not the sentence Tiger Palm gives a pull whose sample is thin', () => {
		const sentence = verdictOf(render(TigerPalm, cleave));
		expect(sentence).not.toContain('Tiger Palm was never pressed in this pull.');
		expect(sentence).toContain('only 2 of your 12 presses went out with one enemy up');
		expect(sentence).toContain('too few to read the habit from');
	});
});

/**
 * The third defect in the family, and one level deeper than the two above.
 *
 * Those were sentences that *described* a metric the scorer had already refused. This is a grade the
 * scorer should have refused and did not: `karmaEmpty` was a share of the presses that redirected
 * nothing over the presses taken, built with `sharePct`, which declines only at a denominator of
 * nought. So the share had no sample floor, and one empty Touch of Karma press graded the pull `bad`
 * off a denominator of one.
 *
 * `MIN_GRADED_SAMPLE`'s own argument applies to it exactly: at one press the reachable values are
 * nought and a hundred, at two they are nought, fifty and a hundred, and neither scale has an interior.
 * What makes it the worst-placed of the shares that were missing a floor is the cooldown — ninety
 * seconds on a pull of a few minutes means being under the floor is the *typical* case rather than the
 * exceptional one. Every witness below is a committed capture; none is hand-edited.
 *
 * Two sentences came off it, not one, and that is why the arm is reached by name rather than off the
 * section's letter. This section holds a second metric, so a refusal and a missing letter are not the
 * same event in either direction — see the two tests that separate them.
 */
describe('a Windwalker pull with too few Touch of Karma presses to read a share off', () => {
	/**
	 * The whole-pull letters, before and after, and they are the same six.
	 *
	 * Written out rather than compared to themselves, so the claim is checkable against the commit
	 * message rather than tautological. Both halves of each entry matter: the letter, and the weight it
	 * was taken over — a metric dropping out of the denominator would move the second even where it left
	 * the first alone. Neither moves, because `karmaEmpty` offers nought weight.
	 */
	const HEADLINES = {
		cleave: 'good over 11 of 14',
		mixed: 'ok over 15 of 15',
		poor: 'bad over 15 of 15',
		strong: 'good over 15 of 15',
		waves: 'ok over 14 of 14',
		weave: 'good over 14 of 15',
	};

	const NEVER_PRESSED = 'Touch of Karma was never pressed, and the pull allowed';
	const TOO_FEW_PRESSES = 'too few presses to tell a habit from a coincidence';
	const CLEAN_SHEET = 'Every press ran while damage was actually coming in.';
	const WORTH_FAR_LESS = 'Those presses returned far less than they were worth';

	const karmaOf = (analysis: Analysis) =>
		WINDWALKER.score(analysis, resolveBands(analysis.targets, 'auto')).sections.karma;
	const emptyShare = (analysis: Analysis) => karmaOf(analysis)?.metrics.find((m) => m.key === 'karmaEmpty');

	/**
	 * The premise, and it is the finding rather than a preamble: four of the six committed pulls were
	 * being graded on a sample the rest of the app would have refused, and two of them were graded `bad`
	 * off a single quiet press. Written out so a re-capture that moves a press count fails here, where
	 * the reason is, rather than turning a no-change row below into a test of a pull it was not written
	 * for.
	 */
	it('is where a ninety-second cooldown leaves five of the six committed pulls', () => {
		expect(MIN_GRADED_SAMPLE).toBe(3);
		const presses = Object.fromEntries(FIXTURES.map((name) => [name, fixture(name).karma.casts]));
		expect(presses).toEqual({ cleave: 2, mixed: 3, poor: 3, strong: 2, waves: 1, weave: 1 });

		const thin = FIXTURES.filter((name) => (presses[name] ?? 0) < MIN_GRADED_SAMPLE);
		expect(thin).toEqual(['cleave', 'strong', 'waves', 'weave']);
		// And the numerators those four were graded on. One empty press decided two of them.
		const empties = Object.fromEntries(
			thin.map((name) => [name, fixture(name).karma.uses.filter((use) => use.reflected === 0).length]),
		);
		expect(empties).toEqual({ cleave: 1, strong: 1, waves: 0, weave: 0 });
	});

	/** The refusal itself, on every committed pull under the floor and on neither of the two above it. */
	it('refuses the share on the four pulls under the floor and grades the two above it', () => {
		for (const name of ['cleave', 'strong', 'waves', 'weave'] as const) {
			const metric = emptyShare(fixture(name));
			expect(metric?.unmeasurable, `${name} still grades a share off ${fixture(name).karma.casts} presses`).toBe(true);
			// The denominator is published with the value, which is what let the floor apply at all.
			expect(metric?.sampleSize, name).toBe(fixture(name).karma.casts);
		}
		for (const [name, value, grade] of [
			['mixed', 0, 'good'],
			['poor', 0, 'good'],
		] as const) {
			const metric = emptyShare(fixture(name));
			expect(metric?.unmeasurable, name).toBe(false);
			expect(metric?.value, name).toBe(value);
			expect(metric?.grade, name).toBe(grade);
		}
	});

	/**
	 * The grade that moved, and the sentence that moved with it.
	 *
	 * `strong` and `cleave` each took two presses and each left one of them on a quiet stretch, which is
	 * a share of fifty percent and, on this metric's line, a `bad`. Two presses cannot tell a habit from
	 * the fight's own timing, and the sentence printed at that letter told the reader their presses were
	 * worth far less than they should have been.
	 */
	it('does not tell a pull that pressed twice that both presses were worth far less', () => {
		for (const name of ['strong', 'cleave'] as const) {
			const analysis = fixture(name);
			expect(analysis.karma.casts, name).toBe(2);
			const sentence = verdictOf(render(TouchOfKarma, analysis));
			expect(sentence, name).not.toContain(WORTH_FAR_LESS);
			expect(sentence, name).toContain(TOO_FEW_PRESSES);
			// The presses, the charges and the damage are facts the refusal does not touch, so the arm keeps
			// the opening clause every graded arm here shares.
			expect(sentence, name).toContain(`2 of ${analysis.karma.available} uses taken`);
			noRawKey(sentence);
		}
	});

	/**
	 * The first reason the arm is reached by name: on some pulls the refusal takes the letter with it.
	 *
	 * `cleave` and `waves` never demonstrated a health pool, so `karmaCapShare` is unmeasurable too and
	 * the whole section is — `gradeOf` answers `none` and `verdict()` reaches the never-pressed sentence,
	 * printed directly under a table with a row for every press. The same fold the two sections above
	 * had, arrived at from the scorer's side.
	 *
	 * **This one is a falsehood the floor would have *introduced*, not one it inherits**, and saying so is
	 * the point rather than a caveat: before the floor these two had a letter and printed a graded
	 * sentence. Put the floor in without the arm and `cleave` reads "Touch of Karma was never pressed, and
	 * the pull allowed 3 uses. One press redirected nothing at all" — two sentences contradicting each
	 * other in one paragraph, over a table of two presses. Which is why the arm and the floor are one
	 * change and not two.
	 */
	it('does not tell a pull it never pressed the button it has a table of presses for', () => {
		for (const name of ['cleave', 'waves'] as const) {
			const analysis = fixture(name);
			expect(karmaOf(analysis)?.unmeasurable, `${name} keeps a letter, so this pull tests the wrong route`).toBe(true);
			const sentence = verdictOf(render(TouchOfKarma, analysis));
			expect(sentence, name).not.toContain(NEVER_PRESSED);
			// `waves` reached the plain sentence only after the floor took its letter away; before that it
			// was handed a clean sheet off its single press, which the arm must not print either.
			expect(sentence, name).not.toContain(CLEAN_SHEET);
			expect(sentence, name).toContain(TOO_FEW_PRESSES);
			noRawKey(sentence);
		}
	});

	/**
	 * The second reason, and the one the section's letter could not catch at the time.
	 *
	 * `weave` took a single press, and that press drained its pool — which is what states the pool, so
	 * `karmaCapShare` read a hundred percent and handed the section a `good` all by itself. The section
	 * was *not* unmeasurable, `gradeOf` never said `none`, and the arm chosen at that letter asserted
	 * that every press ran while damage was coming in: the exact reading the scorer had just refused,
	 * claimed off a sample of one. A letter this arm was chosen by would have left this one standing.
	 *
	 * **The letter has since gone, and the arm did not have to move with it — which is the argument for
	 * choosing it by name made twice.** `karmaCapShare` carries a press floor of its own now: its
	 * ceiling is the largest absorb on the pull, so the share cannot read below one over the presses
	 * taken and the whole bad end of its scale is out of reach under three of them. Both metrics here
	 * are refused at one press, so the section is unmeasurable and the two no longer come apart on a
	 * pull this thin. The sentence below is unchanged through that, because it never read the letter.
	 */
	it('does not claim a clean sheet off a single press', () => {
		const analysis = fixture('weave');
		expect(analysis.karma.casts).toBe(1);
		const section = karmaOf(analysis);
		expect(section?.grade, 'the letter this arm used to be chosen by, since withdrawn').toBe('ok');
		expect(section?.unmeasurable, 'both metrics are refused at one press, so the section is too').toBe(true);

		const sentence = verdictOf(render(TouchOfKarma, analysis));
		expect(sentence).not.toContain(CLEAN_SHEET);
		expect(sentence).toContain(TOO_FEW_PRESSES);
		noRawKey(sentence);
	});

	/**
	 * And the half the floor must not take away: the count of empty presses is an observation, not a
	 * share, so it survives the refusal.
	 *
	 * `TouchOfKarma` chooses that sentence off the press count and never off the letter, which is why it
	 * still prints on `strong` beside a refused share. What the floor withdraws is the generalisation
	 * from one press to a habit — not the press.
	 */
	it('still says the empty press happened on the pull whose share it refuses', () => {
		const drawn = render(TouchOfKarma, fixture('strong'));
		expect(prose(drawn).join(' ')).toContain('One press redirected nothing at all');
		// And the tile that took its colour from the refused share goes neutral rather than staying red,
		// which is the second thing a reader can see change. `TouchOfKarma` already reads the metric rather
		// than the section for this, so the floor reaches it without the component being touched — the tile
		// beside it, which takes its tone from a wide press-count band and never from a graded metric,
		// stays exactly as it was.
		expect(tileTone(drawn, 'Presses that landed')).toBe('line');
		expect(tileTone(drawn, 'Uses taken'), 'an ungraded tone, so this one must not move').toBe('miss');
	});

	/**
	 * The no-change guard: the two pulls with a sample worth reading keep their letters and sentences.
	 *
	 * Three presses is the floor exactly, and both of these clear it with nothing empty, so both grade
	 * `good` on the share and print the clean-sheet sentence they printed before. A fix that reached past
	 * the floor and silenced a real reading fails here.
	 */
	it('leaves the two pulls above the floor alone', () => {
		// Each pull's own opening rather than one shared clause, because the two reach different letters:
		// neither left a press on a quiet stretch, so both grade `good` on the share, and it is the *other*
		// metric that separates them — `poor` returned 95.8% of its ceiling and `mixed` 64.4%.
		for (const [name, opening] of [
			['mixed', 'Only part of their potential came back'],
			['poor', CLEAN_SHEET],
		] as const) {
			const analysis = fixture(name);
			expect(analysis.karma.casts, name).toBe(MIN_GRADED_SAMPLE);
			const sentence = verdictOf(render(TouchOfKarma, analysis));
			expect(sentence, name).toContain(opening); // no-change guard
			expect(sentence, name).not.toContain(TOO_FEW_PRESSES);
			noRawKey(sentence);
		}
	});

	/**
	 * Weight nought, so no letter on the page above the section moves with it.
	 *
	 * The whole-pull verdict renormalises over the weight it could measure, and a metric offering nought
	 * weight contributes to neither side of that fraction whether it is refused or not. Asserted rather
	 * than reasoned about, because it is the claim the commit message makes about the headline.
	 */
	it('moves no whole-pull letter, because the metric carries no weight', () => {
		expect(WEIGHTS.karmaEmpty).toBe(0);
		const headline = Object.fromEntries(
			FIXTURES.map((name) => {
				const analysis = fixture(name);
				const card = WINDWALKER.score(analysis, resolveBands(analysis.targets, 'auto'));
				return [name, `${card.overall} over ${card.judged?.measured} of ${card.judged?.total}`];
			}),
		);
		expect(headline).toEqual(HEADLINES);
	});
});
