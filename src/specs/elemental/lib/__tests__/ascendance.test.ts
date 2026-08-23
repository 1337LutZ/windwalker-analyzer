// The two Ascendance press rules: the opener against the raid's haste cooldown, and every later
// press against the T16 two-piece debuff.
//
// The four committed anonymous pulls are worth more than any synthetic case here, because between
// them they carry three *different* members of the shared haste group — `phased`
// (`a:qHRAFwdGzaB6MPYC` #14) takes a **Heroism** cast by another player, `unbroken`
// (`a:xB3kh7v9pF2AHRtq` #16) a **Bloodlust** the shaman cast himself, `cleave`
// (Siegecrafter Blackfuse #46) a **Time Warp**, and `addsThenBoss` (Galakras heroic-25) a Heroism
// again — and all four read identically through `Handles.hasteWindows` without this module naming a
// spell.
//
// They also cover both arms and three of the six exemptions on real data: two of `phased`/`cleave`/
// `unbroken`'s second presses are genuinely unsynced, `unbroken`'s is 714 ms from the kill and
// therefore exempt, and `addsThenBoss` is exempt four times over — see below.
//
// *** Everything in this file that said "all three" was written when there were three, and the fourth
// pull contradicts several of them. *** The paragraphs that follow are the corrected versions; the
// literal `['phased', 'unbroken', 'cleave']` lists that used to sweep the committed set are now
// `rawFixtures('elemental')`, because a claim of the form "on every committed pull" written as a list
// of names is a claim that stops being asked the day a name is added.
//
// **`addsThenBoss` is the pull that breaks the old summary, and it breaks it four ways.**
//
//   - It does **not** open with Ascendance. Its first press is at 17 101 ms of a 560 261 ms pull, past
//     both the haste bound and `OPENER_DEADLINE_MS`. So "every opener is inside the pull-anchored bound
//     (5 006, 3 676, 3 487 ms)" is false; the fourth is twelve seconds outside it. What keeps rule 1
//     from faulting it is the `'nothing-to-hit'` exemption — that pull's contact clock does not open
//     until 7 004 ms, itself past the deadline — so **the opener refusal this file could only build
//     synthetically now has a captured log behind it.**
//   - It carries **no T16 two-piece at all** (144999 appears zero times), so its three later presses
//     come back `'no-two-piece-evidence'`. That refusal, too, was synthetic-only.
//   - Its only haste cooldown opens at **438 207 ms**, which the anchor search declines, so it is the
//     first committed pull to read as "no haste cooldown on the pull" with one plainly in the log.
//   - Every press being exempt makes the pull's grade **`none`** — a pull-level verdict no committed
//     fixture had. The headline row is therefore `bad` / `good` / `bad` / `none` and not three letters.
//
// **For the two absolute rules plan §80 added, neither fault still fires on any committed fixture** —
// but the reason has changed for the fourth pull and is worth stating rather than inheriting: rule 1
// does not fault `addsThenBoss` because an exemption runs first, not because the press was in the
// opener. Rule 2 fires on nothing: only `unbroken` has a press whose window runs past a kill at all,
// which rule 2 excuses because the button came back 58 ms before it.
//
// **Rules 3 and 4 (Skull Banner) are the same story, and this time it is a measurement.** All four
// pulls carry banners on the player from two warriors apiece, so both rules have real input on all ten
// presses — but on the union reading rule 3 uses, the ten overlaps are 15 000, 10 149 (`phased`),
// 15 000, 0 (`unbroken`), 13 944, 10 273 (`cleave`) and 11 373, 0, 1 499, 0 (`addsThenBoss`) against a
// 9 000 bound. **No committed press fails rule 3 — and on the fourth pull that is only because three of
// its presses are exempt for a reason that has nothing to do with banners.** Three `addsThenBoss`
// overlaps are under the bound and would have been charged had entry 15 applied to that player, which
// is a narrower claim than the one this paragraph used to make and is asserted as such below.
//
// Two tests in the last suite pin real numbers without being reds against the old behaviour, and say so
// on the line: they measure the fixtures rather than the rules.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { auraWindows } from '~/lib/analysis/auras';
import { rawFixtures } from '~/lib/analysis/fixtures';
import { mergeIntervals } from '~/lib/analysis/intervals';
import type { AuraWindow } from '~/lib/analysis/auras';
import type { Interval } from '~/lib/analysis/intervals';
import { eventsOn } from '~/lib/events';
import type { Analysis, ElementalAuditResult, FightDataset, Window } from '~/lib/types';
import {
	ascendanceSync,
	ASCENDANCE_COOLDOWN_MS,
	ASCENDANCE_DURATION_MS,
	ASCENDANCE_INTO_HASTE_MS,
	OPENER_DEADLINE_MS,
	SKULL_BANNER_DURATION_MS,
	SKULL_BANNER_OVERLAP_MIN_MS,
	T16_2PC_SYNC_MIN_MS,
	type AscendanceSyncInput,
	type BannerCasterWindows,
} from '../ascendance';
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
const pulls = new Map<string, { input: AscendanceSyncInput; analysis: Analysis & ElementalAuditResult }>();

/** Every raw Elemental pull, found rather than listed. */
const FIXTURES = rawFixtures('elemental').map(({ name }) => name.replace(/\.json$/, ''));

function pull(name: string): { input: AscendanceSyncInput; analysis: Analysis & ElementalAuditResult } {
	const cached = pulls.get(name);
	if (cached !== undefined) return cached;
	const built = buildPull(name);
	pulls.set(name, built);
	return built;
}

/**
 * The uncached body. **Memoised through `pull` above, and the cache is not tidiness:** several suites
 * here call `pull(name)` many times over and `addsThenBoss.json` is 4.4 MB, so a sweep of the committed
 * set re-parsed it dozens of times. `bands.test.ts` hit the same wall and got faster for fixing it.
 * Nothing in this file mutates an analysis or an input, so one instance per pull is safe.
 */
