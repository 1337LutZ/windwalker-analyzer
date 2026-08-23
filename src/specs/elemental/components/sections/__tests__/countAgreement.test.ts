// Every sentence in these sections that prints a bare count, read at the count it is worst at.
//
// A placeholder sitting directly in front of a hard plural noun renders ungrammatically at one, and it
// did so in fourteen keys across five families before this file existed. It was invisible for as long
// as it was, because a report only ever showed it on a pull that missed exactly one press — and until
// `addsThenBoss` landed, no committed fixture did. That pull strains once under 70% with Shamanistic
// Rage never pressed, so the Mana section read *"…already under 70% 1 times without pressing it"* to
// anyone who opened it.
//
// **Both readings are asserted for every family, because a test that only checks the plural proves
// nothing.** The plural is what the copy was written for and what it has always got right; the whole
// defect lives at one. Where a committed pull reaches a count, that pull is the case — `addsThenBoss`
// for the Rage, `cleave` for the shield's single drop and for its own takeaway card, `phased` and
// `unbroken` for a totem nobody clipped. The rest are hand-edited audits, and each one says so.
//
// **Nought is here too, and it is not the same defect.** Three of these sentences report a fault the
// section does not grade, so they can be handed a nought by a pull that has none of it: `phased` printed
// *"0 presses clipped a healthy totem, throwing away 0s of its dot"* and three of the four fixtures
// printed *"came all the way off 0 times"*. Those are false faults rather than bad grammar, and where the
// key can reach nought it now has an arm that says so.
//
// **Two of the five families take the other road, and the reason is the render site rather than the
// copy.** i18next chooses a plural off `count` and nothing else, so an arm can only be reached where the
// component hands one over. The summary's takeaway cards are rendered by a shared component that passes
// `value` for twenty-three cards of which three are counts, and the Earth Shock exempt sentence sits
// under a key name that `specs/__tests__/readerVoice.test.ts` pins as one of exactly five — neither file
// is this lane's. Both are reworded so the numeral needs no agreement instead, and the assertions below
// are over the wording rather than over an arm.
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
import type { Analysis, ElementalAuditResult, FightDataset, WclEvent } from '~/lib/types';

import { ScoreViewContext } from '~/components/report/scoreViewContext';
import { SpecContext } from '~/components/report/specContext';
import Takeaways from '~/components/sections/Takeaways';
import { analyse } from '~/specs/elemental/lib';

import EarthShock from '../EarthShock';
import LightningShield from '../LightningShield';
import Mana from '../Mana';
import SearingTotem from '../SearingTotem';

const ELEMENTAL_SPEC = getSpec('elemental')!;
initI18n();
const t = i18n.getFixedT('en', 'report');

type El = Analysis & ElementalAuditResult;

