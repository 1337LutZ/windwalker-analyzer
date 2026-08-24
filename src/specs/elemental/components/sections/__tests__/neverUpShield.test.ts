// A pull that never wore Lightning Shield, read as a reader would read it.
//
// **This is the Earth Shock defect the other way up.** That one printed "Earth Shock was never cast in
// this pull" over a table of shocks; this one printed a shield's two habits over a chart that says the
// shield was never there. The section's own words, before this file:
//
//   > The shield sat at seven for 0s past the leeway, and came all the way off once.
//   > *(and, in the chart's place, twenty lines above)* No charges to draw.
//
// Both clauses are false of a buff that was never applied, and the section stated them beside their own
// contradiction. Neither number is a mistake in arithmetic — they are the honest output of two fields
// that mean something else on this pull. `maxStacks` is the registry's cap (`LIGHTNING_SHIELD.maxStacks
// ?? 0`), so it reads seven whether or not the buff ever landed, and the overcap metric's null-guard
// leans on it. `fellOff` counts the stretches the shield was *down*, and on a pull where it was never up
// that is the one stretch which is the whole fight. So the pull grades `ok` off a drop that never
// happened, and the un-narrowed `once` arm is the sentence a grade of `ok` at a count of one selects.
//
// **The sentence for this state was already written and could not be reached.** `verdict()` picks its
// arm off a grade, and this section can never be handed the nothing-measured one: `section()` is
// unmeasurable only when every primary metric is, and `lightningShieldFellOff` is a bare count with no
// bands and no sample floor, so it is never refused. The plain arm therefore sat in the locale file with
// no route to a reader from the day it landed — dead copy that was also the only true sentence available.
// `LightningShield.tsx` now reaches it by name, off the same `curve === null` the chart already uses.
//
// **How the pull is built, and why not by hand-editing the audit.** Setting `points: []` on an analysed
// fixture would prove the branch fires and nothing about whether the state is real. Stripping every
// Lightning Shield event out of `phased` and re-analysing puts the whole engine between the edit and the
// assertion, so the three fields the defect is made of are whatever the analyser makes of a log with no
// shield in it rather than whatever this file asserts they are. The premise test below reads all three
// back out, because a fixture that quietly still had a shield would make every assertion here vacuous.
//
// **The grade is not touched, and that is deliberate.** `lightningShieldFellOff` reading one on a pull
// that never wore the buff is a fault in the metric, and correcting it moves a published letter — which
// is not this change. It is reported instead, and asserted here as it stands so that the day someone
// does fix it, this file says out loud what it was.
//
// `createElement` rather than JSX so this stays a `.ts` file and is picked up by the project's own
// vitest include patterns, as its siblings do.

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

import Report from '~/components/Report';

import LightningShield from '../LightningShield';

const ELEMENTAL_SPEC = getSpec('elemental')!;
initI18n();
const t = i18n.getFixedT('en', 'report');

type El = Analysis & ElementalAuditResult;

/** Lightning Shield's own spell id, which is the one the audit reads its levels from. */
const LIGHTNING_SHIELD = 324;

