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

	/**
	 * The DPS is WarcraftLogs'. **The cast rate is no longer**, and on this fixture that is a 0.03 cpm
	 * difference by design.
	 *
	 * `totalCpm` used to divide this engine's press count by WarcraftLogs' `activeTime` off the damage
	 * table — two clocks with no arithmetic relationship — and is now per *contact* minute, the same
	 * clock `gcdUtilisationPct` is measured against. The reasoning is in
	 * `lib/analysis/__tests__/gcdUtilisation.test.ts`, which owns it, and on the Elemental's `phased`
	 * fixture the same move is worth 6.31 cpm.
	 *
	 * It is worth 0.03 here, and **this fixture is the canary for the change rather than a result of it**:
	 * a Windwalker's bar is entirely instant presses and this pull's two clocks are 117ms apart
	 * (189 735ms against 189 618ms), so a Monk that moved by more than a few hundredths would mean the
	 * contact clock had stopped measuring contact.
	 */
	it('reads the pull the way WarcraftLogs does, except for the clock the rate is per', () => {
		// 461,334 and not 442,607: the headline is this reading's own damage over the pull now rather than
		// WarcraftLogs' table total, so it follows the analysis mode and the ability rows sum to it. The
		// difference here is the tiger, 3,129,489 of pet damage the site's entry for this pull leaves out,
		// plus the half-percent residue named on `eventTotal`. See `dps` in `analyseCore`.
		expect(Math.round(a.damage.dps)).toBe(461_334);
		// The rows add up to the headline, which is the property the old number did not have.
		expect(a.damage.abilities.reduce((sum, ability) => sum + ability.total, 0)).toBe(a.damage.eventTotal);
		expect(Math.round(a.damage.eventTotal / (a.durationMs / 1000))).toBe(Math.round(a.damage.dps));
		expect(+a.cpm.totalCpm.toFixed(2)).toBe(52.84);
		// What it read before, off WarcraftLogs' span, and the whole of the movement.
		expect(+(a.cpm.onGcdCasts / (a.cpm.activeMs / 60_000)).toFixed(2)).toBe(52.81);
	});

	/**
	 * The measured effective GCD, not the flat 1.0s — step 1 of the multi-spec plan.
	 *
	 * **`gcdUtilisationPct` was 89.61 and is now 88.55, and the whole of the difference is a correction
	 * to the numerator rather than to the clock.** The figure moved because shared code did: it used to
	 * divide occupied time rebuilt from cast events by WarcraftLogs' `activeTime` off the damage table,
	 * and it now divides the same occupancy — clipped to the player's own contact clock — by that clock.
	 * See `lib/analysis/__tests__/gcdUtilisation.test.ts`, which owns the reasoning.
	 *
	 * That change was made for the Elemental and it is worth saying exactly why it moves a Monk, because
	 * the obvious explanation is the wrong one. Contact excludes pet damage and unmodelled procs — Xuen
	 * and the trinkets, for this spec — so the expectation is a narrower denominator. Measured, it is
	 * not: `activeTime` is 189 735ms and the contact clock is 189 618ms, 117ms apart, worth 0.06 of a
	 * point. The Monk is in contact essentially the whole pull.
	 *
	 * The 1.06 points come from the numerator, in two parts, and both are time this pull was charged for
	 * twice or charged for at all:
	 *
	 *   - **1 121ms of overlap.** 167 on-GCD presses, each priced at a 1.0s global, and the log stamps
	 *     some pairs closer together than that. Summing the prices charges 2 000ms of occupancy for
	 *     1 900ms of wall clock; a union of the same spans charges it once.
	 *   - **1 000ms outside contact** — exactly one global, the last press of the pull, whose global runs
	 *     past the last hit the contact clock ends at. Crediting it credits time the denominator does not
	 *     contain, which is the same one-global-wide defect the Elemental's Flame Shock tile hit at 125ms.
	 *
	 * So 88.55 counted every millisecond of the pull at most once and only where the player had something
	 * to hit. What it did not count was two of them.
	 *
	 * **89.60 since a named press could state what it costs, and this pull is the plainest case there
	 * is.** The monk opens with Legacy of the White Tiger and Legacy of the Emperor, both inside contact,
	 * both a full 1 000ms Monk global (`SpellCooldowns.StartRecoveryTime` for 116781 and 115921, joined
	 * on `SpellID` in the simulator's `wowsims.db`) — and both occupied *nothing*, because neither is an
	 * `Ability` and the GCD walk skipped what the registry could not answer for. Two seconds of a
	 * 189.6-second contact clock is 1.05 points, and that is the entire move: `gcdSlots` is unchanged at
	 * 189, `effectiveGcd` is unchanged at 1 000, and the denominator did not move at all.
	 *
	 * The pull's other unmodelled presses stay free and stay free on evidence: two Rolls, which read
	 * `StartRecoveryTime` 0, and 197 melee swings, which WarcraftLogs writes as `cast` events under id 1
	 * and which have no button behind them. Both are declared `0` in the Windwalker's `EXTRA_GLOBALS`
	 * rather than left to a default — the melee entry especially, since a wrong answer there would price
	 * a Windwalker's autoattacks as 197 globals.
	 *
	 * The band is unmoved through both changes — `gcdUtilisation` is `good` at 85 — so nothing about this
	 * pull's grade changes.
	 */
	it('prices the globals off the log rather than off the spec constant', () => {
		expect(a.cpm.gcdSlots).toBe(189);
		expect(+a.cpm.gcdUtilisationPct.toFixed(2)).toBe(89.6);
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
		// Four, and the fourth is the Touch of Karma below. It was three before that rule existed.
		expect(a.misses).toHaveLength(4);
	});

	/**
	 * The Touch of Karma placement rule, on the pull that demonstrates it.
	 *
	 * Two presses, and the first goes out at 28.99s inside a brew that ran 14.871s to 29.875s, with
	 * 0.885s of it left, so the global it took landed almost entirely inside the amplified window. That
	 * is the whole fault: the button is on a ninety-second cooldown and the brew on fifteen seconds, so
	 * the press had somewhere else to be. The second press, at 119.0s, sits in the gap between two
	 * brews and is exactly what the rule asks for.
	 *
	 * Asserted here rather than only in `karma.test.ts` because that file works over pre-analysed
	 * captures, and none of the six carries this field. A rule pinned only against built objects is a
	 * rule pinned against its own construction. This runs `analyse()`.
	 */
	it('finds the one Touch of Karma that went out inside a brew', () => {
		expect(a.karma.casts).toBe(2);
		expect(a.karma.duringBrew).toBe(1);
		expect(a.karma.uses.map((use) => [use.t, use.duringBrew])).toEqual([
			[28_990, true],
			[119_004, false],
		]);
		// The brew it landed in, and how little of it was left: the figure the ledger prints.
		expect(a.brew.windows[0]).toMatchObject({ start: 14_871, end: 29_875 });
		expect(a.misses.filter((miss) => miss.kind === 'Touch of Karma inside a brew')).toEqual([
			{
				kind: 'Touch of Karma inside a brew',
				at: 28_990,
				detail: 'pressed with 0.9s of a Tigereye Brew left to run',
				link: expect.any(String) as unknown as string,
			},
		]);
	});
});
