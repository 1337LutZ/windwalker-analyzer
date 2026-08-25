import { describe, expect, it } from 'vitest';

import { auraWindows } from '~/lib/analysis/auras';
import { rawFixture } from '~/lib/analysis/fixtures';
import { readGear } from '~/lib/analysis/gear';
import { eventsOn } from '~/lib/events';
import type { Aura } from '~/lib/game/model';
import type { WclEvent } from '~/lib/types';

import {
	AP_RAID_BUFF_MULTIPLIER,
	NEAR_CAP_SHARE,
	attackPowerBuffMultiplier,
	attackPowerSamples,
	pullAuraIds,
	readVengeance,
	vengeanceAudit,
} from '../vengeance';

/**
 * An event carrying a resource block, as WarcraftLogs staples one onto casts, damage and heals.
 *
 * `resourceActor` is the *side* the bars belong to — 1 the source, 2 the target — and not an actor id.
 * Built by hand here rather than sliced out of a fixture because the shapes these tests are about
 * (a pull with no readings, a reading of zero, a cap moving mid-stretch) appear in none of the three
 * committed captures.
 */
const sample = (t: number, attackPower: number, sourceID = 7): WclEvent =>
	({ type: 'damage', timestamp: t, sourceID, resourceActor: 1, attackPower }) as unknown as WclEvent;

/**
 * Rallying Cry as the shared aura table declares it (`lib/game/shared.ts`), restated here so this
 * suite does not reach into a spec's registry to test a spec-agnostic module. 97463 is the buff the
 * raid carries; 97462 is the warrior's button, which this report never sees.
 */
const RALLYING_CRY: Aura = {
	key: 'rallying-cry',
	name: 'Rallying Cry',
	ids: [97463],
	kind: 'buff',
	durationMs: 10_000,
} as unknown as Aura;

// --------------------------------------------------------------------- reading

describe('attackPowerSamples', () => {
	it('reads the field off the side `resourceActor` points at', () => {
		const events = [sample(0, 70_000), sample(100, 80_000)];
		expect(attackPowerSamples(events, 7, 0).map((s) => s.attackPower)).toEqual([70_000, 80_000]);
	});

	it('ignores an actor the readings do not belong to', () => {
		expect(attackPowerSamples([sample(0, 70_000, 8)], 7, 0)).toEqual([]);
	});

	it('drops a reading of zero rather than believing it', () => {
		// Nobody at 90 has no attack power, so a zero is the log declining to fill the field. Every
		// committed capture happens to carry none, which is exactly why this is asserted by hand.
		expect(attackPowerSamples([sample(0, 0), sample(10, 70_000)], 7, 0)).toHaveLength(1);
	});

	it('comes back empty rather than wrong when the fetch asked for no resources', () => {
		const bare = { type: 'damage', timestamp: 0, sourceID: 7 } as unknown as WclEvent;
		expect(attackPowerSamples([bare], 7, 0)).toEqual([]);
	});

	it('stamps readings relative to the pull', () => {
		expect(attackPowerSamples([sample(5_000, 70_000)], 7, 4_000)[0]?.t).toBe(1_000);
	});
});

describe('attackPowerBuffMultiplier', () => {
	it('reads the raid buff as one effect with three ids', () => {
		for (const id of [6673, 57330, 19506]) {
			expect(attackPowerBuffMultiplier(new Set([id]))).toBe(AP_RAID_BUFF_MULTIPLIER);
		}
	});

	it('does not stack two of them, because the sim does not', () => {
		expect(attackPowerBuffMultiplier(new Set([6673, 19506]))).toBe(AP_RAID_BUFF_MULTIPLIER);
	});

	it('falls back to 1, which understates the ceiling rather than inflating it', () => {
		expect(attackPowerBuffMultiplier(new Set([12345]))).toBe(1);
	});
});

