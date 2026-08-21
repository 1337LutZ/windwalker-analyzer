// The two Ascendance press rules: the opener against the raid's haste cooldown, and every later
// press against the T16 two-piece debuff.
//
// The three committed anonymous pulls are worth more than any synthetic case here, because between
// them they carry three *different* members of the shared haste group — `phased`
// (`a:qHRAFwdGzaB6MPYC` #14) takes a **Heroism** cast by another player, `unbroken`
// (`a:xB3kh7v9pF2AHRtq` #16) a **Bloodlust** the shaman cast himself, and `cleave`
// (Siegecrafter Blackfuse #46) a **Time Warp** — and all three read identically through
// `Handles.hasteWindows` without this module naming a spell.
//
// They also happen to cover both arms and one exemption on real data: two of the three second
// presses are genuinely unsynced, and `unbroken`'s is 714 ms from the kill and therefore exempt.
//
// Everything else is synthetic, because not one of the three exercises a refusal on its opener.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { auraWindows } from '~/lib/analysis/auras';
import type { AuraWindow } from '~/lib/analysis/auras';
import type { Interval } from '~/lib/analysis/intervals';
import { eventsOn } from '~/lib/events';
import type { Analysis, ElementalAuditResult, FightDataset, Window } from '~/lib/types';
import { ascendanceSync, ASCENDANCE_INTO_HASTE_MS, T16_2PC_SYNC_MIN_MS, type AscendanceSyncInput } from '../ascendance';
import { analyse, isOpener, registry } from '../index';

// ------------------------------------------------------------------ real pulls

/**
 * One committed pull, as the exact values the wiring hunk would hand this module.
 *
 * Read through `analyse()` rather than off the raw events, so the test proves the audit really does
 * hold every input this function needs — the point of the deliverable is that wiring it in is a call,
 * not another walk of the stream.
 *
 * Two of the five come from places worth naming. The two-piece windows are read off the
 * `t16-2pc-debuff` timeline lane, which is `t16DebuffWindows` — the *live* 144999 reading, not the
 * dead 144998 one. And `ascendanceAtPull` is walked here from the raw stream rather than taken off
 * `analysis.ascendance.atPull`, which the audit now publishes: reading the audit's own answer back
 * would make the wiring suite below assert a value against itself. The suite pins the two against
 * each other instead, which is the check worth having — see `the wiring, end to end`.
 */
function pull(name: string): { input: AscendanceSyncInput; analysis: Analysis & ElementalAuditResult } {
	const dataset = JSON.parse(
		readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8'),
	) as FightDataset;
	const analysis = analyse(dataset) as Analysis & ElementalAuditResult;
	const selfEvents = eventsOn(dataset.events, dataset.actor.id);
	// The lane list is filtered to non-empty windows, so an absent lane is the honest `null`: this pull
	// shows no evidence of the two-piece. That is the same decision the wiring hunk makes.
	const discharge = analysis.timeline?.lanes?.find((l) => l.key === 't16-2pc-debuff')?.windows ?? null;
	return {
		analysis,
		input: {
			ascendanceCasts: analysis.ascendance.presses.map((p) => p.t),
			ascendanceAtPull: auraWindows(
				selfEvents,
				registry.aura('ascendance'),
				dataset.fight.startTime,
				dataset.fight.endTime,
				{ openAtPull: true },
			).some((w) => w.preexisting === true),
			hasteWindows: analysis.timeline?.hasteWindows ?? [],
			contact: (analysis.timeline?.contactSegments ?? []).map(([start, end]): Interval => [start, end]),
			durationMs: analysis.durationMs,
			t16TwoPieceWindows: discharge,
		},
	};
}

