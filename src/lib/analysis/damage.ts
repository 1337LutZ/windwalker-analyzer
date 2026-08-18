import { abilityIdOf, type DamageEvent } from '~/lib/events';
import type { Registry } from '~/lib/game/registry';
import type { AbilityDamage } from '~/lib/types';

const CRIT = 2;

export interface DamageAggregate {
	abilities: AbilityDamage[];
	/**
	 * Sum of the `amount` field over the damage events. Runs a few percent above WarcraftLogs' own
	 * damage-done total because it counts overkill, which is why per-ability shares are taken against
	 * it rather than against the site's number.
	 */
	eventTotal: number;
}

/**
 * Per-ability damage totals, biggest first.
 *
 * Rows are grouped through the registry, not by raw spell id, because a button and its damage are
 * usually two different ids and sometimes several: Rushing Jade Wind is cast as 116847 and lands as
 * 148187, and a channel's ticks carry the tick id. Grouping by id splits one ability across two rows
 * and halves both shares.
 *
 * That same lookup is what splits the table into pressed and passive. An id no ability claims had no
 * cast behind it — autoattacks, Tiger Strikes, trinket and enchant procs, external buffs — and those
 * are a readout of gear rather than something to coach.
 *
 * `ignoredTargets` are actors the spec has decided do not count as useful multi-target damage — see
 * `ignoredMultiTargetActorIDs` in `spec/windwalker.ts`, which is where the list lives and the only
 * place it is resolved. They are dropped from the fan-out count and **only** from it: the damage was
 * dealt and belongs in the table, but a swing that spread across four enemies the spec does not count
 * is not evidence that an area button had four targets. Without this the per-moment target count and
 * the fan-out disagreed about the same pull, one applying the list and the other not.
 */
export function aggregateDamage(
	damageEvents: readonly DamageEvent[],
	registry: Registry,
	nameOf: (id: number) => string,
	ignoredTargets: ReadonlySet<number> = new Set(),
): DamageAggregate {
	const rows = new Map<
		string,
		{
			id: number;
			name: string;
			passive: boolean;
			utility: boolean;
			total: number;
			hits: number;
			crits: number;
			targetsByTimestamp: Map<number, Set<string>>;
		}
	>();
	let eventTotal = 0;

	for (const e of damageEvents) {
		const id = abilityIdOf(e);
		if (id === null) continue;
		const ability = registry.abilityByDamageId(id) ?? registry.abilityByCastId(id);
		const key = ability?.key ?? `#${id}`;
		const rec = rows.get(key) ?? {
			id,
			name: ability?.name ?? nameOf(id),
			passive: ability === undefined,
			utility: ability?.utility ?? false,
			total: 0,
			hits: 0,
			crits: 0,
			targetsByTimestamp: new Map(),
		};
		rec.total += e.amount ?? 0;
		rec.hits++;
		if (e.hitType === CRIT) rec.crits++;
		if (e.targetID !== undefined && !ignoredTargets.has(e.targetID)) {
			const targets = rec.targetsByTimestamp.get(e.timestamp) ?? new Set<string>();
			targets.add(`${e.targetID}:${e.targetInstance ?? ''}`);
			rec.targetsByTimestamp.set(e.timestamp, targets);
		}
		rows.set(key, rec);
		eventTotal += e.amount ?? 0;
	}

	const abilities = [...rows.values()]
		.map((a) => {
			const targetGroups = [...a.targetsByTimestamp.values()];
			const averageTargetsHit =
				targetGroups.length === 0
					? undefined
					: targetGroups.reduce((total, targets) => total + targets.size, 0) / targetGroups.length;
			return {
				id: a.id,
				name: a.name,
				total: a.total,
				hits: a.hits,
				...(averageTargetsHit === undefined ? {} : { averageTargetsHit }),
				crits: a.crits,
				share: eventTotal > 0 ? (a.total / eventTotal) * 100 : 0,
				critPct: (a.crits / a.hits) * 100,
				avgHit: a.total / a.hits,
				passive: a.passive,
				utility: a.utility,
			};
		})
		.sort((a, b) => b.total - a.total);

	return { abilities, eventTotal };
}

export function damageByTarget(damageEvents: readonly DamageEvent[]): Map<number, number> {
	const out = new Map<number, number>();
	for (const e of damageEvents) {
		if (e.targetID === undefined) continue;
		out.set(e.targetID, (out.get(e.targetID) ?? 0) + (e.amount ?? 0));
	}
	return out;
}

/**
 * The enemy this pull was about: a boss when the report names one, and the biggest damage taker only
 * when it does not.
 *
 * Damage share alone cannot answer this, and getting it wrong is not a small error — the engaged
 * windows every uptime is divided by, `primaryDamageShare`, `singleTarget` and the timeline's primary
 * lane all hang off the answer. Measured on a real 33-enemy pull, the most-damaged enemy was an add
 * holding 17.8% of the player's damage while the boss held 15.3%, so the report was not merely
 * measuring one enemy on an add fight, it was measuring the wrong one and calling an add's uptime the
 * boss's.
 *
 * The same mistake is in the reference reports, and it is the source of a number quoted all over this
 * codebase. On the Immerseus kill in `a:6MhZgjyAknFWrYfK` the most-damaged enemy was a Sha Puddle
 * holding 59.3% of the player's damage, and debuff uptime against it came out at **0.6%** — the figure
 * `score.ts` cited as its reason to refuse grading add fights at all. Against Immerseus himself the
 * same pull reads 93.6%. The metric was not too harsh; it was pointed at a puddle.
 *
 * `bossIDs` therefore comes from the report rather than from the damage: WarcraftLogs marks the
 * encounter's bosses in the report's master data as `type: 'NPC'`, `subType: 'Boss'`.
 * `enemyNPCs.instanceCount` was the other candidate and does not work — checked across both reference
 * reports, every unique add carries `instanceCount: 1` exactly as the boss does (High Enforcer
 * Thranok and Lieutenant Krugruk on Galakras, Darkfang and Bloodclaw on the Dark Shaman, the Iron
 * Juggernaut's cannons), so it separates "spawned in waves" from "spawned once" and never separates a
 * boss from an add.
 *
 * Damage share still breaks the tie, for the two cases it is the only answer to: an encounter with
 * several bosses (the Fallen Protectors, the Kor'kron Dark Shaman, the Paragons) picks whichever of
 * them this player actually spent the pull on, and a pull the report marks no boss for at all — trash,
 * or master data that gave an actor no subtype — falls back to the enemy that took the most, which is
 * what this used to do for everything.
 */
export function primaryTargetID(
	damageEvents: readonly DamageEvent[],
	bossIDs: ReadonlySet<number>,
): number | undefined {
	const byDamage = [...damageByTarget(damageEvents).entries()].sort((a, b) => b[1] - a[1]);
	// Only enemies this player actually hit are candidates, boss or not. A boss that took nothing from
	// them — the other half of a two-boss fight, or one this player was never on — is not the enemy
	// their debuff was ever going to be on, and picking it would hand every metric below an empty
	// window set.
	return (byDamage.find(([id]) => bossIDs.has(id)) ?? byDamage[0])?.[0];
}
