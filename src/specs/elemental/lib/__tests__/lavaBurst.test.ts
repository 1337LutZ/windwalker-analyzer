// Lava Burst and its two resets: the Lava Surge procs, and what makes a press free.
//
// The section answers the one question a cast count cannot — a surge that expired with no Lava Burst
// inside was a free cast thrown away — and the interesting half of that is the exception. A surge that
// runs out while the boss is submerged is the fight taking the cast back, not a cast the player threw
// away, and `a:qHRAFwdGzaB6MPYC` #14 carries exactly one of those: the pull's only unconsumed surge
// expires 14.9 seconds into the Iron Juggernaut's submerge.
//
// The synthetic pull underneath is for the other side of the same guard: an unconsumed surge that
// expired with the boss in reach, which is a real fault and has to be reported as one.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { WclEvent } from '~/lib/events';
import { rawFixtures } from '~/lib/analysis/fixtures';
import { unionMs } from '~/lib/analysis/intervals';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';
import { analyse } from '../index';

const fx = (name: string): Analysis & ElementalAuditResult =>
	analyse(rawDataset(name)) as Analysis & ElementalAuditResult;

describe('a surge that expired while the boss was away', () => {
	const el = fx('phased');
	const { lavaBurst } = el;

	it('reads every proc the log carried', () => {
		expect(lavaBurst.procs).toHaveLength(18);
		expect(lavaBurst.presses).toHaveLength(49);
	});

	it('finds the one surge no Lava Burst was spent inside', () => {
		expect(lavaBurst.procs.filter((p) => !p.consumed)).toEqual([
			// `judged` is false for the same reason `wasted` is: the whole window falls inside the submerge
			// below, so there was nothing to cast at for any of its ten seconds. The flag's other half, the
			// enemy count, never gets a say on this pull, which is single-target throughout.
			{ start: 146_591, end: 157_147, consumed: false, wasted: false, judged: false },
		]);
	});

	/**
	 * The whole point of this fixture for this section.
	 *
	 * The submerge runs 142.3s to 192.5s off the player's own contact clock, and the surge expires at
	 * 157.1s — inside it, with nothing to cast at. `wasted` is `!consumed` **and** in contact, so the
	 * count is zero; without the contact half this pull would report a thrown-away free cast the player
	 * never had.
	 */
	it('does not charge the player for it', () => {
		expect(lavaBurst.wasted).toBe(0);
		const [before, after] = el.timeline?.contactSegments ?? [];
		expect(before?.[1]).toBe(142_282);
		expect(after?.[0]).toBe(192_534);
		expect(157_147).toBeGreaterThan(before?.[1] ?? 0);
		expect(157_147).toBeLessThan(after?.[0] ?? 0);
	});

	it('says which presses were free and which reset made them free', () => {
		// Seventeen of this pull's eighteen procs were spent, and the eighteenth is the one that expired at
		// 157 147 inside the submerge, forgiven above. The count is bounded by `procs.length` by
		// construction — a press cannot be made free by a reset that never happened — which is what makes
		// this a real assertion rather than a recorded output: it was 23 while the audit read the surge
		// window at the instant the cast *landed*, and 23 is more procs than the pull ever had.
		expect(lavaBurst.presses.filter((p) => p.surge)).toHaveLength(17);
		expect(lavaBurst.procs).toHaveLength(18);
		expect(lavaBurst.presses.filter((p) => p.ascendance)).toHaveLength(24);
	});
});

describe('a pull that consumed every surge it was given', () => {
	const { lavaBurst } = fx('unbroken');

	it('has nothing to report', () => {
		expect(lavaBurst.procs).toHaveLength(20);
		expect(lavaBurst.procs.filter((p) => !p.consumed)).toEqual([]);
		expect(lavaBurst.wasted).toBe(0);
	});

	it('still counts the presses and their resets apart', () => {
		expect(lavaBurst.presses).toHaveLength(41);
		// Every one of this pull's twenty procs was spent, which is why `wasted` is 0 above. Bounded by
		// `procs.length` for the same reason as the phased case.
		expect(lavaBurst.presses.filter((p) => p.surge)).toHaveLength(20);
		expect(lavaBurst.procs).toHaveLength(20);
		expect(lavaBurst.presses.filter((p) => p.ascendance)).toHaveLength(15);
	});
});

