// Two real Elemental pulls, end to end, from raw event streams.
//
// The Windwalker's committed fixtures are pre-analysed `Analysis` objects, which means they exercise
// rendering and cannot re-derive an audit — so a refactor of the engine can be "verified" against them
// and prove nothing at all. These two are the other kind: raw `FightDataset`s, so `analyse` really runs
// and the numbers below are the audit's own output rather than a file's contents.
//
// Both are anonymous reports (`a:` codes, every player named `Player (N)`), which is the only kind of
// log that belongs in this repository.
//
// The figures are asserted rather than hashed on purpose. A hash tells you something moved; these tell
// you *what* moved, which is the difference between a five-minute and a fifty-minute diagnosis.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';
import { analyse } from '../index';

const fx = (name: string): Analysis & ElementalAuditResult => {
	const dataset = JSON.parse(
		readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8'),
	) as FightDataset;
	return analyse(dataset) as Analysis & ElementalAuditResult;
};

/**
 * `a:qHRAFwdGzaB6MPYC` #14 — Iron Juggernaut 25H, 258.3s, and the reason this fixture exists.
 *
 * The boss submerges from 142.3s to 192.5s, so the pull carries a real intermission and the Flame Shock
 * dot legitimately falls off across it. Any ledger that reports that as a dropped dot is wrong, and any
 * ledger that forgives it *because it is the largest gap* is right by accident — which is the bug this
 * fixture was added to catch.
 */
describe('a phased pull', () => {
	const el = fx('phased');

	it('is recognised as Elemental', () => {
		expect(el.isSpec).toBe(true);
		expect(el.encounter).toBe('Iron Juggernaut');
		expect(el.durationMs).toBe(258_304);
	});

	it('reads the pull the way WarcraftLogs does', () => {
		expect(Math.round(el.damage.dps)).toBe(300_749);
		expect(+el.cpm.totalCpm.toFixed(2)).toBe(39.88);
	});

	/** The intermission, off the player's own contact clock rather than from the boss's health. */
	it('finds the submerge as two contact segments', () => {
		expect(el.timeline?.contactSegments).toEqual([
			[1012, 142_282],
			[192_534, 257_821],
		]);
	});

	it('keeps the dot up for most of the time it could', () => {
		expect(+el.flameShock.uptimePct.toFixed(2)).toBe(88.67);
		expect(el.flameShock.windows).toHaveLength(5);
	});

	/**
	 * The whole point. Four gaps — 36ms, 888ms, 643ms and 41 914ms. The first three are refresh jitter
	 * below `DROP_MS`. The fourth is the submerge: it carries 529ms of contact against 41.4s of absence,
	 * so the player was charged 529ms, which is also below the floor. Nothing to report, and nothing
	 * reported.
	 */
	it('reports no dropped dot, because every gap was jitter or the boss being away', () => {
		expect(el.misses.filter((m) => m.kind.startsWith('Flame Shock dropped'))).toEqual([]);
	});

	/**
	 * The ceiling stretches, through the shared `atCapWindows` derivation with the reader's 1.5s grace.
	 *
	 * Pinned because the derivation was extracted out of this audit and the guard has to be able to see
	 * that it did not move: both figures were compared against the walk they replaced, on both fixtures,
	 * and came back with identical window lists.
	 */
	it('charges the shield for the time it sat at seven charges', () => {
		expect(el.lightningShield.leewayMs).toBe(1500);
		expect(el.lightningShield.overcapMs).toBe(40_441);
		expect(el.lightningShield.overcapWindows).toHaveLength(10);
	});

	/**
	 * What each Flame Shock press *was*, and the accusation that used to be here.
	 *
	 * Every press whose dot was down read `remainingMs === null`, which the section rendered as "Late
	 * refresh" and banded as a fault — so this pull showed four late refreshes. Three were sub-second
	 * jitter and one was the boss submerging; none was a mistake. The press at 193 052 is the sharpest:
	 * the dot had been down since 151 149, but the boss was away for 41.4s of that, so the player is
	 * charged the 518ms they were actually present for.
	 */
	it('tells the three down-states apart', () => {
		expect(el.flameShock.presses.map((p) => p.kind)).toEqual([
			'apply',
			'windowed',
			'windowed',
			'reapply',
			'reapply',
			'reapply',
			'windowed',
			'windowed',
		]);
		expect(el.flameShock.presses.find((p) => p.t === 193_052)?.exposedMs).toBe(518);
		// Nothing on this pull is a fault: no press dropped the dot on the player's own watch.
		expect(el.flameShock.presses.filter((p) => p.kind === 'late' || p.kind === 'early')).toEqual([]);
	});

	it('reads the shield as pre-applied and tracks it to the end', () => {
		// No `applybuff` in the log: the shield was up before the pull, so the walk infers the level it
		// must have held at t=0 rather than starting from nothing.
		expect(el.lightningShield.points[0]?.[0]).toBe(0);
		expect(el.lightningShield.fellOff).toBe(0);
		expect(el.lightningShield.badSpends).toEqual([]);
		expect(el.earthShock.presses).toHaveLength(12);
	});
});

