// The rule this module exists to keep: never turn silence into a zero.
//
// Every case below is one that was observed on a real Mists pull before it was written down here —
// the pre-pull buff that logs nothing, the buff whose only event is its own removal, the two hunters
// whose overlapping auras made a naive pairing invent a drop, and the death that strips everything
// at once. The numbers in the assertions are what the log actually supports, not what a tidier
// model would like it to say.

import { describe, expect, it } from 'vitest';
import type { WclEvent } from '~/lib/events';

import { readRaidBuffs } from '../raidBuffs';

const T0 = 1000;
const END = T0 + 100_000;
const ME = 10;

/** Horn of Winter, the +10% attack power row's commonest source. */
const HOW = 57330;
/** Trueshot Aura, the same effect from a second class — the multi-provider case. */
const TRUESHOT = 19506;
/** Legacy of the White Tiger: +5% crit, and the one a Monk supplies themselves. */
const LOTWT = 116781;
/** Moonkin Aura, +5% spell haste. */
const MOONKIN = 24907;

function ev(t: number, type: string, id: number, source: number): WclEvent {
	return { timestamp: T0 + t, type, abilityGameID: id, sourceID: source, targetID: ME };
}

/** A `combatantinfo` addressed to the player as its source, the way the real one arrives. */
function pull(auras: Array<{ ability: number; source: number }>): WclEvent {
	return { timestamp: T0, type: 'combatantinfo', sourceID: ME, auras };
}

const rowOf = (events: WclEvent[], key: string) => readRaidBuffs(events, ME, T0, END).rows.find((r) => r.key === key)!;