// ------------------------------------------------- Flame Shock, off the raw stream

/**
 * The player's own Flame Shock **down** stretches on one enemy, walked out of the dataset's events and
 * nothing else.
 *
 * Deliberately a second implementation. The thing under test is `lavaBurst.presses[].flameShock`, which
 * is built from `dotWindowsBySpawn` and `CastPress.begin`; checking it against a window list produced by
 * the same two functions would assert that the audit agrees with itself. This walk reads
 * `applydebuff` / `refreshdebuff` / `removedebuff` straight off the fixture, so a change to either of
 * those helpers moves one side of the comparison and not the other.
 */
function fsDownStretches(dataset: FightDataset, target: number): Array<[number, number]> {
	const t0 = dataset.fight.startTime;
	return downStretchesOf(
		dataset.events.filter((e) => e.abilityGameID === 8050 && e.sourceID === dataset.actor.id && e.targetID === target),
		t0,
		dataset.fight.endTime - t0,
	);
}

/** The walk itself, over one already-filtered stream — shared with the per-spawn union below. */
function downStretchesOf(events: readonly WclEvent[], t0: number, fightEnd: number): Array<[number, number]> {
	const out: Array<[number, number]> = [];
	let down: number | null = 0;
	for (const e of events) {
		const t = e.timestamp - t0;
		if (e.type === 'removedebuff') down ??= t;
		else if ((e.type === 'applydebuff' || e.type === 'refreshdebuff') && down !== null) {
			if (t > down) out.push([down, t]);
			down = null;
		}
	}
	if (down !== null && fightEnd > down) out.push([down, fightEnd]);
	return out;
}

/**
 * The stretches **no enemy at all** carried the player's Flame Shock, walked off the same three event
 * types and unioned across every target the dot was ever on.
 *
 * **Why the primary-keyed walk above cannot be the independent side on a multi-spawn pull.** On
 * `addsThenBoss` the primary is a Galakras tower that cannot be dotted for the first 442 020ms of a
 * 560 261ms pull, so `fsDownStretches(dataset, primaryTarget.id)` returns `[[0, 442 020], [560 218,
 * 560 261]]` and would call almost every Lava Burst on the pull dot-less. The audit is not reading the
 * primary — it reads the dot on the spawn the press was aimed at — so a primary-keyed comparison there
 * is not a second opinion about the same thing, it is a different and wrong question. That is the same
 * mistake `components/charts/__tests__/uptimeRow.test.ts` found in the dot chart's red row, arrived at
 * from the other end.
 *
 * This walk is target-agnostic and therefore askable of every pull. It is a **necessary** condition and
 * not the audit's claim restated: the audit says the dot was on the enemy being hit, and this says the
 * dot was on *some* enemy. Where they differ the audit is the stricter of the two, so a press this walk
 * calls dot-less is one the audit must also call dot-less — which is the direction asserted.
 */
