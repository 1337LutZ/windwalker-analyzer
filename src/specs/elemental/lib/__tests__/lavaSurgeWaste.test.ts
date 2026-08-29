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

import { SELF_EVENT_MS } from '~/lib/analysis/auras';
import { rawFixtures } from '~/lib/analysis/fixtures';
import { complementOf, intersect, overlapMs } from '~/lib/analysis/intervals';
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
		expect(lb.judged).toBe(19);
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
			['phased', 18, 16],
			['unbroken', 20, 17],
		] as const) {
			const lb = fx(name).lavaBurst;
			expect(lb.wasted, name).toBe(0);
			expect(lb.procs, name).toHaveLength(procs);
			expect(lb.judged, name).toBe(judged);
			expect(card(name)?.grade, name).toBe('good');
		}
	});

	/**
	 * The flag, rebuilt here from the arrays the audit publishes rather than read back off itself.
	 *
	 * The first version of this test filtered `procs` by the very flag `index.ts` had just written and
	 * called the agreement a guard: it restated the implementation and could not fail. This rebuilds the
	 * decision from two *published* clocks, the exempt stretches the shield's own card carries and the
	 * contact segments on the timeline, neither of which the surge code path produces.
	 *
	 * **Not from the count series, which would be a different rule rather than a second reading of this
	 * one.** The exemption is cut on `segmentPull`'s stretches, and a segment smooths a count that keeps
	 * moving: on `addsThenBoss` the proc at 161 825ms holds six seconds at two enemies or fewer by the raw
	 * series and still sits inside a `mixed` stretch, while the one at 43 669ms is the other way round.
	 * That is `exemptFrom` working as designed, since `aoe` *and* `mixed` are both "not the single-target
	 * list", so a guard written off the instantaneous count would fault the design and not the code.
	 */
	it('agrees with the flag rebuilt from the published clocks', () => {
		let checked = 0;
		for (const [name, el] of PULLS) {
			const exempt = el.lightningShield.exemptWindows.map((w): [number, number] => [w.start, w.end]);
			const contact = (el.timeline?.contactSegments ?? []).map(([open, close]): [number, number] => [open, close]);
			const graded = intersect(contact, complementOf(exempt, el.durationMs));
			for (const proc of el.lavaBurst.procs) {
				checked += 1;
				expect(proc.judged, `${name} @${proc.start}`).toBe(overlapMs(proc.start, proc.end, graded) >= SELF_EVENT_MS);
			}
		}
		// A sweep that walked no procs would pass silently, which is the failure this file's own history is
		// about.
		expect(checked).toBe(99);
	});

	/**
	 * The row a wasted surge draws always names the add phase, so the copy must never be reachable by a
	 * surge the pull simply walked away from. That holds by construction rather than by wording: `wasted`
	 * is gated on the expiry instant landing inside the contact clock, so every row the table draws had
	 * contact at its end.
	 */
	it('draws a row only for surges that expired with something in range', () => {
		for (const [name, el] of PULLS) {
			const contact = el.timeline?.contactSegments ?? [];
			for (const proc of el.lavaBurst.procs.filter((p) => p.wasted)) {
				expect(
					contact.some(([open, close]) => proc.end >= open && proc.end < close),
					`${name} @${proc.start}`,
				).toBe(true);
			}
		}
	});

	/**
	 * The exemption can only ever forgive, never invent.
	 */
	it('keeps the charged fault inside the raw one', () => {
		for (const [name, el] of PULLS) {
			const lb = el.lavaBurst;
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
		expect(phased.procs.filter((p) => !p.consumed && p.judged === false)).toHaveLength(1);
		expect(phased.judged).toBe(16);
	});

	/**
	 * **The rule declines rather than flattering a pull it asked nothing of.** A numerator cut against an
	 * uncut denominator grades `good` off a zero it was handed, which `docs/exemptions.md` names as the
	 * failure mode of exactly this shape: the free pass goes to the pull the exemption just excused. The
	 * sample gate is `judged`, so a pull whose every proc fell inside an add phase reads "cannot say".
	 */
	it('withholds a letter from a pull whose procs were all exempt', () => {
		const el = fx('addsThenBoss');
		const allExempt = {
			...el,
			lavaBurst: { ...el.lavaBurst, judged: 0, wastedJudged: 0 },
		} as Analysis & ElementalAuditResult;
		const metric = scoreAnalysis(allExempt).sections['lavaBurst']?.metrics.find((m) => m.key === 'lavaSurgeWaste');
		expect(metric?.unmeasurable).toBe(true);
		// The count is still printed, because a refused rule is not a rule with nothing to show.
		expect(metric?.part).toBe(0);
		expect(metric?.sampleSize).toBe(el.lavaBurst.procs.length);
	});

	/** An analysis captured before this rule existed is "cannot say", never a clean zero. */
	it('withholds a letter from an analysis that predates the fields', () => {
		const el = fx('cleave');
		const legacy = {
			...el,
			lavaBurst: { procs: el.lavaBurst.procs, presses: el.lavaBurst.presses, wasted: el.lavaBurst.wasted },
		} as Analysis & ElementalAuditResult;
		const metric = scoreAnalysis(legacy).sections['lavaBurst']?.metrics.find((m) => m.key === 'lavaSurgeWaste');
		expect(metric?.unmeasurable).toBe(true);
		expect(metric?.grade).toBe('ok');
	});
});
