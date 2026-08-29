// The Flame Shock verdict, which is two sentences about the same number and must not read as one.
//
// The section's grade is the worse of two metrics — the dot's uptime and the share of refreshes that
// bought nothing — so a pull that never let the dot off the target can still be graded `bad` on its
// refreshes alone. The graded sentences used to be written as though only uptime could put them
// there, and the `bad` one asserted "the dot spent much of the pull down": a magnitude the number
// beside it contradicted, in a direction ("down") a reader parses as *you failed to apply it*.
//
// Both halves are pinned here: the wording a pull with a gap gets, and the wording a pull with no gap
// gets, at each grade the second metric can produce.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import i18n, { initI18n } from '~/lib/i18n/config';
import { getSpec } from '~/lib/spec';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';

import { resolveBands } from '~/lib/view/targetMode';
import { SpecContext } from '~/components/report/specContext';
import { analyse } from '~/specs/elemental/lib';
import { scoreAnalysis } from '~/specs/elemental/lib/score';

import FlameShock from '../FlameShock';

const ELEMENTAL_SPEC = getSpec('elemental')!;

initI18n();
const t = i18n.getFixedT('en', 'report');

type El = Analysis & ElementalAuditResult;

/**
 * `a:xB3kh7v9pF2AHRtq` #16 — the unbroken pull: one apply, six refreshes, and a dot that is never off
 * the target. Analysed once; each case below overrides the two fields the verdict reads.
 *
 * One of those six refreshes landed on the dot's last tick and five did not, so the pull's own
 * `windowed` is 1 and its refresh share grades `bad`. That is the right reading of the log and it is not
 * what most of these cases are about — they are about which *sentence* each grade produces — so the
 * cases that need a clean refresh ledger say so with `PERFECT_KEEPUP` rather than leaning on the
 * fixture's own number. It used to be 6, back when a 3 000ms setting decided it.
 */
const unbroken: El = analyse(
	JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../__fixtures__/unbroken.json'), 'utf8')) as FightDataset,
) as El;

/**
 * The audit with the refresh ledger rewritten, and with the *whole* ledger rewritten.
 *
 * `snapshotGain` is zeroed unless a case sets it, because the verdict's `wasted` is
 * `refreshes - windowed - ascPrep - snapshotGain` and this fixture's own `snapshotGain` is **3**. A case
 * that forces `windowed` to all six without also clearing that would be describing a pull where nine of
 * six refreshes were excused, and one of them below would print a negative count.
 *
 * The number was written as 2 and measured as 3 — the four raw pulls read 3 / 0 / 0 / 2 for
 * `unbroken` / `phased` / `cleave` / `addsThenBoss`. Nothing turned on it, because every case here
 * zeroes the field rather than reading it, which is exactly why it could drift: **a figure quoted in
 * prose to justify a line of code is not checked by that line of code.**
 */
const withFlameShock = (over: Partial<El['flameShock']>): El => ({
	...unbroken,
	flameShock: { ...unbroken.flameShock, snapshotGain: 0, ...over },
});

const render = (analysis: Analysis) =>
	renderToStaticMarkup(
		createElement(SpecContext.Provider, { value: ELEMENTAL_SPEC }, createElement(FlameShock, { analysis })),
	);

const CASTS = unbroken.flameShock.applies + unbroken.flameShock.refreshes;
/** Every refresh in its tick window: the ledger a `good` refresh share needs. */
const PERFECT_KEEPUP = { windowed: unbroken.flameShock.refreshes };

