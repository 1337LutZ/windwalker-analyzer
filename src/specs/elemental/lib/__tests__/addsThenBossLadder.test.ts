// What the priority ladder reads on the one pull whose multi-target regime resolves — and how much of
// that reading is the pull rather than the player.
//
// `addsThenBoss` (Galakras heroic-25, 560.3s, `counts.max` 9, 73.73% multi-target) is the only committed
// fixture with a **boss-only tail**: 56.9s of single-target time after the last add. `cleave` has none —
// its last multi-target point sits at 267.1s against a 263.2s pull, so it ends *on* adds and the regime
// never resolves there. That tail is what makes this file possible, because it is a within-pull control:
// the same player, the same log, the same ladder, judged either side of the moment the adds stop.
//
// ## The defect this file was written to pin, and which is now closed
//
// The pull first read **408 presses / 69 followed / 339 skipped — a 16.9% follow rate, against `cleave`'s
// 48.5%** — and 91.4% of every fault on it was one rung. That rung was `flame-shock`, whose condition
// reads `auras.remainingMs('flame-shock')`, which the Elemental audit answers with `fsRemainingAt`. That
// closure looked the spawn `spawnAt(t)` names up in `fsDot.byInstance` — a map built by
// `dotWindowsOnTarget(..., primaryID, ...)` and therefore **keyed only by spawns of the primary enemy.**
// Through the add waves `spawnAt(t)` returns an *add's* key, the lookup misses, and `remainingIn(t, [])`
// answers **0** — a fabricated zero indistinguishable from "this add had no dot".
//
// The sharpest proof of that is `flameShock.windows` below: on this pull the primary's dot is a single
// window opening at **442.0s**, because Galakras is on the tower for the whole add phase and cannot be
// dotted at all. So for the first 442 of 560 seconds — 318 of the 408 presses — a primary-keyed lookup
// had no window to find and could only ever answer zero, whatever the player did. It credited 24 of those
// 318 presses. It now credits 92.
//
// The fix is one identifier: `fsDotAnywhere`, the every-spawn map declared sixty lines above
// `fsRemainingAt` and already used by the graded uptime numerator, on an argument that block spells out
// in its own words — "Over every spawn, not `fsDot.byInstance`, and the difference is 47 seconds." The
// same defect and the same fix sat in `downBefore` beside it, feeding the Flame Shock section's press
// `kind`; that half moves no ladder verdict at all, and six of this pull's `apply` presses become
// `reapply` plus one `late`.
//
// It moves **166 verdicts here and 1 on `cleave`**, and **nothing** on `phased` or `unbroken` — neither
// ever exceeds one enemy, so the two maps are the same map there. No graded clock moves either:
// `flameShock.uptimePct` (73.68%), `contactUptimeMs` (240 421) and `flameShockWaste` (80% of 5) are
// unchanged, because they were already built off `fsDotAnywhere`. One graded figure does move —
// `earthShockGood` on this pull, 30% to 50% of the same 20 shocks — and it moves for the same reason, its
// `fsLow` reason being the other reader of `fsRemainingAt`.
//
// | window                        |   n | followed |   rate | Flame Shock skips |
// | ----------------------------- | --- | -------- | ------ | ----------------- |
// | up to the last add (503.3s)   | 369 |      116 |  31.4% |               149 |
// | the boss-only tail after it   |  39 |       24 |  61.5% |                 1 |
//
// ## The second, smaller defect this file pinned, and which is now also closed
//
// `off-list` — the engine's verdict for "nothing on this list wanted the global" — was **0 on every
// fixture at every band**, and that zero was structural rather than a finding: `lightning-bolt` is the
// bottom rung, unconditional and unbanded, so the walk always stopped somewhere. The three on-GCD buttons
// the ladder's own module doc *delegates* elsewhere — Stormlash Totem, Fire Elemental, Earth Elemental —
// were therefore each charged to whichever filler rung the band left standing: **9 presses across the four
// fixtures**, 4 of them here.
//
// The fix is a declaration the walk can read (`UNARBITRATED` in `../apl.ts`, through
// `AplInputs.unarbitrated`), and what it moves is bounded: 4 / 1 / 2 / 2 presses out of `skipped` and into
// `offList`, `followed` unchanged on all four pulls, no graded metric touched. `flame-shock`'s own share
// falls 152 → 150 here and 12 → 11 on `phased`, `lava-burst` 20 → 19 and `lightning-bolt` 6 → 5. **It is
// not an amnesty**: an on-GCD button with no rung and no declaration is still a fault, which is what the
// second half of that block asserts and what Magma Totem still is.
//
// ## What is left, which is the player
//
// The tail does not move by a single verdict — 24 of 39 either side of the fix — so every one of the 166
// is add-phase time, which is exactly where the missing map was. And the add phase still grades **31.4%**
// against the same player's **61.5%** in the same pull's own boss-only tail, so about half the original
// gap was the defect and about half is real play. The largest single residual claim is **Searing Totem,
// which this player laid zero times in 560 seconds** — 0ms of uptime over a 226.9s gradable clock, and 34
// skips charged to that rung where the Flame Shock reading used to swallow 29 of them. That is a nameable
// fault, not an artefact, and this file stops there rather than chasing the rest.
//
// ## What is asserted, and what these assertions are for
//
// **This file was a pin and is now a guard.** Every assertion below either fails against the
// primary-scoped reading or is labelled on its own line as a control that must *not* move — the tail, and
// the two single-target fixtures. Where a number can be re-derived it is: the credit share over the
// stretch the boss could not carry a dot, the Flame Shock rung's share of faults measured against
// `cleave`'s, and the share of Flame Shock faults charged at an instant some enemy demonstrably carried
// the dot, which comes off the per-enemy timeline lanes rather than off the verdicts.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Analysis, FightDataset } from '~/lib/types';
import { aplAudit, type AplInputs } from '~/lib/spec/apl';
import { analyse } from '~/specs/elemental/lib';
import { LADDER, UNARBITRATED } from '~/specs/elemental/lib/apl';

