// The Mana section's two faults, and the three ways a low pool is deliberately *not* charged.
//
// **One of the two faults now fires on a committed pull; the other still has none, and every assertion
// about it is on a synthetic pull.** That split is a finding rather than a convenience, and it is what
// the four fixtures each contribute:
//
//   - `phased` and `unbroken` carry **no `classResources` readings at all** — both were captured
//     without `includeResources: true` — so their mana bar has zero samples and every figure in this
//     audit is a zero that means nothing. That is what the unmeasurable clause in `score.ts` is for,
//     and the first block below is the guard on it.
//   - `cleave` is the pull the two-target priority order was written for and does carry the bar: 1 189
//     readings on a 300 000 pool, median 46ms apart. **Its lowest reading of the whole pull is 77.7%.**
//     It never comes within sixty points of Thunderstorm's 15% line and never touches Shamanistic
//     Rage's 70% line either, so both faults are unmeasurable on it too — not zero, unmeasurable.
//   - `addsThenBoss` landed after the rest of this file and is the first committed pull whose pool goes
//     under a line: **26.567s under 70% with Shamanistic Rage never pressed**, which is
//     `shamanisticRageMissed` reading a number on data nobody rewrote. Its 2 627 readings are more than
//     twice `cleave`'s, and its deepest is **62.344%** — so the 15% line is still untouched by every
//     committed pull, and Thunderstorm's half of this file stays synthetic.
//
// So the synthetic pulls are `cleave`'s own event stream with **only the pool rewritten** over a chosen
// stretch: the same casts, the same shield, the same timing, one bar moved. That is deliberately not a
// hand-built dataset — the shape of the evidence is what fixture bugs hide in, and a fabricated stream
// would let this file agree with itself about an event layout no log produces. Nothing here is written
// to disk; no fixture is invented.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { abilityIdOf, isCast } from '~/lib/events';
import { rawFixtures } from '~/lib/analysis/fixtures';
import type { Analysis, ElementalAuditResult, FightDataset, PoolResourceAudit, WclEvent } from '~/lib/types';

import { analyse } from '../index';
import { scoreAnalysis } from '../score';

type El = Analysis & ElementalAuditResult;

const THUNDERSTORM = 51_490;
const SHAMANISTIC_RAGE = 30_823;

const raw = (name: string): FightDataset =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8')) as FightDataset;

const fx = (name: string): El => analyse(raw(name)) as El;

/**
 * `cleave` with the mana pool held at `pct` of its ceiling between `from` and `to`, and with any extra
 * presses injected.
 *
 * The pool is rewritten in place on every reading the log already carried inside the stretch, so the
 * sample *positions* stay the log's own — which is what keeps the sampling resolution honest. Injected
 * presses are shaped like the cast events already in the stream (`resourceActor: 1` and a
 * `classResources` snapshot are what the real ones carry) and the stream is re-sorted, because the
 * audit reads it in time order.
 */
function synthetic(opts: {
	low?: { from: number; to: number; pct: number };
	presses?: Array<{ at: number; id: number }>;
}): El {
	const dataset = raw('cleave');
	const t0 = dataset.fight.startTime;
	const events: WclEvent[] = dataset.events.map((event) => {
		const e = event as WclEvent & { classResources?: Array<{ amount: number; max: number; type: number }> };
		const bars = e.classResources;
		if (opts.low === undefined || bars === undefined) return event;
		const at = e.timestamp - t0;
		if (at < opts.low.from || at > opts.low.to) return event;
		return {
			...e,
			classResources: bars.map((bar) => (bar.type === 0 ? { ...bar, amount: (bar.max * opts.low!.pct) / 100 } : bar)),
		} as WclEvent;
	});
	for (const press of opts.presses ?? []) {
		events.push({
			timestamp: t0 + press.at,
			type: 'cast',
			sourceID: dataset.actor.id,
			targetID: dataset.actor.id,
			abilityGameID: press.id,
		} as unknown as WclEvent);
	}
	events.sort((a, b) => a.timestamp - b.timestamp);
	return analyse({ ...dataset, events }) as El;
}