describe('the three committed anonymous pulls', () => {
	it('reads three different members of the haste group without naming one', () => {
		expect(pull('phased').input.hasteWindows).toEqual([{ start: 1777, end: 41_785, id: 32_182, variant: 'Heroism' }]);
		expect(pull('unbroken').input.hasteWindows).toEqual([{ start: 785, end: 40_790, id: 2825, variant: 'Bloodlust' }]);
		expect(pull('cleave').input.hasteWindows).toEqual([{ start: 941, end: 40_947, id: 80_353, variant: 'Time Warp' }]);
	});

	it('finds the two-piece in evidence on all three, through the id the game actually logs', () => {
		// 144999 and not 144998. If the audit's `t16-2pc-proc` lane were the one carrying this, all three
		// would come back `null` — it is filtered out of every one of them for being empty.
		for (const name of ['phased', 'unbroken', 'cleave']) {
			const { analysis, input } = pull(name);
			expect(input.t16TwoPieceWindows).not.toBeNull();
			expect(input.t16TwoPieceWindows?.length ?? 0).toBeGreaterThan(4);
			expect(analysis.timeline?.lanes?.some((l) => l.key === 't16-2pc-proc')).toBe(false);
		}
	});

	it('grades every opener good, none of them pre-pull', () => {
		// The three deltas from the haste cooldown opening: 3229, 2891 and 2546 ms. All inside the bound,
		// and pinned individually so a change to any one pull is visible rather than averaged away.
		const expected = [
			['phased', 1777, 5006, 3229],
			['unbroken', 785, 3676, 2891],
			['cleave', 941, 3487, 2546],
		] as const;
		for (const [name, syncStartMs, t, delayMs] of expected) {
			const { input } = pull(name);
			expect(input.ascendanceAtPull).toBe(false);
			expect(ascendanceSync(input).presses[0]).toEqual({
				t,
				rule: 'bloodlust',
				grade: 'good',
				reason: null,
				delayMs,
				dischargeRemainingMs: null,
				syncStartMs,
				limitMs: 5000,
			});
		}
	});

	it('faults the second press on the two pulls where the pull had time left', () => {
		// `phased` presses again at 196.2s with 62.1s of pull left, `cleave` at 184.2s with 79.0s left.
		// Neither has any Elemental Discharge up at all — both fall between debuff windows — so the sync
		// entry 15 asks for was simply not attempted.
		for (const [name, t] of [
			['phased', 196_197],
			['cleave', 184_240],
		] as const) {
			const { input } = pull(name);
			expect(input.durationMs - t).toBeGreaterThan(T16_2PC_SYNC_MIN_MS);
			expect(ascendanceSync(input).presses[1]).toEqual({
				t,
				rule: 't16-2pc',
				grade: 'bad',
				reason: null,
				delayMs: null,
				dischargeRemainingMs: 0,
				syncStartMs: null,
				limitMs: 10_000,
			});
		}
	});

	it('exempts a second press made 714ms before the kill', () => {
		// `unbroken` presses at 183 734 of a 184 448 ms pull. It *is* inside a discharge window — 664 ms
		// of it left — so a rule that only compared remaining time would fault it. Ten seconds could not
		// have existed with 714 ms of pull to go, so the press is exempt rather than bad. This is the
		// guard, on real data.
		const { input } = pull('unbroken');
		expect(input.durationMs - 183_734).toBe(714);
		expect(ascendanceSync(input).presses[1]).toEqual({
			t: 183_734,
			rule: 't16-2pc',
			grade: 'none',
			reason: 'pull-ends-too-soon',
			delayMs: null,
			dischargeRemainingMs: null,
			syncStartMs: null,
			limitMs: 10_000,
		});
	});

	it('rolls the pull up to its worst gradeable press', () => {
		// `unbroken` is a good opener plus one exempt press, so the pull is good; the other two carry a
		// real fault and are bad. An exemption must not drag a pull down and must not lift one up.
		expect(ascendanceSync(pull('unbroken').input).grade).toBe('good');
		expect(ascendanceSync(pull('phased').input).grade).toBe('bad');
		expect(ascendanceSync(pull('cleave').input).grade).toBe('bad');
	});
});

// ------------------------------------------------------------------ the wiring

/**
 * The audit's own call, rather than this suite's reconstruction of it.
 *
 * Every assertion above hands `ascendanceSync` a hand-assembled input and grades the return. That
 * proves the rules and proves nothing about `analyse()`, which is how this module spent 34 passing
 * tests as dead code — `grep -rn "ascendance'" src/ | grep import` returned exactly one line, this
 * file's. So these read `analysis.ascendance` and never call `ascendanceSync` at all.
 *
 * The three grades are the literals plan §53 already knew, and they are pinned as literals on
 * purpose: a test that compared the audit's grade against `ascendanceSync(pull(name).input).grade`
 * would pass whatever the wiring passed, since both sides would come out of the same five values.
 */
