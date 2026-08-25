// What reaches the summary, and what deliberately does not move the letter beside it.
//
// This spec grades two things and its `score.ts` header spends a page saying why everything else is
// described rather than judged. Two more cards were added when the report grew Externals and Haste
// sections, and the distinction they turn on is the one worth a test: a card is *drawn* from
// `sections`, and the overall grade is computed from a separate list. Both new metrics are in the
// first and neither is in the second.
//
// That is not a technicality. An unused external is somebody else's press and a haste figure is the
// gear the player walked in wearing; charging either against a letter that reads as a verdict on their
// play would be the fabricated fault this spec was ported to remove, in a new place.

import { describe, expect, it } from 'vitest';

import { rawFixture } from '~/lib/analysis/fixtures';
import { analyse } from '~/specs/protection/lib';
import { scoreAnalysis, WEIGHTS } from '~/specs/protection/lib/score';
import type { Grade } from '~/lib/score';

const scoreOf = (name: string) => scoreAnalysis(analyse(rawFixture('protection', `${name}.json`)));

describe('the Protection scorecard', () => {
	/**
	 * Four cards on every pull, keyed by the section that argues each one.
	 *
	 * `specSections.tsx` maps these keys to page anchors, and a card whose key has no anchor renders
	 * without a link — which is what every Protection card did until that map gained an entry.
	 */
	it.each(['garrosh', 'paragons', 'fallenProtectors', 'galakras', 'spoils'])('%s draws four cards', (name) => {
		expect(Object.keys(scoreOf(name).sections).sort()).toEqual(['cooldownDrift', 'externals', 'globals', 'haste']);
	});

	/**
	 * The externals figure, and the spread is what says the line measures something.
	 *
	 * Two pulls used everything their raid had, one missed a seventh of it, and two missed more than
	 * half. Counted per *slot* rather than per button, so the two Hands nobody pressed on Galakras are
	 * the one chance they really were.
	 */
	it.each([
		['garrosh', 0, 'good'],
		['paragons', 14.3, 'good'],
		['fallenProtectors', 0, 'good'],
		['galakras', 57.1, 'ok'],
		['spoils', 42.9, 'ok'],
	] as const)('%s missed %f% of the externals it was offered', (name, share, grade: Grade) => {
		const card = scoreOf(name).sections['externals'];
		expect(card?.metrics[0]?.value).toBeCloseTo(share, 1);
		expect(card?.metrics[0]?.grade).toBe(grade);
	});

	/**
	 * Haste is capped at reaching the breakpoint, and every committed pull is past it.
	 *
	 * The cap is the reason this can be graded at all — a metric that kept rewarding haste past 1.5x
	 * would be making exactly the claim `Haste.tsx` argues against. All five read 100 because this is one
	 * character in one kit; a pull under the line is what would move it, and none is committed.
	 */
	it.each(['garrosh', 'paragons', 'fallenProtectors', 'galakras', 'spoils'])('%s reaches the breakpoint', (name) => {
		const card = scoreOf(name).sections['haste'];
		expect(card?.metrics[0]?.value).toBe(100);
		expect(card?.metrics[0]?.grade).toBe('good');
	});

	/**
	 * Neither new card moves the overall letter, asserted from both ends.
	 *
	 * The weights record carries them at nought so it stays total and the decision is visible, and
	 * `overallOf` is handed only the two graded metrics — so even a weight typo could not let them in.
	 */
	it('keeps the raid’s habits and the player’s gear out of the player’s grade', () => {
		expect(WEIGHTS.externalsMissed).toBe(0);
		expect(WEIGHTS.hasteToBreakpoint).toBe(0);

		// Galakras is the proof: its externals card is `ok` and its haste card is `good`, and the overall
		// is `bad` — taken from the globals and cooldown figures alone.
		const galakras = scoreOf('galakras');
		expect(galakras.sections['externals']?.metrics[0]?.grade).toBe('ok');
		expect(galakras.sections['haste']?.metrics[0]?.grade).toBe('good');
		expect(galakras.overall).toBe('bad');
	});
});
