// The snapshot windows: where the p5 list's Flame Shock rule (priority 7) wants the dot reapplied.
//
// The rule is a trigger — the UVLS buff, the UVLS counter at ten, or Black Blood of Y'Shaarj at ten —
// **and** one of the int procs up at the same time, so the window a press is graded against is the
// *overlap* of the two rather than either one of them.
//
// Neither committed pull can be used here: `a:qHRAFwdGzaB6MPYC` #14 and `a:xB3kh7v9pF2AHRtq` #16 both
// report `{ windows: [], refreshed: 0, missed: 0 }`, because neither shaman wore any of the six items
// the rule reads. A synthetic pull is the only thing that can hold this section fixed at all.
import { describe, expect, it } from 'vitest';

import type { WclEvent } from '~/lib/events';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';
import { analyse } from '../index';

const T0 = 1_000_000;
const DURATION = 200_000;
const ME = 3;
const BOSS = 9;

const FLAME_SHOCK = 8050;
const LAVA_BURST = 51_505;
const LIGHTNING_BOLT = 403;

/** The three triggers, and the three int procs whose overlap with one is what the rule claims. */
const UVLS_BUFF = 138_963;
const UVLS_STACKS = 138_786;
const BLACK_BLOOD = 146_184;
const BREATH_OF_HYDRA = 138_898;
const CHAYES = 139_133;
const TEMPUS_REPIT = 137_590;

const e = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: T0 + t,
	type,
	abilityGameID: id,
	sourceID: ME,
	targetID: ME,
	...extra,
});

/** A hit every five seconds, so the pull is one unbroken stretch of contact. */
const contact: WclEvent[] = Array.from({ length: DURATION / 5000 + 1 }, (_, i) =>
	e(i * 5000, 'damage', LIGHTNING_BOLT, { targetID: BOSS, targetInstance: 1, amount: 1000, hitType: 1 }),
);

const onBoss = (t: number, type: string, id: number): WclEvent => e(t, type, id, { targetID: BOSS, targetInstance: 1 });

/**
 * The dot, in two windows with a thirty-second hole between them and a second hole inside the tail.
 *
 *   0-90s        up, refreshed on the clock
 *   90-120s      down
 *   120-132s     up
 *   132-135s     down
 *   135-150s     up again
 *
 * The holes are what make the three answers separable: a window the dot was never up through is not a
 * missed snapshot, and a Flame Shock pressed inside a window that *applied* the dot rather than
 * refreshing it did not renew a snapshot either.
 */
const dot: WclEvent[] = [
	onBoss(0, 'cast', FLAME_SHOCK),
	onBoss(0, 'applydebuff', FLAME_SHOCK),
	onBoss(25_000, 'refreshdebuff', FLAME_SHOCK),
	onBoss(27_999, 'refreshdebuff', FLAME_SHOCK),
	onBoss(28_000, 'cast', FLAME_SHOCK),
	onBoss(50_000, 'refreshdebuff', FLAME_SHOCK),
	onBoss(75_000, 'refreshdebuff', FLAME_SHOCK),
	onBoss(90_000, 'removedebuff', FLAME_SHOCK),
	onBoss(120_000, 'cast', FLAME_SHOCK),
	onBoss(120_000, 'applydebuff', FLAME_SHOCK),
	onBoss(132_000, 'removedebuff', FLAME_SHOCK),
	onBoss(135_000, 'cast', FLAME_SHOCK),
	onBoss(135_000, 'applydebuff', FLAME_SHOCK),
	onBoss(150_000, 'removedebuff', FLAME_SHOCK),
];

/**
 * Five trigger windows and four int-proc windows, arranged so every branch of the walk is taken.
 *
 * The triggers are deliberately **out of order relative to the walk's own iteration**: it visits the
 * UVLS buff first, the counter second and Black Blood last, and here those carry the pull's last,
 * middle and first windows. A walk that returned them unsorted would hand the section a window list
 * running 105s, 130s, 60s, 25s.
 */