function fsDownEverywhere(dataset: FightDataset): Array<[number, number]> {
	const t0 = dataset.fight.startTime;
	const fightEnd = dataset.fight.endTime - t0;
	// **Keyed by spawn and not by target id**, which is the difference between agreeing with the audit and
	// arguing with it. `addsThenBoss` puts 17 distinct `id:instance` spawns under the dot across only 9
	// distinct ids, so two instances of the same add interleave their applies and removes; folded onto one
	// key the walk reads a dot as down while the *other* instance still carries it, and it invents a
	// 11 643ms dark stretch at 200 644 that never happened. One Lava Burst sits in it. The audit's
	// `dotWindowsBySpawn` is per spawn, so this is a walk bug and not a disagreement.
	const spawns = new Map<string, WclEvent[]>();
	for (const e of dataset.events) {
		if (e.abilityGameID !== 8050 || e.sourceID !== dataset.actor.id || e.targetID === undefined) continue;
		const key = `${e.targetID}:${e.targetInstance ?? 0}`;
		const bucket = spawns.get(key);
		if (bucket === undefined) spawns.set(key, [e]);
		else bucket.push(e);
	}
	// Every instant any spawn holds the dot, as the union of the per-spawn walks.
	const up: Array<[number, number]> = [];
	for (const events of spawns.values()) {
		const down = downStretchesOf(events, t0, fightEnd);
		let cursor = 0;
		for (const [start, end] of down) {
			if (start > cursor) up.push([cursor, start]);
			cursor = end;
		}
		if (cursor < fightEnd) up.push([cursor, fightEnd]);
	}
	up.sort((a, b) => a[0] - b[0]);
	const merged: Array<[number, number]> = [];
	for (const span of up) {
		const last = merged.at(-1);
		if (last !== undefined && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
		else merged.push([span[0], span[1]]);
	}
	const out: Array<[number, number]> = [];
	let cursor = 0;
	for (const [start, end] of merged) {
		if (start > cursor) out.push([cursor, start]);
		cursor = Math.max(cursor, end);
	}
	if (cursor < fightEnd) out.push([cursor, fightEnd]);
	return out;
}

function rawDataset(name: string): FightDataset {
	return JSON.parse(
		readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8'),
	) as FightDataset;
}

/**
 * **The dot-less ledger is no longer empty on committed data, and the sentence that used to stand here
 * was the three-name grid speaking.**
 *
 * What this block said was: "No committed fixture has a Lava Burst committed with the dot down — and
 * none of them is vacuous", closing with "which is why the field is published and not graded, and why
 * the case is covered synthetically below". Both halves were true of `['cleave', 'phased', 'unbroken']`
 * and neither survived `addsThenBoss.json`. That pull commits **eight** Lava Bursts with no Flame Shock
 * on the enemy in front of the player — at 17 204, 43 491, 73 165, 175 810, 177 344, 342 917, 360 987 and
 * 437 544 — so the real case the synthetic pull below was built to cover has been sitting in the
 * fixture directory, unexamined, behind a literal three names long. The synthetic pull is kept, because
 * what it isolates is the *completion-instant* edge (a dot that expires inside the cast) and no
 * committed pull carries that shape; but it is no longer the only evidence, and "the field is not
 * graded because nothing ever trips it" is not a reason anyone can still give.
 *
 * **The audit is right and it is the stricter of the two readings.** The independent walk below asks
 * whether *any* enemy carried the dot; the audit asks whether the enemy actually being hit did. So the
 * walk's answer is a necessary condition on the audit's, and that containment — not an equality — is
 * what is asserted: two of the eight are moments when the player had no dot out anywhere at all
 * (73 165 and 360 987, both a Lava Burst landing about a second before the next application), and the
 * other six are presses onto an add that had none while some other add still did.
 *
 * How much chance the check had, per pull, is still stated rather than left implicit — a reader seeing
 * "zero on three pulls" has to be able to tell "the check never fires" from "the check had no chance to
 * fire". `cleave` and `phased` give it plenty — the dot is absent from the primary for eight and six
 * stretches, the longest 11.5s and 41.9s (the submerge) — and `unbroken` gives it almost none, which is
 * what its name says: 1553ms of pre-pull ramp and one 49ms seam, and no Lava Burst within either.
 *
 * The tightest near-miss anywhere is `cleave`'s press at 118 136, committed 264ms before the dot fell
 * at 118 400. That is one of the three hits §67a measured, and it reads as buffed here for the reason
 * §67a settled: the multiplier is decided at the cast and not at the impact.
 */
describe('Flame Shock under every Lava Burst the fixtures carry, or the absence of it', () => {
	/**
	 * Per fixture: the press count, and the dot's down stretches on the primary read off the log.
	 *
	 * **The grid is discovered and the primary is derived.** It was `['cleave', 'phased', 'unbroken']` with
	 * three hand-copied actor ids beside it, so `addsThenBoss.json` — 49 more presses, on the pull where a
	 * Lava Burst is most likely to go out with no dot under it — was never asked. The id now comes from
	 * `primaryTarget.id`, because an integer transcribed into a test is a second place the fixture has to
	 * be re-read by hand when it changes.
	 */
	const pulls: Record<
		string,
		{ presses: number; stretches: number; longest: number; dotLess: number[]; inDark: number[] }
	> = {
		addsThenBoss: {
			presses: 58,
			stretches: 2,
			longest: 442_020,
			dotLess: [17_204, 43_491, 73_165, 175_810, 177_344, 342_917, 360_987, 437_544],
			inDark: [73_165, 360_987],
		},
		cleave: { presses: 43, stretches: 8, longest: 11_496, dotLess: [], inDark: [] },
		phased: { presses: 49, stretches: 6, longest: 41_914, dotLess: [], inDark: [] },
		unbroken: { presses: 41, stretches: 2, longest: 1553, dotLess: [], inDark: [] },
	};

	for (const name of rawFixtures('elemental').map(({ name: file }) => file.replace(/\.json$/, ''))) {
		it(`${name}: the dot under every press, against a second walk of the log`, () => {
			const dataset = rawDataset(name);
			const analysis = analyse(dataset) as Analysis & ElementalAuditResult;
			const primary = analysis.primaryTarget?.id;
			expect(primary, `${name} has a primary target`).not.toBeUndefined();
			const down = fsDownStretches(dataset, primary!);
			const { lavaBurst } = analysis;
			const pinned = pulls[name];
			expect(pinned, `${name} is pinned here`).toBeDefined();

			// How much chance the check had on this pull, stated rather than left implicit — and on
			// `addsThenBoss` this is also the figure that disqualifies the primary as the comparison's other
			// side: 442 020ms of a 560 261ms pull, on a tower the player could not have dotted.
			expect(down).toHaveLength(pinned!.stretches);
			expect(Math.max(...down.map(([s, e]) => e - s))).toBe(pinned!.longest);

			expect(lavaBurst.presses).toHaveLength(pinned!.presses);
			// The audit's own ledger of dot-less presses, per pull — no longer empty everywhere, and pinned by
			// instant so that a press joining or leaving it is a diff and not a shrug.
			expect(lavaBurst.presses.filter((p) => p.flameShock === false).map((p) => p.t)).toEqual(pinned!.dotLess);
			// Nothing unreadable on any committed pull: every press resolved to an enemy to be judged against.
			expect(lavaBurst.presses.filter((p) => p.flameShock === null)).toEqual([]);

			// The independent side of the comparison, unioned over every **spawn** the dot was ever on so
			// that it means the same thing on one enemy and on seventeen. It is the weaker question — "did
			// anything carry the dot" against the audit's "did the enemy being hit" — so what it can assert
			// is containment: every press it calls dark, the audit must already call dot-less.
			const dark = fsDownEverywhere(dataset);
			expect(unionMs(dark), `${name} has dot-less stretches to test against`).toBeGreaterThan(0);
			const inDark = lavaBurst.presses.filter((p) => dark.some(([s, e]) => p.t > s && p.t < e));
			expect(inDark.map((p) => p.t)).toEqual(pinned!.inDark);
			for (const press of inDark) expect(press.flameShock, `${name} @ ${press.t}`).toBe(false);
		});
	}

	/** The near-miss named above, asserted rather than only described. */
	it('credits the press that committed 264ms before the dot fell', () => {
		const dataset = rawDataset('cleave');
		expect(fsDownStretches(dataset, 470)).toContainEqual([118_400, 120_417]);
		const { lavaBurst } = analyse(dataset) as Analysis & ElementalAuditResult;
		expect(lavaBurst.presses.find((p) => p.t === 118_136)?.flameShock).toBe(true);
	});
});

// ------------------------------------------------------------------ synthetic

const T0 = 400_000;
const DURATION = 120_000;
const ME = 2;
const BOSS = 12;

const LAVA_SURGE = 77_762;
const LAVA_BURST = 51_505;
const LIGHTNING_BOLT = 403;
const ASCENDANCE_CAST = 114_049;
const ASCENDANCE_BUFF = 114_050;

const e = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: T0 + t,
	type,
	abilityGameID: id,
	sourceID: ME,
	targetID: ME,
	...extra,
});