const raw = (name: string): FightDataset =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../__fixtures__/${name}.json`), 'utf8')) as FightDataset;

const analysed = (name: string): El => analyse(raw(name)) as El;

/** `cleave` with the pool held at `pct` between `from` and `to`. The sibling Mana suite's own helper. */
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

/**
 * Nothing below may pass by printing a dotted key at the reader.
 *
 * The failure mode a plural arm invites: i18next appends the suffix to a stem it was never given, and a
 * grade with an arm missing under it resolves to the bare key, which this project has already shipped
 * once. So every sentence read here is checked for the shape of a key as well as for its words.
 */
const noRawKey = (sentence: string) => {
	expect(sentence).not.toMatch(/\b(mana|earthShock|searingTotem|lightningShield)\.verdict/);
};

// ===================================================================== Mana

/**
 * Shamanistic Rage's count, which is the one a committed pull reaches at exactly one.
 *
 * Two of the four arms that print it can be handed a one and two cannot, and the split is not a choice.
 * Narrowed to the Rage's half the section's letter *is* `shamanisticRageMissed`, whose thresholds put
 * `ok` at one press passed over and `bad` at two or more — so the narrowed `ok` arm says "once" in words
 * and the narrowed `bad` arm is never given a one to print. The un-narrowed pair is graded against the
 * Thunderstorm as well and can arrive with any count at all, so those two carry the plural arms.
 */
describe('the Rage count agrees with itself', () => {
	const addsThenBoss = analysed('addsThenBoss');

	/** The premise, so nothing below is vacuous. This is the pull the defect was reachable on. */
	it('is a committed pull that passed over exactly one press', () => {
		expect(addsThenBoss.mana?.strained.stretches).toBe(1);
		expect(addsThenBoss.mana?.starved.gradedMs).toBe(0);
		expect(ELEMENTAL_SPEC.score(addsThenBoss).sections['mana']?.grade).toBe('ok');
	});

	it('says once rather than one times, on the pull a reader could already open', () => {
		const sentence = verdictOf(render(Mana, addsThenBoss));
		expect(sentence).toContain('come back to a pool already under 70% once without pressing it');
		expect(sentence).not.toContain('1 times');
		noRawKey(sentence);
	});

	/**
	 * The plural, on the same arm's `bad` sibling — which is the only count that arm can ever be handed.
	 *
	 * A hand-edited audit, for the reason the sibling Mana suite gives at length: the 70% line contains the
	 * 15% one, so no real curve can leave the Thunderstorm's half unanswered while the Rage's is answered
	 * more than once.
	 */
	it('keeps the plural where the narrowed sentence can only be plural', () => {
		const base = withLowMana(90_000, 120_000, 50);
		const many: El = { ...base, mana: { ...base.mana!, strained: { ...base.mana!.strained, stretches: 4 } } };
		expect(ELEMENTAL_SPEC.score(many).sections['mana']?.grade).toBe('bad');
		const sentence = verdictOf(render(Mana, many));
		expect(sentence).toContain('come back to a pool already under 70% 4 times without pressing it');
		noRawKey(sentence);
	});

	/**
	 * The un-narrowed pair, where both halves were answered and the plural arms live.
	 *
	 * `starved` is given a clock off the `strained` reading the same way the sibling suite's own
	 * both-halves case does it, because a pull that answers the Thunderstorm's half is a state only an
	 * edited audit holds.
	 */
	const bothHalves = (stretches: number): El => {
		const base = withLowMana(90_000, 120_000, 50);
		return {
			...base,
			mana: {
				...base.mana!,
				starved: { ...base.mana!.strained, gradedMs: 733, ms: 0, stretches: 0 },
				strained: { ...base.mana!.strained, stretches },
			},
		};
	};

	it('says once in the sentence that names both halves', () => {
		const one = bothHalves(1);
		expect(ELEMENTAL_SPEC.score(one).sections['mana']?.grade).toBe('ok');
		const sentence = verdictOf(render(Mana, one));
		expect(sentence).toContain('under 15% with Thunderstorm up');
		expect(sentence).toContain('come back to a pool already under 70% once without pressing it');
		expect(sentence).not.toContain('1 times');
		noRawKey(sentence);
	});

	it('and the plural in the same sentence at more than one', () => {
		const many = bothHalves(3);
		expect(ELEMENTAL_SPEC.score(many).sections['mana']?.grade).toBe('bad');
		const sentence = verdictOf(render(Mana, many));
		expect(sentence).toContain('under 15% with Thunderstorm up');
		expect(sentence).toContain('come back to a pool already under 70% 3 times without pressing it');
		noRawKey(sentence);
	});

	/**
	 * The claim the shared payload rests on, pinned rather than assumed.
	 *
	 * `count` rides on the payload every arm of this section is given, not only the four that print the
	 * figure, because the payload is what both routes out of the component hand the translator. An arm with
	 * no plural stored under it resolves its suffix, finds nothing, and falls back to the arm without one —
	 * i18next's own resolution order. If that ever stopped being true the reader would get a dotted key,
	 * which is the failure this whole layer exists to prevent.
	 */
	it('leaves an arm that names no count reading as itself', () => {
		for (const arm of ['mana.verdict_good_noRage', 'mana.verdict_good_noThunderstorm', 'mana.verdict_none']) {
			const sentence = t(arm, { count: 1, starved: 15, strained: 70, low: 1000 });
			expect(sentence).not.toContain('mana.verdict');
			expect(sentence.length).toBeGreaterThan(80);
		}
	});
});

// ============================================================== Earth Shock

/**
 * The exempt sentence, which is the only Earth Shock sentence that can print a count of one.
 *
 * The three graded arms open on a fraction of the shocks a list had an opinion about, and `shareOf` hands
 * that share its denominator as a sample size — which `metricOf` refuses below `MIN_GRADED_SAMPLE`. So a
 * pull with one or two of them is unmeasurable and never reaches a graded sentence at all, and *"1 of 1
 * shocks"* is unreachable rather than merely unseen. The exempt arm has no such floor: it names the total
 * on purpose, because on a reading where no list asks for the button the count of judged presses is the
 * wrong number to print.
 *
 * So this family is reworded rather than given arms, and the second reason is the one that settles it: a
 * plural arm here would grow the five key names `specs/__tests__/readerVoice.test.ts` pins as the only
 * places our word for a scope appears, in a file this lane does not own.
 */
describe('the exempt shock count agrees with itself', () => {
	const cleave = analysed('cleave');

	/** The premise. `cleave` is the committed pull that reaches this sentence, and it reaches it plural. */
	it('is a committed pull whose shocks are all unasked on the multi-target reading', () => {
		expect(cleave.earthShock.presses.length).toBe(12);
		expect(ELEMENTAL_SPEC.score(cleave, resolveBands(cleave.targets, 'multi')).sections['earthShock']?.grade).toBe(
			'ok',
		);
	});

	/** The counts, one hand-edited audit each. `presses` is the only field the sentence reads. */
	const withPresses = (n: number): El =>
		({ ...cleave, earthShock: { ...cleave.earthShock, presses: cleave.earthShock.presses.slice(0, n) } }) as El;

	it('names no plural noun in front of the number, at one shock or at none', () => {
		for (const [n, total] of [
			[1, 'That is 1 in total'],
			[0, 'That is 0 in total'],
		] as const) {
			const sentence = verdictOf(render(EarthShock, withPresses(n), 'multi'));
			expect(sentence).toContain('none of your shocks is right or wrong on this reading');
			expect(sentence).toContain(total);
			expect(sentence).not.toContain(`${n} shocks`);
			noRawKey(sentence);
		}
	});

	it('reads the same way at twelve, on the committed pull', () => {
		const sentence = verdictOf(render(EarthShock, cleave, 'multi'));
		expect(sentence).toContain('none of your shocks is right or wrong on this reading');
		expect(sentence).toContain('That is 12 in total');
		noRawKey(sentence);
	});

	/**
	 * And the graded arms are left alone, which is the no-change half of this family.
	 *
	 * The floor is what makes them safe, so the floor is what is asserted: two judged shocks decline to
	 * grade, and the sentence a reader gets is the one for a section that could not be measured rather than
	 * a fraction reading "1 of 2 shocks".
	 */
	it('never reaches a graded shock sentence with fewer than three to grade', () => {
		for (const judged of [1, 2]) {
			const thin = { ...cleave, earthShock: { ...cleave.earthShock, judged, good: judged } } as El;
			const section = ELEMENTAL_SPEC.score(thin).sections['earthShock'];
			expect(section?.unmeasurable, `${judged} judged shocks should not grade`).toBe(true);
			expect(verdictOf(render(EarthShock, thin))).not.toContain(`of ${judged} shocks`);
		}
		// And three of them do grade, so the assertion above is about the floor and not about the edit.
		const three = { ...cleave, earthShock: { ...cleave.earthShock, judged: 3, good: 2 } } as El;
		expect(verdictOf(render(EarthShock, three))).toContain('2 of 3 shocks were spent');
	});
});

// ============================================================= Searing Totem

/**
 * The clipped-press count, which nothing in this section grades.
 *
 * That is the whole reason it needs all three arms. The letter above the sentence comes off the totem's
 * uptime and its overlaps with the Fire Elemental, so a pull can be handed `ok` or `bad` with no press
 * clipped at all — and two committed pulls are. `phased` printed *"0 presses clipped a healthy totem,
 * throwing away 0s of its dot"* under an `ok` earned on uptime alone.
 */
describe('the clipped-press count agrees with itself', () => {
	const phased = analysed('phased');
	const unbroken = analysed('unbroken');

	/** The premise: two committed pulls, two letters, nothing clipped on either. */
	it('is two committed pulls that clipped nothing and were still not good', () => {
		expect(phased.searingTotem.clipped).toBe(0);
		expect(unbroken.searingTotem.clipped).toBe(0);
		expect(ELEMENTAL_SPEC.score(phased).sections['searingTotem']?.grade).toBe('ok');
		expect(ELEMENTAL_SPEC.score(unbroken).sections['searingTotem']?.grade).toBe('bad');
	});

	it('claims no clipped press on a pull that clipped none', () => {
		for (const pull of [phased, unbroken]) {
			const sentence = verdictOf(render(SearingTotem, pull));
			expect(sentence).toContain('no press landed over a live totem');
			expect(sentence).not.toContain('0 presses clipped');
			expect(sentence).not.toContain('throwing away 0s');
			noRawKey(sentence);
		}
	});

	/** One clip and two, on hand-edited audits: no committed pull clips a totem outside a `good` letter. */
	const withClipped = (pull: El, clipped: number, wasted: number): El =>
		({ ...pull, searingTotem: { ...pull.searingTotem, clipped, wastedMs: wasted } }) as El;

	it('says one press at one, in both letters', () => {
		const ok = verdictOf(render(SearingTotem, withClipped(phased, 1, 6000)));
		expect(ok).toContain('One press clipped a healthy totem, throwing away 6s of its dot');
		expect(ok).not.toContain('1 presses');
		const bad = verdictOf(render(SearingTotem, withClipped(unbroken, 1, 6000)));
		expect(bad).toContain('one press clipped a healthy totem');
		expect(bad).not.toContain('1 presses');
		noRawKey(ok);
		noRawKey(bad);
	});

	it('and presses at more than one, in both letters', () => {
		expect(verdictOf(render(SearingTotem, withClipped(phased, 2, 9000)))).toContain(
			'2 presses clipped a healthy totem, throwing away 9s of its dot',
		);
		expect(verdictOf(render(SearingTotem, withClipped(unbroken, 3, 9000)))).toContain(
			'3 presses clipped a healthy totem',
		);
	});
});

// =========================================================== Lightning Shield

/**
 * The drop count, which reaches one and nought on committed pulls both.
 *
 * `cleave` drops the shield once and printed *"came all the way off 1 times"*; the other three never drop
 * it and printed *"came all the way off 0 times"* — a fault sentence for a fault none of them had, under a
 * letter the overcap earned on its own.
 *
 * The narrowed arms need none of this and the reason is worth the sentence: with the overcap out of scope
 * the letter comes off the drop count alone, whose thresholds put `good` at no drops, `ok` at exactly one
 * and `bad` at two or more. So each of those three arms already names the only count it can be given, and
 * `verdict_ok_noOvercap` has said "came off once" in words since before this sweep.
 */
describe('the shield drop count agrees with itself', () => {
	const cleave = analysed('cleave');
	const phased = analysed('phased');

	/** The premise: one drop on one committed pull, none on another, `bad` on both from the overcap. */
	it('is two committed pulls, one drop and none, both bad on the overcap', () => {
		expect(cleave.lightningShield.fellOff).toBe(1);
		expect(phased.lightningShield.fellOff).toBe(0);
		for (const pull of [cleave, phased]) {
			expect(ELEMENTAL_SPEC.score(pull).sections['lightningShield']?.grade).toBe('bad');
		}
	});

	it('says once at one drop, and never at none, on the committed pulls', () => {
		const one = verdictOf(render(LightningShield, cleave));
		expect(one).toContain('came all the way off once');
		expect(one).not.toContain('1 times');
		expect(one).toContain('both are charges the next spend lost');
		const none = verdictOf(render(LightningShield, phased));
		expect(none).toContain('never came all the way off');
		expect(none).not.toContain('0 times');
		// The tail is a claim about two faults and there was only one, so it goes with the count.
		expect(none).not.toContain('both are charges the next spend lost');
		noRawKey(one);
		noRawKey(none);
	});

	it('keeps the plural at more than one drop', () => {
		const many = { ...cleave, lightningShield: { ...cleave.lightningShield, fellOff: 3 } } as El;
		const sentence = verdictOf(render(LightningShield, many));
		expect(sentence).toContain('came all the way off 3 times');
		noRawKey(sentence);
	});

	/**
	 * The `ok` arm, on hand-edited audits: no committed pull overcaps little enough to reach it.
	 *
	 * Its plural is stored and unreachable today, which is not dead copy but the fallback i18next resolves
	 * to when a count has no arm of its own — the same net the bare key used to be. It is read here at the
	 * translator rather than through a render, because reaching it through one would mean an audit the
	 * scoring model refuses.
	 */
	it('reads all three ways under an ok letter', () => {
		const okPull = (fellOff: number): El =>
			({ ...cleave, lightningShield: { ...cleave.lightningShield, overcapMs: 3000, fellOff } }) as El;
		for (const fellOff of [0, 1]) {
			expect(ELEMENTAL_SPEC.score(okPull(fellOff)).sections['lightningShield']?.grade).toBe('ok');
		}
		const none = verdictOf(render(LightningShield, okPull(0)));
		expect(none).toContain('sat at seven for 3s past the leeway, and never came all the way off');
		expect(none).not.toContain('0 times');
		const one = verdictOf(render(LightningShield, okPull(1)));
		expect(one).toContain('sat at seven for 3s past the leeway, and came all the way off once');
		expect(one).not.toContain('1 times');
		expect(t('lightningShield.verdict', { context: 'ok', count: 4, overcap: 3000, fellOff: 4 })).toContain(
			'came all the way off 4 times',
		);
	});
});

// ================================================================= Takeaways

/**
 * The three summary cards whose figure is a count, read at one and at many.
 *
 * These are the family that cannot have arms, and the reason is the render site. `Takeaways` is shared by
 * both specs and passes `value` for all twenty-three cards, of which three are counts and the rest are
 * shares and durations — so there is no `count` in the payload for i18next to choose a plural off, and
 * putting one there would be a change to a component this lane does not own and a `count` on a
 * percentage. All three are reworded so the numeral needs no agreement instead.
 *
 * Nought is not reachable on any of them: a card is only built for a metric that is measurable and not
 * `good`, and all three of these grade `good` at nought. So the readings that matter are one and many.
 */
describe('the summary cards that print a count agree with themselves', () => {
	/** Two of the three reach a count of one on a committed pull, under the multi-target reading. */
	const cardsOf = (html: string): string[] =>
		[...html.matchAll(/<span class="text-sm text-ink-2">([\s\S]*?)<\/span>/g)].map((m) => m[1] ?? '');

	it('says one drop without saying one times, on the pull that dropped the shield once', () => {
		const cleave = analysed('cleave');
		const cards = cardsOf(render(Takeaways, cleave, 'multi'));
		const shield = cards.find((card) => card.includes('came all the way off'));
		expect(shield, `no shield card among:\n${cards.join('\n')}`).toBeDefined();
		expect(shield).toContain('The shield came all the way off you — 1 in a pull where it should be none');
		expect(shield).not.toContain('1 times');
	});

	it('says one missed Rage press without saying one times, on the pull that missed one', () => {
		const addsThenBoss = analysed('addsThenBoss');
		const cards = cardsOf(render(Takeaways, addsThenBoss, 'multi'));
		const rage = cards.find((card) => card.includes('Shamanistic Rage came back'));
		expect(rage, `no Rage card among:\n${cards.join('\n')}`).toBeDefined();
		expect(rage).toContain('went unpressed, on 1 of its returns');
		expect(rage).not.toContain('1 times');
	});

	/**
	 * And every one of the three at both readings, at the translator.
	 *
	 * The overlap card has no committed pull at all — `searingTotemOverlaps` reads nought on all four, and
	 * on `addsThenBoss` it declines outright — so its two readings can only be taken here. The other two
	 * are read here as well, at a count no fixture reaches, so all three are covered by one claim.
	 */
	it('reads at one and at many on all three cards', () => {
		const fix = (key: string, value: number) => t(`summary.takeaways.metric.${key}.fix`, { value });
		for (const [key, atOne, atMany] of [
			[
				'searingTotemOverlaps',
				'placed under the Fire Elemental on 1 of your presses',
				'placed under the Fire Elemental on 4 of your presses',
			],
			[
				'lightningShieldFellOff',
				'came all the way off you — 1 in a pull where it should be none',
				'came all the way off you — 4 in a pull where it should be none',
			],
			['shamanisticRageMissed', 'went unpressed, on 1 of its returns', 'went unpressed, on 4 of its returns'],
		] as const) {
			expect(fix(key, 1), key).toContain(atOne);
			expect(fix(key, 1), key).not.toContain('1 times');
			expect(fix(key, 4), key).toContain(atMany);
		}
	});
});
