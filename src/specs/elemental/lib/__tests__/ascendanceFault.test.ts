// Which demand a faulted Ascendance press failed — the decomposition the verdict column reads.
//
// `cbc9259` landed the user's two absolute rules (plan §80.1 and §80.2) and **nothing rendered any of
// them**: `ascendanceSync` published `grade`, `reason` and `wastedMs` per press, and the table drew
// `at` / `dotLeft` / `state` off `press.opener` and `press.twoPiece` alone. So two rules that were
// correct and tested were invisible, which is not what "add this rule" meant.
//
// `grade: 'bad'` is the `and` of two or three demands and a reader needs the one that broke, because
// each has a different remedy. `ascendanceFault` names it. This file is that function's suite, and it
// asserts the property that matters rather than the mapping: **a named fault always has its own
// quantity genuinely offside, and a bad press always has a name.** That is what survives lane F
// reordering the conjunction — a mapping test would not.
//
// The function is exported from `index.ts` and tested directly for the same reason `ascendanceSync` is
// a pure exported function rather than a closure: a decomposition of a published shape is testable at
// its own boundary, and the four faults that no committed fixture produces would otherwise be
// reachable only by fabricating a whole `FightDataset`.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Analysis, AscendanceFault, ElementalAuditResult, FightDataset } from '~/lib/types';

import {
	ASCENDANCE_INTO_HASTE_MS,
	OPENER_DEADLINE_MS,
	T16_2PC_SYNC_MIN_MS,
	type AscendancePressVerdict,
} from '../ascendance';
import { analyse, ascendanceFault } from '..';

const FIXTURES = ['unbroken', 'phased', 'cleave'] as const;

