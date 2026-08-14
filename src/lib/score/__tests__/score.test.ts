import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Analysis } from '~/lib/types';

import { scoreAnalysis } from '../score';

/**
 * Three captured pulls spanning strong, mediocre and poor play.
 *
 * The point of testing against real fixtures rather than hand-built objects is that thresholds are
 * only worth anything if they separate real pulls. A scheme that grades every log the same colour
 * passes any unit test written around it and tells a reader nothing.
 */
function fixture(name: string): Analysis {
	return JSON.parse(readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8'));
}

describe('scoreAnalysis', () => {
	it('separates a strong pull from a poor one', () => {
		const strong = scoreAnalysis(fixture('strong'));
		const poor = scoreAnalysis(fixture('poor'));

		expect(strong.overall).toBe('good');
		// `bad` again, but for a different reason than it once was. It briefly read `ok`: fixing the
		// missing Jab spell ids lifted this player's globals from 58% to 90%, and the weights of the
		// day let two near-universally-passed metrics outvote three red sections. The thresholds were
		// then recalibrated against 25 real kills — where nothing could score `bad` on globals or
		// snapshot depth at all — and the verdict came back on evidence rather than on a pinned number.
		expect(poor.overall).toBe('bad');
		// What must always hold is that the spec-defining sections tell them apart.
		expect(poor.sections['snapshots']?.grade).toBe('bad');
		expect(strong.sections['snapshots']?.grade).toBe('good');
		expect(poor.sections['tigerPalm']?.grade).toBe('bad');
		expect(strong.sections['tigerPalm']?.grade).toBe('good');
	});

	it('grades the middle pull as neither', () => {
		expect(scoreAnalysis(fixture('mixed')).overall).toBe('ok');
	});

	/**
	 * Rising Sun Kick's debuff is per-target. On an add fight the damage is spread by design, and
	 * measuring uptime against whichever enemy took the most of it produced uptimes as low as 0.6%
	 * across a real 25-pull sample — a red grade for playing the fight correctly.
	 */
	it('declines to grade debuff uptime on a multi-target pull', () => {
		const analysis = fixture('poor');
		const spread: Analysis = {
			...analysis,
			debuff: { ...analysis.debuff, singleTarget: false, primaryDamageShare: 23 },
		};
		expect(scoreAnalysis(spread).sections['debuff']?.unmeasurable).toBe(true);
		// And still grades it when the pull really was one target.
		expect(scoreAnalysis(analysis).sections['debuff']?.unmeasurable).toBe(false);
	});

	it('grades snapshot discipline off the catch rate, not the depth of the ones caught', () => {
		// The poor pull posts the *best* mean depth in the set (86%) off two caught procs out of nine.
		// Grading on depth would call it the best snapshotter in the sample; it is the worst.
		const poor = scoreAnalysis(fixture('poor')).sections['snapshots'];
		const strong = scoreAnalysis(fixture('strong')).sections['snapshots'];

		expect(poor?.grade).toBe('bad');
		expect(strong?.grade).toBe('good');
	});

	/**
	 * Depth is measured and shown and must not move a verdict, in either direction.
	 *
	 * It was already kept out of the section grade; what it still carried was a full unit of weight in
	 * the overall mean, which is where the inversion actually landed. On the three fixtures the strong
	 * pull graded `bad` on depth off 12 catches and the poor pull graded `good` off 2, so the metric
	 * was quietly handing points to the worse player. Flipping it in both directions on the same pull
	 * is the direct test: neither the section nor the overall may notice.
	 */
	it('lets no verdict depend on snapshot depth', () => {
		const analysis = fixture('strong');
		const at = (meanDepthPct: number): Analysis => ({ ...analysis, procs: { ...analysis.procs, meanDepthPct } });

		const perfect = scoreAnalysis(at(100));
		const dreadful = scoreAnalysis(at(5));

		expect(perfect.overall).toBe(dreadful.overall);
		expect(perfect.sections['snapshots']?.grade).toBe(dreadful.sections['snapshots']?.grade);
		// Still reported, and still graded against its own bands — the section's copy picks a sentence
		// off that grade, so removing it entirely would leave the depth line with nothing to say.
		const metricOf = (card: ReturnType<typeof scoreAnalysis>) =>
			card.sections['snapshots']?.metrics.find((m) => m.key === 'snapshotDepth');
		expect(metricOf(perfect)?.grade).toBe('good');
		expect(metricOf(dreadful)?.grade).toBe('bad');
	});

	/**
	 * A stack lost at the cap while holding a brew for a Re-Origination proc was the price of the
	 * snapshot, and the report used to charge for it while separately faulting the early brew that
	 * would have prevented it — leaving a full bank with no move it called correct. Only the avoidable
	 * stacks are graded; every one of them is still reported.
	 */
	it('grades cap waste on the stacks that were avoidable', () => {
		const analysis = fixture('poor');
		const protectedWaste: Analysis = {
			...analysis,
			brew: { ...analysis.brew, wastedProtecting: analysis.brew.wastedAtCap },
		};
		const capOf = (a: Analysis) => scoreAnalysis(a).sections['brew']?.metrics.find((m) => m.key === 'brewCapWaste');

		// The poor pull's ten lost stacks all sit outside any proc, so nothing there is forgiven.
		expect(capOf(analysis)?.value).toBe(10);
		expect(capOf(analysis)?.grade).toBe('bad');
		expect(capOf(protectedWaste)?.value).toBe(0);
		expect(capOf(protectedWaste)?.grade).toBe('good');
	});

	/**
	 * A pull where every proc arrived with too few stacks to brew has no catch rate to report — the
	 * denominator is zero. That must read as unmeasurable rather than as 0%.
	 */
	it('cannot grade a catch rate when no proc was affordable', () => {
		const analysis = fixture('strong');
		const unaffordable: Analysis = {
			...analysis,
			procs: { ...analysis.procs, snapshotted: 0, opportunities: 0, unaffordable: analysis.procs.procs },
		};
		const snapshots = scoreAnalysis(unaffordable).sections['snapshots'];
		expect(snapshots?.unmeasurable).toBe(true);
		expect(snapshots?.grade).not.toBe('bad');
	});

	it('marks a metric unmeasurable rather than failing it', () => {
		const analysis = fixture('strong');
		const barren: Analysis = {
			...analysis,
			procs: { ...analysis.procs, procs: 0, snapshotted: 0, opportunities: 0, unaffordable: 0 },
			filler: { ...analysis.filler, casts: 0, wasted: 0 },
		};
		const card = scoreAnalysis(barren);

		expect(card.sections['snapshots']?.unmeasurable).toBe(true);
		expect(card.sections['tigerPalm']?.unmeasurable).toBe(true);
		// A pull that never offered a proc has not failed to catch one.
		expect(card.sections['snapshots']?.grade).not.toBe('bad');
	});

	it('never throws on an empty pull', () => {
		const analysis = fixture('mixed');
		const empty: Analysis = {
			...analysis,
			procs: {
				...analysis.procs,
				procs: 0,
				snapshotted: 0,
				opportunities: 0,
				unaffordable: 0,
				meanDepthPct: 0,
				windows: [],
			},
			brew: { ...analysis.brew, uses: 0, maxStacks: 0, avgConsumed: 0, wastedAtCap: 0 },
			debuff: { ...analysis.debuff, casts: 0 },
			filler: { ...analysis.filler, casts: 0, wasted: 0 },
			cpm: { ...analysis.cpm, gcdSlots: 0 },
		};
		expect(() => scoreAnalysis(empty)).not.toThrow();
		expect(scoreAnalysis(empty).overall).toBe('ok');
	});
});
