import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { scoreAnalysis } from '~/lib/score';
import type { Analysis } from '~/lib/types';

import i18n, { initI18n } from '../config';

initI18n();

function fixture(name: string): Analysis {
	return JSON.parse(readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8'));
}

const t = i18n.getFixedT('en', 'report');

/** The same call the sections make, so a broken key fails here rather than rendering raw on screen. */
function verdict(analysis: Analysis, section: string, values: Record<string, unknown> = {}) {
	const score = scoreAnalysis(analysis).sections[section];
	const context = score === undefined || score.unmeasurable ? 'none' : score.grade;
	return t(`${section}.verdict`, { context, ...values });
}

describe('report copy', () => {
	it('picks a different sentence for a strong pull than a poor one', () => {
		const strong = fixture('strong');
		const poor = fixture('poor');

		const a = verdict(strong, 'snapshots', { caught: 12, total: 16, rate: 75 });
		const b = verdict(poor, 'snapshots', { caught: 2, total: 9, rate: 22.2 });

		expect(a).not.toBe(b);
		expect(a).toContain('12 of 16');
		expect(b).toContain('2 of 9');
	});

	/** A key that does not resolve comes back as the key itself, which is the bug to catch. */
	it('resolves every section verdict in every grade', () => {
		const sections = ['snapshots', 'brew', 'casts', 'debuff', 'tigerPalm', 'karma'];
		for (const section of sections) {
			for (const context of ['good', 'ok', 'bad', 'none']) {
				const text = t(`${section}.verdict`, { context, count: 2, casts: 2 });
				expect(text, `${section}.verdict_${context}`).not.toContain('verdict');
				expect(text.length, `${section}.verdict_${context}`).toBeGreaterThan(10);
			}
		}
	});

	it('resolves every section intent', () => {
		for (const section of ['snapshots', 'brew', 'casts', 'debuff', 'tigerPalm', 'karma', 'damage', 'misses']) {
			const text = t(`${section}.intent`);
			expect(text, `${section}.intent`).not.toBe(`${section}.intent`);
		}
	});

	/** The bug that started this: a raw float rendered mid-sentence next to a formatted tile. */
	it('formats interpolated numbers through the shared helpers', () => {
		expect(t('brew.verdict', { context: 'good', count: 7, avg: 9.714285714285714 })).toContain('9.7');
		expect(t('brew.verdict', { context: 'good', count: 7, avg: 9.714285714285714 })).not.toContain('9.714');
		// One decimal, matching formatPercentValue — the same string the KPI tile prints.
		expect(t('casts.verdict', { context: 'good', used: 83.6, cpm: 31.59 })).toContain('83.6%');
		expect(t('casts.verdict', { context: 'good', used: 83.6, cpm: 31.59 })).toContain('31.6');
	});

	/**
	 * The potion copy, whose whole job is to name the slot that went unfilled.
	 *
	 * The two variants have to resolve and have to be different sentences: the metric's value is `1 of
	 * 2` either way, and pointing a player who missed the in-combat potion at the pre-pull one is worse
	 * advice than none at all. `note_early` is the caption for that same slot filled from inside the
	 * fight, and the one thing it must not say is the base sentence's "no press above it" — that bar
	 * has a press above it.
	 */
	it('names each potion slot with its own sentence', () => {
		const both = { value: 1, target: 2 };
		const prepull = t('summary.takeaways.metric.potionsUsed.fix', { context: 'prepull', ...both });
		const combat = t('summary.takeaways.metric.potionsUsed.fix', { context: 'combat', ...both });
		expect(prepull).not.toBe(combat);
		expect(prepull).toContain('pre-pull one');
		expect(combat).toContain('in-combat one');

		const early = t('castLog.prePull.note', { context: 'early', aura: "Virmen's Bite", drunk: '92ms' });
		expect(early).toContain('92ms');
		expect(early).not.toContain('no press above it');
		expect(early).not.toBe(t('castLog.prePull.note', { aura: "Virmen's Bite" }));
	});

	it('agrees in number', () => {
		expect(t('snapshots.lastGcd', { count: 1 })).toContain('its proc');
		expect(t('snapshots.lastGcd', { count: 6 })).toContain('theirs');
		expect(t('misses.summary', { count: 1 })).toContain('thing');
		expect(t('misses.summary', { count: 30 })).toContain('things');
	});
});