// ------------------------------------------------------------- what the committed pulls actually do

describe('the three pulls that answer neither fault', () => {
	/** No-change guard: records the measurement the section was built against, so a drift is visible. */
	it('carry no mana readings at all on two of the three, which is not a clean pull', () => {
		for (const name of ['phased', 'unbroken'] as const) {
			const el = fx(name);
			expect(el.mana.samples, name).toBe(0);
			expect(el.mana.minPct, name).toBeNull();
		}
		// `cleave` is the one that carries the bar, and it never goes near either line.
		const cleave = fx('cleave');
		expect(cleave.mana.samples).toBe(1189);
		expect(cleave.mana.max).toBe(300_000);
		expect(cleave.mana.minPct).toBeCloseTo(77.7, 1);
		expect(cleave.mana.starved.lowMs).toBe(0);
		expect(cleave.mana.strained.lowMs).toBe(0);
	});

	/**
	 * The clause the plan asked for by name: *"if none of them ever drops under 15% the section grades
	 * nothing and the metric must be unmeasurable, not a free 100%."*
	 *
	 * Asserted on the scorecard rather than on the audit, because "unmeasurable" is a scoring decision
	 * and a zero on the audit is what it is built from. The two sides of each assertion are therefore a
	 * scorecard flag and a literal, not one number read twice.
	 */
	it('grade neither mana fault, on all three, rather than handing out a free full mark', () => {
		// **Deliberately three, and the reason is on the line.** These are the pulls whose pool never drops
		// under either line, which is what makes the section unmeasurable on them — the clause the plan asked
		// for. `addsThenBoss` is the control for the other half and must not be swept in here: its pool
		// bottoms out at 62.344%, so its Shamanistic Rage clock fills, its section is measurable and its
		// grade is `ok`. That is the whole subject of `the mixed-regime pull` below.
		for (const name of ['phased', 'unbroken', 'cleave'] as const) {
			const card = scoreAnalysis(fx(name));
			const mana = card.sections['mana'];
			expect(mana?.unmeasurable, name).toBe(true);
			for (const metric of mana?.metrics ?? []) expect(metric.unmeasurable, `${name} ${metric.key}`).toBe(true);
		}
	});

	/**
	 * *** The guard a literal three cannot be: every committed pull is on one side of the refusal. ***
	 *
	 * The list above is a deliberate three and a deliberate list has one failure mode — a fixture that
	 * belongs on neither side and is asked by nobody. `addsThenBoss.json` was exactly that until the pull it
	 * needed was written for it; the sentence "on all three" would have gone on being green however many
	 * pulls the directory held.
	 *
	 * So the split is derived from `rawFixtures` and measured rather than named: a pull is unmeasurable
	 * exactly when its section is, and the three named above have to be that set. A fifth fixture fails
	 * here and says which side it belongs on.
	 */
	it('puts every committed pull on one side of the refusal, measured rather than listed', () => {
		const all = rawFixtures('elemental').map(({ name }) => name.replace(/\.json$/, ''));
		const refused: string[] = [];
		const graded: string[] = [];
		for (const name of all)
			(scoreAnalysis(fx(name)).sections['mana']?.unmeasurable === true ? refused : graded).push(name);
		expect(refused.sort()).toEqual(['cleave', 'phased', 'unbroken']);
		expect(graded).toEqual(['addsThenBoss']);
		expect(refused.length + graded.length).toBe(all.length);
	});

	/**
	 * No-change guard: the headline verdict of each pull is unmoved by adding two unmeasurable metrics.
	 *
	 * The two that have since moved were moved by pricing `fireElementalHasteUptime` at 1 — `phased` to
	 * `good` and `cleave` to `ok`, the arithmetic on `score.ts`' `WEIGHTS` — and not by anything in this
	 * file. An unmeasurable metric still leaves the denominator, so this guard remains exactly the claim
	 * it was: two refusals added, three letters unchanged *by them*.
	 */
	it('keep the overall grade they had before the section existed', () => {
		// The three letters moved once, and not by this section: `gcdUtilisation`'s lines went from 80/65
		// to 95/90, which is the first pair that grades these pulls apart rather than calling all four
		// `good`. `phased` fills 94.44% and reads `ok`, `cleave` 89.18% and reads `bad`.
		expect(scoreAnalysis(fx('phased')).overall).toBe('ok');
		expect(scoreAnalysis(fx('unbroken')).overall).toBe('ok');
		expect(scoreAnalysis(fx('cleave')).overall).toBe('bad');
	});
});

