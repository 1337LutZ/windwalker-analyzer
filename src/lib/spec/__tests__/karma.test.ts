import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Analysis } from '~/lib/types';

const fixture = (name: string): Analysis =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8'));

/**
 * Touch of Karma redirects damage on a one-second tick, and the ticks run from about 2.8s after the
 * press through to 11.8s — past the ten seconds the tooltip advertises. A flat ten-second window
 * dropped the last two ticks and under-reported a use by a fifth, which also invented a wasted press
 * on a pull that had none.
 */
describe('Touch of Karma', () => {
	for (const name of ['strong', 'mixed', 'poor']) {
		it(`attributes every redirect tick on the ${name} pull`, () => {
			const analysis = fixture(name);
			const row = analysis.damage.abilities.find((a) => a.id === 124280);
			const attributed = analysis.karma.uses.reduce((sum, use) => sum + use.reflected, 0);

			expect(row, 'no redirect damage in this fixture').toBeDefined();
			// Every point of redirect damage belongs to exactly one press: none lost to a short window,
			// none counted twice by two overlapping ones.
			expect(attributed).toBe(row?.total);
			expect(analysis.karma.reflected).toBe(row?.total);
			expect(analysis.karma.uses).toHaveLength(analysis.karma.casts);
		});
	}

	it('counts the uses the cooldown allowed, not just the ones taken', () => {
		const strong = fixture('strong');
		// A 535s pull on a 90s cooldown: the opener plus five recharges.
		expect(strong.karma.available).toBe(6);
		expect(strong.karma.casts).toBe(2);
	});

	/** The judgement this section can actually support: a press into a quiet stretch returns nothing. */
	it('shows a press that returned nothing as exactly that', () => {
		const empty = fixture('strong').karma.uses.filter((use) => use.reflected === 0);
		expect(empty).toHaveLength(1);
		expect(empty[0]?.hits).toBe(0);
	});

	/**
	 * The log carries no health, so without a health pool from the reader there is no ceiling — and
	 * the report has to say what a use returned rather than guess at what it could have.
	 */
	it('claims no ceiling until the reader supplies a health pool', () => {
		const karma = fixture('poor').karma;
		expect(karma.capPerUse).toBeNull();
		expect(karma.uses.every((use) => use.capPct === null)).toBe(true);
	});
});
