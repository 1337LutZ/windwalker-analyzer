// One real Windwalker pull, end to end, from a raw event stream.
//
// This exists because the other Windwalker fixtures cannot do this job. `__fixtures__/{strong,poor,…}.json`
// are pre-analysed `Analysis` objects, so a test that loads one and renders it exercises the components
// and never calls `windwalkerAudit` at all — which means the render hashes taken from them are invariant
// under *any* change to `lib/index.ts`. A refactor of the engine could be declared verified against them
// and have proved nothing. This fixture is a raw `FightDataset`, so `analyse` really runs.
//
// `a:6MhZgjyAknFWrYfK` #12 — Iron Juggernaut 25H, 190.3s, an anonymous report, which is the only kind of
// log that belongs in this repository.
//
// The figures are asserted rather than hashed on purpose: a hash says something moved, these say what.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { FightDataset } from '~/lib/types';
import { analyse } from '../index';

const dataset = JSON.parse(
	readFileSync(resolve(import.meta.dirname, '../../__fixtures__/dataset-ironJuggernaut.json'), 'utf8'),
) as FightDataset;

describe('a real Windwalker pull, audited from raw events', () => {
	const a = analyse(dataset);

	it('is recognised as Windwalker', () => {
		expect(a.isSpec).toBe(true);
		expect(a.encounter).toBe('Iron Juggernaut');
		expect(a.durationMs).toBe(190_309);
	});

	it('reads the pull the way WarcraftLogs does', () => {
		expect(Math.round(a.damage.dps)).toBe(442_607);
		expect(+a.cpm.totalCpm.toFixed(2)).toBe(52.81);
	});

	/** The measured effective GCD, not the flat 1.0s — step 1 of the multi-spec plan. */
	it('prices the globals off the log rather than off the spec constant', () => {
		expect(a.cpm.gcdSlots).toBe(189);
		expect(+a.cpm.gcdUtilisationPct.toFixed(2)).toBe(89.61);
	});

	it('reads the brew bank through the shared stack walker', () => {
		expect(a.brew.uses).toBe(7);
		expect(+a.brew.avgConsumed.toFixed(2)).toBe(9.29);
		expect(a.brew.wastedAtCap).toBe(0);
	});

	it('grades the Re-Origination snapshots', () => {
		expect(a.procs.procs).toBe(4);
		expect(a.procs.opportunities).toBe(4);
		expect(a.procs.snapshotted).toBe(3);
	});

	/**
	 * The debuff ledger, which now runs through the shared `auraDrops`.
	 *
	 * `intermissionSec` is 0.7 here, which is the heuristic being harmless: the largest gap on this pull
	 * is jitter-sized, so writing it off costs nothing. The Elemental's `phased` fixture is where the same
	 * heuristic would have been dangerous, and why that spec passes its contact clock in as evidence
	 * instead.
	 *
	 * **`engagedUptimePct` was 96.00 and is now 98.12, and that is a fix rather than a drift.** The
	 * coverage walk hands each landed hit the time until the next one and asks whether *that* enemy was
	 * carrying the debuff. This pull's Crawler Mines are immune to everything — all 27 hits they ever
	 * take come back `hitType: 10` — so the ten swings the monk put into six of them used to own slices
	 * of the pull that no debuff could ever have been on, and every one of those slices was charged
	 * against the player. `spawnLives` in `~/lib/analysis/targets` now keeps a unit nothing can damage
	 * out of `landedHits` entirely, so those slices go back to the boss, which did have the debuff. The
	 * denominator (`inContactMs`) is deliberately unchanged: the monk was in combat and could act, they
	 * were only aiming at something the game refused.
	 */
	it('keeps the Rising Sun Kick debuff up, with nothing to report as dropped', () => {
		expect(+a.debuff.engagedUptimePct.toFixed(2)).toBe(98.12);
		expect(a.debuff.drops).toEqual([]);
		expect(a.debuff.intermissionSec).toBe(0.7);
	});

	/**
	 * The Chi Brew charge counter, and the stretches it sat at two.
	 *
	 * Pinned because the ceiling tracking was lifted out of the charge simulation and onto the shared
	 * `atCapWindows`, which had been the fourth hand-written answer to "when was this counter full".
	 * These figures were captured before that change and are unchanged by it — the raw stretch is
	 * `[0, 2390]`, cut to the contact clock to give the `[421, 2390]` below, so `cappedMs` is 1969.
	 */
	it('reads the Chi Brew charges and the time spent at the ceiling', () => {
		expect(a.chiBrew?.casts).toBe(6);
		expect(a.chiBrew?.charges).toHaveLength(10);
		expect(a.chiBrew?.cappedWindows).toEqual([{ start: 421, end: 2390 }]);
		expect(a.chiBrew?.cappedMs).toBe(1969);
		expect(a.chiBrew?.possibleUses).toBe(6);
	});

	it('audits Tiger Palm and the cooldowns it held', () => {
		expect(a.filler.casts).toBe(12);
		expect(a.filler.wasted).toBe(0);
		expect(a.lostCasts).toHaveLength(3);
		expect(a.misses).toHaveLength(3);
	});
});
