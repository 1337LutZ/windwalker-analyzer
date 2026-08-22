// How much of a three-target stretch is the add wave, and how much is the window that measured it.
//
// `targetCounts` is a trailing window: an enemy joins the count at the instant it is hit and leaves it
// `windowMs` after its last hit. So a stretch of "three or more enemies" closes a whole window after
// the third enemy stopped being hit, and that tail is time the player was on fewer enemies than the
// stretch says. Where such a stretch is used to *band a press* the tail is right — the player pressed
// on what they knew. Where it is used to **exempt** a clock the tail is time forgiven with nothing
// charged, and this file measures how much of it there is on the one committed fixture that has any.
//
// The measurement is a second derivation, off the fixture's own `damage` rows, and not a read of the
// audit that consumes it: the filters `analyseCore` applies to build its hit list are restated here
// (own casts, no periodic ticks, no friendlies, no wholly-immune spawn) so that if either side moves
// the two stop agreeing and say so. The last case in the file ties the two together, which is what
// keeps this from being a test of its own arithmetic.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { instanceKey } from '~/lib/events';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';
import { analyse } from '~/specs/elemental/lib';

import { unionMs } from '../intervals';
import { intervalsAtLeast, isJudgeableTarget, spawnLives, targetCounts, type TargetHit } from '../targets';

/** `TARGET_WINDOW_MS`, the calibration both specs' configs carry and the count is taken over. */
const WINDOW_MS = 5000;
/**
 * One global, and the grace an exemption keeps of that window.
 *
 * `GCD_MS` in the Elemental config. The priority list re-reads its conditions once a global, so a press
 * taken within one global of the last three-target hit was decided under a count that still said three
 * — and nothing the player can do responds faster than that. Everything past it is lag.
 */
const GCD_MS = 1500;
const TRIM_MS = WINDOW_MS - GCD_MS;

/** Siegecrafter Blackfuse on `cleave`. The Crawler Mines are 482 and 483, the Shredder 478. */
const BOSS_ID = 470;

const dataset = (name: string): FightDataset =>
	JSON.parse(
		readFileSync(resolve(import.meta.dirname, `../../../specs/elemental/__fixtures__/${name}.json`), 'utf8'),
	) as FightDataset;

/**
 * The hit list the target count is taken over, rebuilt from the fixture's raw rows.
 *
 * Every filter here is one `analyseCore` applies at the one place it builds the list: the audited
 * player as source, no periodic ticks (a tick lands on an enemy nobody is near), no friendly target,
 * and no spawn every hit on which came back immune. The pet's damage is out of the hit list for the
 * same reason and in it for `spawnLives`, which is the widest evidence of what could be damaged at all.
 */
const hitsOf = (data: FightDataset): TargetHit[] => {
	const t0 = data.fight.startTime;
	const duration = data.fight.endTime - t0;
	const me = data.actor.id;
	const actors = data.actors ?? [];
	const petIDs = new Set(actors.filter((a) => a.petOwner === me).map((a) => a.id));
	const friendlyIDs = new Set(actors.filter((a) => a.type === 'Player' || a.type === 'Pet').map((a) => a.id));
	const rows = data.events as unknown as ReadonlyArray<Record<string, unknown>>;
	const lives = spawnLives(
		rows.filter(
			(e) => e['type'] === 'damage' && (e['sourceID'] === me || petIDs.has(e['sourceID'] as number)),
		) as never,
		t0,
		duration,
		WINDOW_MS,
	);
	const hits: TargetHit[] = [];
	for (const e of rows) {
		if (e['type'] !== 'damage' || e['sourceID'] !== me || e['tick'] === true) continue;
		const targetID = e['targetID'] as number | undefined;
		if (targetID === undefined || friendlyIDs.has(targetID)) continue;
		const instance = e['targetInstance'] as number | undefined;
		if (!isJudgeableTarget(lives.get(instanceKey(targetID, instance)))) continue;
		hits.push({
			t: (e['timestamp'] as number) - t0,
			target: targetID,
			...(instance === undefined ? {} : { instance }),
		});
	}
	return hits.sort((a, b) => a.t - b.t);
};

