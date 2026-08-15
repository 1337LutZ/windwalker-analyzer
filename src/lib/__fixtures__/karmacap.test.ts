// What the cap looks like against a real pull, now that the pull measures it rather than the reader.
//
// Live because it needs a whole `FightDataset`: the cap is read off `absorbed` events, and the
// committed fixtures are captured `analyse()` output, which carries no events at all. Skips itself
// without a token, exactly as it did when it was checking a health pool typed into the settings.
import { describe, expect, it } from 'vitest';

import { analyse } from '~/lib/spec/windwalker';
import { WclClient, fetchFightDataset } from '~/lib/wcl';

const token = process.env['WCL_TOKEN'] ?? '';

/**
 * The three reference pulls, and what each one measures.
 *
 * `cap` is the pool the pull demonstrated — the largest absorb on it, which on all three belongs to
 * a use that drained the pool dry. `capPct` is per use in cast order, and `before` is what the same
 * use read while `capPct` divided the *redirect* by the pool. That is the bug this replaces: the
 * redirect is exactly 1.05× the absorb, so a use that drained its pool printed 105% of a ceiling the
 * spell's own tooltip says cannot be exceeded.
 */
const PULLS = [
	{
		code: 'a:6MhZgjyAknFWrYfK',
		fightID: 57,
		playerName: 'Player (17)',
		cap: 805_148,
		absorbed: [805_148, 0],
		exhausted: [true, false],
		capPct: [100, 0],
		before: [105.0, 0],
	},
	{
		code: 'a:YBQzrcgVJnAj7NMP',
		fightID: 10,
		playerName: 'Player (10)',
		cap: 629_585,
		absorbed: [382_715, 629_585, 203_636],
		exhausted: [false, true, false],
		capPct: [60.8, 100, 32.3],
		before: [63.8, 105.0, 34.0],
	},
	{
		code: 'a:YBQzrcgVJnAj7NMP',
		fightID: 30,
		playerName: 'Player (10)',
		cap: 734_249,
		absorbed: [689_443, 686_656, 734_249],
		exhausted: [true, true, true],
		capPct: [100, 100, 100],
		before: [98.6, 98.2, 105.0],
	},
];

/**
 * The two Kor'kron Dark Shaman pulls, where no use drained its pool and the ceiling is unknowable.
 *
 * Neither is in the fixtures, and the shape is the one most likely to break what the three above
 * established: two bosses, adds, and a damage profile nothing like a single-target kill. What it
 * actually breaks is nothing — the absorbs pair cleanly, the two foreign shields on the first pull
 * (Divine Aegis and Illuminated Healing) stay out of the reading, and every absorb covers its blow
 * in full. So the honest answer is that these pulls cannot say, and that is what is pinned here.
 */
const NO_CEILING = [
	{
		code: 'a:6MhZgjyAknFWrYfK',
		fightID: 16,
		playerName: 'Player (17)',
		absorbed: [0, 729_000],
		reflected: [0, 765_451],
		available: 3,
		empty: 1,
	},
	{
		code: 'a:YBQzrcgVJnAj7NMP',
		fightID: 15,
		playerName: 'Player (10)',
		absorbed: [189_430, 702_578],
		reflected: [198_901, 737_707],
		available: 3,
		empty: 0,
	},
];

describe.skipIf(token === '')('Touch of Karma cap', () => {
	for (const pull of PULLS) {
		it(`measures the pool from ${pull.code.slice(2, 8)} #${pull.fightID}`, { timeout: 180_000 }, async () => {
			const dataset = await fetchFightDataset(new WclClient({ token }), pull);
			const { karma } = analyse(dataset);

			// Read, never supplied: nothing in the settings says anything about health any more.
			expect(karma.capPerUse).toBe(pull.cap);
			expect(karma.uses.map((use) => use.absorbed)).toEqual(pull.absorbed);
			expect(karma.uses.map((use) => use.exhausted)).toEqual(pull.exhausted);
			expect(karma.exhausted).toBe(pull.exhausted.filter(Boolean).length);

			karma.uses.forEach((use, i) => {
				expect(use.capPct, `use ${i}`).toBeCloseTo(pull.capPct[i] ?? 0, 1);
				// Nothing can print above its ceiling any more. The old division did, on all three pulls.
				expect(use.capPct ?? 0, `use ${i}`).toBeLessThanOrEqual(100);
				expect((use.reflected / pull.cap) * 100, `use ${i} before`).toBeCloseTo(pull.before[i] ?? 0, 1);
			});

			// The redirect is a twentieth larger than the absorb on every use that took damage, which is
			// the whole reason the cap cannot divide it. Asserted rather than described, so a change to
			// which of the two `capPct` reads fails here instead of on screen.
			for (const use of karma.uses) {
				if ((use.absorbed ?? 0) === 0) continue;
				expect(use.reflected / (use.absorbed ?? 1)).toBeCloseTo(1.05, 4);
			}
		});
	}

	/**
	 * The other shape, on real data rather than on a stale fixture.
	 *
	 * Every pull above drained a pool at least once, and until this was checked the *only* thing
	 * exercising the "cannot say" branch was the committed fixtures — which reach it for the wrong
	 * reason, by predating the field. Kor'kron Dark Shaman reaches it for the right one: two bosses,
	 * adds, and on both reports two presses that each swallowed their blow whole without ever running
	 * out. That is genuinely no information about the ceiling, and the section has to say so rather
	 * than take the largest absorb as a pool.
	 *
	 * It is also the pull the "0/2 Returned nothing, in green" report came from. The arithmetic there
	 * was right — neither press was empty — and the tile was the thing that was wrong.
	 */
	for (const pull of NO_CEILING) {
		it(`says it cannot tell on ${pull.code.slice(2, 8)} #${pull.fightID}`, { timeout: 180_000 }, async () => {
			const dataset = await fetchFightDataset(new WclClient({ token }), pull);
			const { karma } = analyse(dataset);

			expect(karma.uses.map((use) => use.absorbed)).toEqual(pull.absorbed);
			expect(karma.uses.map((use) => use.reflected)).toEqual(pull.reflected);
			// Not one absorb came up short of its blow, so nothing here measures a pool.
			expect(karma.uses.every((use) => use.exhausted === false)).toBe(true);
			expect(karma.exhausted).toBe(0);
			expect(karma.capPerUse).toBeNull();
			expect(karma.uses.every((use) => use.capPct === null)).toBe(true);

			// The presses are still counted and still gradable — "cannot say" is about the ceiling only.
			expect(karma.casts).toBe(pull.absorbed.length);
			expect(karma.available).toBe(pull.available);
			expect(karma.uses.filter((use) => use.reflected === 0)).toHaveLength(pull.empty);
		});
	}

	/** A use that drained its pool *is* the measurement, so the two have to agree exactly. */
	it('reads the pool off the use that drained it', { timeout: 180_000 }, async () => {
		const pull = PULLS[0]!;
		const dataset = await fetchFightDataset(new WclClient({ token }), pull);
		const { karma } = analyse(dataset);
		const drained = karma.uses.filter((use) => use.exhausted);

		expect(drained.length).toBeGreaterThan(0);
		expect(Math.max(...drained.map((use) => use.absorbed ?? 0))).toBe(karma.capPerUse);
	});
});
