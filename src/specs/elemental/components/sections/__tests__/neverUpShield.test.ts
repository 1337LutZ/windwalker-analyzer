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
// **The grade has since been touched twice, and the second time is the one that stuck.** First the
// metric was made to refuse, on the argument that an instrument with no readings does not apply; the
// section then had no letter at all and the pull came out `good` overall, two points lighter in the
// denominator for never having worn the aura. That is the wrong answer to the wrong question. A shield
// never worn is the worst a shaman can do with the button, so the pull is graded and graded at the
// bottom — on a mark that stands for "the buff was never up", never on the audit's `fellOff`, which is
// the fabricated drop this whole file exists to keep off the page.
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
/**
 * Elemental Discharge, stripped alongside the shield because the premise requires it.
 *
 * The tier-16 two-piece debuff is applied *by Fulmination*, and Fulmination is an Earth Shock spending
 * Lightning Shield charges — so a shaman who never wore the shield can never have put this up. Removing
 * the shield's events and leaving the debuff's behind produced a pull that was impossible in both
 * directions at once: no aura to spend, and 65.80% uptime on the thing spending it would have bought.
 *
 * That is not a subtle inconsistency. `elementalDischargeUptime` grades against 90/80, so the stale
 * windows scored 2.42 bands short and took the top of the scorecard's `headroom` ordering off the shield
 * — the exact claim the last assertion in this file makes. The fixture was asserting a defect it had
 * manufactured, so the fixture is the thing that was wrong.
 */
