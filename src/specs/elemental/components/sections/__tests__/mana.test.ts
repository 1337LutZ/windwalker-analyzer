// What the Mana section actually says, on a pull that fires each of its clauses and on one that fires
// none of them.
//
// The section is four conditional sentences over one chart, and every one of them is conditional for a
// reason this file has to hold: the shield sentence claims a *cause* and must not appear on a pull whose
// starvation did not coincide with the shield dropping; the exempt sentence excuses the player and must
// not appear on a pull that had nothing to be excused; the opening note is about the log's own horizon
// and must not appear on a pull it does not limit. A section that showed all four every time would read
// as advice on every pull and be right on none.
//
// The pulls are `cleave`'s event stream with the pool rewritten over one stretch — see the module
// comment on `lib/__tests__/mana.test.ts` for why that, and for why no committed fixture can do this.
//
// `createElement` rather than JSX so this stays a `.ts` file and is picked up by the project's own
// vitest include patterns, as its sibling `readerVoice.test.ts` does.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import i18n, { initI18n } from '~/lib/i18n/config';
import { getSpec } from '~/lib/spec';
import type { Analysis, ElementalAuditResult, FightDataset, WclEvent } from '~/lib/types';

import { SpecContext } from '~/components/report/specContext';
import { analyse } from '~/specs/elemental/lib';

import Mana from '../Mana';

const ELEMENTAL_SPEC = getSpec('elemental')!;

initI18n();
// The verdict arms are matched through the locale as well as by their literal text, the way the sibling
// copy tests do it: one side of every assertion below is the string a reader is shown.
const t = i18n.getFixedT('en', 'report');

type El = Analysis & ElementalAuditResult;

