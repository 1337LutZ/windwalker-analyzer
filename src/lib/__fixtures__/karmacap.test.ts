// What the cap looks like against a real pull, once a health pool is supplied.
import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '~/lib/settings';
import { analyse } from '~/lib/spec/windwalker';
import { WclClient, fetchFightDataset } from '~/lib/wcl';

const token = process.env['WCL_TOKEN'] ?? '';

describe.skipIf(token === '')('Touch of Karma cap', () => {
	it('reports each use against a full health pool', { timeout: 180_000 }, async () => {
		const dataset = await fetchFightDataset(new WclClient({ token }), {
			code: 'a:YBQzrcgVJnAj7NMP',
			fightID: 30,
			playerName: 'Player (10)',
		});

		const HEALTH = 750_000;
		const withCap = analyse(dataset, { ...DEFAULT_SETTINGS, maxHealth: HEALTH });
		const without = analyse(dataset, { ...DEFAULT_SETTINGS, maxHealth: null });

		expect(without.karma.capPerUse).toBeNull();
		expect(withCap.karma.capPerUse).toBe(HEALTH);
		// The damage itself is unchanged — the health pool only says what it could have been.
		expect(withCap.karma.reflected).toBe(without.karma.reflected);

		for (const use of withCap.karma.uses) {
			expect(use.capPct).toBeCloseTo((use.reflected / HEALTH) * 100, 6);
		}
		console.log(
			'per-use share of a 750k pool:',
			withCap.karma.uses.map((u) => `${Math.round(u.capPct ?? 0)}%`).join(', '),
		);
	});
});
