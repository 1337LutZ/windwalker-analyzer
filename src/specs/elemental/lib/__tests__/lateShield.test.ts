// A pull whose Lightning Shield went on *late*, read as a reader would read it.
//
// **This is the case `neverUpShield.test.ts` left open, and it is the one that turns out to be right.**
// That file closed a pull with no shield in the log at all: `fellOff` is `downWindows.length`, and on a
// pull the buff never touched, the one down-stretch is the whole fight, so the report charged a drop that
// never happened. The refusal it added is `points.length > 0` — "was there a shield in this log at all".
//
// The same arithmetic hands `fellOff = 1` to a shaman who pulled without their shield and cast it a few
// seconds in: the complement of "up" opens at the pull and closes at the first application. That pull has
// a curve, so `points.length > 0` is true of it and the refusal does not touch it — a distinct case the
// guard leaves standing, which is why it is asserted here rather than assumed.
//
// **It is asserted as correct, and the argument is the whole point of the file.**
//
//   - *The fault is real and it is the player's.* Rolling Thunder returns 2% of maximum mana per charge
//     and only while the buff is up — the audit says so at `gradedSpans`, and `aoeNote` says it to the
//     reader — so every second before the first application is a second the mana engine was off. Lightning
//     Shield has no cooldown and no resource cost, so unlike `fireElementalPrepull` (whose `bad` band is
//     deliberately unreachable because a five-minute cooldown may simply not have been in hand) the log
//     does not have to prove the press was available. It always was.
//   - *The count is the right count.* One stretch of the pull had no shield on it. `fellOff` counts
//     stretches, and it counts one.
//   - *A refusal would be worse than the reading it replaced.* On the never-worn pull no number was
//     available to say instead — nought would have congratulated the pull for a shield it never wore. Here
//     nought is available and it is a lie: it says the shield was up from the pull. Refusing outright
//     would drop a real fault out of `overallOf`'s denominator and hand the section
//     `lightningShieldOvercap`'s reading alone.
//
// **What is imprecise is the verb, and it is recorded rather than fixed.** "Came all the way off" names a
// removal, and no removal happened; the honest phrase for this pull is "was not on you yet". The reach of
// that is small — the corrective the sentence carries ("keep the shield up", and at three enemies and up
// "re-cast Lightning Shield the moment it drops") is the right advice either way, and no committed
// fixture has the shape at all. Saying it precisely costs a second reading of the leading window in the
// audit and a parallel arm for each of the nine scope-and-plural verdicts in `report.json`, to distinguish
// two states whose grade, weight, count and remedy are identical. That trade is refused here in writing so
// that the next reader does not have to rediscover it — and the sentence is quoted below, so the day the
// trade is taken this file says exactly what the reader used to be told.
//
// **The witness is synthetic, and it is built the way `neverUpShield.test.ts` builds its own** — events
// stripped from a committed pull and re-analysed, so the engine and not this file decides what the fields
// say. All four committed Elemental fixtures wear the shield from the first millisecond (`points` opens at
// 0 on every one of them), and three of the four have no `applybuff` in the log at all: their opening
// event is an `applybuffstack`, which `auraLevels` back-fills to `t0` by its pre-fight inference. So a
// late application cannot be made by stripping a prefix of a pull chosen at random — the inference would
// erase the very gap under test. `cleave` is the one pull that holds a real `applybuff`, at 112 154ms,
// where the shaman re-applied after the drop this report already tells them about. Dropping every shield
// event before it leaves a pull whose first shield event is a genuine, unfabricated application at 112.2s.
// That the inference *does* erase a stripped prefix elsewhere is worth stating plainly: a leading
// down-window survives only where the log's first shield event is a real apply or remove, so this state is
// something the log witnessed rather than something the complement invented.
//
// `createElement` rather than JSX, so this stays a `.ts` file and the project's own vitest include
// patterns pick it up, as its siblings do.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { initI18n } from '~/lib/i18n/config';
import { getSpec } from '~/lib/spec';
import { resolveBands, type TargetModeChoice } from '~/lib/view/targetMode';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';

