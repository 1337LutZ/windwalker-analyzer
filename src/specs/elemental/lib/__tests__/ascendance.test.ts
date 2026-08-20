// The Ascendance opener rule: was the fifteen seconds spent inside the raid's haste cooldown.
//
// Both committed anonymous pulls carry a real haste cooldown on the pull, which is why the two
// real-pull cases below are worth more than any synthetic one: `phased` (`a:qHRAFwdGzaB6MPYC` #14)
// took a *Heroism* from another player at 1 777 ms, and `unbroken` (`a:xB3kh7v9pF2AHRtq` #16) took a
// *Bloodlust* the shaman cast himself at 785 ms. Two different spells out of the shared group, one
// self-cast and one not, both read through `Handles.hasteWindows` without this module knowing which.
//
// Everything else is synthetic, because neither committed pull exercises a single one of the six
// refusals — both are clean, on-plan openers.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { auraWindows } from '~/lib/analysis/auras';
import type { AuraWindow } from '~/lib/analysis/auras';
import type { Interval } from '~/lib/analysis/intervals';
import { eventsOn } from '~/lib/events';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';
import { ascendanceSync, ASCENDANCE_SYNC_LIMIT_MS, type AscendanceSyncInput } from '../ascendance';
import { analyse, registry } from '../index';

// ------------------------------------------------------------------ real pulls

/**
 * One committed pull, as the exact values the wiring hunk would hand this module.
 *
 * Read through `analyse()` rather than off the raw events, so the test proves the audit really does
 * hold every input this function needs — the point of the deliverable is that wiring it in is a call,
 * not a fifth walk of the stream. `ascendanceAtPull` is the one value the audit does not yet publish,
 * so it is computed here the same way the audit computes its own `fePrepull`.
 */
function pull(name: string): { input: AscendanceSyncInput; analysis: Analysis & ElementalAuditResult } {
	const dataset = JSON.parse(
		readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8'),
	) as FightDataset;
	const analysis = analyse(dataset) as Analysis & ElementalAuditResult;
	const t0 = dataset.fight.startTime;
	const selfEvents = eventsOn(dataset.events, dataset.actor.id);
	return {
		analysis,
		input: {
			ascendanceCasts: analysis.ascendance.presses.map((p) => p.t),
			ascendanceAtPull: auraWindows(selfEvents, registry.aura('ascendance'), t0, dataset.fight.endTime, {
				openAtPull: true,
			}).some((w) => w.preexisting === true),
			hasteWindows: analysis.timeline?.hasteWindows ?? [],
			contact: (analysis.timeline?.contactSegments ?? []).map(([start, end]): Interval => [start, end]),
			t16FourPieceWindows: null,
		},
	};
}

describe('the Ascendance opener on the two committed anonymous pulls', () => {
	it('reads a Heroism cast by somebody else, and a press 3.2s into it', () => {
		const { input, analysis } = pull('phased');
		// The shared group is what makes this work: 32182 is Heroism, not Bloodlust, and the rule never
		// asks which. Cast by actor 7, landing on the shaman at 1 777 ms.
		expect(input.hasteWindows).toEqual([{ start: 1777, end: 41_785, id: 32_182, variant: 'Heroism' }]);
		expect(analysis.ascendance.presses.map((p) => p.t)).toEqual([5006, 196_197]);

		expect(ascendanceSync(input)).toEqual({
			rule: 'bloodlust',
			grade: 'good',
			reason: null,
			syncStartMs: 1777,
			pressMs: 5006,
			delayMs: 3229,
			limitMs: 5000,
		});
	});

	it('reads a Bloodlust the shaman cast himself, and a press 2.9s into it', () => {
		const { input, analysis } = pull('unbroken');
		// 45 events of id 2825 in this pull — the shaman lusted the whole raid — and one window, because
		// `hasteWindows` is scoped to events *landing on* the player rather than sourced by them.
		expect(input.hasteWindows).toEqual([{ start: 785, end: 40_790, id: 2825, variant: 'Bloodlust' }]);
		expect(analysis.ascendance.presses.map((p) => p.t)).toEqual([3676, 183_734]);

		expect(ascendanceSync(input)).toEqual({
			rule: 'bloodlust',
			grade: 'good',
			reason: null,
			syncStartMs: 785,
			pressMs: 3676,
			delayMs: 2891,
			limitMs: 5000,
		});
	});

	it('grades the first press and not the recharge on either pull', () => {
		// Both shamans pressed again near the kill — 196.2s and 183.7s, long after the haste cooldown
		// closed. Reading the last press instead of the first would fault both pulls.
		for (const name of ['phased', 'unbroken']) {
			const { input } = pull(name);
			expect(input.ascendanceCasts).toHaveLength(2);
			expect(ascendanceSync(input).pressMs).toBe(input.ascendanceCasts[0]);
		}
	});
});