const procs: WclEvent[] = [
	// Black Blood at ten, 20-30s. Breath of the Hydra 25-35s over it: overlap 25-30s.
	e(20_000, 'applybuff', BLACK_BLOOD),
	e(20_000, 'applybuffstack', BLACK_BLOOD, { stack: 10 }),
	e(30_000, 'removebuff', BLACK_BLOOD),
	e(25_000, 'applybuff', BREATH_OF_HYDRA),
	e(35_000, 'removebuff', BREATH_OF_HYDRA),
	// The UVLS counter at ten, 60-70s. Cha-Ye's 55-65s over it: overlap 60-65s.
	e(60_000, 'applybuff', UVLS_STACKS),
	e(60_000, 'applybuffstack', UVLS_STACKS, { stack: 10 }),
	e(70_000, 'removebuff', UVLS_STACKS),
	e(55_000, 'applybuff', CHAYES),
	e(65_000, 'removebuff', CHAYES),
	// The UVLS buff, 100-110s. Tempus Repit 105-115s over it: overlap 105-110s.
	e(100_000, 'applybuff', UVLS_BUFF),
	e(110_000, 'removebuff', UVLS_BUFF),
	e(105_000, 'applybuff', TEMPUS_REPIT),
	e(115_000, 'removebuff', TEMPUS_REPIT),
	// The UVLS buff again, 130-140s, with Breath of the Hydra 128-138s over it: overlap 130-138s.
	e(130_000, 'applybuff', UVLS_BUFF),
	e(140_000, 'removebuff', UVLS_BUFF),
	e(128_000, 'applybuff', BREATH_OF_HYDRA),
	e(138_000, 'removebuff', BREATH_OF_HYDRA),
	// The counter at ten again, 160-170s, with **no int proc anywhere near it** — the half of the rule
	// a log can actually be read for, and a trigger without it claims nothing.
	e(160_000, 'applybuff', UVLS_STACKS),
	e(160_000, 'applybuffstack', UVLS_STACKS, { stack: 10 }),
	e(170_000, 'removebuff', UVLS_STACKS),
];

const dataset: FightDataset = {
	code: 'ele-snap',
	fight: {
		id: 2,
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
	// A Lava Burst so `identify` accepts the pull as Elemental at all.
	events: [...contact, onBoss(500, 'cast', LAVA_BURST), ...dot, ...procs],
	table: {
		fight: {
			id: 2,
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
					total: 41_000,
					activeTime: DURATION,
					abilities: [{ guid: LIGHTNING_BOLT, name: 'Lightning Bolt', total: 41_000 }],
				},
			],
		},
	},
};

const el = analyse(dataset) as Analysis & ElementalAuditResult;
const { snapshots } = el;

describe('the window the rule actually claims', () => {
	it('is read as Elemental at all', () => {
		expect(el.isSpec).toBe(true);
	});

	/**
	 * The overlap, not the trigger. Every one of these is narrower than the trigger that opened it, and
	 * each is named for the trigger rather than for the int proc — the source is what the section prints
	 * and what the miss row quotes.
	 */
	it('is the trigger intersected with an int proc, in time order', () => {
		expect(snapshots.windows).toEqual([
			{ start: 25_000, end: 30_000, source: 'black-blood' },
			{ start: 60_000, end: 65_000, source: 'uvls-stacks' },
			{ start: 105_000, end: 110_000, source: 'unerring-vision' },
			{ start: 130_000, end: 138_000, source: 'unerring-vision' },
		]);
	});

	/** Five triggers went up and only four claimed anything: the fifth had no int proc beside it. */
	it('claims nothing for a trigger with no int proc over it', () => {
		expect(snapshots.windows.filter((w) => w.start >= 160_000)).toEqual([]);
	});
});

describe('what the section says happened inside each window', () => {
	/**
	 * The press at 28s, inside the 25-30s window, with the dot running — the one refresh on this pull
	 * that renewed a snapshot.
	 */
	it('counts a refresh that landed inside a window', () => {
		const press = el.flameShock.presses.find((p) => p.t === 28_000);
		expect(press?.remainingMs).not.toBeNull();
		expect(snapshots.refreshed).toBe(1);
	});

	/**
	 * Two windows the dot was up through and nobody refreshed it in.
	 *
	 * 60-65s had no Flame Shock press in it at all. 130-138s did — the press at 135s — but the dot had
	 * dropped at 132s, so that press *applied* the dot rather than refreshing it and renewed no
	 * snapshot. `remainingMs !== null` is what tells those two apart, and reading a bare press count
	 * would score the second window as a success.
	 */
	it('counts a window the dot sat through unrefreshed', () => {
		expect(el.flameShock.presses.find((p) => p.t === 135_000)?.remainingMs).toBeNull();
		expect(snapshots.missed).toBe(2);
	});

	/** The dot was down from 90s to 120s, so the 105-110s window is not a snapshot anyone missed. */
	it('says nothing about a window the dot was never up through', () => {
		expect(el.flameShock.windows).toEqual([
			{ start: 0, end: 90_000 },
			{ start: 120_000, end: 132_000 },
			{ start: 135_000, end: 150_000 },
		]);
		// Four windows, one refreshed and two missed: the third is neither.
		expect(snapshots.windows).toHaveLength(4);
		expect(snapshots.refreshed + snapshots.missed).toBe(3);
	});
});

