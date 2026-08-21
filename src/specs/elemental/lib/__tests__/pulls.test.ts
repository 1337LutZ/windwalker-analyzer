// Three real Elemental pulls, end to end, from raw event streams.
//
// The Windwalker's committed fixtures are pre-analysed `Analysis` objects, which means they exercise
// rendering and cannot re-derive an audit — so a refactor of the engine can be "verified" against them
// and prove nothing at all. These three are the other kind: raw `FightDataset`s, so `analyse` really
// runs and the numbers below are the audit's own output rather than a file's contents.
//
// All three are anonymous reports (`a:` codes, every player named `Player (N)`), which is the only kind
// of log that belongs in this repository.
//
// The figures are asserted rather than hashed on purpose. A hash tells you something moved; these tell
// you *what* moved, which is the difference between a five-minute and a fifty-minute diagnosis.
//
// Two of them are single-target Iron Juggernaut, and for a while they were the only two. That is how
// Chain Lightning stayed missing from the ability registry through 53 Elemental tests: neither pull
// contains a single cast of it, so no assertion here could see that every press of the spec's
// multi-target filler was being priced at zero occupied time. `cleave` is the third pull, and it exists
// because the gap was in the *shape* of the evidence rather than in any one number.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';
import { unmodelledPresses } from '~/lib/analysis/casts';
import { analyse, registry } from '../index';