describe('pullAuraIds', () => {
	const info = (auras: unknown) => ({ type: 'combatantinfo', timestamp: 0, sourceID: 7, auras }) as unknown as WclEvent;

	it('reads the bare ids off the pull snapshot', () => {
		const ids = pullAuraIds(
			[
				info([
					{ ability: 6673, source: 3 },
					{ ability: 19506, source: 9 },
				]),
			],
			7,
		);
		expect([...ids].sort((a, b) => a - b)).toEqual([6673, 19506]);
	});

	it('comes back empty for a log carrying no combatantinfo at all', () => {
		expect(pullAuraIds([], 7).size).toBe(0);
	});

	it('ignores another actor\u2019s snapshot', () => {
		expect(pullAuraIds([info([{ ability: 6673 }])], 8).size).toBe(0);
	});
});

// ---------------------------------------------------------------- the ceiling

describe('vengeanceAudit', () => {
	const base = { durationMs: 10_000, attackPowerMultiplier: 1, maxHealth: 100_000 };

	it('takes the pull zero from the readings before the first blow', () => {
		const audit = vengeanceAudit({
			...base,
			samples: [
				{ t: 0, attackPower: 60_000 },
				{ t: 500, attackPower: 61_000 },
				// After the first hit, so not a statement about the player's own attack power.
				{ t: 2_000, attackPower: 90_000 },
			],
			firstDamageTakenAt: 1_000,
		});
		expect(audit.baseAttackPower).toBe(60_000);
	});

	it('falls back to the pull minimum when nothing was sampled before the first blow', () => {
		const audit = vengeanceAudit({
			...base,
			samples: [
				{ t: 2_000, attackPower: 90_000 },
				{ t: 3_000, attackPower: 70_000 },
			],
			firstDamageTakenAt: 0,
		});
		// A floor on the true base, since Vengeance only ever adds — so it can overstate what was held
		// and never understate it.
		expect(audit.baseAttackPower).toBe(70_000);
	});

	it('puts the ceiling at base plus the multiplied cap', () => {
		const audit = vengeanceAudit({
			...base,
			attackPowerMultiplier: 1.1,
			samples: [{ t: 0, attackPower: 60_000 }],
			firstDamageTakenAt: Infinity,
		});
		// 60,000 + 1.1 × 100,000. The multiplier applies to the Vengeance half because the sim multiplies
		// the whole AttackPower stat and Vengeance is a flat contribution to it.
		expect(audit.curve.max).toBe(170_000);
	});

	it('draws its axis to the highest ceiling the pull reached, not the resting one', () => {
		const audit = vengeanceAudit({
			...base,
			samples: [{ t: 0, attackPower: 60_000 }],
			firstDamageTakenAt: Infinity,
			healthBuffs: [{ name: 'Rallying Cry', multiplier: 1.2, windows: [{ start: 2_000, end: 4_000 }] }],
		});
		expect(audit.restingCap).toBe(100_000);
		expect(audit.peakCap).toBeCloseTo(120_000, 6);
		// So the curve never runs off the top of its own axis during the raised stretch.
		expect(audit.curve.max).toBeCloseTo(180_000, 6);
	});

	it('reports the stretches a health buff raised the cap for, named', () => {
		const audit = vengeanceAudit({
			...base,
			samples: [{ t: 0, attackPower: 60_000 }],
			firstDamageTakenAt: Infinity,
			healthBuffs: [{ name: 'Rallying Cry', multiplier: 1.2, windows: [{ start: 2_000, end: 4_000 }] }],
		});
		expect(audit.capWindows).toHaveLength(1);
		expect(audit.capWindows[0]?.names).toEqual(['Rallying Cry']);
		expect(audit.capRaisedMs).toBe(2_000);
	});

	it('multiplies two overlapping health buffs and splits the stretch at the join', () => {
		const audit = vengeanceAudit({
			...base,
			samples: [{ t: 0, attackPower: 60_000 }],
			firstDamageTakenAt: Infinity,
			healthBuffs: [
				{ name: 'Rallying Cry', multiplier: 1.2, windows: [{ start: 0, end: 4_000 }] },
				{ name: 'Ancestral Vigor', multiplier: 1.1, windows: [{ start: 2_000, end: 6_000 }] },
			],
		});
		// Three heights, not an average across the pair: one buff, both, then the other.
		expect(audit.capWindows.map((w) => Math.round(w.cap))).toEqual([120_000, 132_000, 110_000]);
		expect(audit.capWindows.map((w) => w.names.length)).toEqual([1, 2, 1]);
	});

	it('reports no cap windows at all when the log reported no stamina', () => {
		const audit = vengeanceAudit({
			...base,
			maxHealth: null,
			samples: [{ t: 0, attackPower: 60_000 }],
			firstDamageTakenAt: Infinity,
			healthBuffs: [{ name: 'Rallying Cry', multiplier: 1.2, windows: [{ start: 0, end: 4_000 }] }],
		});
		expect(audit.capWindows).toEqual([]);
		expect(audit.peak?.shareOfCap).toBeNull();
		// The chart still draws, off the readings' own peak, rather than collapsing to nothing.
		expect(audit.curve.max).toBe(60_000);
	});

	// ------------------------------------------------------------- at the cap

	it('counts a stretch only when both readings that bound it are near the cap', () => {
		const audit = vengeanceAudit({
			...base,
			samples: [
				{ t: 0, attackPower: 150_000 },
				// Back to base, so neither the stretch before it nor the one after it counts, however full
				// their other ends are.
				{ t: 1_000, attackPower: 50_000 },
				{ t: 2_000, attackPower: 150_000 },
				{ t: 3_000, attackPower: 150_000 },
			],
			firstDamageTakenAt: -1,
		});
		// Base is the pull minimum, 50,000, so the three 150,000 readings hold exactly one cap.
		expect(audit.baseAttackPower).toBe(50_000);
		expect(audit.nearCap).toEqual([[2_000, 3_000]]);
		expect(audit.nearCapMs).toBe(1_000);
		expect(audit.nearCapPct).toBeCloseTo(10, 6);
	});

	it('holds the near band at one second of Vengeance decay', () => {
		// The band is five percent because the carry falls by a twentieth of itself per second over a
		// twenty-second aura. A reading a hair inside it counts; a hair outside does not.
		const inside = 100_000 * NEAR_CAP_SHARE + 1;
		const outside = 100_000 * NEAR_CAP_SHARE - 1;
		const run = (held: number) =>
			vengeanceAudit({
				...base,
				samples: [
					{ t: 0, attackPower: 10_000 },
					{ t: 1_000, attackPower: 10_000 + held },
					{ t: 2_000, attackPower: 10_000 + held },
				],
				firstDamageTakenAt: -1,
			}).nearCapMs;
		expect(run(inside)).toBe(1_000);
		expect(run(outside)).toBe(0);
	});

	it('measures against the cap in force at the moment, not the resting one', () => {
		// 96,000 is 96% of the resting 100,000 — inside the band — and 80% of the 120,000 a Rallying Cry
		// puts up, which is outside it. A cap read as a constant would call this capped.
		const samples = [
			{ t: 0, attackPower: 0 + 10_000 },
			{ t: 1_000, attackPower: 10_000 + 96_000 },
			{ t: 2_000, attackPower: 10_000 + 96_000 },
		];
		expect(vengeanceAudit({ ...base, samples, firstDamageTakenAt: -1 }).nearCapMs).toBe(1_000);
		expect(
			vengeanceAudit({
				...base,
				samples,
				firstDamageTakenAt: -1,
				healthBuffs: [{ name: 'Rallying Cry', multiplier: 1.2, windows: [{ start: 0, end: 4_000 }] }],
			}).nearCapMs,
		).toBe(0);
	});

	it('says how coarse the readings were rather than implying a precision it lacks', () => {
		const audit = vengeanceAudit({
			...base,
			samples: [
				{ t: 0, attackPower: 60_000 },
				{ t: 100, attackPower: 60_000 },
				{ t: 5_100, attackPower: 60_000 },
			],
			firstDamageTakenAt: Infinity,
		});
		expect(audit.samples).toBe(3);
		expect(audit.medianGapMs).toBe(5_000);
		expect(audit.p99GapMs).toBe(5_000);
	});

	it('answers for a pull the fetch carried no readings at all for', () => {
		const audit = vengeanceAudit({ ...base, samples: [], firstDamageTakenAt: Infinity });
		expect(audit.samples).toBe(0);
		expect(audit.baseAttackPower).toBeNull();
		expect(audit.peak).toBeNull();
		expect(audit.nearCapMs).toBe(0);
		expect(audit.curve.points).toEqual([]);
	});
});

