// Swapping encounters should keep reading the same person.
//
// The fight picker used to clear the reader's choice on every change, so every swap between pulls
// snapped back to whoever was first in the roster — which is the opposite of what swapping is for.
// Keeping the choice is only safe because the resolution is a *chain*: a name this pull has nobody by
// is not selected, it is simply not found, and the next candidate answers.
import { describe, expect, it } from 'vitest';

import type { FightPlayer } from '~/lib/wcl';

import { resolvePlayerName } from '../resolvePlayer';

const p = (id: number, name: string): FightPlayer => ({ id, name }) as FightPlayer;

const FIRST = [p(1, 'Sparkstorm'), p(2, 'Thunderfist'), p(3, 'Peremptor')];

describe('which player a pull is about', () => {
	it('keeps the reader’s choice when the next pull also has them', () => {
		// The whole point: Thunderfist is not first in either roster, and stays selected across the swap.
		const next = [p(9, 'Peremptor'), p(2, 'Thunderfist')];
		expect(resolvePlayerName(FIRST, 'Thunderfist', null)).toBe('Thunderfist');
		expect(resolvePlayerName(next, 'Thunderfist', null)).toBe('Thunderfist');
	});

	it('matches by name and not by actor id, because the id is per report and the name is the reader’s', () => {
		// Same person, different actor id in the second pull. Matching on the id would lose them.
		expect(resolvePlayerName([p(77, 'Thunderfist')], 'Thunderfist', null)).toBe('Thunderfist');
	});

	it('falls through to the linked actor when the choice is not in this pull', () => {
		expect(resolvePlayerName(FIRST, 'Someone Else', 3)).toBe('Peremptor');
	});

	it('falls through to the first of the roster when nothing else answers', () => {
		expect(resolvePlayerName(FIRST, 'Someone Else', 404)).toBe('Sparkstorm');
	});

	it('prefers the choice over the linked actor, so a swap beats the link that opened the page', () => {
		expect(resolvePlayerName(FIRST, 'Peremptor', 1)).toBe('Peremptor');
	});

	it('answers null for an empty roster rather than inventing a name', () => {
		expect(resolvePlayerName([], 'Thunderfist', 1)).toBeNull();
	});
});
