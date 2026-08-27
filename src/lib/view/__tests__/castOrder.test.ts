// The order a cast list puts a spec's buttons in: named leaders, then the spec's own, then the rest.

import { describe, expect, it } from 'vitest';

import { rawFixtures } from '~/lib/analysis/fixtures';
import { compare, identityFrom } from '~/lib/compare';
import { getSpec, SPECS } from '~/lib/spec';
import { byCastOrder, castRank, isShared, lastTierKeys } from '~/lib/view/castOrder';
import { resolveBands } from '~/lib/view/targetMode';

const spec = getSpec('windwalker')!;
const IDENTITY = identityFrom(spec.registry);
// The tier a button closes the list in depends on the spec's own table as well as on `SHARED_ABILITIES`,
// because a potion filed under the spec is still a potion.
const LAST = lastTierKeys(spec.registry.abilities);
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
		const ranks = spec.castOrder.map((key) => castRank(key, spec.castOrder, LAST));
		expect(ranks).toEqual([0, 1, 2, 3, 4, 5]);
	});

	it('sorts the spec itself ahead of anything that belongs to no spec', () => {
		expect(castRank('rushing-jade-wind', spec.castOrder, LAST)).toBeLessThan(
			castRank('blood-fury', spec.castOrder, LAST),
		);
		expect(castRank('expel-harm', spec.castOrder, LAST)).toBeLessThan(castRank('healthstone', spec.castOrder, LAST));
	});

	/**
	 * The case the first attempt got backwards.
	 *
	 * `SHARED_ABILITIES` is the whole of what belongs to no spec, so a button that is not on it and that
	 * this class pressed is that class's own — whether or not the ability table happens to name it.
	 * Ranking by the model's silence instead put Roll and Tiger's Lust, both monk buttons, below a flask.
	 */
	it('gives a button the ability table cannot place a tier of its own', () => {
		// Roll and Spear Hand Strike are monk buttons the table does not carry; Goblin Glider and Nitro
		// Boosts are items anyone can press. Both arrive with no key, so nothing separates them — and
		// ranking them with the spec put a glider above Energizing Brew.
		expect(isShared(null)).toBe(false);
		expect(castRank('energizing-brew', spec.castOrder, LAST)).toBeLessThan(castRank(null, spec.castOrder, LAST));
		expect(castRank('touch-of-karma', spec.castOrder, LAST)).toBeLessThan(castRank(null, spec.castOrder, LAST));
		expect(castRank(null, spec.castOrder, LAST)).toBeLessThan(
			castRank('flask-of-spring-blossoms', spec.castOrder, LAST),
		);
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
		.sort(byCastOrder((row) => IDENTITY.cast(row.id), spec));

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
		const closing = (row: { id: number }) => {
			const key = IDENTITY.cast(row.id);
			return key !== null && LAST.has(key);
		};
		const last = rows.map((row, at) => ({ at, last: closing(row) })).filter((r) => r.last);
		expect(last.length).toBeGreaterThan(2);
		// Every one of them sits past every row that is not one: a flask never lands mid-rotation again.
		expect(rows.slice(last[0]!.at).every(closing)).toBe(true);
	});

	/**
	 * The case a reader reported: a potion above three of the monk's own cooldowns.
	 *
	 * Virmen's Bite is in the Windwalker's own registry deliberately — the stat on it is agility, so no
	 * other spec wants it — and that put it in the spec's tier, where the stable sort left it wherever
	 * the gap between the two logs happened to place it. It is an item press, and `Ability.onUse` is
	 * what says so.
	 */
	it('puts the spec’s own potion below the spec’s own cooldowns', () => {
		const at = (name: string) => rows.findIndex((row) => row.name === name);
		expect(at("Virmen's Bite")).toBeGreaterThan(-1);
		for (const own of ['Energizing Brew', 'Chi Brew', 'Touch of Karma']) {
			expect(at(own), own).toBeGreaterThan(-1);
			expect(at(own), own).toBeLessThan(at("Virmen's Bite"));
		}
	});
});

/**
 * The rule is structural, so it holds for a spec nobody has written yet.
 *
 * A `castOrder` naming a key the spec's own registry does not carry is a list that silently does
 * nothing: `indexOf` answers -1, the button drops to the middle tier, and the order a reader was
 * promised is not the one they get. A typo, a renamed ability or a key copied from another spec all
 * arrive here rather than on the page.
 */
describe('every spec, present and future', () => {
	it('names only buttons its own registry carries', () => {
		for (const candidate of SPECS) {
			const known = new Set(candidate.registry.abilities.map((ability) => ability.key));
			const unknown = candidate.castOrder.filter((key) => !known.has(key));
			expect(unknown, `${candidate.key} names ${unknown.join(', ')}`).toEqual([]);
		}
	});

	it('names each button once, and never one that belongs to no spec', () => {
		for (const candidate of SPECS) {
			expect(new Set(candidate.castOrder).size, candidate.key).toBe(candidate.castOrder.length);
			// A racial or a flask in the leaders would contradict the tier below it.
			expect(candidate.castOrder.filter(isShared), candidate.key).toEqual([]);
		}
	});

	/**
	 * Every spec that models a potion files it in its own table, for the stat on it, and every one of
	 * them would otherwise rank it as rotation. Structural rather than a list of three potions, so the
	 * fourth spec inherits the answer instead of the fault.
	 */
	it('closes each list with its own item presses, not with its own cooldowns', () => {
		for (const candidate of SPECS) {
			const last = lastTierKeys(candidate.registry.abilities);
			const items = candidate.registry.abilities.filter((ability) => ability.onUse === true);
			expect(items.length, candidate.key).toBeGreaterThan(0);
			const spells = candidate.registry.abilities.filter(
				(ability) => ability.onUse !== true && !isShared(ability.key) && !candidate.castOrder.includes(ability.key),
			);
			expect(spells.length, candidate.key).toBeGreaterThan(0);
			const worstItem = Math.min(...items.map((ability) => castRank(ability.key, candidate.castOrder, last)));
			const worstSpell = Math.max(...spells.map((ability) => castRank(ability.key, candidate.castOrder, last)));
			expect(worstSpell, `${candidate.key}: an item press outranks one of its own spells`).toBeLessThan(worstItem);
		}
	});

	it('is declared by every spec in the registry', () => {
		expect(SPECS.length).toBeGreaterThan(2);
		for (const candidate of SPECS) expect(Array.isArray(candidate.castOrder), candidate.key).toBe(true);
	});
});
