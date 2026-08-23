// What the priority ladder reads on the one pull whose multi-target regime resolves — and how much of
// that reading is the pull rather than the player.
//
// `addsThenBoss` (Galakras heroic-25, 560.3s, `counts.max` 9, 73.73% multi-target) is the only committed
// fixture with a **boss-only tail**: 56.9s of single-target time after the last add. `cleave` has none —
// its last multi-target point sits at 267.1s against a 263.2s pull, so it ends *on* adds and the regime
// never resolves there. That tail is what makes this file possible, because it is a within-pull control:
// the same player, the same log, the same ladder, judged either side of the moment the adds stop.
//
// **The pull reads 408 presses / 69 followed / 339 skipped — a 16.9% follow rate, against `cleave`'s
// 48.5%.** This file is the decomposition of that number, pinned so it cannot drift unnoticed, and the
// short version is that it is a reading of the *band* rather than of the player:
//
// | window                        |   n | followed |   rate | Flame Shock skips |
// | ----------------------------- | --- | -------- | ------ | ----------------- |
// | up to the last add (503.3s)   | 369 |       45 |  12.2% |               309 |
// | the boss-only tail after it   |  39 |       24 |  61.5% |                 1 |
//
// 61.5% is the same pull's player graded at one target, and it sits between `phased`'s 67.3% and
// `unbroken`'s 68.3% — the two max-one-target fixtures — rather than anywhere near 16.9%. So the collapse
// is not a bad player: it is the ladder's reading of add-wave time, and **91.4% of every fault on this
// pull is one rung.**
//
// ## What that rung is, and why this file pins the defect instead of fixing it
//
// `flame-shock` claims 310 of the 339 skips. Its condition reads `auras.remainingMs('flame-shock')`, which
// the Elemental audit answers with `fsRemainingAt` — the dot on the spawn `spawnAt(t)` says the player was
// on. That reading is right for one enemy and arbitrary for nine: an area hit lands on every enemy at one
// stamp, and `spawnAt`'s own note settles the tie by taking the last hit in the sorted stream on the
// grounds that "it is the same dot on each of them". On this pull that is false — **40 of the 310 skips
// land while exactly two of the nine enemies carry the dot, and 235 of the 310 land while at least one
// does.** So three quarters of this pull's faults say "the dot was down" about a unit picked by a coin
// flip, while the dot was in fact ticking on something.
//
// The sim's own question is narrower still and the report cannot ask it. `aoe.apl.json` rung 1 is
// `castSpell(8050)` under `auraIsKnown(138898) AND not(dotIsActive(8050))`, and `dotIsActive` with no
// `targetUnit` resolves to `CurrentTarget` (`sim/core/apl_helpers.go:72-74`); that list carries no
// `changeTarget`, so the sim maintains exactly **one** dot on **one** fixed unit for the whole encounter
// and rung 1 fires about once per dot expiry. It is not `dotIsActiveOnAllTargets`, which the core has and
// this list declines to use.
//
// Neither reading available here reproduces that. `auras.remainingMs` is the churning spawn.
// `auras.active('flame-shock')` is no help either: `elemental/lib/index.ts` hands the ladder `fsMerged`,
// which is `dotWindowsOnTarget(..., primaryID, ...)` — the **primary's** dot and not the union — and on
// this pull the primary carries it only from 442.0s, because Galakras is on the tower for the add phase
// and cannot be dotted at all. So the honest per-press answer needs a *contact-scoped* dot reading that
// only `index.ts` can build, and the fix is reported rather than reached for: see the lane note. Silencing
// the rung from `apl.ts` instead would throw away the 75 skips where no enemy carried the dot, which are
// the real ones.
//
// ## What is asserted, and what these assertions are for
//
// **This file is a pin, not a regression guard.** Nothing in it fails against the behaviour it was written
// against — that is the point: it records the defect's size so that closing it has to move these numbers
// and say so. The two rung changes that landed with it (`unleash-elements`'s band-2 rule and the beam's
// unreachable band 2) move no verdict on any fixture, which `multiTargetRungs.test.ts` proves from the
// other side.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Analysis, FightDataset } from '~/lib/types';
import { analyse } from '~/specs/elemental/lib';
import { LADDER } from '~/specs/elemental/lib/apl';

const LAVA_BEAM = 114_074;
const STORMLASH = 120_668;
const FIRE_ELEMENTAL = 2894;

