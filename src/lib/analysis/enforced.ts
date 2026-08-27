// The globals the *fight* took away, as against the ones the player did not press.
//
// Every audit in this repository counts idle time against a player, and every one of them is wrong for
// the same stretch of pull: the seconds where the encounter removed the buttons. A stun is a stun for
// any class, so this table is about bosses rather than about specs, and it lives here rather than in
// one spec's folder for that reason.
//
// Ported from `nspietz/prot-pala-analyzer`, where it was measured. The rule for what may go in is the
// author's and is deliberately strict:
//
//   **Downtime is excused only when the fight enforces it.** Not when it is hard, not when the boss is
//   moving, not when a mechanic is inconvenient. A global the player could have pressed and did not is
//   a global they lost, and Berserker Stance on Nazgrim is not an excuse for anything.
//
// Two kinds of entry satisfy that, and they are kept apart because they are not equally strong:
//
//   - `lockout` — **measured**. The aura was on the player and *no cast happened inside it*, over every
//     occurrence in both reference reports. That is not an interpretation of the mechanic; it is the
//     press stream saying the player could not act. The sweep behind it took every aura the player
//     carried for over 1.5s more than once — fifty-two of them — and **three** passed. Gene Splice is
//     a fourth lockout found by another route entirely, which is why `player-buff` is a source at all.
//   - `declared` — the reader's call about a phase that removes the player from the boss. Casts do
//     continue inside these, so they cannot be proven the way a stun can, and each carries the
//     measurement that supports it instead.
//
// **What is not in here is as load-bearing as what is.** Siege Mode on Iron Juggernaut takes the tank
// off the boss and the player keeps casting at 56 a minute; Berserker Stance on Nazgrim doubles the
// damage taken and leaves the press rate flat. Both were candidates, both were measured, and both are
// absent — with the reason kept on the encounter, because a rule that was considered and rejected is
// worth as much as one that was kept.
//
// **Nothing consumes this yet except the Protection audit.** The Windwalker and the Elemental grade
// their idle time with no excuses, exactly as they did before this file existed. Adopting it there
// moves pinned figures on ten committed captures, which is a change worth making on its own and not
// as a side effect of adding a third spec.

import { baseEncounterID } from '~/lib/game/rankingExclusions';
import { mergeIntervals, type Interval } from '~/lib/analysis/intervals';
import { abilityIdOf, isAuraApply, isAuraRemove } from '~/lib/events';
import type { FightPhase } from '~/lib/wcl/phases';
import type { WclEvent } from '~/lib/types';

/**
 * Where a rule's windows come from.
 *
 * `player-aura` reads the debuff stream, `enemy-aura` the enemy buff stream, `phase` the transitions
 * WarcraftLogs reports. The last is free and exact but covers only five of the nine Siege bosses,
 * which is why the other two exist at all.
 *
 * `player-buff` is the fourth, and it exists because three streams were not enough. A mechanic the
 * player *takes* — Paragons' Gene Splice, which turns them into an amber scorpion for thirty seconds —
 * arrives as a buff they applied to themselves. That is in none of the other three: not a debuff, not
 * on an enemy, and not a phase. It read as thirty seconds of idle globals until somebody who had
 * played the pull said otherwise. It costs no extra fetch: the player's own event page carries it.
 */
export type RuleSource = 'player-aura' | 'player-buff' | 'enemy-aura' | 'phase';