const LAVA_BEAM = 114_074;
const STORMLASH = 120_668;
const FIRE_ELEMENTAL = 2894;
const EARTH_ELEMENTAL = 2062;
const SEARING_TOTEM = 3599;
/** The one on-GCD Elemental button that has no rung and is *not* delegated — see `UNARBITRATED`. */
const MAGMA_TOTEM = 8190;

const load = (name: string): Analysis =>
	analyse(
		JSON.parse(readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8')) as FightDataset,
	) as Analysis;

const addsThenBoss = load('addsThenBoss');
const cleave = load('cleave');

/** The four committed Elemental pulls, and one analysis each — these fixtures are slow to parse. */
const FIXTURES = ['addsThenBoss', 'cleave', 'phased', 'unbroken'] as const;
const loaded = new Map<string, Analysis>([
	['addsThenBoss', addsThenBoss],
	['cleave', cleave],
]);
const fixture = (name: (typeof FIXTURES)[number]): Analysis => {
	const known = loaded.get(name);
	if (known !== undefined) return known;
	const a = load(name);
	loaded.set(name, a);
	return a;
};

interface Press {
	t: number;
	decidedAt: number;
	pressed: number;
	wanted: string | null;
	/** Read here for one thing only: which of the two kinds of `off-list` a press is. See that block below. */
	reason?: string | null;
	verdict: string;
}
const auditOf = (a: Analysis): { followed: number; skipped: number; unknown: number; offList: number } =>
	a.apl as unknown as { followed: number; skipped: number; unknown: number; offList: number };
const pressesOf = (a: Analysis): Press[] => ((a.apl as { presses?: Press[] } | null)?.presses ?? []) as Press[];
/**
 * The same two accessors against a forced-band walk, which `Analysis` does not declare either.
 *
 * `aplForced` is the reader's target-mode counterfactual: the same pull judged at one fixed count. It is
 * how a claim about a *band* gate is separated from a claim about a press, and how the block below shows
 * a verdict does **not** move with the band.
 */
type Audit = { followed: number; skipped: number; unknown: number; offList: number; presses?: Press[] };
const forcedAuditOf = (a: Analysis, band: 1 | 2 | 3 | 4): Audit =>
	((a as unknown as { aplForced?: Record<string, Audit> }).aplForced?.[String(band)] ?? {
		followed: 0,
		skipped: 0,
		unknown: 0,
		offList: 0,
	}) as Audit;
const forcedPressesOf = (a: Analysis, band: 1 | 2 | 3 | 4): Press[] => forcedAuditOf(a, band).presses ?? [];

/**
 * One synthetic press, walked straight down `LADDER` — the only way to ask about a button no committed
 * log contains.
 *
 * Everything the real audit supplies is empty or constant here, and it costs nothing: this ladder reads
 * no resource bar at all, which is what `barsRequired: false` says, so the two curves are formalities.
 * The point of the helper is that its two call sites differ **only** by `unarbitrated` — an assertion
 * whose two sides came off the same value would prove nothing, and this way each side is a separate walk.
 */
const walkOnePress = (id: number, unarbitrated?: AplInputs['unarbitrated']): Press | null => {
	const empty = { max: 0, points: [] as Array<[number, number]> };
	const audit = aplAudit(
		{
			casts: [{ t: 10_000, id, name: 'probe', onGcd: true }],
			energy: empty,
			chi: empty,
			regenPerSec: 0,
			gcdMs: 1500,
			pullMs: 300_000,
			auras: {},
			fofChannelSec: 0,
			targetsAt: () => 1,
			barsRequired: false,
			...(unarbitrated === undefined ? {} : { unarbitrated }),
		},
		LADDER,
	);
	return (audit?.presses[0] ?? null) as Press | null;
};
/**
 * The Elemental's own Flame Shock block, which `Analysis` does not declare.
 *
 * `Analysis` is the shared shape and `flameShock` is a spec field, so it is reached through a cast the
 * same way `apl.presses` and `aplForced` are above. Only the two members this file reads are named.
 */
const flameShockOf = (a: Analysis): { applies: number; windows: ReadonlyArray<{ start: number; end: number }> } =>
	(a as unknown as { flameShock: { applies: number; windows: ReadonlyArray<{ start: number; end: number }> } })
		.flameShock;
/** The same cast for the totem block, whose two clocks are the residual claim this file ends on. */
const searingTotemOf = (a: Analysis): { uptimeMs: number; scoredMs: number } =>
	(a as unknown as { searingTotem: { uptimeMs: number; scoredMs: number } }).searingTotem;

/** How many faults each rung claimed on a pull — the whole map, so a fault moving cannot hide. */
const skipsBy = (a: Analysis): Record<string, number> => {
	const by: Record<string, number> = {};
	for (const p of pressesOf(a)) {
		if (p.verdict !== 'skipped') continue;
		by[p.wanted ?? '(none)'] = (by[p.wanted ?? '(none)'] ?? 0) + 1;
	}
	return by;
};
/** The largest share of one pull's faults any single rung claims. */
const topRungShare = (a: Analysis): number => Math.max(...Object.values(skipsBy(a))) / Math.max(1, auditOf(a).skipped);

/** Presses, credits and Flame Shock faults in one window, so the three always come off one filter. */
const split = (a: Analysis, keep: (p: Press) => boolean): { n: number; followed: number; fsSkips: number } => {
	const sel = pressesOf(a).filter(keep);
	return {
		n: sel.length,
		followed: sel.filter((p) => p.verdict === 'followed').length,
		fsSkips: sel.filter((p) => p.verdict === 'skipped' && p.wanted === 'flame-shock').length,
	};
};

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

	it('reads 408 / 140 / 264 / 4, with nothing hiding in the fourth verdict', () => {
		// 69 / 339 while `fsRemainingAt` read the primary-scoped dot map; 140 / 268 since it reads
		// `fsDotAnywhere`; 140 / 264 / 4 since the ladder declared the three on-GCD buttons it does not
		// arbitrate. 34.3% against `cleave`'s 49.0%, on a pull that is 73.73% multi-target.
		const apl = auditOf(addsThenBoss);
		expect(pressesOf(addsThenBoss)).toHaveLength(408);
		expect(apl.followed).toBe(140);
		expect(apl.skipped).toBe(264);
		// `unknown` at 0 says no rule on this ladder ever failed to read, and that one is still not
		// trivially so. `offList` used to be pinned at 0 beside it and that *was* trivial — it is now four,
		// and the block below is what they are.
		expect(apl.unknown).toBe(0);
		expect(apl.offList).toBe(4);
		// Every press lands in exactly one column, so a verdict moving between two of them cannot cancel.
		expect(apl.followed + apl.skipped + apl.unknown + apl.offList).toBe(408);
		expect(apl.followed / pressesOf(addsThenBoss).length).toBeCloseTo(0.343, 3);
	});
});

