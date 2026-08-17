import { describe, expect, it } from 'vitest';

import type { DamageEvent } from '~/lib/events';
import { registry } from '~/lib/spec/windwalker';

import { aggregateDamage } from '../damage';

const hit = (timestamp: number, targetID: number, targetInstance?: number): DamageEvent => ({
	timestamp,
	type: 'damage',
	sourceID: 7,
	targetID,
	targetInstance,
	abilityGameID: 148_187,
	amount: 100,
	hitType: 1,
});

describe('damage target fan-out', () => {
	it('averages distinct targets per damage timestamp', () => {
		const { abilities } = aggregateDamage(
			[hit(1000, 20), hit(1000, 21), hit(2000, 20), hit(2000, 20, 2)],
			registry,
			String,
		);

		expect(abilities.find((ability) => ability.id === 148_187)?.averageTargetsHit).toBe(2);
	});
});