// ------------------------------------------------------------ the real pulls
//
// The three committed Protection captures, measured end to end. These are pinned because they are the
// only evidence there is that the arithmetic above describes a real log: the ceiling is built out of a
// stamina, a Strength-derived attack power and a raid buff, and if any of the three is read wrongly the
// share of the cap moves by several percent and nothing else fails.
//
// **The strongest of them is `baseAttackPower`.** A Paladin's attack power with no Vengeance on it is
// `(250 + 2 × Strength) × 1.1` — `sim/paladin/paladin.go:166`, `sim/core/base_stats.go:137`, and the
// raid buff at `sim/core/buffs.go:311`. That prediction and the pull's own opening reading agree to the
// unit on all three, which checks the Strength dependency, the class base and the multiplier in one go.

interface Expected {
	file: string;
	stamina: number;
	strength: number;
	maxHealth: number;
	baseAttackPower: number;
	peakAttackPower: number;
	peakAtMs: number;
	peakShareOfCapPct: number;
	rallyingCryWindows: number;
	capRaisedMs: number;
}

const PULLS: Expected[] = [
	{
		file: 'garrosh.json',
		stamina: 67_433,
		strength: 31_367,
		maxHealth: 1_090_465,
		baseAttackPower: 69_282,
		peakAttackPower: 918_411,
		peakAtMs: 384_199,
		peakShareOfCapPct: 70.8,
		rallyingCryWindows: 10,
		capRaisedMs: 100_005,
	},
	{
		file: 'paragons.json',
		stamina: 67_433,
		strength: 31_367,
		maxHealth: 1_090_465,
		baseAttackPower: 69_282,
		peakAttackPower: 919_332,
		peakAtMs: 67_331,
		peakShareOfCapPct: 70.9,
		rallyingCryWindows: 7,
		capRaisedMs: 70_022,
	},
	{
		file: 'fallenProtectors.json',
		stamina: 64_574,
		strength: 32_753,
		maxHealth: 1_050_439,
		baseAttackPower: 72_332,
		peakAttackPower: 505_259,
		peakAtMs: 119_012,
		peakShareOfCapPct: 31.2,
		rallyingCryWindows: 4,
		capRaisedMs: 40_021,
	},
];

