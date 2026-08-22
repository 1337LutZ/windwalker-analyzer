// The two cast clocks, on the two Elemental sites where the choice is load-bearing and no committed
// pull can exercise it.
//
// `analyseCore`'s `Handles` ruling splits every cast reading three ways — a **choice** reads
// `castBeginTimes`, an **effect** reads `castTimes`, a **join key** reads whichever clock the other side
// is stamped on — and records that eighteen of the twenty readers across the two specs read a button
// with no cast time at all. `begin === t` on every one of them, so the clock each site picked has never
// been tested, and re-pointing any of them would move numbers no fixture can catch.
//
// Two of the Elemental sites are worth pinning rather than commenting, and this file is those two:
//
//   1. **`ascendanceReadyInSec` is on the landing**, because `5cde12d` settled from the simulator that a
//      cooldown is armed when the cast *completes* — `triggerCooldown` is called only from
//      `Hardcast.OnComplete`. Five blocks read that helper (Flame Shock, Earth Shock, Elemental Mastery,
//      Fire Elemental, Earth Elemental), so it is the single widest clock decision in the spec, and the
//      one an audit is most likely to get backwards: the *list* it reads looks like a press list being
//      graded, and the readings hanging off it look like choices. They are not — they are a cooldown's
//      arming instant, and the commit would make every one of them early by the cast time.
//
//   2. **The Fire Elemental press verdict is on the commit**, and the *same button's* slot-occupancy
//      walk is on the landing. Two readings of one cast list on opposite sides of the ruling, coexisting
//      only because the summon is an instant.
//
// Both pulls below are synthetic and both are contrived on purpose: they give a button a cast time it
// does not have in the game, because that is the only way to make the two clocks disagree. Nothing here
// asserts a game fact — the game facts are cited at the sites. What it holds still is which of two
// instants each site reads, on a pull where they differ.
import { describe, expect, it } from 'vitest';

import type { WclEvent } from '~/lib/events';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';
import { analyse } from '../index';

const T0 = 400_000;
const DURATION = 240_000;
const ME = 7;
const BOSS = 40;

const ASCENDANCE = 114_049;
const ASCENDANCE_BUFF = 114_050;
const ELEMENTAL_MASTERY = 16_166;
const FIRE_ELEMENTAL = 2894;
const LIGHTNING_BOLT = 403;
const LAVA_BURST = 51_505;

const at = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: T0 + t,
	type,
	abilityGameID: id,
	sourceID: ME,
	targetID: ME,
	...extra,
});

/**
 * Unbroken contact on the boss, so nothing below is forgiven as an intermission — plus the one Lava
 * Burst that makes the pull read as Elemental at all. Without it `isSpec` is false, the audit is not
 * run and every assertion in the file passes vacuously on an `undefined`; it is here so the two suites
 * are testing a report rather than an absence.
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
		code: 'a:clocks',
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
 * A two-second Ascendance — a cast time the button does not have — pressed once, and one Elemental
 * Mastery placed so that the two clocks give it **different verdicts** and not merely different numbers.
 *
 * Ascendance commits at 10s and lands at 12s. Its cooldown is 180s, so it is back at 192s on the landing
 * clock and at 190s on the commit clock. The Elemental Mastery press is at 107s, which makes
 * `ascendanceReadyInSec` exactly **85.0s** read at the landing and **83.0s** read at the commit — and 85
 * is the boundary of rule 9's `off-far` arm (`!t15Active && ascReady >= 85`). So the landing gives the
 * press a reason and the commit gives it none: `'off-far'` against `null`.
 *
 * The instant chosen for the Elemental Mastery press is the whole design of the fixture. Anywhere else
 * in the pull both clocks land in the same arm and the assertion would be two seconds of arithmetic
 * nobody would notice breaking; on the boundary the arm itself changes, which is a verdict a reader of
 * the report would see.
 */
