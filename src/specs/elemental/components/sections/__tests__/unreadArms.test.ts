// The graded sentences no test had ever rendered, read at last — and the one of them that was wrong.
//
// **How they were found.** `lib/i18n/__tests__/verdictReach.test.ts` renders every committed pull of
// every registered spec in all three readings and records which arm of which graded sentence i18next
// actually resolved. That measurement is about fixtures; the same instrument pointed at the whole suite
// answers the sharper question — which arms nothing at all has ever put on a page — and this spec had
// four. Three of them turned out to be right. The fourth had never been read by anybody, and it was a
// fault printed at a reader who had not committed it.
//
// **The one that was wrong: the pool's un-narrowed plural at nought.** `mana.verdict_ok` takes its
// plural off the count of Shamanistic Rage presses passed over, and that arm read *"…and let Shamanistic
// Rage came back 0 times to a pool already under 70% without being pressed. … And put the Rage down every
// time it is up and you are under 70%."* — a fault the pull did not commit, followed by the instruction
// to stop committing it. What makes it worse than a stray nought is that nought is the *only* count that
// arm can ever be handed: `shamanisticRageMissed` is `good` at nought and `ok` at exactly one, so two or
// more presses passed over grades the section `bad` outright, and exactly one takes the singular arm.
// Every reader that sentence could ever have had would have been read a fault they did not commit. The
// `bad` letter reaches the same nought from the other side, because there the letter can come off the
// Thunderstorm's clock alone. Both now have a nought arm that says what the Rage actually did.
//
// This is the same defect, in the same shape, that `searingTotem` and `lightningShield` were both given
// nought arms for — *"0 presses clipped a healthy totem"*, *"came off 0 times"*. Only this
// section had it judged the other way, on the reading that English takes the plural arm at nought. It
// does; the sentence still faults you.
//
// **The three that were right, kept here because unread is not the same as correct.** Two Searing Totem
// arms and one Lightning Shield arm are reached only where a fixture's own field has to be moved: no
// committed pull ever lays a totem under the Fire Elemental (`feOverlaps` is nought on all four) and none
// drops the shield twice. Each is an edited audit, and each says which single field it moved. They assert
// the count agrees with the arm, because that is the property their siblings' comments claim and nothing
// had checked at these values: narrowed, the section's letter *is* the count, so `ok` is exactly one and
// `bad` is two or more, and the arms say "One totem", a plural, and a plural respectively.
//
// **What this file is not.** It is not a second `countAgreement.test.ts`. That file reads every sentence
// that prints a bare count at the count it is worst at, across five families; this one reads the arms
// that no test of any kind had rendered, which is a different set arrived at by measurement rather than
// by reading the copy. Two of them are the same sentences seen from the two directions, and that is fine
// — the overlap is the part that was already covered.
//
// `createElement` rather than JSX so this stays a `.ts` file and is picked up by the project's own
// vitest include patterns, as its siblings do.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { initI18n } from '~/lib/i18n/config';
import { getSpec } from '~/lib/spec';
import { resolveBands, type TargetModeChoice } from '~/lib/view/targetMode';
import type { Analysis, ElementalAuditResult, FightDataset, WclEvent } from '~/lib/types';

import { ScoreViewContext } from '~/components/report/scoreViewContext';
import { SpecContext } from '~/components/report/specContext';
import { analyse } from '~/specs/elemental/lib';

import LightningShield from '../LightningShield';
import Mana from '../Mana';
import SearingTotem from '../SearingTotem';

const ELEMENTAL_SPEC = getSpec('elemental')!;
initI18n();

type El = Analysis & ElementalAuditResult;

