import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import i18n, { initI18n } from '~/lib/i18n/config';
import type { Analysis, FightDataset } from '~/lib/types';
import { analyse as analyseElemental } from '~/specs/elemental';

import { bandForMode, bandsInPull, resolveBands, TARGET_MODE_CHOICES, resolveTargetMode } from '../targetMode';

initI18n();
const t = i18n.getFixedT('en', 'report');

describe('resolveTargetMode', () => {
	it('follows the detection when the reader has not asked for anything', () => {
		expect(resolveTargetMode('multi', 'auto')).toEqual({ mode: 'multi', detected: 'multi', overridden: false });
	});

	/**
	 * The case the override exists for: a player who ignored the adds to parse played the single-target
	 * rotation, and the detection saying otherwise is a fact about the pull rather than about them.
	 */
	it('takes the reader’s word and keeps what was detected beside it', () => {
		expect(resolveTargetMode('multi', 'single')).toEqual({ mode: 'single', detected: 'multi', overridden: true });
	});

	/** Choosing what was already detected is not a disagreement, so nothing has to be said about it. */
	it('is not an override when the choice agrees with the detection', () => {
		expect(resolveTargetMode('single', 'single').overridden).toBe(false);
	});

	/**
	 * An analysis captured before the counts existed has no detected mode, and this must not invent
	 * one: a caller handed `'single'` here would grade a pull against the single-target list on the
	 * strength of a guess.
	 */
	it('says nothing was detected rather than defaulting to one', () => {
		expect(resolveTargetMode(undefined, 'auto')).toEqual({ mode: null, detected: null, overridden: false });
		expect(resolveTargetMode(undefined, 'multi')).toEqual({ mode: 'multi', detected: null, overridden: false });
	});
});

/**
 * The control's own copy, enumerated here rather than checked by the key test — it reads its labels
 * out of a record keyed by the choice, and that test can only see literal keys.
 */
describe('target mode copy', () => {
	it('names every choice', () => {
		for (const choice of TARGET_MODE_CHOICES) {
			expect(t(`targets.${choice}`)).not.toBe(`targets.${choice}`);
		}
	});

	it('says what was detected, in both modes, and what an override contradicts', () => {
		for (const mode of ['single', 'multi'] as const) {
			expect(t('targets.detected', { context: mode, share: 40 })).toContain('40');
			expect(t('targets.overridden', { context: mode })).not.toBe('targets.overridden');
		}
		expect(t('targets.detectedNone')).not.toBe('targets.detectedNone');
	});
});

/**
 * The reading a mode cannot give, measured on the pulls we hold.
 *
 * Both fixture families, because the two say different halves of it. The Windwalker's are pre-analysed
 * `Analysis` objects, so they cost nothing and there are six of them; the Elemental's are raw datasets
 * run through `analyse`, and they are the three pulls the exemption was designed against.
 */
const windwalker = (name: string): Analysis =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../specs/windwalker/__fixtures__/${name}.json`), 'utf8'));

const elemental = (name: string): Analysis =>
	analyseElemental(
		JSON.parse(
			readFileSync(resolve(import.meta.dirname, `../../../specs/elemental/__fixtures__/${name}.json`), 'utf8'),
		) as FightDataset,
	);

describe('resolveBands', () => {
	/**
	 * The bug, in one assertion. `strong` is detected single-target — and it spends time at two, three
	 * and four enemies. Every metric on it is graded today against whichever single list its one-word
	 * mode named, and the four bands are what says otherwise.
	 */
	it('reads a mixed pull as the several bands it was fought at', () => {
		expect(resolveBands(windwalker('strong').targets, 'auto')).toEqual({
			bands: [1, 2, 3, 4],
			// The lossy arm, carried beside the set rather than replaced by it: the mode is what the
			// whole-pull weights still ask for, and on this pull it is the reading the four bands contradict.
			mode: 'single',
			forced: false,
		});
		expect(bandForMode('single')).toBe(1);
	});

	/** The Elemental pull the reported bug came off: eleven metrics, a hundred and twenty-one windows, all four bands. */
	it('reads the cleave pull as all four bands', () => {
		expect(resolveBands(elemental('cleave').targets, 'auto').bands).toEqual([1, 2, 3, 4]);
	});

	/**
	 * Deliberate no-change guards: neither `phased` nor `unbroken` ever exceeds one enemy, so band 1 is
	 * the whole of both pulls and no band declaration can move a metric on either. They are here to
	 * prove that, not as evidence that anything separates.
	 */
	it('reads the two single-target pulls as band 1 alone', () => {
		expect(resolveBands(elemental('phased').targets, 'auto').bands).toEqual([1]);
		expect(resolveBands(elemental('unbroken').targets, 'auto').bands).toEqual([1]);
		// Deliberate no-change guard, Windwalker side: `weave` is the one monk fixture that never cleaves.
		expect(resolveBands(windwalker('weave').targets, 'auto').bands).toEqual([1]);
	});

	/**
	 * The reader's override is a mode, so it narrows to one band — and it is marked `forced`, because a
	 * pull read at one band on the reader's word is a different fact from one that was fought at one.
	 */
	it('narrows to the one band the reader forced', () => {
		expect(resolveBands(windwalker('cleave').targets, 'single')).toEqual({ bands: [1], mode: 'single', forced: true });
		expect(resolveBands(windwalker('cleave').targets, 'multi')).toEqual({ bands: [3], mode: 'multi', forced: true });
	});

	/**
	 * A pull with no counts says nothing rather than defaulting, the same refusal `resolveTargetMode`
	 * makes. Never the empty array: empty would read as "no band applies" and exempt every banded rule
	 * at once.
	 */
	it('says nothing was detected rather than inventing a band', () => {
		expect(bandsInPull(undefined)).toBeNull();
		expect(resolveBands(undefined, 'auto')).toEqual({ bands: null, mode: null, forced: false });
	});
});
