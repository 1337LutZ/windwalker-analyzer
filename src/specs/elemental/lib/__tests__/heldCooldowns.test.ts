// The held-cooldown ledger is reachable, and this is the pull that reaches it.
//
// The note this file answers said `hasHeldCooldowns` was **structurally false** — that `PLACEMENT_IDS`
// contains every cooldown that can drift, so the ledger's heading could never appear and everything
// behind it was dead. That is not what the registry says. `analyseCore` builds a `lostCasts` row for
// every ability declared `gate: 'cooldown'` that the log shows was pressed at least once, and the
// Elemental spec declares **five** of them:
//
//   ascendance         114049   180s   — in `PLACEMENT_IDS`, judged in its own section
//   elemental-mastery   16166    90s   — in `PLACEMENT_IDS`, judged in its own section
//   fire-elemental       2894   300s   — in `PLACEMENT_IDS`, judged in its own section
//   unleash-elements    73680    15s   — **not** in it
//   elemental-blast    117014    12s   — **not** in it
//
// So the gate is false on all four committed fixtures for a reason that has nothing to do with the
// placement set: both leftover buttons are talents, and none of the four players took either. That is a
// fact about the fixtures, which is exactly what `gates.ts` says in its own docstring — not a fact about
// the arithmetic.
//
// **And the gap that made the note plausible.** `components/sections/__tests__/cooldownSplit.test.ts`
// already pins the `true` branch, by appending a hand-written `Unleash Elements` row to `unbroken`'s
// analysis. That holds the gate's own arithmetic — the `cooldownSec > 0` test, the placement filter, the
// table that renders off it — but it hands the row over ready-made, so it steps around the only step
// anybody doubted: whether `analyseCore`'s `gate === 'cooldown'` filter and its `castTimes(ability).length`
// guard can produce such a row **from events at all**. A literal row proves the reader; it cannot prove
// the writer. This file drives `analyse` end to end instead, so the claim rests on the pipeline.
//
// Synthetic, because it has to be: the reachable half of the ledger needs a player who took one of the
// two talents, and no committed fixture does. Nothing here asserts a game fact — the cooldowns above are
// cited at their registry entries.

import { describe, expect, it } from 'vitest';

import type { WclEvent } from '~/lib/events';
import { getSpec } from '~/lib/spec';
import type { Analysis, ElementalAuditResult, FightDataset, LostCastRow } from '~/lib/types';

import { hasHeldCooldowns, heldCooldowns } from '../../components/sections/gates';
import { analyse } from '../index';

const T0 = 400_000;
const DURATION = 240_000;
const ME = 7;
const BOSS = 40;

const LIGHTNING_BOLT = 403;
const LAVA_BURST = 51_505;
const UNLEASH_ELEMENTS = 73_680;
const ELEMENTAL_BLAST = 117_014;
const ASCENDANCE = 114_049;

const at = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: T0 + t,
	type,
	abilityGameID: id,
	sourceID: ME,
	targetID: ME,
	...extra,
});

/**
 * Unbroken contact on the boss, plus the one Lava Burst that makes the pull read as Elemental at all.
 * Without it `isSpec` is false, the audit never runs, and every assertion below would pass vacuously
 * against an absent report — which is why `isSpec` is asserted before anything else.
 */
const contact: WclEvent[] = [
	at(500, 'cast', LAVA_BURST, { targetID: BOSS }),
	...Array.from({ length: DURATION / 2000 + 1 }, (_, i) =>
		at(i * 2000, 'damage', LIGHTNING_BOLT, { targetID: BOSS, amount: 1000, hitType: 1 }),
	),
];

const dataset = (events: WclEvent[]): FightDataset => {
	const meta = {
		id: 1,
		name: 'Iron Juggernaut',
		encounterID: 1704,
		kill: true,
		difficulty: 4,
		size: 25,
		startTime: T0,
		endTime: T0 + DURATION,
	};
	return {
		code: 'a:held',
		fight: meta,
		actor: { id: ME, name: 'Player (7)', type: 'Player' },
		actors: [
			{ id: ME, name: 'Player (7)', type: 'Player' },
			{ id: BOSS, name: 'Iron Juggernaut', type: 'NPC' },
		],
		events: [...contact, ...events].sort((a, b) => a.timestamp - b.timestamp),
		table: {
			fight: { ...meta, enemyNPCs: [{ id: BOSS, gameID: 71_965 }] },
			damageDone: {
				entries: [
					{
						name: 'Player (7)',
						id: ME,
						type: 'Shaman',
						itemLevel: 553,
						total: 121_000,
						activeTime: DURATION,
						abilities: [{ guid: LIGHTNING_BOLT, name: 'Lightning Bolt', total: 121_000 }],
					},
				],
			},
		},
	};
};