describe('the dot the ladder reads is the one on the enemy in front of the player', () => {
	it('credits the add phase over the 442s the boss could not carry a dot at all', () => {
		// **The assertion that proves the mechanism rather than the size.** `flameShock.windows` is the
		// primary's own dot — the array the ladder is handed as `auras['flame-shock']` — and on this pull it
		// is a single window opening at 442.0s, because Galakras is untargetable for the whole add phase.
		// So over the 318 presses decided before that instant, a lookup keyed by the *primary's* spawns had
		// no window to find and could only ever answer zero. It credited 24 of the 318; the every-spawn map
		// credits 92, and charges 140 against Flame Shock where the primary-keyed one charged 294 — 141 until
		// the Stormlash press at 33.2s stopped being one of them.
		const windows = flameShockOf(addsThenBoss).windows;
		expect(windows).toHaveLength(1);
		expect(windows[0]!.start).toBe(442_020);
		const opens = windows[0]!.start;
		expect(split(addsThenBoss, (p) => p.decidedAt < opens)).toEqual({ n: 318, followed: 92, fsSkips: 140 });
		// Better than a quarter of them, where the primary-keyed reading credited 7.5% — asserted as a share
		// as well as a count, because the count alone cannot say the reading stopped being structural.
		expect(92 / 318).toBeGreaterThan(0.25);
		// And the stretch the primary *was* dottable barely moves, which is the other half of the same
		// claim: 45 credits became 48.
		expect(split(addsThenBoss, (p) => p.decidedAt >= opens)).toEqual({ n: 90, followed: 48, fsSkips: 10 });
	});

	it('puts the Flame Shock rung back in family with cleave instead of owning nine faults in ten', () => {
		// Asserted as the whole map rather than the one key, so a fault moving between rungs cannot hide.
		// The five rungs that shared 29 faults between them now share 116, which is the finding: this was
		// one condition answering, and the rungs under it were unreachable behind it.
		expect(skipsBy(addsThenBoss)).toEqual({
			'flame-shock': 150,
			'chain-lightning': 39,
			'searing-totem': 34,
			'lava-burst': 19,
			'earth-shock': 12,
			'lightning-bolt': 5,
			'lava-beam': 5,
		});
		// **The property, not the numbers.** 91.4% against `cleave`'s 56.2% was the whole reason to suspect
		// the reading rather than the player; 56.7% against 55.8% is what two pulls under one rule look
		// like. Half a point apart, on pulls whose multi-target shares are 73.73% and 57.25%.
		expect(topRungShare(addsThenBoss)).toBeCloseTo(0.568, 3);
		expect(topRungShare(cleave)).toBeCloseTo(0.563, 3);
		expect(Math.abs(topRungShare(addsThenBoss) - topRungShare(cleave))).toBeLessThan(0.05);
		// And the same held as a ceiling across every committed pull, which is the shape of the claim: no
		// single rung may own most of a pull's faults. `phased` reads 0.240 and `unbroken` 0.395 — the two
		// pulls that never exceed one enemy — and this pull used to read 0.914.
		for (const name of ['addsThenBoss', 'cleave', 'phased', 'unbroken'] as const) {
			const a = name === 'addsThenBoss' ? addsThenBoss : name === 'cleave' ? cleave : load(name);
			expect(topRungShare(a), name).toBeLessThan(0.6);
		}
		expect(skipsBy(cleave)['flame-shock']).toBe(58);
		// The rung's share still tracks the add churn, which is what dates the cause: `cleave` puts up 8 dot
		// applications over 263.2s and this pull 24 over 560.3s.
		expect(flameShockOf(addsThenBoss).applies).toBe(24);
		expect(flameShockOf(cleave).applies).toBe(8);
	});

	it('stops charging three faults in four at an instant some enemy demonstrably carried the dot', () => {
		// Derived off the **per-enemy timeline lanes** rather than off the verdicts, so this is a second
		// source disagreeing with the first: 235 of the primary-keyed reading's 310 Flame Shock faults were
		// charged while at least one of the nine enemies was carrying the dot — 75.8%, on a pull whose lanes
		// cover 425.1s of 560.3s. It is now 88 of 150.
		//
		// **Not zero, and it should not be.** The fix is contact-scoped by design: a dot ticking on an add
		// the player is not hitting does not excuse the press, which is the split `fsRemainingAt`'s own
		// docblock draws between a graded press and anything drawn. What had to go was the *fabricated*
		// zero, and 58.7% here is what remains of the union's own reading.
		const lanes = (addsThenBoss.timeline?.lanes ?? []).filter((l) => l.key === 'flame-shock');
		expect(lanes.length).toBeGreaterThan(1);
		const all = lanes.flatMap((l) => l.windows);
		const dotUpAt = (t: number): boolean => all.some((w) => w.start <= t && t <= w.end);
		const fsSkips = pressesOf(addsThenBoss).filter((p) => p.verdict === 'skipped' && p.wanted === 'flame-shock');
		expect(fsSkips).toHaveLength(150);
		expect(fsSkips.filter((p) => dotUpAt(p.decidedAt))).toHaveLength(88);
		expect(88 / 150).toBeLessThan(0.65);
		// The lanes' own coverage, unchanged by any of this and asserted so the share above has a
		// denominator a reader can check.
		let covered = 0;
		let until = -1;
		for (const w of [...all].sort((x, y) => x.start - y.start)) {
			covered += Math.max(0, w.end - Math.max(w.start, until));
			until = Math.max(until, w.end);
		}
		expect(Math.round(covered / 100) / 10).toBe(425.1);
	});

	it('leaves the boss-only tail untouched, which is the control that must not move', () => {
		// **Not a red against the old behaviour, and deliberately so.** Every one of the 166 verdicts the
		// fix moved is add-phase time — the tail reads 24 of 39 either side of it, with the same single
		// Flame Shock fault in it — which is what says the fix reached the missing map and not the grader.
		// The tail is 56.9s of single-target play by the same player in the same pull, so a fix that moved it
		// would have been changing the answer at one enemy, where nothing was ever wrong.
		const end = lastMultiTargetPoint(addsThenBoss);
		expect(split(addsThenBoss, (p) => p.decidedAt > end)).toEqual({ n: 39, followed: 24, fsSkips: 1 });
		const tailSkips: Record<string, number> = {};
		for (const p of pressesOf(addsThenBoss)) {
			if (p.verdict !== 'skipped' || p.decidedAt <= end) continue;
			tailSkips[p.wanted ?? '(none)'] = (tailSkips[p.wanted ?? '(none)'] ?? 0) + 1;
		}
		expect(tailSkips).toEqual({
			'lava-burst': 5,
			'chain-lightning': 3,
			'earth-shock': 2,
			'lightning-bolt': 2,
			'searing-totem': 2,
			'flame-shock': 1,
		});
	});

	it('moves nothing on the two pulls that never exceed one enemy', () => {
		// **The no-change guards.** On a pull with one enemy `fsDot.byInstance` and `fsDotAnywhere` are the
		// same map, so the fix is provably a no-op — `counts.max` is asserted beside the figures rather than
		// trusted, because that identity is the whole reason these two cannot move.
		for (const [name, followed, presses] of [
			['phased', 107, 159],
			['unbroken', 97, 142],
		] as const) {
			const a = load(name);
			expect(a.targets?.counts?.max, `${name} is a single-target pull`).toBe(1);
			expect(pressesOf(a), name).toHaveLength(presses);
			expect(auditOf(a).followed, name).toBe(followed);
		}
	});
});