// ------------------------------------------------------------------ synthetic

const lust = (start: number, end: number): AuraWindow => ({ start, end, id: 2825, variant: 'Bloodlust' });

/** A clean pull: lust at the bell, contact from the first global, Ascendance not up beforehand. */
const base: AscendanceSyncInput = {
	ascendanceCasts: [2000],
	ascendanceAtPull: false,
	hasteWindows: [lust(1000, 41_000)],
	contact: [[900, 200_000]],
	t16FourPieceWindows: null,
};

const at = (over: Partial<AscendanceSyncInput>): ReturnType<typeof ascendanceSync> =>
	ascendanceSync({ ...base, ...over });

describe('the bound, and which side of it a press falls on', () => {
	it('is one number and reports itself, so the threshold is never implicit', () => {
		expect(ASCENDANCE_SYNC_LIMIT_MS).toBe(5000);
		expect(at({}).limitMs).toBe(5000);
	});

	it('passes a press exactly on the bound', () => {
		const v = at({ ascendanceCasts: [1000 + ASCENDANCE_SYNC_LIMIT_MS] });
		expect([v.grade, v.delayMs]).toEqual(['good', 5000]);
	});

	it('faults a press one millisecond past it', () => {
		const v = at({ ascendanceCasts: [1000 + ASCENDANCE_SYNC_LIMIT_MS + 1] });
		expect([v.grade, v.delayMs]).toEqual(['bad', 5001]);
	});

	it('does not treat a press made before the cooldown landed as late', () => {
		// The bound is an upper bound on lateness, not a demand that the two land in an order. A press
		// at 200ms with lust at 1000ms is the opener going out first, which is not a fault.
		const v = at({ ascendanceCasts: [200] });
		expect([v.grade, v.delayMs]).toEqual(['good', -800]);
	});
});