/**
 * `a:xB3kh7v9pF2AHRtq` #16 — Iron Juggernaut 25H, 184.4s, and the opposite pull.
 *
 * One unbroken Flame Shock window for the entire fight: one apply and six refreshes, which is what
 * `openOnRefresh` exists to read. A walk that only paired applies to removes would report this pull as
 * a single 0.1s window. Two Earth Shocks were spent below the ceiling, so the bad-spend path is live
 * here and dead in the other fixture.
 */
describe('an unbroken pull', () => {
	const el = fx('unbroken');

	it('is recognised as Elemental', () => {
		expect(el.isSpec).toBe(true);
		expect(el.durationMs).toBe(184_448);
	});

	it('reads the pull the way WarcraftLogs does', () => {
		expect(Math.round(el.damage.dps)).toBe(410_752);
		expect(+el.cpm.totalCpm.toFixed(2)).toBe(46.48);
	});

	it('holds the dot for the whole pull through refreshes alone', () => {
		expect(el.flameShock.windows).toHaveLength(1);
		// Not exactly 100: the dot's single window closes at 184 399 while the engaged clock runs to
		// 184 400, so a one-millisecond sliver of the pull has no dot on it. Asserted as a bound rather
		// than a rounded 100, because rounding here would hide the difference between "held all pull" and
		// "held all but a second of it" — and the second is the interesting case.
		expect(el.flameShock.uptimePct).toBeGreaterThan(99.99);
		expect(el.flameShock.applies).toBe(1);
		expect(el.flameShock.refreshes).toBe(6);
	});

	it('charges the shield for the time it sat at seven charges', () => {
		expect(el.lightningShield.overcapMs).toBe(23_387);
		expect(el.lightningShield.overcapWindows).toHaveLength(7);
	});

	/**
	 * One apply, six keep-up refreshes, and **not one fault** — which is the point of this fixture.
	 *
	 * The opener used to be labelled "Late refresh" and banded as a mistake on a pull with 100% uptime.
	 * There was no dot to refresh: it was the first application of the fight.
	 */
	it('reads the opener as an application, not a late refresh', () => {
		expect(el.flameShock.presses.map((p) => p.kind)).toEqual([
			'apply',
			'windowed',
			'windowed',
			'windowed',
			'windowed',
			'windowed',
			'windowed',
		]);
		expect(el.flameShock.presses[0]?.exposedMs).toBe(0);
		expect(el.flameShock.presses.filter((p) => p.kind === 'late' || p.kind === 'early')).toEqual([]);
	});

	it('catches the two shocks spent below the ceiling', () => {
		expect(el.lightningShield.badSpends).toHaveLength(2);
		expect(el.earthShock.belowFull).toBe(2);
		expect(el.earthShock.presses).toHaveLength(13);
	});

	it('has nothing to forgive, so a drop here would be a real one', () => {
		expect(el.timeline?.contactSegments).toEqual([[1553, 183_328]]);
		expect(el.misses.filter((m) => m.kind.startsWith('Flame Shock dropped'))).toEqual([]);
	});
});
