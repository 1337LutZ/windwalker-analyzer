// A `good` on the Searing Totem section, asserting something the letter never measured.
//
// The section is scored on two metrics: `searingTotemUptime`, which is `bands: [1, 2]`, and
// `searingTotemOverlaps`, which is asked at every enemy count. The clipped-press count is neither. So
// `good` means the uptime cleared 85% and no totem went down under the Fire Elemental — and the one
// sentence stored under that letter read *"{{uptime}} uptime, and no press landed over a live totem"*,
// which is a claim about the count nothing graded.
//
// `cleave` is the committed witness: 88.5% uptime, no Fire Elemental overlap, `good`, and **one press
// that clipped a live totem at 2:15, throwing away 10.8s of its dot**. The section printed the clip in a
// tile, printed the press in the table with the words "Clipped a totem", and then told the reader
// underneath that no press landed over a live totem.
//
// **Two roads, and this file is the argument for the one taken.**
//
//   - **Narrow the claim.** `good` gains the three arms `ok` and `bad` already carry off the same
//     `count` — the component has passed the clipped figure on this route since before this change, so
//     no component code moves. The clean sentence keeps its words and is reached only where it is true;
//     the other two report the clip, say plainly it is not part of what was measured, and send the
//     reader to the table for the moment. Precedent in this very section (`verdict_*_noUptime`) and in
//     the sibling one (`lightningShield.verdict_good_noOvercap`): the letter is kept and the sentence
//     stops claiming the half it did not measure.
//   - **Grade the clip.** Honest, and much larger: a rule, a weight, thresholds, a summary card, the
//     `MetricKey` union, and every fixture's section and overall letter re-measured. It also asks for
//     two thresholds off a single observation — one clip, on one of four pulls — which is exactly the
//     invented number `bandsInPull` and `MIN_GRADED_SAMPLE` are both documented as refusing. The
//     scorecard is not the thing that was wrong here; the sentence was.
//
// So nothing about the scoring moves, and the last test in this file is what says so: all four pulls
// keep the section letter and the whole-pull letter they had.
//
// `createElement` rather than JSX so this stays a `.ts` file and is picked up by the project's own
// vitest include patterns, as its siblings do.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import i18n, { initI18n } from '~/lib/i18n/config';
import { formatClock, formatSeconds } from '~/lib/format';
import { getSpec } from '~/lib/spec';
import { resolveBands, type TargetModeChoice } from '~/lib/view/targetMode';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';

import { ScoreViewContext } from '~/components/report/scoreViewContext';
import { SpecContext } from '~/components/report/specContext';
import { analyse } from '~/specs/elemental/lib';

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

const noRawKey = (sentence: string) => expect(sentence).not.toMatch(/\bsearingTotem\.verdict/);

/** The clause the letter never earned. */
const NO_CLIP = 'no press landed over a live totem';

const cleave = analysed('cleave');
const phased = analysed('phased');
const unbroken = analysed('unbroken');
const addsThenBoss = analysed('addsThenBoss');

