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
import { scoreAnalysis, THRESHOLDS, WEIGHTS } from '~/specs/protection/lib/score';
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
	 * The externals card speaks only where the pull gave it something to be about.
	 *
	 * Both figures carry Symbiosis Barkskin, which no pull in the capture set ever received — the raid's
	 * Druid gave Symbiosis to somebody else on all five — so it is a genuine unused slot on every one.
	 *
	 * Garrosh and Paragons spent 9.7s and 5.9s against the Vengeance ceiling, which is the state an
	 * external is for — so what the raid did or did not press is worth a card there. The other three
	 * never reached it and nobody died on any of the five, so the card stays quiet rather than telling a
	 * reader their healers missed something neither of them needed.
	 *
	 * **Galakras is the case that shows this is a calibration and not a filter.** It has the worst
	 * externals figure of the five — five of seven slots unused — and it is silent, because the tank
	 * peaked at half their ceiling and finished the pull alive. The section still lists every row and
	 * still names what went unused; only the summary card is withheld.
	 */
	it.each([
		['garrosh', 12.5, 'good'],
		// Exactly on the `good` line, which is `<= 25` — a quarter of the slots unused is a raid using most
		// of what it has.
		['paragons', 25, 'good'],
	] as const)('%s missed %f% of the externals it was offered', (name, share, grade: Grade) => {
		const card = scoreOf(name).sections['externals'];
		expect(card?.metrics[0]?.unmeasurable).toBe(false);
		expect(card?.metrics[0]?.value).toBeCloseTo(share, 1);
		expect(card?.metrics[0]?.grade).toBe(grade);
	});

	it.each(['fallenProtectors', 'galakras', 'spoils'])('%s says nothing about externals it never needed', (name) => {
		expect(scoreOf(name).sections['externals']?.metrics[0]?.unmeasurable).toBe(true);
	});

	/**
	 * Haste reads its own figure against the breakpoint, not a share of it.
	 *
	 * 52.8% against a target of 50%, which is the pair the Haste section prints and the pair a player
	 * reads off their gear. It was a percentage *of* the breakpoint capped at 100, so the card said
	 * "target 100% or better" — a number matching nothing anywhere else in the report.
	 *
	 * All five read the same because this is one character in one kit; a pull under the line is what
	 * would move it, and none is committed.
	 */
	it.each(['garrosh', 'paragons', 'fallenProtectors', 'galakras', 'spoils'])('%s reads its real haste', (name) => {
		const card = scoreOf(name).sections['haste'];
		expect(card?.metrics[0]?.value).toBeCloseTo(52.8, 1);
		expect(card?.metrics[0]?.grade).toBe('good');
	});

	/** And the target is the sim's own line rather than a number somebody typed. */
	it('aims at the breakpoint the global stops improving at', () => {
		expect(THRESHOLDS.hasteToBreakpoint.good).toBeCloseTo(50, 10);
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

		// Paragons is the proof: both new cards carry a real figure and the overall is taken from the
		// globals and cooldown metrics alone, which is the only list `overallOf` is handed.
		const paragons = scoreOf('paragons');
		expect(paragons.sections['externals']?.metrics[0]?.grade).toBe('good');
		expect(paragons.sections['haste']?.metrics[0]?.grade).toBe('good');
		expect(paragons.overall).toBe('good');
	});
});
