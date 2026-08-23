// The Mana section's two faults, and the three ways a low pool is deliberately *not* charged.
//
// **Every assertion about a firing fault is on a synthetic pull, and that is a finding rather than a
// convenience.** None of the three committed fixtures can exercise either fault:
//
//   - `phased` and `unbroken` carry **no `classResources` readings at all** — both were captured
//     without `includeResources: true` — so their mana bar has zero samples and every figure in this
//     audit is a zero that means nothing. That is what the unmeasurable clause in `score.ts` is for,
//     and the first block below is the guard on it.
//   - `cleave` is the pull the two-target priority order was written for and does carry the bar: 1 189
//     readings on a 300 000 pool, median 46ms apart. **Its lowest reading of the whole pull is 77.7%.**
//     It never comes within sixty points of Thunderstorm's 15% line and never touches Shamanistic
//     Rage's 70% line either, so both faults are unmeasurable on it too — not zero, unmeasurable.
//
// So the synthetic pulls are `cleave`'s own event stream with **only the pool rewritten** over a chosen
// stretch: the same casts, the same shield, the same timing, one bar moved. That is deliberately not a
// hand-built dataset — the shape of the evidence is what fixture bugs hide in, and a fabricated stream
// would let this file agree with itself about an event layout no log produces. Nothing here is written
// to disk; no fixture is invented.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Analysis, ElementalAuditResult, FightDataset, WclEvent } from '~/lib/types';

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

describe('the three committed pulls', () => {
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
		for (const name of ['phased', 'unbroken', 'cleave'] as const) {
			const card = scoreAnalysis(fx(name));
			const mana = card.sections['mana'];
			expect(mana?.unmeasurable, name).toBe(true);
			for (const metric of mana?.metrics ?? []) expect(metric.unmeasurable, `${name} ${metric.key}`).toBe(true);
		}
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
		expect(scoreAnalysis(fx('phased')).overall).toBe('good');
		expect(scoreAnalysis(fx('unbroken')).overall).toBe('ok');
		expect(scoreAnalysis(fx('cleave')).overall).toBe('ok');
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
	 * press taken a second before the bell is invisible in this pull and a press taken any earlier has
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