describe('the wiring, end to end', () => {
	it('publishes one grade per pull, and it is the grade the rules give', () => {
		// `unbroken` is a good opener plus one press exempted 714ms from the kill; the other two carry a
		// real unsynced second press. Section 53's three known values, asserted at the level that was
		// missing rather than by recomputing them.
		expect(pull('unbroken').analysis.ascendance.grade).toBe('good');
		expect(pull('phased').analysis.ascendance.grade).toBe('bad');
		expect(pull('cleave').analysis.ascendance.grade).toBe('bad');
	});

	it('grades each press with the rule that governs it, off the audit alone', () => {
		// The one end-to-end case §53 asked for, and the numbers are the fixture's own: `unbroken`'s
		// second press at 183 734 of a 184 448 ms pull. Written out in full so the wiring cannot pass by
		// handing the module an empty input and getting a shapely `none` back — an opener graded `good`
		// with a `delayMs` of 2 891 can only come from `hasteWindows` having arrived.
		const { presses } = pull('unbroken').analysis.ascendance;
		expect(presses.map((p) => [p.t, p.sync.t])).toEqual([
			[3676, 3676],
			[183_734, 183_734],
		]);
		expect(presses.map((p) => p.sync)).toEqual([
			{
				t: 3676,
				rule: 'bloodlust',
				grade: 'good',
				reason: null,
				delayMs: 2891,
				dischargeRemainingMs: null,
				syncStartMs: 785,
				limitMs: 5000,
			},
			{
				t: 183_734,
				rule: 't16-2pc',
				grade: 'none',
				reason: 'pull-ends-too-soon',
				delayMs: null,
				dischargeRemainingMs: null,
				syncStartMs: null,
				limitMs: 10_000,
			},
		]);
	});

	it('passes the two-piece debuff and not the id the game never writes', () => {
		// If the wiring had reached for the dead 144998 reading the windows would be empty, the arm would
		// refuse with `no-two-piece-evidence`, and `phased` and `cleave` would come back `none` instead of
		// carrying the fault. So the reason field is the evidence for which id arrived.
		for (const name of ['phased', 'cleave'] as const) {
			const second = pull(name).analysis.ascendance.presses[1]?.sync;
			expect([second?.rule, second?.grade, second?.reason, second?.dischargeRemainingMs]).toEqual([
				't16-2pc',
				'bad',
				null,
				0,
			]);
		}
	});

	it('publishes the pre-pull guard, and agrees with a raw walk of the stream', () => {
		// Not one committed pull has Ascendance up at the bell, so the published flag is `false` on all
		// three — and it is published anyway, because it is the difference between a press that was not
		// made and a press the log cannot see. The audit's reading is the *guarded* one (a press at or
		// before the recovered expiry vouches for the window), so it can only be narrower than this
		// walk; on all three both come out false and the two are pinned against each other.
		for (const name of ['phased', 'unbroken', 'cleave'] as const) {
			const { analysis, input } = pull(name);
			expect(analysis.ascendance.atPull).toBe(false);
			expect(input.ascendanceAtPull).toBe(false);
		}
	});
});

// ------------------------------------------------------------------ synthetic

const lust = (start: number, end: number): AuraWindow => ({ start, end, id: 2825, variant: 'Bloodlust' });
const win = (start: number, end: number): Window => ({ start, end });

/** A clean pull: lust at the bell, contact from the first global, Ascendance not up beforehand. */
const base: AscendanceSyncInput = {
	ascendanceCasts: [2000],
	ascendanceAtPull: false,
	hasteWindows: [lust(1000, 41_000)],
	contact: [[900, 300_000]],
	durationMs: 300_000,
	t16TwoPieceWindows: null,
};

const at = (over: Partial<AscendanceSyncInput>): ReturnType<typeof ascendanceSync> =>
	ascendanceSync({ ...base, ...over });

