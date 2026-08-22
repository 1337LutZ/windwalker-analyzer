// Two claims a Flame Shock press can be graded against, and the one the audit now uses.
//
// `spawnAt(t)` answers "which enemy was the player hitting", which is right for an Earth Shock — a rule
// about the enemy in front of you. A Flame Shock press is the one case where aim and contact diverge by
// *design*: the cleave rule's whole point is a second dot on an add while every hit either side of it
// lands on the boss. Graded against the hit enemy, that deliberate multi-dot reads as a refresh of a dot
// already up, and is charged as a wasted global for doing what the priority list asked.
//
// Neither committed fixture can hold this fixed: on both, every Flame Shock cast names the boss and every
// dot event is already sourced to the player, so both behaviours are provably inert there. That is the
// right answer and not a demonstration, so this is synthetic — and every assertion below was checked
// against the previous reading, with the ones that flip named in their comments.
import { describe, expect, it } from 'vitest';

import type { WclEvent } from '~/lib/events';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';
import { analyse } from '../index';

const T0 = 700_000;
const DURATION = 120_000;
const ME = 11;
const OTHER_SHAMAN = 12;
const BOSS = 50;
const ADD = 51;

const FLAME_SHOCK = 8050;
const LAVA_BURST = 51_505;
const LIGHTNING_BOLT = 403;

const at = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: T0 + t,
	type,
	abilityGameID: id,
	sourceID: ME,
	targetID: ME,
	...extra,
});

/** Contact on the boss throughout, so nothing here is forgiven as an intermission. */
const contact: WclEvent[] = Array.from({ length: DURATION / 2000 + 1 }, (_, i) =>
	at(i * 2000, 'damage', LIGHTNING_BOLT, { targetID: BOSS, amount: 1000, hitType: 1 }),
);

const dataset = (events: WclEvent[]): FightDataset => {
	const meta = {
		id: 1,
		name: 'Kor’kron Dark Shaman',
		encounterID: 1623,
		kill: true,
		difficulty: 4,
		size: 25,
		startTime: T0,
		endTime: T0 + DURATION,
	};
	return {
		code: 'a:aimed',
		fight: meta,
		actor: { id: ME, name: 'Player (11)', type: 'Player' },
		actors: [
			{ id: ME, name: 'Player (11)', type: 'Player' },
			{ id: OTHER_SHAMAN, name: 'Player (12)', type: 'Player' },
			{ id: BOSS, name: 'Haromm', type: 'NPC' },
			{ id: ADD, name: 'Toxic Mist', type: 'NPC' },
		],
		events: [...contact, ...events].sort((a, b) => a.timestamp - b.timestamp),
		table: {
			fight: {
				...meta,
				enemyNPCs: [
					{ id: BOSS, gameID: 71858 },
					{ id: ADD, gameID: 71859 },
				],
			},
			damageDone: {
				entries: [
					{
						name: 'Player (11)',
						id: ME,
						type: 'Shaman',
						itemLevel: 553,
						total: 60_000,
						activeTime: DURATION,
						abilities: [{ guid: LIGHTNING_BOLT, name: 'Lightning Bolt', total: 60_000 }],
					},
				],
			},
		},
	};
};

/**
 * A deliberate multi-dot: the boss carries the dot from the pull, and at 40s the player puts a second one
 * on an add without ever stopping hitting the boss.
 *
 * Graded against the *hit* enemy that add press reads as a refresh of the boss's dot with ~20s left —
 * a wasted global. Graded against the enemy it was aimed at, it is a fresh application on an enemy that
 * had nothing.
 */