import { ScoreViewContext } from '~/components/report/scoreViewContext';
import { SpecContext } from '~/components/report/specContext';
import { analyse } from '~/specs/elemental/lib';

import LightningShield from '~/specs/elemental/components/sections/LightningShield';

const ELEMENTAL_SPEC = getSpec('elemental')!;
initI18n();

type El = Analysis & ElementalAuditResult;

/** Lightning Shield's own spell id, the one the audit reads its levels from. */
const LIGHTNING_SHIELD = 324;

/** `cleave`'s one real `applybuff`, the re-application after its mid-fight drop. */
const REAPPLY_MS = 112_154;

const raw = (name: string): FightDataset =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8')) as FightDataset;

/**
 * `cleave` with every Lightning Shield event before its own `applybuff` taken out, re-analysed.
 *
 * The surviving events are untouched and still in their original places, so the pull that comes out is
 * one whose shield went on at 112.2s and stayed on — every field below is the analyser's reading of that
 * log rather than an edit to an audit.
 */
const appliedLate = (): El => {
	const dataset = raw('cleave');
	const applyAt = dataset.fight.startTime + REAPPLY_MS;
	const events = dataset.events.filter(
		(event) => (event as { abilityGameID?: number }).abilityGameID !== LIGHTNING_SHIELD || event.timestamp >= applyAt,
	);
	return analyse({ ...dataset, events }) as El;
};

const render = (analysis: El, choice: TargetModeChoice = 'auto'): string =>
	renderToStaticMarkup(
		createElement(
			SpecContext.Provider,
			{ value: ELEMENTAL_SPEC },
			createElement(
				ScoreViewContext.Provider,
				{ value: resolveBands(analysis.targets, choice) },
				createElement(LightningShield as unknown as (props: { analysis: Analysis }) => ReactNode, {
					analysis,
				}),
			),
		),
	);