/** The first press's verdict, which is the only one most synthetic cases have. */
const first = (over: Partial<AscendanceSyncInput>): ReturnType<typeof ascendanceSync>['presses'][number] => {
	const press = at(over).presses[0];
	if (press === undefined) throw new Error('expected a press');
	return press;
};

/**
 * `isOpener`, which is a *different* bound from the one the suite below pins, and the two now differ.
 *
 * Both were bare 5 000s and both were called "the opener". `isOpener` is anchored on the **pull** and is
 * what `AscendancePress.opener` and the Elemental Mastery `'opener'` branch read; `ASCENDANCE_INTO_HASTE_MS`
 * is anchored on the **haste cooldown opening** and is what the suite below grades against. Only the
 * pull-anchored one carries the 250ms tolerance, and deliberately: the haste constant has three further
 * readers (the lateness grade, whether a cooldown counts as "on the pull", and the `nothing-to-hit`
 * exemption's right edge) and widening it would move all three.
 *
 * So "faults a press one millisecond past it" below still means exactly what it says — about the haste
 * bound. Read the two suites together or the 5 000 in one and the 5 250 in the other look like a
 * contradiction.
 */
describe('the pull-anchored opener bound', () => {
	it('admits the press that used to miss it by six milliseconds', () => {
		// `phased`'s opening Ascendance, the case this tolerance exists for — pinned end to end in
		// `pulls.test.ts`, and here as the predicate on its own.
		expect(isOpener(5006)).toBe(true);
	});

	it('is 5 250ms and reports both sides of itself', () => {
		expect(isOpener(5250)).toBe(true);
		expect(isOpener(5251)).toBe(false);
		// A press before the bell's own first global is trivially the opener; a press a full global late
		// still is not, which is the whole objection to flooring — `Math.floor(t / 1000) * 1000 <= 5000`
		// would have admitted every one of these.
		expect(isOpener(0)).toBe(true);
		expect([isOpener(5500), isOpener(5999)]).toEqual([false, false]);
	});
});

describe('the opener bound, and which side of it a press falls on', () => {
	it('is one number and reports itself, so the threshold is never implicit', () => {
		expect(ASCENDANCE_INTO_HASTE_MS).toBe(5000);
		expect(first({}).limitMs).toBe(5000);
		// And it is *not* the pull-anchored bound, which is 250ms wider. Asserted so a future change that
		// unifies them has to come through this line and say why.
		expect(isOpener(ASCENDANCE_INTO_HASTE_MS + 1)).toBe(true);
	});

	it('passes a press exactly on the bound', () => {
		const v = first({ ascendanceCasts: [1000 + ASCENDANCE_INTO_HASTE_MS] });
		expect([v.grade, v.delayMs]).toEqual(['good', 5000]);
	});

	it('faults a press one millisecond past it', () => {
		const v = first({ ascendanceCasts: [1000 + ASCENDANCE_INTO_HASTE_MS + 1] });
		expect([v.grade, v.delayMs]).toEqual(['bad', 5001]);
	});

	it('does not treat a press made before the cooldown landed as late', () => {
		// The bound is an upper bound on lateness, not a demand that the two land in an order. A press at
		// 200ms with lust at 1000ms is the opener going out first, which is not a fault.
		const v = first({ ascendanceCasts: [200] });
		expect([v.grade, v.delayMs]).toEqual(['good', -800]);
	});
});

