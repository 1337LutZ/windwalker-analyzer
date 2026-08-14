import { describe, expect, it } from 'vitest';

import { __test, shouldAutoRun } from '../useReportUrlState';

const { parse } = __test;

describe('report URL state', () => {
	it('reads a full selection', () => {
		expect(parse('?report=aBcDeFgH12345678&fight=30&player=Examplewindwalker')).toEqual({
			code: 'aBcDeFgH12345678',
			fightID: 30,
			player: 'Examplewindwalker',
		});
	});

	/** Anonymous reports carry both an `a:` prefix and player names with spaces and parentheses. */
	it('survives an anonymous code and a bracketed player name', () => {
		const url = new URL('https://example.test/app');
		url.searchParams.set('report', 'a:6MhZgjyAknFWrYfK');
		url.searchParams.set('player', 'Player (17)');
		expect(parse(url.search)).toMatchObject({ code: 'a:6MhZgjyAknFWrYfK', player: 'Player (17)' });
	});

	it('treats missing and empty params as unset', () => {
		expect(parse('')).toEqual({ code: null, fightID: null, player: null });
		expect(parse('?report=&fight=&player=')).toEqual({ code: null, fightID: null, player: null });
	});

	it('ignores a non-numeric fight rather than passing NaN downstream', () => {
		expect(parse('?report=abc&fight=notanumber').fightID).toBeNull();
	});

	/**
	 * The token must never reach the URL — history, bookmarks, screenshots and the `Referer` header
	 * all carry it onwards. This pins that the reader is not even looked for.
	 */
	it('has no notion of a token', () => {
		const parsed = parse('?report=abc&token=SECRET&access_token=SECRET');
		expect(JSON.stringify(parsed)).not.toContain('SECRET');
		expect(Object.keys(parsed)).toEqual(['code', 'fightID', 'player']);
	});
});

/**
 * A link that names a report, a pull and a player is a request for that report. Restoring the
 * pickers and then waiting for a click is what "the report is not persisted across reloads" looked
 * like from the outside: the selection was all there, and nothing had been analysed.
 */
describe('auto-running a shared link', () => {
	const ready = {
		fromUrl: true,
		alreadyRan: false,
		signedIn: true,
		code: 'a:6MhZgjyAknFWrYfK',
		fightID: 57,
		playerName: 'Player (17)',
		roster: ['Player (17)', 'Player (3)'],
	};

	it('runs when the link fully specifies a report', () => {
		expect(shouldAutoRun(ready)).toBe(true);
	});

	it('never runs twice for the same link', () => {
		expect(shouldAutoRun({ ...ready, alreadyRan: true })).toBe(false);
	});

	it('waits for the roster rather than requesting a player it has not seen', () => {
		expect(shouldAutoRun({ ...ready, roster: [] })).toBe(false);
		expect(shouldAutoRun({ ...ready, roster: ['Someone Else'] })).toBe(false);
	});

	it('does nothing without a token to fetch with', () => {
		expect(shouldAutoRun({ ...ready, signedIn: false })).toBe(false);
	});

	/** Ordinary use must never trigger a fetch nobody asked for. */
	it('does not run for a selection the reader made by hand', () => {
		expect(shouldAutoRun({ ...ready, fromUrl: false })).toBe(false);
	});

	it('waits until every part of the selection has resolved', () => {
		expect(shouldAutoRun({ ...ready, fightID: null })).toBe(false);
		expect(shouldAutoRun({ ...ready, playerName: null })).toBe(false);
	});
});