// ---------------------------------------------------- the mixed-regime pull, and the first real fault

/**
 * `addsThenBoss`: the first committed pull whose pool goes under a line, and the one that changes shape.
 *
 * Galakras heroic-25, 560.3s, `counts.max` **9** and 73.73% multi-target — add waves out to 503.3s and
 * then a 56.9s boss-only tail, the split `addsThenBossLadder.test.ts` reads the ladder either side of.
 * Against `cleave`, a single-regime two-target pull at `counts.max` **13** over 263.2s, it is the first
 * chance to read these stretches on a pull that does not hold one shape throughout, and it carries
 * **2 627 readings of the bar against `cleave`'s 1 189** to read them with.
 *
 * It finds one of the two faults and not the other, and the asymmetry is the pull rather than the
 * section: the pool bottoms out at **62.344%**, which is under Shamanistic Rage's line by eight points
 * and over Thunderstorm's by forty-seven. So the Rage's clock fills and Thunderstorm's stays empty.
 *
 * **And none of the three refusals fires, which is the answer to the question this block was written to
 * ask.** The opening is not in it (the stretch opens at 202.6s, past the Rage's 60s horizon), the button
 * is never provably away (this player pressed **neither** Thunderstorm nor the Rage once in 560 seconds,
 * so there is no cooldown to sit inside), and the stretch is seventeen globals long rather than shorter
 * than one. A mixed-regime pull did not shake any of them loose; it produced the plainest reading the
 * section can produce, and every zero below is asserted rather than left silent.
 */