const raw = (name: string): FightDataset =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../__fixtures__/${name}.json`), 'utf8')) as FightDataset;

const analysed = (name: string): El => analyse(raw(name)) as El;

/** `cleave` with the pool held at `pct` between `from` and `to`. The sibling suites' own helper. */
function withLowMana(from: number, to: number, pct: number): El {
	const dataset = raw('cleave');
	const t0 = dataset.fight.startTime;
	const events = dataset.events.map((event) => {
		const e = event as WclEvent & { classResources?: Array<{ amount: number; max: number; type: number }> };
		const at = e.timestamp - t0;
		if (e.classResources === undefined || at < from || at > to) return event;
		return {
			...e,
			classResources: e.classResources.map((bar) => (bar.type === 0 ? { ...bar, amount: (bar.max * pct) / 100 } : bar)),
		} as WclEvent;
	});
	return analyse({ ...dataset, events }) as El;
}

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

/** Nothing below may pass by printing a dotted key at the reader — the sibling suites' own guard. */
const noRawKey = (sentence: string) => {
	expect(sentence).not.toMatch(/\b(mana|searingTotem|lightningShield)\.verdict/);
};

// ===================================================================== Mana

/**
 * The un-narrowed pair at nought, which is where the Rage was faulted for a press it never passed over.
 *
 * Both halves have to be answered for the un-narrowed arms to be chosen at all — `Mana.tsx` narrows to a
 * `_noRage` or `_noThunderstorm` arm wherever exactly one of the two clocks is empty — so `starved` is
 * given a clock off the `strained` reading, the way `countAgreement.test.ts`'s own both-halves case does
 * it. The Rage's count is then set to nought, which is the whole point.
 */
describe('the pool at no missed Rage press', () => {
	const bothHalves = (starvedMs: number): El => {
		const base = withLowMana(90_000, 120_000, 50);
		return {
			...base,
			mana: {
				...base.mana!,
				starved: { ...base.mana!.strained, gradedMs: 733, ms: starvedMs, stretches: 0 },
				strained: { ...base.mana!.strained, stretches: 0 },
			},
		};
	};

	/** The premise. A clean Rage, and a letter that comes off the Thunderstorm's clock. */
	it('is a pull that passed over no Rage press at all', () => {
		const pull = bothHalves(733);
		expect(pull.mana?.strained.stretches).toBe(0);
		expect(pull.mana?.strained.gradedMs).toBeGreaterThan(0);
		expect(pull.mana?.starved.gradedMs).toBeGreaterThan(0);
		expect(ELEMENTAL_SPEC.score(pull).sections['mana']?.grade).toBe('ok');
	});

	it('does not fault the Rage on the ok letter, where nought is the only count it can have', () => {
		const sentence = verdictOf(render(Mana, bothHalves(733)));
		expect(sentence).toContain('No stretch under 70% went by with Shamanistic Rage unpressed');
		expect(sentence).not.toContain('0 times');
		expect(sentence).not.toContain('put the Rage down every time');
		// The Thunderstorm's half is untouched — this is a narrowing of one clause, not a new sentence.
		expect(sentence).toContain('under 15% with Thunderstorm up');
		noRawKey(sentence);
	});

	it('and does not fault it on the bad letter either, which reaches nought from the other side', () => {
		const pull = bothHalves(20_000);
		expect(ELEMENTAL_SPEC.score(pull).sections['mana']?.grade).toBe('bad');
		const sentence = verdictOf(render(Mana, pull));
		expect(sentence).toContain('No stretch under 70% went by with Shamanistic Rage unpressed');
		expect(sentence).not.toContain('0 times');
		expect(sentence).not.toContain('press it whenever it is up');
		expect(sentence).toContain('your next Lava Burst may not go out');
		noRawKey(sentence);
	});

	/**
	 * The no-change guard. One and many still read as they did, so the nought arm has narrowed nothing but
	 * nought — this is the direction a new plural arm most easily breaks.
	 */
	it('leaves one and many saying what they said', () => {
		const base = withLowMana(90_000, 120_000, 50);
		const at = (stretches: number): El => ({
			...base,
			mana: {
				...base.mana!,
				starved: { ...base.mana!.strained, gradedMs: 733, ms: 733, stretches: 0 },
				strained: { ...base.mana!.strained, stretches },
			},
		});
		expect(verdictOf(render(Mana, at(1)))).toContain('came back once to a pool already under 70%');
		expect(verdictOf(render(Mana, at(3)))).toContain('came back 3 times to a pool already under 70%');
	});
});

// ============================================================= Searing Totem

/**
 * The two narrowed totem arms, which need a totem laid under the Fire Elemental and no committed pull
 * lays one.
 *
 * `feOverlaps` is the single field moved, off `phased` read as multi-target: that reading exempts the
 * uptime (`bands: [1, 2]`, and no rung of the AoE list asks for a fire totem), which leaves the section's
 * letter resting on the overlap count alone — `good` at nought, `ok` at exactly one, `bad` at two or
 * more. So each of the three arms has exactly one count it can be handed, and each says it in words or
 * as a plural accordingly. That claim is what these two check; nothing had.
 */
describe('a totem laid under the Fire Elemental', () => {
	const withOverlaps = (overlaps: number): El => {
		const phased = analysed('phased');
		return { ...phased, searingTotem: { ...phased.searingTotem, feOverlaps: overlaps } };
	};

	it('is nought on every committed pull, which is why these are edited', () => {
		for (const name of ['addsThenBoss', 'cleave', 'phased', 'unbroken']) {
			expect(analysed(name).searingTotem.feOverlaps, name).toBe(0);
		}
	});

	it('says one totem in words at exactly one', () => {
		const sentence = verdictOf(render(SearingTotem, withOverlaps(1), 'multi'));
		expect(sentence).toContain('One Searing Totem went down under the Fire Elemental');
		expect(sentence).toContain('that global bought nothing');
		expect(sentence).not.toContain('1 Searing Totems');
		noRawKey(sentence);
	});

	it('and takes the plural at two, with the plural noun and the plural globals', () => {
		const sentence = verdictOf(render(SearingTotem, withOverlaps(2), 'multi'));
		expect(sentence).toContain('2 Searing Totems went down under the Fire Elemental');
		expect(sentence).toContain('those globals bought nothing');
		noRawKey(sentence);
	});
});

// =========================================================== Lightning Shield

/**
 * The narrowed shield arm at two drops, which no committed pull reaches — `cleave` drops it once and the
 * other three never.
 *
 * Same shape as the totem's pair above and the same reason it is safe: narrowed, the letter is the drop
 * count alone, so this arm can only ever be handed two or more and its bare numeral needs no agreement.
 * Read at two, which is the value it is worst at.
 */
describe('a shield dropped more than once', () => {
	const withDrops = (fellOff: number): El => {
		const phased = analysed('phased');
		return { ...phased, lightningShield: { ...phased.lightningShield, fellOff } };
	};

	it('is at most one on every committed pull, which is why this is edited', () => {
		for (const name of ['addsThenBoss', 'cleave', 'phased', 'unbroken']) {
			expect(analysed(name).lightningShield.fellOff, name).toBeLessThanOrEqual(1);
		}
	});

	it('takes the plural, and still says the overcap is not what the letter is about', () => {
		const sentence = verdictOf(render(LightningShield, withDrops(2), 'multi'));
		expect(sentence).toContain('Your shield came off 2 times');
		expect(sentence).toContain('nothing in the multi-target order spends the shield');
		noRawKey(sentence);
	});

	/** The two arms either side of it, so the plural has not eaten a count that is not its own. */
	it('leaves nought and one where they were', () => {
		expect(verdictOf(render(LightningShield, withDrops(0), 'multi'))).toContain('Your shield never came off');
		expect(verdictOf(render(LightningShield, withDrops(1), 'multi'))).toContain('Your shield came off once');
	});
});
