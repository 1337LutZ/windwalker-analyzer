// The Snapshots tile: `1/1` over a table of six rows, and what the two numbers owe each other.
//
// **Not false, which is why nothing had caught it.** The tile counts the windows a refresh was taken in
// against the windows there was a refresh to take — `refreshed` over `refreshed + missed` — and that
// pair is the exact quotient `flameShockSnapshots` grades and the exact `offered` the sentence under the
// table prints. Three numbers, one denominator, no drift. What a reader sees, though, is a `1` above six
// listed rows, reconcilable only by reading past the table to a sentence that explains it after the
// fact.
//
// **The sibling precedent, and which of its three parts applies.** A Windwalker snapshot tile was found
// yesterday drawing `lastGcd / procs` in a tint borrowed from `snapshotDepth`, a metric that runs
// backwards against it. Three things happened to it:
//
//   1. The tint came off — *"plain ink, for the reason DPS is plain ink — there is no threshold behind
//      the figure, and a colour would invent a verdict the report never makes."*
//   2. The denominator moved to `opportunities`, the figure its own section argues from, because
//      counting the unbuyable ones *"would tell the reader they missed something unbuyable"*.
//   3. `snapshots.unaffordable` names the gap out loud — *"the reader can see the proc on the chart, so a
//      denominator smaller than the proc count has to explain itself."*
//
// **This tile was already past the first two and had not done the third.** It carries no `grade` prop
// and there is no second metric in this section to have borrowed one from, so it has been plain ink from
// the day it landed — untested, which is why it is pinned below rather than left to the absence of a
// prop. And its denominator is already the one the section argues from; moving it to `windows.length`
// would be reintroducing the Windwalker's retired defect rather than following its fix. So the change is
// the third part alone: a caption that reconciles the two numbers where they sit.
//
// **The witnesses.** `addsThenBoss` is the real one and the only committed pull that makes the gap — six
// windows fired, one was claimable, because the primary is untargetable for 442 of the pull's 560
// seconds and five of the six opened with the dot already down. The other three committed pulls wear no
// trigger trinket and list nothing, so they are the no-caption side of the same guard. Two synthetic
// audits at the end move `refreshed`/`missed` on `addsThenBoss` to reach the plural boundary and the
// no-gap case, and each says which field it moved.
//
// `createElement` rather than JSX so this stays a `.ts` file and is picked up by the project's own
// vitest include patterns, as its siblings do.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { rawFixtures } from '~/lib/analysis/fixtures';
import i18n, { initI18n } from '~/lib/i18n/config';
import { getSpec } from '~/lib/spec';
import { resolveBands, type TargetModeChoice } from '~/lib/view/targetMode';
import type { Analysis, ElementalAuditResult } from '~/lib/types';

import { ScoreViewContext } from '~/components/report/scoreViewContext';
import { SpecContext } from '~/components/report/specContext';
import { analyse } from '~/specs/elemental/lib';

import Snapshots from '../Snapshots';

const ELEMENTAL_SPEC = getSpec('elemental')!;
initI18n();
const t = i18n.getFixedT('en', 'report');

type El = Analysis & ElementalAuditResult;

/** Every raw Elemental pull, found rather than listed — `thinSnapshotSample.test.ts`'s own discovery. */
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

/** One tile, found by the label it carries — `brewBankTimeline.test.ts`'s reader for the same job. */
const tile = (html: string, label: string) => {
	const chunks = html.split('class="border-l-2').slice(1);
	const found = chunks.find((chunk) => chunk.includes(label));
	if (found === undefined) throw new Error(`no tile labelled ${label}`);
	return { classes: found.slice(0, found.indexOf('"')), markup: found.slice(0, found.indexOf('</div>')) };
};

const CAUGHT = 'Windows caught';
const adds = analysed('addsThenBoss');

/** `addsThenBoss` with only the two claimable counts moved, and the window list left alone. */
const withClaimable = (refreshed: number, missed: number): El =>
	({ ...adds, snapshots: { ...adds.snapshots, refreshed, missed } }) as El;

describe('the Snapshots tile against the table under it', () => {
	/**
	 * The premise, per pull, so nothing below is vacuous — and so the one pull that makes the gap is named
	 * rather than assumed. Both counts, because the whole subject is that they can disagree.
	 */
	it('is one pull of four whose listed windows outnumber its claimable ones', () => {
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
	});

	/** The denominator, asserted as the quotient the scorer grades and not as a literal. */
	it('divides by the windows the section grades over, not by the windows it lists', () => {
		const { markup } = tile(render(adds), CAUGHT);
		const { refreshed, missed, windows } = adds.snapshots;
		expect(markup).toContain(`>${refreshed}<`);
		expect(markup).toContain(`/${refreshed + missed}`);
		// Named the other way round too, so this cannot pass by the two counts happening to coincide.
		expect(markup).not.toContain(`/${windows.length}`);
		expect(refreshed + missed).not.toBe(windows.length);
	});

	/**
	 * Plain ink, on every committed pull and every reading.
	 *
	 * `border-l-line` is what `gradeClass('edge', null)` draws. Asserted rather than assumed from the
	 * missing prop, because the prop is one edit away and the argument for its absence lives in a comment.
	 */
	it.each(FIXTURES.flatMap((name) => (['auto', 'single', 'multi'] as const).map((c) => [name, c] as const)))(
		'leaves the tile ungraded on %s at the %s reading',
		(name, choice) => {
			expect(tile(render(analysed(name), choice), CAUGHT).classes).toContain('border-l-line');
		},
	);

	/**
	 * The change: the gap is named where the two numbers meet, instead of only after the table.
	 *
	 * Five, because six were listed and one was a chance — so the caption and the fraction add back up to
	 * the row count a reader can see.
	 */
	it('says how many of the listed windows were never chances', () => {
		const { markup } = tile(render(adds), CAUGHT);
		expect(markup).toContain(t('flameShockSnapshots.kpi.notClaimable', { count: 5 }));
		expect(markup).toContain('5 more opened with the dot down');
	});

	/** And says nothing when there is nothing to reconcile, on the three pulls that list no windows. */
	it.each(FIXTURES.filter((name) => name !== 'addsThenBoss'))('adds no caption on %s', (name) => {
		expect(tile(render(analysed(name)), CAUGHT).markup).not.toContain('opened with the dot down');
	});

	/**
	 * The singular, which the plural boundary reaches at two listed windows against one claimable. Moved
	 * on the audit rather than on the copy, so the arm is chosen by i18next off the count the component
	 * passes. Synthetic: `addsThenBoss` with four of its six windows dropped and nothing else changed.
	 */
	it('agrees in number at one unclaimable window', () => {
		const twoListed = {
			...adds,
			snapshots: { ...adds.snapshots, windows: adds.snapshots.windows.slice(0, 2) },
		} as El;
		const { markup } = tile(render(twoListed), CAUGHT);
		expect(markup).toContain('one more opened with the dot down');
		expect(markup).not.toContain('1 more opened');
	});

	/**
	 * And no caption when every listed window was a chance, which is the state the gap does not exist in.
	 * Synthetic: `addsThenBoss` with its six windows all claimable and five of them missed.
	 */
	it('adds no caption when every window in the table was a chance', () => {
		const { markup } = tile(render(withClaimable(1, 5)), CAUGHT);
		expect(markup).toContain('/6');
		expect(markup).not.toContain('opened with the dot down');
	});
});
