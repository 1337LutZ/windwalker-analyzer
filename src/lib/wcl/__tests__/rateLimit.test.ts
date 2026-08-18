// The credits readout's arithmetic, and the cases where it must refuse to produce one.
//
// Every assertion here is about honesty rather than about a number being pretty. A budget display
// that reads `0 left` because a field was missing, or that keeps counting down against an hour that
// has already turned over, is worse than no display: it tells someone their working app is out of
// credit. `viewCredits` answers null in both cases, and these are the tests that say so.

import { describe, expect, it } from 'vitest';

import { ASSUMED_ANALYSIS_COST, readRateLimit, viewCredits, type CreditsSnapshot } from '../rateLimit';

const NOW = 1_700_000_000_000;

function snap(spent: number, analysisCost: number | null = null, resetInMs = 30 * 60 * 1000): CreditsSnapshot {
	return { credits: { limit: 9000, spent, resetAt: NOW + resetInMs }, analysisCost };
}

describe('readRateLimit', () => {
	it('reads the field a response carries and resolves the reset to a wall clock', () => {
		const data = { rateLimitData: { limitPerHour: 9000, pointsSpentThisHour: 71.2, pointsResetIn: 1189 } };
		expect(readRateLimit(data, NOW)).toEqual({ limit: 9000, spent: 71.2, resetAt: NOW + 1_189_000 });
	});

	it.each([
		['no field at all', { reportData: {} }],
		['a null field', { rateLimitData: null }],
		['a missing member', { rateLimitData: { limitPerHour: 9000, pointsSpentThisHour: 71.2 } }],
		[
			'a member of the wrong type',
			{ rateLimitData: { limitPerHour: '9000', pointsSpentThisHour: 1, pointsResetIn: 1 } },
		],
		[
			'a limit of zero, which would divide by nothing',
			{
				rateLimitData: { limitPerHour: 0, pointsSpentThisHour: 0, pointsResetIn: 60 },
			},
		],
		['not an object', 'nope'],
		['null', null],
	])('answers null for %s rather than inventing a budget', (_case, data) => {
		expect(readRateLimit(data, NOW)).toBeNull();
	});
});

describe('viewCredits', () => {
	it('says nothing at all when nothing has been read', () => {
		expect(viewCredits({ credits: null, analysisCost: null }, NOW)).toBeNull();
	});

	it('refuses a reading whose hour has already turned over', () => {
		// The spend it reports belongs to a budget that no longer exists, so it would understate what
		// the reader has. It corrects itself on the next request; until then the display is silent.
		expect(viewCredits(snap(8900, 5, -1000), NOW)).toBeNull();
	});

	it('divides by what the last pull actually cost once one has been watched', () => {
		const view = viewCredits(snap(1000, 4), NOW);
		expect(view?.costPerPull).toBe(4);
		expect(view?.measured).toBe(true);
		// 8000 left at 4 points is 2000, coarsened to the hundred.
		expect(view?.pullsLeft).toBe(2000);
	});

	it('falls back to the measured constant, and says it is a fallback', () => {
		const view = viewCredits(snap(1000), NOW);
		expect(view?.costPerPull).toBe(ASSUMED_ANALYSIS_COST);
		expect(view?.measured).toBe(false);
	});

	it('reports what is left as a share of the whole hour', () => {
		expect(viewCredits(snap(900), NOW)?.percentLeft).toBeCloseTo(90);
	});

	it.each([
		// The divisor is one measurement of a cost that varies with fight length, so the quotient is
		// rounded down to as few digits as that can support — and never up, which would promise pulls
		// the budget cannot pay for.
		[1000, 5, 1600],
		[4000, 5, 1000],
		[8000, 5, 200],
		[8800, 5, 40],
		[8960, 5, 8],
	])('spent %i at %i points a pull reads as %i pulls', (spent, cost, expected) => {
		expect(viewCredits(snap(spent, cost), NOW)?.pullsLeft).toBe(expected);
	});

	it('keeps the exact count once it is small enough to act on', () => {
		// Under a hundred the digits are the one thing worth having: seven pulls left is a fact a
		// reader can plan around, and "about ten" is not.
		expect(viewCredits(snap(8965, 5), NOW)?.pullsLeft).toBe(7);
	});

	it('floors at zero rather than going negative when the budget is overspent', () => {
		const view = viewCredits(snap(9200, 5), NOW);
		expect(view?.remaining).toBe(0);
		expect(view?.pullsLeft).toBe(0);
	});
});