const auditOf = (expected: Expected) => {
	const dataset = rawFixture('protection', expected.file);
	const actorID = dataset.actor.id;
	const t0 = dataset.fight.startTime;
	const info = dataset.events.find((e) => e.type === 'combatantinfo' && e.sourceID === actorID) as
		| (WclEvent & { strength?: number })
		| undefined;
	const windows = auraWindows(eventsOn(dataset.events, actorID), RALLYING_CRY, t0, dataset.fight.endTime);

	return {
		strength: info?.strength ?? null,
		windows,
		// Through the log-level entry point, which is what the spec calls — so this exercises the
		// readers and the arithmetic together rather than only the half that takes numbers.
		audit: readVengeance({
			events: dataset.events,
			actorID,
			t0,
			durationMs: dataset.fight.endTime - t0,
			stamina: readGear(dataset.events, actorID).stamina,
			healthBuffs: [{ name: 'Rallying Cry', multiplier: 1.2, windows }],
		}),
	};
};

describe.each(PULLS)('the $file capture', (expected) => {
	it('reads the health pool the cap is a function of', () => {
		const { audit } = auditOf(expected);
		expect(readGear(rawFixture('protection', expected.file).events, 33).stamina).toBe(expected.stamina);
		expect(audit.maxHealth).toBe(expected.maxHealth);
		expect(audit.restingCap).toBe(expected.maxHealth);
	});

	it('finds the raid attack power buff, which the ceiling is nine percent wrong without', () => {
		const { audit } = auditOf(expected);
		expect(audit.attackPowerMultiplier).toBe(AP_RAID_BUFF_MULTIPLIER);
	});

	it('agrees with the sim on what the player had before Vengeance, to the unit', () => {
		const { audit, strength } = auditOf(expected);
		expect(strength).toBe(expected.strength);
		// `(CharacterLevel*3 - 20) + 2 × Strength`, times the raid buff. Rounded because the product is
		// fractional and a character sheet is not.
		const predicted = Math.round((90 * 3 - 20 + 2 * expected.strength) * AP_RAID_BUFF_MULTIPLIER);
		expect(predicted).toBe(expected.baseAttackPower);
		expect(audit.baseAttackPower).toBe(expected.baseAttackPower);
	});

	it('measures the peak and what share of the cap it was', () => {
		const { audit } = auditOf(expected);
		expect(audit.peak?.attackPower).toBe(expected.peakAttackPower);
		expect(audit.peak?.at).toBe(expected.peakAtMs);
		expect(audit.peak?.vengeance).toBe(expected.peakAttackPower - expected.baseAttackPower);
		expect((audit.peak?.shareOfCap ?? 0) * 100).toBeCloseTo(expected.peakShareOfCapPct, 1);
	});

	it('finds the cap moving during the pull, because Rallying Cry lands on it', () => {
		const { audit, windows } = auditOf(expected);
		expect(windows).toHaveLength(expected.rallyingCryWindows);
		expect(audit.capWindows).toHaveLength(expected.rallyingCryWindows);
		expect(audit.capRaisedMs).toBe(expected.capRaisedMs);
		// A fifth more ceiling, for as long as it holds.
		expect(audit.peakCap).toBeCloseTo(expected.maxHealth * 1.2, 6);
	});

	it('finds no time at or near the cap, which is the honest answer for these pulls', () => {
		const { audit } = auditOf(expected);
		// The peak share above is 71%, 71% and 31%. Nothing here tests `NEAR_CAP_SHARE`, and the constant
		// says so rather than being moved down until a number appears.
		expect(audit.nearCap).toEqual([]);
		expect(audit.nearCapMs).toBe(0);
	});

	it('samples densely enough for a stretch at the cap to be visible at all', () => {
		const { audit } = auditOf(expected);
		expect(audit.samples).toBeGreaterThan(1_000);
		// About fourteen readings a second at the median, which is well inside one global.
		expect(audit.medianGapMs).toBeLessThan(100);
	});
});

