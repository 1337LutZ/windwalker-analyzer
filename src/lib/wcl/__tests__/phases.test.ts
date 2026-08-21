// Every number in this file was read off an anonymous Siege of Orgrimmar report
// (`a:xB3kh7v9pF2AHRtq`, fights 16, 46 and 50) rather than invented, so what is asserted is what
// Mists of Pandaria Classic really answers — including the two things that would otherwise be
// assumed wrongly: the ids repeat, and `isIntermission` is false even on a phase named
// "Intermission: Realm of Y'shaarj".

import { afterEach, describe, expect, it, vi } from 'vitest';
import { WclClient } from '../client';
import { fetchFightDataset } from '../fetchFight';
import { normaliseEncounterPhases, resolveFightPhases, type EncounterPhases } from '../phases';

const IRON_JUGGERNAUT_PHASES: EncounterPhases = {
	encounterID: 51600,
	separatesWipes: false,
	phases: [
		{ id: 1, name: 'Stage One: Assault Mode', isIntermission: false },
		{ id: 2, name: 'Stage Two: Siege Mode', isIntermission: false },
	],
};

const GARROSH_PHASES: EncounterPhases = {
	encounterID: 51623,
	separatesWipes: false,
	phases: [
		{ id: 1, name: 'P1: The True Horde', isIntermission: false },
		{ id: 2, name: "Intermission: Realm of Y'shaarj", isIntermission: false },
		{ id: 3, name: "P2: Power of Y'shaarj", isIntermission: false },
		{ id: 4, name: 'P3: MY WORLD', isIntermission: false },
		{ id: 5, name: 'P4: Stormwind Harbor', isIntermission: false },
	],
};

/** Fight 16 of the report: a heroic kill that dropped back into phase one to finish. */
const IRON_JUGGERNAUT_FIGHT = {
	encounterID: 51600,
	phaseTransitions: [
		{ id: 1, startTime: 3301152 },
		{ id: 2, startTime: 3423340 },
		{ id: 1, startTime: 3483300 },
	],
};

/** Fight 50: a wipe that cycled 1, 2, 3, 2, 3, 4. */
const GARROSH_FIGHT = {
	encounterID: 51623,
	phaseTransitions: [
		{ id: 1, startTime: 11011994 },
		{ id: 2, startTime: 11087895 },
		{ id: 3, startTime: 11148854 },
		{ id: 2, startTime: 11296863 },
		{ id: 3, startTime: 11357775 },
		{ id: 4, startTime: 11383984 },
	],
};

describe('resolveFightPhases', () => {
	it('names Iron Juggernaut transitions from the encounter metadata, repeats included', () => {
		const phases = resolveFightPhases(IRON_JUGGERNAUT_FIGHT, [IRON_JUGGERNAUT_PHASES]);

		expect(phases).toEqual([
			{ id: 1, startTime: 3301152, name: 'Stage One: Assault Mode', isIntermission: false },
			{ id: 2, startTime: 3423340, name: 'Stage Two: Siege Mode', isIntermission: false },
			{ id: 1, startTime: 3483300, name: 'Stage One: Assault Mode', isIntermission: false },
		]);
	});

	it('keeps every Garrosh transition, so a re-entered phase is not collapsed into one', () => {
		const phases = resolveFightPhases(GARROSH_FIGHT, [GARROSH_PHASES]);

		// Six transitions over four distinct phases: the id is the phase, not the position.
		expect(phases.map((phase) => phase.id)).toEqual([1, 2, 3, 2, 3, 4]);
		expect(phases.map((phase) => phase.name)).toEqual([
			'P1: The True Horde',
			"Intermission: Realm of Y'shaarj",
			"P2: Power of Y'shaarj",
			"Intermission: Realm of Y'shaarj",
			"P2: Power of Y'shaarj",
			'P3: MY WORLD',
		]);
		// The one thing a reader of the report would act on, and MoP does not report it: the phase
		// whose own name is "Intermission" is not flagged as one. Asserted so that a later expansion
		// of the API — or a wrong assumption here — shows up as a failing test rather than as a band
		// drawn in the wrong place.
		expect(phases.some((phase) => phase.isIntermission)).toBe(false);
	});

	it('answers nothing for an encounter WarcraftLogs has no phases for', () => {
		// Siegecrafter Blackfuse, fight 46: `phaseTransitions` comes back null, which is ordinary.
		expect(resolveFightPhases({ encounterID: 51601 }, [IRON_JUGGERNAUT_PHASES, GARROSH_PHASES])).toEqual([]);
	});

	it('leaves a transition unnamed rather than borrowing another encounter’s phase list', () => {
		// The wrong encounter's metadata must not name this pull's phases just because the ids line up.
		const phases = resolveFightPhases(IRON_JUGGERNAUT_FIGHT, [GARROSH_PHASES]);

		expect(phases.map((phase) => phase.name)).toEqual([null, null, null]);
	});

	it('orders transitions by time', () => {
		const phases = resolveFightPhases(
			{
				encounterID: 51600,
				phaseTransitions: [
					{ id: 2, startTime: 3423340 },
					{ id: 1, startTime: 3301152 },
				],
			},
			[IRON_JUGGERNAUT_PHASES],
		);

		expect(phases.map((phase) => phase.startTime)).toEqual([3301152, 3423340]);
	});
});