function buildPull(name: string): { input: AscendanceSyncInput; analysis: Analysis & ElementalAuditResult } {
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

/**
 * Skull Banner as the wiring hunk would hand it over — **off the audit's own published lanes**, which
 * is the argument the hunk passes and not a second walk of the stream.
 *
 * Deliberately *not* folded into `pull()` above. `pull()` is the input `index.ts` builds today, and
 * today it passes no banner windows at all; the suites above pin that unwired state, which is the only
 * proof this deliverable can offer that rules 3 and 4 degrade to silence rather than to a grade. When
 * the hunk lands, this function's body is what moves into `index.ts` and `pull()` gains the field.
 *
 * `drawn` **and** `hidden`, because `raidSourceLanes` caps the drawn rows at `RAID_SOURCE_LANES` (6):
 * reading only the drawn half would silently lose a seventh warrior's banners, and a grading input has
 * no business inheriting a chart's row budget.
 */
function banners(analysis: Analysis & ElementalAuditResult): BannerCasterWindows[] {
	return [...(analysis.timeline?.lanes ?? []), ...(analysis.timeline?.hiddenLanes ?? [])]
		.filter((l) => l.key === 'skull-banner')
		.map((l) => ({ source: l.source?.id ?? -1, windows: l.windows }));
}

describe('the committed anonymous pulls', () => {
	it('reads three different members of the haste group without naming one', () => {
		expect(pull('phased').input.hasteWindows).toEqual([{ start: 1777, end: 41_785, id: 32_182, variant: 'Heroism' }]);
		expect(pull('unbroken').input.hasteWindows).toEqual([{ start: 785, end: 40_790, id: 2825, variant: 'Bloodlust' }]);
		expect(pull('cleave').input.hasteWindows).toEqual([{ start: 941, end: 40_947, id: 80_353, variant: 'Time Warp' }]);
		// The fourth, and the one the anchor search declines: same walk, same shape, a start seven minutes
		// in. Three distinct members across four pulls — the group claim is about the walk, not the count.
		expect(pull('addsThenBoss').input.hasteWindows).toEqual([
			{ start: 438_207, end: 478_216, id: 32_182, variant: 'Heroism' },
		]);
		// And every committed pull comes back with exactly one window, so none of the four is silent for
		// want of a reading.
		for (const name of FIXTURES) expect(pull(name).input.hasteWindows.length, name).toBe(1);
	});

	/**
	 * *** The haste cooldown that is in the log and is still not the pull's. ***
	 *
	 * `ascendanceSync` looks for `hasteWindows.find((w) => w.start <= ASCENDANCE_INTO_HASTE_MS)`, so
	 * `addsThenBoss`' Heroism at 438 207 ms is not the anchor and its opener has no `delayMs` and no
	 * `syncStartMs` to report. Every synthetic case for that branch in this file moves or deletes events;
	 * this is what a captured log does, and it is the difference between "the guard works" and "the guard
	 * fires".
	 *
	 * **A measurement of the fixtures rather than a red against the old behaviour**, labelled on the line
	 * the way the two tests at the foot of this file are: the anchor search predates the fourth fixture.
	 */
	it('declines a haste cooldown that opened seven minutes into the pull', () => {
		const { input } = pull('addsThenBoss');
		expect(input.hasteWindows[0]!.start).toBeGreaterThan(ASCENDANCE_INTO_HASTE_MS);
		const opener = ascendanceSync(input).presses[0];
		expect([opener?.delayMs, opener?.syncStartMs]).toEqual([null, null]);
		// And the three pulls whose cooldown *is* the pull's, for contrast — the anchor is found on all
		// three and the delta is reported.
		for (const name of ['phased', 'unbroken', 'cleave'] as const) {
			expect(pull(name).input.hasteWindows[0]!.start).toBeLessThanOrEqual(ASCENDANCE_INTO_HASTE_MS);
			expect(ascendanceSync(pull(name).input).presses[0]?.delayMs, name).not.toBeNull();
		}
	});

	/**
	 * *** This test used to be called "finds the two-piece in evidence on all three" and swept the literal
	 * `['phased', 'unbroken', 'cleave']`. The fourth committed pull has no two-piece at all. ***
	 *
	 * `addsThenBoss`' shaman writes 144999 **zero** times, so its `t16-2pc-debuff` lane is empty, is
	 * filtered off the timeline, and `t16TwoPieceWindows` is the honest `null` — the reading `index.ts`
	 * makes for "this player does not have the set". That is a different thing from the dead 144998 id
	 * reading zero, and the pair is what separates them: 144998 is empty on a pull that *does* own the set,
	 * 144999 is empty on a pull that does not. `sharedFixtures.test.ts`' equipped-iff-fired grid is the
	 * instrument that settles which.
	 *
	 * So the sweep is the fixture directory and the classification is asserted as two named groups, which
	 * is what makes a fifth fixture pick a side rather than land in neither.
	 */
	it('finds the two-piece on exactly the pulls whose shaman owns it, through the id the game logs', () => {
		const owned: string[] = [];
		const absent: string[] = [];
		for (const name of FIXTURES) (pull(name).input.t16TwoPieceWindows === null ? absent : owned).push(name);
		expect([owned, absent]).toEqual([['cleave', 'phased', 'unbroken'], ['addsThenBoss']]);

		// 144999 and not 144998. If the audit's `t16-2pc-proc` lane were the one carrying this, all four
		// would come back `null` — it is filtered out of every one of them for being empty.
		for (const name of FIXTURES) {
			const { analysis, input } = pull(name);
			expect(
				analysis.timeline?.lanes?.some((l) => l.key === 't16-2pc-proc'),
				name,
			).toBe(false);
			if (absent.includes(name)) continue;
			expect(input.t16TwoPieceWindows, name).not.toBeNull();
			expect(input.t16TwoPieceWindows?.length ?? 0, name).toBeGreaterThan(4);
		}
	});

	/**
	 * **Deliberately three, and the reason is on the line:** the pulls whose opener is *graded* at all.
	 * `addsThenBoss` opens at 17 101 ms with its contact clock starting at 7 004, so its opener is exempt
	 * before either half of the grade is asked — asserted in `exempts the opener of a pull that had nothing
	 * to hit inside it` below, which is the other side of this partition. Sweeping the fourth pull in here
	 * would assert a `good` and a delta on the one opener that has neither.
	 */
	it('grades every graded opener good, none of them pre-pull', () => {
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
				// Every one of the three has more than fifteen seconds of pull after its opener, so no
				// part of the window was lost and rule 2 has nothing to measure.
				wastedMs: null,
				// `pull()` builds the input the audit passes **today**, and it passes no banner windows —
				// so all three of rules 3 and 4's fields are null and neither rule speaks. The unwired
				// state, pinned deliberately: an optional input nothing supplies must come back "cannot
				// say", never "good" or "bad", and these three openers are graded on rule 1 and entry 14
				// alone. The `Skull Banner` suite below hands the same three pulls the argument.
				bannerOverlapMs: null,
				secondBannerOverlapMs: null,
				secondBannerSynced: null,
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
				// 62.1s and 79.0s of pull left, so the fifteen seconds fitted and rule 2 is silent on
				// both. The fault here is the sync's, exactly as before the rule existed.
				wastedMs: null,
				// Unwired, as above — and worth having on the press rules 3 and 4 could both reach, because
				// the `Skull Banner` suite below shows both of them *pass* on this press once the argument
				// arrives. The fault stays entry 15's either way; nothing here is graded by a rule that
				// was never asked.
				bannerOverlapMs: null,
				secondBannerOverlapMs: null,
				secondBannerSynced: null,
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
		// And rule 2 does not take it either, which is the addition. The press wastes 14 286 ms of its
		// own window — the number is reported, not charged — because the press before it was the opener
		// at 3 676 ms, which put a three-minute button back at 183 676 and left no earlier press to make.
		expect(input.ascendanceCasts[1]! - input.ascendanceCasts[0]! - ASCENDANCE_COOLDOWN_MS).toBe(58);
		expect(ascendanceSync(input).presses[1]).toEqual({
			t: 183_734,
			rule: 't16-2pc',
			grade: 'none',
			reason: 'pull-ends-too-soon',
			delayMs: null,
			dischargeRemainingMs: null,
			syncStartMs: null,
			limitMs: 10_000,
			wastedMs: ASCENDANCE_DURATION_MS - 714,
			bannerOverlapMs: null,
			secondBannerOverlapMs: null,
			secondBannerSynced: null,
		});
	});

	it('rolls the pull up to its worst gradeable press', () => {
		// `unbroken` is a good opener plus one exempt press, so the pull is good; two others carry a
		// real fault and are bad. An exemption must not drag a pull down and must not lift one up.
		//
		// **These are the graded figures the two new rules were measured against, and none of them
		// moved.** Rule 1 grades every *graded* opener good; rule 2 fires on no committed press. The
		// fourth pull's opener is not inside the pull-anchored bound at all and is exempt instead — the
		// old wording here claimed it was, which was true of three fixtures rather than of the set. The one press either rule could have reached is
		// `unbroken`'s second, and the availability guard leaves it exempt — so the pull stays `good`
		// rather than becoming `bad`, which is the whole difference between the rule and a bare
		// `fightEnd - 15s` comparison.
		expect(ascendanceSync(pull('unbroken').input).grade).toBe('good');
		expect(ascendanceSync(pull('phased').input).grade).toBe('bad');
		expect(ascendanceSync(pull('cleave').input).grade).toBe('bad');
		// And the fourth, which is the case the reduce's `'none'` seed was written for and had never been
		// reached by a committed pull: every press exempt, so the pull has not failed to take a chance it
		// never had. A pull-level `none` on real data.
		expect(ascendanceSync(pull('addsThenBoss').input).grade).toBe('none');
	});

	/**
	 * *** The opener exemption, on a captured log rather than a built one. ***
	 *
	 * This file's synthetic suite has a case called *"says nothing when there was nothing reachable inside
	 * the graded window"* — a pull that opened on an intermission — and it was the only cover the
	 * `'nothing-to-hit'` refusal had on the opener arm. `addsThenBoss` is that pull for real: it presses
	 * Ascendance at 17 101 ms, which rule 1 would fault outright, and its contact clock does not open until
	 * 7 004 ms. There is no haste anchor to widen the deadline, so the deadline is `OPENER_DEADLINE_MS`
	 * itself and 7 004 is past it — nothing was reachable inside the stretch being judged, and the press is
	 * exempt rather than bad.
	 *
	 * **This is the claim the old header got wrong.** It said "not one of the three exercises a refusal on
	 * its opener" and "every opener is inside the pull-anchored bound (5 006, 3 676, 3 487 ms)". Both were
	 * true of three fixtures and false of the committed set.
	 *
	 * **A measurement of the fixtures rather than a red against the old behaviour** — the exemption and its
	 * ordering predate this pull. What is new is the log that reaches it.
	 */
	it('exempts the opener of a pull that had nothing to hit inside it', () => {
		const { input } = pull('addsThenBoss');
		expect(input.ascendanceCasts[0]).toBe(17_101);
		// Past both bounds, so rule 1 would fault it if it were reached.
		expect(input.ascendanceCasts[0]! > OPENER_DEADLINE_MS).toBe(true);
		// And the reason it is not reached: first contact after the deadline, with no haste anchor to push
		// the deadline out — the cooldown this pull brought opens at 438 207.
		expect(input.contact[0]![0]).toBe(7004);
		expect(input.contact[0]![0]! > OPENER_DEADLINE_MS).toBe(true);
		const opener = ascendanceSync(input).presses[0];
		expect([opener?.rule, opener?.grade, opener?.reason]).toEqual(['bloodlust', 'none', 'nothing-to-hit']);
	});

	/**
	 * *** And the two-piece arm's refusal, on the same log: `'no-two-piece-evidence'` on three real
	 * presses. ***
	 *
	 * The other refusal this file could only build. `addsThenBoss`' shaman has no T16 two-piece, so entry
	 * 15 does not apply to him at all — and rule 2 has nothing to charge either, because all three of those
	 * windows fit inside a 560 261 ms pull. So the three later presses are exempt and not faulted, which is
	 * exactly the ordering `ascendanceSync` documents: rule 2 is asked first and independently of the set,
	 * and stands down before the set is consulted.
	 *
	 * **A measurement of the fixtures rather than a red** — the arm's order predates this pull.
	 */
	it('exempts three later presses on the pull whose shaman has no two-piece', () => {
		const { input } = pull('addsThenBoss');
		expect(input.t16TwoPieceWindows).toBeNull();
		const { presses } = ascendanceSync(input);
		expect(presses.map((p) => [p.t, p.rule, p.grade, p.reason])).toEqual([
			[17_101, 'bloodlust', 'none', 'nothing-to-hit'],
			[173_985, 't16-2pc', 'none', 'no-two-piece-evidence'],
			[395_244, 't16-2pc', 'none', 'no-two-piece-evidence'],
			[539_625, 't16-2pc', 'none', 'no-two-piece-evidence'],
		]);
		// Rule 2 is silent because nothing was wasted, not because the set was missing: every window fits.
		expect(presses.map((p) => p.wastedMs)).toEqual([null, null, null, null]);
	});

	/**
	 * *** The logs do not agree with `ASCENDANCE_COOLDOWN_MS`, and this is the measurement that says so.
	 * ***
	 *
	 * `addsThenBoss` presses 114049 four times and two consecutive gaps are **shorter than the three
	 * minutes the module asserts** — 156 884 ms and 144 381 ms. The constant is quoted from the simulator
	 * (`sim/shaman/ascendance.go:112`) and it has two readers here: the `first-press-past-one-cooldown`
	 * guard, which this pull does not reach, and rule 2's availability guard, which computes
	 * `readyAtMs = 395 244 + 180 000 = 575 244` for the last press while the log proves the button was back
	 * by 539 625.
	 *
	 * **No grade moves today** — the last press wastes nothing, so rule 2 never consults the guard — which
	 * is why this is a pinned fact rather than a change to `ascendanceSync`. It is pinned because the next
	 * reader of that guard needs to find the measurement rather than the assumption; fixing the guard means
	 * reading the previous press's own recovery out of the log, and that wants its own red.
	 *
	 * **A measurement of the fixtures rather than a red against the old behaviour.**
	 */
	it('records the two committed press gaps that are shorter than the stated cooldown', () => {
		const casts = pull('addsThenBoss').input.ascendanceCasts;
		expect(casts).toEqual([17_101, 173_985, 395_244, 539_625]);
		const gaps = casts.slice(1).map((t, i) => t - casts[i]!);
		expect(gaps).toEqual([156_884, 221_259, 144_381]);
		expect(gaps.filter((g) => g < ASCENDANCE_COOLDOWN_MS)).toEqual([156_884, 144_381]);
		// The guard's own arithmetic on the last press, against what the log shows.
		const readyAtMs = casts[2]! + ASCENDANCE_COOLDOWN_MS;
		expect(readyAtMs).toBe(575_244);
		expect(casts[3]!).toBeLessThan(readyAtMs);
		// And the other three pulls, where the two readings agree: one gap each, both over the cooldown.
		for (const name of ['phased', 'unbroken', 'cleave'] as const) {
			const own = pull(name).input.ascendanceCasts;
			expect(own[1]! - own[0]!, name).toBeGreaterThanOrEqual(ASCENDANCE_COOLDOWN_MS);
		}
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
		// `unbroken` is a good opener plus one press exempted 714ms from the kill; two others carry a
		// real unsynced second press. Section 53's three known values, asserted at the level that was
		// missing rather than by recomputing them — plus the fourth pull's, which §53 never saw.
		expect(pull('unbroken').analysis.ascendance.grade).toBe('good');
		expect(pull('phased').analysis.ascendance.grade).toBe('bad');
		expect(pull('cleave').analysis.ascendance.grade).toBe('bad');
		// `addsThenBoss`: every press exempt, so the pull is `none` — published as well as computed, which
		// is the whole point of this suite. A wiring that dropped the input would also produce `none` here,
		// which is why the presses and reasons are pinned separately above rather than only the letter.
		expect(pull('addsThenBoss').analysis.ascendance.grade).toBe('none');
		expect(pull('addsThenBoss').analysis.ascendance.presses.map((pr) => pr.sync.reason)).toEqual([
			'nothing-to-hit',
			'no-two-piece-evidence',
			'no-two-piece-evidence',
			'no-two-piece-evidence',
		]);
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
				wastedMs: null,
				// **The wiring this assertion used to record the absence of.** `unbroken` carries two Skull
				// Banners covering 2 884–23 372 ms, which is the whole of this opener's fifteen seconds, and
				// `index.ts` now passes them — so rule 3 reads the 15 000 it always should have. The null it
				// published before was the module being silent about an input it never received; this is the
				// same rule with the input in hand, and the opener grades `good` either way.
				bannerOverlapMs: 15_000,
				// Still null, and not for want of wiring: rule 4 reads each caster's *own* second banner, and
				// `unbroken`'s two warriors pressed once each. It is also press 0, which the rule never asks.
				secondBannerOverlapMs: null,
				secondBannerSynced: null,
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
				wastedMs: 14_286,
				// Zero, and it is a real reading rather than a silence: this press is 714 ms from the kill, so
				// its fifteen seconds are almost entirely past the end and no banner can be inside them. Rule
				// 2's availability guard has already exempted the press, which is why a zero here faults
				// nothing — the case rule 3's own guard exists for, arriving from the other direction.
				bannerOverlapMs: 0,
				// `unbroken` is the pull where no warrior pressed twice, so rule 4 has nothing to compare
				// even on the press it asks about.
				secondBannerOverlapMs: null,
				secondBannerSynced: null,
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
		// Not one committed pull has Ascendance up at the pull, so the published flag is `false` on all
		// **four** — and it is published anyway, because it is the difference between a press that was not
		// made and a press the log cannot see. The audit's reading is the *guarded* one (a press at or
		// before the recovered expiry vouches for the window), so it can only be narrower than this
		// walk; on all four both come out false and the two are pinned against each other. The list was
		// `['phased', 'unbroken', 'cleave']`; it is the fixture directory now, because "not one committed
		// pull" is the claim and a literal cannot make it.
		for (const name of FIXTURES) {
			const { analysis, input } = pull(name);
			expect(analysis.ascendance.atPull).toBe(false);
			expect(input.ascendanceAtPull).toBe(false);
		}
	});
});

// ------------------------------------------------------------------ synthetic

const lust = (start: number, end: number): AuraWindow => ({ start, end, id: 2825, variant: 'Bloodlust' });
const win = (start: number, end: number): Window => ({ start, end });

/** A clean pull: lust on the pull, contact from the first global, Ascendance not up beforehand. */
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
		// A press before the pull's own first global is trivially the opener; a press a full global late
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

	/**
	 * Both sides of entry 14's bound are now read on a cooldown that opened **on the pull**, and they have
	 * to be.
	 *
	 * They used to sit on `lust(1000, 41_000)`, which put the press at 6 000 and 6 001 ms — inside this
	 * bound and outside the opener, so rule 1 faults both and the pair stopped separating anything. On a
	 * lust at zero the two bounds nest, 5 000 inside 5 250, and this is the only band in which entry 14
	 * bites alone.
	 *
	 * **That band is narrow, and deliberately not widened.** Entry 14 can only be the binding constraint
	 * when the haste cooldown opened within `OPENER_GRACE_MS` of the pull; three of the four committed pulls
	 * open theirs at 1 777, 785 and 941 ms, so on those three rule 1 is the tighter of the two and `delayMs`
	 * is reported rather than decisive. The fourth, `addsThenBoss`, opens its cooldown at 438 207 ms — the
	 * anchor search declines it, so entry 14 has nothing to bind with and rule 1 is the only half left.
	 * Keeping both is what plan §39 argued and what publishes the delay at all — see
	 * `ASCENDANCE_INTO_HASTE_MS`.
	 */
	it('passes a press exactly on the bound', () => {
		const v = first({ hasteWindows: [lust(0, 40_000)], ascendanceCasts: [ASCENDANCE_INTO_HASTE_MS] });
		expect([v.grade, v.delayMs]).toEqual(['good', 5000]);
	});

	it('faults a press one millisecond past it', () => {
		const v = first({ hasteWindows: [lust(0, 40_000)], ascendanceCasts: [ASCENDANCE_INTO_HASTE_MS + 1] });
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
	it('grades the opener on a pull that brought no haste cooldown at all', () => {
		// Which also covers the cooldown cast *before* the pull: the Bloodlust aura declares no duration,
		// so `auraWindows` cannot recover a pre-pull window for it and the walk comes back empty.
		//
		// This used to be `none` / `'no-cooldown-on-pull'`, and rule 1 is why it is not: opening with
		// Ascendance needs no raid cooldown, so a missing one is a missing *measurement* — null `delayMs`
		// and null `syncStartMs` — and the press is graded on the opener alone.
		const v = first({ hasteWindows: [] });
		expect([v.rule, v.grade, v.reason, v.delayMs, v.syncStartMs]).toEqual(['bloodlust', 'good', null, null, null]);
	});

	it('grades the opener when the haste cooldown went out long after it', () => {
		// A Bloodlust at 90s is a different tactical situation and is still not read as the pull's — the
		// anchor search is unchanged. What changed is that its absence no longer buys the press silence.
		const v = first({ hasteWindows: [lust(90_000, 130_000)] });
		expect([v.grade, v.delayMs, v.syncStartMs]).toEqual(['good', null, null]);
	});

	it('says nothing when Ascendance was already running at the pull', () => {
		// Pressed before the pull: the button is down for three minutes and the press this rule judges is
		// not in the stream. Faulting the first *visible* press here is the exact shape of bug the audit
		// has shipped four times.
		const v = first({ ascendanceAtPull: true, ascendanceCasts: [30_000] });
		expect([v.grade, v.reason]).toEqual(['none', 'ascendance-up-at-the-pull']);
	});

	it('says nothing when the first visible press is past one full cooldown', () => {
		// At 180.001s the press could be a recharge whose first charge was spent before the pull and left
		// no trace — more than fifteen seconds before the pull, so not even `ascendanceAtPull` catches it.
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
		// The boundary of the exemption, pinned from the other side. The lust opens at 1 000 and the haste
		// bound runs to 6 000, which is later than the opener deadline, so 6 000 is the deadline here.
		const v = first({ contact: [[6000, 300_000]], ascendanceCasts: [3000] });
		expect([v.grade, v.reason]).toEqual(['good', null]);
	});

	it('falls back to the opener deadline when there is no haste bound to stretch it', () => {
		// The same exemption on a pull that brought no cooldown: with nothing to measure into, the stretch
		// being judged is the opener itself, and the deadline is its own bound rather than zero.
		expect(first({ hasteWindows: [], contact: [[OPENER_DEADLINE_MS, 300_000]] }).grade).toBe('good');
		const late = first({ hasteWindows: [], contact: [[OPENER_DEADLINE_MS + 1, 300_000]] });
		expect([late.grade, late.reason]).toEqual(['none', 'nothing-to-hit']);
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

	it('grades a press with the whole window ahead of it', () => {
		// 215 000 − 200 000 is Ascendance's own fifteen seconds, so nothing is lost to the kill and the
		// sync is the only question left. This used to read `durationMs: 210_000` and the sync's ten
		// seconds; rule 2 is the wider bound, so the pull has to be five seconds longer for the press to
		// reach the sync arm at all.
		const v = second({ durationMs: 215_000 });
		expect([v.grade, v.reason, v.dischargeRemainingMs, v.wastedMs]).toEqual(['good', null, 12_000, null]);
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
		// The opener rule's own measurement is never consulted for a press it does not govern, and the
		// opener itself is now graded by rule 1 rather than silenced by the missing cooldown.
		const v = at({
			hasteWindows: [],
			ascendanceCasts: [2000, 200_000],
			t16TwoPieceWindows: [win(195_000, 212_000)],
		});
		expect(v.presses.map((p) => [p.rule, p.grade, p.reason, p.delayMs])).toEqual([
			['bloodlust', 'good', null, null],
			['t16-2pc', 'good', null, null],
		]);
	});

	it('names the rule by position alone, for every press in a three-press pull', () => {
		const v = at({ ascendanceCasts: [2000, 190_000, 290_000], t16TwoPieceWindows: [] });
		expect(v.presses.map((p) => p.rule)).toEqual(['bloodlust', 't16-2pc', 't16-2pc']);
	});
});

/**
 * Rule 1 — Ascendance is *always* used in the opener (plan §80, rule 1).
 *
 * The absolute half of the opener press's grade, and the half that needs no haste cooldown. Every case
 * here is synthetic because no committed pull is *faulted* by it — but the reason is not the one this
 * docblock used to give. It said "all three open at 5 006, 3 676 and 3 487 ms"; the fourth committed
 * pull opens at **17 101 ms**, which rule 1 would fault, and is exempted by `'nothing-to-hit'` before the
 * grade is reached. So the rule's fault side is still synthetic and the *premise* has changed: three of
 * four openers are inside the bound, and the fourth is outside it and unjudged. See `exempts the opener of
 * a pull that had nothing to hit inside it`.
 *
 * The boundary is the one §52 settled and `isOpener` applies, pinned against that predicate below
 * rather than restated as a number this suite believes on its own.
 */
describe('rule 1: the opener press is not optional', () => {
	it('uses the pull-anchored bound §52 settled, and is pinned to `isOpener` itself', () => {
		// The tightest statement of "these are one boundary": the constant is the *largest* `t` for which
		// `index.ts`' own predicate holds. A change to either side fails here rather than quietly leaving
		// two opener bounds in one spec.
		expect([isOpener(OPENER_DEADLINE_MS), isOpener(OPENER_DEADLINE_MS + 1)]).toEqual([true, false]);
		expect(OPENER_DEADLINE_MS).toBe(5250);
	});

	it('needs the 250ms grace to leave `phased` alone', () => {
		// The press the grace was written for is the press this rule grades. Anchored on the fixture's own
		// opener rather than on the literal: 5 006 is past `ASCENDANCE_INTO_HASTE_MS` and inside the
		// pull-anchored bound, so rule 1 on the raw 5 000 would fault a clean opener on a committed pull.
		const t = pull('phased').input.ascendanceCasts[0];
		expect(t).toBe(5006);
		expect([t! > ASCENDANCE_INTO_HASTE_MS, isOpener(t!)]).toEqual([true, true]);
	});

	it('faults a first press past the opener on a pull that brought no haste cooldown', () => {
		// Was `none` / `'no-cooldown-on-pull'`: an opener 30 seconds in went ungraded because the raid
		// happened not to lust. Nothing about pressing Ascendance in the opener needs a raid cooldown.
		const v = first({ hasteWindows: [], ascendanceCasts: [30_000] });
		expect([v.rule, v.grade, v.reason, v.delayMs, v.syncStartMs]).toEqual(['bloodlust', 'bad', null, null, null]);
	});

	it('faults an opener that a late haste cooldown used to excuse', () => {
		const v = first({ hasteWindows: [lust(90_000, 130_000)], ascendanceCasts: [30_000] });
		expect([v.grade, v.reason]).toEqual(['bad', null]);
	});

	it('faults a press inside the haste bound but outside the opener', () => {
		// The case that makes rule 1 a *new condition* rather than a restatement of the old one. The lust
		// opens at 4 000 and the press is 4 000 ms into it — good under entry 14, which is why `delayMs`
		// is asserted — but 8 000 ms into the pull, which no opener bound admits.
		const v = first({ hasteWindows: [lust(4000, 44_000)], ascendanceCasts: [8000] });
		expect([v.grade, v.delayMs, v.limitMs]).toEqual(['bad', 4000, ASCENDANCE_INTO_HASTE_MS]);
	});

	it('still applies the haste bound to a press well inside the opener', () => {
		// The mirror, so the grade is an `and` rather than a replacement: a press 5 100 ms into a lust that
		// went out on the pull is inside the opener and past entry 14's bound, and is faulted for that.
		const v = first({ hasteWindows: [lust(0, 40_000)], ascendanceCasts: [5100] });
		expect([v.grade, v.delayMs]).toEqual(['bad', 5100]);
	});

	it('reports both sides of the opener bound, against `phased`s own haste window', () => {
		// Both presses are comfortably inside entry 14's bound from a cooldown that opened at 1 777 — the
		// deltas are 3 473 and 3 474 — so only rule 1 can separate them, and it does, on its own edge.
		const window = [lust(1777, 41_785)];
		expect(first({ hasteWindows: window, ascendanceCasts: [OPENER_DEADLINE_MS] }).grade).toBe('good');
		expect(first({ hasteWindows: window, ascendanceCasts: [OPENER_DEADLINE_MS + 1] }).grade).toBe('bad');
	});

	it('faults a pull that never pressed it at all', () => {
		// The plainest way to fail "always used in the opener", and the one grade no press carries: the
		// verdict has an empty `presses` and the fault lands on the pull.
		const v = at({ ascendanceCasts: [] });
		expect([v.presses, v.grade]).toEqual([[], 'bad']);
	});

	it('says nothing about a pull that never pressed it and could not have', () => {
		// The same three guards a press gets, on the pull-level arm. Ascendance up at the pull means the
		// opener press is off-stream; a pull with nothing reachable inside the opener had nothing to spend
		// it on; and a pull that ended inside the opener never finished one.
		expect(at({ ascendanceCasts: [], ascendanceAtPull: true }).grade).toBe('none');
		expect(at({ ascendanceCasts: [], contact: [[20_000, 300_000]] }).grade).toBe('none');
		expect(at({ ascendanceCasts: [], contact: [] }).grade).toBe('none');
		expect(at({ ascendanceCasts: [], durationMs: OPENER_DEADLINE_MS }).grade).toBe('none');
		expect(at({ ascendanceCasts: [], durationMs: OPENER_DEADLINE_MS + 1 }).grade).toBe('bad');
	});
});

/**
 * Rule 2 — Ascendance must never lose uptime to the end of the fight (plan §80, rule 2).
 *
 * The boundary is Ascendance's own duration, `sim/shaman/ascendance.go:61`'s `Duration: time.Second *
 * 15`, and not the sync's ten seconds. Every fault here is synthetic: the only committed press whose
 * window runs past a kill is `unbroken`'s second, and the availability guard excuses it, which the real-
 * pull suite above pins. Still the only one after the fourth fixture — `addsThenBoss` presses at
 * 539 625 ms of a 560 261 ms pull, so even its latest press has its whole fifteen seconds, and all four of
 * its `wastedMs` are null.
 *
 * **The availability guard's arithmetic is not safe on that pull, though, and the guard is why.** It adds
 * `ASCENDANCE_COOLDOWN_MS` to the previous press, and two of `addsThenBoss`' three press gaps are shorter
 * than that — see `records the two committed press gaps that are shorter than the stated cooldown`. No
 * verdict turns on it today because `wastedMs` is null throughout.
 */
describe('rule 2: a later press must not spend the window past the kill', () => {
	/** A pull with an opener and one later press at 200s, the two-piece in evidence around it. */
	const later = (over: Partial<AscendanceSyncInput> = {}) =>
		at({ ascendanceCasts: [2000, 200_000], t16TwoPieceWindows: [win(195_000, 212_000)], ...over });

	const second = (over: Partial<AscendanceSyncInput> = {}) => {
		const press = later(over).presses[1];
		if (press === undefined) throw new Error('expected a second press');
		return press;
	};

	it('is the buff duration the sim declares, and it is wider than the sync', () => {
		expect(ASCENDANCE_DURATION_MS).toBe(15_000);
		expect(ASCENDANCE_DURATION_MS).toBeGreaterThan(T16_2PC_SYNC_MIN_MS);
	});

	it('faults a press that let the window run past the kill, and says how much it lost', () => {
		// 5 001 ms of the fifteen thrown away, with the button back at 182 000 and the last press that
		// would have fitted at 194 999. Was `none` / `'pull-ends-too-soon'`, exempted for a sync it could
		// not reach — which said nothing about the window it wasted.
		const v = second({ durationMs: 209_999 });
		expect([v.grade, v.reason, v.wastedMs]).toEqual(['bad', null, 5001]);
	});

	it('reports both sides of the boundary, one millisecond apart', () => {
		expect([second({ durationMs: 215_000 }).grade, second({ durationMs: 214_999 }).grade]).toEqual(['good', 'bad']);
		expect(second({ durationMs: 214_999 }).wastedMs).toBe(1);
	});

	it('turns on whether the button could have come back in time', () => {
		// The guard, on the same press twice — 190 000 ms into a 195 000 ms pull, wasting 10 000 ms either
		// way — with the *previous* press one millisecond apart. At 0 the button is back at 180 000, which
		// is the last press that would have fitted, so the delay was the player's; at 1 it is back at
		// 180 001 and no press at this index could have fitted, so the sync exempts it instead. This is
		// `unbroken`'s shape, at the boundary rather than 3 976 ms clear of it.
		const window = { durationMs: 195_000, t16TwoPieceWindows: [win(150_000, 194_000)] };
		const ready = at({ ...window, ascendanceCasts: [0, 190_000] }).presses[1];
		const notReady = at({ ...window, ascendanceCasts: [1, 190_000] }).presses[1];
		expect([ready?.grade, ready?.wastedMs]).toEqual(['bad', 10_000]);
		expect([notReady?.grade, notReady?.reason, notReady?.wastedMs]).toEqual(['none', 'pull-ends-too-soon', 10_000]);
	});

	it('faults a late press with no two-piece in evidence at all', () => {
		// Rule 2 is absolute and owes nothing to the player's gear, so it is asked before entry 15's own
		// preconditions. Was `none` / `'no-two-piece-evidence'`: a press five seconds from the kill went
		// ungraded because the log showed no set.
		const v = at({ ascendanceCasts: [2000, 290_000], t16TwoPieceWindows: null }).presses[1];
		expect([v?.rule, v?.grade, v?.reason, v?.wastedMs]).toEqual(['t16-2pc', 'bad', null, 5000]);
	});

	it('does not fault a press that bought nothing anyway', () => {
		// Out of contact at the press: the honest answer is still silence, and rule 2 must not overtake it
		// — an earlier press would have had nothing in front of it either.
		const v = at({
			ascendanceCasts: [2000, 290_000],
			t16TwoPieceWindows: [win(280_000, 295_000)],
			contact: [[900, 150_000]],
		}).presses[1];
		expect([v?.grade, v?.reason, v?.wastedMs]).toEqual(['none', 'nothing-to-hit', 5000]);
	});

	it('never faults the opener for a window the kill cut short', () => {
		// Precedence, where the two absolutes would otherwise contradict each other: on an eight-second
		// pull the opener loses nine seconds of its window and entry 14 asked for the press anyway. The
		// waste is reported and the press is good — rule 2 governs only the presses the player chose the
		// moment of.
		const v = at({ ascendanceCasts: [2000], durationMs: 8000, contact: [[900, 8000]] }).presses[0];
		expect([v?.rule, v?.grade, v?.reason, v?.wastedMs]).toEqual(['bloodlust', 'good', null, 9000]);
	});
});

/**
 * Rules 3 and 4 — Skull Banner (plan §80, rules 3 and 4).
 *
 * The user's two sentences, and they are **not** phrased alike:
 *
 *   > Ascandence should have at least 90% overlap with Skull Banner (Skull banner is 10s, Asc 15s 90%
 *   > in this case would be based on the SB 10s)
 *
 *   > 2nd Ascandence should ideally be synced with 2nd Skull Banners
 *
 * "should have at least" against "should ideally be", so rule 3 is graded and rule 4 is shown. Both
 * halves of that are asserted: rule 3 turns presses bad below, and a press whose `secondBannerSynced`
 * is `false` is asserted `good`.
 *
 * **Skull Banner's duration and id are confirmed from the simulator, not from the request.**
 * `sim/core/buffs.go:1121` is `SkullBannerDuration = time.Second * 10` and `:1118` is `SkullBannerActionID
 * = ActionID{SpellID: 114206}` — the user's "10s" is right and 114207 (the buff picker's icon) is not the
 * logged id. The declaration in `game/shared.ts` already says both, so this module names neither number
 * and the constants below only restate the duration the arithmetic runs on.
 *
 * Every fault here is synthetic, and this time that is a measurement rather than a convention: on the
 * union reading these rules use, **no committed press fails rule 3**. The **ten** real overlaps are
 * 15 000 and 10 149 (`phased`), 15 000 and 0 (`unbroken`, the zero on a press already exempt), 13 944 and
 * 10 273 (`cleave`), and 11 373, 0, 1 499 and 0 (`addsThenBoss`).
 *
 * *** That sentence used to say "the six real overlaps" and to mean something stronger than it now can.
 * *** Three of `addsThenBoss`' four overlaps are **under** the 9 000 bound, and rule 3 does not charge
 * them only because those three presses are already exempt for a reason that has nothing to do with
 * banners — its shaman has no two-piece. So "no committed press fails rule 3" is true of the grade and no
 * longer true of the measurement, and the two are asserted separately in `measures rule 3 on all ten
 * presses` below. The real pulls are still pinned as the unchanged side, and both faults are built.
 */
describe('Skull Banner: rule 3 is graded and rule 4 is shown', () => {
	/** One warrior's banners, as `raidSourceLanes` buckets them — resolved caster, windows in press order. */
	const from = (source: number, ...windows: ReadonlyArray<readonly [number, number]>): BannerCasterWindows => ({
		source,
		windows: windows.map(([start, end]) => ({ start, end })),
	});

	describe('the bound, and which of the two durations it is 90% of', () => {
		it('is 9 000ms, and emphatically not 90% of Ascendance', () => {
			// The whole content of the user's parenthesis. 13 500 is what 90% of Ascendance's own fifteen
			// seconds would be, and no single ten-second banner can put that much inside anything — so the
			// rule would have graded the raid's warrior count rather than the player's timing.
			expect(SKULL_BANNER_DURATION_MS).toBe(10_000);
			expect(SKULL_BANNER_OVERLAP_MIN_MS).toBe(9000);
			expect(SKULL_BANNER_OVERLAP_MIN_MS).toBe(0.9 * SKULL_BANNER_DURATION_MS);
			expect(SKULL_BANNER_OVERLAP_MIN_MS).not.toBe(0.9 * ASCENDANCE_DURATION_MS);
			// And the sim's own duration, so the denominator is not this file's opinion of it.
			expect(SKULL_BANNER_DURATION_MS).toBeLessThan(ASCENDANCE_DURATION_MS);
		});
	});

	describe('rule 3, on the opener arm', () => {
		it('passes a press holding exactly 9 000ms of banner', () => {
			// The press at 2 000 buys [2 000, 17 000]; a banner from 8 000 to 17 000 puts 9 000 of itself
			// inside it. Exactly the bound, from the passing side.
			const v = first({ skullBannerWindows: [from(9, [8000, 17_000])] });
			expect([v.grade, v.bannerOverlapMs]).toEqual(['good', 9000]);
		});

		it('faults a press one millisecond short of it', () => {
			// The same press against a banner one millisecond later. Rule 1 and entry 14 both pass — the
			// press is at 2 000 with lust at 1 000 — so this `bad` can only be rule 3's.
			const v = first({ skullBannerWindows: [from(9, [8001, 17_001])] });
			expect([v.grade, v.reason, v.delayMs, v.bannerOverlapMs]).toEqual(['bad', null, 1000, 8999]);
		});

		it('faults a press that found no banner at all, and calls it zero', () => {
			// Zero and not null: the pull carried a banner, so there was a window to have aimed at. The
			// distinction from `[]` below is the whole reason the input is bucketed rather than boolean.
			const v = first({ skullBannerWindows: [from(9, [100_000, 110_000])] });
			expect([v.grade, v.bannerOverlapMs]).toEqual(['bad', 0]);
		});
	});

	describe('rule 3, on the two-piece arm — one bound, both arms', () => {
		const second = (over: Partial<AscendanceSyncInput>) => {
			const press = at({
				ascendanceCasts: [2000, 200_000],
				t16TwoPieceWindows: [win(195_000, 212_000)],
				...over,
			}).presses[1];
			if (press === undefined) throw new Error('expected a second press');
			return press;
		};

		it('faults a later press with a full discharge and no banner under it', () => {
			// 12 000ms of Elemental Discharge, which entry 15 passes outright, and 4 000ms of banner. The
			// press was good before rule 3 and the only term that moved is the overlap.
			const v = second({ skullBannerWindows: [from(9, [196_000, 204_000])] });
			expect([v.grade, v.dischargeRemainingMs, v.bannerOverlapMs]).toEqual(['bad', 12_000, 4000]);
		});

		it('leaves a later press good when both its own rule and rule 3 are met', () => {
			const v = second({ skullBannerWindows: [from(9, [199_000, 209_000])] });
			expect([v.grade, v.dischargeRemainingMs, v.bannerOverlapMs]).toEqual(['good', 12_000, 9000]);
		});

		it('does not overtake an exemption the press already had', () => {
			// Rule 3 is a term in the grade, not a refusal, so it never reaches a press the arm's own guards
			// have already excused. Out of contact at the press with no banner anywhere near it: still
			// `nothing-to-hit`, and the overlap is reported beside it rather than charged.
			const v = second({ contact: [[900, 150_000]], skullBannerWindows: [from(9, [10_000, 20_000])] });
			expect([v.grade, v.reason, v.bannerOverlapMs]).toEqual(['none', 'nothing-to-hit', 0]);
		});
	});

	describe('what rule 3 refuses to grade', () => {
		it('says nothing at all when nothing passed it any banners', () => {
			// The unwired state, and the one this deliverable ships in. Null, and a null passes rule 3's
			// half of the `and` exactly as a null `delayMs` passes entry 14's — so the press keeps the
			// grade it had before the rule existed, and rule 3 has not silently approved of anything.
			const v = first({});
			expect([v.grade, v.bannerOverlapMs, v.secondBannerOverlapMs, v.secondBannerSynced]).toEqual([
				'good',
				null,
				null,
				null,
			]);
		});

		it('says nothing when the raid brought no banner that reached the player', () => {
			// `[]` is the same silence as absent, and deliberately **not** the fault `t16TwoPieceWindows`'
			// empty array is. Fulmination is the player's button; Skull Banner is a warrior's, and a log
			// cannot show a warrior's cooldown. A pull no banner reached is the raid roster, not a press.
			expect(first({ skullBannerWindows: [] }).bannerOverlapMs).toBeNull();
			// And a caster list whose windows are all empty says the same thing, so a bucket that came back
			// without windows cannot become a zero.
			expect(first({ skullBannerWindows: [from(9), from(11)] }).bannerOverlapMs).toBeNull();
			expect(first({ skullBannerWindows: [] }).grade).toBe('good');
		});

		it('does not fault a press with less pull left than the rule itself demands', () => {
			// The guard, at its own boundary, one millisecond apart. A press at 2 000 of an 11 000ms pull has
			// exactly 9 000ms of pull left, so 9 000ms of banner was reachable and the shortfall is charged;
			// at 10 999 it was not, and the overlap is reported without a fault. Same principle as rule 2's
			// availability guard — never charge for a press that could not have gone better.
			const banner = { skullBannerWindows: [from(9, [10_400, 20_400])] };
			const reachable = first({ ...banner, durationMs: 11_000 });
			const not = first({ ...banner, durationMs: 10_999 });
			expect([reachable.grade, reachable.bannerOverlapMs]).toEqual(['bad', 600]);
			expect([not.grade, not.bannerOverlapMs]).toEqual(['good', 599]);
		});
	});

	describe('the union, which is what "overlap with Skull Banner" is over', () => {
		it('counts two staggered banners as the one unbroken buff they are', () => {
			// `phased`s shape, synthetically: two warriors hand off at 10 000 and the press at 2 000 has the
			// buff for all fifteen of its seconds. The best *single* banner gives it 8 000ms and would fault
			// a player whose crit-damage buff never lapsed, for two other players' stagger.
			const v = first({ skullBannerWindows: [from(9, [0, 10_000]), from(11, [10_000, 20_000])] });
			expect([v.grade, v.bannerOverlapMs]).toEqual(['good', 15_000]);
			// The reading this replaces, stated so the choice is visible rather than implied.
			expect(Math.max(10_000 - 2000, 17_000 - 10_000)).toBeLessThan(SKULL_BANNER_OVERLAP_MIN_MS);
		});

		it('does not count two overlapping banners twice', () => {
			// Both warriors pressed on the pull, so the player had one buff and not two. Summing rather than
			// unioning would read 10 000ms here and pass a press that had 5 000.
			const v = first({
				ascendanceCasts: [5000],
				skullBannerWindows: [from(9, [0, 10_000]), from(11, [0, 10_000])],
			});
			expect([v.grade, v.bannerOverlapMs]).toEqual(['bad', 5000]);
		});

		it('clips the window to the kill rather than to a bare fifteen seconds', () => {
			// A banner running past the end of the pull cannot be spent, so the overlap stops at the kill.
			const v = first({ durationMs: 12_000, skullBannerWindows: [from(9, [2000, 12_000])] });
			expect(v.bannerOverlapMs).toBe(10_000);
		});
	});

	describe('rule 4: the second press against each caster’s second banner', () => {
		/** Two warriors who each pressed twice, and a second Ascendance on the later pair. */
		const twoWarriors = (over: Partial<AscendanceSyncInput> = {}) =>
			at({
				ascendanceCasts: [2000, 180_000],
				t16TwoPieceWindows: [win(175_000, 195_000)],
				skullBannerWindows: [from(9, [0, 10_000], [180_000, 190_000]), from(11, [12_000, 22_000], [200_000, 210_000])],
				...over,
			});

		it('reads a caster’s own second press, not the second banner in the pull', () => {
			// `cleave`s shape. Counting bars, "the 2nd Skull Banner" is the one at 12 000 and the rule reads
			// false by three minutes; counting each warrior's second press it is the one at 180 000 and the
			// two are synced exactly. Skull Banner is a three-minute button (`SkullBannerCD`) as Ascendance
			// is, so the ordinal is a press of a cooldown and not a bar on a chart.
			const v = twoWarriors().presses[1];
			expect([v?.secondBannerOverlapMs, v?.secondBannerSynced]).toEqual([10_000, true]);
		});

		it('takes the best of several second banners rather than the first', () => {
			// Reversed, so a rule that read `skullBannerWindows[0]` and stopped would come back false.
			const v = twoWarriors({
				skullBannerWindows: [from(11, [12_000, 22_000], [200_000, 210_000]), from(9, [0, 10_000], [180_000, 190_000])],
			}).presses[1];
			expect([v?.secondBannerOverlapMs, v?.secondBannerSynced]).toEqual([10_000, true]);
		});

		it('is on the second press and no other', () => {
			const v = at({
				ascendanceCasts: [2000, 180_000, 280_000],
				t16TwoPieceWindows: [],
				skullBannerWindows: [from(9, [0, 10_000], [180_000, 190_000])],
			});
			expect(v.presses.map((p) => [p.secondBannerOverlapMs, p.secondBannerSynced])).toEqual([
				[null, null],
				[10_000, true],
				[null, null],
			]);
		});

		it('says nothing when no caster pressed twice', () => {
			// `unbroken`s shape: two warriors, one banner each, so there is no second Skull Banner to be
			// synced with and the honest answer is silence rather than false.
			const v = twoWarriors({ skullBannerWindows: [from(9, [0, 10_000]), from(11, [12_000, 22_000])] }).presses[1];
			expect([v?.secondBannerOverlapMs, v?.secondBannerSynced]).toEqual([null, null]);
		});

		it('says nothing when nothing passed it any banners', () => {
			const v = twoWarriors({ skullBannerWindows: undefined }).presses[1];
			expect([v?.secondBannerOverlapMs, v?.secondBannerSynced]).toEqual([null, null]);
		});

		it('borrows rule 3’s bound, because its own sentence names no number', () => {
			// Both banners are a full ten seconds; what moves is when the warrior pressed. One second before
			// the Ascendance puts 9 000ms of it inside; one millisecond earlier than that puts 8 999.
			const exact = twoWarriors({
				skullBannerWindows: [from(9, [0, 10_000], [179_000, 189_000])],
			}).presses[1];
			const short = twoWarriors({
				skullBannerWindows: [from(9, [0, 10_000], [178_999, 188_999])],
			}).presses[1];
			expect([exact?.secondBannerOverlapMs, exact?.secondBannerSynced]).toEqual([SKULL_BANNER_OVERLAP_MIN_MS, true]);
			expect([short?.secondBannerOverlapMs, short?.secondBannerSynced]).toEqual([8999, false]);
		});

		it('is shown and never graded, which is the difference from rule 3', () => {
			// The user hedged rule 4 — "should *ideally* be synced" — and this is that hedge made
			// structural. The press has 12 000ms of discharge (entry 15: good) and 14 000ms of banner under
			// it from the union (rule 3: good), while the only *second* banner in the pull is three minutes
			// away (rule 4: false). A rule 4 that graded would make this press `bad`; it stays `good`.
			const v = at({
				ascendanceCasts: [2000, 200_000],
				t16TwoPieceWindows: [win(195_000, 212_000)],
				skullBannerWindows: [from(9, [195_000, 205_000]), from(11, [204_000, 214_000], [250_000, 260_000])],
			}).presses[1];
			expect([v?.grade, v?.bannerOverlapMs, v?.secondBannerOverlapMs, v?.secondBannerSynced]).toEqual([
				'good',
				14_000,
				0,
				false,
			]);
		});
	});
});

/**
 * Rules 3 and 4 on the committed pulls, with the argument the wiring hunk would pass.
 *
 * **The rules can be exercised on real data, and the answer is measured rather than assumed.** No
 * committed pull has the *player* as the banner's caster — every banner comes from another raider — but
 * that does not matter to either rule: both read the banner as the player **received** it, which is what
 * `raidSourceLanes` narrows the stream to. What does matter is that all four pulls carry banners on the
 * player from two warriors apiece, so rule 3 has something to measure on all **ten** presses and rule 4
 * has a second banner to find on three of the four.
 *
 * The three literal `['phased', 'unbroken', 'cleave']` grids this suite used to run on are per-pull grids
 * now, keyed by name and checked against `rawFixtures`, so a fifth pull fails by name rather than being
 * left out.
 */
describe('Skull Banner on the committed pulls', () => {
	const wired = (name: string) => {
		const { analysis, input } = pull(name);
		return { analysis, verdict: ascendanceSync({ ...input, skullBannerWindows: banners(analysis) }) };
	};

	it('finds two warriors on every pull, and the player among neither', () => {
		// **A measurement of the fixtures, not a red against the old behaviour** — it reads the lanes and
		// no verdict, so it passed before this change too. It is here because it is the fact that decides
		// whether rules 3 and 4 are exercisable at all, and the answer had to be measured rather than
		// assumed: `phased` and `cleave` carry four banners from two warriors, `unbroken` two from two, and
		// `addsThenBoss` **six from two** — three presses apiece, which is the only committed pull where a
		// warrior banners more than twice. None of the eight lanes is the player's own — a shaman does not
		// plant a banner — which is why every one has `own: false`, and why both rules read the buff the
		// player *received* rather than a press of theirs. Had this come back empty, both rules would have
		// been synthetic-only.
		const expected: Record<string, [number, number]> = {
			addsThenBoss: [3, 3],
			cleave: [2, 2],
			phased: [2, 2],
			unbroken: [1, 1],
		};
		// The grid is the committed set, so a fifth pull cannot be swept by neither half of this suite.
		expect(Object.keys(expected).sort()).toEqual([...FIXTURES].sort());
		for (const name of FIXTURES) {
			const { analysis } = pull(name);
			expect(
				banners(analysis).map((c) => c.windows.length),
				name,
			).toEqual(expected[name]);
			const lanes = [...(analysis.timeline?.lanes ?? []), ...(analysis.timeline?.hiddenLanes ?? [])];
			expect(
				lanes.filter((l) => l.key === 'skull-banner').map((l) => l.source?.own),
				name,
			).toEqual([false, false]);
		}
	});

	/**
	 * *** `mergeIntervals` joins bars that merely touch, and the claim that this happens on every committed
	 * pull was false before the fourth one arrived. ***
	 *
	 * `ascendance.ts`' own comment beside the union said the touching case "is the case on all three
	 * committed pulls: one warrior's banner comes off on the same millisecond the next goes up". Measured:
	 * `phased` hands off at 13 760, `unbroken` at 13 196 and `addsThenBoss` at 234 719 — but **`cleave`
	 * never does**. Its four bars are 2 814–13 243, 14 299–24 568, 184 448–194 721 and 203 392–213 744, so
	 * its union is its input and the merge is a no-op there. The universal was wrong about the third
	 * fixture, not the fourth.
	 *
	 * The mechanism is unaffected — a no-op merge is what a pull with no hand-off should get — so this is a
	 * correction to a stated fact rather than to behaviour, and it is pinned here so the next reader finds
	 * the measurement instead of the sentence.
	 *
	 * **A measurement of the fixtures rather than a red against the old behaviour.**
	 */
	it('merges touching banners on three of the four pulls, and finds nothing to merge on cleave', () => {
		const merged: string[] = [];
		for (const name of FIXTURES) {
			const flat = banners(pull(name).analysis)
				.flatMap((c) => c.windows.map(({ start, end }): Interval => [start, end]))
				.sort((a, b) => a[0] - b[0]);
			const union = mergeIntervals(flat);
			// Non-vacuous: every pull carries bars to merge or not merge.
			expect(flat.length, name).toBeGreaterThan(1);
			if (union.length < flat.length) merged.push(name);
		}
		expect(merged).toEqual(['addsThenBoss', 'phased', 'unbroken']);
	});

	it('measures rule 3 on all ten presses, and faults none of them', () => {
		// The ten overlaps, pinned individually. `unbroken`s second press is 714ms from the kill and sees no
		// banner at all — reported as 0 and charged for nothing, because that press is exempt under rule 2's
		// own guard before rule 3 is reached.
		//
		// **`addsThenBoss` is why "faults none of them" is now a narrower claim than it reads.** Three of
		// its four overlaps are under the 9 000 bound — 0, 1 499 and 0 — and rule 3 would have charged every
		// one of them. It does not, because those three presses are already exempt for having no two-piece
		// to sync against, which is a refusal that says nothing about banners. So the grade is unmoved and
		// the *measurement* is no longer comfortable everywhere, and the two are asserted apart below.
		const expected: Record<string, Array<number | null>> = {
			addsThenBoss: [11_373, 0, 1499, 0],
			cleave: [13_944, 10_273],
			phased: [15_000, 10_149],
			unbroken: [15_000, 0],
		};
		expect(Object.keys(expected).sort()).toEqual([...FIXTURES].sort());
		for (const name of FIXTURES) {
			expect(
				wired(name).verdict.presses.map((p) => p.bannerOverlapMs),
				name,
			).toEqual(expected[name]);
		}

		// No *gradeable* press is short of the bound — which is the claim, stated over the whole set.
		const short = FIXTURES.flatMap((name) =>
			wired(name)
				.verdict.presses.filter(
					(p) => p.grade !== 'none' && (p.bannerOverlapMs ?? Infinity) < SKULL_BANNER_OVERLAP_MIN_MS,
				)
				.map((p) => [name, p.t] as const),
		);
		expect(short).toEqual([]);
		// And the presses that *are* short exist and are all exempt, so the line above is not vacuous.
		const exemptAndShort = FIXTURES.flatMap((name) =>
			wired(name)
				.verdict.presses.filter((p) => (p.bannerOverlapMs ?? Infinity) < SKULL_BANNER_OVERLAP_MIN_MS)
				.map((p) => [name, p.t, p.reason] as const),
		);
		expect(exemptAndShort).toEqual([
			['addsThenBoss', 173_985, 'no-two-piece-evidence'],
			['addsThenBoss', 395_244, 'no-two-piece-evidence'],
			['addsThenBoss', 539_625, 'no-two-piece-evidence'],
			['unbroken', 183_734, 'pull-ends-too-soon'],
		]);
	});

	it('reports rule 4 on three of the four, and says nothing on the fourth', () => {
		// `phased`s second Ascendance at 196 197 finds the second banner of the warrior who opened at
		// 13 760 (196 649–206 798); `cleave`s at 184 240 finds the one at 184 448–194 721, 208ms later.
		// `unbroken` has two warriors who each pressed once, so there is no second banner and the answer is
		// null rather than false.
		//
		// **`addsThenBoss` is the first committed pull to read rule 4 `false`.** Both its warriors pressed
		// three times, so second banners exist — at 228 626 and 234 719 — and its second Ascendance is at
		// 173 985, between their first and second rotations. The overlap is 0 and the rule says so. It
		// grades nothing, which is the hedge working: that press is `none` for having no two-piece, and a
		// rule 4 that participated in the grade would have had an opinion about a press nothing else would
		// judge.
		const expected: Record<string, [number | null, boolean | null]> = {
			addsThenBoss: [0, false],
			cleave: [10_273, true],
			phased: [10_149, true],
			unbroken: [null, null],
		};
		expect(Object.keys(expected).sort()).toEqual([...FIXTURES].sort());
		for (const name of FIXTURES) {
			const second = wired(name).verdict.presses[1];
			expect([second?.secondBannerOverlapMs, second?.secondBannerSynced], name).toEqual(expected[name]);
		}
		// The hedge, on the one real `false`: shown and never graded.
		expect(wired('addsThenBoss').verdict.presses[1]?.grade).toBe('none');
	});

	it('moves no grade on any pull, and no press verdict either', () => {
		// The before/after, and it is a nil result on all three: `bad` / `good` / `bad` before rules 3 and
		// 4 and after them, with every press keeping the verdict lane D's change left it with. Rule 3 can
		// only fault, and the lowest overlap any *gradeable* press has is 10 149ms against a 9 000 bound.
		//
		// **Also not a red against the old behaviour, and it cannot be** — a test that a change moved
		// nothing has nothing to fail against. What it does guard is the next change: it is the line that
		// fails if rule 3 is ever re-pointed at the best single banner instead of the union, which is the
		// one alternative reading with real support, and which `phased` measurably does not survive. See
		// below.
		//
		// `addsThenBoss`' row is `none` throughout and is the fourth pull's own headline: it did not move
		// either, and it could not have — rule 3 can only fault, and every press on that pull is exempt
		// before rule 3 is asked.
		//
		// Pinned as literals rather than against the unwired run, which would compare two computations
		// over the same five values and pass whatever they were.
		const expected: Record<string, [string, string[]]> = {
			addsThenBoss: ['none', ['none', 'none', 'none', 'none']],
			cleave: ['bad', ['good', 'bad']],
			phased: ['bad', ['good', 'bad']],
			unbroken: ['good', ['good', 'none']],
		};
		expect(Object.keys(expected).sort()).toEqual([...FIXTURES].sort());
		for (const name of FIXTURES) {
			const { verdict } = wired(name);
			expect([verdict.grade, verdict.presses.map((p) => p.grade)], name).toEqual(expected[name]);
		}
	});

	it('would fault a clean opener on `phased` if it read the best single banner', () => {
		// The measured cost of the reading rule 3 does **not** use, on the one pull where the two readings
		// disagree. Two warriors handed off at 13 760ms: the first banner gives this opener 8 754ms, 246ms
		// short of the bound, while Skull Banner was in fact up for 14 999 of the 15 000ms the press bought.
		// Per-banner would call that a fault; the union calls it 15 000, and the press is graded on rules 1
		// and entry 14 as it was.
		const { analysis, verdict } = wired('phased');
		const press = verdict.presses[0];
		const window: [number, number] = [press!.t, press!.t + ASCENDANCE_DURATION_MS];
		const perBanner = banners(analysis)
			.flatMap((c) => c.windows)
			.map((w) => Math.max(0, Math.min(window[1], w.end) - Math.max(window[0], w.start)));
		expect(Math.max(...perBanner)).toBe(8754);
		expect(Math.max(...perBanner)).toBeLessThan(SKULL_BANNER_OVERLAP_MIN_MS);
		expect([press?.bannerOverlapMs, press?.grade]).toEqual([15_000, 'good']);
	});
});
