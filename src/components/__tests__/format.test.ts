import { describe, expect, it } from 'vitest';

import { difficultyLabel } from '../format';

/**
 * These exist because the label was wrong on both halves at once, and looked plausible enough that
 * nothing caught it: a 10 Heroic pull rendered as "25 Normal".
 *
 * The cause was using retail Mists' difficulty ids, where 3/4/5/6 encode size *and* mode. On Classic
 * the id is the mode alone and size is its own field, so 4 means Heroic at either raid size. Both
 * halves of the old label were therefore independently wrong.
 */
describe('difficultyLabel', () => {
	const names = { 3: 'Normal', 4: 'Heroic' };

	it('reads the mode from the zone and the size from the fight', () => {
		expect(difficultyLabel(4, 10, names)).toBe('10 Heroic');
		expect(difficultyLabel(4, 25, names)).toBe('25 Heroic');
		expect(difficultyLabel(3, 10, names)).toBe('10 Normal');
	});

	/** The exact regression: id 4 at size 10 is 10 Heroic, and must never read as 25 Normal again. */
	it('never spells a 10 Heroic pull as 25 Normal', () => {
		expect(difficultyLabel(4, 10, names)).not.toContain('Normal');
		expect(difficultyLabel(4, 10, names)).not.toContain('25');
	});

	it('falls back to the Classic table when the zone gave no names', () => {
		expect(difficultyLabel(4, 10)).toBe('10 Heroic');
		expect(difficultyLabel(3, 25)).toBe('25 Normal');
	});

	/** The zone is the authority; a stale local table must not override what the API said. */
	it('prefers the zone-supplied name over the fallback', () => {
		expect(difficultyLabel(4, 10, { 4: 'Something Else' })).toBe('10 Something Else');
	});

	it('shows the mode alone rather than inventing a size', () => {
		expect(difficultyLabel(4, 0, names)).toBe('Heroic');
	});

	it('says something usable for an id nobody knows', () => {
		expect(difficultyLabel(99, 10)).toBe('10 difficulty 99');
	});
});
