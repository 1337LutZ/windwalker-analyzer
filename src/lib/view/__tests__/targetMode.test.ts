import { describe, expect, it } from 'vitest';

import i18n, { initI18n } from '~/lib/i18n/config';

import { TARGET_MODE_CHOICES, resolveTargetMode } from '../targetMode';

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