/**
 * A shaman who took both leftover talents and held both buttons, with an Ascendance press beside them.
 *
 * Every press is deliberately placed so the drift is arithmetic a reader can check rather than a number
 * out of the machine. Elemental Blast commits at 8s and lands at 10s; its 12s cooldown is back at 22s and
 * it is not pressed again until 60s, so the one window it was held is 38s less the leeway. Unleash
 * Elements lands at 20s, is back at 35s and is not pressed again until 100s: 65s. Ascendance is pressed
 * once and never held.
 *
 * The Ascendance press is the control on the *other* half of the filter, and it is here rather than
 * assumed: it produces a real `lostCasts` row on this pull, and the ledger still must not show it.
 */
const el = analyse(
	dataset([
		at(10_000, 'cast', ASCENDANCE, { targetID: BOSS }),
		at(8_000, 'begincast', ELEMENTAL_BLAST, { targetID: BOSS }),
		at(10_000, 'cast', ELEMENTAL_BLAST, { targetID: BOSS }),
		at(58_000, 'begincast', ELEMENTAL_BLAST, { targetID: BOSS }),
		at(60_000, 'cast', ELEMENTAL_BLAST, { targetID: BOSS }),
		at(20_000, 'cast', UNLEASH_ELEMENTS, { targetID: BOSS }),
		at(100_000, 'cast', UNLEASH_ELEMENTS, { targetID: BOSS }),
	]),
) as Analysis & ElementalAuditResult;

describe('the held-cooldown ledger', () => {
	it('is a report at all', () => {
		expect(el.isSpec).toBe(true);
		expect(el.durationMs).toBe(DURATION);
	});

	/**
	 * The premise, and the assertion the note on record actually turns on: the placement set does **not**
	 * cover every cooldown-gated button in the spec.
	 *
	 * Read through `heldCooldowns` rather than off `PLACEMENT_IDS`, which is private to `gates.ts` and
	 * should stay so — a test importing the set would be asserting the set against itself. One row per
	 * cooldown-gated ability, built from the registry so a sixth button added tomorrow arrives here
	 * without anyone editing a list, and each one asked the only question the ledger asks of it.
	 */
	it('covers three of the five cooldown-gated buttons on placement, and not the other two', () => {
		const cooldowns = getSpec('elemental')!.registry.abilities.filter((a) => a.gate === 'cooldown');
		expect(cooldowns.map((a) => a.castIds[0])).toEqual([UNLEASH_ELEMENTS, ELEMENTAL_BLAST, ASCENDANCE, 16_166, 2894]);
		const shown = cooldowns.filter((a) => {
			const row: LostCastRow = {
				id: a.castIds[0] ?? 0,
				name: a.name,
				casts: 1,
				lostCasts: 1,
				cooldownSec: (a.cooldownMs ?? 0) / 1000,
				driftSec: 30,
				openerSec: 0,
				tailSec: 0,
				worst: [],
			};
			return hasHeldCooldowns({ ...el, lostCasts: [row] });
		});
		expect(shown.map((a) => a.key)).toEqual(['unleash-elements', 'elemental-blast']);
	});

	/**
	 * **And the pipeline can write those rows, which is the half a hand-built row cannot show.**
	 *
	 * Both leftover buttons come out of `analyse` with a cooldown, a drift and a count of presses missed —
	 * so the ledger's heading has content to be a heading for, and the gate's `true` branch is a branch
	 * this codebase can reach rather than one it merely compiles.
	 */
	it('carries the two leftover buttons a real pull can hold', () => {
		expect(el.lostCasts.map((row) => row.id)).toEqual([UNLEASH_ELEMENTS, ELEMENTAL_BLAST, ASCENDANCE]);
		expect(heldCooldowns(el).map((row) => [row.id, row.cooldownSec, row.driftSec, row.lostCasts])).toEqual([
			[UNLEASH_ELEMENTS, 15, 65, 4],
			[ELEMENTAL_BLAST, 12, 36, 3],
		]);
		expect(hasHeldCooldowns(el)).toBe(true);
	});

	/**
	 * Ascendance drifted nothing on this pull, but it would not be in the ledger if it had: it is judged on
	 * where the press landed, in a section of its own. The one press here is enough to put it in
	 * `lostCasts`, which is what makes the exclusion an exclusion rather than an absence.
	 */
	it('leaves out the button judged on placement, which this pull does press', () => {
		expect(el.lostCasts.find((row) => row.id === ASCENDANCE)).toBeDefined();
		expect(heldCooldowns(el).map((row) => row.id)).not.toContain(ASCENDANCE);
	});

	/**
	 * Sorted by how long the button stood ready, longest first — the column a reader opens the table for.
	 * 65s before 36s, which is the reverse of both the registry order and the press order, so neither can
	 * be producing this by accident.
	 */
	it('puts the longest hold at the top', () => {
		expect(heldCooldowns(el).map((row) => row.driftSec)).toEqual([65, 36]);
	});
});