/** The graded sentence alone. Same reader and same argument as `neverUpShield.test.ts`'s. */
const verdictOf = (html: string): string => {
	const paragraphs = [...html.matchAll(/<p class="m-0 max-w-\[64ch\][^"]*">([\s\S]*?)<\/p>/g)];
	expect(paragraphs.length, 'no graded sentence found — has `Prose` changed shape?').toBeGreaterThan(0);
	return paragraphs.at(-1)?.[1] ?? '';
};

const shieldMetric = (pull: El, key: string, choice: TargetModeChoice = 'auto') =>
	ELEMENTAL_SPEC.score(pull, resolveBands(pull.targets, choice)).sections['lightningShield']?.metrics.find(
		(m) => m.key === key,
	);

describe('a pull whose shield went on late', () => {
	const late = appliedLate();

	/**
	 * The premise, in full, so nothing below can pass over a witness that is quietly the never-worn pull
	 * again — which is the one way every assertion here would go vacuous.
	 */
	it('is a pull with a shield, a curve, and one down-stretch that opens at the pull', () => {
		expect(late.lightningShield.points.length, 'the curve the chart draws').toBeGreaterThan(0);
		// The distinguishing fact, and the reason `neverUpShield.test.ts`'s refusal cannot reach this pull:
		// the first reading is at 112.2s, not at 0 — where all four committed fixtures open theirs.
		expect(late.lightningShield.points[0]?.[0]).toBe(REAPPLY_MS);
		expect(late.lightningShield.downWindows).toEqual([{ start: 0, end: REAPPLY_MS }]);
		expect(late.lightningShield.fellOff).toBe(1);
	});

	/**
	 * That the refusal does not fire, said out loud.
	 *
	 * `woreTheShield` is `points.length > 0`, so this pull reaches both of the section's primaries and is
	 * graded — which is the intended answer and not an oversight of that guard. Asserted on `unmeasurable`
	 * and never on the letter, for the reason `neverUpShield.test.ts` sets out: `section()` parks its grade
	 * at `ok` when no primary is decided, so a letter-gated test here would pass against a refusal too.
	 */
	it('is graded rather than refused, on both of the shield’s two habits', () => {
		expect(shieldMetric(late, 'lightningShieldFellOff')?.unmeasurable, 'the drop count').toBe(false);
		expect(shieldMetric(late, 'lightningShieldOvercap')?.unmeasurable, 'its sibling').toBe(false);
		expect(shieldMetric(late, 'lightningShieldFellOff')?.value).toBe(1);
		expect(shieldMetric(late, 'lightningShieldFellOff')?.grade).toBe('ok');
		// And the headline is taken over the same denominator every committed pull is scored on: nothing
		// about a late application narrows what the report may claim.
		expect(ELEMENTAL_SPEC.score(late, resolveBands(late.targets, 'auto')).judged).toEqual({
			measured: 21,
			total: 26,
			unmeasurable: false,
		});
	});

	/**
	 * **The crux, and the one assertion worth the file.**
	 *
	 * The committed `cleave` wore its shield from the pull and lost it for 5.9s in the middle. This pull
	 * never had it for the first 112.2s and never lost it after. `fellOff` reads one on both, and both are
	 * told the same thing in the same words — so the sentence quoted here is the report describing a
	 * removal that happened on one pull and did not happen on the other.
	 *
	 * That is the imprecision this file records. It is *not* an imprecision about how good the pull was:
	 * the two are one drop apiece by a count of stretches, and `fellOff` has never claimed to be a clock —
	 * a 5.9s gap and a 112.2s one are one stretch each by design, exactly as two mid-fight drops of
	 * unequal length are two. If that design is ever revisited, it is this pair that shows the range.
	 */
	it('is told, word for word, what a pull that really dropped its shield is told', () => {
		const committed = analyse(raw('cleave')) as El;
		expect(committed.lightningShield.downWindows, 'the mid-fight drop, for contrast').toEqual([
			{ start: 106_254, end: REAPPLY_MS },
		]);
		expect(committed.lightningShield.fellOff).toBe(1);

		const sentence = verdictOf(render(late));
		expect(sentence).toBe('The shield sat at seven for 11.7s past the leeway, and came off once.');
		// The clause under discussion, named rather than left inside the equality above: it says a removal,
		// and this pull had none. If it is ever reworded, this is the line that should go red.
		expect(sentence).toContain('came off once');
	});

	/**
	 * And at three enemies and up, where the overcap half declines and the sentence is the shield's alone.
	 *
	 * Worth its own assertion because this is the arm that carries the remedy, and the remedy is the half
	 * of the copy that survives the imprecision intact: "re-cast Lightning Shield the moment it drops" is
	 * not what this player did wrong, but "keep it up, it is your mana engine" is exactly it.
	 */
	it('keeps the shield’s own reading when the spending half is not measured', () => {
		expect(shieldMetric(late, 'lightningShieldOvercap', 'multi')?.unmeasurable).toBe(true);
		expect(shieldMetric(late, 'lightningShieldFellOff', 'multi')?.unmeasurable).toBe(false);
		const sentence = verdictOf(render(late, 'multi'));
		expect(sentence).toContain('Your shield came off once');
		expect(sentence).toContain('Rolling Thunder hands back 2% of your maximum mana per charge');
	});

	/**
	 * The no-change guard. This file asserts a reading, not a change, so the thing it must prove is that
	 * the reading is the same one every real pull already had — and that all four still open their curve at
	 * the pull, which is what keeps the state under test a synthetic one.
	 */
	it('leaves every committed pull opening its curve at the pull', () => {
		for (const name of ['addsThenBoss', 'cleave', 'phased', 'unbroken']) {
			const analysed = analyse(raw(name)) as El;
			expect(analysed.lightningShield.points[0]?.[0], name).toBe(0);
			expect(
				analysed.lightningShield.downWindows.some((w) => w.start === 0),
				`${name} has no leading gap — the case under test is synthetic`,
			).toBe(false);
		}
	});
});