describe('the mixed-regime pull', () => {
	const dataset = raw('addsThenBoss');
	const el = analyse(dataset) as El;
	const card = scoreAnalysis(el);
	const metric = (key: string) => card.sections['mana']?.metrics.find((m) => m.key === key);
	/**
	 * Neither button is in the registry, so the audit derives availability from the presses — and both
	 * halves of that are asserted here off the same two guards `manaFault`'s caller reads them with,
	 * rather than off a press count this audit does not publish.
	 */
	const pressesOf = (id: number): number[] =>
		dataset.events
			.filter((e) => isCast(e) && e.sourceID === dataset.actor.id && abilityIdOf(e) === id)
			.map((e) => e.timestamp - dataset.fight.startTime);
	const bar = el.resources?.['mana'] as PoolResourceAudit | undefined;

	it('is the mixed pull, and it carries more than twice the bar cleave does', () => {
		expect(el.targets?.counts?.max).toBe(9); // `cleave` is 13, and holds it for the whole pull
		expect(el.targets?.multiTargetPct).toBeCloseTo(73.73, 2);
		expect(el.durationMs).toBe(560_261);
		expect(el.mana.samples).toBe(2627);
		expect(el.mana.max).toBe(300_000);
	});

	/**
	 * The measurement the two clocks are decided by, and the reason only one of them is decided: 62.344%
	 * is under the Rage's line and nowhere near Thunderstorm's. Both bounds are asserted against the
	 * audit's own published lines rather than against 15 and 70 written out again, so a moved line moves
	 * this claim with it.
	 */
	it("drops under the cost reduction's line and never within forty points of the starvation floor", () => {
		expect(el.mana.minPct).toBeCloseTo(62.344, 3);
		expect(el.mana.minPct).toBeLessThan(el.mana.strainedPct);
		expect(el.mana.minPct).toBeGreaterThan(el.mana.starvedPct);
		// So the starved clock has nothing in it at all — not a stretch that went uncharged, no stretch.
		expect(el.mana.starved.lowMs).toBe(0);
		expect(el.mana.starved.ms).toBe(0);
		expect(el.mana.starved.stretches).toBe(0);
		expect(el.mana.starved.gradedMs).toBe(0);
	});

	/** One stretch, and every millisecond of it chargeable — none of the three refusals touches it. */
	it('charges the whole stretch under 70%, because nothing about it is excused', () => {
		expect(el.mana.strained.lowMs).toBe(26_567);
		expect(el.mana.strained.gradedMs).toBe(26_567);
		expect(el.mana.strained.onCooldownMs).toBe(0);
		expect(el.mana.strained.unprovenMs).toBe(0);
		expect(el.mana.strained.ms).toBe(26_567);
		expect(el.mana.strained.stretches).toBe(1);
		expect(el.mana.strained.ms).toBeGreaterThan(el.mana.floorMs);
		const window = el.mana.strained.windows[0];
		expect(window?.start).toBe(202_604);
		expect(window?.end).toBe(229_171);
		expect(window?.pct).toBeCloseTo(62.344, 3);
		expect(window?.link).toContain('fight=');
	});

	/**
	 * Why the stretch is 26.567s and not the 35.3s its edges span: this is a sampled bar, and the pool
	 * crossed back over the line either side of the stretch. Two readings under 70% sit outside it with
	 * a reading above the line on both sides, and a stretch needs two in a row — so neither is one.
	 */
	it('leaves two readings under the line out of it, because a stretch needs two in a row', () => {
		const line = ((bar?.curve.max ?? 0) * el.mana.strainedPct) / 100;
		const under = (bar?.curve.points ?? []).filter(([, amount]) => amount <= line).map(([at]) => at);
		expect(under.length).toBe(116);
		expect(under[0]).toBe(194_865);
		expect(under[under.length - 1]).toBe(230_184);
		expect(el.mana.strained.lowMs).toBeLessThan(230_184 - 194_865);
	});

	/** Neither button once in 560 seconds, which is what makes the whole stretch provable. */
	it('was played without either button, so there is no cooldown for the stretch to hide in', () => {
		expect(pressesOf(THUNDERSTORM)).toEqual([]);
		expect(pressesOf(SHAMANISTIC_RAGE)).toEqual([]);
	});

	/**
	 * The three zeros that come out of the two facts above rather than out of good play, each asserted so
	 * that a pull which does fire them cannot be mistaken for this one.
	 *
	 * `bothOnCooldownMs` is an intersection with the *starved* stretches, and there are none — so the
	 * exempt band cannot fire on this pull whatever the buttons did. `earlyThunderstorms` counts presses
	 * above the line and there were no presses. `shieldDownMs` is an intersection with the shield's own
	 * down windows, and this player never dropped Lightning Shield at all.
	 */
	it('fires neither the exempt band nor the early press nor the shield link, and says why', () => {
		expect(el.mana.bothOnCooldownMs).toBe(0);
		expect(el.mana.bothOnCooldownWindows).toEqual([]);
		expect(el.mana.starved.windows).toEqual([]); // the array the exempt band is intersected with
		expect(el.mana.earlyThunderstorms).toBe(0);
		expect(el.mana.shieldDownMs).toBe(0);
		expect(el.lightningShield.fellOff).toBe(0); // and never went down for it to overlap
		expect(el.lightningShield.downWindows).toEqual([]);
	});

	/**
	 * **The first graded mana metric on a committed pull.** `shamanisticRageMissed` is graded on the
	 * count and not the duration — see the field's own docstring — so 26.567s in one stretch is one press
	 * that was not made, which is its `ok` band exactly. Thunderstorm's half stays unmeasurable, which is
	 * what carries the section: `section()` takes the worst of the metrics it could *decide*, and one of
	 * these two it could.
	 */
	it('grades the cost reduction for the first time, and still refuses the Thunderstorm', () => {
		expect(metric('shamanisticRageMissed')?.unmeasurable).toBe(false);
		expect(metric('shamanisticRageMissed')?.value).toBe(1);
		expect(metric('shamanisticRageMissed')?.grade).toBe('ok');
		expect(metric('thunderstormMissed')?.unmeasurable).toBe(true);
		expect(card.sections['mana']?.unmeasurable).toBe(false);
		expect(card.sections['mana']?.grade).toBe('ok');
	});

	/**
	 * No-change guard: the pull's own letter, which the mana section does not move. `addsThenBoss` grades
	 * `bad` on the rest of the report — the Searing Totem it never laid and the ladder it followed 34% of
	 * the time — and a section graded `ok` cannot make that worse.
	 */
	it('keeps the overall grade the rest of the report gives it', () => {
		expect(card.overall).toBe('bad');
	});
});

