// The summary card for the free casts, and the add waves it must not charge.
//
// A Lava Surge makes one Lava Burst instant and free, so a surge that expires unspent is a press the
// player had and did not take, and a cast count cannot show it, because the cast that never happened
// is not in it. The section has listed those since it was written; nothing on the summary said so.
//
// **The cut this file is really about.** `aoe.apl.json` carries no Lava Burst rung at all, so at three
// enemies or more the rotation spends the global on Chain Lightning and a surge that lives and dies
// inside an add wave was never a press to make. Charging it would score a player against a list nobody
// follows, which is the defect `earthShockAoeBand.test.ts` was written after, one button along.
import { describe, expect, it } from 'vitest';

import { rawFixtures } from '~/lib/analysis/fixtures';
import type { Metric } from '~/lib/score';
import type { Analysis, ElementalAuditResult } from '~/lib/types';

import { analyse } from '../index';
import { scoreAnalysis } from '../score';

const PULLS = new Map<string, Analysis & ElementalAuditResult>(
	rawFixtures('elemental').map(({ name, dataset }) => [
		name.replace(/\.json$/, ''),
		analyse(dataset) as Analysis & ElementalAuditResult,
	]),
);

const fx = (name: string): Analysis & ElementalAuditResult => {
	const el = PULLS.get(name);
	if (el === undefined) throw new Error(`no committed fixture named ${name}`);
	return el;
};

/** `lavaSurgeWaste` as the report grades it. */
const card = (name: string): Metric | undefined =>
	scoreAnalysis(fx(name)).sections['lavaBurst']?.metrics.find((m) => m.key === 'lavaSurgeWaste');

describe('the surges the add waves excuse', () => {
	/**
	 * `addsThenBoss` is the pull the exemption is for, and it is the whole argument in one line: five
	 * surges expired unspent and **not one** of them was at a count the rotation presses Lava Burst at.
	 * Without the cut the pull reads 12.8% wasted and is faulted for an add phase.
	 */
	it('charges none of the five surges addsThenBoss lost to its add waves', () => {
		const lb = fx('addsThenBoss').lavaBurst;
		expect(lb.wasted).toBe(5);
		expect(lb.wastedJudged).toBe(0);
		expect(lb.judged).toBe(21);
		// The share is taken over every proc, so the 39 is the tile's own denominator and not the 21: a
		// forgiven surge is still one of the free casts this pull was handed. See the metric in `score.ts`.
		expect(card('addsThenBoss')?.value).toBe(0);
		expect(card('addsThenBoss')?.sampleSize).toBe(39);
		expect(card('addsThenBoss')?.grade).toBe('good');
	});

	/**
	 * And the pull that keeps its fault, so the cut cannot be read as a blanket excuse: `cleave` has add
	 * waves too and all three of its wasted surges expired at one or two enemies.
	 */
	it('charges all three of cleave’s, which expired where the button is wanted', () => {
		const lb = fx('cleave').lavaBurst;
		expect(lb.wasted).toBe(3);
		expect(lb.wastedJudged).toBe(3);
		expect(lb.judged).toBe(12);
		// Three of 22 procs, and `bad` either way it is read: 13.6% over every proc against the 3/10 lines,
		// 25.0% over the twelve it could be charged for. The lines are cut for the wider denominator.
		expect(card('cleave')?.value).toBeCloseTo(13.636, 3);
		expect(card('cleave')?.sampleSize).toBe(22);
		expect(card('cleave')?.grade).toBe('bad');
	});

	/** The two single-target pulls: nothing wasted, and nothing exempt either. */
	it('reads a clean rule on both single-target pulls', () => {
		for (const [name, procs, judged] of [
			['phased', 18, 17],
			['unbroken', 20, 20],
		] as const) {
			const lb = fx(name).lavaBurst;
			expect(lb.wasted, name).toBe(0);
			expect(lb.procs, name).toHaveLength(procs);
			expect(lb.judged, name).toBe(judged);
			expect(card(name)?.grade, name).toBe('good');
		}
	});

	/**
	 * The two halves of the share come off one filter of one array, which is what keeps them from
	 * disagreeing, the failure `earthShockAoeBand.test.ts` documents from the other direction.
	 */
	it('publishes counts that match the procs they were taken from', () => {
		for (const [name, el] of PULLS) {
			const lb = el.lavaBurst;
			expect(lb.judged, name).toBe(lb.procs.filter((p) => p.judged).length);
			expect(lb.wastedJudged, name).toBe(lb.procs.filter((p) => p.wasted && p.judged).length);
			// The exemption can only ever forgive, never invent: the graded fault is a subset of the raw one,
			// and the judged procs a subset of every proc.
			expect(lb.wastedJudged ?? 0, name).toBeLessThanOrEqual(lb.wasted);
			expect(lb.judged ?? 0, name).toBeLessThanOrEqual(lb.procs.length);
		}
	});

	/**
	 * A surge outside the contact clock is not judged either, and that is the other half of the flag: a
	 * boss that submerges takes the free cast back rather than being handed one. `phased`'s single
	 * unconsumed proc is the case, and `lavaBurst.test.ts` pins it press by press.
	 */
	it('leaves a surge the fight took back out of the charge', () => {
		const phased = fx('phased').lavaBurst;
		const away = phased.procs.filter((p) => !p.consumed && p.judged === false);
		expect(away).toHaveLength(1);
		expect(phased.judged).toBe(phased.procs.length - 1);
		// And it says which of the two clocks refused it, because the row in the section says so in words:
		// the submerge, not the enemy count.
		expect(away[0]?.exempt).toBe('unreachable');
	});

	/**
	 * The reason travels with the proc, so the row that declines to charge one can name the clock that
	 * refused it. The first version of that row said "three or more enemies up" on every uncharged surge,
	 * including the ones the boss had walked away from.
	 */
	it('names a reason on every proc it does not judge, and on no other', () => {
		for (const [name, el] of PULLS) {
			for (const proc of el.lavaBurst.procs) {
				expect(proc.exempt === undefined, `${name} @${proc.start}`).toBe(proc.judged === true);
				if (proc.exempt !== undefined) expect(['aoe', 'unreachable'], name).toContain(proc.exempt);
			}
		}
	});
});
