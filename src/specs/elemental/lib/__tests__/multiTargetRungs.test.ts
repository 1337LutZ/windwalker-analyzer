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

import type { Analysis, CastMark, FightDataset, ResourceCurve } from '~/lib/types';
import { aplAudit, type AplInputs } from '~/lib/spec/apl';
import { analyse } from '~/specs/elemental/lib';
import { LADDER, LADDER_ENTRIES, ROTATION } from '~/specs/elemental/lib/apl';

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
		// **5 until the five single-target rungs left bands 3 and 4.** They all sat *above* Chain
		// Lightning, and at three targets and up one of them wanted the global at almost every press, so
		// a rung that existed could still almost never be reached. Banding them to `[1, 2]` is what makes
		// this number a reading of Chain Lightning's own rule rather than of the five above it.
		const followed = presses.filter((p) => p.pressed === CHAIN_LIGHTNING && p.verdict === 'followed');
		expect(followed).toHaveLength(25);
		expect(followed.every((p) => p.wanted === 'chain-lightning')).toBe(true);
	});

	it('reaches the beam at all, which it could not while five rungs sat above it', () => {
		// **The sharpest form of the same fact, and it is the defect §64's item 3 was hiding.** All eleven
		// of `cleave`'s Lava Beams fire inside an Ascendance window and the beam has had a rung since
		// `e2f31a2` — and *none* of them was ever graded `followed`, because Lava Burst, Earth Shock and
		// Searing Totem were still in the list above it at bands 3 and 4 and one of them always wanted
		// the global first. A declared rung that no press can reach is the same defect as no rung.
		const beams = presses.filter((p) => p.pressed === LAVA_BEAM);
		expect(beams).toHaveLength(11);
		const followed = beams.filter((p) => p.verdict === 'followed');
		expect(followed).toHaveLength(4);
		expect(followed.every((p) => p.wanted === 'lava-beam')).toBe(true);
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
		// **A pin, not a guard**, and it has moved three times for three different reasons. Before the
		// rungs existed the two biggest counts were 33+10 and 17+1 across the two buttons; the rungs took
		// them to 43 and 18 — the same presses attributed the same way, because what a rung buys is not
		// fewer faults here but a reader being told *which* rung wanted the global. Banding the Flame
		// Shock rung took them to 39 and 20. Banding the five single-target rungs out of bands 3 and 4
		// takes Lava Burst's share to 6 and empties Earth Shock's and Searing Totem's entirely.
		//
		// Asserted as the **whole** map rather than two of its entries, and the two lines below it are why:
		// the map plus the two `followed` counts has to account for all 81 presses, so a fault moving to a
		// rung nobody named cannot hide in an unasserted key.
		const wanted = new Map<string, number>();
		for (const p of presses) {
			if (p.pressed !== CHAIN_LIGHTNING && p.pressed !== LAVA_BEAM) continue;
			if (p.verdict !== 'skipped') continue;
			wanted.set(p.wanted ?? '?', (wanted.get(p.wanted ?? '?') ?? 0) + 1);
		}
		expect(Object.fromEntries(wanted)).toEqual({ 'flame-shock': 39, 'lightning-bolt': 7, 'lava-burst': 6 });
		const followed = presses.filter(
			(p) => (p.pressed === CHAIN_LIGHTNING || p.pressed === LAVA_BEAM) && p.verdict === 'followed',
		);
		expect([...wanted.values()].reduce((a, b) => a + b, 0) + followed.length).toBe(70 + 11);
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

describe('the Flame Shock rung is a different rule at each band', () => {
	// `p5.apl.json` is not the only list with a Flame Shock rule, and the other two are not relaxed
	// versions of it. At two targets `cleave.apl.json` rung 9 is the whole of it —
	// `multidot(8050, maxDots: 2, maxOverlap: 2s)` — and at three or more `aoe.apl.json` rung 1 is
	// `auraIsKnown(138898) AND not(dotIsActive(8050))`. Neither carries p5's snapshot reapplies or its
	// refresh before Ascendance, so the Ascendance-prep clause is a **band-1** rule and this ladder was
	// asking for a press the sim's own list never asks for at any higher count.
	//
	// The forced walks are what makes this measurable without a `band` on `AplPress`: each one is the
	// same pull judged at one fixed count, so the four numbers below are four different code paths
	// through one condition rather than four readings of one value.
	const fsSkips = (audit: unknown): number =>
		((audit as { skippedBy?: Array<{ key: string; count: number }> } | null)?.skippedBy ?? []).find(
			(s) => s.key === 'flame-shock',
		)?.count ?? 0;
	const forced = (analysis: Analysis, band: 1 | 2 | 3 | 4): unknown =>
		(analysis as unknown as { aplForced?: Record<string, unknown> }).aplForced?.[String(band)];

	it('demands Flame Shock less often the more enemies there are, on every fixture', () => {
		// **This is the assertion that was impossible before.** The Flame Shock rung's demand used to be
		// band-invariant: `cleave` charged 67 presses against it at bands 1, 2, 3 *and* 4, `phased` 12 at
		// all four and `unbroken` 2 at all four — the reader's target-mode control provably could not move
		// a Flame Shock verdict. The p5 rule stays exactly where it was, which is why every band-1 column
		// is unchanged.
		expect([1, 2, 3, 4].map((b) => fsSkips(forced(cleave, b as 1)))).toEqual([67, 62, 54, 54]);
		expect([1, 2, 3, 4].map((b) => fsSkips(forced(phased, b as 1)))).toEqual([12, 9, 4, 4]);
		expect([1, 2, 3, 4].map((b) => fsSkips(forced(unbroken, b as 1)))).toEqual([2, 1, 1, 1]);
	});

	it('reads the two lists as one rule each, so bands 3 and 4 answer alike', () => {
		// `aoe.apl.json` is the list from three targets up and it draws no line above three, so a
		// difference between these two would mean a band gate this ladder never declared.
		for (const analysis of [cleave, phased, unbroken]) {
			expect(fsSkips(forced(analysis, 3))).toBe(fsSkips(forced(analysis, 4)));
		}
	});

	it('leaves the single-target pulls exactly where they were', () => {
		// Both are max-one-target pulls, so their natural walk *is* the band-1 walk and the change must
		// not reach them. Counted off the natural audit rather than the forced one, so this is the figure
		// a reader of those two reports actually sees.
		expect(fsSkips(phased.apl)).toBe(12);
		expect(fsSkips(unbroken.apl)).toBe(2);
	});

	it("holds Flame Shock's own share at 59 while the pull's totals move around it", () => {
		// The pull's own numbers, natural band. 81/123 before the rungs, 83/121 after the Flame Shock
		// banding — and the eight presses that stopped being charged against Flame Shock did not all
		// become `followed`: six moved to a lower rung that still wanted the global, which is the honest
		// outcome rather than an amnesty. The totals have since moved again for a reason that has nothing
		// to do with Flame Shock, which is exactly why its own 59 is asserted beside them.
		const apl = cleave.apl as { followed: number; skipped: number } | null;
		expect(apl).not.toBeNull();
		// 83/121 when this suite was written; 99/105 since the five single-target rungs left bands 3 and
		// 4. Flame Shock's own share is untouched by that — its rung is in every band — so the 59 is the
		// figure this describe block is actually about and it is asserted separately for that reason.
		expect(apl!.followed).toBe(99);
		expect(apl!.skipped).toBe(105);
		expect(fsSkips(cleave.apl)).toBe(59);
	});
});

// --------------------------------------------------------------------------------------------------
// The five rungs `aoe.apl.json` does not have — plan §64's item 3.
//
// The sim ships three Elemental presets and the third is five rungs long: `autocastOtherCooldowns`,
// Flame Shock, the potion, Lava Beam, Chain Lightning. **No Earth Shock, no Lava Burst, no Elemental
// Blast, no Searing Totem, no Unleash Elements.** Five of this ladder's nine rungs therefore stood in
// bands 3 and 4 on the report's authority rather than the sim's, and each is now `bands: [1, 2]` with
// its own citation written beside the rung.
//
// Two things this suite has to prove rather than assert, because the recurring defect in these tests is
// a declared band that changes nothing:
//
//  1. the bands **separate** — the presses charged against each rung differ between band 2 and band 3;
//  2. nothing became *unattributable*. At bands 3 and 4 Lava Beam's condition is `Ascendance active`
//     and Chain Lightning's is `not active`, so exactly one of the two claims every global — a press of
//     a banded-out button is faulted against a named rung, which is the opposite of the no-rung defect
//     the beam and Chain Lightning were added to remove.
const NARROWED = ['unleash-elements', 'lava-burst', 'elemental-blast', 'earth-shock', 'searing-totem'] as const;

describe('the rungs aoe.apl.json has no counterpart for', () => {
	it('declares all five at bands 1 and 2, and leaves the bottom rung open', () => {
		for (const key of NARROWED) {
			expect(LADDER_ENTRIES.find((e) => e.key === key)!.bands, key).toEqual([1, 2]);
		}
		// `aoe.apl.json` has no Lightning Bolt either, and it stays unbanded on purpose: Chain Lightning
		// is unconditional above one target and Lava Beam covers the Ascendance window, so the walk can
		// never reach the bottom rung at bands 3 and 4. A gate there would be a declaration that changes
		// nothing, which is the thing this file exists to refuse.
		expect(LADDER_ENTRIES.find((e) => e.key === 'lightning-bolt')!.bands).toEqual([1, 2, 3, 4]);
		// And the four rungs the aoe list *does* have are in bands 3 and 4, or the walk would fall off it.
		for (const key of ['flame-shock', 'lava-beam', 'chain-lightning'] as const) {
			expect(LADDER_ENTRIES.find((e) => e.key === key)!.bands, key).toContain(3);
		}
	});

	/**
	 * The three rungs the fixtures can actually exercise, per forced band, before → after.
	 *
	 * Counted as `wanted === key` over each forced walk, which is every press the walk says that rung
	 * claimed — `followed` and `skipped` alike — so the number is a reading of the rung's *demand* rather
	 * than of the player. The band-1 and band-2 columns are the guard: they are untouched by construction
	 * and a change in either would mean the gate leaked out of its own bands.
	 *
	 * | fixture  | rung          | b1 | b2 |      b3 |      b4 |
	 * | -------- | ------------- | -- | -- | ------- | ------- |
	 * | cleave   | earth-shock   | 13 | 25 | 13 → 0  | 13 → 0  |
	 * | cleave   | lava-burst    | 61 | 64 | 64 → 0  | 64 → 0  |
	 * | cleave   | searing-totem |  4 |  1 |  5 → 0  |  5 → 0  |
	 * | phased   | earth-shock   |  8 | 28 |  8 → 0  |  8 → 0  |
	 * | phased   | lava-burst    | 59 | 59 | 59 → 0  | 59 → 0  |
	 * | phased   | searing-totem | 12 |  5 | 13 → 0  | 13 → 0  |
	 * | unbroken | earth-shock   |  5 | 30 |  5 → 0  |  5 → 0  |
	 * | unbroken | lava-burst    | 55 | 55 | 55 → 0  | 55 → 0  |
	 * | unbroken | searing-totem | 17 | 10 | 17 → 0  | 17 → 0  |
	 *
	 * Note `phased`'s Searing Totem column ran 12, 5, **13**, 13 before: band 3 demanded the totem *more*
	 * than band 1 did, because the Flame Shock rung above it demands less there and the surplus fell one
	 * rung down. That is the shape of the defect in miniature — the report was asking a five-target pull
	 * for a single-target totem more insistently than it asked a one-target pull.
	 */
	const wantedBy = (analysis: Analysis, band: 1 | 2 | 3 | 4, key: string): number =>
		(
			(analysis as unknown as { aplForced?: Record<string, { presses?: Press[] }> }).aplForced?.[String(band)]
				?.presses ?? []
		).filter((p) => p.wanted === key).length;

	it.each([
		['cleave', 'earth-shock', () => cleave, [13, 25]],
		['cleave', 'lava-burst', () => cleave, [61, 64]],
		['cleave', 'searing-totem', () => cleave, [4, 1]],
		['phased', 'earth-shock', () => phased, [8, 28]],
		['phased', 'lava-burst', () => phased, [59, 59]],
		['phased', 'searing-totem', () => phased, [12, 5]],
		['unbroken', 'earth-shock', () => unbroken, [5, 30]],
		['unbroken', 'lava-burst', () => unbroken, [55, 55]],
		['unbroken', 'searing-totem', () => unbroken, [17, 10]],
	] as const)('%s stops demanding %s above two targets', (_name, key, get, low) => {
		const analysis = get();
		expect([1, 2, 3, 4].map((b) => wantedBy(analysis, b as 1, key))).toEqual([low[0], low[1], 0, 0]);
		// The bands genuinely separate rather than reading the same value twice: band 2 keeps a demand and
		// band 3 has none, and the two come from different branches of `judge`'s band gate.
		expect(low[1]).toBeGreaterThan(0);
	});

	it('charges the banded-out presses against a rung the aoe list really has', () => {
		// **The check that this is not the no-rung defect wearing a band.** Every press of one of the five
		// that the walk now faults must name Lava Beam or Chain Lightning — the two buttons
		// `aoe.apl.json` actually presses — and never fall through to nothing.
		const ids = new Set([73680, 51505, 117014, 8042, 3599]);
		const faulted = pressesOf(cleave).filter((p) => ids.has(p.pressed) && p.verdict === 'skipped');
		expect(faulted.length).toBeGreaterThan(0);
		expect(faulted.every((p) => p.wanted !== null)).toBe(true);
		// 25 of the five buttons' presses are faults on this pull, and 12 of them name Chain Lightning:
		// seven Lava Bursts, four Earth Shocks and one Searing Totem. The other 13 are charged against
		// Flame Shock, Lava Burst and Lightning Bolt — rungs the ladder had before any of this, reached at
		// bands where they are still in the list. Asserted as the full tally of `wanted` keys, so a fault
		// landing somewhere nobody expected cannot hide behind a filter on one key.
		expect(faulted).toHaveLength(25);
		const by = new Map<string, number>();
		for (const p of faulted) by.set(p.wanted ?? '?', (by.get(p.wanted ?? '?') ?? 0) + 1);
		expect(Object.fromEntries(by)).toEqual({
			'chain-lightning': 12,
			'flame-shock': 7,
			'lightning-bolt': 5,
			'lava-burst': 1,
		});
	});

	it('flips exactly one credited Earth Shock into a fault, and names it', () => {
		// The press at 208.4s. It was `followed` against the single-target rung; at that instant the pull
		// is at three targets or more, where `aoe.apl.json` has no Earth Shock at all, so the list wanted
		// Chain Lightning. One press, not a column of them, because Earth Shock sits below Flame Shock and
		// Lava Burst and the walk rarely reaches it — the same reason `earthShockBands.test.ts` gives.
		const shock = pressesOf(cleave).find((p) => p.pressed === 8042 && p.t === 208_430);
		expect(shock).toBeDefined();
		expect(shock!.wanted).toBe('chain-lightning');
		expect(shock!.verdict).toBe('skipped');
	});

	it('moves no Searing Totem press at all, which is the residual being bounded rather than hidden', () => {
		// **A deliberate no-change guard, labelled as one.** A rung's band is stamped at the press instant
		// and Searing Totem is a sixty-second commitment, so banding it out could in principle fault a
		// totem dropped during a brief spike whose ticks land in single-target time. All seven committed
		// Searing Totem presses are at bands 1 and 2, so none of them moved — neither verdict nor
		// `wanted`. This asserts the bound, and it is not evidence that the gate works: that is the forced
		// walk above, where the rung's demand goes 4/1/5/5 → 4/1/0/0.
		const totems = [cleave, phased, unbroken].flatMap((a) => pressesOf(a).filter((p) => p.pressed === 3599));
		expect(totems).toHaveLength(7);
		expect(totems.every((p) => p.verdict === 'skipped')).toBe(true);
		expect(totems.map((p) => p.wanted).sort()).toEqual([
			'chain-lightning',
			'lightning-bolt',
			'lightning-bolt',
			'lightning-bolt',
			'lightning-bolt',
			'lightning-bolt',
			'lightning-bolt',
		]);
	});
});

// ------------------------------------------------------------------------------------------ synthetic
//
// **Two of the five cannot be shown to separate against the fixtures, and the reason is the talent gate
// rather than the band gate.** `unleash-elements` and `elemental-blast` are `talent: true`, so each rung
// is only demanded of a player the log shows pressed the button, and no committed fixture carries a
// 73680 or a 117014 press. Both charge 0 at all four bands before this change and 0 after. Pinning that
// would be a control that provably cannot move — the exact defect the Flame Shock rung was carrying
// before `bf3e594` — so the gate is shown against a pull built for it: one press, one target count,
// four walks, and the answer has to differ between band 2 and band 3.

const press = (t: number, id: number): CastMark => ({ t, id, name: `#${id}`, onGcd: true });

/** The bars this ladder does not read. `barsRequired: false` is the spec's own setting, not a stub. */
const noBar: ResourceCurve = { max: 0, points: [] };

/**
 * The Elemental ladder's inputs, with everything it does not read left empty.
 *
 * The Flame Shock dot is pinned twenty seconds out so the top dot rung is decidably *not* wanted at any
 * band — it asks `remaining <= 3s` at band 1, `<= 2s` at band 2 and `<= 0` above, and 20s fails all
 * three. That is what keeps the rung under test the first one the walk can reach, rather than the walk
 * stopping at Flame Shock and saying nothing about either.
 */
const eleInputs = (over: Partial<AplInputs>): AplInputs => ({
	casts: [],
	energy: noBar,
	chi: noBar,
	regenPerSec: 0,
	gcdMs: 1500,
	pullMs: 300_000,
	auras: {},
	auraRemainingAt: { 'flame-shock': () => 20_000 },
	fofChannelSec: 0,
	targetsAt: () => 1,
	barsRequired: false,
	...over,
});

const wantedAt = (casts: readonly CastMark[], band: 1 | 2 | 3 | 4, index: number): string | null => {
	const audit = aplAudit(eleInputs({ casts, forceBand: band }), LADDER);
	expect(audit).not.toBeNull();
	return audit!.presses[index]!.wanted;
};

describe('the two talent rungs, on a pull built to reach them', () => {
	it('wants Unleash Elements at one and two targets and Chain Lightning above', () => {
		// 73680 pressed once so the talent gate opens, then a Lightning Bolt twenty seconds later — by
		// which point the 15s cooldown (`sim/shaman/unleash_elements.go:185`) is back and Ascendance is
		// not up, so p5's rung 0 wants the button outright. Above two targets `aoe.apl.json` has no such
		// rung, and the walk falls to the button that list does press.
		const casts = [press(0, 73680), press(20_000, 403)];
		expect([1, 2, 3, 4].map((b) => wantedAt(casts, b as 1, 1))).toEqual([
			'unleash-elements',
			'unleash-elements',
			'chain-lightning',
			'chain-lightning',
		]);
	});

	it('wants Elemental Blast at one and two targets and Chain Lightning above', () => {
		// The same shape, with two differences that matter. 73680 is *never* pressed, so the rung above
		// this one is closed by its own talent gate rather than by a band — otherwise this would be the
		// previous test again. And Lava Burst is put on cooldown five seconds before the press it sits
		// above (8s, and neither Lava Surge nor Ascendance is up to reset it), so the walk reaches
		// Elemental Blast at bands 1 and 2 instead of stopping one rung higher.
		const casts = [press(0, 117014), press(15_000, 51505), press(20_000, 403)];
		expect([1, 2, 3, 4].map((b) => wantedAt(casts, b as 1, 2))).toEqual([
			'elemental-blast',
			'elemental-blast',
			'chain-lightning',
			'chain-lightning',
		]);
	});
});
