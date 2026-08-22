// The three graded clocks drop the stretches no list had a rule for, and an empty clock refuses to grade.
//
// This is the half of the band exemption that changes a number, and until it landed the other half
// presented as band-aware while forgiving nothing. `MetricRule.bands` nulls a metric only when the band
// intersection comes out **empty** — a pull that never visited the rule's bands at all — so on the mixed
// pull the whole exercise is about it does nothing: `cleave` resolves to `[1, 2, 3, 4]`, every declaration
// intersects non-empty, and every clock carried on grading add-wave time exactly as before.
// `lib/score/bands.ts` says as much in its own words: "Nothing here decides *how much* of a clock to cut."
//
// So the cut is the audit's, and there are two claims to pin:
//
//   1. **Both halves of every ratio are cut with the same array.** Clipping a numerator and not its
//      denominator is how a percentage above 100 happens, and `flameShock.uptimePct` has already produced
//      one that way — the 100.21% its own docblock dissects at length.
//   2. **An empty clock says "cannot say" rather than grading.** `0ms` of overcap over `0ms` of gradable
//      time is a perfect zero against a `good: 0` threshold — the best mark on the card, handed to exactly
//      the pull the exemption just excused. That is the free pass this whole effort would otherwise have
//      *created*, and no proxy catches it: `maxStacks > 0` is true of such a pull, because the shield was
//      up and counting the whole way through.
//
// `phased` and `unbroken` never exceed one enemy, so every assertion about them here is a no-change guard
// and is labelled as one. `cleave` is the only committed fixture with band-3+ time.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { complementOf, type Interval, intersect, unionMs } from '~/lib/analysis/intervals';
import type { WclEvent } from '~/lib/events';
import type { Analysis, ElementalAuditResult, FightDataset, Window } from '~/lib/types';

import { analyse } from '../index';
import { scoreAnalysis } from '../score';

const FIXTURES = ['phased', 'unbroken', 'cleave'] as const;
type Fixture = (typeof FIXTURES)[number];

const load = (name: string): FightDataset =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8')) as FightDataset;

const el: Record<Fixture, Analysis & ElementalAuditResult> = {
	phased: analyse(load('phased')) as Analysis & ElementalAuditResult,
	unbroken: analyse(load('unbroken')) as Analysis & ElementalAuditResult,
	cleave: analyse(load('cleave')) as Analysis & ElementalAuditResult,
};

const toIntervals = (windows: readonly Window[]): Interval[] => windows.map((w) => [w.start, w.end]);

/**
 * The graded stretches, re-derived in the test off two arrays the analysis publishes for other reasons.
 *
 * Deliberately **not** read back off a field the audit exposes for this purpose: an assertion whose two
 * sides both come from the thing under test passes whatever that thing says. `contactSegments` is the
 * timeline's own array and `lightningShield.aoeWindows` is the one the chart greys, so this reconstructs
 * the clock from the reader's view of the pull and then demands the audit agree.
 *
 * It also degenerates the right way, which is what makes it a signature rather than a renumbering: with
 * no AoE stretches `complementOf` is the whole pull and this collapses to `unionMs(contactSegments)` —
 * exactly the assertion this file's predecessors made, so the two single-target fixtures are pinned to
 * the identical figure before and after the change.
 */
const gradedContact = (a: Analysis & ElementalAuditResult): Interval[] =>
	intersect(a.timeline?.contactSegments ?? [], complementOf(toIntervals(a.lightningShield.aoeWindows), a.durationMs));

