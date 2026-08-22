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

import { initI18n } from '~/lib/i18n/config';
import { getSpec } from '~/lib/spec';
import type { Analysis, ElementalAuditResult, FightDataset, WclEvent } from '~/lib/types';

import { SpecContext } from '~/components/report/specContext';
import { analyse } from '~/specs/elemental/lib';

import Mana from '../Mana';

const ELEMENTAL_SPEC = getSpec('elemental')!;

initI18n();

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
		expect(html).toContain('You were never under either number with the button for it up in this pull.');
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