const load = (name: string): Analysis =>
	analyse(
		JSON.parse(readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8')) as FightDataset,
	) as Analysis;

const addsThenBoss = load('addsThenBoss');
const cleave = load('cleave');

interface Press {
	t: number;
	decidedAt: number;
	pressed: number;
	wanted: string | null;
	verdict: string;
}
const auditOf = (a: Analysis): { followed: number; skipped: number; unknown: number; offList: number } =>
	a.apl as unknown as { followed: number; skipped: number; unknown: number; offList: number };
const pressesOf = (a: Analysis): Press[] => ((a.apl as { presses?: Press[] } | null)?.presses ?? []) as Press[];
/**
 * The Elemental's own Flame Shock block, which `Analysis` does not declare.
 *
 * `Analysis` is the shared shape and `flameShock` is a spec field, so it is reached through a cast the
 * same way `apl.presses` and `aplForced` are above. Only the three members this file reads are named.
 */
const flameShockOf = (a: Analysis): { applies: number; windows: ReadonlyArray<{ start: number; end: number }> } =>
	(a as unknown as { flameShock: { applies: number; windows: ReadonlyArray<{ start: number; end: number }> } })
		.flameShock;

/**
 * The band a press was judged at, re-derived from the published count series.
 *
 * `AplPress` carries no band, and `analysis.targets.counts.points` is the series the ladder bands on —
 * the Elemental declares no `aplTargetCountExclude`, so `aplTargetPoints` and `targetPoints` are the same
 * array. Read at `decidedAt` and not `t`, because that is the instant `stateAt` bands.
 */
const bandOf = (n: number): 1 | 2 | 3 | 4 => (n <= 1 ? 1 : n === 2 ? 2 : n === 3 ? 3 : 4);
const banderFor = (a: Analysis): ((p: Press) => 1 | 2 | 3 | 4) => {
	const points = (a.targets?.counts?.points ?? []) as Array<[number, number]>;
	return (p) => {
		let count = 0;
		for (const [t, c] of points) {
			if (t > p.decidedAt) break;
			count = c;
		}
		return bandOf(count);
	};
};
/** The last instant the count series stands at two or more — the moment the multi-target regime ends. */
const lastMultiTargetPoint = (a: Analysis): number => {
	let last = -1;
	for (const [t, c] of (a.targets?.counts?.points ?? []) as Array<[number, number]>) if (c >= 2) last = t;
	return last;
};

describe('the pull the regime resolves on', () => {
	it('is the shape this file claims, off the fixture rather than off the prose', () => {
		// Every number below is a share of one of these, so a fixture swap has to fail here first.
		expect(Math.round((addsThenBoss.durationMs ?? 0) / 100) / 10).toBe(560.3);
		expect(addsThenBoss.targets?.counts?.max).toBe(9);
		expect(addsThenBoss.targets?.multiTargetPct).toBeCloseTo(73.73, 2);
		// The tail is the control, so its existence is asserted rather than assumed: the last add is 56.9s
		// before the end, where `cleave`'s last multi-target point is 3.8s *past* its own pull.
		expect(lastMultiTargetPoint(addsThenBoss)).toBe(503_320);
		expect((addsThenBoss.durationMs ?? 0) - lastMultiTargetPoint(addsThenBoss)).toBe(56_941);
		expect(lastMultiTargetPoint(cleave)).toBeGreaterThan(cleave.durationMs ?? 0);
	});

	it('reads 408 / 69 / 339, with nothing hiding in the other two verdicts', () => {
		const apl = auditOf(addsThenBoss);
		expect(pressesOf(addsThenBoss)).toHaveLength(408);
		expect(apl.followed).toBe(69);
		expect(apl.skipped).toBe(339);
		// **Both zero, and neither is trivially so.** `unknown` at 0 says no rule on this ladder ever failed
		// to read — which is the finding, not a reassurance: the Flame Shock rung answers confidently 408
		// times about a unit it cannot identify. `offList` at 0 is structural and is its own case below.
		expect(apl.unknown).toBe(0);
		expect(apl.offList).toBe(0);
		expect(apl.followed / pressesOf(addsThenBoss).length).toBeCloseTo(0.169, 3);
	});
});

describe('the follow rate is a reading of the band, not of the player', () => {
	/** Presses, credits and Flame Shock faults in one window, so the three always come off one filter. */
	const split = (a: Analysis, keep: (p: Press) => boolean): { n: number; followed: number; fsSkips: number } => {
		const sel = pressesOf(a).filter(keep);
		return {
			n: sel.length,
			followed: sel.filter((p) => p.verdict === 'followed').length,
			fsSkips: sel.filter((p) => p.verdict === 'skipped' && p.wanted === 'flame-shock').length,
		};
	};

	it('collapses across the add phase and recovers in the boss-only tail', () => {
		// **The within-pull control, and the single most load-bearing assertion in this file.** Same player,
		// same log, same ladder, split at the last instant two enemies were up. 12.2% against 61.5% — and the
		// tail's 24 credits are more than a third of the pull's 69 in under a tenth of its presses.
		const end = lastMultiTargetPoint(addsThenBoss);
		expect(split(addsThenBoss, (p) => p.decidedAt <= end)).toEqual({ n: 369, followed: 45, fsSkips: 309 });
		expect(split(addsThenBoss, (p) => p.decidedAt > end)).toEqual({ n: 39, followed: 24, fsSkips: 1 });
	});

	it('puts the tail beside the two single-target fixtures rather than beside its own pull', () => {
		// 61.5% is what this player grades at one target. `phased` reads 67.3% and `unbroken` 68.3% on their
		// whole pulls, and those are the reference for "a normally played single-target log". A tail that
		// landed at 16.9% would have said the player was the cause; it lands within seven points of both.
		const end = lastMultiTargetPoint(addsThenBoss);
		const tail = split(addsThenBoss, (p) => p.decidedAt > end);
		expect(tail.followed / tail.n).toBeCloseTo(0.615, 3);
		for (const name of ['phased', 'unbroken'] as const) {
			const a = load(name);
			const rate = auditOf(a).followed / pressesOf(a).length;
			expect(rate, name).toBeGreaterThan(0.6);
			expect(Math.abs(rate - tail.followed / tail.n), name).toBeLessThan(0.08);
		}
	});

	it('falls monotonically with the band on both multi-target pulls', () => {
		// The same fact per band instead of per window, and asserted on `cleave` beside it so that it reads
		// as a property of the ladder rather than of one fixture. `cleave` is the milder case for the reason
		// its own file gives — 57.25% multi-target against 73.73%, and no tail at all — and it shows the same
		// slope: 64.8% → 42.4% → 42.9% → 30.6%.
		const table = (a: Analysis): Array<{ n: number; followed: number; fsSkips: number }> => {
			const band = banderFor(a);
			return [1, 2, 3, 4].map((b) => split(a, (p) => band(p) === b));
		};
		expect(table(addsThenBoss)).toEqual([
			{ n: 90, followed: 36, fsSkips: 38 },
			{ n: 87, followed: 11, fsSkips: 65 },
			{ n: 74, followed: 11, fsSkips: 63 },
			{ n: 157, followed: 11, fsSkips: 144 },
		]);
		expect(table(cleave)).toEqual([
			{ n: 88, followed: 57, fsSkips: 11 },
			{ n: 33, followed: 14, fsSkips: 8 },
			{ n: 21, followed: 9, fsSkips: 4 },
			{ n: 62, followed: 19, fsSkips: 36 },
		]);
		// Eleven credits at each of the three multi-target bands on a pull that spends 318 of its 408 presses
		// there. That is the ceiling the Flame Shock rung leaves, not a choice the player made.
		expect(
			table(addsThenBoss)
				.slice(1)
				.map((r) => r.followed),
		).toEqual([11, 11, 11]);
	});
});

describe('one rung owns the faults', () => {
	const skipsBy = (a: Analysis): Record<string, number> => {
		const by: Record<string, number> = {};
		for (const p of pressesOf(a)) {
			if (p.verdict !== 'skipped') continue;
			by[p.wanted ?? '(none)'] = (by[p.wanted ?? '(none)'] ?? 0) + 1;
		}
		return by;
	};

	it('charges 310 of 339 against Flame Shock, and names the other 29', () => {
		// Asserted as the whole map rather than the one key, so a fault moving between rungs cannot hide.
		// The other five rungs together take 29 — fewer than a tenth of what the top rung takes — and that
		// asymmetry is the finding: this is not a ladder grading a pull, it is one condition answering.
		expect(skipsBy(addsThenBoss)).toEqual({
			'flame-shock': 310,
			'lava-burst': 8,
			'chain-lightning': 6,
			'lightning-bolt': 6,
			'searing-totem': 5,
			'earth-shock': 4,
		});
		expect(310 / 339).toBeCloseTo(0.914, 3);
	});

	it('is the same rung on cleave, at half the share, which is the comparison that dates the cause', () => {
		// 59 of 105 — 56.2% against 91.4%. The rung's share **tracks the add churn**, not the regime
		// resolving: `cleave` has 8 dot applications over 263.2s and `addsThenBoss` has 24 over 560.3s, and
		// the more spawns the player dots the more often `spawnAt` picks one that is not carrying it.
		expect(skipsBy(cleave)['flame-shock']).toBe(59);
		expect(59 / 105).toBeCloseTo(0.562, 3);
		expect(flameShockOf(addsThenBoss).applies).toBe(24);
		expect(flameShockOf(cleave).applies).toBe(8);
	});

	it('answers about a unit whose dot the primary lane cannot see, for 442 seconds', () => {
		// The evidence that the union is no substitute for the missing reading. `flameShock.windows` is the
		// primary's own dot — the array the ladder is handed as `auras['flame-shock']` — and on this pull it
		// is a single window that opens at 442.0s. Galakras is untargetable for the add phase, so
		// `not(dotIsActive(8050))` on the sim's `CurrentTarget` would be true for the whole of it too. Both
		// available readings are wrong, in the same direction, and that is why the fix is a third one.
		const windows = flameShockOf(addsThenBoss).windows;
		expect(windows).toHaveLength(1);
		expect(windows[0]!.start).toBe(442_020);
		// And the dot was demonstrably up somewhere for most of the pull, which is what makes 310 wrong
		// rather than merely unlucky: the per-enemy timeline rows cover 425.1s of the 560.3s.
		const lanes = (addsThenBoss.timeline?.lanes ?? []).filter((l) => l.key === 'flame-shock');
		expect(lanes.length).toBeGreaterThan(1);
		const all = lanes.flatMap((l) => l.windows).sort((x, y) => x.start - y.start);
		let covered = 0;
		let until = -1;
		for (const w of all) {
			covered += Math.max(0, w.end - Math.max(w.start, until));
			until = Math.max(until, w.end);
		}
		expect(Math.round(covered / 100) / 10).toBe(425.1);
	});
});

describe('what the top rung crowds out', () => {
	it('leaves every one of the 24 Lava Beams uncredited, which is the third time this rung class has done that', () => {
		// **The defect in its sharpest form.** All 24 beams fire at bands 3 and 4 — the two bands where
		// `aoe.apl.json` puts Lava Beam above Chain Lightning and where the only rung standing above it is
		// Flame Shock — and not one is graded `followed`. Every one is charged against Flame Shock. `cleave`
		// credits 4 of its 11 at the same bands with the same rung above, so this is the reading of the dot
		// crowding the beam out rather than the beam's own rule being wrong.
		const beams = pressesOf(addsThenBoss).filter((p) => p.pressed === LAVA_BEAM);
		const band = banderFor(addsThenBoss);
		expect(beams).toHaveLength(24);
		expect(beams.map(band).filter((b) => b >= 3)).toHaveLength(24);
		expect(beams.filter((p) => p.verdict === 'followed')).toHaveLength(0);
		expect(new Set(beams.map((p) => p.wanted))).toEqual(new Set(['flame-shock']));
		// The counterpart, so this cannot be read as "the rung is unreachable anywhere".
		const cleaveBeams = pressesOf(cleave).filter((p) => p.pressed === LAVA_BEAM);
		expect(cleaveBeams.filter((p) => p.verdict === 'followed')).toHaveLength(4);
	});

	it('can never return off-list, so a button the ladder excludes on purpose is graded as a fault', () => {
		// **A second, smaller defect, pinned here because this pull is where it is visible.** The engine has
		// an `off-list` verdict for "nothing on this ladder wanted the global — a cooldown, a defensive". It
		// is unreachable for this spec: `lightning-bolt` is unconditional and unbanded, so some rung always
		// claims. The consequence is that the three on-GCD buttons the ladder's own module doc *delegates*
		// elsewhere — Stormlash Totem (a raid cooldown the doc calls off-GCD, while the registry declares
		// `onGcd: true`), Fire Elemental (the cooldowns section's business) and Earth Elemental (whose rule
		// opens in end-of-fight terms) — are each graded as a priority mistake against a filler rung.
		//
		// Four presses here and nine across the four fixtures, so it is ~1% of this pull's faults and not an
		// answer to 16.9%. Pinned as the whole tally rather than a count, because the fix is a declaration
		// the ladder does not yet carry and the next reader needs to see which buttons it has to cover.
		const rungIds = new Set(LADDER.map((r) => r.id));
		const unarbitrated = pressesOf(addsThenBoss).filter((p) => !rungIds.has(p.pressed));
		expect(unarbitrated.map((p) => `${p.pressed}:${p.verdict}<-${p.wanted ?? '?'}`)).toEqual([
			`${STORMLASH}:skipped<-flame-shock`,
			`${FIRE_ELEMENTAL}:skipped<-flame-shock`,
			`${STORMLASH}:skipped<-flame-shock`,
			`${FIRE_ELEMENTAL}:skipped<-lightning-bolt`,
		]);
		// Never `off-list`, on any fixture, at any band — including the single-target two, where the same
		// three buttons are pressed and faulted just the same.
		for (const name of ['cleave', 'addsThenBoss', 'phased', 'unbroken'] as const) {
			const a = name === 'cleave' ? cleave : name === 'addsThenBoss' ? addsThenBoss : load(name);
			expect(auditOf(a).offList, name).toBe(0);
			expect(
				pressesOf(a)
					.filter((p) => !rungIds.has(p.pressed))
					.every((p) => p.verdict === 'skipped'),
				name,
			).toBe(true);
		}
	});
});