/** Presses in a pull that no `Ability` claims — see `unmodelledPresses`, and `fixtureCoverage.test.ts`. */
const unpriced = (el: Analysis): number =>
	unmodelledPresses(el.casts, registry).reduce((sum, row) => sum + row.count, 0);

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

	/**
	 * The globals this report knowingly does not price, counted so that "knowingly" is checkable.
	 *
	 * Twenty-five presses, and twenty-three of them take a global in game: fifteen Chain Heals, three
	 * Healing Rains, two Healing Stream Totems, and one each of Healing Surge, Healing Tide Totem and
	 * Thunderstorm. Only the two Shamanistic Rages are genuinely off the global. Pricing the other
	 * twenty-three would have taken `gcdUtilisationPct` on this pull from 84.21% to 97.93% against the old
	 * denominator — measured, not estimated — and `EXTRA_NAMES` carries the reasoning for why it does not.
	 * Both halves of that figure have since moved: it is 94.08% here now, over the player's own contact
	 * clock rather than over WarcraftLogs' `activeTime`, with the numerator clipped to that same clock. So
	 * the old argument that "97.93% leaves no room for a pull that healed harder" no longer holds — a
	 * global spent healing while nothing was in reach is now outside both halves — and if those presses
	 * are ever priced, this note has to be re-measured rather than reasoned about from these numbers.
	 *
	 * Pinned as a count rather than left implicit because a spec that forgets a *rotational* button
	 * lands in this same number, and 25 changing to 26 is the only warning the report would give.
	 */
	it('counts the presses it declines to price, on the pull that has the most of them', () => {
		expect(unpriced(el)).toBe(25);
	});

	/** The intermission, off the player's own contact clock rather than from the boss's health. */
	it('finds the submerge as two contact segments', () => {
		expect(el.timeline?.contactSegments).toEqual([
			[1012, 142_282],
			[192_534, 257_821],
		]);
	});

	/**
	 * **98.20, and it was 88.62 — the figure moved because the clock did, on purpose.**
	 *
	 * The share used to divide the dot on the primary target by `engagedMs`, the **boss's** clock: the
	 * stretches the primary was there to be hit, 239 246ms here. It now divides by `contact`, the
	 * **player's** clock — the stretches they landed a modelled ability on something — which on this pull
	 * is the 206 557ms the two segments above add up to. The chart under the tile was already shading
	 * from `contact`, so the picture and the percentage were fractions of two different fights.
	 *
	 * The 32.7s between the two clocks is the whole of the move, and it is not an untargetable boss: the
	 * fixture's prose calls 142.3–192.5s "the boss submerges", and `engaged` staying open across it is
	 * proof damage was landing on the primary throughout — from the pets and from unmodelled procs, both
	 * of which `contact` filters out. So what `contact` forgives is the player's own absence from the
	 * rotation, which is the right thing to forgive in a metric about a button they press.
	 *
	 * **The numerator moved with it and had to.** Clipped to `engaged` it is 212 026ms, which is *more*
	 * than contact's 206 557ms — divide one by the other and `uptimePct` clamps to 100 and warns, which
	 * is the exact defect that produced a 100.21% tile. It is now 202 842ms: the dot on whichever spawn
	 * the player was demonstrably hitting, each landed hit owning the time until the next, intersected
	 * with `contact`. The remaining 3 715ms is contact time with no dot on the enemy in front of them —
	 * three sub-second refresh gaps and the 529ms of the submerge the player was present for.
	 *
	 * `windows` and `uptimeMs` are untouched at five windows and 212 151ms. They are what the lane draws
	 * and what the drop ledger reads, and both are claims about the pull rather than about the share.
	 *
	 * This crosses `flameShockUptime`'s `ok` band into `good` (95/85 in `score.ts`, weight 3, the heaviest
	 * single Elemental metric). The `flameShock` *section* grade stays `ok` and the overall verdict stays
	 * `ok`, because the section is graded on the wasted-refresh share as well as on the uptime.
	 */
	it('keeps the dot up for most of the time it could', () => {
		expect(+el.flameShock.uptimePct.toFixed(2)).toBe(98.2);
		expect(el.flameShock.scoredMs).toBe(206_557);
		expect(el.flameShock.uptimeMs).toBe(212_151);
		expect(el.flameShock.windows).toHaveLength(5);
	});

	/**
	 * The Searing Totem's clock moved the same way, and this is the assertion that holds it.
	 *
	 * `stScoredMs` was `intersect(engaged, complementOf(feWindows))` and is now
	 * `intersect(contact, complementOf(feWindows))`: 182 999ms becomes 150 310ms, and the share goes from
	 * 65.57% to 79.83%. Same argument as Flame Shock's — `SearingTotemUptime.tsx` builds its "down" band
	 * from `intersect(contactSegments, slotFree)` and its own comment claims "the section's denominator
	 * drops the same stretch", which was not true while the denominator was the boss's clock.
	 *
	 * **This pull is where that has to be pinned, and not in `searingTotem.test.ts`.** Every synthetic
	 * Searing Totem pull, and both `firePrepull` pulls, are single-enemy streams where `contact` and
	 * `engaged` are the same array — so they would have survived the switch without noticing it. `phased`
	 * is the fixture whose two clocks are 32.7s apart, so the swap is visible here or nowhere.
	 *
	 * The numerator follows the denominator without a second edit, because it is intersected with it:
	 * 120 000ms of totem here is unchanged only because none of this pull's placements reach into the
	 * 32.7s the clocks differ by. `unbroken`'s does — 78 224ms becomes 77 152ms.
	 *
	 * `searingTotemUptime` is weight 1 with bands `{ good: 85, ok: 65 }`, and no fixture crosses one:
	 * `phased` 65.57 → 79.83 (ok either side), `unbroken` 61.89 → 61.57 (bad), `cleave` 78.71 → 78.72 (ok).
	 */
	it('grades the totem against the same clock its chart shades from', () => {
		expect(el.searingTotem.scoredMs).toBe(150_310);
		expect(el.searingTotem.uptimeMs).toBe(120_000);
		expect(+el.searingTotem.uptimePct.toFixed(2)).toBe(79.84);
	});

	/**
	 * The opener, and the six milliseconds that used to lose it.
	 *
	 * This pull's Ascendance goes out at **5 006ms** and read `opener: false`, because the comparison was
	 * a bare `t <= 5000`. Nothing about the press is late — it is the first Ascendance of the pull, four
	 * or so globals in — and nothing about a log justifies deciding it on the sixth millisecond. The
	 * comparison is now `isOpener`, `t <= OPENER_MS + OPENER_GRACE_MS`, 5 250ms.
	 *
	 * **This is the only end-to-end guard on that predicate, and it was previously unguarded entirely.**
	 * `pulls.test.ts` pinned nothing about Ascendance, `ascendance.test.ts` exercises `ascendanceSync`,
	 * which is a different module with its own haste-anchored bound, and none of the three fixtures casts
	 * Elemental Mastery at all — so the second reader of the predicate has only the unit assertions in
	 * `ascendance.test.ts` behind it. Both presses are pinned rather than just the first, so a tolerance
	 * that swallowed the whole pull would fail here too.
	 */
	it('reads the opening Ascendance as the opener, six milliseconds past five seconds', () => {
		expect(el.ascendance.presses.map((p) => [p.t, p.opener])).toEqual([
			[5006, true],
			[196_197, false],
		]);
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
	 *
	 * The press at 59 530 **moved**, from `windowed` to `early`, and that is the tick-window rule
	 * arriving. It went out with 2 797ms of dot left against a tick measured at 1 748ms — the dot had
	 * one and a half ticks still to come, so the pending tick was not the last one and nothing rolled
	 * over. Under the retired 3 000ms setting it cleared by 203ms, which is the whole objection to a
	 * fixed window: 3 000ms is not a tick on any pull this fixture contains.
	 */
	it('tells the three down-states apart', () => {
		expect(el.flameShock.presses.map((p) => p.kind)).toEqual([
			'apply',
			'windowed',
			'early',
			'reapply',
			'reapply',
			'reapply',
			'windowed',
			'windowed',
		]);
		expect(el.flameShock.presses.find((p) => p.t === 193_052)?.exposedMs).toBe(518);
		// No press dropped the dot on the player's own watch, which is what `late` would say.
		expect(el.flameShock.presses.filter((p) => p.kind === 'late')).toEqual([]);
	});

	/**
	 * The tick windows the refreshes were judged against, which are the reason the verdict above moved.
	 *
	 * Three plateaus in one fight — 1 349ms, 1 748ms, 2 275ms — as Bloodlust and Elemental Mastery fell
	 * off, none of them the 3 000ms the retired setting defaulted to and none of them each other. The
	 * count backed out of the median is 13 ticks against the ten the spell declares.
	 */
	it('measures the dot’s tick window off the pull rather than taking it from a setting', () => {
		const windows = el.flameShock.presses.filter((p) => p.remainingMs !== null).map((p) => Math.round(p.tickMs));
		expect(windows).toEqual([1349, 1748, 2275, 2278]);
		expect(Math.round(el.flameShock.tickMs)).toBe(2275);
		expect(el.flameShock.ticks).toBe(13);
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

	/** Six unpriced presses here against `phased`'s 25, which is why that pull carries the reasoning. */
	it('counts the presses it declines to price', () => {
		expect(unpriced(el)).toBe(6);
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
	 * One apply and six refreshes, and the opener is still not a fault — which is the point of this
	 * fixture.
	 *
	 * The opener used to be labelled "Late refresh" and banded as a mistake on a pull with 100% uptime.
	 * There was no dot to refresh: it was the first application of the fight. That is untouched, and
	 * unconditionally so — see the note on `apply` below.
	 *
	 * Four of the six refreshes **moved**, from `windowed` to `early`, and this is the pull where the
	 * tick-window rule bites hardest. Its refreshes went out with 2 925, 2 598, 2 182, 974, 2 883 and
	 * 2 842ms of dot left, against tick windows measured at 1 724, 1 726, 2 246, 1 715, 2 255 and
	 * 1 724ms. Under the retired 3 000ms setting every one of the six cleared, because 3 000ms is wider
	 * than any tick this pull ever had; against the tick they were actually aimed at, only the third and
	 * fourth had a single tick left to roll over. A perfect keep-up with four globals spent early is a
	 * real reading of this log, and it is the reading the priority list's own rule gives.
	 */
	it('reads the opener as an application, not a late refresh', () => {
		expect(el.flameShock.presses.map((p) => p.kind)).toEqual([
			'apply',
			'early',
			'early',
			'windowed',
			'windowed',
			'early',
			'early',
		]);
		expect(el.flameShock.presses[0]?.exposedMs).toBe(0);
		expect(el.flameShock.presses.filter((p) => p.kind === 'late')).toEqual([]);
	});

	/** The same measurement on the other pull: six windows, no two the same, and 17 ticks not 10. */
	it('measures the dot’s tick window off the pull rather than taking it from a setting', () => {
		const windows = el.flameShock.presses.filter((p) => p.remainingMs !== null).map((p) => Math.round(p.tickMs));
		expect(windows).toEqual([1724, 1726, 2246, 1715, 2255, 1724]);
		expect(Math.round(el.flameShock.tickMs)).toBe(1726);
		expect(el.flameShock.ticks).toBe(17);
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

/**
 * `a:xB3kh7v9pF2AHRtq` #46 — Siegecrafter Blackfuse 25H, 263.2s, and the pull the other two are not.
 *
 * The same report as `unbroken`, a different night's boss: Crawler Mines and the Shredder mean up to
 * thirteen enemies at once and 57.3% of the contact clock reads multi-target, where both Iron Juggernaut
 * pulls read single. That is the whole reason it is here. Seventy Chain Lightnings and eleven Lava Beams
 * — 40% of every global the player spent — and neither committed fixture contained one of either, so the
 * registry could omit both and the suite stayed green.
 *
 * What it caught, and what these numbers are the record of: `abilityByCastId(421)` returned `undefined`,
 * so the shared core's GCD walk skipped the press, `buildCastTable` labelled it off-GCD, and the damage
 * table filed its damage as `passive`. Before the two abilities were declared this pull read 56.02% GCD
 * usage and 28.21 CPM, and told its reader that 30% of the damage came from no cast at all.
 */
describe('a multi-target pull', () => {
	const el = fx('cleave');

	it('is recognised as Elemental', () => {
		expect(el.isSpec).toBe(true);
		expect(el.encounter).toBe('Siegecrafter Blackfuse');
		expect(el.durationMs).toBe(263_233);
	});

	it('reads the pull the way WarcraftLogs does', () => {
		expect(Math.round(el.damage.dps)).toBe(412_584);
		expect(el.cpm.activeMs).toBe(261_572);
	});

	/**
	 * The one fixture whose events carry `classResources`, and the only one where the bars actually run.
	 *
	 * Deliberately different from its two siblings, which were fetched without `includeResources: true`
	 * and so read zero samples on every bar. Keeping them here costs ~240KB and buys the only committed
	 * Elemental pull on which the resource-reading path executes at all — 1189 mana readings about 46ms
	 * apart, against 0 on `phased` and `unbroken`.
	 *
	 * Asserted rather than assumed, because "the fixture has no resource data" and "the code found no
	 * resource data" are indistinguishable downstream: a bar with no samples renders its empty state and
	 * a test written over it passes while reading nothing. That is not hypothetical — a revert-check
	 * elsewhere in this branch came back green against a synthetic pull with no `classResources`, because
	 * the ladder it was meant to exercise never ran. So if a future trim of this fixture drops the field
	 * again, this line goes red instead of the suite quietly losing its only live resource path.
	 */
	it('carries the resource samples the other two fixtures do not', () => {
		const mana = el.resources?.['mana'];
		// Narrowed rather than cast: `ResourceBarAudit` is a union and only the pool half carries a
		// sample count, so asserting through a cast would hide a bar declared as the wrong kind.
		expect(mana?.kind).toBe('pool');
		expect(mana?.kind === 'pool' ? mana.samples : 0).toBe(1189);
		expect(mana?.kind === 'pool' ? mana.max : 0).toBe(300_000);
	});

	/** Thirteen enemies at once, and the only committed Elemental pull that reads multi-target at all. */
	it('is the multi-target pull the other two fixtures cannot be', () => {
		// Optional on the interface because the pre-analysed fixtures predate it; `analyseCore` always
		// fills it, so a missing one here is a failure and not a case to skip.
		expect(el.targets).toBeDefined();
		expect(el.targets?.detected).toBe('multi');
		expect(el.targets?.counts.max).toBe(13);
		expect(+(el.targets?.multiTargetPct ?? 0).toFixed(1)).toBe(57.3);
	});

	/**
	 * The headline the missing abilities were wrong about, and the reason this pull is pinned at all.
	 *
	 * 56.02% before, 90.81% after, on an `activePct` of 99.37 — so the old figure was claiming the player
	 * stood idle for 43% of a pull they were casting through. 204 on-GCD presses against 123 before: the
	 * 81 that were invisible are exactly the Chain Lightnings and Lava Beams.
	 *
	 * `gcdUtilisationPct` moves with `wastedGcds` as well as with occupancy — the audit found three
	 * wasted globals here — so a Flame Shock or cooldown lane that changes what counts as wasted will
	 * land on this number. That is the intended behaviour of an asserted figure: it says which.
	 *
	 * **90.81 became 86.89 when the denominator moved off `activeTime`, and on this pull the denominator
	 * is not what moved it.** Its contact clock and WarcraftLogs' `activeTime` are both 261 572ms, to the
	 * millisecond, so the entire 3.92-point drop is the numerator: the occupied globals are now a *union*
	 * of spans clipped to the contact clock rather than a sum of prices, and 9 486ms of this pull was
	 * being charged twice. 204 presses against a measured 1 124ms effective global, with the log stamping
	 * many pairs closer together than the median — most of them inside the raid's haste cooldown, where
	 * the real global is shorter than the median this pull's presses derive. A further 768ms sat outside
	 * contact. Nothing here is a re-grade: the band is `good` at 80.
	 *
	 * That also retires the headroom worry this note used to carry, which was the live question in plan
	 * step 44. The ratio is now bounded by construction rather than by luck — a union of intervals
	 * intersected with `contact` cannot cover more of the pull than `contact` does — and
	 * `lib/analysis/__tests__/gcdUtilisation.test.ts` demonstrates that by forcing the numerator far past
	 * the denominator rather than by observing that three pulls happen to land under it.
	 */
	it('prices every global the player actually spent', () => {
		expect(+el.cpm.gcdUtilisationPct.toFixed(2)).toBe(86.89);
		expect(+el.cpm.activePct.toFixed(2)).toBe(99.37);
		expect(el.cpm.onGcdCasts).toBe(204);
		expect(el.cpm.offGcdCasts).toBe(27);
		expect(+el.cpm.totalCpm.toFixed(2)).toBe(46.79);
		expect(el.cpm.wastedGcds).toBe(3);
	});

	/** The two rows that were absent from the registry, on the pull that presses them. */
	it('counts Chain Lightning and Lava Beam as presses on the global', () => {
		const row = (id: number) => el.casts.find((c) => c.id === id);
		expect(row(421)?.count).toBe(70);
		expect(row(421)?.onGcd).toBe(true);
		expect(row(421)?.gate).toBe('conditional');
		expect(row(114_074)?.count).toBe(11);
		expect(row(114_074)?.onGcd).toBe(true);
		expect(row(114_074)?.gate).toBe('conditional');
	});

	/**
	 * The second symptom of the same omission: a quarter of the damage attributed to nothing.
	 *
	 * `passive` means "no cast produced this", and it is derived from the registry rather than declared —
	 * `damage.ts` sets it from `ability === undefined`. So while Chain Lightning was unmodelled, its
	 * 15.7% and Lava Beam's 4.0% were reported as though they had arrived unbidden, alongside their two
	 * genuine overloads at 10.4% and 2.7%. Now only the overloads are, which is what a mastery readout
	 * is. 114738 stays passive on purpose: it is Lava Beam's overload, not a second half of the cast.
	 */
	it('stops attributing a quarter of the damage to no cast', () => {
		const dmg = (id: number) => el.damage.abilities.find((a) => a.id === id);
		expect(dmg(421)?.passive).toBe(false);
		expect(+(dmg(421)?.share ?? 0).toFixed(1)).toBe(15.7);
		expect(dmg(114_074)?.passive).toBe(false);
		expect(+(dmg(114_074)?.share ?? 0).toFixed(1)).toBe(4.0);
		expect(dmg(45_297)?.passive).toBe(true);
		expect(dmg(114_738)?.passive).toBe(true);
		expect(dmg(114_738)?.name).toBe('Elemental Overload (Lava Beam)');
	});

	/**
	 * The third symptom, and the one nobody was looking for: the contact clock.
	 *
	 * `analyseCore` builds it from hits that landed *as a modelled ability*, so while Chain Lightning was
	 * unmodelled this pull read as three engaged stretches with two intermissions in it — 15.1s and 17.6s
	 * where the report would have told a reader the fight took the target away. It never did: the player
	 * was cleaving mines throughout, and one unbroken segment is what the log says.
	 */
	it('reads as one unbroken stretch of contact rather than three', () => {
		expect(el.timeline?.contactSegments).toEqual([[1561, 263_133]]);
	});

	/** Eleven presses left unpriced, none of them rotational — see `EXTRA_NAMES` and `phased` above. */
	it('counts the presses it declines to price', () => {
		expect(unpriced(el)).toBe(11);
	});
});

/**
 * The two-piece proc is measured, on every committed pull.
 *
 * It was measured on none of them until the aura was repointed: `t16-2pc-proc` carried 144998, the
 * simulator's `ExposeToAPL` handle, which the game never writes — so the windows were empty, Earth
 * Shock's rule ran on three of its four conditions because `twoPiece` could not fire, the ladder's gate
 * always read false, and a timeline lane drew nothing. Both original fixtures demonstrably had the set.
 *
 * Pinned per pull rather than as "greater than zero", because the failure mode was silence: a count that
 * has to match is the only kind that notices going quiet again.
 */
describe('the T16 two-piece', () => {
	for (const [name, windows, shocks] of [
		['phased', 8, 4],
		['unbroken', 5, 8],
		['cleave', 8, 4],
	] as const) {
		it(`${name} sees the debuff and reads it as an Earth Shock condition`, () => {
			const el = fx(name);
			expect(el.timeline?.lanes?.find((l) => l.key === 't16-2pc-debuff')?.windows).toHaveLength(windows);
			expect(el.earthShock.presses.filter((p) => p.reasons.includes('twoPiece'))).toHaveLength(shocks);
		});
	}
});
