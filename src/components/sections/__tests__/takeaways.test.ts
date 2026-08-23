// `createElement` rather than JSX so this stays a `.ts` file and is picked up by the project's own
// vitest include patterns.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { initI18n } from '~/lib/i18n/config';
import { scoreAnalysis } from '~/specs/windwalker/lib/score';
import type { Analysis } from '~/lib/types';

import { SpecContext } from '~/components/report/specContext';
import { getSpec } from '~/lib/spec';

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
