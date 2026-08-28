// A pull that never laid a Searing Totem, read as a reader would read it.
//
// **This is the never-worn-shield defect with a committed witness, which makes it the worse of the
// two.** `addsThenBoss` places no Searing Totem at all in 560 seconds, and 226.9s of that pull is clock
// the audit itself ruled gradable — the stretches outside the Fire Elemental's window, the
// intermissions and the add waves are already cut out of `scoredMs` before this rule ever sees it. So
// there was a real denominator, a real nought per cent, and the metric declined anyway: a
// `windows.length > 0` clause sat in front of the percentage and refused every pull that got the habit
// wholly wrong. The pull left one point of the judged weight behind for it.
//
// The shield's version of this needed a synthetic pull because all four committed logs wear the aura.
// This one needs nothing: it is on the record, in the fixture directory, and every assertion below is a
// reading of a log a real shaman played.
//
// **The two states this separates, since they were being folded into one.** An empty `scoredMs` is "no
// stretch of this pull could be read" and still refuses — a pull that is all elemental, all
// intermission and all add wave is a totem clock nobody measured, and `bandedClocks.test.ts` holds
// that. A full `scoredMs` with nought per cent in it is "the slot was yours for all of it and stood
// empty", which is a reading. Only the clock tells them apart, and only the clock ever could.
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

import SearingTotem from '../SearingTotem';

const ELEMENTAL_SPEC = getSpec('elemental')!;
initI18n();
const t = i18n.getFixedT('en', 'report');

type El = Analysis & ElementalAuditResult;