describe('the graded clocks drop the stretches three or more enemies were up', () => {
	/**
	 * Flame Shock's denominator, derived rather than pinned.
	 *
	 * `cleave` loses 82 758ms of a 261 572ms clock — the 82 858ms exempt array less the 100ms of it that
	 * fell outside the contact clock anyway. That is the *trimmed* exemption: `fbc4963` cut a window of
	 * trailing boss-only time off the end of every add wave, worth 27 011ms, so any figure quoted for this
	 * before that commit is 109 869ms and does not describe this behaviour.
	 */
	it('measures the dot over contact time less the AoE stretches', () => {
		for (const name of FIXTURES) {
			expect(el[name].flameShock.scoredMs, name).toBe(unionMs(gradedContact(el[name])));
		}
		// And the figure itself, so a derivation that quietly went to zero on both sides cannot pass.
		// 82 758 and not the 82 858 of the exempt array: 100ms of it lies outside the contact clock, which
		// was already dropping that stretch for its own reason. Subtracting the array's whole length here
		// would be the double-count `intersect` exists to avoid.
		expect(el.cleave.flameShock.scoredMs).toBe(261_572 - 82_758);
		// The two single-target pulls: unchanged, because there is nothing to drop. Non-vacuous — both
		// carry a real clock, and `phased`'s is 32.7s short of its engaged time for a different reason.
		expect(el.phased.flameShock.scoredMs).toBe(206_557);
		expect(el.unbroken.flameShock.scoredMs).toBe(181_775);
	});

	/**
	 * The totem's denominator, which had two exempt causes composed into it already and now has three.
	 * The Fire Elemental's window and the intermissions were always out; the add waves are the new one.
	 */
	it('measures the totem over contact time less the elemental and less the AoE stretches', () => {
		for (const name of FIXTURES) {
			const audit = el[name].searingTotem;
			const slotFree = complementOf(toIntervals(audit.feWindows), el[name].durationMs);
			expect(audit.scoredMs, name).toBe(unionMs(intersect(gradedContact(el[name]), slotFree)));
		}
		// `phased` and `unbroken` unchanged — no-change guards, and both are well clear of zero.
		expect(el.phased.searingTotem.scoredMs).toBe(150_310);
		expect(el.unbroken.searingTotem.scoredMs).toBe(125_314);
	});

	/**
	 * The shield's clock, and the only one of the three whose length had no published field at all before
	 * this. The array was published, the overcap was measured inside it, and the length — the one number
	 * that can tell "nothing to fault" from "nothing judged" — was not.
	 */
	it('publishes the length of the clock the overcap was measured inside', () => {
		for (const name of FIXTURES) {
			const a = el[name];
			expect(a.lightningShield.gradedMs, name).toBe(
				unionMs(complementOf(toIntervals(a.lightningShield.aoeWindows), a.durationMs)),
			);
		}
		expect(el.cleave.lightningShield.gradedMs).toBe(263_233 - 82_858);
		// The whole pull on the two that never leave one enemy — no-change guards.
		expect(el.phased.lightningShield.gradedMs).toBe(el.phased.durationMs);
		expect(el.unbroken.lightningShield.gradedMs).toBe(el.unbroken.durationMs);
	});

	/**
	 * **One array, not three.** The dot's clock, the totem's and the shield's are all cut by the same
	 * derivation, and the shield's exempt array is the one the chart greys — so a reader shown a grey
	 * stretch on one section is looking at time all three denominators refused. Three copies of
	 * `complementOf(aoeWindows, duration)` would be three chances for one to drift, which is the identity
	 * `exemptTrack.test.ts` enforces a level out from here, among the charts.
	 */
	it('cuts all three clocks with the same stretches', () => {
		const a = el.cleave;
		const exempt = toIntervals(a.lightningShield.aoeWindows);
		expect(a.lightningShield.gradedMs).toBe(a.durationMs - unionMs(exempt));
		// The dot's clock is the shield's clock narrowed by contact, and the totem's is that narrowed again
		// by the elemental's window. Each is a subset of the one before it, in that order.
		expect(a.flameShock.scoredMs).toBeLessThan(a.lightningShield.gradedMs);
		expect(a.searingTotem.scoredMs).toBeLessThan(a.flameShock.scoredMs);
		// And no clock retains a single millisecond of exempt time.
		expect(unionMs(intersect(gradedContact(a), exempt))).toBe(0);
	});
});

describe('both halves of every ratio are cut with the same array', () => {
	/**
	 * The property the 100.21% bug was, stated as a test: a share whose numerator was clipped by one array
	 * and whose denominator was clipped by another is free to exceed 100%, and a band cut applied to one
	 * half only is that same defect with a new cause.
	 */
	it('keeps every uptime a real share of its own published clock', () => {
		for (const name of FIXTURES) {
			const { flameShock, searingTotem } = el[name];
			expect(flameShock.contactUptimeMs, name).toBeLessThanOrEqual(flameShock.scoredMs);
			expect((flameShock.contactUptimeMs / flameShock.scoredMs) * 100, name).toBe(flameShock.uptimePct);
			expect(flameShock.uptimePct, name).toBeLessThanOrEqual(100);

			expect(searingTotem.uptimeMs, name).toBeLessThanOrEqual(searingTotem.scoredMs);
			expect((searingTotem.uptimeMs / searingTotem.scoredMs) * 100, name).toBe(searingTotem.uptimePct);
			expect(searingTotem.uptimePct, name).toBeLessThanOrEqual(100);
		}
	});

	/**
	 * And the numerator really did move — the half it would be easy to leave behind, and the one whose
	 * omission the percentage would not reveal until it crossed 100.
	 *
	 * On `cleave` the dot's numerator loses 39 088ms — from 189 111 to 150 023 — which is the dot that was
	 * up while three or more enemies were being hit. Less than the 82 758ms the denominator lost, and that
	 * asymmetry is the finding rather than a discrepancy: through the add waves this player's dot was up
	 * for 47% of the time against 72% over the pull as a whole, which is exactly why the old figure read
	 * those stretches as the pull's largest fault.
	 */
	it('moves the numerator as well as the denominator on the pull that has AoE time', () => {
		expect(el.cleave.flameShock.contactUptimeMs).toBe(150_023);
		// The two single-target pulls keep theirs to the millisecond — no-change guards.
		expect(el.phased.flameShock.contactUptimeMs).toBe(202_842);
		expect(el.unbroken.flameShock.contactUptimeMs).toBe(181_775);
	});
});

// ------------------------------------------------------------ the empty clock

const T0 = 500_000;
const DURATION = 200_000;
const ME = 5;
const ADDS = [21, 22, 23];

const e = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: T0 + t,
	type,
	abilityGameID: id,
	sourceID: ME,
	targetID: ME,
	...extra,
});

