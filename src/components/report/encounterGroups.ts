// Turning a report's pull list into the shape the fight picker draws.
//
// A raid night is 20–40 pulls of a dozen bosses, and a flat list of them is both long and hard to
// read. Grouping by encounter is also what lets the picker fit on a phone without growing its own
// scrolling box: ~30 rows collapse to ~12.

import type { FightWithRoster } from '~/lib/wcl';

export interface EncounterGroup {
	key: string;
	name: string;
	/** Every attempt at this boss, in pull order. */
	attempts: FightWithRoster[];
	/** The one attempt the group stands for while it is collapsed. */
	representative: FightWithRoster;
}

const durationOf = (fight: FightWithRoster): number => fight.endTime - fight.startTime;

/**
 * The kill, or — when there is none — the longest attempt, which is the closest thing to a full
 * pull. The caller is expected to label that second case as a wipe: a silently selected wipe is the
 * failure mode this exists to avoid.
 */
function pickRepresentative(attempts: FightWithRoster[], first: FightWithRoster): FightWithRoster {
	// Last kill rather than first: a boss killed twice in a night was almost certainly being
	// re-cleared, and the later attempt is the one being asked about.
	const kill = [...attempts].reverse().find((attempt) => attempt.kill);
	if (kill) return kill;
	return attempts.reduce((longest, attempt) => (durationOf(attempt) > durationOf(longest) ? attempt : longest), first);
}

/** One group per encounter, in the order the raid first pulled it. */
export function groupByEncounter(fights: FightWithRoster[]): EncounterGroup[] {
	const byEncounter = new Map<number, FightWithRoster[]>();
	for (const fight of fights) {
		const attempts = byEncounter.get(fight.encounterID);
		if (attempts) attempts.push(fight);
		else byEncounter.set(fight.encounterID, [fight]);
	}

	return [...byEncounter].flatMap(([encounterID, attempts]) => {
		const first = attempts[0];
		if (!first) return [];
		return [
			{
				key: String(encounterID),
				name: first.name,
				attempts,
				representative: pickRepresentative(attempts, first),
			},
		];
	});
}

/**
 * What is selected before anyone touches the picker: a fight id pasted in the URL if the report
 * actually has it, otherwise the last boss worked on, at its kill.
 */
export function defaultFightID(groups: EncounterGroup[], pastedFightID: number | null): number | null {
	if (pastedFightID !== null) {
		const pasted = groups.flatMap((group) => group.attempts).find((fight) => fight.id === pastedFightID);
		if (pasted) return pasted.id;
	}
	return groups[groups.length - 1]?.representative.id ?? null;
}