describe('what the ladder can reach now that one rung has stopped claiming every global', () => {
	it('credits eleven of the twenty-four Lava Beams, where it credited none', () => {
		// **The defect in its sharpest form, and the third time this rung class has been buried.** All 24
		// beams fire at bands 3 and 4 — the two bands where `aoe.apl.json` puts Lava Beam above Chain
		// Lightning and where the only rung standing above it is Flame Shock — and under the primary-keyed
		// reading not one was graded `followed`: every single one was charged against Flame Shock, on a dot
		// reading that could not see the add being hit. 11 of 24 now stand, at 45.8% against `cleave`'s 4 of
		// 11 at the same bands under the same rung above, where the two shares used to be 0% and 36.4%.
		const beams = pressesOf(addsThenBoss).filter((p) => p.pressed === LAVA_BEAM);
		const band = banderFor(addsThenBoss);
		expect(beams).toHaveLength(24);
		expect(beams.map(band).filter((b) => b >= 3)).toHaveLength(24);
		const credited = beams.filter((p) => p.verdict === 'followed');
		expect(credited).toHaveLength(11);
		expect(credited.every((p) => p.wanted === 'lava-beam')).toBe(true);
		const cleaveBeams = pressesOf(cleave).filter((p) => p.pressed === LAVA_BEAM);
		expect(cleaveBeams.filter((p) => p.verdict === 'followed')).toHaveLength(4);
		// The property behind the two counts: a declared rung no press on a nine-enemy pull can reach is the
		// same defect as no rung, and the two multi-target pulls now agree it is reachable at a like rate.
		expect(11 / 24).toBeGreaterThan(0.25);
		expect(Math.abs(11 / 24 - 4 / 11)).toBeLessThan(0.15);
	});

	it('credits presses at every band instead of eleven at each of the three multi-target ones', () => {
		// The same fact per band instead of per window, and asserted on `cleave` beside it so that it reads
		// as a property of the ladder rather than of one fixture.
		//
		// **The old table's flat 11 / 11 / 11 was the tell.** Eleven credits at each of bands 2, 3 and 4 on
		// a pull spending 318 of its 408 presses there was a ceiling, not three readings of a player, and
		// the collapse was monotone in the band because the primary-keyed miss grew likelier the more adds
		// were up. It is 21 / 33 / 45 now and no longer monotone — band 3 grades *better* than band 2 —
		// which is what a band table looks like when it is reading play.
		const table = (a: Analysis): Array<{ n: number; followed: number; fsSkips: number }> => {
			const band = banderFor(a);
			return [1, 2, 3, 4].map((b) => split(a, (p) => band(p) === b));
		};
		expect(table(addsThenBoss)).toEqual([
			{ n: 90, followed: 41, fsSkips: 6 },
			{ n: 87, followed: 21, fsSkips: 32 },
			{ n: 74, followed: 33, fsSkips: 21 },
			{ n: 157, followed: 45, fsSkips: 91 },
		]);
		expect(table(cleave)).toEqual([
			{ n: 88, followed: 57, fsSkips: 11 },
			{ n: 33, followed: 15, fsSkips: 7 },
			{ n: 21, followed: 9, fsSkips: 4 },
			{ n: 62, followed: 19, fsSkips: 36 },
		]);
		// **The property, and the red against the old reading.** Every band credits at least a fifth of its
		// presses on both multi-target pulls. Under the primary-keyed map this pull read 12.6%, 14.9% and
		// 7.0% at the three multi-target bands — rates no single-target fixture comes within 45 points of.
		for (const [name, a] of [
			['addsThenBoss', addsThenBoss],
			['cleave', cleave],
		] as const) {
			for (const row of table(a)) expect(row.followed / row.n, `${name} band row`).toBeGreaterThan(0.2);
		}
	});

	it('reads off-list for the three buttons it does not arbitrate, and names where each is judged', () => {
		// **The rung the ladder had no room for, and so charged as a mistake.** The engine has an `off-list`
		// verdict for "nothing on this list wanted the global — a cooldown, a defensive", and it was
		// unreachable for this spec: `lightning-bolt` is unconditional and unbanded, so some rung always
		// claimed. The consequence was that the three on-GCD buttons the ladder's own module doc *delegates*
		// elsewhere — Stormlash Totem (a raid cooldown the doc calls off-GCD, while the registry declares
		// `onGcd: true`), Fire Elemental (the cooldowns section's business) and Earth Elemental (whose rule
		// opens in end-of-fight terms) — were each graded as a priority mistake against a filler rung. Four
		// presses here and nine across the four fixtures.
		//
		// **The clearest sign it was an artefact is that the rung named moved with the band and nothing
		// else.** The Fire Elemental at 479.9s was a skipped `lightning-bolt` at band 1, a skipped
		// `chain-lightning` at bands 2-4 and a skipped `lava-burst` on the natural walk — three different
		// accusations about one press, on a button no list mentions at any count. `UNARBITRATED` in
		// `../apl.ts` is the declaration that ends it, and `AplInputs.unarbitrated` is the seam it reaches
		// the verdict through.
		const rungIds = new Set(LADDER.map((r) => r.id));
		const unarbitrated = pressesOf(addsThenBoss).filter((p) => !rungIds.has(p.pressed));
		expect(unarbitrated.map((p) => `${p.pressed}:${p.verdict}<-${p.reason ?? '?'}`)).toEqual([
			`${STORMLASH}:off-list<-stormlash`,
			`${FIRE_ELEMENTAL}:off-list<-fire-elemental`,
			`${STORMLASH}:off-list<-stormlash`,
			`${FIRE_ELEMENTAL}:off-list<-fire-elemental`,
		]);
		// **`wanted` is null on all four, which is the half that says the fault is gone** rather than merely
		// relabelled: there is no rung the press is still being measured against.
		expect(unarbitrated.every((p) => p.wanted === null)).toBe(true);

		// The whole tally, across all four fixtures — the nine presses, and all three buttons, so the next
		// reader can see the declaration covers the class and not just this pull.
		const tally: Record<string, number> = {};
		for (const name of FIXTURES) {
			for (const p of pressesOf(fixture(name)).filter((q) => !rungIds.has(q.pressed))) {
				tally[`${name}/${p.pressed}/${p.verdict}`] = (tally[`${name}/${p.pressed}/${p.verdict}`] ?? 0) + 1;
			}
		}
		expect(tally).toEqual({
			[`addsThenBoss/${STORMLASH}/off-list`]: 2,
			[`addsThenBoss/${FIRE_ELEMENTAL}/off-list`]: 2,
			[`cleave/${STORMLASH}/off-list`]: 1,
			[`phased/${STORMLASH}/off-list`]: 1,
			[`phased/${EARTH_ELEMENTAL}/off-list`]: 1,
			[`unbroken/${STORMLASH}/off-list`]: 1,
			[`unbroken/${EARTH_ELEMENTAL}/off-list`]: 1,
		});

		// **The property, and it is the one the old reading provably failed.** The verdict on a delegated
		// button must not depend on how many enemies were up: which section judges a button is a fact about
		// the button. The declaration is read ahead of every band gate in `judge`, so all four forced walks
		// must agree press for press — and this pull is the one that can ask, because its four off-list
		// presses land one in each band.
		const band = banderFor(addsThenBoss);
		expect(unarbitrated.map(band).sort()).toEqual([1, 2, 3, 4]);
		for (const b of [1, 2, 3, 4] as const) {
			const forced = forcedPressesOf(addsThenBoss, b).filter((p) => !rungIds.has(p.pressed));
			expect(
				forced.map((p) => `${p.pressed}:${p.verdict}<-${p.reason ?? '?'}`),
				`band ${b}`,
			).toEqual(unarbitrated.map((p) => `${p.pressed}:${p.verdict}<-${p.reason ?? '?'}`));
		}

		// And `followed` did not move on any fixture, which bounds what the declaration is allowed to do: it
		// takes presses out of `skipped` and puts them in `offList`, and it cannot manufacture credit.
		for (const [name, followed] of [
			['addsThenBoss', 140],
			['cleave', 100],
			['phased', 107],
			['unbroken', 97],
		] as const) {
			expect(auditOf(fixture(name)).followed, name).toBe(followed);
		}
	});

	it('still faults a button with no rung and no declaration, so off-list is not an amnesty', () => {
		// **What separates the two kinds of `off-list`, stated because conflating them is the way this fix
		// could go wrong.**
		//
		//  - *Delegated elsewhere*: the ladder declared it, and the press carries the section that judges it
		//    instead in `reason`. All nine presses above.
		//  - *Genuinely off this list*: the engine's own fall-through at the bottom of `judge`, `reason:
		//    null` — the list had nothing to say. **This ladder cannot reach it**, because `lightning-bolt`
		//    is unconditional and unbanded, so on this spec a null reason beside an `off-list` verdict would
		//    mean the walk had stopped working.
		//
		// So: every off-list press on every fixture must carry a reason, and a button that is on no rung and
		// in no declaration has to come back a **fault** rather than a shrug. The only Elemental button in
		// that state is Magma Totem, which appears in no committed log (`ladderCoverage.test.ts` carries the
		// argument for why it has no rung), so the question is put to `aplAudit` directly with one synthetic
		// press. Both arms below differ by the declaration alone.
		const undeclared = walkOnePress(MAGMA_TOTEM);
		expect(undeclared).toMatchObject({ pressed: MAGMA_TOTEM, verdict: 'skipped', reason: null });
		// Charged to *a* rung rather than to a named one: which rung claims a synthetic pull's single global
		// is a fact about the empty aura set it was walked against, and the property under test is that some
		// rung does — that an undeclared button is measured against the list at all.
		expect(LADDER.map((r) => r.key)).toContain(undeclared?.wanted);
		expect(walkOnePress(MAGMA_TOTEM, { [MAGMA_TOTEM]: 'somewhere' })).toMatchObject({
			pressed: MAGMA_TOTEM,
			verdict: 'off-list',
			wanted: null,
			reason: 'somewhere',
		});
		// The real declaration covers the three and not the fourth, read off the export rather than restated.
		expect(
			Object.keys(UNARBITRATED)
				.map(Number)
				.sort((a, b) => a - b),
		).toEqual([EARTH_ELEMENTAL, FIRE_ELEMENTAL, STORMLASH].sort((a, b) => a - b));
		expect(UNARBITRATED[MAGMA_TOTEM]).toBeUndefined();
		// Nothing arrived by fall-through on any fixture, at any band — so nothing was quietly forgiven.
		for (const name of FIXTURES) {
			const a = fixture(name);
			for (const audit of [auditOf(a), ...([1, 2, 3, 4] as const).map((b) => forcedAuditOf(a, b))]) {
				expect(audit.offList, name).toBeGreaterThan(0);
			}
			for (const b of [null, 1, 2, 3, 4] as const) {
				const presses = b === null ? pressesOf(a) : forcedPressesOf(a, b);
				const offList = presses.filter((p) => p.verdict === 'off-list');
				expect(
					offList.every((p) => typeof p.reason === 'string' && p.reason.length > 0),
					`${name}/${b}`,
				).toBe(true);
			}
		}
	});
});