describe('a good totem section that clipped a totem', () => {
	/**
	 * The premise, so nothing below is vacuous, and every figure the sentence prints.
	 *
	 * The overlap count is asserted at nought on the line beside the clip, because that is what makes the
	 * letter a `good` at all and therefore what makes the old sentence's second clause the only false half
	 * of it. If a later change moves any of these, the assertions below are about a pull they were not
	 * written for.
	 */
	it('is a committed pull, good on both graded figures, with one clipped press', () => {
		const totem = cleave.searingTotem;
		expect(totem.clipped).toBe(1);
		expect(totem.feOverlaps).toBe(0);
		expect(Math.round(totem.uptimePct * 100) / 100).toBe(88.5);
		expect(formatSeconds(totem.wastedMs)).toBe('10.8s');
		expect(ELEMENTAL_SPEC.score(cleave).sections['searingTotem']?.grade).toBe('good');
		// And the clipped press is a real row on the page, at a time the table prints.
		expect(totem.presses.filter((press) => press.clipped).map((press) => press.t)).toEqual([135_481]);
		expect(formatClock(135_481)).toBe('2:15');
	});

	/**
	 * The defect, and the sentence that carried it.
	 *
	 * Two-sided: the false clause is gone, and what replaced it is a claim about the two figures the letter
	 * was actually taken on. The uptime survives at the front because an unmeasured figure is not a deleted
	 * one and this one was measured; the overlap clause is the half of the letter that was never said out
	 * loud at all.
	 */
	it('stops telling a pull that clipped a totem that it clipped none', () => {
		const sentence = verdictOf(render(SearingTotem, cleave));
		expect(sentence).not.toContain(NO_CLIP);
		expect(sentence).toContain('88.5% uptime');
		expect(sentence).toContain('no Searing Totem of yours went down while the Fire Elemental was holding the slot');
		expect(sentence).toContain('One press did land over a live totem, throwing away 10.8s');
		noRawKey(sentence);
	});

	/**
	 * And the reader can still find it, which is the half a narrowing can quietly cost.
	 *
	 * The clip is not scored, so the sentence must not read as though the table has nothing in it. Three
	 * surfaces are asserted together because the claim is that they agree: the sentence sends the reader to
	 * the table, the table has the press at the minute the sentence's own figures describe, and the tile
	 * still carries the count.
	 */
	it('sends the reader to the press it is no longer claiming does not exist', () => {
		const html = render(SearingTotem, cleave);
		expect(verdictOf(html)).toContain('the table gives you the moment');
		expect(html).toContain(formatClock(135_481));
		expect(html).toContain(t('searingTotem.state.clip'));
		expect(html).toContain(t('searingTotem.kpi.clipped'));
	});

	/** More than one, on a hand-edited audit: no committed pull clips twice under any letter. */
	it('says how many at more than one', () => {
		const twice = { ...cleave, searingTotem: { ...cleave.searingTotem, clipped: 2, wastedMs: 21_000 } } as El;
		const sentence = verdictOf(render(SearingTotem, twice));
		expect(sentence).toContain('2 presses landed over a live totem, throwing away 21s');
		expect(sentence).toContain('the table gives you the moments');
		expect(sentence).not.toContain(NO_CLIP);
		noRawKey(sentence);
	});

	/**
	 * The clean sentence, kept word for word and reached only where it is true.
	 *
	 * A hand-edited audit again, and it has to be: no committed pull is `good` with nothing clipped. This is
	 * the no-change half of the narrowing — the pull that really did keep every press off a live totem is
	 * told so in exactly the words it was told before.
	 */
	it('keeps the clean sentence for a good pull that clipped nothing', () => {
		const clean = { ...cleave, searingTotem: { ...cleave.searingTotem, clipped: 0, wastedMs: 0 } } as El;
		expect(verdictOf(render(SearingTotem, clean))).toBe(`88.5% uptime, and ${NO_CLIP}.`); // no-change guard
	});

	/**
	 * The other two letters and the narrowed route, untouched.
	 *
	 * `phased` and `unbroken` carry `counts.max === 1`, so both readings agree on band 1 and neither can be
	 * moved by anything here; `phased` read as multi-target is the narrowed arm, which names the overlap
	 * count and prints no clipped figure at all. All three sentences are the ones they were.
	 */
	it('leaves the ok, the bad and the narrowed sentences alone', () => {
		expect(phased.targets?.counts.max).toBe(1);
		expect(unbroken.targets?.counts.max).toBe(1);
		expect(verdictOf(render(SearingTotem, phased))).toContain(`79.84% uptime, and ${NO_CLIP}`); // no-change guard
		expect(verdictOf(render(SearingTotem, unbroken))).toContain(`61.57% uptime, and ${NO_CLIP}`); // no-change guard
		expect(verdictOf(render(SearingTotem, phased, 'multi'))).toContain(
			'no Searing Totem of yours went down while the Fire Elemental was holding it',
		); // no-change guard
		// The never-cast pull still reads the plain sentence and still names no clip, which is the half of
		// this claim that had to survive its letter moving. The sentence itself was rewritten when the
		// uptime started grading that pull, so it opens on the same clause and no longer stops there.
		expect(verdictOf(render(SearingTotem, addsThenBoss))).toBe(t('searingTotem.verdict_none'));
		expect(verdictOf(render(SearingTotem, addsThenBoss))).toMatch(/^Searing Totem was never cast in this pull\./);
		expect(verdictOf(render(SearingTotem, addsThenBoss))).not.toContain('clip');
	});

	/**
	 * The road not taken, priced: nothing about the scoring moved.
	 *
	 * This is the assertion that distinguishes the narrowing from the alternative. Grading the clip would
	 * have moved a section letter and a whole-pull letter on every pull that clips one, and would have
	 * needed two thresholds drawn from the single observation above. Both letters are pinned here for all
	 * four pulls, so a later lane that does decide to grade the clip has to come through this test and say
	 * what it moved.
	 */
	it('moves no section letter and no whole-pull letter', () => {
		const letters = Object.fromEntries(
			(
				[
					['cleave', cleave],
					['phased', phased],
					['unbroken', unbroken],
					['addsThenBoss', addsThenBoss],
				] as const
			).map(([name, pull]) => {
				const card = ELEMENTAL_SPEC.score(pull);
				return [name, [card.sections['searingTotem']?.grade, card.overall]];
			}),
		);
		// Two whole-pull letters moved with `gcdUtilisation`'s lines going to 95/90 — `cleave` to `bad` off
		// 89.18% and `phased` to `ok` off 94.44%. Neither totem letter moved, which is what this test asks.
		//
		// **`phased` moved a second time, to `good`, when those lines stopped being one pair per spec.**
		// `gcdUtilisation` resolves against the encounter's own p90 and p50 now, and Iron Juggernaut's
		// Elemental row is p90 94.16 / p50 91.08 over four kills — so the same 94.44% that missed a flat 95
		// by half a point clears its own fight's best pulls. `addsThenBoss` is the other pull the change
		// reaches and its letter stands: Galakras is suppressed, so that metric is withheld rather than
		// graded, and the `bad` below is earned by the sections it was always earned by. Every totem letter
		// here is where it was, which is again all this test asks.
		expect(letters).toEqual({
			cleave: ['good', 'bad'],
			phased: ['ok', 'good'],
			unbroken: ['bad', 'ok'],
			// The one pull that never lays a totem, and the only letter here this file did not pin itself.
			// It used to read `ok` with `unmeasurable` set — both metrics declined, so the section had no
			// letter at all — and now reads `bad` off nought per cent uptime over a gradable 226.9s. Its
			// whole-pull `bad` is unchanged and was always earned elsewhere. Nothing about the clip moved it:
			// this pull has no presses to clip, which is the whole of why its totem letter is red.
			addsThenBoss: ['bad', 'bad'],
		});
	});
});
