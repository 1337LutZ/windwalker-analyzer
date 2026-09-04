import { abilityIdOf, instanceKey, type DamageEvent } from '~/lib/events';
import type { Registry } from '~/lib/game/registry';
import type { AbilityDamage } from '~/lib/types';

const CRIT = 2;

export interface DamageAggregate {
	abilities: AbilityDamage[];
	/**
	 * Sum of the `amount` field over the damage events this reading counts.
	 *
	 * The per-ability shares are taken against it, and so is the headline DPS, so the table adds up to
	 * the number above it. It also follows the analysis mode, because the walk it comes off does.
	 *
	 * **It runs above WarcraftLogs' own damage-done total, and not for the reason this docblock used to
	 * give.** It said "because it counts overkill", and these events carry no `overkill` field at all:
	 * 895 damage events on the Iron Juggernaut fixture and not one of them has the key. Measured, the
	 * difference is two things: the player's pets, which this sum includes and the site's entry for that
	 * pull does not, and a residue of between half a percent and five that is the site applying
	 * exclusions this report does not fully implement. Iron Juggernaut is 84,666,478 of the player's own
	 * against 84,232,041 at the site, plus 3,129,489 of pet.
	 */
	eventTotal: number;
	/**
	 * Damage dealt in each whole second of the pull, index by second from the pull's start.
	 *
	 * **Off the same walk as the totals, which is the only reason it is here rather than in a helper of
	 * its own.** A curve and a total that disagree about one pull is the two-passes failure this
	 * codebase keeps writing down, and building the series beside the sum makes them the same reading by
	 * construction: `perSecond` adds to `eventTotal` exactly, and a test asserts it. A second walk over
	 * `damageEvents` would be free to apply the struck filter differently and nothing would catch it.
	 *
	 * **Seconds, and no window applied.** This is the raw quantity; how much of it to average into a
	 * readable line is a drawing decision and belongs to the chart, which is where the window can be
	 * chosen against the width it has. Storing a pre-smoothed series would freeze that choice in the
	 * analysis and make the number unrecoverable.
	 *
	 * Dense rather than sparse: a second in which nothing landed is a real zero, and a curve drawn from
	 * a sparse series would join the two seconds either side of a gap into a slope nobody had.
	 */
	perSecond: number[];
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
 *
 * `immuneSpawns` is the same exclusion arrived at from the other direction: spawns the log itself says
 * nothing can damage, because every hit on them came back immune — `spawnLives` in `./targets`, which
 * is where that verdict is reached and the only place it is reached. It is a set of `instanceKey`s
 * rather than actor ids because immunity is a property of a unit and WarcraftLogs numbers NPCs by type.
 * Passed in for exactly the reason `ignoredTargets` is: the fan-out and the per-moment count are two
 * numbers about "how many enemies was this" and they have to agree.
 *
 * **And it is applied per ability, not per event, because the two rows are asking different questions.**
 * An ability whose benefit is the damage it deals did not hit an immune unit in any sense that matters,
 * so the mines come out of its average. An ability whose benefit is a hit-count *trigger* — Rushing
 * Jade Wind, whose chi refund fires on three units hit whether or not damage lands — really did hit
 * them, and its average is the number a reader checks that refund against. The ability model says
 * which (`targeting.multiTargetBenefit`), so the answer is the same everywhere it is asked.
 */
export function aggregateDamage(
	damageEvents: readonly DamageEvent[],
	registry: Registry,
	nameOf: (id: number) => string,
	ignoredTargets: ReadonlySet<number> = new Set(),
	immuneSpawns: ReadonlySet<string> = new Set(),
	/**
	 * A hit WarcraftLogs strikes off the ranking, which under `parsing` is a hit that did not happen.
	 *
	 * **A different question from the two sets above, which is why it is a third argument and not a
	 * fourth member of their condition.** `ignoredTargets` and `immuneSpawns` decide whether a body
	 * joins the *fan-out*, how many enemies an ability was hitting, and a trigger ability counts a
	 * unit it could not damage, which is what `multiTargetBenefit: 'trigger'` buys. Nothing about that
	 * applies here: the ruleset does not care what an ability's benefit was, it removes the damage.
	 *
	 * So a struck hit leaves **everything**: the total, the hit count and the crit count, rather than
	 * only the fan-out. Leaving it in `hits` while taking it out of `total` would publish an `avgHit`
	 * divided by blows that no longer count towards the numerator, which is a number describing neither
	 * reading of the pull.
	 *
	 * Defaults to counting every hit, so a caller that has not resolved a ruleset against its pull gets
	 * exactly the behaviour this function had before the argument existed.
	 */
	struck: (event: DamageEvent) => boolean = () => false,
	/**
	 * The pull's own clock, for the per-second series. Absent on a caller that wants only the table.
	 *
	 * `t0` is the fight's start timestamp, which the events are still absolute against at this point,
	 * and `durationMs` sizes the array so a pull whose last hit lands well before the end still
	 * publishes the quiet tail it really had.
	 */
	clock?: { t0: number; durationMs: number },
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
	// One slot per whole second, so the last partial second of a pull has somewhere to land.
	const seconds = clock === undefined ? 0 : Math.ceil(clock.durationMs / 1000) + 1;
	const perSecond: number[] = Array.from({ length: seconds }, () => 0);

	for (const e of damageEvents) {
		const id = abilityIdOf(e);
		if (id === null) continue;
		// Before the row is even reached for: a struck hit is not a smaller hit, it is one the reading
		// the player asked for does not contain. An ability every one of whose hits was struck therefore
		// leaves the table rather than appearing at zero.
		if (struck(e)) continue;
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
		// `instanceKey` rather than a fourth hand-written spelling of the same key, so the spawns named in
		// `immuneSpawns` and the spawns counted here are keyed identically by construction.
		const spawn = e.targetID === undefined ? null : instanceKey(e.targetID, e.targetInstance);
		// A hit-count trigger counts a unit it could not damage; damage does not. Absent means damage.
		const countsImmune = ability?.targeting?.multiTargetBenefit === 'trigger';
		if (
			e.targetID !== undefined &&
			spawn !== null &&
			!ignoredTargets.has(e.targetID) &&
			(countsImmune || !immuneSpawns.has(spawn))
		) {
			const targets = rec.targetsByTimestamp.get(e.timestamp) ?? new Set<string>();
			targets.add(spawn);
			rec.targetsByTimestamp.set(e.timestamp, targets);
		}
		rows.set(key, rec);
		const amount = e.amount ?? 0;
		eventTotal += amount;
		if (clock !== undefined) {
			// Clamped rather than dropped: a hit stamped a beat past the fight's end is a real hit, and
			// throwing it away would break the identity this series is asserted on.
			const at = Math.min(Math.max(Math.floor((e.timestamp - clock.t0) / 1000), 0), perSecond.length - 1);
			perSecond[at] = (perSecond[at] ?? 0) + amount;
		}
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

	return { abilities, eventTotal, perSecond };
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