describe('the ceiling the chart draws', () => {
	/**
	 * The step series, checked against the windows it is built from rather than against itself.
	 *
	 * Two edges per window and one for the pull's opening, and no adjacent pair holding the same level —
	 * which together are the whole shape. Asserting the count this way rather than as a literal is what
	 * makes it a check: a series built off the wrong edge would still have some length, and one that
	 * never came back down would have exactly half as many.
	 */
	it.each(PULLS)('steps once at each edge of every raise on $file', (expected) => {
		const { audit } = auditOf(expected);
		const steps = audit.curve.ceiling;
		expect(steps).toBeDefined();
		expect(steps).toHaveLength(expected.rallyingCryWindows * 2 + 1);

		// The opening entry is the resting ceiling, and every level alternates from there — a raise and a
		// return, never two of either in a row.
		const levels = (steps ?? []).map(([, level]) => level);
		const resting = levels[0];
		const raised = levels[1];
		expect(resting).toBeDefined();
		expect(raised).toBeGreaterThan(resting ?? 0);
		levels.forEach((level, i) => expect(level).toBe(i % 2 === 0 ? resting : raised));

		// And the scalar the axis is scaled by is the raised level, so the curve can never leave it.
		expect(audit.curve.max).toBe(raised);
		expect((steps ?? [])[0]?.[0]).toBe(0);
	});

	/**
	 * A pull whose ceiling never moved carries no series at all, which is the fallback every other bar
	 * in this tree relies on. Asserted with the health buffs withheld rather than by finding a capture
	 * without one — all three carry a Rallying Cry, so the case has to be constructed.
	 */
	it('omits the series entirely when nothing raised the ceiling', () => {
		const dataset = rawFixture('protection', 'garrosh.json');
		const audit = readVengeance({
			events: dataset.events,
			actorID: dataset.actor.id,
			t0: dataset.fight.startTime,
			durationMs: dataset.fight.endTime - dataset.fight.startTime,
			stamina: readGear(dataset.events, dataset.actor.id).stamina,
		});
		expect(audit.curve.ceiling).toBeUndefined();
		expect(audit.capWindows).toEqual([]);
	});
});