const raw = (name: string): FightDataset =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../__fixtures__/${name}.json`), 'utf8')) as FightDataset;

/** `cleave` with the pool held at `pct` between `from` and `to`. See the lib suite's `synthetic`. */
function withLowMana(from: number, to: number, pct: number): El {
	const dataset = raw('cleave');
	const t0 = dataset.fight.startTime;
	const events = dataset.events.map((event) => {
		const e = event as WclEvent & { classResources?: Array<{ amount: number; max: number; type: number }> };
		const at = e.timestamp - t0;
		if (e.classResources === undefined || at < from || at > to) return event;
		return {
			...e,
			classResources: e.classResources.map((bar) => (bar.type === 0 ? { ...bar, amount: (bar.max * pct) / 100 } : bar)),
		} as WclEvent;
	});
	return analyse({ ...dataset, events }) as El;
}

const render = (analysis: Analysis) =>
	renderToStaticMarkup(
		createElement(SpecContext.Provider, { value: ELEMENTAL_SPEC }, createElement(Mana as never, { analysis })),
	);

describe('a pull that starved with Thunderstorm on the bar', () => {
	// Across the one stretch `cleave` drops Lightning Shield — 106.3s to 112.2s — so the shield clause
	// is true here and its number is not zero.
	const html = render(withLowMana(104_000, 118_000, 10));

	it('tells the reader which button to press, and why it is not optional', () => {
		expect(html).toContain('At 15% your next Lava Burst may simply not go out');
		expect(html).toContain('press it as the bar reaches the line');
	});

	it('names Lightning Shield as a cause, with the mana it returns', () => {
		expect(html).toContain('Rolling Thunder returns 2% of your maximum mana every time it grants a charge');
		expect(html).toContain('only fires while the shield is up');
	});

	it('does not excuse the pull, because both buttons were not away', () => {
		expect(html).not.toContain('That is the fight taking your mana');
	});
});

describe('a pull that starved nowhere near the shield dropping', () => {
	const html = render(withLowMana(150_000, 175_000, 10));

	/** The claim the plan singled out: only make the shield connection where the numbers make it. */
	it('says nothing about Lightning Shield', () => {
		expect(html).not.toContain('Rolling Thunder returns');
		expect(html).not.toContain('Keep the shield on');
	});

	it('still charges the starvation itself', () => {
		expect(html).toContain('with Thunderstorm up');
	});
});

describe('a pull whose pool never went near either number', () => {
	const html = render(analyse(raw('cleave')) as El);

	it('says there was nothing to press rather than handing out a good grade', () => {
		expect(html).toContain('The pool never reached either number with the button for it up');
		expect(html).toContain('Mana was not what limited this pull');
	});

	it('shows no fault rows, and no excuse either', () => {
		// "never under either number" was the same overclaim the verdict made and is fixed with it: the rows
		// are the *charged* stretches, and a dip too short for the priority order to look at is under the
		// number with the button up and still has no row. `No stretch` is what the table counts, and the
		// floor note under it says what a stretch is.
		expect(html).toContain('No stretch under either number went by with the button for it up in this pull.');
		expect(html).not.toContain('That is the fight taking your mana');
	});
});

describe('a pull whose log carried no mana readings', () => {
	const html = render(analyse(raw('unbroken')) as El);

	/**
	 * Missing data is not a clean pull, and the section has to say which of the two it is looking at.
	 * `unbroken` was captured without `includeResources: true` and carries no reading of the bar.
	 */
	it('says the report was not given the numbers, not that the pool was fine', () => {
		expect(html).toContain('This log carried no mana readings at all');
		expect(html).not.toContain('Mana was not what limited this pull');
	});
});

/**
 * i18next renders a missing key as the key itself, so a clause whose copy was never written shows up
 * as literal dotted text in the page rather than as a blank nobody notices. The same guard
 * `readerVoice.test.ts` keeps over the Elemental Mastery arms, and it is worth more here because most
 * of this section's sentences only render on pulls no fixture produces.
 *
 * The key names are written out rather than swept for `mana.` — the copy itself legitimately ends a
 * sentence with the word, and a guard that fires on its own prose is a guard nobody keeps.
 */
const KEYS = [
	'mana.intent',
	'mana.verdict',
	'mana.clean',
	'mana.none',
	'mana.bothDown',
	'mana.shield',
	'mana.opening',
	'mana.early',
	'mana.floor',
	'mana.resolution',
	'mana.caption',
	'mana.noRows',
	'mana.kpi',
	'mana.key',
	'mana.columns',
	'mana.press',
	'mana.chartLabel',
];

describe('every clause has copy behind it', () => {
	for (const [name, analysis] of [
		['starved beside a shield drop', withLowMana(104_000, 118_000, 10)],
		['strained only', withLowMana(90_000, 120_000, 50)],
		['nothing to say', analyse(raw('cleave')) as El],
		['no readings', analyse(raw('unbroken')) as El],
	] as const) {
		it(`falls through to no key on a pull that ${name}`, () => {
			const html = render(analysis);
			for (const key of KEYS) expect(html, `${name}: ${key}`).not.toContain(key);
		});
	}
});

/**
 * Half of this section can go unmeasured, and the `good` sentence spoke for both halves anyway.
 *
 * `thunderstormMissed` and `shamanisticRageMissed` answer independently — each is null unless its own
 * `gradedMs` is above zero — and `section()` takes the worst of the metrics it could *decide*. So a pull
 * that answered one half and not the other is graded on the survivor alone, and `verdict_good` asserted
 * both: "You never sat under 15% with Thunderstorm up, and never under 70% with Shamanistic Rage up."
 * `lightningShield` and `searingTotem` each carry `verdict_good_no…` variants for exactly this shape;
 * `mana` had none.
 *
 * The same sentence overclaimed a second way, on the half it *did* measure. The `good` band is zero on
 * `ms`, and `ms` is the time below the line with the button in hand **across a stretch at least one global
 * long** — so a 733ms dip under 70% with the Rage up is a real dip, is inside `gradedMs`, and still scores
 * a clean zero. "Never sat under 70%" was false about it. The new wording claims what the number is: no
 * stretch went by with the button sitting unpressed.
 *
 * No committed fixture reaches this — all three have both graded clocks empty and print `mana.clean` — so
 * the pull is `cleave`'s event stream with the pool held at 50% for three seconds, which is the same
 * synthetic the cases above use, sized to fall under the one-global floor.
 */
describe('a good mana verdict speaks only for the halves the log answered', () => {
	/** 733ms under 70% with Shamanistic Rage in hand: inside the graded clock, under the floor. */
	const halfMeasured = withLowMana(90_000, 93_000, 50);

	/** The premise, so nothing below is vacuous. */
	it('is a good pull with one half of it unmeasured and a real dip in the other', () => {
		const card = ELEMENTAL_SPEC.score(halfMeasured);
		const metric = (key: string) => card.sections['mana']?.metrics.find((m) => m.key === key);
		expect(metric('thunderstormMissed')?.unmeasurable).toBe(true);
		expect(metric('shamanisticRageMissed')?.unmeasurable).toBe(false);
		expect(metric('shamanisticRageMissed')?.grade).toBe('good');
		expect(card.sections['mana']?.grade).toBe('good');
		// The dip the old sentence denied: below the line, button in hand, shorter than one global.
		expect(halfMeasured.mana?.starved.gradedMs).toBe(0);
		expect(halfMeasured.mana?.strained.gradedMs).toBeGreaterThan(700);
		expect(halfMeasured.mana?.strained.ms).toBe(0);
		expect(halfMeasured.mana?.strained.stretches).toBe(0);
	});

	it('does not claim a clean Thunderstorm on a pull that never measured one', () => {
		const html = render(halfMeasured);
		// The sentence the old code printed here, verbatim.
		expect(html).not.toContain(
			'You never sat under 15% with Thunderstorm up, and never under 70% with Shamanistic Rage up.',
		);
		expect(html).not.toContain('with Thunderstorm up, and never under');
		expect(html).toContain(t('mana.verdict_good_noThunderstorm', { starved: 15, strained: 70 }));
		// What it says instead: the half it measured, then which half it is not speaking for.
		expect(html).toContain('No stretch under 70% went by with Shamanistic Rage sitting unpressed.');
		expect(html).toContain('This log never puts you under 15% with Thunderstorm in your hands');
		expect(html).toContain('only about the Rage');
		// Not a raw key, which is what a context arm with no copy behind it renders as.
		expect(html).not.toContain('mana.verdict');
	});

	/** The mirror image: a Thunderstorm clock with something in it and no Rage clock at all. */
	it('does not claim a clean Shamanistic Rage on a pull that never measured one', () => {
		const starvedOnly: El = {
			...halfMeasured,
			mana: {
				...halfMeasured.mana!,
				starved: { ...halfMeasured.mana!.strained, gradedMs: 733, ms: 0, stretches: 0 },
				strained: { ...halfMeasured.mana!.strained, gradedMs: 0, ms: 0, stretches: 0, windows: [] },
			},
		};
		const card = ELEMENTAL_SPEC.score(starvedOnly);
		expect(card.sections['mana']?.grade).toBe('good');
		const html = render(starvedOnly);
		expect(html).toContain(t('mana.verdict_good_noRage', { starved: 15, strained: 70 }));
		expect(html).toContain('No stretch under 15% went by with Thunderstorm sitting unpressed.');
		expect(html).toContain('This log never puts you under 70% with Shamanistic Rage in your hands');
		expect(html).not.toContain('mana.verdict');
	});

	/**
	 * A pull that answered both halves keeps one sentence, and it is the sentence about presses rather than
	 * about the bar: both clocks graded, neither of them charging anything.
	 */
	it('says both halves when both halves were measured', () => {
		const both: El = {
			...halfMeasured,
			mana: {
				...halfMeasured.mana!,
				starved: { ...halfMeasured.mana!.strained, gradedMs: 733, ms: 0, stretches: 0 },
			},
		};
		expect(ELEMENTAL_SPEC.score(both).sections['mana']?.grade).toBe('good');
		const html = render(both);
		expect(html).toContain('No stretch under 15% went by with Thunderstorm sitting unpressed, and none under 70%');
		expect(html).toContain('The pool was never the thing holding your casts back.');
		expect(html).not.toContain('This log never puts you under');
	});

	/**
	 * Only the `good` sentence is narrowed, and the reason is arithmetic: `ms` and `stretches` are both cut
	 * out of an empty `gradedMs`, so the `ok` and `bad` sentences print a true zero for the unread half
	 * rather than a figure that contradicts the tile beside it. Thin there, not false — recorded rather
	 * than papered over, and this is the guard that says so.
	 */
	it('leaves the ok and bad sentences to the grade', () => {
		const html = render(withLowMana(90_000, 120_000, 50));
		expect(ELEMENTAL_SPEC.score(withLowMana(90_000, 120_000, 50)).sections['mana']?.grade).toBe('ok');
		expect(html).toContain('let Shamanistic Rage come back to a pool already under 70%'); // no-change guard
		expect(html).not.toContain('This log never puts you under');
	});
});