/**
 * The last hit that kept the count at three, for a stretch closing at `close`.
 *
 * The count only ever *falls* at a moment some hit ages out, so the stretch's close is that hit plus
 * the window. Which hit: of the spawns still counted an instant before the close, the third-newest —
 * its last hit is the last moment three distinct enemies had all been hit inside one window, and the
 * one whose expiry takes the count to two.
 */
const lastThreeWideHit = (hits: readonly TargetHit[], close: number): number => {
	const at = close - 1;
	const lastBySpawn = new Map<string, number>();
	for (const h of hits) {
		if (h.t > at) break;
		lastBySpawn.set(`${h.target}:${h.instance ?? '-'}`, h.t);
	}
	const live = [...lastBySpawn.values()].filter((t) => t > at - WINDOW_MS).sort((a, b) => b - a);
	const third = live[2];
	if (third === undefined) throw new Error(`fewer than three enemies counted before ${close}`);
	return third;
};

/**
 * `cleave` — Siegecrafter Blackfuse, a 263 233ms pull that runs from one enemy to thirteen, and the
 * only committed Elemental fixture with any three-target time at all.
 */
describe('the tail of a three-target stretch, on cleave', () => {
	const data = dataset('cleave');
	const duration = data.fight.endTime - data.fight.startTime;
	const hits = hitsOf(data);
	const points = targetCounts(hits, WINDOW_MS);
	const stretches = intervalsAtLeast(points, 3, duration);

	// The measurement itself, and a deliberate no-change guard: the untrimmed stretches are what they
	// always were, so this is green before the trim as well as after it.
	it('is eight stretches covering 109 869ms of the pull', () => {
		expect(duration).toBe(263_233);
		expect(stretches).toEqual([
			[52_997, 87_463],
			[98_927, 109_260],
			[114_941, 121_134],
			[175_925, 201_861],
			[203_931, 208_961],
			[219_625, 242_549],
			[244_182, 247_937],
			[262_001, 263_233],
		]);
		expect(unionMs(stretches)).toBe(109_869);
	});

	/**
	 * The measurement the trim exists for, and the reason it is a subtraction rather than an estimate.
	 *
	 * Seven of the eight stretches close **exactly** 5 000ms after the last hit on their third enemy —
	 * to the millisecond, seven times, which is what a structural fact looks like rather than a
	 * coincidence. The eighth closes 1 179ms after it because the boss died first, and it is the one the
	 * trim must leave alone.
	 *
	 * The trimmed close is asserted beside each tail, because that is the half of this the change owns:
	 * a stretch closed by the count falling ends at its third enemy's last hit plus one global, and a
	 * stretch closed by the bell ends at the bell.
	 */
	it('runs exactly one window past the last hit on its third enemy, and one global past it once trimmed', () => {
		const trimmed = intervalsAtLeast(points, 3, duration, TRIM_MS);
		const tails = stretches.map(([, close]) => close - lastThreeWideHit(hits, close));
		expect(tails).toEqual([5000, 5000, 5000, 5000, 5000, 5000, 5000, 1179]);
		expect(trimmed.map(([, close]) => close)).toEqual([
			// The seven that closed on the count falling: the third enemy's last hit plus one global.
			lastThreeWideHit(hits, 87_463) + GCD_MS,
			lastThreeWideHit(hits, 109_260) + GCD_MS,
			lastThreeWideHit(hits, 121_134) + GCD_MS,
			lastThreeWideHit(hits, 201_861) + GCD_MS,
			lastThreeWideHit(hits, 208_961) + GCD_MS,
			lastThreeWideHit(hits, 242_549) + GCD_MS,
			lastThreeWideHit(hits, 247_937) + GCD_MS,
			// The one the pull ended inside, untouched — its close is the bell and carries no lag.
			duration,
		]);
		expect(trimmed.map(([open]) => open)).toEqual(stretches.map(([open]) => open));
	});

	/**
	 * What the tail costs an exemption: 24 500ms of a 109 869ms total, 22.3% of it, on a 263 233ms pull.
	 *
	 * The raw tails add to 36 179ms, but two of them reach back past their own stretch's open — a
	 * stretch can be *opened* by evidence already stale, and [244 182, 247 937] is one, opening 1 245ms
	 * after its third enemy's last hit. Capped at each stretch's own length the tails are 34 934ms,
	 * 31.8% of the exemption; the 24 500ms below is what one global of grace hands back of that.
	 *
	 * And it is boss-only time, not cleave time: 28 378ms of the exempt total falls after the last hit
	 * any add in that stretch ever took, so those milliseconds are the player on the boss alone with an
	 * add-wave exemption still running.
	 */
	it('costs an exemption 24 500ms, of which 28 378ms of the total was boss-only time', () => {
		const trimmed = intervalsAtLeast(points, 3, duration, TRIM_MS);
		expect(unionMs(trimmed)).toBe(85_369);
		expect(unionMs(stretches) - unionMs(trimmed)).toBe(24_500);

		const addHits = hits.filter((h) => h.target !== BOSS_ID).map((h) => h.t);
		const bossOnlyMs = stretches.reduce((total, [open, close]) => {
			const lastAdd = Math.max(open, ...addHits.filter((t) => t <= close));
			return total + (close - lastAdd);
		}, 0);
		expect(bossOnlyMs).toBe(28_378);
	});

	/**
	 * The tie to the audit that consumes these stretches, so the derivation above is not just internally
	 * consistent.
	 *
	 * The Lightning Shield section publishes the exemption's own windows (`aoeWindows`), and its overcap
	 * clock is the pull less them. Asserted as "the same opens, and closes no later than these",
	 * deliberately: the opens are the hits that made the count and no trim moves them, while the closes
	 * are what a trim shortens — so this holds whether or not the exemption has been put on the trimmed
	 * series, and fails if the reconstruction above ever stops describing the same pull.
	 */
	// Deliberate no-change guard, and the only case here that reads the audit: green before the trim,
	// green after it, and red if the reconstruction above stops describing the pull the audit sees.
	it('describes the same stretches the shield’s exemption is derived from', () => {
		const el = analyse(data) as Analysis & ElementalAuditResult;
		const published = el.lightningShield.aoeWindows;
		expect(published.map((w) => w.start)).toEqual(stretches.map(([open]) => open));
		for (const [i, w] of published.entries()) {
			expect(w.end, `stretch at ${w.start}`).toBeLessThanOrEqual(stretches[i]?.[1] ?? 0);
		}
	});
});

/**
 * The two fixtures that never see a second enemy, which is what makes them the control.
 *
 * Both are Iron Juggernaut pulls whose only other units are wholly-immune Crawler Mines, so the count
 * never leaves one and there is no three-target stretch to trim. **Deliberate no-change guards: green
 * before and after the trim, by construction** — their value is that they say so rather than being
 * assumed, and that the count they are green because of is asserted rather than the emptiness alone.
 */
describe('a pull that never sees three enemies has no tail to trim', () => {
	for (const name of ['phased', 'unbroken']) {
		it(name, () => {
			const data = dataset(name);
			const duration = data.fight.endTime - data.fight.startTime;
			const points = targetCounts(hitsOf(data), WINDOW_MS);
			expect(Math.max(...points.map(([, count]) => count))).toBe(1);
			expect(intervalsAtLeast(points, 3, duration)).toEqual([]);
			expect(intervalsAtLeast(points, 3, duration, TRIM_MS)).toEqual([]);
		});
	}
});
