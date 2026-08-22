import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { WclEvent } from '~/lib/events';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';
import { LADDER_ENTRIES, ROTATION } from '../apl';
import { analyse, registry } from '../index';

const T0 = 100_000;
const DURATION = 240_000;
const END = T0 + DURATION;
const ME = 5;
const BOSS = 20;

const SEARING_TOTEM = 3599;
const FIRE_ELEMENTAL = 2894;

const e = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: T0 + t,
	type,
	abilityGameID: id,
	sourceID: ME,
	targetID: ME,
	...extra,
});

/**
 * A hit every five seconds, so the contact clock is the whole pull.
 *
 * The denominator is contact time less the elemental's window, and a synthetic pull with three hits
 * in it would make every figure below a statement about `engagedWindows`' gap threshold instead of
 * about the Fire totem slot. Five seconds is well inside the 15s gap, so the clock is one window
 * running from the first hit to the last.
 */
const contact: WclEvent[] = Array.from({ length: DURATION / 5000 + 1 }, (_, i) =>
	e(i * 5000, 'damage', 403, { targetID: BOSS, amount: 1000, hitType: 1 }),
);

/**
 * One Fire totem slot, exercised through every transition it has.
 *
 *   0s     Searing Totem, on a clean slot
 *   30s    Fire Elemental, which destroys the totem
 *   60s    Searing Totem *under* the live elemental — the one press the list forbids, and it takes
 *          the elemental down with it
 *   100s   Searing Totem over a totem with 20s left, which is a clip
 *   235s   Searing Totem with five seconds of pull left, which is late
 */
const events: WclEvent[] = [
	...contact,
	e(0, 'cast', SEARING_TOTEM),
	e(30_000, 'cast', FIRE_ELEMENTAL),
	e(60_000, 'cast', SEARING_TOTEM),
	e(100_000, 'cast', SEARING_TOTEM),
	e(235_000, 'cast', SEARING_TOTEM),
];

const dataset: FightDataset = {
	code: 'ele123',
	fight: {
		id: 3,
		name: 'Iron Qon',
		encounterID: 1662,
		kill: true,
		difficulty: 4,
		size: 25,
		startTime: T0,
		endTime: END,
	},
	actor: { id: ME, name: 'Sparkstorm', type: 'Player' },
	// The boss is declared, and it has to be: `contact` — the clock this section is now measured against
	// — only counts hits on an id the actor list calls an NPC, so a pull that never declares its enemy has
	// an empty contact clock and every share of it is zero. It was absent while the denominator was the
	// primary target's `engaged` clock, which is built from the damage table's own target and needs no
	// actor list.
	actors: [
		{ id: ME, name: 'Sparkstorm', type: 'Player' },
		{ id: BOSS, name: 'Iron Qon', type: 'NPC', subType: 'Boss' },
	],
	events,
	table: {
		fight: {
			id: 3,
			name: 'Iron Qon',
			encounterID: 1662,
			kill: true,
			difficulty: 4,
			size: 25,
			startTime: T0,
			endTime: END,
			enemyNPCs: [{ id: BOSS, gameID: 68078 }],
		},
		damageDone: {
			entries: [
				{
					name: 'Sparkstorm',
					id: ME,
					type: 'Shaman',
					itemLevel: 553,
					total: 49_000,
					activeTime: DURATION,
					abilities: [{ guid: 403, name: 'Lightning Bolt', total: 49_000 }],
				},
			],
		},
	},
};

const el = analyse(dataset) as Analysis & ElementalAuditResult;
const { searingTotem } = el;
const press = (t: number) => searingTotem.presses.find((p) => p.t === t);

/**
 * There is one Fire totem slot and both summons take it — `registerSearingTotemSpell` disables the
 * Fire Elemental, `registerFireElementalTotem` deactivates the totem's dot — which is why priority 20
 * of the p5 list gates the totem on `!fire-elemental`.
 *
 * Both window sets used to be derived independently, from their own cast list plus a fixed minute, so
 * they overlapped: the graph drew a totem ticking through an elemental that had already destroyed it,
 * the uptime figure counted that stretch as kept, and a re-press after an elemental read as a clip of
 * a totem that was not there.
 */
