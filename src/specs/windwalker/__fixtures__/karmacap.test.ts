// What the ceiling looks like against a real pull, now that it is computed rather than demonstrated.
//
// Live because it needs a whole `FightDataset`: the pool is read off `combatantinfo`'s stamina and the
// absorbs off the event stream, and the committed fixtures are captured `analyse()` output, which
// carries no events at all. Skips itself without a token, exactly as it did when it was checking a
// health pool typed into the settings.
import { describe, expect, it } from 'vitest';

import { maxHealthFrom } from '~/lib/analysis/gear';
import { analyse } from '~/specs/windwalker/lib';
import { WclClient, fetchFightDataset } from '~/lib/wcl';

const token = process.env['WCL_TOKEN'] ?? '';

/**
 * The five reference pulls, and what each one measures.
 *
 * `stamina` is what `combatantinfo` reported and `pool` is what it buys — `146,403 + 14 ×` it, which
 * is `maxHealthFrom`, asserted against that function rather than restated. `cap` is per use in cast
 * order and is `pool` times whatever was raising maximum health at that press: Ancestral Vigor's
 * tenth on most of them, and nothing at all on the two that took their press between a resto
 * shaman's heals.
 *
 * **`before` is what the same use read under the old measurement**, where the ceiling was the largest
 * absorb on any use whose last absorb came up short of its blow. That test cannot tell a drained pool
 * from a blow another shield ate part of, and `YBQzrc #30` is the demonstration: three uses all
 * flagged drained, reading 689,443 / 686,656 / 734,249 for one pool that never moved, so all three
 * printed a flat 100% and the pull looked perfect. It was not — the largest of them left 1.5% unspent
 * and the other two around 8%.
 */
const PULLS = [
	{
		code: 'a:6MhZgjyAknFWrYfK',
		fightID: 57,
		playerName: 'Player (17)',
		stamina: 41_825,
		pool: 731_953,
		absorbed: [805_148, 0],
		cap: [805_148, 805_148],
		exhausted: [true, false],
		capPct: [100, 0],
		before: [100, 0],
	},
	{
		code: 'a:YBQzrcgVJnAj7NMP',
		fightID: 10,
		playerName: 'Player (10)',
		stamina: 37_964,
		pool: 677_899,
		absorbed: [382_715, 629_585, 203_636],
		cap: [745_689, 677_899, 745_689],
		exhausted: [false, false, false],
		capPct: [51.3, 92.9, 27.3],
		before: [60.8, 100, 32.3],
	},
	{
		code: 'a:YBQzrcgVJnAj7NMP',
		fightID: 30,
		playerName: 'Player (10)',
		stamina: 37_964,
		pool: 677_899,
		absorbed: [689_443, 686_656, 734_249],
		cap: [745_689, 745_689, 745_689],
		exhausted: [false, false, false],
		capPct: [92.5, 92.1, 98.5],
		before: [100, 100, 100],
	},
	/**
	 * The two Kor'kron Dark Shaman pulls, which used to be the "cannot say" case and are not any more.
	 *
	 * They are here rather than in a block of their own because that is the change: no use on either
	 * drained its pool, so the old measurement had nothing to say and the section printed a refusal
	 * over a table of presses that plainly redirected something. The pool is a property of the
	 * character rather than of the pull, so both now state one — and both absorbs land under it, which
	 * is the assertion that would catch an inflated ceiling.
	 */
	{
		code: 'a:6MhZgjyAknFWrYfK',
		fightID: 16,
		playerName: 'Player (17)',
		stamina: 41_825,
		pool: 731_953,
		absorbed: [0, 729_000],
		cap: [805_148, 805_148],
		exhausted: [false, false],
		capPct: [0, 90.5],
		before: [0, 0],
	},
	{
		code: 'a:YBQzrcgVJnAj7NMP',
		fightID: 15,
		playerName: 'Player (10)',
		stamina: 37_964,
		pool: 677_899,
		absorbed: [189_430, 702_578],
		cap: [677_899, 745_689],
		exhausted: [false, false],
		capPct: [27.9, 94.2],
		before: [0, 0],
	},
];

describe.skipIf(token === '')('Touch of Karma cap', () => {
	for (const pull of PULLS) {
		it(`states the pool on ${pull.code.slice(2, 8)} #${pull.fightID}`, { timeout: 180_000 }, async () => {
			const dataset = await fetchFightDataset(new WclClient({ token }), pull);
			const { karma, gear } = analyse(dataset);

			// Read, never supplied: nothing in the settings says anything about health any more, and
			// nothing in the pull has to drain a pool for the section to state one.
			expect(gear.stamina).toBe(pull.stamina);
			expect(maxHealthFrom(pull.stamina)).toBe(pull.pool);
			expect(karma.capPerUse).toBe(pull.pool);
			expect(karma.uses.map((use) => use.absorbed)).toEqual(pull.absorbed);
			expect(karma.uses.map((use) => use.cap)).toEqual(pull.cap);
			expect(karma.uses.map((use) => use.exhausted)).toEqual(pull.exhausted);
			expect(karma.exhausted).toBe(pull.exhausted.filter(Boolean).length);

			karma.uses.forEach((use, i) => {
				expect(use.capPct, `use ${i}`).toBeCloseTo(pull.capPct[i] ?? 0, 1);
				// Nothing can print above its ceiling. The old division did, before the redirect stopped
				// being what the pool divided.
				expect(use.capPct ?? 0, `use ${i}`).toBeLessThanOrEqual(100);
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
	 * The claim the arithmetic makes, checked in the one direction that can falsify it.
	 *
	 * Touch of Karma absorbs at most one health pool, so a use absorbing *more* than its computed
	 * ceiling would mean the ceiling is wrong. Every use on every reference pull is checked here, and
	 * the same sweep over sixty ranked Mists Classic Siege pulls — 81 uses that absorbed anything —
	 * put the highest reading at 101.57% of the raw product, with only two clearing 100.5%. Those two
	 * are why `cap` is floored at what the use absorbed: stacked health buffs snapshot their bonus off
	 * the pool as it stood, so the true pool sits a shade above the product.
	 */
	it('is never exceeded by what a use absorbed', { timeout: 300_000 }, async () => {
		for (const pull of PULLS) {
			const dataset = await fetchFightDataset(new WclClient({ token }), pull);
			const { karma } = analyse(dataset);
			for (const use of karma.uses) {
				expect(use.absorbed ?? 0, `${pull.code} #${pull.fightID}`).toBeLessThanOrEqual(use.cap ?? 0);
			}
		}
	});

	/**
	 * And the pull that shows what the old measurement cost, held as a single assertion.
	 *
	 * One pool, three uses, three "drained" flags and three flat hundreds. Under a ceiling the pull
	 * cannot move, the same three presses read 92.5%, 92.1% and 98.5% — none of them drained, and the
	 * best of them still had room for another 11,000 damage that never arrived.
	 */
	it('no longer reads one pool as three', { timeout: 180_000 }, async () => {
		const pull = PULLS[2]!;
		const dataset = await fetchFightDataset(new WclClient({ token }), pull);
		const { karma } = analyse(dataset);

		expect(karma.exhausted).toBe(0);
		expect(new Set(karma.uses.map((use) => use.cap)).size).toBe(1);
		expect(karma.uses.map((use) => use.capPct ?? 0)).not.toEqual([100, 100, 100]);
	});
});
