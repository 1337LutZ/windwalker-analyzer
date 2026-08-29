// One press, and the three places the Flame Shock section talks about it.
//
// `c93b866` moved `flameShockWaste`'s denominator to the refreshes a single-target list asked the
// question at; `a4936c7` made the depth chart follow, greying the rows that left. For one commit the
// section then said three different things about `cleave`'s refresh at 57 499ms with four enemies up:
// the chart greyed it ("More than one enemy, not measured"), the sentence beneath charged it ("1
// refreshes threw away a tick"), and the press table tinted its row `bg-band-warn`. A reader saw grey
// meaning "we did not judge this" beside prose and a highlight that both say "you got this wrong".
//
// What the three surfaces settled on:
//
//   - The chart draws every refresh, because it is a picture of what the dot did. Unchanged.
//   - The metric grades band 1 alone, because that is the only count its rule is a rule at. Unchanged,
//     and `MIN_GRADED_SAMPLE` still refuses `cleave` at a sample of one. Not this file's subject.
//   - The **sentence** names both: the pull-wide count first, because a press that clipped a tick
//     clipped a tick and `8e011ac`'s rule is that an unmeasured figure is not a deleted one, then a
//     clause saying how much of that count is measured.
//   - The table's **highlight** gives way, on plan §80's Stormlash precedent — a red cell cannot say
//     which of two things it means. Its words stay and gain the chart's own "not measured".
//
// Asserted on `cleave`, which is the only committed fixture where the two ledgers differ
// (`unjudgedRefreshes` 1, `unjudgedWaste` 1). `phased` and `unbroken` never leave one enemy, are 0 on
// both, and are the deliberate no-change guards: every assertion about them below has to read exactly
// what it read before this change.
//
// `createElement` rather than JSX so this stays a `.ts` file and is picked up by the project's own
// vitest include patterns.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import i18n, { initI18n } from '~/lib/i18n/config';
import { getSpec } from '~/lib/spec';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';

import { SpecContext } from '~/components/report/specContext';
import { analyse } from '~/specs/elemental/lib';

import FlameShock from '../FlameShock';

const ELEMENTAL_SPEC = getSpec('elemental')!;

initI18n();
const t = i18n.getFixedT('en', 'report');

type El = Analysis & ElementalAuditResult;

const fixtures = new Map<string, El>();
const fixture = (name: string): El => {
	const held = fixtures.get(name);
	if (held) return held;
	const el = analyse(
		JSON.parse(
			readFileSync(resolve(import.meta.dirname, `../../../__fixtures__/${name}.json`), 'utf8'),
		) as FightDataset,
	) as El;
	fixtures.set(name, el);
	return el;
};

const render = (analysis: Analysis) =>
	renderToStaticMarkup(
		createElement(SpecContext.Provider, { value: ELEMENTAL_SPEC }, createElement(FlameShock, { analysis })),
	);

/** The two single-target pulls, whose every refresh is measured and whose copy must not move. */
const SINGLE_TARGET = ['phased', 'unbroken'] as const;