describe('what is left of the gap is the player', () => {
	it("still grades the add phase at half the rate of the same pull's own boss-only tail", () => {
		// **The within-pull control, and the single most load-bearing assertion in this file.** Same player,
		// same log, same ladder, split at the last instant two enemies were up. It was 12.2% against 61.5%
		// and it is 31.4% against 61.5% — the tail did not move, so roughly half of the original 49-point
		// gap was the dot map and roughly half is play. That remainder is the finding this file ends on
		// rather than a number to chase: the ladder is now reading the dot the player was maintaining.
		const end = lastMultiTargetPoint(addsThenBoss);
		const add = split(addsThenBoss, (p) => p.decidedAt <= end);
		const tail = split(addsThenBoss, (p) => p.decidedAt > end);
		expect(add).toEqual({ n: 369, followed: 116, fsSkips: 149 });
		expect(add.followed / add.n).toBeCloseTo(0.314, 3);
		expect(tail.followed / tail.n).toBeCloseTo(0.615, 3);
		expect(add.followed / add.n / (tail.followed / tail.n)).toBeCloseTo(0.51, 2);
	});

	it('puts the tail beside the two single-target fixtures rather than beside its own pull', () => {
		// 61.5% is what this player grades at one target, and the two max-one-target fixtures are the
		// reference for "a normally played single-target log" — 67.3% and 68.3%, both **no-change guards**
		// for the dot map. A tail that landed at 16.9% would have said the player was the cause; it lands
		// within seven points of both, which is what said the band was.
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

	it('names Searing Totem, which this player laid zero times in 560 seconds', () => {
		// **The largest nameable residual, and the reason the remainder is not another artefact.** The totem
		// is a filler rung with a 226.9s gradable clock on this pull and the log carries not one cast of it,
		// so its 0% uptime is a fact about the player and its 34 faults are honest. Under the primary-keyed
		// dot map it took 5 — the Flame Shock reading was swallowing the other 29 — which is the shape of
		// what this fix bought: faults that are real, attributed to the rung that wanted the global.
		expect((addsThenBoss.timeline?.casts ?? []).filter((c) => c.id === SEARING_TOTEM)).toHaveLength(0);
		const totem = searingTotemOf(addsThenBoss);
		expect(totem.uptimeMs).toBe(0);
		expect(Math.round(totem.scoredMs / 100) / 10).toBe(226.9);
		expect(skipsBy(addsThenBoss)['searing-totem']).toBe(34);
		// And it is this pull's own fault rather than the ladder's: the same rung takes 1 on `cleave`, where
		// the totem was up for 88.5% of its clock.
		expect(skipsBy(cleave)['searing-totem']).toBe(1);
	});
});
