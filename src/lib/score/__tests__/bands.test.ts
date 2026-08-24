// The band declaration read from the rule's end, and the one conversion between the two vocabularies.

import { describe, expect, it } from 'vitest';

import { ALL_BANDS } from '~/lib/spec/apl';

import { appliesAt, bandsOf, gradedBands, spreading, viewBands, viewMode } from '../index';

describe('a rule’s declared bands', () => {
	/** Undeclared means every band, the same default `ladderEntries` resolves for an APL entry. */
	it('defaults to every band', () => {
		expect(bandsOf({})).toEqual(ALL_BANDS);
		expect(appliesAt({}, 4)).toBe(true);
	});

	it('answers for one target count', () => {
		expect(appliesAt({ bands: [1, 2] }, 2)).toBe(true);
		expect(appliesAt({ bands: [1, 2] }, 3)).toBe(false);
	});
});

describe('what a pull leaves of a rule', () => {
	/** The answer the exemption turns on: nothing of this rule was ever asked of this pull. */
	it('is empty when the pull never entered the rule’s bands', () => {
		expect(gradedBands({ bands: [1, 2] }, [3, 4])).toEqual([]);
	});

	/**
	 * A pull that touched even one of them keeps the rule. Cutting the stretches that were out of band
	 * is the audit's job — this cannot know how many ms that leaves, and a rule kept on a mostly-aoe
	 * pull is why the graded clock has to be published beside the value.
	 */
	it('keeps the bands the pull actually visited', () => {
		expect(gradedBands({ bands: [1, 2] }, [1, 2, 3, 4])).toEqual([1, 2]);
		expect(gradedBands({ bands: [1, 2] }, [2])).toEqual([2]);
	});

	/** No basis to say is not the same as not applicable, and must not exempt anything. */
	it('keeps everything when the pull said nothing', () => {
		expect(gradedBands({ bands: [1, 2] }, null)).toEqual([1, 2]);
		expect(gradedBands({}, null)).toEqual(ALL_BANDS);
	});
});

describe('viewBands', () => {
	it('passes a band view through', () => {
		expect(viewBands({ bands: [1, 2, 4], mode: null, forced: false })).toEqual([1, 2, 4]);
		expect(viewBands({ bands: null, mode: null, forced: true })).toBeNull();
	});

	/**
	 * A whole-pull mode arrives as exactly one band, which is all a mode can say — but which band is no
	 * longer guessed. Three of the four name their own: the two-target reading used to arrive at band 3
	 * and be judged against a list holding Spinning Crane Kick, which the priority list does not contain
	 * until three enemies.
	 */
	it('gives each mode its own band, and the coarse one keeps three', () => {
		expect(viewBands('single')).toEqual([1]);
		expect(viewBands('cleave')).toEqual([2]);
		expect(viewBands('aoe')).toEqual([3]);
		expect(viewBands('multi')).toEqual([3]);
	});

	it('says nothing when it was told nothing', () => {
		expect(viewBands(null)).toBeNull();
		expect(viewBands(undefined)).toBeNull();
	});
});

describe('viewMode', () => {
	/**
	 * The other half of a view, and the half a `TargetMode` answers without losing anything — which is
	 * the whole asymmetry of the union: a mode is a complete answer to "how should the pull be weighed"
	 * and a lossy one to "which rules applied", and the set is the other way round. So a `BandView`
	 * carries both and neither is reconstructed from the other.
	 */
	it('reads the whole-pull reading off either arm', () => {
		expect(viewMode('multi')).toBe('multi');
		expect(viewMode({ bands: [1, 2, 3, 4], mode: 'single', forced: false })).toBe('single');
	});

	/**
	 * A mixed pull that was *detected* single-target is the case the two halves disagree on, and both
	 * halves have to survive the disagreement: all four bands were fought, and the whole pull is still
	 * weighed as single-target. Collapsing either into the other is what this pair exists to stop.
	 */
	it('keeps a set of bands and a single mode on the same pull', () => {
		const strong = { bands: [1, 2, 3, 4], mode: 'single', forced: false } as const;
		expect(viewBands(strong)).toEqual([1, 2, 3, 4]);
		expect(viewMode(strong)).toBe('single');
	});

	it('says nothing when it was told nothing', () => {
		expect(viewMode(null)).toBeNull();
		expect(viewMode(undefined)).toBeNull();
		expect(viewMode({ bands: null, mode: null, forced: false })).toBeNull();
	});
});

describe('whether the job was spreading', () => {
	/**
	 * The line sits at two enemies, and three places in the tree already draw it there: `multiTargetMs`
	 * is time at two or more, `MULTI_TARGET_SHARE_PCT` decides the whole pull against that clock, and
	 * `rushing-jade-wind-open` carries `bands: [2, 3, 4]` — so from two up the priority list has already
	 * moved a spreading button above Rising Sun Kick. A weight table that called two targets "aimed"
	 * would be scoring against a list it disagreed with.
	 */
	it('counts a cleave as spreading, alongside the pack and the coarse reading', () => {
		expect([spreading('single'), spreading('cleave'), spreading('aoe'), spreading('multi')]).toEqual([
			false,
			true,
			true,
			true,
		]);
	});

	/**
	 * Nothing said is not spreading — and not because a pull with no reading was aimed at one body, but
	 * because the only caller is choosing between a base table and a discount, and the base table is what
	 * every pull got before any of this existed.
	 */
	it('treats nothing said as the base reading rather than the discount', () => {
		expect(spreading(null)).toBe(false);
		expect(spreading(undefined)).toBe(false);
	});
});