const raw = (name: string): FightDataset =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../__fixtures__/${name}.json`), 'utf8')) as FightDataset;

const analysed = (name: string): El => analyse(raw(name)) as El;

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

/** The graded sentence alone. Same reader and same argument as `neverUpShield.test.ts`'s. */
const verdictOf = (html: string): string => {
	const paragraphs = [...html.matchAll(/<p class="m-0 max-w-\[64ch\][^"]*">([\s\S]*?)<\/p>/g)];
	expect(paragraphs.length, 'no graded sentence found — has `Prose` changed shape?').toBeGreaterThan(0);
	return paragraphs.at(-1)?.[1] ?? '';
};

const metricOn = (pull: El, key: string, choice: TargetModeChoice = 'auto') =>
	ELEMENTAL_SPEC.score(pull, resolveBands(pull.targets, choice)).sections['searingTotem']?.metrics.find(
		(m) => m.key === key,
	);

describe('a pull that never laid a totem', () => {
	const pull = analysed('addsThenBoss');

	/**
	 * The premise, in full, so nothing below can pass over a fixture that quietly grew a totem — and so
	 * the pair of numbers the defect was made of is on the record rather than in a comment.
	 *
	 * The second one is the whole argument. A pull with no windows and no presses could be either of two
	 * things, and the clock is what says which: 226 856ms of gradable time is the slot standing open, not
	 * a slot nobody could see.
	 */
	it('is a pull with no totem, no press, and a quarter of a million milliseconds of open slot', () => {
		expect(pull.searingTotem.windows, 'the stretches a totem was ticking').toEqual([]);
		expect(pull.searingTotem.presses, 'the ledger the table draws').toEqual([]);
		expect(pull.searingTotem.uptimePct, 'nought, and a reading rather than an absence').toBe(0);
		expect(pull.searingTotem.scoredMs, 'the time this rule was answerable over').toBe(153_633);
	});

	/**
	 * The defect itself: a real denominator, a real nought, and a refusal.
	 *
	 * **Asserted on `unmeasurable` and the value before the letter, because the letter alone proves
	 * nothing here.** `section()` parks its grade at `ok` when no primary is decided, so a letter-gated
	 * test passes against the bug and the fix alike — the section read `ok` while both its metrics
	 * declined, and it would read `ok` again if a later change put them back. The three facts that
	 * separate the states are that the metric answered, what it answered, and where that lands.
	 */
	it('marks the pull down for the empty slot rather than declining to look', () => {
		const uptime = metricOn(pull, 'searingTotemUptime');
		expect(uptime?.unmeasurable, 'the uptime').toBe(false);
		expect(uptime?.value, 'nought per cent of a slot that was open all along').toBe(0);
		expect(uptime?.gradedMs, 'over the clock the audit published').toBe(153_633);
		expect(uptime?.grade, 'nought is the bad end of a higherIsBetter rule').toBe('bad');

		const card = ELEMENTAL_SPEC.score(pull);
		expect(card.sections['searingTotem']?.unmeasurable).toBe(false);
		expect(card.sections['searingTotem']?.grade).toBe('bad');
		// One more point in the denominator than the refusal collected, and the header says so.
		//
		// **Thirteen and not fifteen, and the two that left are `gcdUtilisation`'s.** This pull is Galakras,
		// one of the three encounters `lib/reference/specProfile.ts` suppresses that metric on — tower duty
		// takes the player out of contact by design, median contact share 82.7% against 94% or better on the
		// other eleven — so the figure prints without a letter and its weight leaves the judged half. That is
		// the opposite direction from this test's own subject and it is worth keeping the two apart: the
		// totem rule *gained* its point here by answering a question it used to decline, and the globals rule
		// lost its two by being refused for a reason the player had no part in. 13 of 24 is still over
		// `MIN_JUDGED_WEIGHT_SHARE`, so the header still prints a denominator rather than a refusal.
		expect(card.judged).toEqual({ measured: 13, total: 25, unmeasurable: false });
	});

	/**
	 * Its sibling still declines, and honestly.
	 *
	 * `searingTotemOverlaps` counts the presses laid under the Fire Elemental. No press was laid under the
	 * elemental because no press was laid at all, and nought there is `good` — the best mark on the card,
	 * for a habit the pull never had the chance to break. That one genuinely has nothing to read, which is
	 * the difference between the two: a share of an open slot has a denominator, a count of presses that
	 * went wrong has no presses.
	 */
	it('leaves the overlap count out of it, because there were no presses to overlap with', () => {
		expect(metricOn(pull, 'searingTotemOverlaps')?.unmeasurable).toBe(true);
	});

	/**
	 * The uptime is `bands: [1, 2]`, so a reader at three or more enemies is told nothing — and that is
	 * the standing ruling rather than a hole this change opened. `aoe.apl.json` has no fire-totem rung at
	 * all, so above two enemies an empty slot is not a totem anyone dropped. Pinned so that a later lane
	 * moving the bands has to come through here and say what it moved.
	 */
	it('says nothing about the empty slot on a reading that never asked for a totem', () => {
		const uptime = metricOn(pull, 'searingTotemUptime', 'multi');
		expect(uptime?.exempt).toBe(true);
		expect(uptime?.unmeasurable).toBe(true);
		expect(ELEMENTAL_SPEC.score(pull, resolveBands(pull.targets, 'multi')).sections['searingTotem']?.grade).toBe('ok');
	});

	/**
	 * And the sentence under the red letter, which is the half that had to move with the scorer.
	 *
	 * With the section graded, `verdict()` picks an arm off the letter — and every `bad` arm opens on the
	 * clipped-press ledger. `verdict_bad_zero` is the one it lands on: *"and no press landed over a live
	 * totem"*, a credit for a habit nobody had the chance to break, three lines under the table's own *"No
	 * presses to list."* That is the never-worn shield's defect verbatim, one section over. The plain arm
	 * is reached by name off the press ledger instead.
	 *
	 * The words that must not come back are named as well as the equality, so a later rewording of the
	 * plain arm cannot quietly reintroduce them.
	 */
	it('says the slot stood empty, rather than crediting a clip that never happened', () => {
		const sentence = verdictOf(render(SearingTotem, pull));
		expect(sentence).toBe(t('searingTotem.verdict_none'));
		expect(sentence).not.toContain('no press landed over a live totem');
		expect(sentence).not.toContain('uptime');
		expect(sentence).not.toMatch(/searingTotem\.verdict/);
	});

	/** The same sentence on the reading where the letter goes away, because the ledger is still empty. */
	it('says it at every enemy count the reader can switch to', () => {
		for (const choice of ['auto', 'single', 'multi'] as TargetModeChoice[]) {
			expect(verdictOf(render(SearingTotem, pull, choice)), choice).toBe(t('searingTotem.verdict_none'));
		}
	});

	/**
	 * The no-change guard, and the one that matters most: this branch is gated on a ledger the other three
	 * pulls all fill, so a reader of those reports must see exactly what they saw before.
	 */
	it('leaves the sentence and the letter on every pull that did lay one', () => {
		for (const name of ['cleave', 'phased', 'unbroken']) {
			const other = analysed(name);
			expect(other.searingTotem.presses.length, name).toBeGreaterThan(0);
			const sentence = verdictOf(render(SearingTotem, other));
			expect(sentence, name).not.toBe(t('searingTotem.verdict_none'));
			expect(sentence, name).toContain('uptime');
			expect(metricOn(other, 'searingTotemUptime')?.unmeasurable, name).toBe(false);
		}
		expect(metricOn(analysed('cleave'), 'searingTotemUptime')?.grade).toBe('good');
		expect(metricOn(analysed('phased'), 'searingTotemUptime')?.grade).toBe('ok');
		expect(metricOn(analysed('unbroken'), 'searingTotemUptime')?.grade).toBe('bad');
	});
});