describe('a Flame Shock aimed at an add while the player hits the boss', () => {
	const el = analyse(
		dataset([
			at(500, 'cast', LAVA_BURST, { targetID: BOSS }),
			at(1000, 'cast', FLAME_SHOCK, { targetID: BOSS }),
			at(1000, 'applydebuff', FLAME_SHOCK, { targetID: BOSS }),
			// Refreshed at 25s, so the boss's dot is genuinely live when the add press lands at 40s. This
			// refresh is load-bearing: `remainingAtCast` reads the *declared* 30s duration forward from the
			// last event, so without it the boss's dot expires at 31s, both readings agree the add press
			// applied a dot, and the test demonstrates nothing. (It did, until this line was added.)
			at(25_000, 'cast', FLAME_SHOCK, { targetID: BOSS }),
			at(25_000, 'refreshdebuff', FLAME_SHOCK, { targetID: BOSS }),
			at(55_000, 'removedebuff', FLAME_SHOCK, { targetID: BOSS }),
			// The multi-dot. Aimed at the add; every hit around it is on the boss.
			at(40_000, 'cast', FLAME_SHOCK, { targetID: ADD }),
			at(40_000, 'applydebuff', FLAME_SHOCK, { targetID: ADD }),
			at(70_000, 'removedebuff', FLAME_SHOCK, { targetID: ADD }),
		]),
	) as Analysis & ElementalAuditResult;

	it('is read as Elemental', () => {
		expect(el.isSpec).toBe(true);
	});

	/**
	 * The point of the file, and it flips: graded against the hit spawn this press read
	 * `remainingMs: 15_000` — the boss's dot, 15s from expiry — and was counted a refresh.
	 */
	it('reads the add press as a fresh application, not an early refresh', () => {
		const press = el.flameShock.presses.find((p) => p.t === 40_000);
		expect(press?.remainingMs).toBeNull();
		expect(press?.windowed).toBe(false);
		// Two applies (the boss at the pull, the add at 40s) and one refresh (the boss at 25s). Against the
		// hit spawn it was one apply and two refreshes — the add's dot counted as the boss's being renewed.
		expect(el.flameShock.applies).toBe(2);
		expect(el.flameShock.refreshes).toBe(1);
	});

	/** The uptime figure stays on the primary's own union — the add's dot is not the boss's coverage. */
	it('leaves the primary uptime measured on the primary', () => {
		expect(el.flameShock.windows).toEqual([{ start: 1000, end: 55_000 }]);
	});
});

/**
 * A second Elemental shaman keeps their own Flame Shock on the same boss.
 *
 * The walk used to read every source, so the other shaman's apply at 5s and remove at 95s folded into
 * this player's windows and credited them with 90s of coverage they did not provide.
 */
describe('another shaman’s dot on the same boss', () => {
	const foreign = (t: number, type: string): WclEvent => ({
		timestamp: T0 + t,
		type,
		abilityGameID: FLAME_SHOCK,
		sourceID: OTHER_SHAMAN,
		targetID: BOSS,
	});

	const el = analyse(
		dataset([
			at(500, 'cast', LAVA_BURST, { targetID: BOSS }),
			// This player's dot: one short window early on.
			at(1000, 'cast', FLAME_SHOCK, { targetID: BOSS }),
			at(1000, 'applydebuff', FLAME_SHOCK, { targetID: BOSS }),
			at(21_000, 'removedebuff', FLAME_SHOCK, { targetID: BOSS }),
			// The other shaman's dot, and deliberately *after* this player's has ended rather than
			// overlapping it. An overlapping foreign dot interleaves into one window and the walk comes out
			// the same either way — it has to be a stretch that exists only because of them.
			foreign(30_000, 'applydebuff'),
			foreign(95_000, 'removedebuff'),
		]),
	) as Analysis & ElementalAuditResult;

	/**
	 * Against every source this returned two windows — `[1000, 21_000]` plus the other shaman's
	 * `[30_000, 95_000]` — for 85s of "coverage" where this player provided 20s.
	 */
	it('counts only this player’s own coverage', () => {
		expect(el.flameShock.windows).toEqual([{ start: 1000, end: 21_000 }]);
		expect(el.flameShock.uptimeMs).toBe(20_000);
		expect(el.flameShock.applies).toBe(1);
	});
});

