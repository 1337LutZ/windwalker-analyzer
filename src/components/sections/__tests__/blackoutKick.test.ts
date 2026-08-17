// What the section says, as opposed to what it measures — `lib/view/__tests__/blackoutKick.test.ts`
// holds the arithmetic. Everything here is about a sentence a reader could act on wrongly.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import i18n, { initI18n } from '~/lib/i18n/config';
import type { Analysis, TargetMode } from '~/lib/types';

import BlackoutKick from '../BlackoutKick';

initI18n();
const t = i18n.getFixedT('en', 'report');

const fixture = (name: string): Analysis =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../lib/__fixtures__/${name}.json`), 'utf8'));

const render = (analysis: Analysis, mode: TargetMode | null = null) =>
	renderToStaticMarkup(createElement(BlackoutKick, { analysis, mode }));

/** React escapes apostrophes in a text node, so copy carrying one has to be escaped to match. */
const escaped = (copy: string) => copy.replace(/'/g, '&#x27;');

describe('Blackout Kick section', () => {
	/**
	 * The table the section exists for: of the globals spent on this button, what the list wanted
	 * instead. Exhaustive rather than a pair of hand-picked comparisons, so the reader sees the mistake
	 * they actually make — on `strong` that is Chi Wave and Jab, not the Tiger Palm somebody asked about.
	 */
	it('names what the list wanted at the globals it took', () => {
		const html = render(fixture('strong'), 'single');
		expect(html).toContain(t('blackoutKick.wantedCaption'));
		expect(html).toContain(t('priority.rule.chi-wave'));
		expect(html).toContain(t('priority.rule.jab'));
		expect(html).toContain(t('priority.rule.tiger-palm-refresh'));
	});

	/**
	 * The starvation half, in the currency the rest of the report already loses casts in. `strong` gives
	 * away 43.6 seconds of a button on an eight-second cooldown, which is five kicks — the single
	 * biggest thing this pull does wrong, and invisible to every other section.
	 */
	it('charges the kick it starved to the press that starved it', () => {
		const html = render(fixture('strong'), 'single');
		expect(html).toContain(t('blackoutKick.kpi.starved'));
		expect(html).toContain('43.6s');
		expect(html).toContain(escaped(t('blackoutKick.starveKicks', { count: 5 })));
		expect(html).toContain(t('blackoutKick.starveCaption'));
	});

	/**
	 * The finding that stops the ledger reading as "you broke the list". The sim's dump rule guards with
	 * an energy reserve while the failure is a chi one, so presses it wanted starve the kick anyway.
	 */
	it('says when the presses it charges are presses the list wanted', () => {
		const html = render(fixture('strong'), 'single');
		expect(html).toContain(escaped(t('blackoutKick.starveFollowed', { count: 6 })));
		// And says nothing at a reading where the list wanted none of them, rather than printing a zero.
		// The same seventeen presses: read at three targets the list wanted none of them dumped at all,
		// which is exactly why the sentence is the one figure in this half that follows the band.
		expect(render(fixture('strong'), 'multi')).not.toContain(escaped(t('blackoutKick.starveFollowed', { count: 0 })));
	});

	/**
	 * The two halves answer to different things, and the note has to be beside the verdicts rather than
	 * only at the control: the ladder's reading of these presses moves enormously with the band, and the
	 * seconds charged below do not move at all.
	 */
	it('reads the presses at the band it was handed and the waits at none', () => {
		const analysis = fixture('strong');
		const single = render(analysis, 'single');
		const multi = render(analysis, 'multi');
		expect(single).toContain(escaped(t('blackoutKick.ladder', { context: 'some', count: 109, followed: 56 })));
		expect(multi).toContain(escaped(t('blackoutKick.ladder', { context: 'some', count: 73, followed: 7 })));
		// The same seconds under both readings, and the note that promises it.
		expect(single).toContain('43.6s');
		expect(multi).toContain('43.6s');
		expect(single).toContain(escaped(t('blackoutKick.starveUnbanded')));
	});

	/** Every number here rests on a reconstructed bar, and each pull states its own score for it. */
	it('states the accuracy of the bar it judged on', () => {
		expect(render(fixture('strong'), 'single')).toContain(
			escaped(t('blackoutKick.reconstructed', { accuracy: (154 / 177) * 100 })),
		);
		// A different pull, a different score — never the ladder note's quoted range.
		expect(render(fixture('cleave'), 'multi')).toContain(
			escaped(t('blackoutKick.reconstructed', { accuracy: (40 / 59) * 100 })),
		);
	});

	/** Nothing is graded, and the section says why rather than leaving the absence to be noticed. */
	it('says nothing is graded', () => {
		expect(render(fixture('poor'), 'single')).toContain(escaped(t('blackoutKick.notGraded')));
	});

	/**
	 * A pull where the button never starved a kick must say so rather than print a zero, and it must not
	 * carry the tier caveat either — there are no rows for it to be about.
	 */
	it('says no kick waited rather than printing a zero', () => {
		const analysis = fixture('strong');
		const clean: Analysis = {
			...analysis,
			blackoutKick: { ...analysis.blackoutKick!, charged: [], chargedMs: 0, starvedMs: 0, starvedWaits: 0 },
		};
		const html = render(clean, 'single');
		expect(html).toContain(escaped(t('blackoutKick.starveNone')));
		expect(html).not.toContain(t('blackoutKick.starveCaption'));
		expect(html).not.toContain(escaped(t('blackoutKick.tierCaveat')));
	});

	/** An analysis captured before the audit existed says so, rather than reporting a clean pull. */
	it('says the audit is missing rather than reporting nothing wrong', () => {
		const analysis = fixture('strong');
		const legacy: Analysis = { ...analysis };
		delete legacy.blackoutKick;
		const html = render(legacy, 'single');
		expect(html).toContain(escaped(t('blackoutKick.starveMissing')));
		expect(html).not.toContain(escaped(t('blackoutKick.starveNone')));
		// The ladder half still stands: it needs nothing the audit provides.
		expect(html).toContain(t('blackoutKick.wantedCaption'));
	});

	/** A monk who never pressed it is not a monk who pressed it badly. */
	it('declines to judge a pull that never pressed it', () => {
		const analysis = fixture('strong');
		const never: Analysis = { ...analysis, blackoutKick: { ...analysis.blackoutKick!, casts: 0 } };
		const html = render(never, 'single');
		expect(html).toContain(escaped(t('blackoutKick.none')));
		expect(html).not.toContain(t('blackoutKick.kpi.followed'));
	});

	/** The heading renders whatever the pull held, because the nav is built from the same list. */
	it('renders its heading in every state', () => {
		for (const name of ['strong', 'mixed', 'poor', 'waves', 'cleave', 'weave']) {
			expect(render(fixture(name)), name).toContain('id="blackout-kick-heading"');
		}
	});
});