describe('the cooldown a press is measured against is armed at the landing', () => {
	const el = analyse(
		dataset([
			at(10_000, 'begincast', ASCENDANCE, { targetID: BOSS }),
			at(12_000, 'cast', ASCENDANCE, { targetID: BOSS }),
			// The buff opens with the landing, which is the other half of the same sim fact: an effect
			// starts when the cast completes. Only here so the aura lane is a real window rather than empty.
			at(12_000, 'applybuff', ASCENDANCE_BUFF),
			at(27_000, 'removebuff', ASCENDANCE_BUFF),
			// Instant and off the GCD, as in the game — this press is the *reader*, not the thing being
			// clocked, so it deliberately has no cast time of its own to confuse the reading.
			at(107_000, 'cast', ELEMENTAL_MASTERY),
			at(107_000, 'applybuff', ELEMENTAL_MASTERY),
			at(127_000, 'removebuff', ELEMENTAL_MASTERY),
		]),
	) as Analysis & ElementalAuditResult;

	it('is read as Elemental', () => {
		expect(el.isSpec).toBe(true);
	});

	/** The pull carries the two presses it was built from and nothing else stamped like them. */
	it('reads both presses', () => {
		expect(el.ascendance?.presses.map((p) => p.t)).toEqual([12_000]);
		expect(el.elementalMastery?.presses.map((p) => p.t)).toEqual([107_000]);
	});

	/**
	 * The point of the fixture. `85` is `(12_000 + 180_000 - 107_000) / 1000` — the **landing** plus the
	 * cooldown. Read at the commit it is 83, and 83 fails `>= 85`, so the press loses its reason
	 * entirely.
	 *
	 * Not derived from the audit's own output on either side: both numbers are computed from the two
	 * stamps this file wrote into the stream, 10 000 and 12 000, and the 180s cooldown the model
	 * declares.
	 */
	it('measures Ascendance from the cast it completed, not the cast it began', () => {
		const press = el.elementalMastery?.presses[0];
		expect(press?.ascReadySec).toBe(85);
		expect(press?.reason).toBe('off-far');
	});

	/**
	 * The same helper, read from a second block, so the pin covers more than one caller.
	 *
	 * `ascendance.presses[0].t` is the Ascendance press's own stamp and is the landing for the same
	 * reason `ascendanceReadyInSec` is: `ascendanceSync` is handed the landing list, and the fifteen
	 * seconds it measures against the kill are the window the game opens at the completion. Read at the
	 * commit this would be 10 000.
	 */
	it('stamps the Ascendance press itself at the landing too', () => {
		expect(el.ascendance?.presses[0]?.t).toBe(12_000);
		expect(el.timeline?.lanes.find((l) => l.key === 'ascendance')?.windows).toEqual([{ start: 12_000, end: 27_000 }]);
	});
});

/**
 * The Fire Elemental, whose cast list this file's subject reads **twice on opposite clocks**.
 *
 * The summon commits at 100s and lands at 101s — a one-second cast time it does not have in the game,
 * for the same reason as above. Then:
 *
 *   - the **press row** is stamped at the commit, 100 000, because its verdict is a claim about what the
 *     player knew when they chose: how much pull was left to spend the summon in;
 *   - the **slot walk** is stamped at the landing, 101 000, because the game destroys whatever was in
 *     the one Fire totem slot when the new summon arrives, not when the player starts pressing.
 *
 * One millisecond of contrivance separating two readings that are the same number on every real pull.
 * The gap is 1 000ms rather than 100 because `measureCastDurations` treats anything under `MIN_CAST_MS`
 * as an instant, which would collapse the two and make this test unable to fail.
 */
describe('one cast list read on both clocks at once', () => {
	const el = analyse(
		dataset([
			at(100_000, 'begincast', FIRE_ELEMENTAL),
			at(101_000, 'cast', FIRE_ELEMENTAL),
			at(101_000, 'applybuff', 118_291),
			at(161_000, 'removebuff', 118_291),
		]),
	) as Analysis & ElementalAuditResult;

	/**
	 * The verdict row on the commit. `duration - t` is 140s, which is under the 150s the `sync` arm asks
	 * for but with Ascendance never pressed `ascendanceReadyInSec` returns 0, so `sync` claims it — the
	 * arm is not the assertion, the **stamp** is.
	 */
	it('stamps the graded press at the commit', () => {
		expect(el.fireElemental?.presses.map((p) => p.t)).toEqual([100_000]);
		expect(el.fireElemental?.prepull).toBe(false);
	});

	/**
	 * The slot walk on the landing, off the same button's same cast. Were the two sharing one binding this
	 * window would open at 100 000 and the Searing Totem denominator beside it would lose a second of
	 * slot the elemental was not yet standing in.
	 */
	it('opens the summon’s window at the landing', () => {
		expect(el.searingTotem?.feWindows).toEqual([{ start: 101_000, end: 161_000 }]);
	});

	/** And the two really are different instants here, which is what makes the pair above an assertion. */
	it('has the two clocks a second apart on this pull', () => {
		expect(el.searingTotem?.feWindows?.[0]?.start).not.toBe(el.fireElemental?.presses[0]?.t);
	});
});