describe('the section says one thing about a refresh it did not measure', () => {
	/**
	 * The premise, so nothing below is vacuous. If a later change moves `cleave`'s ledgers together —
	 * or moves either single-target pull off zero — every assertion here is testing a pull it was not
	 * written for, and this is the assertion that says so rather than passing quietly.
	 */
	it('has one fixture where the two ledgers differ and two where they cannot', () => {
		const cleave = fixture('cleave').flameShock;
		expect([cleave.refreshes, cleave.unjudgedRefreshes, cleave.unjudgedWaste]).toEqual([2, 1, 1]);
		// The pull-wide waste count the sentence leads with, and the graded one it does not.
		expect(cleave.refreshes - cleave.windowed - cleave.ascPrep - cleave.snapshotGain).toBe(1);
		for (const name of SINGLE_TARGET) {
			const fs = fixture(name).flameShock;
			expect([fs.unjudgedRefreshes, fs.unjudgedWaste], name).toEqual([0, 0]);
		}
	});

	/**
	 * The row the whole thread is about: `early` at 57 499ms, four enemies up, `judged: false`.
	 *
	 * `late` presses are checked alongside it deliberately. `cleave` makes four of them, two at band 4,
	 * and they keep their tint — putting the dot back up when it is off the enemy in front of you is the
	 * multi-target order's own first rung, which `flameShock.aoeNote` and `verdict_exempt` both already
	 * tell the reader. So the count of tinted rows drops by exactly one, and a change that dropped the
	 * tint from every unjudged press instead would fail here rather than read as a tidier fix.
	 */
	it('paints no fault colour on the refresh the chart above greys', () => {
		const cleave = fixture('cleave');
		const unmeasured = cleave.flameShock.presses.filter((p) => p.remainingMs !== null && !p.judged);
		expect(unmeasured.map((p) => [p.t, p.kind, p.band])).toEqual([[57_499, 'early', 4]]);

		// Every press that would earn a tint on kind alone, and the one of them that no longer gets it.
		const faulted = cleave.flameShock.presses.filter(
			(p) => p.kind === 'late' || p.kind === 'early' || (p.duringAscendance && p.remainingMs !== null),
		);
		expect(faulted).toHaveLength(5);
		const tinted = faulted.filter((p) => !(p.remainingMs !== null && !p.judged));
		expect(tinted.map((p) => p.kind)).toEqual(['late', 'late', 'late', 'late']);

		// The rendered count, per row rather than per cell: `DataGrid` paints the tint on each of the
		// four columns and again on the card shape it draws below `md`, so the class appears five times
		// for one tinted row. Asserted as a multiple of the row count so the shape of the grid can change
		// without this becoming a pinned magic number.
		const painted = render(cleave).split('bg-band-warn').length - 1;
		expect(painted % tinted.length).toBe(0);
		expect(painted / tinted.length).toBe(5);
	});

	/** The row keeps its words, and gains the chart key's own register for why it is not tinted. */
	it('says on the row itself that the press was not measured, without dropping what it did', () => {
		const html = render(fixture('cleave'));
		expect(html).toContain('Early, a tick thrown away, Not measured above one target');
		// The literal, spelled out rather than fetched with a second `t()` — a test whose two sides both
		// come out of the locale file passes whatever the locale file says.
		expect(t('flameShock.state.unmeasured')).toBe('Not measured above one target');
	});

	/**
	 * The sentence, which names what the dot did and then how much of it counted.
	 *
	 * Both figures are asserted as derivations of the audit rather than as pinned digits: `1` and `1`
	 * here are the same number by coincidence on this pull, and a test that pinned them could not tell
	 * "the count of wasted refreshes" from "the count of them nothing measured".
	 *
	 * **Both sentences are phrased so a count of one is grammatical**, which is why they read "of the
	 * refreshes" and "of them" rather than putting the number in front of a bare plural. `cleave` is the
	 * pull that makes it visible — it reaches this arm at exactly one — and "1 refreshes" was shipping
	 * here, pinned by this test. i18next resolves plurals off a `count` value and neither call site has
	 * one to give, so the fix is the wording rather than a `_one` arm; `flameShock.test.ts` already
	 * documents that pattern.
	 */
	it('names the pull-wide count and then how much of it is measured', () => {
		const cleave = fixture('cleave');
		const fs = cleave.flameShock;
		const html = render(cleave);

		// What the dot did: still every refresh that bought nothing, at every target count.
		expect(html).toContain('1 of the refreshes threw away a tick of the running dot');
		// How much of it counted.
		expect(html).toContain(
			t('flameShock.wasteSplit', {
				unmeasured: fs.unjudgedWaste,
				judged: fs.refreshes - fs.unjudgedRefreshes,
			}),
		);
		expect(html).toContain(
			'1 of those came with more than one enemy up, where the multi-target order stops asking you',
		);
		expect(html).toContain('What is measured is the 1 of them you made with one enemy in front of you');
	});

	/**
	 * The no-change guards. Deliberate no-change: both pulls stay at one enemy, so there is no split to
	 * describe and the verdict has to be the exact string it was before — not merely a string without
	 * the clause in it.
	 */
	it('adds nothing to the sentence on a pull that never left one enemy', () => {
		for (const name of SINGLE_TARGET) {
			const el = fixture(name);
			const fs = el.flameShock;
			const html = render(el);
			const wasted = fs.refreshes - fs.windowed - fs.ascPrep - fs.snapshotGain;
			const context = fs.uptimePct >= 99.995 ? 'bad_full' : 'ok';
			expect(html, name).toContain(
				t('flameShock.verdict', { context, uptime: fs.uptimePct, casts: fs.applies + fs.refreshes, wasted }),
			);
			expect(html, name).not.toContain('Not measured above one target');
			expect(html, name).not.toContain('above one target');
		}
	});

	/**
	 * The reading that leaves no judged refresh at all, which is the gate's second half.
	 *
	 * A reader who declares the whole pull multi-target is told by `verdict_exempt` that none of it is
	 * measured and where the control to change that is. The split clause would say the same thing worse
	 * — "the 0 refreshes you made with one enemy in front of you" — so it is gated on there being a
	 * measured refresh to compare against, and not on `unjudgedWaste > 0` alone.
	 *
	 * **The red for the first assertion here is against the naive gate rather than against HEAD**, which
	 * is stated because the difference matters: HEAD prints no clause on any pull, so a negative
	 * assertion could not tell the gate from the absence of the feature. Drop `&& judgedRefreshes > 0`
	 * from `FlameShock.tsx` and it goes red on the clause appearing under `verdict_exempt`. The two
	 * assertions below it are the same table claim as the case above, on a reading where *every* refresh
	 * has left the sample.
	 */
	it('leaves the whole-pull multi-target reading to its own sentence', () => {
		const cleave = fixture('cleave');
		const forced = {
			...cleave,
			flameShock: {
				...cleave.flameShock,
				presses: cleave.flameShock.presses.map((p) => ({ ...p, judged: false })),
				unjudgedRefreshes: cleave.flameShock.refreshes,
				unjudgedWaste: 1,
			},
		} as El;
		const html = render(forced);
		expect(html).not.toContain('of those came with more than one enemy up, where the multi-target order');
		// And no refresh row is tinted, while the `late` rows keep theirs.
		expect(html).toContain('Early, a tick thrown away, Not measured above one target');
		expect(html).toContain('bg-band-warn');
	});
});