// ------------------------------------------------------------------------------- fault 1, Thunderstorm

describe('starved with Thunderstorm up', () => {
	/**
	 * 25 seconds at 10% mana, from 150s — well past the 45s the log needs before it can prove the button
	 * is back, and `cleave` never presses Thunderstorm at all, so it was provably in hand throughout.
	 */
	const starved = synthetic({ low: { from: 150_000, to: 175_000, pct: 10 } });

	it('charges the stretch, and reports it as one press that was not made', () => {
		expect(starved.mana.starved.stretches).toBe(1);
		expect(starved.mana.starved.ms).toBeGreaterThan(20_000);
		expect(starved.mana.starved.windows[0]?.pct).toBeCloseTo(10, 1);
		expect(starved.mana.starved.windows[0]?.link).toContain('fight=');
	});

	it('grades it bad and says so in the scorecard', () => {
		const metric = scoreAnalysis(starved).sections['mana']?.metrics.find((m) => m.key === 'thunderstormMissed');
		expect(metric?.unmeasurable).toBe(false);
		expect(metric?.grade).toBe('bad');
	});

	/**
	 * **The one this section must not get wrong.** Both buttons pressed just before the same stretch, so
	 * both are provably still coming back through all of it — the fight taking the mana, not the player
	 * misplaying. Nothing may be charged, the metric goes back to unmeasurable because its graded clock is
	 * empty, and the stretch is reported under its own name so the section can say why.
	 */
	it('charges nothing when both tools were provably away, and says that is what happened', () => {
		const covered = synthetic({
			low: { from: 150_000, to: 175_000, pct: 10 },
			presses: [
				{ at: 149_000, id: THUNDERSTORM },
				{ at: 149_500, id: SHAMANISTIC_RAGE },
			],
		});
		expect(covered.mana.starved.lowMs).toBeGreaterThan(20_000);
		expect(covered.mana.starved.ms).toBe(0);
		expect(covered.mana.starved.stretches).toBe(0);
		expect(covered.mana.starved.gradedMs).toBe(0);
		expect(covered.mana.starved.onCooldownMs).toBeGreaterThan(20_000);
		expect(covered.mana.bothOnCooldownMs).toBeGreaterThan(20_000);
		expect(covered.mana.bothOnCooldownWindows.length).toBe(1);
		// And with the clock empty, nothing is graded either way — no fault, and no credit for not
		// committing one.
		const metric = scoreAnalysis(covered).sections['mana']?.metrics.find((m) => m.key === 'thunderstormMissed');
		expect(metric?.unmeasurable).toBe(true);
	});

	/**
	 * The same stretch inside the opening the log cannot speak for. Thunderstorm comes back in 45s, so a
	 * press taken a second before the pull is invisible here and a press taken any earlier has
	 * already come back — which means nothing before 45s can be proved either way.
	 */
	it('charges nothing inside the opening, and reports it as unproven rather than clean', () => {
		const early = synthetic({ low: { from: 10_000, to: 30_000, pct: 10 } });
		expect(early.mana.starved.lowMs).toBeGreaterThan(15_000);
		expect(early.mana.starved.ms).toBe(0);
		expect(early.mana.starved.unprovenMs).toBeGreaterThan(15_000);
		expect(early.mana.starved.gradedMs).toBe(0);
	});

	/**
	 * A dip shorter than one global. The priority order re-reads the pool once a global, so a shorter dip
	 * is one it never looked at the pool inside — nothing to charge. The graded clock is *not* empty here,
	 * which is the difference from the two cases above: this pull did offer the reading, and the honest
	 * answer is a full mark rather than a shrug.
	 */
	it('charges nothing for a dip shorter than one global, but still grades the pull', () => {
		const blink = synthetic({ low: { from: 150_000, to: 151_200, pct: 10 } });
		expect(blink.mana.starved.gradedMs).toBeGreaterThan(0);
		expect(blink.mana.starved.gradedMs).toBeLessThan(blink.mana.floorMs);
		expect(blink.mana.starved.ms).toBe(0);
		const metric = scoreAnalysis(blink).sections['mana']?.metrics.find((m) => m.key === 'thunderstormMissed');
		expect(metric?.unmeasurable).toBe(false);
		expect(metric?.grade).toBe('good');
	});

	/**
	 * Pressing it on a full pool is stated and never charged — the plan asked for one or the other to be
	 * said out loud rather than implied. The count moves; nothing in the scorecard does.
	 */
	it('counts a press taken above the line without charging for it', () => {
		const early = synthetic({ presses: [{ at: 100_000, id: THUNDERSTORM }] });
		expect(early.mana.earlyThunderstorms).toBe(1);
		expect(early.mana.starved.ms).toBe(0);
		expect(scoreAnalysis(early).sections['mana']?.unmeasurable).toBe(true);
	});
});