describe('the ledger the section feeds', () => {
	it('lists one row per missed window, named for its trigger', () => {
		expect(
			el.misses
				.filter((m) => m.kind.startsWith('Snapshot missed'))
				.map((m) => ({ kind: m.kind, at: m.at, detail: m.detail })),
		).toEqual([
			{
				kind: 'Snapshot missed (uvls-stacks)',
				at: 60_000,
				detail: 'Flame Shock was up and was not refreshed inside the proc window',
			},
			{
				kind: 'Snapshot missed (unerring-vision)',
				at: 130_000,
				detail: 'Flame Shock was up and was not refreshed inside the proc window',
			},
		]);
	});

	it('agrees with the count the tile prints', () => {
		expect(el.misses.filter((m) => m.kind.startsWith('Snapshot missed'))).toHaveLength(snapshots.missed);
	});
});

/**
 * Whose trinket is it?
 *
 * The UVLS counter and Black Blood are worn by whoever has the trinket, so a raid-mate's counter
 * reaching ten is nothing to do with this shaman's dot. The walk used to read the whole raid's stream
 * for those two while reading the player's own for the trigger beside them and for the int procs it
 * intersects with, so another player's trinket opened a window here and the section reported a
 * `Snapshot missed` for an item the audited player was not wearing.
 *
 * Both pulls below carry the *same* int proc on the player and the *same* counter events; only the
 * actor the counter belongs to differs. The positive case is what stops this passing because the
 * harness stopped seeing counters at all.
 */
const RAID_MATE = 4;

const withCounterOn = (owner: number): Analysis & ElementalAuditResult => {
	const counter: WclEvent[] = [
		{ timestamp: T0 + 20_000, type: 'applybuff', abilityGameID: UVLS_STACKS, sourceID: owner, targetID: owner },
		{
			timestamp: T0 + 20_000,
			type: 'applybuffstack',
			abilityGameID: UVLS_STACKS,
			sourceID: owner,
			targetID: owner,
			stack: 10,
		},
		{ timestamp: T0 + 30_000, type: 'removebuff', abilityGameID: UVLS_STACKS, sourceID: owner, targetID: owner },
	];
	return analyse({
		...dataset,
		actors: [...dataset.actors, { id: RAID_MATE, name: 'Someone Else', type: 'Player' }],
		events: [
			...contact,
			onBoss(500, 'cast', LAVA_BURST),
			...dot,
			...counter,
			// Breath of the Hydra on the player either way, so the int-proc half of the rule is satisfied
			// and the only thing deciding the verdict is who owns the counter.
			e(25_000, 'applybuff', BREATH_OF_HYDRA),
			e(35_000, 'removebuff', BREATH_OF_HYDRA),
		],
	}) as Analysis & ElementalAuditResult;
};

describe('a trigger the audited player does not own', () => {
	it('claims a window when the counter is the player’s own', () => {
		const own = withCounterOn(ME).snapshots;
		expect(own.windows).toEqual([{ start: 25_000, end: 30_000, source: 'uvls-stacks' }]);
	});

	it('claims nothing when the counter belongs to someone else in the raid', () => {
		const el = withCounterOn(RAID_MATE);
		expect(el.snapshots.windows).toEqual([]);
		expect(el.snapshots.missed).toBe(0);
		// And no row reaches the ledger the section prints from, which is where the fabricated fault was
		// actually visible to a reader.
		expect(el.misses.filter((m) => m.kind.startsWith('snapshot'))).toEqual([]);
	});
});
