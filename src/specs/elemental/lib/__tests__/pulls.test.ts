// Three real Elemental pulls, end to end, from raw event streams — and the cross-pull grids that have to
// cover the fourth.
//
// **There are four committed fixtures and three `describe`s here.** `addsThenBoss.json` has its own file,
// `__fixtures__/addsThenBoss.test.ts`, because what it is for is the multi-target reading rather than the
// end-to-end walk. What that split cost is the grids: every "on every committed pull" claim in this file
// was written when this file *was* the set, and the two at the bottom now go through
// `rawFixtures('elemental')` so the fourth pull cannot be outside them.
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
import { rawFixtures } from '~/lib/analysis/fixtures';
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

	/**
	 * The DPS is WarcraftLogs' own figure. **The cast rate deliberately is not, and this is the pull that
	 * shows why.**
	 *
	 * `totalCpm` used to be our press count over WarcraftLogs' `activeTime` — two clocks with no
	 * arithmetic relationship, the same defect already corrected for `gcdUtilisationPct`, Flame Shock's
	 * uptime and Searing Totem's. It survived three rounds of that fix because **a rate has no 100% to
	 * cross**, so nothing clamped and nothing looked wrong.
	 *
	 * On this pull WarcraftLogs' span charges the 32.7-second submerge as castable time — the stretch the
	 * player spent healing, 370 heal events — so the rate read **39.88** where the player's own contact
	 * clock says **46.19**. Understated by 6.31 cpm. `cleave` does not move at all (its two clocks are
	 * identical to the millisecond) and the Windwalker moves 0.03, which is the canary: that spec is
	 * almost entirely instant casts.
	 *
	 * Nothing graded moves with it. Both specs' `score.ts` read only `gcdUtilisationPct`, so `totalCpm` is
	 * a printed figure and not a metric.
	 */
	it('reads the pull the way WarcraftLogs does, except for the clock the rate is per', () => {
		expect(Math.round(el.damage.dps)).toBe(300_749);
		expect(+el.cpm.totalCpm.toFixed(2)).toBe(46.19);
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
		expect(el.lightningShield.leewayMs).toBe(5000);
		expect(el.lightningShield.overcapMs).toBe(17_568);
		expect(el.lightningShield.overcapWindows).toHaveLength(6);
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
	 * off, none of them the 3 000ms the retired setting defaulted to and none of them each other. Which is
	 * also why no count is derived from the median any more: 30s over these windows is 22, 17 and 13 ticks,
	 * so one number for the pull is a figure none of its applications had.
	 */
	it('measures the dot’s tick window off the pull rather than taking it from a setting', () => {
		const windows = el.flameShock.presses.filter((p) => p.remainingMs !== null).map((p) => Math.round(p.tickMs));
		expect(windows).toEqual([1349, 1748, 2275, 2278]);
		expect(Math.round(el.flameShock.tickMs)).toBe(2275);
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

	// 46.48 -> 46.87 for the reason `phased` carries: the rate is per minute of contact now, not per
	// minute of WarcraftLogs' presence span. A small move here because this pull's two clocks are close.
	it('reads the pull the way WarcraftLogs does, except for the clock the rate is per', () => {
		expect(Math.round(el.damage.dps)).toBe(410_752);
		expect(+el.cpm.totalCpm.toFixed(2)).toBe(46.87);
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
		expect(el.lightningShield.overcapMs).toBe(4514);
		expect(el.lightningShield.overcapWindows).toHaveLength(2);
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
	 * fourth had a single tick left to roll over.
	 *
	 * **Three of those four early presses then moved again, to `snapshot`.** The priority list refreshes
	 * early when the new application snapshots a dot more than 10% stronger per millisecond, and these
	 * three are +42.4% (28 628), +56.2% (83 852) and +32.7% (140 025) — see `flameShockSnapshot.test.ts`
	 * for the readings. So this pull is a perfect keep-up with **two** globals genuinely spent early
	 * rather than four, and the two that remain snapshotted a dot 52% and 41% *weaker*.
	 *
	 * **The press at 83 852 moved a second time, out of `windowed`,** when the rule became a count of
	 * ticks owed rather than a comparison of durations. It went out 2 182ms before its dot's *declared*
	 * expiry against a 2 246ms tick, so the duration test called it a rollover — but its application had
	 * landed 12 of the 14 ticks its 2 250.6ms period bought (13 scheduled plus the pending tick it kept
	 * as a refresh), and the log's own stream carries a tick at 83 911 and none between 81 675 and the
	 * press. Two ticks owed is one thrown away. The declared duration under-stated the dot here rather
	 * than over-stating it, because a refresh keeps its pending tick: the real expiry was 144ms *past*
	 * the 30s mark.
	 */
	it('reads the opener as an application, not a late refresh', () => {
		expect(el.flameShock.presses.map((p) => p.kind)).toEqual([
			'apply',
			'snapshot',
			'early',
			'snapshot',
			'windowed',
			'snapshot',
			'early',
		]);
		// The count each of those verdicts was made on, beside the declared remaining time that used to
		// make them. One owed is the pending tick rolling over; two is a tick clipped off.
		expect(el.flameShock.presses.map((p) => p.ticksLeft)).toEqual([null, 2, 2, 2, 1, 2, 2]);
		expect(el.flameShock.presses[0]?.exposedMs).toBe(0);
		expect(el.flameShock.presses.filter((p) => p.kind === 'late')).toEqual([]);
	});

	/** The same measurement on the other pull: six windows, spanning 1 715–2 255ms, no two the same. */
	it('measures the dot’s tick window off the pull rather than taking it from a setting', () => {
		const windows = el.flameShock.presses.filter((p) => p.remainingMs !== null).map((p) => Math.round(p.tickMs));
		expect(windows).toEqual([1724, 1726, 2246, 1715, 2255, 1724]);
		expect(Math.round(el.flameShock.tickMs)).toBe(1726);
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

	// Retitled with its siblings though nothing here moved: `activeMs` *is* still WarcraftLogs' number and
	// is deliberately kept, because the gap between it and our own clock is how we find out one of them is
	// wrong. This pull's two clocks agree to the millisecond, so it is also the control that says the new
	// denominator did not simply shift everything.
	it('reads the pull the way WarcraftLogs does, except for the clock the rate is per', () => {
		expect(Math.round(el.damage.dps)).toBe(412_584);
		expect(el.cpm.activeMs).toBe(261_572);
	});

	/**
	 * One of the two fixtures whose events carry `classResources`, and the smaller of them.
	 *
	 * **This said "the one fixture" and "the only committed Elemental pull on which the resource-reading
	 * path executes at all", and `addsThenBoss` falsifies both.** That pull carries **6 614**
	 * `classResources` occurrences against this one's 3 237, and **2 627** mana samples against 1 189 —
	 * twice the resource data, on the pull that was fetched last. Nor are the siblings two: `phased` and
	 * `unbroken` are the two that carry none, and they are the ones this pull is deliberately different
	 * from.
	 *
	 * What survives is the reason, which never needed the superlative: `phased` and `unbroken` were fetched
	 * without `includeResources: true` and read zero samples on every bar, so a resource test written over
	 * either of them passes while reading nothing. Keeping this fixture costs ~240KB and buys a live
	 * resource path — 1 189 mana readings about 46ms apart — on a pull whose other numbers are pinned line
	 * by line in this file.
	 *
	 * Asserted rather than assumed, because "the fixture has no resource data" and "the code found no
	 * resource data" are indistinguishable downstream: a bar with no samples renders its empty state and
	 * a test written over it passes while reading nothing. That is not hypothetical — a revert-check
	 * elsewhere in this branch came back green against a synthetic pull with no `classResources`, because
	 * the ladder it was meant to exercise never ran. So if a future trim of this fixture drops the field
	 * again, this line goes red instead of the suite quietly losing its only live resource path.
	 */
	it('carries the resource samples the two Iron Juggernaut fixtures do not', () => {
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
	 *
	 * **87.32 became 89.18 when this test's own title stopped being a half-truth.** "Every global the
	 * player actually spent" excluded eleven presses, because a named id resolved to no `Ability` and the
	 * GCD walk skipped what it could not look up. Five of the eleven cost this shaman a global and all
	 * five were pressed in contact — two Ghost Wolves, a Lightning Shield, a Healing Tide Totem and an
	 * Earthgrab Totem — so 1.86 points were being reported as time the player stood idle. The other six
	 * are four Totemic Projections and two Shamanistic Rages, `StartRecoveryTime` 0 in the client data
	 * and genuinely free. `unmodelledPresses` still counts all eleven and the count below is unchanged:
	 * priced is not the same as modelled, and neither is the same as graded.
	 */
	it('prices every global the player actually spent', () => {
		// 86.89 and three wasted globals until the snapshot rule cleared this pull's refresh at 29 777,
		// which put a dot 42.7% stronger per millisecond up and is the press the list asks for. Two
		// wasted globals left: the refresh at 57 499, which snapshotted 23.3% weaker, and one Searing
		// Totem pressed over a healthy one. Then 87.32 → 89.18 for the five off-rotation globals above.
		expect(+el.cpm.gcdUtilisationPct.toFixed(2)).toBe(89.18);
		expect(+el.cpm.activePct.toFixed(2)).toBe(99.37);
		expect(el.cpm.onGcdCasts).toBe(204);
		expect(el.cpm.offGcdCasts).toBe(27);
		expect(+el.cpm.totalCpm.toFixed(2)).toBe(46.79);
		expect(el.cpm.wastedGcds).toBe(2);
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
 * The two-piece proc is measured on every committed pull that has the set — and the fourth pull is how we
 * know the difference between "measured as zero" and "not there".
 *
 * **This heading read "on every committed pull".** `addsThenBoss`' shaman has no T16 two-piece: no `setID`
 * on the capture, no window of 144999 anywhere in the log, and so no `t16-2pc-debuff` lane and no
 * `twoPiece` reason on any Earth Shock. That is a fourth row in the grid below reading `0, 0`, not a pull
 * outside it — which matters because 0 windows is precisely the reading the 144998 bug produced on pulls
 * that *did* have the set, and the only thing that tells the two apart is a grid that names every pull.
 *
 * It was measured on none of them until the aura was repointed: `t16-2pc-proc` carried 144998, the
 * simulator's `ExposeToAPL` handle, which the game never writes — so the windows were empty, Earth
 * Shock's rule ran on three of its four conditions because `twoPiece` could not fire, the ladder's gate
 * always read false, and a timeline lane drew nothing. Both original fixtures demonstrably had the set.
 *
 * Pinned per pull rather than as "greater than zero", because the failure mode was silence: a count that
 * has to match is the only kind that notices going quiet again.
 *
 * `unbroken` reads seven and not eight since the rule's second branch landed. Its press at 180 744 is
 * inside a window's **last four seconds**, which is where that branch asks for the shock rather than
 * forbidding it — so the window is no longer a reason against that one press. The other seven are 9 to 26
 * seconds from their window's end and are still shocks taken too soon. See `earthShockTwoPiece.test.ts`.
 *
 * `cleave` reads three and not four since Earth Shock became band-aware (§64). The debuff windows are
 * untouched — still eight — but one of those four presses lands at **two** enemies, and
 * `cleave.apl.json` rung 13 has no two-piece clause in it: the shock is judged on six stacks and eight
 * seconds of dot there and nothing else. So the fourth press is not a `twoPiece` fault that was forgiven,
 * it is a press the two-piece branch never applied to. The window count and the reason count moving
 * apart is the assertion worth having here.
 *
 * `cleave` reads **two** and not three since the band-3 and band-4 presses stopped being judged at all.
 * `aoe.apl.json` has no Earth Shock rung, so nothing asks the shield to be spent or held at three or more
 * enemies, and one of those three `twoPiece` charges was at band 3 — a press the aoe list has no opinion
 * about, charged under the single-target branch. Its debuff windows are still eight, which is the same
 * "the reason count moves and the window count does not" reading as the paragraph above.
 */
describe('the T16 two-piece', () => {
	/**
	 * Windows drawn, `twoPiece` charges, `twoPieceEarly` charges.
	 *
	 * **The middle column is nought on every committed pull now, and that is the finding rather than a
	 * regression.** It used to read 4, 7 and 2, and every one of those was the same defect: the remaining
	 * check asked `remainingIn` against the aura's *merged* window, and `auraWindows` does not split on a
	 * refresh — so a debuff held across a phase was one window from first apply to last remove and the
	 * check answered the distance to the end of that run. `unbroken`'s is 36.1 seconds on an aura that
	 * cannot hold fourteen, so shocks taken with well under a second left were charged as though the whole
	 * window were still ahead of them. Modelled from the previous shock's charges now — `dischargeExpiry`.
	 *
	 * What is left is one soft charge each on `unbroken` and `cleave`, at 6.7s and inside the 4–8s band.
	 * `twoPiece` proper now reaches no committed pull, which is where `ascReady` has always been and is
	 * why the synthetic in `earthShockTwoPiece.test.ts` is the only cover either of them has.
	 */
	const GRID: Record<string, [number, number, number]> = {
		phased: [8, 0, 0],
		unbroken: [5, 0, 1],
		cleave: [8, 0, 1],
		// No set on this player, so all three are honest zeroes rather than a silence.
		addsThenBoss: [0, 0, 0],
	};
	// Discovered rather than listed, so a fifth fixture fails here for want of a row instead of walking
	// past the grid — the exact way `addsThenBoss` walked past it.
	for (const { name: file } of rawFixtures('elemental')) {
		const name = file.replace(/\.json$/, '');
		it(`${name} sees the debuff and reads it as an Earth Shock condition`, () => {
			const expected = GRID[name];
			expect(expected, `${name} needs a row in GRID`).toBeDefined();
			const [windows, shocks, early] = expected!;
			const el = fx(name);
			expect(el.timeline?.lanes?.find((l) => l.key === 't16-2pc-debuff')?.windows ?? []).toHaveLength(windows);
			expect(el.earthShock.presses.filter((p) => p.reasons.includes('twoPiece'))).toHaveLength(shocks);
			expect(el.earthShock.presses.filter((p) => p.reasons.includes('twoPieceEarly'))).toHaveLength(early);
		});
	}
});

/**
 * The presses this report knowingly does not price, on every committed pull rather than on three of them.
 *
 * `index.ts`' `EXTRA_NAMES` says "`pulls.test.ts` pins the count on all four fixtures" and that was true
 * of three until this grid existed. The count is the only warning a reader gets that a *rotational*
 * button has gone unmodelled — the Chain Lightning failure, invisible through 53 tests — so a pull outside
 * the grid is a pull where that warning is switched off.
 *
 * `addsThenBoss` reads **3**: two Shamanistic Rages and one Thunderstorm, the same off-rotation shape as
 * the other three and the smallest count of the four, because that shaman spent almost none of the pull
 * healing.
 */
describe('the presses left unpriced', () => {
	const GRID: Record<string, number> = { phased: 25, unbroken: 6, cleave: 11, addsThenBoss: 3 };
	for (const { name: file } of rawFixtures('elemental')) {
		const name = file.replace(/\.json$/, '');
		it(`${name} counts the presses it declines to price`, () => {
			expect(GRID[name], `${name} needs a row in GRID`).toBeDefined();
			expect(unpriced(fx(name))).toBe(GRID[name]);
		});
	}
});