// -------------------------------------------------------------------------- fault 2, Shamanistic Rage

describe('the cost reduction never pressed', () => {
	/**
	 * 30 seconds at 50% mana from 90s. Above Thunderstorm's line and below the Rage's, and `cleave`'s own
	 * Rage presses are at 155.8s and 237.5s — so the button was provably in hand across the whole stretch
	 * and Thunderstorm's fault must stay silent.
	 */
	const strained = synthetic({ low: { from: 90_000, to: 120_000, pct: 50 } });

	it('counts the press that was not made, and leaves Thunderstorm out of it', () => {
		expect(strained.mana.strained.stretches).toBe(1);
		expect(strained.mana.strained.ms).toBeGreaterThan(25_000);
		expect(strained.mana.starved.lowMs).toBe(0);
		expect(strained.mana.starved.ms).toBe(0);
	});

	it('grades on the count rather than the duration, so a long stretch is still one missed press', () => {
		const metric = scoreAnalysis(strained).sections['mana']?.metrics.find((m) => m.key === 'shamanisticRageMissed');
		expect(metric?.unmeasurable).toBe(false);
		expect(metric?.value).toBe(1);
		expect(metric?.grade).toBe('ok');
	});

	it('charges nothing while the Rage was provably away', () => {
		// `cleave` presses the Rage at 155.8s, so 160–180s has it on cooldown for all of a 60s timer.
		const covered = synthetic({ low: { from: 160_000, to: 180_000, pct: 50 } });
		expect(covered.mana.strained.lowMs).toBeGreaterThan(15_000);
		expect(covered.mana.strained.ms).toBe(0);
		expect(covered.mana.strained.onCooldownMs).toBeGreaterThan(15_000);
	});
});

// ------------------------------------------------------- the link to Lightning Shield, where it holds

describe('the Lightning Shield link', () => {
	/**
	 * `cleave` drops the shield exactly once, from 106.3s to 112.2s (`lightningShield.downWindows`), and
	 * Rolling Thunder returns 2% of maximum mana per charge only while the buff is up. A starved stretch
	 * across that gap is starvation the shield contributed to.
	 */
	it('reports the overlap when the starved stretch really did run with the shield off', () => {
		const overlapping = synthetic({ low: { from: 104_000, to: 118_000, pct: 10 } });
		expect(overlapping.lightningShield.downWindows).toEqual([{ start: 106_254, end: 112_154 }]);
		expect(overlapping.mana.starved.ms).toBeGreaterThan(10_000);
		expect(overlapping.mana.shieldDownMs).toBeGreaterThan(5_000);
	});

	/** And says nothing at all when it did not — the section must not imply a cause it cannot show. */
	it('reports no overlap for starvation nowhere near the shield dropping', () => {
		const elsewhere = synthetic({ low: { from: 150_000, to: 175_000, pct: 10 } });
		expect(elsewhere.mana.starved.ms).toBeGreaterThan(20_000);
		expect(elsewhere.mana.shieldDownMs).toBe(0);
	});
});