describe('Flame Shock verdict', () => {
	it('never tells a reader the dot was down without saying what that is a share of', () => {
		// The claim the copy is not allowed to make: a magnitude no number on the page supports, in the
		// one word a reader reads as "you never applied it".
		expect(t('flameShock.verdict', { context: 'bad', uptime: 82.4, casts: 9, wasted: 4 })).not.toContain(
			'much of the pull down',
		);
	});

	/** A real gap: 82.4% uptime, every refresh wasted, so the grade is `bad` on both metrics. */
	it('says which way the uptime figure runs on a pull with a gap', () => {
		const html = render(withFlameShock({ uptimePct: 82.4, windowed: 0 }));
		expect(html).toContain(
			t('flameShock.verdict', {
				context: 'bad',
				uptime: 82.4,
				casts: CASTS,
				wasted: unbroken.flameShock.refreshes,
			}),
		);
		expect(html).toContain('82.4% uptime');
		expect(html).toContain('off the target for the rest of the time you had something to hit');
	});

	/** The pull as it really was: 99.99946% uptime, no wasted refresh. */
	it('says the dot was up the whole time rather than reporting a share of one', () => {
		expect(unbroken.flameShock.uptimePct).toBeGreaterThan(99.995);
		const html = render(withFlameShock(PERFECT_KEEPUP));
		expect(html).toContain(t('flameShock.verdict', { context: 'good_full', casts: CASTS }));
		expect(html).not.toContain('uptime across');
	});

	/**
	 * The pull the reader complained about: nothing wrong with the keep-up, everything wrong with the
	 * refreshes, and a sentence that read as a complaint about the flawless half.
	 */
	it('does not describe a gap on a graded-bad pull that never had one', () => {
		const html = render(withFlameShock({ windowed: 0 }));
		expect(html).toContain(
			t('flameShock.verdict', { context: 'bad_full', casts: CASTS, wasted: unbroken.flameShock.refreshes }),
		);
		expect(html).toContain('The mark is about the refreshes');
		expect(html).not.toContain('off the target for the rest');
		expect(html).not.toContain('much of the pull down');
	});

	/**
	 * The middle grade exists too: one refresh in six outside the window is a 16.7% share, which lands
	 * between the two bands. It is also the singular, which reads without a plural form because the
	 * count is "N of the refreshes" rather than a bare "N refreshes".
	 */
	it('has its own wording for a middling refresh share on a perfect keep-up', () => {
		const html = render(withFlameShock({ windowed: 5 }));
		expect(html).toContain(t('flameShock.verdict', { context: 'ok_full', casts: CASTS, wasted: 1 }));
		expect(html).toContain('1 refreshes clipped a live tick for nothing');
	});

	/**
	 * The band, against the figure the page prints rather than against 100 exactly.
	 *
	 * 99.995 and up renders as `100%` at the two decimals `formatPercentValue` uses, so that is where
	 * the sentence has to change: below it the page shows a gap and the prose has to account for one.
	 */
	it('changes wording where the printed figure changes', () => {
		expect(render(withFlameShock({ ...PERFECT_KEEPUP, uptimePct: 99.994 }))).toContain('99.99% uptime');
		expect(render(withFlameShock({ ...PERFECT_KEEPUP, uptimePct: 99.995 }))).toContain(
			t('flameShock.verdict', { context: 'good_full', casts: CASTS }),
		);
		// A value over 100 was reachable when the numerator was a union of dot windows and the
		// denominator the engaged clock; 100.21% came off a real pull. `c85f6d4` intersects the two before
		// dividing, so the ratio cannot exceed 100 any more and this case is a backstop rather than a live
		// reading. Kept, and kept asserted, because the branch it guards is the one whose failure prints a
		// gap on a pull that never had one — the `unbroken` case above (99.99946%, printing as 100%) is
		// what makes the band necessary, and this is what stops a value past it falling out of the band.
		expect(render(withFlameShock({ ...PERFECT_KEEPUP, uptimePct: 100.21 }))).toContain(
			t('flameShock.verdict', { context: 'good_full', casts: CASTS }),
		);
	});

	it('still says nothing was cast rather than claiming a perfect pull', () => {
		const never = withFlameShock({ windows: [], uptimePct: 0, applies: 0, refreshes: 0, presses: [] });
		expect(render(never)).toContain(t('flameShock.verdict', { context: 'none' }));
	});
});

/**
 * The `good` band has room in it, and the `good` sentence had none.
 *
 * `flameShockWaste` grades `good` at 10% of refreshes wasted or better, so ten refreshes with one that
 * threw away a tick for nothing is a `good` pull — and `verdict_good` said "every refresh bought
 * something" over it. That is the same shape as the two false claims this session already corrected:
 * `lightningShield` asserting the shield never overcapped where the overcap was never measured, and
 * Earth Shock's "never cast" printed over twelve presses. A `good` band with headroom cannot carry an
 * absolute claim.
 *
 * Not reachable on a committed pull, which is why it survived: `unbroken` has six refreshes and one
 * inside its own last tick, so its real share is 83% and it grades `bad`; `phased` grades `ok`; `cleave`
 * refuses at `MIN_GRADED_SAMPLE`. So the pull is hand-written on `unbroken`'s ledger the way the cases
 * above are — ten refreshes, nine of them on the last tick, one wasted, which is exactly 10%.
 *
 * Both halves are asserted: the clean pull keeps the absolute claim word for word, and the pull with one
 * wasted refresh names the count instead of denying it.
 */