describe('the one Fire totem slot', () => {
	it('cuts the totem short where the Fire Elemental takes the slot', () => {
		// [0, 30s) then [60s, 160s) — the 30s press ends the first, and the 60s and 100s presses join
		// into one run because merging joins windows that touch. Plus the late placement's five seconds.
		expect(searingTotem.windows).toEqual([
			{ start: 0, end: 30_000 },
			{ start: 60_000, end: 160_000 },
			{ start: 235_000, end: DURATION },
		]);
	});

	it('cuts the elemental short where a totem takes the slot back', () => {
		expect(searingTotem.feWindows).toEqual([{ start: 30_000, end: 60_000 }]);
	});

	it('never lets the two overlap', () => {
		for (const w of searingTotem.windows) {
			for (const fe of searingTotem.feWindows) {
				expect(w.end <= fe.start || w.start >= fe.end).toBe(true);
			}
		}
	});

	it('faults the placement made under a live elemental, and only that one', () => {
		expect(press(60_000)?.feOverlap).toBe(true);
		expect(searingTotem.feOverlaps).toBe(1);
		expect(press(0)?.feOverlap).toBe(false);
		expect(press(100_000)?.feOverlap).toBe(false);
	});

	/** The elemental destroyed the totem, so there was nothing left for the next press to clip. */
	it('reads no totem left on a press the elemental had already cleared', () => {
		expect(press(60_000)?.remainingMs).toBeNull();
		expect(press(60_000)?.clipped).toBe(false);
	});

	it('still reads the clip when the slot really did hold a healthy totem', () => {
		expect(press(100_000)?.remainingMs).toBe(20_000);
		expect(press(100_000)?.clipped).toBe(true);
		expect(searingTotem.clipped).toBe(1);
		expect(searingTotem.wastedMs).toBe(20_000);
	});
});

describe('what the Searing Totem uptime is measured against', () => {
	/**
	 * The elemental's window comes out of the denominator. A player cannot have a totem up while the
	 * elemental holds the slot, so scoring that time would fault correct play — held against the whole
	 * of the clock the section's thresholds were unreachable on any pull that pressed the elemental.
	 *
	 * The clock itself is `contact`, the player's, and on this pull that is also the whole 240s: one enemy,
	 * hit every five seconds with one modelled ability, so nothing separates it from the boss's own clock.
	 * Which is exactly why this pull cannot guard *which* clock — see `pulls.test.ts` for the real fixture
	 * whose two clocks are 32.7s apart, which can.
	 */
	it('drops the elemental’s window from the clock', () => {
		expect(el.timeline?.contactSegments).toEqual([[0, DURATION]]);
		expect(searingTotem.scoredMs).toBe(DURATION - 30_000);
	});

	it('measures both halves of the ratio over that same clock', () => {
		// 30s + 100s + 5s of totem, over the 210s the slot was the player's to fill.
		expect(searingTotem.uptimeMs).toBe(135_000);
		expect(searingTotem.uptimePct).toBeCloseTo((135_000 / 210_000) * 100, 6);
		// Which is the whole point of sharing a clock: two halves measured over different stretches is
		// how an uptime above 100% happens.
		expect(searingTotem.uptimePct).toBeLessThanOrEqual(100);
	});
});

/**
 * `fightEnd` is the absolute stamp `auraWindows` is handed and press times are fight-relative, so the
 * lateness test used to subtract one from the other and measure the pull's distance from the epoch.
 * No placement was ever late, on any log.
 */
describe('a placement made too late to be worth the global', () => {
	it('flags the press with five seconds of pull left', () => {
		expect(press(235_000)?.late).toBe(true);
		expect(searingTotem.latePlacements).toBe(1);
	});

	it('leaves the placements with a minute of pull ahead of them alone', () => {
		expect(press(0)?.late).toBe(false);
		expect(press(100_000)?.late).toBe(false);
	});
});

// ------------------------------------------------------------------ Magma Totem

