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
 */
export function aggregateDamage(
	damageEvents: readonly DamageEvent[],
	registry: Registry,
	nameOf: (id: number) => string,
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
		};
		rec.total += e.amount ?? 0;
		rec.hits++;
		if (e.hitType === CRIT) rec.crits++;
		rows.set(key, rec);
		eventTotal += e.amount ?? 0;
	}

	const abilities = [...rows.values()]
		.map((a) => ({
			id: a.id,
			name: a.name,
			total: a.total,
			hits: a.hits,
			crits: a.crits,
			share: eventTotal > 0 ? (a.total / eventTotal) * 100 : 0,
			critPct: (a.crits / a.hits) * 100,
			avgHit: a.total / a.hits,
			passive: a.passive,
			utility: a.utility,
		}))
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

/** The enemy that took the most of this player's damage — trash and adds must not inflate uptime. */
export function primaryTargetID(damageEvents: readonly DamageEvent[]): number | undefined {
	return [...damageByTarget(damageEvents).entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}