export interface EnforcedRule {
	key: string;
	name: string;
	source: RuleSource;
	/** Spell ids, for the aura sources. Several ids mean one mechanic the log spells more than one way. */
	ids?: readonly number[];
	/** Phase ids, for the phase source. Absolute within the encounter, so a repeated phase repeats its id. */
	phaseIds?: readonly number[];
	/**
	 * `lockout` was measured off the press stream. `declared` is the reader's judgement about a phase.
	 * A report should be able to say which kind of excuse it applied, so the distinction is carried
	 * rather than flattened.
	 */
	basis: 'lockout' | 'declared';
	/**
	 * The player could have avoided this, so it buys no credit against the globals figure.
	 *
	 * **The distinction is the game's, not the log's, and it cannot be measured from an event stream.**
	 * A stun that lands because the mechanic is unavoidable took the globals away; one that lands because
	 * the player stood in it is a play, and crediting it would pay for the mistake. Both look identical
	 * in the log — an aura applied, an aura removed — so this is declared from the encounter's own design
	 * and the source is named in `evidence`.
	 *
	 * Whirling on Paragons is the case: it is dodgeable, so it is marked and the globals clock keeps
	 * charging for it. Both Gouges are not, so they are credited. `enforcedDowntime` still reports a
	 * dodgeable rule's windows — the section that lists what the fight did is a different question from
	 * the clock a grade divides by — and only `unavoidableWindows` filters them out.
	 */
	dodgeable?: true;
	/** What in the two reference reports put this rule here. Kept so a stale rule can be re-checked. */
	evidence: string;
}

export interface EnforcedProfile {
	/** The **base** encounter id — compare with `baseEncounterID(fight.encounterID)`, never raw. */
	encounterID: number;
	name: string;
	rules: readonly EnforcedRule[];
	/**
	 * The copy key for what this encounter's rules do *not* say, or undefined when there is nothing to add.
	 *
	 * **A key rather than the prose, because this is the only string on the page a reader sees that the
	 * copy suite could not.** Every other sentence in the report goes through `report.json` and is held
	 * by `keys.test.ts`, `copy.test.ts` and `readerVoice.test.ts`; these were English literals in an
	 * analysis module, rendered straight into a `Note`, and the longest of them is a thousand characters.
	 * The first localisation or tone sweep would have missed the largest prose block on the section.
	 *
	 * The rules' own `evidence` strings stay literals on purpose — nothing renders them, and they are
	 * notes to whoever re-checks a rule rather than to a reader.
	 */
	noteKey?: string;
}

/**
 * Every encounter the reference reports cover.
 *
 * An encounter absent from here is graded with no excuses, which is the correct default: silence means
 * "nothing known", never "nothing there". Most of these are here with an empty rule list and a note
 * saying what was tested — that is a different statement from absence and worth the entry.
 *
 * ------------------------------------------------------------------ re-measured at n=152
 *
 * ***The table was built from two reports, and the obvious worry about that turned out to be wrong.***
 * Every rule's evidence line reads "across the two reports", and the credit those rules produce has a
 * **median of 0.00%** across 152 real Protection pulls — which looks exactly like a registry too thin
 * to fire. So it was swept again properly: 152 pulls, 8 to 14 on every one of the fourteen encounters,
 * one distinct player per pull. Every aura the player carried for 1.5s or more, more than once — 1 471
 * aura-by-encounter pairs — scored on window count, mean length, presses inside and silent windows;
 * plus a trigger sweep over every hostile ability for gaps opening behind it.
 *
 * **It found three rules, and all three are on encounters that already had one.** The credit's median
 * stays 0.00% after adding them, and one pull in a hundred and fifty-two changes grade. The two-report
 * sample had the *shape* right: eleven of the fourteen Siege encounters do not enforce measurable tank
 * downtime through anything the player's own log carries. That is a finding about the raid, not about
 * the sample, and it is worth more than the three rules are.
 *
 * The empty rows below are therefore load-bearing. Each says a real sweep looked and found nothing, and
 * the note beside it says what was tested — see `noteKey`.
 */