const ELEMENTAL_DISCHARGE = 144_999;

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
	const events = dataset.events.filter((event) => {
		const id = (event as { abilityGameID?: number }).abilityGameID;
		return id !== LIGHTNING_SHIELD && id !== ELEMENTAL_DISCHARGE;
	});
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
	 * The half this file was written to hold the record of, and it has now moved twice.
	 *
	 * It first read *"the section grades `ok`"*, with a comment saying the metric was at fault and that
	 * correcting it would move a published letter. Correcting it made both primaries refuse, which put the
	 * section at `unmeasurable` — and that was one step too far. A shield never worn is the worst a shaman
	 * can do with the button, so the answer is the bottom of the scale and not a declined question. The
	 * refusal also *paid*: the pull left two points of the denominator behind and came out `good` overall.
	 *
	 * **Asserted on `unmeasurable`, the value and the letter together, because no one of them is enough.**
	 * `section()` parks its grade at `ok` when no primary is decided, so the section letter read `ok`
	 * before the first change *and* after it, for two entirely different reasons; and `metricOf` parks a
	 * refused metric at value nought, so a value-only check cannot tell a refusal from a real reading
	 * either. All three are pinned, which is the only combination that separates the three states this one
	 * pull has been through.
	 *
	 * **The drop count carries it and the overcap does not, which is a ruling rather than an oversight.**
	 * `lightningShieldOvercap` is time spent at a ceiling, and this pull had no counter to sit at one, so
	 * there is nothing there to read at its worst; it still declines, through the `points` guard that
	 * replaced the `maxStacks` one it could never fire from. The drop count is also the only one of the two
	 * with no bands, so it is the only one that reaches a reader on all three readings — see below.
	 *
	 * **And the mark it grades on is not `fellOff`.** The audit publishes one down-stretch, the whole
	 * fight, and charging the pull for that is the retired defect coming back through its own fix. The
	 * value is one past this rule's `ok` edge and stands for "the buff was never up"; it is pinned here so
	 * nothing may quietly start printing it as a count.
	 */
	it('grades a shield never worn at the bottom of the scale, off a mark that is not a drop count', () => {
		const card = ELEMENTAL_SPEC.score(pull);
		const section = card.sections['lightningShield'];
		const metric = (key: string) => section?.metrics.find((m) => m.key === key);

		expect(metric('lightningShieldFellOff')?.unmeasurable, 'the drop count').toBe(false);
		expect(metric('lightningShieldFellOff')?.grade, 'the drop count').toBe('bad');
		expect(metric('lightningShieldFellOff')?.value, 'one past the ok edge, not the audit’s fellOff').toBe(2);
		expect(pull.lightningShield.fellOff, 'which the audit still publishes as one').toBe(1);
		expect(metric('lightningShieldFellOff')?.context, 'so no card prints that mark as a count').toBe('neverUp');

		expect(metric('lightningShieldOvercap')?.unmeasurable, 'no ceiling to have sat at').toBe(true);
		expect(section?.unmeasurable).toBe(false);
		expect(section?.grade).toBe('bad');

		// And the headline it now sits under: one more point in the denominator than the refusal collected.
		// Eighteen and not nineteen of the twenty-five: this pull carries no Elemental Discharge either, by
		// the same premise that takes the shield away, so that metric offers its weight and collects none of
		// it. See `ELEMENTAL_DISCHARGE` for why the fixture strips both.
		expect(card.judged).toEqual({ measured: 18, total: 25, unmeasurable: false });
	});

	/**
	 * The reading the overcap cannot reach, and therefore the one that shows which metric carries this.
	 *
	 * `lightningShieldOvercap` is `bands: [1, 2]` — nothing in the multi-target order spends the charges —
	 * so from three enemies up it is unasked and cannot be the section's letter under any rule. Had the bad
	 * grade ridden on the overcap, a never-worn shield read at three or more enemies would have gone back
	 * to saying nothing at all. It does not: the drop count has no scope, so the letter is `bad` on every
	 * reading a user of the control can produce.
	 */
	it('says the same thing at every enemy count the reader can switch to', () => {
		for (const choice of ['auto', 'single', 'multi'] as TargetModeChoice[]) {
			const card = ELEMENTAL_SPEC.score(pull, resolveBands(pull.targets, choice));
			const section = card.sections['lightningShield'];
			expect(section?.grade, choice).toBe('bad');
			expect(section?.metrics.find((m) => m.key === 'lightningShieldFellOff')?.grade, choice).toBe('bad');
		}
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
	 * should be none."* A refused metric leads nothing, so for one change the card was gone altogether.
	 *
	 * **It is back, and it must be — the summary is exactly where the worst thing on a pull belongs.**
	 * What cannot come back is the *number*, because the metric's value here is a mark standing for
	 * "never up" rather than a count of drops. `Metric.context` picks a wording that names the state and
	 * quotes no figure, which is the same mechanism the potion metric uses.
	 *
	 * **The three-card short list this was written against is gone; the scorecard grid replaced it, and
	 * the claim survives the move intact.** The grid is ordered by how far each section sits from `good`,
	 * and a shield never worn is the furthest thing on this pull — so the shield still leads. The
	 * fabricated drop still must not appear, and the grid honours `context` for the same reason the card
	 * did: it prints the sentence in place of the figure and draws no scale under it.
	 *
	 * Read off the whole report rather than off the section, because the summary is a different component
	 * and this is the only assertion in the file that reaches it.
	 */
	it('leads the summary with the shield, and not with a fault the pull did not commit', () => {
		const html = renderToStaticMarkup(
			createElement(Report, { analysis: pull as Analysis, targetChoice: 'auto', spec: ELEMENTAL_SPEC }),
		);
		expect(html).not.toContain('came all the way off you');
		expect(html).toContain(t('summary.takeaways.metric.lightningShieldFellOff.label'));
		expect(html).toContain(t('summary.scorecard.state', { context: 'neverUp' }));
		expect(html).toContain('Scored on 18 of 25 points.');
		// And it leads *the sections `headroom` orders*, which is what "leads the summary" means now that
		// the grid has a spec-declared lead order in front of that key. Ascendance and Fire Elemental sit
		// above their group by declaration — see `SpecTakeaways.lead` — so the claim this test can still
		// make is that the shield is the first card the ordering actually ranks, and it is asserted that way
		// rather than loosened to "appears somewhere".
		const cards = [...html.matchAll(/uppercase text-ink-2">([^<]+)</g)].map((m) => m[1]);
		const ranked = cards.filter((name) => name !== 'Ascendance' && name !== 'Fire Elemental');
		expect(ranked[0]).toBe('Lightning Shield');
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