const load = (name: string): Analysis & ElementalAuditResult =>
	analyse(
		JSON.parse(readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8')) as FightDataset,
	) as Analysis & ElementalAuditResult;

/** A verdict with every field explicit, so each case below states only what it is about. */
const verdict = (over: Partial<AscendancePressVerdict>): AscendancePressVerdict => ({
	t: 3000,
	rule: 'bloodlust',
	grade: 'bad',
	reason: null,
	delayMs: null,
	dischargeRemainingMs: null,
	syncStartMs: null,
	limitMs: ASCENDANCE_INTO_HASTE_MS,
	wastedMs: null,
	bannerOverlapMs: null,
	secondBannerOverlapMs: null,
	secondBannerSynced: null,
	...over,
});

describe('a fault is named only where the grade already said bad', () => {
	/**
	 * The half that stops this from ever inventing a fault. `grade` is the authority on whether a press
	 * was bad; this function only names why, so a good or an ungraded press must come back null whatever
	 * else its fields say — including the ones that would look like faults in isolation.
	 */
	it('is null on a good press and on an ungraded one, however offside their numbers look', () => {
		expect(ascendanceFault(verdict({ grade: 'good', t: 99_000, delayMs: 60_000 }))).toBeNull();
		expect(
			ascendanceFault(verdict({ grade: 'none', reason: 'pull-ends-too-soon', rule: 't16-2pc', wastedMs: 14_286 })),
		).toBeNull();
		// The shape `unbroken`'s second press really has: exempt, and carrying the waste measurement anyway.
		expect(
			ascendanceFault(
				verdict({ grade: 'none', reason: 'nothing-to-hit', rule: 't16-2pc', limitMs: T16_2PC_SYNC_MIN_MS }),
			),
		).toBeNull();
	});

	it('names something on every bad press, so no red cell can render blank', () => {
		const bad: Partial<AscendancePressVerdict>[] = [
			{ t: OPENER_DEADLINE_MS + 1 },
			{ delayMs: ASCENDANCE_INTO_HASTE_MS + 1 },
			{ bannerOverlapMs: 0 },
			{ rule: 't16-2pc', limitMs: T16_2PC_SYNC_MIN_MS, dischargeRemainingMs: 0 },
			{ rule: 't16-2pc', limitMs: T16_2PC_SYNC_MIN_MS, wastedMs: 5000 },
			{ rule: 't16-2pc', limitMs: T16_2PC_SYNC_MIN_MS, dischargeRemainingMs: 12_000, bannerOverlapMs: 0 },
		];
		for (const over of bad) expect(ascendanceFault(verdict(over)), JSON.stringify(over)).not.toBeNull();
	});
});

describe('each fault is the demand its own quantity actually broke', () => {
	/** Rule 1 (§80.1): outside the opener at all, which the opener press is never allowed to be. */
	it('calls a press past the opener deadline the opener fault', () => {
		expect(ascendanceFault(verdict({ t: OPENER_DEADLINE_MS + 1 }))).toBe('opener-late');
		// And the deadline itself is inside, which is the 250ms grace `cbc9259` argued for: `phased` opens
		// at 5 006ms and a bare five seconds would fault a press this rule wants credited.
		expect(ascendanceFault(verdict({ t: OPENER_DEADLINE_MS, bannerOverlapMs: 0 }))).not.toBe('opener-late');
	});

	/** Rule 2 (§80.2), read off the shape: the only bad later press that reports no discharge at all. */
	it('calls a later press with no discharge reading the window fault', () => {
		const v = verdict({ rule: 't16-2pc', limitMs: T16_2PC_SYNC_MIN_MS, wastedMs: 14_286 });
		expect(ascendanceFault(v)).toBe('window-past-the-kill');
		expect(v.dischargeRemainingMs).toBeNull();
		// The measurement the sentence prints is the one the module put there.
		expect(v.wastedMs).toBeGreaterThan(0);
	});

	/** Entry 14 — in the opener, but too far behind the haste cooldown to be spent inside it. */
	it('calls an opener late into the haste the haste fault, and not the opener fault', () => {
		const v = verdict({ t: 4000, delayMs: ASCENDANCE_INTO_HASTE_MS + 1 });
		expect(ascendanceFault(v)).toBe('late-into-haste');
		expect(v.t).toBeLessThanOrEqual(OPENER_DEADLINE_MS);
		expect(v.delayMs!).toBeGreaterThan(v.limitMs);
	});

	/** Entry 15 — the discharge had less left than the sync demands. Zero is the commonest case. */
	it('calls a short discharge the discharge fault', () => {
		for (const left of [0, 1, T16_2PC_SYNC_MIN_MS - 1]) {
			const v = verdict({ rule: 't16-2pc', limitMs: T16_2PC_SYNC_MIN_MS, dischargeRemainingMs: left });
			expect(ascendanceFault(v), `${left}`).toBe('discharge-too-short');
			expect(v.dischargeRemainingMs!).toBeLessThan(v.limitMs);
		}
	});

	/**
	 * Rule 3, on both arms, and reached by exclusion rather than by re-testing the overlap.
	 *
	 * **Wired, and still not reachable on a committed pull — for a better reason than it was.** `index.ts`
	 * now passes `skullBannerWindows`, so rule 3 reads real overlaps on all six presses: 15 000, 10 149,
	 * 15 000, 0, 13 944 and 10 273 ms against a 9 000 bound. Five clear it and the single zero is on the
	 * press rule 2's availability guard has already exempted, so no committed press fails rule 3 and both
	 * of its faults stay synthetic. That is a property of these three pulls rather than of the wiring.
	 *
	 * Rule 3 reads the **union** of every banner the player was given, not the best single one, and
	 * `phased` is why it must: two warriors handed off mid-window, so its opener's best single banner is
	 * 8 754 ms — 246 short of the bar — while Skull Banner was in fact up for 14 999 of that press's
	 * 15 000. The copy has to match the reading, which is why the sentence names Skull Banner rather than
	 * a warrior's banner: nobody should be faulted for two warriors' stagger.
	 */
	it('falls through to the banner fault when nothing else can have failed', () => {
		expect(ascendanceFault(verdict({ t: 3000, delayMs: 1000, bannerOverlapMs: 0 }))).toBe('no-banner');
		expect(
			ascendanceFault(
				verdict({
					rule: 't16-2pc',
					limitMs: T16_2PC_SYNC_MIN_MS,
					dischargeRemainingMs: T16_2PC_SYNC_MIN_MS + 1,
					bannerOverlapMs: 0,
				}),
			),
		).toBe('no-banner');
	});
});

describe('the committed pulls, measured rather than assumed', () => {
	/**
	 * What the three fixtures actually publish. Two of the five faults are exercised by real data — one
	 * of them by nothing at all — so this table is the record of which cases the pulls can and cannot
	 * speak to, and the reason the suite above is synthetic where it is.
	 */
	it('faults each pull’s presses the way its own numbers demand', () => {
		const faults = FIXTURES.map((name) => load(name).ascendance.presses.map((p) => p.fault));
		expect(faults).toEqual([
			// unbroken: a good opener, and a second press rule 2's guard exempts — 58ms after the button
			// came back, so the 14 286ms it wasted is the pull's length and not the player's choice.
			[null, null],
			// phased and cleave: a good opener each, and a second press that found no discharge at all.
			[null, 'discharge-too-short'],
			[null, 'discharge-too-short'],
		] satisfies (AscendanceFault | null)[][]);
	});

	/** The invariant on real data, both directions, which is what a reordered conjunction would break. */
	it('names a fault on exactly the bad presses and no others', () => {
		for (const name of FIXTURES)
			for (const press of load(name).ascendance.presses)
				expect(press.fault !== null, `${name} @${press.t}`).toBe(press.sync.grade === 'bad');
	});

	/**
	 * **The rendering commit moves no graded figure**, asserted rather than claimed. `cbc9259` pinned
	 * these three and drawing them must not disturb them.
	 */
	it('leaves every pull grade where cbc9259 left it', () => {
		expect(FIXTURES.map((name) => load(name).ascendance.grade)).toEqual(['good', 'bad', 'bad']);
	});
});