export const ENFORCED_PROFILES: readonly EnforcedProfile[] = [
	{
		encounterID: 1598,
		name: 'Fallen Protectors',
		rules: [
			{
				key: 'vengeful-strikes',
				name: 'Vengeful Strikes',
				source: 'player-aura',
				ids: [144_396],
				basis: 'lockout',
				evidence:
					'18 windows across the two reports, mean 2.5s, 1 cast inside all 18 — 17 of them completely silent. Every cast gap over 2.5s in either pull is one of these. Re-measured over 11 pulls and 11 players: 29 windows of a flat 3.0s on 7 of them, zero on-GCD presses inside any window and 5 presses of any kind across all 29, and 88% of their length is cast gap.',
			},
			{
				key: 'gouge',
				name: 'Gouge',
				source: 'player-aura',
				ids: [143_301],
				basis: 'lockout',
				evidence:
					'4 windows across 11 pulls and 11 players, on 3 of them and 3 players, 7.99-8.01s each, and not one press of any kind inside any of them — on or off the global. 94% of their length is cast gap, the highest share of any rule in this table. Thin in absolute terms, and it is exactly the count and shape the accepted Shield Bash entry was written from; three players can share a habit, so this is the row to re-check first if anything here goes stale.',
			},
		],
		noteKey: 'fallen-protectors',
	},
	{
		encounterID: 1602,
		name: 'Immerseus',
		rules: [],
		noteKey: 'immerseus',
	},
	{
		encounterID: 1594,
		name: 'Spoils of Pandaria',
		rules: [],
		noteKey: 'spoils-of-pandaria',
	},
	{
		encounterID: 1600,
		name: 'Iron Juggernaut',
		rules: [],
		noteKey: 'iron-juggernaut',
	},
	{
		encounterID: 1606,
		name: "Kor'kron Dark Shaman",
		rules: [],
		noteKey: 'kor-kron-dark-shaman',
	},
	{
		encounterID: 1603,
		name: 'General Nazgrim',
		rules: [],
		noteKey: 'general-nazgrim',
	},
	{
		encounterID: 1595,
		name: 'Malkorok',
		rules: [],
		noteKey: 'malkorok',
	},
	{
		encounterID: 1599,
		name: 'Thok the Bloodthirsty',
		rules: [],
		noteKey: 'thok-the-bloodthirsty',
	},
	{
		encounterID: 1601,
		name: 'Siegecrafter Blackfuse',
		rules: [],
		noteKey: 'siegecrafter-blackfuse',
	},
	{
		encounterID: 1593,
		name: 'Paragons of the Klaxxi',
		rules: [
			{
				key: 'shield-bash',
				name: 'Shield Bash',
				source: 'player-aura',
				ids: [143_974],
				basis: 'lockout',
				evidence: '4 windows across the two reports, 6.0s each, zero casts inside any of them.',
			},
			{
				key: 'gene-splice',
				name: 'Gene Splice',
				source: 'player-buff',
				ids: [143_373],
				basis: 'lockout',
				evidence:
					'2 windows across the four Paragons pulls, 30.0s each, zero on-GCD presses of the player’s own class inside either. What is pressed inside is the scorpion bar — Claw, Swipe, Sting, Fiery Tail — 16 and 19 casts. Both windows open within a second of a Shield Bash ending. Re-measured over 9 pulls and 9 players: 11 windows on 4 of them, mean 26.4s, zero of the player’s own presses in all 11 and 199 scorpion casts.',
			},
			{
				key: 'whirling',
				name: 'Whirling',
				source: 'player-aura',
				ids: [143_701],
				basis: 'lockout',
				// Avoidable, on the raid lead's reading of the encounter, so it never reaches the globals
				// clock — see `dodgeable`. It stays in the table because the section that lists what the
				// fight did still wants it; what it does not do is buy the player time back.
				dodgeable: true,
				evidence:
					'11 windows across 9 pulls and 9 players, on 7 of them, mean 3.2s with six a flat 5.0s. Zero on-GCD presses inside any of the 11 and one press of any kind across all of them; 77% of their length is cast gap. **143702 is deliberately not in `ids`.** The log spells this mechanic twice and only one id marks the lockout: 143702 fires 17 times and 10 of those windows carry a press, but split by whether a 143701 rode along, its 11 paired windows hold 1 press between them and its 6 unpaired windows hold 9. Adding 143702 would put a rule over stretches the player demonstrably acted in. **The split was made after seeing which id was silent**, so it is descriptive as well as predictive — this is the first rule here to re-check if anything goes stale.',
			},
			{
				key: 'gouge',
				name: 'Gouge',
				source: 'player-aura',
				ids: [143_939],
				basis: 'lockout',
				evidence:
					'8 windows across 9 pulls and 9 players, on 4 of them, 1.49-1.53s each, and not one press of any kind inside any of the 8 — on or off the global. 66% of their length is cast gap. The smallest rule in this table, worth about a global and a half apiece and moving the credit median not at all; kept because eight silent windows in a row against a measured global of 1.0s is not press cadence.',
			},
		],
		noteKey: 'paragons-of-the-klaxxi',
	},
	{
		encounterID: 1623,
		name: 'Garrosh Hellscream',
		rules: [
			{
				key: 'weak-minded',
				name: 'Weak Minded',
				source: 'player-aura',
				ids: [148_440],
				basis: 'lockout',
				evidence:
					'2 windows, 15.0s each, zero casts inside either. Re-measured over 10 pulls and 9 players: 10 windows, one on every pull, 14.3-15.1s each, 9 of them completely silent and the tenth holding a single press. Lands 19s and 18.5s after the last phase begins, and the melee gap around it runs 23-25s — the stun plus the run back.',
			},
		],
		noteKey: 'garrosh-hellscream',
	},
	/**
	 * The three encounters that had no row at all until the n=152 sweep.
	 *
	 * Absent, they were graded with no excuses — which is the correct default, but it made them
	 * indistinguishable from a fight nobody had looked at. Each was swept the same way as the rest and
	 * each came back empty, so they are here as findings rather than as gaps.
	 */
	{
		encounterID: 1604,
		name: 'Sha of Pride',
		rules: [],
		noteKey: 'sha-of-pride',
	},
	{
		encounterID: 1622,
		name: 'Galakras',
		rules: [],
		noteKey: 'galakras',
	},
	{
		encounterID: 1624,
		name: 'Norushen',
		rules: [],
		noteKey: 'norushen',
	},
];

