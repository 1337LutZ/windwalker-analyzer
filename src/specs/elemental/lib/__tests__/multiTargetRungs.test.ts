// The two multi-target fillers, and what having a rung for them changes.
//
// Before this the ladder contained neither Chain Lightning nor Lava Beam, so on `cleave` — the only
// multi-target pull in the fixtures — 70 and 11 presses respectively were graded `skipped`, 81 of the
// pull's 126 skips. **A button with no rung can never be graded as correct**, so those presses were
// faults whatever the player did, and the section could not tell a reader which of them were real.
//
// The rungs do not come from the p5 list the rest of the ladder is transcribed from: that list is
// single-target and contains neither button. `cleave.apl.json` ends `Chain Lightning → Lightning Bolt`
// and `aoe.apl.json` ends `Lava Beam → Chain Lightning`, so the order and the band gates are what those
// two files are.
//
// What is asserted here is deliberately *both* directions: that the presses the list wanted now read as
// followed, and that the ones it did not — a Chain Lightning at one target, a beam fired while the dot
// was down — still read as faults. A rung that excused every press would have replaced 81
// unattributable faults with 81 excuses, which is worse.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Analysis, FightDataset } from '~/lib/types';
import { analyse } from '~/specs/elemental/lib';
import { LADDER_ENTRIES, ROTATION } from '~/specs/elemental/lib/apl';

const CHAIN_LIGHTNING = 421;
const LAVA_BEAM = 114074;

const load = (name: string): Analysis =>
	analyse(
		JSON.parse(readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8')) as FightDataset,
	) as Analysis;

const cleave = load('cleave');
const phased = load('phased');
const unbroken = load('unbroken');

interface Press {
	t: number;
	pressed: number;
	wanted: string | null;
	verdict: string;
}
const pressesOf = (analysis: Analysis): Press[] =>
	((analysis.apl as { presses?: Press[] } | null)?.presses ?? []) as Press[];

describe('the ladder carries the multi-target fillers', () => {
	it('places the beam above Chain Lightning, and both above the bottom rung', () => {
		const keys = LADDER_ENTRIES.map((e) => e.key);
		const beam = keys.indexOf('lava-beam');
		const chain = keys.indexOf('chain-lightning');
		const bolt = keys.indexOf('lightning-bolt');
		expect(beam).toBeGreaterThanOrEqual(0);
		expect(beam).toBeLessThan(chain);
		expect(chain).toBeLessThan(bolt);
		// Both files' order, and `aoe.apl.json` is the one that puts the beam first.
		expect(bolt).toBe(keys.length - 1);
	});

	it('gates both from two targets up, which is what the single-target list omitting them means', () => {
		for (const key of ['lava-beam', 'chain-lightning'] as const) {
			expect(LADDER_ENTRIES.find((e) => e.key === key)!.bands).toEqual([2, 3, 4]);
		}
		// The bottom rung is not banded — it is the filler that is always in the list.
		expect(LADDER_ENTRIES.find((e) => e.key === 'lightning-bolt')!.bands).toEqual([1, 2, 3, 4]);
	});

	it('names both in the reference list, so the two cannot drift', () => {
		const keys = ROTATION.map((r) => r.key);
		expect(keys).toContain('lava-beam');
		expect(keys).toContain('chain-lightning');
		expect(keys.indexOf('lava-beam')).toBeLessThan(keys.indexOf('chain-lightning'));
		expect(keys.indexOf('chain-lightning')).toBeLessThan(keys.indexOf('lightning-bolt'));
	});
});

describe('what the rungs change on cleave', () => {
	const presses = pressesOf(cleave);

	it('has the presses to grade, so nothing below is vacuous', () => {
		// Counted off the cast stream rather than off the verdicts, so this is a fact about the fixture.
		const casts = cleave.timeline?.casts ?? [];
		expect(casts.filter((c) => c.id === CHAIN_LIGHTNING)).toHaveLength(70);
		expect(casts.filter((c) => c.id === LAVA_BEAM)).toHaveLength(11);
		expect(cleave.targets?.counts?.max).toBe(13);
	});

	it('grades Chain Lightning as followed where the list wanted it', () => {
		const followed = presses.filter((p) => p.pressed === CHAIN_LIGHTNING && p.verdict === 'followed');
		expect(followed).toHaveLength(5);
		expect(followed.every((p) => p.wanted === 'chain-lightning')).toBe(true);
	});

	it('still faults a Chain Lightning at one target, against the bottom rung', () => {
		// The eight presses the log puts at a one-target count cannot reach a rung banded [2,3,4], so they
		// fall through to Lightning Bolt — which is the honest verdict, not a gap. Seven of them get there;
		// the eighth is faulted by a higher rung, which is why this is not asserted as eight.
		const atBolt = presses.filter((p) => p.pressed === CHAIN_LIGHTNING && p.wanted === 'lightning-bolt');
		expect(atBolt).toHaveLength(7);
		expect(atBolt.every((p) => p.verdict === 'skipped')).toBe(true);
	});

	it('leaves the faults the list really does name', () => {
		// **Green before this change and after it, deliberately — a pin, not a guard.** These two counts
		// were 33+10 and 17+1 across the two buttons before the rungs existed and are 43 and 18 now, which
		// is the same presses attributed the same way. What the rungs bought is not fewer faults here: it
		// is that a reader can now be told *which* rung wanted the global. A Chain Lightning or a beam
		// pressed while the dot was down is a mistake at any target count.
		const wanted = new Map<string, number>();
		for (const p of presses) {
			if (p.pressed !== CHAIN_LIGHTNING && p.pressed !== LAVA_BEAM) continue;
			if (p.verdict !== 'skipped') continue;
			wanted.set(p.wanted ?? '?', (wanted.get(p.wanted ?? '?') ?? 0) + 1);
		}
		expect(wanted.get('flame-shock')).toBe(43);
		expect(wanted.get('lava-burst')).toBe(18);
	});

	it('fires every beam inside an Ascendance window, which is why its rung tests that and not a clock', () => {
		// `sim/shaman/elemental/lava_beam.go` gates the spell itself on `ele.AscendanceAura.IsActive()`.
		// Read off the fixture's own aura lane, so this is evidence for the rung rather than a restatement
		// of it.
		const windows = (cleave.timeline?.lanes ?? []).find((l) => l.key === 'ascendance')?.windows ?? [];
		expect(windows.length).toBeGreaterThan(0);
		const beams = (cleave.timeline?.casts ?? []).filter((c) => c.id === LAVA_BEAM);
		expect(beams.every((c) => windows.some((w) => c.t >= w.start && c.t <= w.end))).toBe(true);
	});
});

describe('single-target grading does not move', () => {
	// Both rungs are banded out of a one-target pull entirely, so these two must be untouched. They are
	// the guard against the rungs leaking into the single-target verdicts.
	it.each([
		['phased', phased, 159, 107, 52],
		['unbroken', unbroken, 142, 97, 45],
	])('%s grades exactly as before', (_name, analysis, total, followed, skipped) => {
		const presses = pressesOf(analysis as Analysis);
		expect(presses).toHaveLength(total as number);
		expect(presses.filter((p) => p.verdict === 'followed')).toHaveLength(followed as number);
		expect(presses.filter((p) => p.verdict === 'skipped')).toHaveLength(skipped as number);
		expect((analysis as Analysis).targets?.counts?.max).toBe(1);
	});
});