describe('what the opener rule refuses to grade', () => {
	it('says nothing when the haste cooldown went out after the opener', () => {
		// A Bloodlust at 90s is a different tactical situation — Ascendance may well have been spent
		// already — so it is not read as the pull's, and no fault is invented.
		const v = first({ hasteWindows: [lust(90_000, 130_000)] });
		expect([v.rule, v.grade, v.reason, v.syncStartMs]).toEqual(['bloodlust', 'none', 'no-cooldown-on-pull', null]);
	});

	it('says nothing when the pull carried no haste cooldown at all', () => {
		// Which also covers the cooldown cast *before* the bell: the Bloodlust aura declares no duration,
		// so `auraWindows` cannot recover a pre-pull window for it and the walk comes back empty.
		const v = first({ hasteWindows: [] });
		expect([v.grade, v.reason]).toEqual(['none', 'no-cooldown-on-pull']);
	});

	it('has no press to grade when Ascendance was never pressed', () => {
		const v = at({ ascendanceCasts: [] });
		expect([v.presses, v.grade]).toEqual([[], 'none']);
	});

	it('says nothing when Ascendance was already running at the bell', () => {
		// Pressed before the pull: the button is down for three minutes and the press this rule judges is
		// not in the stream. Faulting the first *visible* press here is the exact shape of bug the audit
		// has shipped four times.
		const v = first({ ascendanceAtPull: true, ascendanceCasts: [30_000] });
		expect([v.grade, v.reason]).toEqual(['none', 'ascendance-up-at-the-pull']);
	});

	it('says nothing when the first visible press is past one full cooldown', () => {
		// At 180.001s the press could be a recharge whose first charge was spent before the pull and left
		// no trace — more than fifteen seconds before the bell, so not even `ascendanceAtPull` catches it.
		const v = first({ ascendanceCasts: [180_001] });
		expect([v.grade, v.reason]).toEqual(['none', 'first-press-past-one-cooldown']);
	});

	it('grades a press on the cooldown boundary itself', () => {
		// The complement of the test above, so the boundary is pinned rather than assumed: 180 000 is
		// still graded, and graded bad, because at that point the press is provably the first.
		const v = first({ ascendanceCasts: [180_000] });
		expect([v.grade, v.reason, v.delayMs]).toEqual(['bad', null, 179_000]);
	});

	it('says nothing when there was nothing reachable inside the graded window', () => {
		// A pull that opened on an intermission. `[1000, 6000]` is the stretch being judged and contact
		// does not begin until 20s, so the press could not have bought anything.
		const v = first({ contact: [[20_000, 300_000]], ascendanceCasts: [25_000] });
		expect([v.grade, v.reason, v.syncStartMs]).toEqual(['none', 'nothing-to-hit', 1000]);
	});

	it('grades a pull whose contact begins on the last millisecond of the graded window', () => {
		// The boundary of the exemption, pinned from the other side.
		const v = first({ contact: [[6000, 300_000]], ascendanceCasts: [3000] });
		expect([v.grade, v.reason]).toEqual(['good', null]);
	});

	it('says nothing when the pull carried no enemy at all', () => {
		const v = first({ contact: [] });
		expect([v.grade, v.reason]).toEqual(['none', 'nothing-to-hit']);
	});
});