describe('a good Flame Shock verdict claims only what the share can support', () => {
	/** Ten refreshes, nine credited: 10% wasted, the top of the `good` band exactly. */
	const AT_THE_TOP = { refreshes: 10, windowed: 9 };
	const TOP_CASTS = unbroken.flameShock.applies + AT_THE_TOP.refreshes;

	/**
	 * The premise, so nothing below is vacuous: this ledger really does grade `good`, and really does
	 * hold a refresh that bought nothing. If a later change moves either, the assertions after this are
	 * about a pull they were not written for.
	 */
	it('is a good pull with a wasted refresh in it', () => {
		const analysis = withFlameShock({ ...AT_THE_TOP, uptimePct: 96 });
		const card = scoreAnalysis(analysis, resolveBands(analysis.targets, 'auto'));
		const waste = card.sections['flameShock']?.metrics.find((m) => m.key === 'flameShockWaste');
		expect(waste?.value).toBe(10);
		expect(waste?.grade).toBe('good');
		expect(waste?.unmeasurable).toBe(false);
		expect(card.sections['flameShock']?.grade).toBe('good');
		// The count the sentence has to account for, off the same four terms the section reads.
		const fs = analysis.flameShock;
		expect(fs.refreshes - fs.windowed - fs.ascPrep - fs.snapshotGain).toBe(1);
	});

	it('does not tell a reader every refresh bought something when one did not', () => {
		const html = render(withFlameShock({ ...AT_THE_TOP, uptimePct: 96 }));
		// The sentence the old code printed here, verbatim.
		expect(html).not.toContain('casts, and every refresh bought something');
		expect(html).toContain(t('flameShock.verdict', { context: 'goodSome', uptime: 96, casts: TOP_CASTS, wasted: 1 }));
		// The number, and something to do about it — not a hedge in place of the claim.
		expect(html).toContain('96% uptime across 11 casts');
		expect(html).toContain('the dot is not what is holding this pull back');
		expect(html).toContain('1 refreshes still clipped a live tick');
		expect(html).toContain('Hold to the last tick');
	});

	/**
	 * The other way a `good` pull can hold a wasted refresh, and the reason the claim is chosen on the
	 * pull-wide count rather than on the graded share.
	 *
	 * A refresh made with more than one enemy up leaves the graded share entirely, so the numerator can be
	 * zero — a flat `good`, no headroom needed — while the ledger the section's own tiles print holds
	 * several. The sentence leads with the pull-wide figure for the reason `8e011ac` set (an unmeasured
	 * figure is not a deleted one) and `wasteSplit` follows saying how much of it was counted, so an
	 * absolute claim in front of that clause contradicts the clause after it. It is also why no quantifier
	 * over the refreshes is safe here: this pull wasted three of thirteen and nothing in the band says it
	 * could not have been twelve.
	 */
	it('names the refreshes it did not measure rather than claiming there were none', () => {
		const spread = withFlameShock({ refreshes: 13, windowed: 10, unjudgedRefreshes: 3, unjudgedWaste: 3 });
		const card = scoreAnalysis(spread, resolveBands(spread.targets, 'auto'));
		const waste = card.sections['flameShock']?.metrics.find((m) => m.key === 'flameShockWaste');
		// Nothing wasted among the ten refreshes made with one enemy up, so the share is a flat zero.
		expect(waste?.value).toBe(0);
		expect(card.sections['flameShock']?.grade).toBe('good');
		const html = render(spread);
		expect(html).not.toContain('casts, and every refresh bought something');
		expect(html).toContain('3 refreshes still clipped a live tick for nothing');
		// And the clause that says how much of that three was counted still follows it.
		expect(html).toContain('3 of those came with more than one enemy up');
	});

	/** The same defect on the perfect-keep-up wording, which called the pull perfect and stopped there. */
	it('does not call a pull perfect over a refresh that threw away a tick', () => {
		const html = render(withFlameShock(AT_THE_TOP));
		expect(html).toContain(t('flameShock.verdict', { context: 'goodSome_full', casts: TOP_CASTS, wasted: 1 }));
		expect(html).toContain('The dot never dropped');
		expect(html).toContain('1 refreshes still clipped a live tick');
		// The keep-up really was perfect and the sentence still says so — the correction is to the silence
		// about the refresh, not to the praise.
		expect(html).toContain('A perfect keep-up');
	});

	/**
	 * The pull that earns the absolute claim keeps it, byte for byte. This is the half a hedge would have
	 * cost, and it is the reason `goodSome` is a fourth sentence rather than a rewrite of the third.
	 */
	it('still says every refresh bought something when every refresh did', () => {
		const clean = render(withFlameShock({ refreshes: 10, windowed: 10, uptimePct: 96 }));
		expect(clean).toContain(t('flameShock.verdict', { context: 'good', uptime: 96, casts: TOP_CASTS }));
		expect(clean).toContain('96% uptime across 11 casts, and every refresh bought something.');
		const cleanFull = render(withFlameShock({ ...PERFECT_KEEPUP }));
		expect(cleanFull).toContain(t('flameShock.verdict', { context: 'good_full', casts: CASTS }));
		expect(cleanFull).toContain('A perfect keep-up.');
		expect(cleanFull).not.toContain('threw away a tick');
	});
});