const hit = (t: number): WclEvent =>
	e(t, 'damage', LIGHTNING_BOLT, { targetID: BOSS, targetInstance: 1, amount: 1000, hitType: 1 });

/**
 * Contact in two segments, with a forty-second hole in the middle.
 *
 * A hit every five seconds is well inside the 15s gap that splits one contact stretch from the next, so
 * the pull reads as `[0, 40s]` and `[80s, 120s]` — an intermission the player could not cast into.
 */
const contact: WclEvent[] = [
	...Array.from({ length: 9 }, (_, i) => hit(i * 5000)),
	...Array.from({ length: 9 }, (_, i) => hit(80_000 + i * 5000)),
];

/**
 * Three surges, one for each answer the section can give.
 *
 *   10-20s   a Lava Burst at 15s inside it — consumed
 *   25-35s   nothing inside it, and the boss in reach — wasted
 *   50-60s   nothing inside it, and the boss away — not the player's fault
 */
const surgeEvents: WclEvent[] = [
	e(10_000, 'applybuff', LAVA_SURGE),
	e(20_000, 'removebuff', LAVA_SURGE),
	e(25_000, 'applybuff', LAVA_SURGE),
	e(35_000, 'removebuff', LAVA_SURGE),
	e(50_000, 'applybuff', LAVA_SURGE),
	e(60_000, 'removebuff', LAVA_SURGE),
];