describe('normaliseEncounterPhases', () => {
	it('resolves the schema’s nulls without inventing a phase', () => {
		expect(
			normaliseEncounterPhases([
				{ encounterID: 51604, separatesWipes: true, phases: [{ id: 1, name: 'Stage One', isIntermission: null }] },
				{ encounterID: 51601, separatesWipes: null, phases: null },
			]),
		).toEqual([
			{
				encounterID: 51604,
				separatesWipes: true,
				phases: [{ id: 1, name: 'Stage One', isIntermission: false }],
			},
			{ encounterID: 51601, separatesWipes: false, phases: [] },
		]);
	});

	it('reads a report with no phase data at all as no phases', () => {
		expect(normaliseEncounterPhases(null)).toEqual([]);
	});
});

// --------------------------------------------------------------- through the client

const FIGHT = {
	id: 16,
	name: 'Iron Juggernaut',
	encounterID: 51600,
	kill: true,
	difficulty: 4,
	size: 25,
	startTime: 3301152,
	endTime: 3485600,
	friendlyPlayers: [7],
	enemyNPCs: [],
	phaseTransitions: IRON_JUGGERNAUT_FIGHT.phaseTransitions,
};

const ACTORS = [{ id: 7, name: 'Bigdogmo', type: 'Player', subType: 'Monk', petOwner: null }];

/** Answers each document by name, and records what was asked for. */
function stubApi(): string[] {
	const queries: string[] = [];
	vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
		const body = JSON.parse(init.body) as { query: string };
		queries.push(body.query);
		const answer = (data: unknown): Response =>
			new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } });

		if (body.query.includes('query ReportFights')) {
			return answer({
				reportData: {
					report: {
						title: 'Anonymous',
						startTime: 0,
						endTime: 900000,
						zone: { id: 1054, name: 'Siege of Orgrimmar' },
						phases: [IRON_JUGGERNAUT_PHASES, GARROSH_PHASES],
						fights: [FIGHT],
					},
				},
			});
		}
		if (body.query.includes('query ReportActors')) {
			return answer({ reportData: { report: { masterData: { actors: ACTORS } } } });
		}
		if (body.query.includes('query FightDamageTable')) {
			return answer({ reportData: { report: { table: { data: { entries: [] } } } } });
		}
		if (body.query.includes('query FightEvents') || body.query.includes('query RaidStormlash')) {
			return answer({ reportData: { report: { events: { data: [], nextPageTimestamp: null } } } });
		}
		throw new Error(`unexpected query: ${body.query}`);
	});
	return queries;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('fetchFightDataset phases', () => {
	it('asks WarcraftLogs for the phases and hands the pull’s own timeline back', async () => {
		const queries = stubApi();

		const dataset = await fetchFightDataset(new WclClient({ token: 'eyJ0-not-a-real-token' }), {
			code: 'a:xB3kh7v9pF2AHRtq',
			fightID: 16,
			playerName: 'Bigdogmo',
		});

		// The fields are in the request because the .graphql file beside the client was sent, so a
		// document that stopped asking fails here rather than quietly returning no phases.
		const report = queries.find((query) => query.includes('query ReportFights'));
		expect(report).toContain('phaseTransitions');
		expect(report).toContain('isIntermission');

		expect(dataset.phases).toEqual([
			{ id: 1, startTime: 3301152, name: 'Stage One: Assault Mode', isIntermission: false },
			{ id: 2, startTime: 3423340, name: 'Stage Two: Siege Mode', isIntermission: false },
			{ id: 1, startTime: 3483300, name: 'Stage One: Assault Mode', isIntermission: false },
		]);
		// Report-relative, the same basis as the fight's own clock: the first transition is the pull.
		expect(dataset.phases[0]?.startTime).toBe(dataset.fight.startTime);
	});
});
