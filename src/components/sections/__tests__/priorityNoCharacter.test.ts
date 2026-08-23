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