const BY_ENCOUNTER = new Map(ENFORCED_PROFILES.map((profile) => [profile.encounterID, profile]));

/** The profile for an encounter, or null when nothing is known about it. Never a stub with empty rules. */
export function enforcedProfile(encounterID: number | undefined): EnforcedProfile | null {
	if (encounterID === undefined) return null;
	return BY_ENCOUNTER.get(baseEncounterID(encounterID)) ?? null;
}

/** One rule, resolved against one pull: what it is, and where it actually applied. */
export interface EnforcedWindow {
	rule: EnforcedRule;
	windows: readonly Interval[];
	ms: number;
}

/**
 * The stretches a rule covers, in fight-relative ms.
 *
 * An aura still up when the pull ends closes at the end rather than being dropped: the last window of
 * a fight is often the one being asked about.
 *
 * `targetID` is what separates "this tank was moved by Foul Geyser" from "the boss cast Foul Geyser" —
 * the player sources narrow to the actor, and `enemy-aura` keeps every target, because the boss and
 * its adds are all "the enemy" for this purpose.
 */
function auraWindows(
	events: readonly WclEvent[],
	ids: readonly number[],
	t0: number,
	endTime: number,
	targetID?: number,
): Interval[] {
	const wanted = new Set(ids);
	const open = new Map<number, number>();
	const out: Interval[] = [];
	for (const event of events) {
		const id = abilityIdOf(event);
		if (id === null || !wanted.has(id)) continue;
		if (targetID !== undefined && event.targetID !== targetID) continue;
		const at = event.timestamp - t0;
		if (isAuraApply(event)) {
			if (!open.has(id)) open.set(id, at);
		} else if (isAuraRemove(event)) {
			const start = open.get(id);
			if (start !== undefined) {
				out.push([start, at]);
				open.delete(id);
			}
		}
	}
	for (const start of open.values()) out.push([start, endTime - t0]);
	return out;
}

