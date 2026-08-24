// `createElement` rather than JSX so this stays a `.ts` file and is picked up by the project's own
// vitest include patterns.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { capturedAnalyses, rawFixtures } from '~/lib/analysis/fixtures';
import i18n, { initI18n } from '~/lib/i18n/config';
import { scoreAnalysis } from '~/specs/windwalker/lib/score';
import type { Analysis } from '~/lib/types';

import { SpecContext } from '~/components/report/specContext';
import { getSpec, SPECS, type SpecDefinition } from '~/lib/spec';
import type { Scorecard } from '~/lib/score';

import Takeaways from '../Takeaways';

// Every fixture below is a Windwalker pull, so the section is rendered under the Windwalker's own
// scorer and copy. Named rather than left to `SpecContext`'s default, which is the build's pinned
// `DEFAULT_SPEC` — under `PUBLIC_SPEC=elemental` that scored these monk fixtures with the Shaman's
// thresholds.
const WINDWALKER_SPEC = getSpec('windwalker')!;
const asWindwalker = (node: ReactNode): ReactElement =>
	createElement(SpecContext.Provider, { value: WINDWALKER_SPEC }, node);

initI18n();

const fixture = (name: string): Analysis =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../specs/windwalker/__fixtures__/${name}.json`), 'utf8'));

/**
 * Each spec's own fixtures, discovered and classified by shape rather than listed.
 *
 * The Windwalker's are mostly captured `analyse()` output and load straight as an `Analysis`; the
 * Elemental's are raw `FightDataset` captures and have to go through the spec's own `analyse` first.
 * That distinction used to be a hand-written `analysed: boolean` beside a hand-written list of names,
 * with the comment "named rather than sniffed, because a fixture whose shape is guessed wrongly reads
 * as a spec bug" — but `lib/analysis/fixtures.ts` does not guess. It classifies on `events` + `actor`
 * against `casts` + `actorID` and **throws by name** on a `.json` that answers to neither, which is a
 * louder failure than a stale literal produces and does not need editing when the directory grows.
 *
 * **The literal it replaced was `['unbroken', 'cleave', 'phased']` for the Elemental**, so the sweep
 * below — which exists because `brewShortUses` reached a reader as a raw dotted i18n key — had never
 * been run over `addsThenBoss`, the pull that deals the most cards in the directory. It also picks up
 * `windwalker/dataset-ironJuggernaut.json`, a raw monk pull the six-name list left out entirely.
 */
const specFixtures = (spec: SpecDefinition): Array<{ name: string; analysis: () => Analysis }> => [
	...rawFixtures(spec.key).map(({ name, dataset }) => ({ name, analysis: () => spec.analyse(dataset) })),
	...capturedAnalyses(spec.key).map(({ name, analysis }) => ({ name, analysis: () => analysis })),
];

/**
 * The card headings, which are the only part of the block that names a metric.
 *
 * Anchored to the list item rather than to the label's classes. It matched `uppercase text-muted`
 * anywhere in the markup until the block gained a heading of its own wearing the same two utilities,
 * at which point the heading counted as a fourth card and the cap test failed for a reason that had
 * nothing to do with the cap. A card is a card because it is one of the `<li>`s, not because of how
 * its label is styled.
 */
function cards(analysis: Analysis): string[] {
	const html = renderToStaticMarkup(asWindwalker(createElement(Takeaways, { analysis })));
	return [...html.matchAll(/<li\b[^>]*>.*?<span[^>]*uppercase text-muted">([^<]+)</gs)].map((m) => m[1] ?? '');
}

/**
 * The summary's short list is derived from the same scorecard the sections below it read, which is
 * the whole point of it — a hand-written list of common mistakes would drift out of agreement with
 * the report the first time a threshold moved. So what is worth pinning is not the wording but the
 * relationship: never more than three, never a metric the pull passed, never one the model does not
 * count, and worse grades ahead of better ones.
 */
describe('the summary takeaways', () => {
	it('never gives more than three', () => {
		for (const name of ['strong', 'mixed', 'poor']) {
			expect(cards(fixture(name)).length).toBeLessThanOrEqual(3);
		}
	});

	it('names nothing the pull already passed', () => {
		// Every card has to correspond to a metric that scored below `good`; a summary that opens by
		// telling someone to fix something they did well is worse than no summary.
		for (const name of ['strong', 'mixed', 'poor']) {
			const analysis = fixture(name);
			const below = Object.values(scoreAnalysis(analysis).sections)
				.flatMap((s) => s.metrics)
				.filter((m) => !m.unmeasurable && m.grade !== 'good').length;
			expect(cards(analysis).length).toBeLessThanOrEqual(below);
		}
	});

	it('leads with the worst pull and says least about the best', () => {
		// Not an assertion about which metrics appear — those move whenever a threshold does — but about
		// the ordering the whole block exists to express.
		expect(cards(fixture('poor')).length).toBeGreaterThanOrEqual(cards(fixture('strong')).length);
	});

	/**
	 * Snapshot depth is measured, shown, and carries zero weight because it is inverted in practice —
	 * it averages only the procs that were caught, so catching fewer can improve it. A card telling a
	 * reader to fix it would be advice to catch fewer procs, which is why weight zero is filtered out
	 * rather than merely sorted last.
	 */
	it('never advises fixing a metric the model does not count', () => {
		const analysis = fixture('strong');
		expect(cards(analysis)).not.toContain('Snapshot depth');
	});

	/**
	 * The guard this block did not have, and the defect that proved it was needed.
	 *
	 * Every card's two lines are looked up at `summary.takeaways.metric.<metric.key>.{label,fix}` — a
	 * key computed from the scorecard, so `keys.test.ts`'s literal scan cannot see it and i18next
	 * renders a missing one as the dotted key itself, in a card at the top of the report. `brewShortUses`
	 * landed as a graded metric with weight 1 and no copy at all, and `strong` deals it a card: the
	 * suite was green with `summary.takeaways.metric.brewShortUses.label` printed at a reader.
	 *
	 * Scanned rather than listed, over every spec and every fixture, so a metric added with weight and
	 * no copy fails by the fact of being added. Weight zero and `unmeasurable` are skipped because
	 * `Takeaways` skips them — a metric that can never deal a card needs no card copy, and demanding it
	 * would be a list of strings nobody reads.
	 */
	it('has both lines of copy for every metric that can deal a card', () => {
		const t = i18n.getFixedT('en', 'report');
		// Each spec over its own captures — a monk pull scored by the Shaman's thresholds is not a
		// reading of anything, which is the same trap `asWindwalker` above exists for. Asserted against
		// the registry so a third spec has to name its fixtures here rather than silently contributing
		// none.
		let swept = 0;
		const missing: string[] = [];
		for (const spec of SPECS) {
			const fixtures = specFixtures(spec);
			// A spec contributing nothing is the failure mode the registry assertion used to guard against,
			// and discovery has to guard it too: an empty directory would sweep zero metrics and pass.
			expect(fixtures.length, `${spec.key} has fixtures to sweep`).toBeGreaterThan(0);
			for (const { analysis } of fixtures) {
				swept += 1;
				const card = spec.score(analysis());
				const weights = spec.weightsFor(null);
				for (const score of Object.values(card.sections)) {
					for (const metric of score.metrics) {
						if (metric.unmeasurable || (weights[metric.key] ?? 0) === 0) continue;
						for (const part of ['label', 'fix'] as const) {
							const key = `summary.takeaways.metric.${metric.key}.${part}`;
							if (t(key) === key) missing.push(key);
						}
					}
				}
			}
		}
		expect([...new Set(missing)].sort()).toEqual([]);
		// Fourteen: four Elemental pulls and ten Windwalker ones. It was eleven until three raw Windwalker
		// datasets were committed to give the segment work a pull with more than one target mode in it —
		// Galakras, Immerseus and a heroic Malkorok — and nine before that, when two literals named the
		// fixtures instead of the directory being walked.
		// Pinned so a fixture leaving the directory shows up as a number rather than as a quieter sweep.
		expect(swept).toBe(14);
	});

	it('says so plainly when there is nothing to fix', () => {
		// A pull nothing can be measured on: no procs to catch, no brews spent, no globals, no kicks,
		// no fillers. Every metric goes unmeasurable, so there is no short list — and the block has to
		// say that rather than render an empty grid, because an empty grid reads as a rendering fault.
		const quiet = structuredClone(fixture('poor'));
		quiet.procs.opportunities = 0;
		quiet.procs.snapshotted = 0;
		quiet.brew.uses = 0;
		quiet.brew.maxStacks = 0;
		// And the drains themselves, which is what "no brews spent" actually means. `brewShortUses` reads
		// the use list rather than the summary count, so a list left populated beside `uses = 0` is a
		// pull that both did and did not brew.
		quiet.brew.useList = [];
		quiet.cpm.gcdSlots = 0;
		quiet.debuff.casts = 0;
		quiet.filler.casts = 0;

		expect(cards(quiet)).toEqual([]);
		const html = renderToStaticMarkup(asWindwalker(createElement(Takeaways, { analysis: quiet })));
		expect(html).toContain('no short list');
	});
});

/**
 * What the `good` heading is allowed to call the cards under it.
 *
 * `summary.takeaways.title_good` was "Key refinements", printed as KEY REFINEMENTS over a grid whose
 * cards are drawn from the metrics that scored worst — and one of them can be `bad`, with the red left
 * border this block already draws for it. That is the same defect as `overall.good`'s old third clause
 * ("The notes below are small refinements, not real mistakes") one line further down the page: a claim
 * about the size of a fault, made by a letter that never looked at it.
 *
 * `strong` is the proof and it is committed. `good` over **15 of 15** points — nothing unread, so this
 * is the worst case the letter permits with nothing excused — and its leading card is `brewShortUses`,
 * graded `bad`, whose copy tells the reader they spent brews with the bank under ten and to hold for
 * the tenth stack. A reader of that pull was handed a red card headed "refinements".
 *
 * The heading now says the same thing the sentence above it says, in the same voice: a strong pull can
 * still be holding something worth fixing. It does not tell a clean pull it played badly — `still` is
 * what carries that — and it makes no claim at all about how large the fault is, which is the claim
 * that was false.
 */
describe('the good takeaways heading does not shrink the cards under it', () => {
	const t = i18n.getFixedT('en', 'report');

	it('is printed over a card the same scorecard grades bad', () => {
		const strong = fixture('strong');
		const card = scoreAnalysis(strong);
		expect(card.overall).toBe('good');
		expect(card.judged).toEqual({ measured: 15, total: 15, unmeasurable: false });
		const html = renderToStaticMarkup(asWindwalker(createElement(Takeaways, { analysis: strong })));
		// `border-l-miss` is the red edge `Takeaways` draws from a card's own `bad` grade; `border-l-brew`
		// is the amber one. Both are in this markup, which is the whole point.
		expect(html).toContain('border-l-miss');
		expect(html).toContain(t('summary.takeaways.title_good'));
	});

	/** The claim itself, named, so it cannot come back in a rewrite. */
	it('calls a red card nothing smaller than it is', () => {
		const title = t('summary.takeaways.title_good').toLowerCase();
		for (const shrink of ['refinement', 'minor', 'small', 'tweak', 'polish', 'nitpick']) {
			expect(title, shrink).not.toContain(shrink);
		}
	});

	/**
	 * The property rather than the phrasing: the heading and the sentence above it are one voice. Both
	 * hold that a strong average can be hiding something real, and the word that does it in both is
	 * `still` — so a lane that softens one of them has to look at the other.
	 */
	it('speaks in the same voice as the sentence above it', () => {
		expect(t('summary.takeaways.title_good')).toContain('Still');
		expect(t('overall.good')).toContain('a strong average can still hold a habit that cost you real damage');
	});
});

/**
 * What heads the branch with no cards under it.
 *
 * `summary.takeaways.title` was read by *both* branches of this block, so whichever heading the letter
 * chose was printed over the grid and over the note that stands in for it. All three readings are claims
 * about cards — "Key improvements", and since the lane above this one "Still worth fixing" — and the note
 * they were printed over is `summary.takeaways.clean`: *"Nothing came out below its target, so there is no
 * short list to give you."* The previous lane named this and left it, because one key served both
 * branches and separating them needed a component change and a fourth arm. This is that.
 *
 * The two pulls below are the two ways the branch is reached, and the heading has to be the same on both:
 * a pull whose metrics went unmeasurable, which is committed copy of `poor` with its inputs emptied, and
 * a pull the scorecard calls `good` with nothing under its targets — the reading the lane above this one
 * made loud, and the one no fixture produces, so it is a scorecard handed in directly.
 */
describe('the takeaways heading over a short list with nothing on it', () => {
	const t = i18n.getFixedT('en', 'report');

	/** `poor` with every input the metrics read emptied — the same pull the block above builds. */
	function quiet(): Analysis {
		const pull = structuredClone(fixture('poor'));
		pull.procs.opportunities = 0;
		pull.procs.snapshotted = 0;
		pull.brew.uses = 0;
		pull.brew.maxStacks = 0;
		pull.brew.useList = [];
		pull.cpm.gcdSlots = 0;
		pull.debuff.casts = 0;
		pull.filler.casts = 0;
		return pull;
	}

	/**
	 * A `good` pull with nothing below its target, which no committed fixture is.
	 *
	 * `strong` is `good` over 15 of 15 and deals three cards; every other fixture deals cards too. The
	 * branch needs a card list that comes out empty *and* a `good` letter over it, so the card is handed in
	 * rather than derived — one metric, measured, `good`, which is exactly what a pull with nothing to fix
	 * scores. The analysis is cloned because `useReportCopy` memoises one card per analysis, spec and
	 * reading, and a shared fixture object would hand back the real scorecard instead of this one.
	 */
	function goodWithNothingToFix(): { analysis: Analysis; spec: SpecDefinition } {
		const card: Scorecard = {
			overall: 'good',
			judged: { measured: 15, total: 15, unmeasurable: false },
			sections: {
				tigerPalm: {
					metrics: [
						{
							key: 'tigerPalmWaste',
							good: 5,
							ok: 15,
							higherIsBetter: false,
							unit: 'percent',
							value: 0,
							grade: 'good',
							unmeasurable: false,
						},
					],
					primary: [
						{
							key: 'tigerPalmWaste',
							good: 5,
							ok: 15,
							higherIsBetter: false,
							unit: 'percent',
							value: 0,
							grade: 'good',
							unmeasurable: false,
						},
					],
					unmeasurable: false,
					grade: 'good',
				},
			},
		};
		return { analysis: structuredClone(fixture('strong')), spec: { ...WINDWALKER_SPEC, score: () => card } };
	}

	const headingOf = (html: string): string =>
		[...html.matchAll(/<h3[^>]*>([^<]*)<\/h3>/g)].map((m) => m[1] ?? '').join(' ');

	it('says there is nothing below target rather than naming a grade', () => {
		const pull = quiet();
		expect(cards(pull)).toEqual([]);
		const html = renderToStaticMarkup(asWindwalker(createElement(Takeaways, { analysis: pull })));
		expect(html).toContain('no short list');
		expect(headingOf(html)).toBe(t('summary.takeaways.title_clean'));
	});

	/** The loud reading: `good` over an empty grid used to be headed "Still worth fixing". */
	it('does not tell a pull with nothing below target that something is still worth fixing', () => {
		const { analysis, spec } = goodWithNothingToFix();
		const html = renderToStaticMarkup(
			createElement(SpecContext.Provider, { value: spec }, createElement(Takeaways, { analysis })),
		);
		expect(html).toContain('no short list');
		expect(headingOf(html)).toBe(t('summary.takeaways.title_clean'));
		expect(html).not.toContain(t('summary.takeaways.title_good'));
	});

	/** And the no-change guard: the branch that has cards still takes its heading from the letter. */
	it('leaves the heading over a real short list alone', () => {
		const html = renderToStaticMarkup(asWindwalker(createElement(Takeaways, { analysis: fixture('strong') })));
		expect(headingOf(html)).toBe(t('summary.takeaways.title_good')); // no-change guard
		expect(headingOf(html)).not.toBe(t('summary.takeaways.title_clean'));
	});

	/**
	 * The shared voice, extended rather than broken.
	 *
	 * `title_good` and `overall.good` are one voice on purpose, and the word that carries it in both is
	 * `still` — the sibling block above pins both so that a lane softening one has to look at the other.
	 * The empty heading is the one place that voice must *not* reach: there is no habit to hold and nothing
	 * to be strong in spite of, so `still` is the word that cannot appear in it. Pinned from the other side
	 * for the same reason the pair above is pinned from theirs — collapsing the two headings back onto one
	 * key is exactly the change this block was written to stop, and it would show up here first.
	 */
	it('keeps `still` out of the heading that has nothing to hold', () => {
		expect(t('summary.takeaways.title_clean').toLowerCase()).not.toContain('still');
		expect(t('summary.takeaways.title_clean')).not.toBe(t('summary.takeaways.title'));
		expect(t('summary.takeaways.title_clean')).not.toBe(t('summary.takeaways.title_good'));
		// The link the sibling block holds, restated from here so neither can be softened alone.
		expect(t('summary.takeaways.title_good')).toContain('Still'); // no-change guard
	});
});
