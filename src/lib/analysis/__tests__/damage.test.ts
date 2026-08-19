import { describe, expect, it } from 'vitest';

import type { DamageEvent } from '~/lib/events';
import { registry } from '~/specs/windwalker/lib';

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

	/**
	 * The spec's ignore list applies here too, and it did not.
	 *
	 * `ignoredMultiTargetActorIDs` takes the Automated Shredders out of the per-moment target count,
	 * because a 90% damage reduction makes them not worth spreading onto — and this fan-out, a second
	 * count over the same damage events, filtered nothing. So one section could call a pull
	 * single-target while the Rushing Jade Wind card beside it reported the wind hitting three.
	 */
	it('leaves the spec-ignored actors out of the fan-out', () => {
		const { abilities } = aggregateDamage(
			[hit(1000, 20), hit(1000, 99), hit(2000, 20), hit(2000, 99)],
			registry,
			String,
			new Set([99]),
		);

		expect(abilities.find((ability) => ability.id === 148_187)?.averageTargetsHit).toBe(1);
	});

	/** Their damage is still damage: only the count of what it spread to is affected. */
	it('keeps their damage in the ability total', () => {
		const { abilities, eventTotal } = aggregateDamage([hit(1000, 20), hit(1000, 99)], registry, String, new Set([99]));
		const row = abilities.find((ability) => ability.id === 148_187);

		expect(row?.hits).toBe(2);
		expect(row?.total).toBe(200);
		expect(eventTotal).toBe(200);
	});

	/**
	 * A moment that landed only on ignored actors is not a fan-out of zero, it is not a reading at all —
	 * averaging a zero in would drag the wind's spread down for hits it should never have seen.
	 */
	it('drops a moment that landed only on ignored actors rather than scoring it zero', () => {
		const { abilities } = aggregateDamage(
			[hit(1000, 20), hit(1000, 21), hit(2000, 99)],
			registry,
			String,
			new Set([99]),
		);

		expect(abilities.find((ability) => ability.id === 148_187)?.averageTargetsHit).toBe(2);
	});
});
