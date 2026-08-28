// What a section says when part of it — or all of it — was never asked of this pull.
//
// `metricOf` nulls a metric whose declared target counts the reading never enters, and marks it
// `exempt`. Two shapes come out of that, and until this file they were both wrong on the page:
//
//   1. **Every metric in the section exempt.** `gradeOf` answers `exempt`, `verdict()` looks for
//      `<section>.verdict_exempt` and falls back to `verdict_none` — which for three Elemental sections
//      is a sentence saying the button was never pressed. Read as multi-target, `cleave` printed "Earth
//      Shock was never cast in this pull" over a table of fifteen shocks. Exactly the bug shape
//      `f832015` fixed for Tiger Palm, in three more places.
//   2. **Some metrics exempt and one not.** `section()` reads the letter off whatever is left, which is
//      right, and the sentence under it then names the figure nothing measured — `searingTotem`'s
//      `verdict_good` opens "{{uptime}} uptime", and `lightningShield`'s claims the shield "never sat at
//      seven past the leeway", which is a positive statement about a duration no clock was taken over.
//      The letter is kept and the wording narrowed; the argument for keeping it is at the top of
//      `SearingTotem.tsx`.
//
// The reading is resolved through `resolveBands` rather than assembled here, so the band set these
// sections are graded at is the one the page hands them — and `auto` is asserted alongside every case as
// the no-change guard, because a fix that changed the sentence on a pull nobody forced would be a
// regression wearing the same diff.
//
// `createElement` rather than JSX so this stays a `.ts` file and is picked up by the project's own
// vitest include patterns.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import i18n, { initI18n } from '~/lib/i18n/config';
import { getSpec } from '~/lib/spec';
import { resolveBands, type TargetModeChoice } from '~/lib/view/targetMode';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';

import { ScoreViewContext } from '~/components/report/scoreViewContext';
import { SpecContext } from '~/components/report/specContext';
import { analyse } from '~/specs/elemental/lib';

import EarthShock from '../EarthShock';
import FlameShock from '../FlameShock';
import LightningShield from '../LightningShield';
import SearingTotem from '../SearingTotem';

const ELEMENTAL_SPEC = getSpec('elemental')!;
initI18n();
const t = i18n.getFixedT('en', 'report');

type El = Analysis & ElementalAuditResult;

const analysed = (name: string): El =>
	analyse(
		JSON.parse(
			readFileSync(resolve(import.meta.dirname, `../../../__fixtures__/${name}.json`), 'utf8'),
		) as FightDataset,
	) as El;

const render = (
	Component: (props: { analysis: Analysis }) => ReactNode,
	analysis: El,
	choice: TargetModeChoice,
): string =>
	renderToStaticMarkup(
		createElement(
			SpecContext.Provider,
			{ value: ELEMENTAL_SPEC },
			createElement(
				ScoreViewContext.Provider,
				{ value: resolveBands(analysis.targets, choice) },
				createElement(Component as never, { analysis }),
			),
		),
	);

/**
 * The graded sentence alone, rather than the whole section.
 *
 * Every one of these sections renders its verdict as the last `Prose` paragraph, and the assertions below
 * need to be about that paragraph and not about the page: a section's `none` key is both the verdict
 * for a pull with no window *and* the empty state of the table above it, so "the section does not contain
 * that sentence" is unsatisfiable on a pull whose table is empty and says nothing about the verdict either
 * way.
 */