const raw = (name: string): FightDataset =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../__fixtures__/${name}.json`), 'utf8')) as FightDataset;

/**
 * `phased` with every Lightning Shield event taken out, re-analysed.
 *
 * `phased` rather than another pull for one reason: it is the single-target one, so nothing here is
 * entangled with the narrowed reading the two AoE-scoped arms use, and the branch under test is the one
 * a reader gets without touching the control.
 */
const neverUp = (): El => {
	const dataset = raw('phased');
	const events = dataset.events.filter(
		(event) => (event as { abilityGameID?: number }).abilityGameID !== LIGHTNING_SHIELD,
	);
	return analyse({ ...dataset, events }) as El;
};

const render = (
	Component: (props: { analysis: Analysis }) => ReactNode,
	analysis: El,
	choice: TargetModeChoice = 'auto',
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

/** The graded sentence alone. Same reader and same argument as `unaskedVerdict.test.ts`'s. */
const verdictOf = (html: string): string => {
	const paragraphs = [...html.matchAll(/<p class="m-0 max-w-\[64ch\][^"]*">([\s\S]*?)<\/p>/g)];
	expect(paragraphs.length, 'no graded sentence found — has `Prose` changed shape?').toBeGreaterThan(0);
	return paragraphs.at(-1)?.[1] ?? '';
};

describe('a pull that never wore the shield', () => {
	const pull = neverUp();

	/**
	 * The premise, in full, so nothing below can pass over a fixture that still has a shield on it — and
	 * so the three fields the defect was made of are on the record rather than in a comment.
	 */
	it('is a pull with no shield, a cap that says seven anyway, and a drop that never happened', () => {
		expect(pull.lightningShield.points, 'the curve the chart draws').toEqual([]);
		expect(pull.lightningShield.maxStacks, 'the registry cap, not a reading').toBe(7);
		expect(pull.lightningShield.overcapMs).toBe(0);
		// **The audit field is still one, and that is not the thing that was fixed.** `fellOff` is
		// `downWindows.length`, an honest count of the stretches the shield was down, and on this pull that
		// is the single stretch which is the whole fight. What was wrong is the reading of it: a metric
		// named for the times the shield came off, grading a pull where it never went on.
		expect(pull.lightningShield.fellOff, 'the whole fight counted as one down-stretch').toBe(1);
	});

	/**
	 * The half this file was written to hold the record of, now that it has moved.
	 *
	 * It used to read *"the section grades `ok`"*, with a comment saying the metric was at fault and that
	 * correcting it would move a published letter. It has been corrected. `lightningShieldFellOff` reaches
	 * `metric()` through the same "was there a shield in this log at all" guard its sibling declares, so
	 * both of the section's primaries decline and the section is unmeasurable.
	 *
	 * **Asserted on `unmeasurable` and never on the letter, because the letter did not move and cannot.**
	 * `section()` parks its grade at `ok` when no primary is decided, so `grade` reads `ok` before this
	 * change *and* after it, for two entirely different reasons — a real `ok` earned off a drop that never
	 * happened, and a placeholder behind a refusal. A test that gated on the letter here would have passed
	 * against both, which is exactly the trap `metricOf`'s value of nought sets one layer down.
	 *
	 * **Both metrics and not just the one, and that ordering is the whole of it.** `section()` takes the
	 * worst of its *measurable* primaries, and `lightningShieldOvercap` scored `good` on this pull — nought
	 * milliseconds over a ceiling nobody sat at — because its own guard reads `maxStacks`, the registry's
	 * seven, which is never nought. Refusing the drop count alone would have left that `good` alone in the
	 * section and moved the letter from `ok` to `good`: a pull that never wore the aura, top marks.
	 */
	it("grades neither of the shield's two habits, rather than grading a drop that never happened", () => {
		const card = ELEMENTAL_SPEC.score(pull);
		const section = card.sections['lightningShield'];
		const metric = (key: string) => section?.metrics.find((m) => m.key === key);

		expect(metric('lightningShieldFellOff')?.unmeasurable, 'the drop count').toBe(true);
		expect(metric('lightningShieldOvercap')?.unmeasurable, 'the free nought beside it').toBe(true);
		expect(section?.unmeasurable).toBe(true);
		// And the value both of them park at, named so the next reader of this file does not take it for a
		// measurement: a refused metric publishes nought, which is why nothing on the page may read it.
		expect(metric('lightningShieldFellOff')?.value).toBe(0);

		// What the reader is told instead: two fewer points behind the headline, and the headline says so.
		expect(card.judged).toEqual({ measured: 12, total: 23, unmeasurable: false });
	});

	/**
	 * The tiles, which were the last place on the page still asserting the drop.
	 *
	 * The sentence and the chart were fixed together off `curve === null`; the row above them was not, and
	 * went on printing *"1 — Fell off"* beside *"No charges to draw."* It is withheld on the same
	 * condition now, so the three halves of the section agree.
	 */
	it('draws no tile row for a shield that was never there', () => {
		const html = render(LightningShield, pull);
		expect(html).not.toContain(t('lightningShield.kpi.fellOff'));
		expect(html).not.toContain(t('lightningShield.kpi.overcap'));
		expect(html).not.toContain(t('lightningShield.kpi.badSpends'));
	});

	/** And every real pull keeps its row, because the row is where those three numbers belong. */
	it('keeps the tile row on every committed pull', () => {
		for (const name of ['addsThenBoss', 'cleave', 'phased', 'unbroken']) {
			const html = render(LightningShield, analyse(raw(name)) as El);
			expect(html, name).toContain(t('lightningShield.kpi.fellOff'));
		}
	});

	/**
	 * The summary was leading with the fault, which is the reach of this defect nobody had measured.
	 *
	 * `lightningShieldFellOff` carries a takeaway card, and on this pull the card came top of *Key
	 * improvements*: *"Keep the shield up — The shield came all the way off you — 1 in a pull where it
	 * should be none."* A refused metric leads nothing, so the card is gone and the next real fault takes
	 * its place. Read off the whole report rather than off the section, because the summary is a different
	 * component and this is the only assertion in the file that reaches it.
	 */
	it('no longer opens the summary with a fault the pull did not commit', () => {
		const html = renderToStaticMarkup(
			createElement(Report, { analysis: pull as Analysis, targetChoice: 'auto', spec: ELEMENTAL_SPEC }),
		);
		expect(html).not.toContain('came all the way off you');
		expect(html).toContain('Scored on 12 of 23 points.');
	});

	/** And the chart says so, which is the half the sentence used to contradict. */
	it('draws no curve and says why', () => {
		expect(render(LightningShield, pull)).toContain(t('lightningShield.none'));
	});

	it('says the shield was never up, rather than reporting its habits', () => {
		const sentence = verdictOf(render(LightningShield, pull));
		expect(sentence).toBe(t('lightningShield.verdict_none'));
		// The two false clauses, named rather than left to the equality above — if the plain arm is ever
		// reworded, these are the words that must not come back.
		expect(sentence).not.toContain('sat at seven');
		expect(sentence).not.toContain('came all the way off');
		// And not a dotted key, which is what an arm reached by name gets wrong when the arm is misspelt.
		expect(sentence).not.toMatch(/lightningShield\.verdict/);
	});

	/**
	 * The no-change guard, and it is the one that matters most here: this branch is gated on a condition
	 * every committed pull fails, so a reader of a real report must see exactly what they saw before.
	 */
	it('leaves the sentence on every committed pull where it was', () => {
		for (const name of ['addsThenBoss', 'cleave', 'phased', 'unbroken']) {
			const analysed = analyse(raw(name)) as El;
			expect(analysed.lightningShield.points.length, name).toBeGreaterThan(0);
			const sentence = verdictOf(render(LightningShield, analysed));
			expect(sentence, name).not.toBe(t('lightningShield.verdict_none'));
			expect(sentence.length, name).toBeGreaterThan(40);
		}
	});
});