/**
 * A pull spent entirely at three enemies — the case no committed fixture holds and the one every band
 * declaration in the table is a claim about.
 *
 * Three declared adds, each taking a hit every two seconds from the first event to the last, so the
 * APL target count never drops below three and `aoeWindows` covers the pull end to end. The shield is
 * driven to its ceiling early and left there, which under the old reading is 190-odd seconds of overcap
 * and the worst `lightningShieldOvercap` in the suite; under the new one there is no clock to measure it
 * in at all.
 *
 * Not a fixture, because no anonymous report we hold is shaped like this, and the point of the pull is
 * a shape rather than a player.
 */
const allAoeEvents: WclEvent[] = [
	...Array.from({ length: DURATION / 2000 + 1 }, (_, i) =>
		ADDS.map((add) => e(i * 2000, 'damage', 421, { targetID: add, amount: 5000, hitType: 1 })),
	).flat(),
	// The shield up before the bell, then eight Lightning Bolts to drive Rolling Thunder to the ceiling,
	// and nothing that ever spends it.
	...Array.from({ length: 7 }, (_, i) => e(1000 + i * 1000, 'applybuffstack', 324, { stack: i + 2 })),
	// One Lava Burst, so the pull reads as an Elemental at all — see `looksElemental`.
	e(500, 'cast', 51505, { targetID: ADDS[0] }),
];

const allAoe = analyse({
	code: 'aoe123',
	fight: {
		id: 1,
		name: 'Galakras',
		encounterID: 1622,
		kill: true,
		difficulty: 4,
		size: 25,
		startTime: T0,
		endTime: T0 + DURATION,
	},
	actor: { id: ME, name: 'Sparkstorm', type: 'Player' },
	actors: [
		{ id: ME, name: 'Sparkstorm', type: 'Player' },
		...ADDS.map((id) => ({ id, name: `Kor'kron Ironblade ${id}`, type: 'NPC' as const })),
	],
	events: allAoeEvents,
	table: {
		fight: {
			id: 1,
			name: 'Galakras',
			encounterID: 1622,
			kill: true,
			difficulty: 4,
			size: 25,
			startTime: T0,
			endTime: T0 + DURATION,
			enemyNPCs: ADDS.map((id) => ({ id, gameID: 72249 })),
		},
		damageDone: {
			entries: [
				{
					name: 'Sparkstorm',
					id: ME,
					type: 'Shaman',
					itemLevel: 553,
					total: 1_515_000,
					activeTime: DURATION,
					abilities: [{ guid: 421, name: 'Chain Lightning', total: 1_515_000 }],
				},
			],
		},
	},
}) as Analysis & ElementalAuditResult;

describe('a pull with no gradable stretch says so instead of grading it good', () => {
	/** The premise, asserted rather than assumed: this pull really is band 3 or more throughout. */
	it('is a pull spent wholly at three or more enemies', () => {
		expect(allAoe.targets?.counts?.max).toBeGreaterThanOrEqual(3);
		expect(unionMs(toIntervals(allAoe.lightningShield.aoeWindows))).toBe(allAoe.durationMs);
	});

	/**
	 * Every one of the three clocks is empty — which is the arithmetic that makes the guard reachable.
	 * Before the cut, two of these three were the full pull and only the shield's was zero.
	 */
	it('has an empty clock on all three banded readings', () => {
		expect(allAoe.lightningShield.gradedMs).toBe(0);
		expect(allAoe.flameShock.scoredMs).toBe(0);
		expect(allAoe.searingTotem.scoredMs).toBe(0);
	});

	/**
	 * **And the score refuses it rather than rewarding it.** This is the assertion the whole of step 2 is
	 * for: the shield sat at its ceiling for the entire pull and was never once spent, so the *fault* is
	 * as large as a fault can be — and yet `overcapMs` is zero, because none of that time was in a clock
	 * anything graded. Read as a value it is a flawless pull. Read with its clock it is a pull nobody
	 * looked at.
	 *
	 * `maxStacks > 0` is the guard this replaces and it is true here — the shield reached seven — which is
	 * why "was the thing present" was never the question.
	 */
	it('marks the shield overcap unmeasurable rather than good', () => {
		const shield = scoreAnalysis(allAoe).sections['lightningShield'];
		const overcap = shield?.metrics.find((m) => m.key === 'lightningShieldOvercap');
		expect(overcap).toBeDefined();
		expect(allAoe.lightningShield.maxStacks).toBeGreaterThan(0);
		expect(overcap?.unmeasurable).toBe(true);
		expect(overcap?.grade).not.toBe('good');
	});

	/** The same refusal on the other two banded clocks, for the same reason. */
	it('marks the dot and the totem clocks unmeasurable rather than perfect', () => {
		const card = scoreAnalysis(allAoe);
		const uptime = card.sections['flameShock']?.metrics.find((m) => m.key === 'flameShockUptime');
		const totem = card.sections['searingTotem']?.metrics.find((m) => m.key === 'searingTotemUptime');
		expect(uptime?.unmeasurable).toBe(true);
		expect(totem?.unmeasurable).toBe(true);
	});
});