describe('what it refuses to grade', () => {
	it('says nothing when the haste cooldown went out after the opener', () => {
		// A Bloodlust at 90s is a different tactical situation — Ascendance may well have been spent
		// already — so it is not read as the pull's, and no fault is invented.
		const v = at({ hasteWindows: [lust(90_000, 130_000)] });
		expect([v.rule, v.grade, v.reason, v.syncStartMs]).toEqual(['bloodlust', 'none', 'no-cooldown-on-pull', null]);
	});

	it('says nothing when the pull carried no haste cooldown at all', () => {
		// Which also covers the cooldown cast *before* the bell: the Bloodlust aura declares no
		// duration, so `auraWindows` cannot recover a pre-pull window for it and the walk comes back
		// empty. Silence, not a zero.
		const v = at({ hasteWindows: [] });
		expect([v.grade, v.reason]).toEqual(['none', 'no-cooldown-on-pull']);
	});

	it('says nothing when Ascendance was never pressed', () => {
		const v = at({ ascendanceCasts: [] });
		expect([v.grade, v.reason, v.syncStartMs, v.pressMs]).toEqual(['none', 'no-ascendance-press', 1000, null]);
	});

	it('says nothing when Ascendance was already running at the bell', () => {
		// Pressed before the pull: the button is down for three minutes and the press this rule judges
		// is not in the stream. Faulting the first *visible* press here is the exact shape of bug the
		// audit has shipped four times.
		const v = at({ ascendanceAtPull: true, ascendanceCasts: [30_000] });
		expect([v.grade, v.reason]).toEqual(['none', 'ascendance-up-at-the-pull']);
	});

	it('says nothing when the first visible press is past one full cooldown', () => {
		// At 180.001s the press could be a recharge whose first charge was spent before the pull and
		// left no trace — more than fifteen seconds before the bell, so not even `ascendanceAtPull`
		// would have caught it.
		const v = at({ ascendanceCasts: [180_001] });
		expect([v.grade, v.reason]).toEqual(['none', 'first-press-past-one-cooldown']);
	});

	it('grades a press on the cooldown boundary itself', () => {
		// The complement of the test above, so the boundary is pinned rather than assumed: 180 000 is
		// still graded, and graded bad, because at that point the press is provably the first.
		const v = at({ ascendanceCasts: [180_000] });
		expect([v.grade, v.reason, v.delayMs]).toEqual(['bad', null, 179_000]);
	});

	it('says nothing when there was nothing reachable inside the graded window', () => {
		// A pull that opened on an intermission. `[1000, 6000]` is the stretch being judged and contact
		// does not begin until 20s, so the press could not have bought anything.
		const v = at({ contact: [[20_000, 200_000]], ascendanceCasts: [25_000] });
		expect([v.grade, v.reason, v.syncStartMs]).toEqual(['none', 'nothing-to-hit', 1000]);
	});

	it('grades a pull whose contact begins on the last millisecond of the graded window', () => {
		// The boundary of the exemption, pinned from the other side.
		const v = at({ contact: [[6000, 200_000]], ascendanceCasts: [3000] });
		expect([v.grade, v.reason]).toEqual(['good', null]);
	});

	it('says nothing when the pull carried no enemy at all', () => {
		const v = at({ contact: [] });
		expect([v.grade, v.reason]).toEqual(['none', 'nothing-to-hit']);
	});
});

describe('precedence: the T16 four-piece rule replaces the Bloodlust rule', () => {
	it('reads the four-piece windows and never the haste cooldown', () => {
		// Built so the two rules disagree, which is the only way this assertion means anything. The
		// press at 20s is 20 000 ms into a lust that opened at 0 — flatly bad under the Bloodlust rule
		// — and 2 000 ms into a four-piece window that opened at 18s, which is good. A `good` here is
		// proof the haste cooldown was not consulted.
		const v = at({
			hasteWindows: [lust(0, 40_000)],
			ascendanceCasts: [20_000],
			t16FourPieceWindows: [{ start: 18_000, end: 28_000 }],
		});
		expect(v).toEqual({
			rule: 't16-4pc',
			grade: 'good',
			reason: null,
			syncStartMs: 18_000,
			pressMs: 20_000,
			delayMs: 2000,
			limitMs: 5000,
		});
	});

	it('does not fall through to Bloodlust when the four-piece has no window', () => {
		// An empty array is not `null`. The four-piece rule applies, finds nothing, and says so — it
		// does not quietly hand the pull back to a rule the caller said had been replaced. The haste
		// cooldown left in place here is a perfectly gradeable one, so a grade of any kind, or a
		// `no-cooldown-on-pull`, would mean the fall-through happened.
		const v = at({ t16FourPieceWindows: [] });
		expect([v.rule, v.grade, v.reason]).toEqual(['t16-4pc', 'none', 't16-4pc-has-no-sync-window']);
	});

	it('applies the four-piece rule on a pull with no haste cooldown whatsoever', () => {
		// The Bloodlust rule's own precondition is never even evaluated under precedence.
		const v = at({ hasteWindows: [], t16FourPieceWindows: [{ start: 1000, end: 11_000 }] });
		expect([v.rule, v.grade, v.delayMs]).toEqual(['t16-4pc', 'good', 1000]);
	});

	it('names `bloodlust` as the rule whenever the four-piece input is null', () => {
		// The precedence is a single total decision on one field, so the reported rule and the windows
		// actually read can never disagree.
		expect(at({}).rule).toBe('bloodlust');
		expect(at({ hasteWindows: [] }).rule).toBe('bloodlust');
		expect(at({ ascendanceCasts: [] }).rule).toBe('bloodlust');
	});
});
