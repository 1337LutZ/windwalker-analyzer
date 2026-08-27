// The order a cast list puts a spec's buttons in: named leaders, then the spec's own, then the rest.

import { describe, expect, it } from 'vitest';

import { rawFixtures } from '~/lib/analysis/fixtures';
import { compare, identityFrom } from '~/lib/compare';
import { getSpec } from '~/lib/spec';
import { byCastOrder, castRank, isShared } from '~/lib/view/castOrder';
import { resolveBands } from '~/lib/view/targetMode';

const spec = getSpec('windwalker')!;
const IDENTITY = identityFrom(spec.registry);
const RAW = new Map(rawFixtures('windwalker').map(({ name, dataset }) => [name.replace(/\.json$/, ''), dataset]));

function pull(name: string) {
	const analysis = spec.analyse(RAW.get(name)!);
	const view = resolveBands(analysis.targets, 'auto', analysis.segments);
	return { analysis, scorecard: spec.score(analysis, view), view };
}

describe('the three tiers', () => {
	it('puts the named leaders first, in the order the spec declares them', () => {
		expect(spec.castOrder).toEqual([
			'jab',
			'tiger-palm',
			'blackout-kick',
			'rising-sun-kick',
			'fists-of-fury',
			'tigereye-brew',
		]);
		const ranks = spec.castOrder.map((key) => castRank(key, spec.castOrder));
		expect(ranks).toEqual([0, 1, 2, 3, 4, 5]);
	});

	it('sorts the spec itself ahead of anything that belongs to no spec', () => {
		expect(castRank('rushing-jade-wind', spec.castOrder)).toBeLessThan(castRank('blood-fury', spec.castOrder));
		expect(castRank('expel-harm', spec.castOrder)).toBeLessThan(castRank('healthstone', spec.castOrder));
	});

	/**
	 * The case the first attempt got backwards.
	 *
	 * `SHARED_ABILITIES` is the whole of what belongs to no spec, so a button that is not on it and that
	 * this class pressed is that class's own — whether or not the ability table happens to name it.
	 * Ranking by the model's silence instead put Roll and Tiger's Lust, both monk buttons, below a flask.
	 */
	it('keeps a button the ability table does not name with the spec, not with the flasks', () => {
		expect(isShared(null)).toBe(false);
		expect(castRank(null, spec.castOrder)).toBe(castRank('rushing-jade-wind', spec.castOrder));
		expect(castRank(null, spec.castOrder)).toBeLessThan(castRank('flask-of-spring-blossoms', spec.castOrder));
	});

	it('knows the racials and the tinker belong to no spec', () => {
		for (const key of ['blood-fury', 'berserking', 'gift-of-the-naaru', 'arcane-torrent', 'synapse-springs']) {
			expect(isShared(key), key).toBe(true);
		}
		expect(isShared('jab')).toBe(false);
	});
});

describe('over a real pull', () => {
	const rows = compare(pull('sections'), pull('dataset-ironJuggernaut'), IDENTITY)
		.casts.filter((row) => row.id !== 1)
		.sort(byCastOrder((row) => IDENTITY.cast(row.id), spec.castOrder));

	it('opens with the rotation in the order a monk presses it', () => {
		expect(rows.slice(0, 6).map((row) => row.name)).toEqual([
			'Jab',
			'Tiger Palm',
			'Blackout Kick',
			'Rising Sun Kick',
			'Fists of Fury',
			'Tigereye Brew',
		]);
	});

	it('closes with the consumables and the tinker, uninterrupted', () => {
		const shared = rows.map((row, at) => ({ at, shared: isShared(IDENTITY.cast(row.id)) })).filter((r) => r.shared);
		expect(shared.length).toBeGreaterThan(2);
		// Every one of them sits past every row that is not one: a flask never lands mid-rotation again.
		const firstShared = shared[0]!.at;
		expect(rows.slice(firstShared).every((row) => isShared(IDENTITY.cast(row.id)))).toBe(true);
	});
});