describe('readRaidBuffs', () => {
	it('reports an effect the log says nothing about as not reported, never as 0%', () => {
		const row = rowOf([], 'attackPower');
		expect(row.notReported).toBe(true);
		expect(row.uptimePct).toBe(0);
		expect(row.gaps).toEqual([]);
	});

	it('groups every provider of one effect into a single row', () => {
		const summary = readRaidBuffs([], ME, T0, END);
		expect(summary.rows.map((r) => r.key)).toEqual([
			'stats',
			'attackPower',
			'meleeHaste',
			'spellHaste',
			'crit',
			'mastery',
		]);
	});

	/**
	 * The case that makes the whole section possible. A buff applied before the pull emits no
	 * `applybuff` at all, so without the pull snapshot it reads as never applied.
	 */
	it('credits a buff the pull snapshot names even when it logs no events', () => {
		const row = rowOf([pull([{ ability: HOW, source: 4 }])], 'attackPower');
		expect(row.notReported).toBe(false);
		expect(row.fromPull).toBe(true);
		expect(row.uptimePct).toBe(100);
		expect(row.providers).toEqual(['Horn of Winter']);
	});

	/**
	 * The second, independent proof that a buff predates the pull — needed because the snapshot is
	 * demonstrably incomplete. An aura cannot be removed unless it was up, so a bare removal at 40s
	 * means it covered the first 40 seconds.
	 */
	it('reads a bare removal as a buff that was up from the pull', () => {
		const row = rowOf([ev(40_000, 'removebuff', HOW, 4)], 'attackPower');
		expect(row.fromPull).toBe(true);
		expect(row.uptimeMs).toBe(40_000);
		expect(row.gaps).toEqual([{ at: 40_000, seconds: 60 }]);
	});

	it('reads a bare refresh the same way', () => {
		const row = rowOf([ev(30_000, 'refreshbuff', HOW, 4)], 'attackPower');
		expect(row.fromPull).toBe(true);
		expect(row.uptimePct).toBe(100);
	});

	/** A buff that genuinely went out late: the leading gap is the finding, so it must be listed. */
	it('reports the stretch before a late application as a gap', () => {
		const row = rowOf([ev(25_000, 'applybuff', HOW, 4)], 'attackPower');
		expect(row.fromPull).toBe(false);
		expect(row.gaps).toEqual([{ at: 0, seconds: 25 }]);
		expect(row.uptimeMs).toBe(75_000);
	});

	/**
	 * Two hunters, one spell id. Pairing them as a single stream lets the first removal close the
	 * window while the second aura is still running — on a real pull that reported a buff which never
	 * dropped as 69% uptime. Tracked per caster and unioned, the survivor covers the gap.
	 */
	it("does not let one caster's removal end another caster's buff", () => {
		const events = [
			pull([
				{ ability: TRUESHOT, source: 6 },
				{ ability: TRUESHOT, source: 8 },
			]),
			ev(88_000, 'removebuff', TRUESHOT, 6),
		];
		const row = rowOf(events, 'attackPower');
		expect(row.uptimePct).toBe(100);
		expect(row.gaps).toEqual([]);
	});

	/** Two different spells supplying one effect cover for each other in exactly the same way. */
	it("treats a second provider as covering the first one's gap", () => {
		const events = [ev(0, 'applybuff', HOW, 4), ev(30_000, 'removebuff', HOW, 4), ev(20_000, 'applybuff', TRUESHOT, 6)];
		const row = rowOf(events, 'attackPower');
		expect(row.uptimePct).toBe(100);
		expect(row.providers).toEqual(['Horn of Winter', 'Trueshot Aura']);
	});

	it('measures a real drop against the whole pull, intermissions included', () => {
		const events = [
			pull([{ ability: MOONKIN, source: 7 }]),
			ev(20_000, 'removebuff', MOONKIN, 7),
			ev(60_000, 'applybuff', MOONKIN, 7),
		];
		const row = rowOf(events, 'spellHaste');
		expect(row.uptimeMs).toBe(60_000);
		expect(row.uptimePct).toBe(60);
		expect(row.gaps).toEqual([{ at: 20_000, seconds: 40 }]);
	});

	it('ignores a gap too short to have cost anything', () => {
		const events = [
			pull([{ ability: HOW, source: 4 }]),
			ev(10_000, 'removebuff', HOW, 4),
			ev(10_500, 'applybuff', HOW, 4),
		];
		expect(rowOf(events, 'attackPower').gaps).toEqual([]);
	});

	/**
	 * The same buff landing on the rest of the raid is in this stream too, because the monk cast it.
	 * Those removals belong to other people and must not close this player's window.
	 */
	it('ignores the same buff landing on somebody else', () => {
		const events: WclEvent[] = [
			pull([{ ability: LOTWT, source: ME }]),
			{ timestamp: T0 + 30_000, type: 'removebuff', abilityGameID: LOTWT, sourceID: ME, targetID: 4 },
		];
		const row = rowOf(events, 'crit');
		expect(row.uptimePct).toBe(100);
		expect(row.gaps).toEqual([]);
	});

	it('flags an effect the player supplies themselves', () => {
		const row = rowOf([ev(40_000, 'applybuff', LOTWT, ME)], 'crit');
		expect(row.selfProvided).toBe(true);
		expect(row.byPlayer).toBe(true);
		expect(row.gaps).toEqual([{ at: 0, seconds: 40 }]);
		expect(readRaidBuffs([ev(40_000, 'applybuff', LOTWT, ME)], ME, T0, END).selfGaps).toBe(1);
	});

	it('does not call an effect self-provided when somebody else brought it', () => {
		const row = rowOf([pull([{ ability: MOONKIN, source: 7 }])], 'spellHaste');
		expect(row.selfProvided).toBe(false);
		expect(row.byPlayer).toBe(false);
	});

	/**
	 * Regression, and it cost a real 6.5-second gap before it was caught. The stream carries the
	 * `cast` that applies a buff as well as the `applybuff` it produces — Legacy of the Emperor logs
	 * a cast of 115921 at the player — and a cast is not an apply, so "anything that is not an apply
	 * was already running" invented an instance covering the entire pull.
	 */
	it('does not read a cast of the buff as proof the buff was already up', () => {
		const events: WclEvent[] = [
			ev(72_970, 'removebuff', 117666, ME),
			ev(79_530, 'applybuff', 117666, ME),
			ev(79_540, 'cast', 115921, ME),
		];
		expect(rowOf(events, 'stats').gaps).toEqual([{ at: 72_970, seconds: 6.6 }]);
	});

	/** Legacy of the Emperor lands under a different id than the one the simulator casts. */
	it('accepts the applied-aura id for Legacy of the Emperor as well as the cast id', () => {
		const row = rowOf([ev(50_000, 'removebuff', 117666, ME)], 'stats');
		expect(row.notReported).toBe(false);
		expect(row.providers).toEqual(['Legacy of the Emperor']);
		expect(row.uptimeMs).toBe(50_000);
	});

	/** A corpse holds no buffs, so the section has to be able to say a death explains the gaps. */
	it("counts the player's own deaths", () => {
		const events: WclEvent[] = [
			{ timestamp: T0 + 40_000, type: 'death', targetID: ME },
			{ timestamp: T0 + 50_000, type: 'death', targetID: 99 },
		];
		expect(readRaidBuffs(events, ME, T0, END).deaths).toBe(1);
	});

	it('counts the effects it could not speak to', () => {
		expect(readRaidBuffs([], ME, T0, END).notReported).toBe(6);
		expect(readRaidBuffs([pull([{ ability: HOW, source: 4 }])], ME, T0, END).notReported).toBe(5);
	});
});
