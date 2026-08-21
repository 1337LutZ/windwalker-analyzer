// The boss's own phases, as WarcraftLogs reports them.
//
// Two halves that only mean something together. `Report.phases` is static metadata — every phase
// each encounter in the report has, with its name — and `ReportFight.phaseTransitions` is what one
// attempt actually did, as a list of `{ id, startTime }` with no names in it. The join is by `id`,
// which the schema guarantees is "absolute within a fight: phases with the same ID correspond to the
// same semantic phase", and that guarantee is what makes naming a transition sound rather than a
// guess at an index.
//
// Both fields ride along on `reportFights.graphql` for nothing: measured against the live API, that
// document costs 1.01 points with them and 1.01 without, because WCL prices a request by its
// heaviest resolver and documents `phases` as not double-charging a query that already loads fights.
//
// What Mists of Pandaria actually returns, measured on Siege of Orgrimmar (report
// `a:xB3kh7v9pF2AHRtq`), because the schema is retail-shaped and coverage was the open question:
//
//   - Transitions come back for 8 of the 14 encounters in the zone. Iron Juggernaut, Garrosh,
//     Immerseus, Sha of Pride, Galakras, Nazgrim, Malkorok and Thok have them; Fallen Protectors,
//     Norushen, Dark Shaman, Spoils, Siegecrafter Blackfuse and Paragons answer `null`. An absent
//     phase list is therefore normal and not a failure — whatever defers to this needs a fallback.
//   - `id` repeats and does not only count up. Iron Juggernaut reports 1, 2, 1; Garrosh reports
//     1, 2, 3, 2, 3, 4. This is a transition log, not a phase list, and anything that treats the
//     position in the array as the phase number will label the wrong band.
//   - **`isIntermission` is false on every phase in the zone**, including the Garrosh phase whose
//     own name is "Intermission: Realm of Y'shaarj". It is carried here because it is what the
//     schema offers, but on this expansion it is not a usable signal, so no exempt band can be
//     built on it. The name is the only thing that says "intermission" on MoP.
//   - `separatesWipes` is false for most of the zone and true only for Sha of Pride and Galakras,
//     which is WarcraftLogs' own low opinion of how clean these phase lists are.
//
// Timestamps here are report-relative ms, the same basis as `fight.startTime` — the first transition
// of a pull equals `fight.startTime` exactly.

import type { ReportFightsQuery } from '~/generated/wcl-operations';

type QueriedReport = NonNullable<NonNullable<ReportFightsQuery['reportData']>['report']>;

/** One phase of one encounter, as `Report.phases` describes it. */
export interface PhaseMetadata {
	/** 1-indexed, and stable within a fight — this is the key a transition joins on. */
	id: number;
	name: string;
	/**
	 * WarcraftLogs' intermission flag. False for every Siege of Orgrimmar phase, so read it as
	 * "the API said so" and never as "this encounter has no intermission".
	 */
	isIntermission: boolean;
}

/** Every phase WarcraftLogs knows about for one encounter. */
export interface EncounterPhases {
	encounterID: number;
	/** Whether WarcraftLogs considers this phase list good enough to split wipes by. */
	separatesWipes: boolean;
	phases: PhaseMetadata[];
}

/** A moment one pull entered a phase, exactly as the API gives it: an id and a time, no name. */
export interface PhaseTransition {
	id: number;
	/** Report-relative ms. */
	startTime: number;
}

/**
 * A transition with its metadata attached — what a timeline can actually draw.
 *
 * Still one entry per *transition*, not per phase: a pull that re-enters phase one appears twice
 * with the same `id` and the same `name`.
 */
export interface FightPhase {
	id: number;
	/** Report-relative ms, the same basis as `fight.startTime`. */
	startTime: number;
	/** Null when the report has no metadata for this encounter's phase ids. */
	name: string | null;
	isIntermission: boolean;
}

/** `Report.phases`, with the schema's nulls resolved. An encounter with no phases is simply absent. */
export function normaliseEncounterPhases(rows: QueriedReport['phases']): EncounterPhases[] {
	return (rows ?? []).map((row) => ({
		encounterID: row.encounterID,
		separatesWipes: row.separatesWipes ?? false,
		phases: (row.phases ?? []).map((phase) => ({
			id: phase.id,
			name: phase.name,
			isIntermission: phase.isIntermission ?? false,
		})),
	}));
}

/** `ReportFight.phaseTransitions`. Null — an encounter WCL has no phases for — reads as none. */
export function normalisePhaseTransitions(rows: readonly PhaseTransition[] | null | undefined): PhaseTransition[] {
	return (rows ?? []).map((row) => ({ id: row.id, startTime: row.startTime }));
}

/**
 * The phase timeline of one pull: its transitions, each named from the encounter's metadata.
 *
 * Sorted by time because a timeline reads them in order and the API's order is not promised.
 * Returns an empty list for the six Siege encounters that report no transitions, which is the
 * ordinary case rather than an error.
 */
export function resolveFightPhases(
	fight: { encounterID: number; phaseTransitions?: PhaseTransition[] },
	encounterPhases: readonly EncounterPhases[],
): FightPhase[] {
	const metadata = encounterPhases.find((entry) => entry.encounterID === fight.encounterID);
	const byID = new Map((metadata?.phases ?? []).map((phase) => [phase.id, phase]));

	return (fight.phaseTransitions ?? [])
		.map((transition) => {
			const phase = byID.get(transition.id);
			return {
				id: transition.id,
				startTime: transition.startTime,
				name: phase?.name ?? null,
				isIntermission: phase?.isIntermission ?? false,
			};
		})
		.sort((a, b) => a.startTime - b.startTime);
}