/**
 * The same multi-dot, with a **cast time on the Flame Shock press** — which is the one thing that can
 * break the coupling the block above is built on, and the one thing no committed pull contains.
 *
 * `fsAimedAt` is a map from a press instant to the spawn that press was aimed at, and `fsCasts` is the
 * list of instants looked up in it. Both come off `fsPressAt` — one accessor, declared beside them, so
 * that a clock change moves the key and every reader of it together. Written out independently, as they
 * were, moving one alone was a one-character edit whose failure is *silent*: `fsAimedAt.get(t)` misses,
 * the `?? spawnAt(t)` fallback answers with the enemy the player was hitting, and the deliberate
 * multi-dot is charged as a wasted refresh — exactly the misgrade the whole aimed-at reading exists to
 * prevent. `analyseCore`'s `Handles` names this as one of the two traps its ruling does not settle.
 *
 * So the fixture gives the add press a two-second cast, making `begin` (40s) and `t` (42s) different
 * instants for the first time. Two things then have to hold at once, and they fail for different
 * reasons:
 *
 *   - the press is stamped at **42 000**, which pins the clock this block is read on;
 *   - the press still resolves to the **add**, which pins the key and the reader to the *same* clock.
 *     Break either side alone and this one flips to the boss with nothing raised.
 *
 * Two seconds because `measureCastDurations` reads anything under 100 ms as an instant, which would
 * collapse `begin` into `t` and leave the test unable to fail.
 */
describe('an aimed Flame Shock with a cast time', () => {
	const el = analyse(
		dataset([
			at(500, 'cast', LAVA_BURST, { targetID: BOSS }),
			at(1000, 'cast', FLAME_SHOCK, { targetID: BOSS }),
			at(1000, 'applydebuff', FLAME_SHOCK, { targetID: BOSS }),
			// The boss's dot kept live across the add press, for the reason the sibling suite above gives:
			// without it both readings agree that the add press applied a fresh dot and nothing is shown.
			at(25_000, 'cast', FLAME_SHOCK, { targetID: BOSS }),
			at(25_000, 'refreshdebuff', FLAME_SHOCK, { targetID: BOSS }),
			at(55_000, 'removedebuff', FLAME_SHOCK, { targetID: BOSS }),
			// The multi-dot, committed at 40s and landing at 42s. Aimed at the add; every hit either side
			// of it is on the boss.
			at(40_000, 'begincast', FLAME_SHOCK, { targetID: ADD }),
			at(42_000, 'cast', FLAME_SHOCK, { targetID: ADD }),
			at(42_000, 'applydebuff', FLAME_SHOCK, { targetID: ADD }),
			at(70_000, 'removedebuff', FLAME_SHOCK, { targetID: ADD }),
		]),
	) as Analysis & ElementalAuditResult;

	it('is read as Elemental', () => {
		expect(el.isSpec).toBe(true);
	});

	/**
	 * The clock. Every reader in the Flame Shock block joins against an event stream — the dot's aura
	 * timeline, its ticks, its `refreshdebuff` stamps — and all of those exist on the `cast`, so the press
	 * list is the landing. Read at the commit this row would be stamped 40 000.
	 */
	it('stamps the press at the landing, where the dot events are', () => {
		expect(el.flameShock.presses.map((p) => p.t)).toEqual([1000, 25_000, 42_000]);
	});

	/**
	 * The coupling, and it is the assertion that goes quiet rather than loud when it breaks. A missed
	 * lookup is indistinguishable from a press whose target the log omitted: both take the fallback, and
	 * the fallback's answer here is the boss, whose dot has 13s left at 42s. So the failure mode is
	 * `remainingMs: 13_000` and a third refresh — a correct cleave press reported as a wasted global.
	 */
	it('still resolves the press to the enemy it was aimed at', () => {
		const press = el.flameShock.presses.find((p) => p.t === 42_000);
		expect(press?.remainingMs).toBeNull();
		expect(press?.windowed).toBe(false);
		expect(el.flameShock.applies).toBe(2);
		expect(el.flameShock.refreshes).toBe(1);
	});
});
