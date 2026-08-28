// The one rule in this audit that must not lose its floor to the parsing ruleset.
//
// Every other band cut takes the core's counted `>= 2` series, and in parsing mode a struck body is not
// in it — a unit whose damage WarcraftLogs will not count is not evidence the pull was worth cleaving.
// The multi-dot rung is the exception, because the second dot is not paid for by the body it sits on:
// Flame Shock's ticks roll Lava Surge, the procs are spent on Lava Burst, and those land on the primary.
// The global funnels into single-target damage whatever the add's own health bar is worth.
//
// **No committed Elemental pull is on an encounter the ruleset names**, so nothing here can be measured
// off a fixture as it stands — which is exactly how this regression would have shipped green. So the pull
// is relabelled instead: real events, real dots, real target series, with one enemy re-registered as an
// NPC the ruleset strikes with `reach: 'both'`. That is the narrowest change that puts a strike in front
// of this spec, and it changes nothing about what the shaman did.

import { describe, expect, it } from 'vitest';

import { rawFixture } from '~/lib/analysis/fixtures';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';
import { analyse as analyseElemental } from '~/specs/elemental';

/** The audit's own half of the result, which is where the multi-dot figures live. */
const analyse = (dataset: FightDataset, mode: 'parsing' | 'progression') =>
	analyseElemental(dataset, undefined, mode) as Analysis & ElementalAuditResult;

/** Paragons of the Klaxxi at its classic registration, where `Blood` (71542) is struck as `both`. */
const PARAGONS = 51_593;
const BLOOD = 71_542;
const HEROIC = 4;

/**
 * The second-busiest enemy of the pull, which is the body the multi-dot rung is about.
 *
 * Read off the damage rather than named, so the relabel lands on whichever add this fixture actually
 * offered as a second target — the same question `secondaryID` asks inside the audit.
 */
function secondBusiest(dataset: FightDataset): number {
	const hits = new Map<number, number>();
	for (const event of dataset.events) {
		if (event.type !== 'damage' || event.sourceID !== dataset.actor.id) continue;
		if (event.targetID === undefined) continue;
		hits.set(event.targetID, (hits.get(event.targetID) ?? 0) + 1);
	}
	const ranked = [...hits.entries()].sort((a, b) => b[1] - a[1]);
	const second = ranked[1]?.[0];
	if (second === undefined) throw new Error('fixture has no second target to strike');
	return second;
}

/** The same pull, with one enemy re-registered as the NPC the ruleset strikes. */
function withStruckSecondary(dataset: FightDataset): FightDataset {
	const target = secondBusiest(dataset);
	const npcs = (dataset.table.fight.enemyNPCs ?? []).map((npc) =>
		npc.id === target ? { ...npc, gameID: BLOOD } : npc,
	);
	return {
		...dataset,
		fight: { ...dataset.fight, encounterID: PARAGONS, difficulty: HEROIC },
		table: { ...dataset.table, fight: { ...dataset.table.fight, enemyNPCs: npcs } },
	};
}

describe('the multi-dot rung against a body the ruleset strikes', () => {
	const base = rawFixture('elemental', 'cleave.json');
	const struck = withStruckSecondary(base);

	it('still grades the second dot in parsing mode', () => {
		const parsing = analyse(struck, 'parsing');
		// The clock the rule is graded over. Zero is this metric's "cannot say", and before the floor moved
		// to the dot series it was exactly what parsing mode produced here: the struck add stopped raising
		// the count, so the audit reported no stretch at two enemies on a pull with a dotted second target.
		expect(parsing.flameShock.multiTargetMs).toBeGreaterThan(0);
		expect(parsing.flameShock.multiDotUptimePct).toBeGreaterThan(0);
	});

	it('grades it identically to progression mode, because the strike is not about this rule', () => {
		const parsing = analyse(struck, 'parsing');
		const progression = analyse(struck, 'progression');
		expect(parsing.flameShock.multiTargetMs).toBe(progression.flameShock.multiTargetMs);
		expect(parsing.flameShock.multiDotUptimeMs).toBe(progression.flameShock.multiDotUptimeMs);
	});

	it('leaves the strike doing its job everywhere else on the same pull', () => {
		const parsing = analyse(struck, 'parsing');
		const progression = analyse(struck, 'progression');
		// The proof that the relabel took: parsing mode reads a different pull from progression mode. If
		// these matched, the two assertions above would be comparing a strike against itself and would pass
		// on any implementation at all.
		expect(parsing.targets?.multiTargetPct).not.toBe(progression.targets?.multiTargetPct);
	});

	it('changes nothing on the pull as committed, where no NPC is struck', () => {
		const parsing = analyse(base, 'parsing');
		const progression = analyse(base, 'progression');
		expect(parsing.flameShock.multiTargetMs).toBe(progression.flameShock.multiTargetMs);
		expect(parsing.targets?.multiTargetPct).toBe(progression.targets?.multiTargetPct);
	});
});
