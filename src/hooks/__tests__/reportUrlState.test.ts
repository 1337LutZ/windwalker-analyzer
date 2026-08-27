import { describe, expect, it } from 'vitest';

import { __test, shouldAutoRun } from '../useReportUrlState';

const { parse, nextHref } = __test;

describe('report URL state', () => {
	it('reads a full selection', () => {
		expect(parse('?report=ExampleCode12345&fight=30&player=Examplemonk')).toEqual({
			code: 'ExampleCode12345',
			fightID: 30,
			player: 'Examplemonk',
			spec: null,
			second: null,
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
		expect(parse('')).toEqual({ code: null, fightID: null, player: null, spec: null, second: null });
		expect(parse('?report=&fight=&player=&spec=')).toEqual({
			code: null,
			fightID: null,
			player: null,
			spec: null,
			second: null,
		});
		// An empty second pull is no second pull. Three empty strings must not make a link read as a
		// comparison of nothing against nothing.
		expect(parse('?report2=&fight2=&player2=').second).toBeNull();
	});

	/**
	 * The compare page's address, and the property that made these keys additive rather than a new
	 * scheme: the first pull is read from the keys it has always been read from.
	 */
	it('reads a second pull, without touching how the first is read', () => {
		const both = parse('?report=AAA&fight=1&player=One&report2=BBB&fight2=2&player2=Two');
		expect(both).toMatchObject({ code: 'AAA', fightID: 1, player: 'One' });
		expect(both.second).toEqual({ code: 'BBB', fightID: 2, player: 'Two' });
	});

	it('reads half a comparison as half a comparison', () => {
		// A reader who filled in one slot and shared the link has named a second pull's absence, not a
		// single-report address. The page opens on compare with one slot seeded.
		expect(parse('?report=AAA&report2=BBB').second).toEqual({ code: 'BBB', fightID: null, player: null });
	});

	it('holds the second pull to the same rules as the first', () => {
		expect(parse('?report2=abc&fight2=notanumber').second?.fightID).toBeNull();
		const url = new URL('https://example.test/app');
		url.searchParams.set('report2', 'a:6MhZgjyAknFWrYfK');
		url.searchParams.set('player2', 'Player (17)');
		expect(parse(url.search).second).toMatchObject({ code: 'a:6MhZgjyAknFWrYfK', player: 'Player (17)' });
	});

	/**
	 * Writing the second pull, and the absence of one.
	 *
	 * The absence is the half worth pinning. A reader who compares two pulls and then opens a single
	 * report in the same tab must not carry `report2` with them: the address would name a comparison
	 * the page below it is not showing, and that link is what gets shared.
	 */
	it('writes a second pull, and clears it when there is not one', () => {
		expect(
			nextHref('https://example.test/monk/windwalker/compare', {
				code: 'AAA',
				fightID: 1,
				player: 'One',
				second: { code: 'BBB', fightID: 2, player: 'Two' },
			}),
		).toBe('/monk/windwalker/compare?report=AAA&fight=1&player=One&report2=BBB&fight2=2&player2=Two');

		expect(
			nextHref('https://example.test/monk/windwalker?report=AAA&report2=BBB&fight2=2&player2=Two', {
				code: 'AAA',
				fightID: null,
				player: null,
			}),
		).toBe('/monk/windwalker?report=AAA');
	});

	it('round-trips a comparison through the address bar', () => {
		const selection = {
			code: 'AAA',
			fightID: 1,
			player: 'Player (17)',
			second: { code: 'a:BBB', fightID: 22, player: 'Player (3)' },
		};
		const href = nextHref('https://example.test/monk/windwalker/compare', selection);
		expect(parse(new URL(href, 'https://example.test').search)).toMatchObject({
			code: 'AAA',
			fightID: 1,
			player: 'Player (17)',
			second: { code: 'a:BBB', fightID: 22, player: 'Player (3)' },
		});
	});

	it('reads the spec key the registry owns', () => {
		expect(parse('?report=abc&spec=windwalker').spec).toBe('windwalker');
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
		expect(Object.keys(parsed)).toEqual(['code', 'fightID', 'player', 'spec', 'second']);
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