/**
 * Magma Totem (8190), the fire totem slot's other occupant — declared so a press of it is not priced
 * at zero, and declared no further than the evidence goes.
 *
 * Found as a gap by an earlier lane: `3599` puts its dot on one unit, and 8190 is the sim's actual AoE
 * fire totem. Confirmed in `sim/shaman/fire_totems.go:71-108` — `:73` `ActionID{SpellID: 8190}`, `:76`
 * `Flags: core.SpellFlagAoE | core.SpellFlagAPL | SpellFlagShamanSpell`, `:91` `IsAOE: true`, `:101`
 * `CalcPeriodicAoeDamage` — and named "Magma Totem" in `assets/database/db.json`s `spellIcons`.
 *
 * The reason to declare it at all is the Chain Lightning failure, which needs no fixture to be true:
 * an undeclared cast id is skipped by the core's GCD walk, so every press is priced at zero occupied
 * time and `gcdUtilisationPct` — a graded metric — reads low for whoever uses the button.
 *
 * The reason to declare it *no further* is that no committed pull presses it, which the second test
 * here states as a number rather than implies.
 */
describe('Magma Totem is on the model, and no further', () => {
	it('resolves as an on-GCD button in the fire totem slot', () => {
		const magma = registry.ability('magma-totem');
		expect([magma.castIds, magma.onGcd, magma.gate]).toEqual([[8190], true, 'conditional']);
		// **No `damageIds`, on purpose.** Searing Totem's damage logs under 3606 rather than its cast id,
		// so Magma's is very likely its own id too and nothing available says which — `db.json` carries
		// cast ids only. Guessing one is how 120687 was wrong for three fixtures. Asserted rather than
		// left implicit, so adding an unsourced id has to come through this line.
		expect(magma.damageIds).toBeUndefined();
		// And no aura: an aura that fires in no fixture belongs on `fixtureCoverage.test.ts`s ledger, and
		// the fire-totem-slot interaction it would fix is named in the declaration rather than half-built.
		expect(registry.auras.some((a) => a.ids.includes(8190))).toBe(false);
	});

	/**
	 * **Not a red against the old behaviour — a measurement of the fixture set**, labelled on the line as
	 * `ascendance.test.ts` labels its own. It is the whole reason this entry claims so little: three
	 * single-target and light-cleave pulls are where nobody drops a five-target totem, so the absence
	 * says something about the fixtures and nothing about the id. It is also what makes the declaration
	 * safe — no committed figure can move on an id no committed pull writes.
	 */
	it('appears in no committed pull, while Searing Totem appears in all three', () => {
		for (const [name, searing] of [
			['phased', 4],
			['unbroken', 4],
			['cleave', 6],
		] as const) {
			const events = JSON.parse(
				readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8'),
			) as { events: Array<{ abilityGameID?: number }> };
			expect([name, events.events.filter((e) => e.abilityGameID === 8190).length]).toEqual([name, 0]);
			expect([name, events.events.filter((e) => e.abilityGameID === 3599 && 'type' in e).length]).toEqual([
				name,
				searing,
			]);
		}
	});

	/**
	 * **No rung, and that is the sim's answer rather than an omission of ours.**
	 *
	 * 8190 is in none of the five Elemental presets, so the AoE list really is Flame Shock, potion, Lava
	 * Beam, Chain Lightning. §91 took five rungs *out* of bands 3 and 4 for not being in `aoe.apl.json`;
	 * putting one in that no list contains would be that mistake in reverse. A deliberate no-change guard,
	 * not a red.
	 */
	it('is on no rung and in no reference row', () => {
		// Widened to `string` on purpose: `ELE_AplRuleKey` is a closed union, so the comparison is a
		// *compile* error while the rung does not exist — which is a stronger guard than this assertion and
		// the reason the cast is here rather than the check being dropped.
		expect((LADDER_ENTRIES as ReadonlyArray<{ key: string }>).some((e) => e.key === 'magma-totem')).toBe(false);
		expect(ROTATION.some((r) => r.key === 'magma-totem' || r.id === 8190)).toBe(false);
	});
});
