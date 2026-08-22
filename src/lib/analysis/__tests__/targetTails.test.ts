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
 * The two numbers the grace is allowed to sit between, and deliberately **not** the grace itself.
 *
 * The priority list re-reads its conditions once a global, so a press taken within one global of the
 * last three-target hit was decided under a count that still said three — and nothing the player can do
 * responds faster. Everything past it is lag. But *which* global: the routing in `analyseCore` passes
 * `effectiveGcd`, the pull's **measured** median gap, floored at `GCD_MIN_MS` and capped at the spec's
 * declared `gcdMs` — not the declared 1 500 this file named while it was being written. On `cleave` the
 * measured global is 1 124ms, so a trim written against the declared one would be 376ms too deep on
 * every stretch, and every figure below with it.
 *
 * So the grace is **recovered from the audit** — see `grace` in the `cleave` block below — and then
 * bounded by these two, rather than being a constant this file and the code must agree about by hand. That makes the file report a
 * change in `effectiveGcd` instead of silently measuring a trim nothing performs.
 */
const GCD_MIN_MS = 1000;
const GCD_DECLARED_MS = 1500;

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
	const el = analyse(data) as Analysis & ElementalAuditResult;
	const published = el.lightningShield.aoeWindows;
	/**
	 * The grace the routing actually applied, read back off the audit rather than named here.
	 *
	 * A stretch closed by the count falling closes at `h3 + WINDOW_MS`, and the trim takes it to
	 * `h3 + grace`; so `untrimmedClose - trimmedClose` is `WINDOW_MS - grace` and the grace falls out.
	 * Matched by **open**, because no trim moves an open — that is what lets a stretch the trim dropped
	 * entirely be absent from `published` without breaking the pairing.
	 *
	 * A stretch the pull ended inside is excluded: its close is the bell rather than a fall, so it
	 * carries no lag and its difference is not a grace.
	 */
	const closeByOpen = new Map(stretches.map(([open, close]) => [open, close]));
	const graces = [
		...new Set(
			published.filter((w) => w.end < duration).map((w) => WINDOW_MS - ((closeByOpen.get(w.start) ?? 0) - w.end)),
		),
	];
	const grace = graces[0] ?? 0;
	const TRIM_MS = WINDOW_MS - grace;

	/**
	 * The grace is one number, shared by every fall-closed stretch, and it is one this pull could have
	 * been played on.
	 *
	 * **One number is the assertion, not a formality.** A per-stretch fudge, an off-by-one at a boundary
	 * or a trim applied to the open as well as the close would all give more than one value here, and the
	 * set collapsing to a single entry says the close moved by a constant. The bounds are the two numbers
	 * `effectiveGcd` is allowed to be — `analyseCore`'s `GCD_MIN_MS` floor and the Elemental config's
	 * declared `gcdMs` ceiling — so this fails if the routing is ever handed something that is not a
	 * global at all, while staying green when the median moves between pulls.
	 *
	 * On `cleave` it measures **1 124ms**, recorded rather than asserted: it is a property of the pull's
	 * haste, and pinning it would make this file fail for a reason that is not about tails.
	 */
	it('trims by one measured global, the same one for every stretch', () => {
		expect(graces).toHaveLength(1);
		expect(grace).toBeGreaterThanOrEqual(GCD_MIN_MS);
		expect(grace).toBeLessThanOrEqual(GCD_DECLARED_MS);
	});

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
	 *
	 * **One of the eight is now absent, and that is the reading rather than a rounding.** [244 182,
	 * 247 937] is 3 755ms long against a 3 876ms trim, so no moment of it was within a global of
	 * three-wide contact and `intervalsAtLeast` drops it — see `trimTrailingMs`. Its close is therefore
	 * listed here as the tail it always had and not as a trimmed instant.
	 */
	it('runs exactly one window past the last hit on its third enemy, and one global past it once trimmed', () => {
		const trimmed = intervalsAtLeast(points, 3, duration, TRIM_MS);
		const tails = stretches.map(([, close]) => close - lastThreeWideHit(hits, close));
		expect(tails).toEqual([5000, 5000, 5000, 5000, 5000, 5000, 5000, 1179]);
		expect(trimmed.map(([, close]) => close)).toEqual([
			// The six that closed on the count falling and are longer than the trim: the third enemy's last
			// hit plus one global.
			lastThreeWideHit(hits, 87_463) + grace,
			lastThreeWideHit(hits, 109_260) + grace,
			lastThreeWideHit(hits, 121_134) + grace,
			lastThreeWideHit(hits, 201_861) + grace,
			lastThreeWideHit(hits, 208_961) + grace,
			lastThreeWideHit(hits, 242_549) + grace,
			// [244 182, 247 937] is gone — shorter than the trim, so nothing of it survives.
			// The one the pull ended inside, untouched — its close is the bell and carries no lag.
			duration,
		]);
		// The opens are the hits that made the count and no trim moves them, so the survivors' opens are
		// the untrimmed opens with the dropped stretch's taken out — not a shifted list.
		expect(trimmed.map(([open]) => open)).toEqual(stretches.map(([open]) => open).filter((open) => open !== 244_182));
	});

	/**
	 * What the tail costs an exemption: 27 011ms of a 109 869ms total, 24.6% of it, on a 263 233ms pull.
	 *
	 * The raw tails add to 36 179ms, but two of them reach back past their own stretch's open — a
	 * stretch can be *opened* by evidence already stale, and [244 182, 247 937] is one, opening 1 245ms
	 * after its third enemy's last hit. Capped at each stretch's own length the tails are 34 934ms,
	 * 31.8% of the exemption; the 27 011ms below is what one measured global of grace hands back of that.
	 *
	 * **Composed rather than a round number, and the composition is asserted.** Six stretches lose the
	 * trim each, one loses its whole 3 755ms because it is shorter than the trim, and the one the kill
	 * clamped loses nothing. `6 * TRIM_MS + 3 755` is that sentence written out, so the total cannot be
	 * matched by a different arrangement of losses adding to the same figure.
	 *
	 * And it is boss-only time, not cleave time: 28 378ms of the exempt total falls after the last hit
	 * any add in that stretch ever took, so those milliseconds are the player on the boss alone with an
	 * add-wave exemption still running.
	 */
	it('costs an exemption 27 011ms, of which 28 378ms of the total was boss-only time', () => {
		const trimmed = intervalsAtLeast(points, 3, duration, TRIM_MS);
		expect(unionMs(trimmed)).toBe(82_858);
		const removed = unionMs(stretches) - unionMs(trimmed);
		expect(removed).toBe(27_011);
		expect(removed).toBe(6 * TRIM_MS + (247_937 - 244_182));

		const addHits = hits.filter((h) => h.target !== BOSS_ID).map((h) => h.t);
		const bossOnlyMs = stretches.reduce((total, [open, close]) => {
			const lastAdd = Math.max(open, ...addHits.filter((t) => t <= close));
			return total + (close - lastAdd);
		}, 0);
		expect(bossOnlyMs).toBe(28_378);
	});

	/**
	 * The tie to the audit that consumes these stretches, so the derivation above is not just internally
	 * consistent — and now an **identity** rather than the inequality it was.
	 *
	 * While the routing passed the untrimmed series this could only say "the same opens, and closes no
	 * later than these", because it had to stay green either side of the change. It does not any more: the
	 * exemption *is* this file's reconstruction trimmed by the grace read off it, to the millisecond and
	 * including the stretch the trim drops. That is the strongest form available — a hit list rebuilt from
	 * the fixture's raw rows, run through the same two functions, reproducing what the report publishes —
	 * and it is what makes every figure above a claim about the audit and not only about this file.
	 *
	 * Recovering the grace from the audit is not circular here. It takes one number back and the assertion
	 * is over the whole series: fourteen instants have to agree, and a wrong grace makes six closes wrong
	 * and either keeps a stretch that should have gone or drops one that should have stayed.
	 */
	it('describes the same stretches the shield’s exemption is derived from', () => {
		expect(published.map((w) => [w.start, w.end])).toEqual(intervalsAtLeast(points, 3, duration, TRIM_MS));
		// Stated separately so a failure says which half moved: the opens are the untrimmed opens less the
		// one dropped stretch, and no open was shifted.
		expect(published.map((w) => w.start)).toEqual(stretches.map(([open]) => open).filter((open) => open !== 244_182));
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
			// The widest trim the routing could ever pass — `WINDOW_MS` less the smallest global
			// `effectiveGcd` is allowed to be. Empty at the widest is empty at every narrower one, so this
			// covers the whole range without either pull having to state a grace it never uses.
			expect(intervalsAtLeast(points, 3, duration, WINDOW_MS - GCD_MIN_MS)).toEqual([]);
		});
	}
});