const verdictOf = (html: string): string => {
	const paragraphs = [...html.matchAll(/<p class="m-0 max-w-\[64ch\][^"]*">([\s\S]*?)<\/p>/g)];
	expect(paragraphs.length, 'no graded sentence found — has `Prose` changed shape?').toBeGreaterThan(0);
	return paragraphs.at(-1)?.[1] ?? '';
};

/** The one committed pull that ever exceeds two enemies, so the one with presses at every band. */
const cleave = analysed('cleave');
/** A single-target pull, so a forced multi-target reading exempts its rules and excuses nothing real. */
const phased = analysed('phased');
/** The pull that never dropped the dot, which is the one that reaches Flame Shock's `_full` wording. */
const unbroken = analysed('unbroken');

describe('a section whose only graded metric was never asked', () => {
	/**
	 * Searing Totem: the uptime is `bands: [1, 2]` and the overlap count has no scope at all, so a
	 * multi-target reading leaves the letter resting on `feOverlaps` alone — 0 on all three committed
	 * pulls, which is a `good`.
	 *
	 * Three things are asserted together because the claim is that they agree: the letter survives, the
	 * sentence says which figure it is about, and the un-measured percentage is still printed with its own
	 * caption rather than deleted. The old sentence must be gone as well: `verdict_good` is "{{uptime}}
	 * uptime, and no press landed over a live totem", so on this reading the page used to open with a
	 * percentage nothing had measured and then credit the pull for it.
	 */
	it('says which figure the letter is about, and keeps the one it is not', () => {
		const html = render(SearingTotem, phased, 'multi');
		expect(verdictOf(html)).toContain('nothing in the multi-target order asks for a fire totem');
		expect(verdictOf(html)).toContain('no Searing Totem of yours went down while the Fire Elemental was holding it');
		// The number stays, and the tile beside it says what it is.
		expect(html).toContain(`Totem uptime — ${t('metric.notAsked')}`);
		expect(html).toContain('79.84%');
		// And the sentence that used to be printed here is not.
		expect(verdictOf(html)).not.toContain('and no press landed over a live totem');
	});

	/**
	 * Lightning Shield, where the old wording was worse than a mislead: `verdict_good` asserts the shield
	 * "never sat at seven past the leeway", and on `phased` it sat there for a real duration that simply
	 * was not measured on this reading.
	 */
	it('stops claiming the shield never overcapped when the overcap was not measured', () => {
		expect(phased.lightningShield.overcapMs).toBeGreaterThan(0);
		const html = render(LightningShield, phased, 'multi');
		expect(verdictOf(html)).toContain('nothing in the multi-target order spends the shield');
		expect(verdictOf(html)).toContain('Rolling Thunder returns 2% of your maximum mana per charge');
		// 12.4s of it, still printed and still named — an unmeasured figure is not a deleted one. It was
		// 17.6s until the overcap clock stopped running through Ascendance, where the shock is not to be
		// pressed and the charges the hold produces are not a fault.
		expect(verdictOf(html)).toContain('12.4s');
		expect(html).toContain(`Time at max stacks — ${t('metric.notAsked')}`);
		expect(verdictOf(html)).not.toContain('The shield never sat at seven past the leeway');
	});

	/**
	 * The no-change guard for both, labelled: under the reading a reader gets without touching anything,
	 * every one of these rules is asked and the sentences are the ones they always were.
	 */
	it('leaves both sections alone on the reading nobody forced', () => {
		// `phased` grades `ok` on the totem and on the shield under its own reading, so the guards are
		// against those two sentences rather than against the `good` ones the forced reading produced above.
		// `phased` clips nothing, so its own reading takes the totem's `ok` sentence at a count of nought —
		// the arm that stopped saying "0 presses clipped a healthy totem, throwing away 0s of its dot". The
		// second assertion is what keeps this a guard on the `ok` arm rather than on either arm that reads
		// nought, since `bad` at nought opens on the same clause and then asks for the totem back.
		expect(verdictOf(render(SearingTotem, phased, 'auto'))).toContain(
			'79.84% uptime, and no press landed over a live totem',
		); // no-change guard, reworded with the string itself
		expect(verdictOf(render(SearingTotem, phased, 'auto'))).not.toContain('put the totem back the moment it drops');
		expect(verdictOf(render(LightningShield, phased, 'auto'))).toContain(
			'The shield sat at seven for 12.4s past the leeway',
		); // no-change guard
		for (const html of [render(SearingTotem, phased, 'auto'), render(LightningShield, phased, 'auto')]) {
			expect(html).not.toContain(t('metric.notAsked')); // no-change guard
		}
	});
});

describe('a section none of whose rules were asked', () => {
	/**
	 * The three sections whose every metric carries a scope, on the pull that actually pressed the buttons.
	 *
	 * `cleave` casts Flame Shock, spends fifteen Earth Shocks and offers no proc window; read as
	 * multi-target all three sections fell through to `verdict_none`, so the first two printed "was never
	 * cast in this pull" over their own tables. The assertion is two-sided per section, because a sentence
	 * that merely stopped being wrong is not the same as one that says what happened.
	 */
	it('does not tell a pull it never pressed a button it pressed', () => {
		expect(cleave.flameShock.presses.length).toBeGreaterThan(0);
		expect(cleave.earthShock.presses.length).toBe(12);

		const fs = verdictOf(render(FlameShock, cleave, 'multi'));
		expect(fs).toContain('asks only that Flame Shock go back up when it is off the enemy in front of you');
		expect(fs).toContain('86.79% uptime across 10 casts is drawn above');
		expect(fs).not.toContain('Flame Shock was never cast in this pull');

		const es = verdictOf(render(EarthShock, cleave, 'multi'));
		expect(es).toContain('has no Earth Shock in it at all');
		expect(es).toContain('none of your shocks is right or wrong on this reading');
		// The total moved into a clause of its own when this sentence was reworded to read correctly at one
		// shock and at none — see `countAgreement.test.ts` for the measurement behind that.
		expect(es).toContain('That is 12 in total');
		expect(es).not.toContain('Earth Shock was never cast in this pull');

		// The Snapshots section was the third reading checked here. It is gone — the proc windows it
		// tabulated are the Flame Shock dot's own payoff, and that section already draws them — so the two
		// sections above are the whole of what this file can ask.
	});

	/**
	 * The worst of the four failures, and the one only a render could find: a raw key at the reader.
	 *
	 * `FlameShock` picks its own context rather than going through `verdict()`, because a pull that never
	 * dropped the dot needs the `_full` wording — a graded sentence written around a gap reads as a
	 * complaint about a flawless keep-up. `unbroken` is that pull, and read as multi-target it is also
	 * fully unasked, so the context came out `exempt_full`; i18next resolves a missing context to the bare
	 * `flameShock.verdict`, which no section has, and renders the key. The verdict paragraph on that page
	 * was the literal text `flameShock.verdict`.
	 *
	 * **This covers one section, and the defect is not one section's.** The same key came out of `mana` by a
	 * different route — a grade with no arm stored rather than a context with no arm stored — and nothing
	 * here would have seen it, because mana declares no bands and so never reaches this file's premise.
	 * That instance is rendered in `mana.test.ts`; the arm inventory that catches the *next* one without a
	 * render is `it('holds a sentence for every grade a section can be handed')` in
	 * `lib/i18n/__tests__/keys.test.ts`.
	 */
	it('never prints a key where a verdict belongs', () => {
		expect(unbroken.flameShock.uptimePct).toBeGreaterThan(99.995); // the pull that reaches `_full`
		const html = render(FlameShock, unbroken, 'multi');
		expect(html).not.toContain('flameShock.verdict');
		expect(verdictOf(html)).toContain('asks only that Flame Shock go back up');
	});

	/**
	 * And the no-change guard: on its own reading `cleave` is judged on all three and keeps every sentence.
	 * The Flame Shock verdict is the `bad` one — the dot was dropped on the boss as well — which is the
	 * case that shows an exemption has not become a way out of a real fault.
	 */
	it('leaves all three alone on the reading nobody forced', () => {
		expect(verdictOf(render(FlameShock, cleave, 'auto'))).toContain('86.79% uptime across 10 casts'); // no-change guard
		expect(verdictOf(render(EarthShock, cleave, 'auto'))).toContain(
			'shocks were spent with the shield charged up and the Flame Shock dot still long',
		); // no-change guard, reworded with the string itself
		// And the `_full` wording is still chosen where it belongs, so the guard above did not close the raw
		// key by taking that variant off every pull.
		expect(verdictOf(render(FlameShock, unbroken, 'auto'))).toContain(
			'The dot was up for every second you had something to hit',
		); // no-change guard
	});
});

describe('the instruction that used to end nine graded sentences', () => {
	/**
	 * One key, five sections, and the verdict no longer ends on page navigation.
	 *
	 * "switch the reading with the control at the top of the page if you want it counted" shipped as the
	 * tail of nine strings — three `_noUptime` arms, three `_noOvercap` arms and the three
	 * `verdict_exempt` arms — seventeen words of furniture printed after the reader's own figure every
	 * time. It is `targets.switchReading` now, rendered as a `Note` beside the verdict.
	 *
	 * Asserted from both sides per section, because dropping a clause from nine strings and rendering it
	 * from one place is exactly the shape that loses a sentence off the page: the note has to be there,
	 * and the graded paragraph has to no longer carry it.
	 */
	it('says it once, outside the graded sentence, in every section that needs it', () => {
		const note = t('targets.switchReading');
		for (const [name, Component, pull] of [
			['SearingTotem', SearingTotem, phased],
			['LightningShield', LightningShield, phased],
			['FlameShock', FlameShock, cleave],
			['EarthShock', EarthShock, cleave],
		] as const) {
			const html = render(Component, pull, 'multi');
			expect(html, name).toContain(note);
			expect(verdictOf(html), name).not.toContain('control at the top of the page');
		}
	});

	/** And it is not printed on a reading that asked for everything, where there is nothing to switch to. */
	it('stays off the page on the reading nobody forced', () => {
		const note = t('targets.switchReading');
		expect(render(SearingTotem, phased, 'auto')).not.toContain(note);
		expect(render(LightningShield, phased, 'auto')).not.toContain(note);
		expect(render(FlameShock, cleave, 'auto')).not.toContain(note);
		expect(render(EarthShock, cleave, 'auto')).not.toContain(note);
	});
});
