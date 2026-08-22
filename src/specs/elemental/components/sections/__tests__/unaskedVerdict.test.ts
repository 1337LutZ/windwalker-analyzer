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
import Snapshots from '../Snapshots';

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
 * need to be about that paragraph and not about the page: `flameShockSnapshots.none` is both the verdict
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
		// 40.4s of it, still printed and still named — an unmeasured figure is not a deleted one.
		expect(verdictOf(html)).toContain('40.4s');
		expect(html).toContain(`Overcapped — ${t('metric.notAsked')}`);
		expect(verdictOf(html)).not.toContain('The shield never sat at seven past the leeway');
	});

	/**
	 * The no-change guard for both, labelled: under the reading a reader gets without touching anything,
	 * every one of these rules is asked and the sentences are the ones they always were.
	 */
	it('leaves both sections alone on the reading nobody forced', () => {
		// `phased` grades `ok` on the totem and `bad` on the shield under its own reading, so the guards are
		// against those two sentences rather than against the `good` ones the forced reading produced above.
		expect(verdictOf(render(SearingTotem, phased, 'auto'))).toContain('79.84% uptime.'); // no-change guard
		expect(verdictOf(render(LightningShield, phased, 'auto'))).toContain(
			'The shield sat at seven for 40.4s past the leeway',
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
		expect(fs).toContain('83.9% uptime across 10 casts is drawn above');
		expect(fs).not.toContain('Flame Shock was never cast in this pull');

		const es = verdictOf(render(EarthShock, cleave, 'multi'));
		expect(es).toContain('has no Earth Shock in it at all');
		expect(es).toContain('none of your 12 shocks is right or wrong on this reading');
		expect(es).not.toContain('Earth Shock was never cast in this pull');

		const snap = verdictOf(render(Snapshots, cleave, 'multi'));
		expect(snap).toContain('no proc window here you were meant to snapshot');
		expect(snap).not.toContain('No proc window was offered in this pull');
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
		expect(verdictOf(render(FlameShock, cleave, 'auto'))).toContain('83.9% uptime across 10 casts'); // no-change guard
		expect(verdictOf(render(EarthShock, cleave, 'auto'))).toContain('shocks matched the rule the list had for them'); // no-change guard
		expect(verdictOf(render(Snapshots, cleave, 'auto'))).toContain('No proc window was offered in this pull'); // no-change guard
		// And the `_full` wording is still chosen where it belongs, so the guard above did not close the raw
		// key by taking that variant off every pull.
		expect(verdictOf(render(FlameShock, unbroken, 'auto'))).toContain(
			'The dot was up for every second you had something to hit',
		); // no-change guard
	});
});
