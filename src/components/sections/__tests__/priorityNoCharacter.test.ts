// The note that says, once, that the walk read the log but not the character sheet.
//
// Two of the ladder's terms — what was equipped and which talents were taken — are answered by one
// `combatantinfo` event. `b5724df` gave the walk `characterUnread` so it could state that as a property
// of the walk; this is the half a reader sees. Before it, a pull without that event withheld 112 of 408
// globals on `addsThenBoss`, all counted under "not read", with nothing anywhere naming the cause.
//
// Pinned in both directions, because a note printed on every pull carries no information about the pull
// in front of the reader. The negative case is the one that matters most here: every committed fixture
// carries the event, so the *absence* of this note is what every real report depends on.
//
// `createElement` rather than JSX so this stays a `.ts` file and is picked up by the project's own
// vitest include patterns.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import i18n, { initI18n } from '~/lib/i18n/config';
import { getSpec } from '~/lib/spec';
import { rawFixture, rawFixtures } from '~/lib/analysis/fixtures';
import type { Analysis } from '~/lib/types';

import { SpecContext } from '~/components/report/specContext';
import { analyse } from '~/specs/elemental/lib';

import PriorityLadder from '../PriorityLadder';

const ELEMENTAL_SPEC = getSpec('elemental')!;

initI18n();
const t = i18n.getFixedT('en', 'report');

const SENTENCE = 'This log carried no equipment record';

const render = (analysis: Analysis): string =>
	renderToStaticMarkup(
		createElement(SpecContext.Provider, { value: ELEMENTAL_SPEC }, createElement(PriorityLadder, { analysis })),
	);

/** The one pull with enough band-3+ time for the gear term to be asked at all. */
const addsThenBoss = (): Analysis => analyse(rawFixture('elemental', 'addsThenBoss.json')) as Analysis;

describe('the ladder says once that it could not read the character sheet', () => {
	/**
	 * The copy exists and is the same fact in the same words the gear section already uses. Asserted
	 * against the locale rather than against the rendered page, so a page that stops rendering it fails
	 * the case below instead of this one.
	 */
	it('borrows the wording the gear section already uses for the same fact', () => {
		expect(t('priority.noCharacter')).toContain(SENTENCE);
		expect(t('gear.none')).toContain(SENTENCE);
	});

	/**
	 * The positive case. `characterUnread` is a property of the walk, so the note is driven by the flag
	 * and not by counting unknowns — which is the whole point: a pull that never leaves one enemy sets
	 * the flag and withholds nothing, and still needs to be told.
	 */
	it('draws the note when the walk could not read the sheet', () => {
		const analysis = addsThenBoss();
		const unread = { ...analysis, apl: { ...analysis.apl!, characterUnread: true } } as Analysis;
		expect(render(unread)).toContain(SENTENCE);
	});

	/**
	 * The negative case, over every committed pull rather than a chosen one. All four carry a
	 * `combatantinfo`, so none of them may show this note — and a fixture added without one would fail
	 * here rather than quietly start printing it.
	 */
	it('stays silent on every committed pull, all of which carry the event', () => {
		for (const fixture of rawFixtures('elemental')) {
			const analysis = analyse(rawFixture('elemental', fixture.name)) as Analysis;
			expect(analysis.apl?.characterUnread ?? false, fixture.name).toBe(false);
			expect(render(analysis), fixture.name).not.toContain(SENTENCE);
		}
	});
});

/**
 * The sentence that names what the ladder set aside, and the pulls where there is nothing to name.
 *
 * `priority.unjudged` reports two counts the percentage above it deliberately excludes: presses an
 * entry could not be read for, and presses on buttons the list has no opinion about. It is worth
 * printing, for the reason its call site gives — a reader who cannot see how many were set aside
 * cannot tell a confident answer from a thin one.
 *
 * **It was printing on pulls where both counts were zero**, which reads "Left out of that count: 0
 * where an entry above needed something this log does not carry, and 0 spent on buttons the priority
 * list has no opinion about. Neither counts against you." — a paragraph whose entire content is that
 * it was not needed. Four of the eleven committed fixtures rendered it.
 *
 * The gate is the sum rather than either count, because a zero on one side is a real reading: "none
 * of them, and three of those" tells the reader which of the two exclusions actually applied. Only
 * the both-zero case has no subject.
 */
describe('the ladder names what it set aside, and stays quiet when it set nothing aside', () => {
	const LEAD = 'Left out of that count';

	/** Both counts, off the audit rather than off the sentence — the gate reads these two numbers. */
	const counts = (analysis: Analysis): { unknown: number; offList: number; sum: number } => {
		const apl = analysis.apl;
		const unknown = apl?.unknown ?? 0;
		const offList = apl?.offList ?? 0;
		return { unknown, offList, sum: unknown + offList };
	};

	it.each(rawFixtures('elemental').map(({ name }) => name.replace(/\.json$/, '')))(
		'prints it on %s exactly when there is something to print',
		(name) => {
			const analysis = analyse(rawFixture('elemental', `${name}.json`)) as Analysis;
			const { sum } = counts(analysis);
			expect(render(analysis).includes(LEAD), `${name} sets aside ${sum}`).toBe(sum > 0);
		},
	);

	/**
	 * The other side of the gate, forced — because **no committed Elemental pull reaches it.** All four
	 * set something aside, so the grid above only ever exercises the printing arm, and a gate whose
	 * silent branch nothing runs is a gate nobody has tested. The pulls that were rendering the empty
	 * sentence are the Windwalker captures, which this section is not rendered for here.
	 *
	 * Forced by copying a real audit and zeroing the two counts, which is the edit
	 * `specs/elemental/components/sections/__tests__/thinShockSample.test.ts` makes for the same reason:
	 * everything else about the pull stays real, so what is being tested is the gate and not a fixture.
	 */
	it('says nothing at all when both counts are zero', () => {
		const real = analyse(rawFixture('elemental', 'cleave.json')) as Analysis;
		expect(counts(real).sum, 'the pull this is derived from must set something aside').toBeGreaterThan(0);
		expect(render(real)).toContain(LEAD); // the arm the grid covers, restated here as the control

		const nothingSetAside = { ...real, apl: { ...real.apl!, unknown: 0, offList: 0 } } as Analysis;
		expect(counts(nothingSetAside).sum).toBe(0);
		const html = render(nothingSetAside);
		expect(html).not.toContain(LEAD);
		// The section still renders — the gate drops one sentence, not the block around it.
		expect(html).toContain(t('priority.caption'));
		expect(html.length).toBeGreaterThan(render(real).length - 400);
	});

	/**
	 * And the sentence is grammatical at one, which is the other half of the same defect: i18next
	 * resolves plurals off a `count` value and this call site passes two numbers, so neither can be a
	 * plural arm. The wording carries it instead — "{{unknown}} where an entry above needed something"
	 * rather than a number in front of a bare plural.
	 */
	it('reads correctly when a count is one', () => {
		expect(t('priority.unjudged', { unknown: 1, offList: 0 })).not.toMatch(/\b1 presses\b/);
		expect(t('priority.unjudged', { unknown: 0, offList: 1 })).not.toMatch(/\b1 buttons\b/);
	});
});