/**
 * The stretches a phase rule covers, from the transitions WarcraftLogs reports.
 *
 * **Exported, and the reason is that the table currently has no phase rule to reach it through.**
 * Thok's Frenzy for Blood was the only one and the press stream contradicted it, so removing it left
 * this branch of `enforcedDowntime` live and untestable from the outside — a mechanism that a later
 * rule will need and that nothing would notice had broken in the meantime. The alternative was keeping
 * a rule the data refuses in order to keep a test green, which is the wrong way round.
 */
export function phaseWindows(
	phases: readonly FightPhase[],
	ids: readonly number[],
	t0: number,
	durationMs: number,
): Interval[] {
	const wanted = new Set(ids);
	const out: Interval[] = [];
	for (const [i, phase] of phases.entries()) {
		if (!wanted.has(phase.id)) continue;
		// `FightPhase.startTime` is report-relative, the same basis as `fight.startTime`, so it needs the
		// same `t0` every other clock in the handles is taken against. The window closes at the next
		// transition, or at the end of the pull for the last phase.
		const next = phases[i + 1];
		out.push([phase.startTime - t0, next === undefined ? durationMs : next.startTime - t0]);
	}
	return out;
}

export interface EnforcedInput {
	encounterID: number | undefined;
	events: readonly WclEvent[];
	actorID: number;
	phases: readonly FightPhase[];
	t0: number;
	endTime: number;
	durationMs: number;
}

/**
 * What the fight enforced on this pull: every rule that fired, and the union of what they cover.
 *
 * `windows` is merged, because two rules can overlap — Gene Splice opens within a second of a Shield
 * Bash ending on Paragons — and counting the overlap twice would credit the same second to two
 * excuses in every total that follows.
 *
 * A rule that fired nowhere is kept with an empty window list rather than dropped: "this boss has a
 * stun and it never landed on you" is a different report from "this boss has no stun".
 */
export interface EnforcedDowntime {
	profile: EnforcedProfile | null;
	rules: readonly EnforcedWindow[];
	windows: readonly Interval[];
	ms: number;
}

export function enforcedDowntime(input: EnforcedInput): EnforcedDowntime {
	const profile = enforcedProfile(input.encounterID);
	if (profile === null) return { profile: null, rules: [], windows: [], ms: 0 };

	const rules = profile.rules.map((rule): EnforcedWindow => {
		const windows =
			rule.source === 'phase'
				? phaseWindows(input.phases, rule.phaseIds ?? [], input.t0, input.durationMs)
				: auraWindows(
						input.events,
						rule.ids ?? [],
						input.t0,
						input.endTime,
						rule.source === 'enemy-aura' ? undefined : input.actorID,
					);
		const merged = mergeIntervals(windows.filter(([start, end]) => end > start));
		return { rule, windows: merged, ms: merged.reduce((sum, [start, end]) => sum + (end - start), 0) };
	});

	const windows = mergeIntervals(rules.flatMap((r) => [...r.windows]));
	return {
		profile,
		rules,
		windows,
		ms: windows.reduce((sum, [start, end]) => sum + (end - start), 0),
	};
}

/**
 * The stretches a rule took away that the player could not have avoided.
 *
 * **The globals clock divides by this, and the section's own list does not.** `enforcedDowntime`
 * answers "what did this fight do to you", which includes the things you could have stepped out of;
 * a grade may only forgive the things you could not. Whirling is dodgeable and is therefore reported
 * and not credited, while both Gouges are unavoidable and are both.
 *
 * Returns merged, fight-relative intervals, so a caller can subtract them from a clock directly.
 */
export function unavoidableWindows(downtime: EnforcedDowntime): readonly Interval[] {
	return mergeIntervals(downtime.rules.filter((r) => r.rule.dodgeable !== true).flatMap((r) => [...r.windows]));
}