/** Ascendance, so a press inside its fifteen seconds can be told from a press inside a surge. */
const ascendanceEvents: WclEvent[] = [
	e(90_000, 'cast', ASCENDANCE_CAST),
	e(90_000, 'applybuff', ASCENDANCE_BUFF),
	e(105_000, 'removebuff', ASCENDANCE_BUFF),
];

const lavaBursts: WclEvent[] = [
	e(5000, 'cast', LAVA_BURST, { targetID: BOSS, targetInstance: 1 }),
	e(15_000, 'cast', LAVA_BURST, { targetID: BOSS, targetInstance: 1 }),
	e(95_000, 'cast', LAVA_BURST, { targetID: BOSS, targetInstance: 1 }),
];

const synthetic: FightDataset = {
	code: 'ele-lvb',
	fight: {
		id: 4,
		name: 'Iron Qon',
		encounterID: 1662,
		kill: true,
		difficulty: 4,
		size: 25,
		startTime: T0,
		endTime: T0 + DURATION,
	},
	actor: { id: ME, name: 'Sparkstorm', type: 'Player' },
	actors: [
		{ id: ME, name: 'Sparkstorm', type: 'Player' },
		{ id: BOSS, name: 'Iron Qon', type: 'NPC', subType: 'Boss' },
	],
	events: [...contact, ...surgeEvents, ...ascendanceEvents, ...lavaBursts],
	table: {
		fight: {
			id: 4,
			name: 'Iron Qon',
			encounterID: 1662,
			kill: true,
			difficulty: 4,
			size: 25,
			startTime: T0,
			endTime: T0 + DURATION,
			enemyNPCs: [{ id: BOSS, gameID: 68_078 }],
		},
		damageDone: {
			entries: [
				{
					name: 'Sparkstorm',
					id: ME,
					type: 'Shaman',
					itemLevel: 553,
					total: 18_000,
					activeTime: DURATION,
					abilities: [{ guid: LIGHTNING_BOLT, name: 'Lightning Bolt', total: 18_000 }],
				},
			],
		},
	},
};

const el = analyse(synthetic) as Analysis & ElementalAuditResult;