describe('the two-piece rule, on every press that is not the opener', () => {
	/** A pull with an opener and one later press at 200s, the two-piece in evidence around it. */
	const later = (over: Partial<AscendanceSyncInput> = {}) =>
		at({ ascendanceCasts: [2000, 200_000], t16TwoPieceWindows: [win(195_000, 212_000)], ...over });

	const second = (over: Partial<AscendanceSyncInput> = {}) => {
		const press = later(over).presses[1];
		if (press === undefined) throw new Error('expected a second press');
		return press;
	};

	it('is the sim priority-15 threshold and reports itself', () => {
		expect(T16_2PC_SYNC_MIN_MS).toBe(10_000);
		expect(second().limitMs).toBe(10_000);
	});

	it('passes a press with exactly ten seconds of discharge left', () => {
		const v = second({ t16TwoPieceWindows: [win(195_000, 210_000)] });
		expect([v.rule, v.grade, v.dischargeRemainingMs, v.syncStartMs]).toEqual(['t16-2pc', 'good', 10_000, 195_000]);
	});

	it('faults a press one millisecond short of it', () => {
		const v = second({ t16TwoPieceWindows: [win(195_000, 209_999)] });
		expect([v.grade, v.dischargeRemainingMs]).toEqual(['bad', 9999]);
	});

	it('faults a press that found no discharge at all, and calls it zero', () => {
		// Zero rather than null: the set is in evidence, so Fulmination was the player's to press and the
		// absence is the fault entry 15 describes rather than a missing measurement.
		const v = second({ t16TwoPieceWindows: [win(20_000, 32_000)] });
		expect([v.grade, v.reason, v.dischargeRemainingMs, v.syncStartMs]).toEqual(['bad', null, 0, null]);
	});

	it('says nothing when the caller established the player has no two-piece', () => {
		const v = second({ t16TwoPieceWindows: null });
		expect([v.rule, v.grade, v.reason]).toEqual(['t16-2pc', 'none', 'no-two-piece-evidence']);
	});

	it('does not fall through to the opener rule when the two-piece landed nothing', () => {
		// An empty array is not `null`. The set is there, the pull never landed a Fulmination, and the
		// rule says so — it does not hand the press to a rule that does not govern it. A `delayMs` of any
		// kind here would mean the fall-through happened.
		const v = second({ t16TwoPieceWindows: [] });
		expect([v.rule, v.grade, v.reason, v.delayMs]).toEqual(['t16-2pc', 'none', 't16-2pc-not-in-log', null]);
	});

	it('exempts a press with less pull left than the sync itself demands', () => {
		const v = second({ durationMs: 209_999 });
		expect([v.grade, v.reason]).toEqual(['none', 'pull-ends-too-soon']);
	});

	it('grades a press with exactly enough pull left', () => {
		// 210 000 − 200 000 is the ten seconds the rule asks for, so this side of the boundary is judged.
		const v = second({ durationMs: 210_000 });
		expect([v.grade, v.reason, v.dischargeRemainingMs]).toEqual(['good', null, 12_000]);
	});

	it('says nothing when the player was not in contact at the press', () => {
		// An instant, not a window — the honest question for a moment mid-pull.
		const v = second({ contact: [[900, 150_000]] });
		expect([v.grade, v.reason]).toEqual(['none', 'nothing-to-hit']);
	});
});

describe('precedence: one rule per press, decided once', () => {
	it('judges the opener by the haste cooldown even when the two-piece is in evidence', () => {
		// Built so the two rules disagree, which is the only way this assertion means anything. The press
		// at 2 000 ms is 1 000 ms into a lust that opened at 1 000 — good under the opener rule — and sits
		// in no discharge window at all, which would be bad under the two-piece rule. `good` is proof the
		// two-piece rule did not reach it. Sim priority 14 outranks 15, and all three real pulls would
		// otherwise be faulted for an opener the list explicitly sanctions.
		const v = at({ t16TwoPieceWindows: [win(100_000, 112_000)] }).presses[0];
		expect([v?.rule, v?.grade, v?.delayMs, v?.dischargeRemainingMs]).toEqual(['bloodlust', 'good', 1000, null]);
	});

	it('judges a later press by the two-piece even when the haste cooldown would have graded it', () => {
		// The mirror image, and the term that matters is `delayMs`. This press is 199 000 ms into the lust
		// window — flatly bad under the opener rule — and has 12 000 ms of discharge, which is good. A
		// `good` with a null `delayMs` is proof the haste cooldown was not consulted for it.
		const v = at({
			ascendanceCasts: [2000, 200_000],
			t16TwoPieceWindows: [win(195_000, 212_000)],
		}).presses[1];
		expect([v?.rule, v?.grade, v?.delayMs, v?.dischargeRemainingMs]).toEqual(['t16-2pc', 'good', null, 12_000]);
	});

	it('applies the two-piece rule to a later press on a pull with no haste cooldown whatsoever', () => {
		// The opener rule's own precondition is never consulted for a press it does not govern.
		const v = at({
			hasteWindows: [],
			ascendanceCasts: [2000, 200_000],
			t16TwoPieceWindows: [win(195_000, 212_000)],
		});
		expect(v.presses.map((p) => [p.rule, p.grade, p.reason])).toEqual([
			['bloodlust', 'none', 'no-cooldown-on-pull'],
			['t16-2pc', 'good', null],
		]);
	});

	it('names the rule by position alone, for every press in a three-press pull', () => {
		const v = at({ ascendanceCasts: [2000, 190_000, 290_000], t16TwoPieceWindows: [] });
		expect(v.presses.map((p) => p.rule)).toEqual(['bloodlust', 't16-2pc', 't16-2pc']);
	});
});