describe('the three things a surge can come to', () => {
	it('reads the pull the way it was built', () => {
		expect(el.isSpec).toBe(true);
		expect(el.timeline?.contactSegments).toEqual([
			[0, 40_000],
			[80_000, 120_000],
		]);
	});

	it('tells consumed, wasted and forgiven apart', () => {
		expect(el.lavaBurst.procs).toEqual([
			// `judged` is the fourth state and it is orthogonal to the other three: this pull has one enemy
			// throughout, so every proc inside the contact clock was one the list wanted spent. The proc at
			// 50 000ms falls in the gap between the two contact segments, which is the same reason `wasted`
			// is false on it: there was nothing to cast at, so there was nothing to judge either.
			{ start: 10_000, end: 20_000, consumed: true, wasted: false, judged: true },
			{ start: 25_000, end: 35_000, consumed: false, wasted: true, judged: true },
			{ start: 50_000, end: 60_000, consumed: false, wasted: false, judged: false },
		]);
	});

	/** One fault out of two unconsumed procs: the count is the faults, not the misses. */
	it('charges only the one the player could have taken', () => {
		expect(el.lavaBurst.wasted).toBe(1);
	});
});

describe('what made each press free', () => {
	it('names the reset behind every Lava Burst', () => {
		// `flameShock: false` on all three because this pull contains no Flame Shock at all — the events
		// above are surges, Ascendance and Lightning Bolt. Not an incidental default: it is the field
		// answering the question, and the pull it answers about is a shaman who never dotted anything.
		expect(el.lavaBurst.presses).toEqual([
			{ t: 5000, surge: false, ascendance: false, flameShock: false },
			{ t: 15_000, surge: true, ascendance: false, flameShock: false },
			{ t: 95_000, surge: false, ascendance: true, flameShock: false },
		]);
	});
});

// -------------------------------------------- synthetic: Flame Shock under the press

/**
 * The dot-less Lava Burst, and the three edges around it — none of which any committed fixture has.
 *
 * Built rather than found because the search came up empty: `cleave`, `phased` and `unbroken` commit 133
 * Lava Bursts between them and every single one of them inside a dot window (see the fixture suite
 * above). So the fault this field exists to name has no real example in the repo, and the only way to
 * hold the behaviour still is a pull constructed to contain one.
 *
 * Four things it pins, in the order the presses fall:
 *
 *   5s   no dot yet — the plain fault, `false`.
 *   20s  dot up, `true`.
 *   39s  dot up at the **commit** and gone by the time the two-second cast completes at 41s. Reads
 *        `true`, and that is the whole §67/§67a argument in one row: the ×1.5 is decided when the
 *        button goes down, so a dot that ends mid-flight — or here, mid-cast — was already paid for.
 *        The player is not let off, either: the ladder refuses that press and charges it as a lost cast.
 *   70s  aimed at the **add**, which is dotted while the boss is not. Reads `true`, which is why the
 *        audit reads the dot per spawn rather than off the primary — a primary-scoped map would call a
 *        correct cleave Lava Burst a fault.
 *   75s  aimed at the boss while only the add is dotted. The same instant, the other answer: `false`.
 *   100s the cast event names **no target**, so the press falls back to the enemy the player was
 *        demonstrably hitting. The boss is dotted again by then, so `true` — the fallback resolving,
 *        not a silent `false`.
 */
const T0B = 900_000;
const ADD = 13;
const FLAME_SHOCK = 8050;

const eb = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: T0B + t,
	type,
	abilityGameID: id,
	sourceID: ME,
	targetID: ME,
	...extra,
});

/** One hit every three seconds on the boss: unbroken contact, and the fallback's answer at 100s. */
const dotContact: WclEvent[] = Array.from({ length: 40 }, (_, i) =>
	eb(i * 3000, 'damage', LIGHTNING_BOLT, { targetID: BOSS, targetInstance: 1, amount: 1000, hitType: 1 }),
);

/** The boss dotted twice with a hole in the middle, and the add dotted across that hole. */
const dotEvents: WclEvent[] = [
	eb(10_000, 'applydebuff', FLAME_SHOCK, { targetID: BOSS, targetInstance: 1 }),
	eb(40_000, 'removedebuff', FLAME_SHOCK, { targetID: BOSS, targetInstance: 1 }),
	eb(60_000, 'applydebuff', FLAME_SHOCK, { targetID: ADD, targetInstance: 1 }),
	eb(90_000, 'removedebuff', FLAME_SHOCK, { targetID: ADD, targetInstance: 1 }),
	eb(95_000, 'applydebuff', FLAME_SHOCK, { targetID: BOSS, targetInstance: 1 }),
	eb(119_000, 'removedebuff', FLAME_SHOCK, { targetID: BOSS, targetInstance: 1 }),
];

/** Each press a `begincast`/`cast` pair two seconds apart, so `begin` and `t` are visibly different. */
const dotBursts: WclEvent[] = [
	[5000, BOSS],
	[20_000, BOSS],
	[39_000, BOSS],
	[70_000, ADD],
	[75_000, BOSS],
].flatMap(([begin, target]) => [
	eb(begin as number, 'begincast', LAVA_BURST, { targetID: target, targetInstance: 1 }),
	eb((begin as number) + 2000, 'cast', LAVA_BURST, { targetID: target, targetInstance: 1 }),
]);

/** The press the log gave no target for — `targetID` explicitly absent, not pointed at the player. */
const untargetedBurst: WclEvent[] = [
	eb(100_000, 'begincast', LAVA_BURST, { targetID: undefined }),
	eb(102_000, 'cast', LAVA_BURST, { targetID: undefined }),
];

const dotPull: FightDataset = {
	...synthetic,
	code: 'ele-lvb-fs',
	fight: { ...synthetic.fight, startTime: T0B, endTime: T0B + DURATION },
	actors: [...synthetic.actors, { id: ADD, name: 'Molten Add', type: 'NPC' }],
	events: [...dotContact, ...dotEvents, ...dotBursts, ...untargetedBurst],
	table: {
		...synthetic.table,
		fight: {
			...synthetic.table.fight,
			startTime: T0B,
			endTime: T0B + DURATION,
			enemyNPCs: [
				{ id: BOSS, gameID: 68_078 },
				{ id: ADD, gameID: 68_079 },
			],
		},
	},
};

describe('Flame Shock under the press', () => {
	const { lavaBurst } = analyse(dotPull) as Analysis & ElementalAuditResult;

	it('reads the completion instant, so a dot that expires inside the cast is not credited', () => {
		// Every row's `t` is the `begincast`, two seconds before the cast it opened — so the stamps below
		// are commits while `flameShock` is read two seconds later. That split is the point, not an
		// oversight: the row says when the player pressed, the field says whether the game paid.
		expect(lavaBurst.presses.map((p) => p.t)).toEqual([5000, 20_000, 39_000, 70_000, 75_000, 100_000]);
		// **The third row is the whole reason this test exists.** The boss carries the dot over [10s, 40s].
		// That press commits at 39s — inside — and completes at 41s, outside. Read at the commit it would
		// say `true`, and the sim would have given it no multiplier: `ApplyEffects` tests the dot when the
		// cast completes. So the honest answer is `false`, and the press is charged as a *choice* by the
		// ladder's own rung instead, which refuses a press whose dot will not outlive the cast.
		expect(lavaBurst.presses.map((p) => p.flameShock)).toEqual([false, true, false, true, false, true]);
	});

	it('names the dot-less presses and nothing else', () => {
		// Three, not two: 39s joins them for the reason above.
		expect(lavaBurst.presses.filter((p) => p.flameShock === false).map((p) => p.t)).toEqual([5000, 39_000, 75_000]);
		// Nothing unreadable: every press resolved to an enemy, the last one through the hit fallback.
		expect(lavaBurst.presses.filter((p) => p.flameShock === null)).toEqual([]);
	});

	/**
	 * The independent read of the same two answers, off the constructed stream rather than off the field.
	 *
	 * The boss carries the dot over [10s, 40s] and [95s, 119s], so 5s and 75s are outside both and 20s,
	 * 39s and 100s are inside one — which is exactly the split above, arrived at without the audit.
	 */
	it('agrees with the dot windows the pull was built from', () => {
		const bossDown = fsDownStretches(dotPull, BOSS);
		expect(bossDown).toEqual([
			[0, 10_000],
			[40_000, 95_000],
			[119_000, DURATION],
		]);
		const aimedAtBoss = [5000, 20_000, 39_000, 75_000, 100_000];
		expect(aimedAtBoss.filter((t) => bossDown.some(([s, e]) => t > s && t < e))).toEqual([5000, 75_000]);
	});
});
