// Turning a report code into something the analysis engine can read.
//
// Two entry points: `listReportFights` for the fight picker, `fetchFightDataset` for the run itself.

import type { WclEvent } from '~/lib/events';
import type { Actor, FightDataset } from '~/lib/types';
import { WclClient, WclError, type FightWithNpcs } from './client';

/**
 * A single fight's events run to several pages. This ceiling only exists to stop a cursor that
 * refuses to advance from spending the hourly point budget in a loop; no real fight approaches it.
 */
const MAX_EVENT_PAGES = 60;

export interface FetchProgress {
	phase: 'report' | 'table' | 'events' | 'done';
	message: string;
	/** 1-based, only while `phase` is `'events'`. */
	page?: number;
	/** Events fetched so far. */
	events?: number;
}

export interface FetchFightOptions {
	code: string;
	fightID: number;
	playerName: string;
	/** Called between requests so a long fetch can show progress instead of appearing to hang. */
	onProgress?: (progress: FetchProgress) => void;
}

/** A fight plus the players who were actually in that pull, for the fight picker. */
export type FightWithRoster = FightWithNpcs & { roster: Actor[] };

export interface ReportFightList {
	code: string;
	title: string;
	zoneName: string | null;
	/** The zone's difficulty names by id, so the fight picker can label a pull correctly. */
	difficultyNames: Record<number, string>;
	fights: FightWithRoster[];
	/** The whole report's actor list, so the picker can name anyone without a second query. */
	actors: Actor[];
}

/**
 * Every boss pull in a report, each with its roster resolved to names.
 *
 * Costs two points: fights and masterData are separate resolvers, so there is nothing to save by
 * merging them into one document — but they can go out together, which halves the wait.
 */
export async function listReportFights(client: WclClient, code: string): Promise<ReportFightList> {
	const [report, actors] = await Promise.all([client.fetchReport(code), client.fetchActors(code)]);
	const byID = new Map(actors.map((actor) => [actor.id, actor]));

	const fights = report.fights
		.filter((fight) => fight.encounterID !== 0)
		.map((fight) => ({
			...fight,
			roster: (fight.friendlyPlayers ?? [])
				.map((id) => byID.get(id))
				.filter((actor): actor is Actor => actor?.type === 'Player')
				.sort((a, b) => a.name.localeCompare(b.name)),
		}));

	return {
		code,
		title: report.title,
		zoneName: report.zoneName,
		difficultyNames: report.difficultyNames,
		fights,
		actors,
	};
}

/** Everything the analysis engine needs about one player in one fight. */
export async function fetchFightDataset(client: WclClient, options: FetchFightOptions): Promise<FightDataset> {
	const { code, fightID, playerName, onProgress } = options;

	onProgress?.({ phase: 'report', message: 'Loading the report…' });
	const [report, actors] = await Promise.all([client.fetchReport(code), client.fetchActors(code)]);

	const fight = report.fights.find((candidate) => candidate.id === fightID);
	if (!fight) {
		const known = report.fights
			.filter((candidate) => candidate.encounterID !== 0)
			.slice(0, 20)
			.map((candidate) => `${candidate.id} (${candidate.name})`)
			.join(', ');
		throw new WclError('missing', `Report "${code}" has no fight ${fightID}. Boss pulls in it: ${known || 'none'}.`);
	}

	const actor = resolvePlayer(actors, playerName);
	if (fight.friendlyPlayers?.length && !fight.friendlyPlayers.includes(actor.id)) {
		throw new WclError(
			'missing',
			`${actor.name} was not in fight ${fightID} (${fight.name}). Pick a pull they were present for.`,
		);
	}

	onProgress?.({ phase: 'table', message: 'Loading the damage table…' });
	const damageDone = await client.fetchDamageTable(code, fightID);

	const events = await fetchAllEvents(client, code, fight, actor.id, onProgress);
	onProgress?.({
		phase: 'done',
		events: events.length,
		message: `Loaded ${events.length.toLocaleString()} events.`,
	});

	return {
		code,
		fight,
		difficultyNames: report.difficultyNames,
		actor,
		events,
		table: { fight, damageDone },
		actors,
	};
}

/**
 * Every event the player sourced during the fight, in order.
 *
 * The cursor is the whole point. `limit` does not decide the page size — the server does — so a page
 * that comes back with a non-null `nextPageTimestamp` is a partial answer, and treating the first
 * page as the fight is how a nine-minute pull silently turns into its first ninety seconds.
 */
async function fetchAllEvents(
	client: WclClient,
	code: string,
	fight: FightWithNpcs,
	sourceID: number,
	onProgress: FetchFightOptions['onProgress'],
): Promise<WclEvent[]> {
	const events: WclEvent[] = [];
	let cursor = fight.startTime;

	for (let page = 1; page <= MAX_EVENT_PAGES; page++) {
		const result = await client.fetchEventPage({
			code,
			fightID: fight.id,
			sourceID,
			startTime: cursor,
			endTime: fight.endTime,
		});
		events.push(...result.data);
		onProgress?.({
			phase: 'events',
			page,
			events: events.length,
			message: `Fetched ${events.length.toLocaleString()} events (page ${page})…`,
		});

		const next = result.nextPageTimestamp;
		// A cursor that does not move forward would page forever over the same window.
		if (next === null || next <= cursor || next > fight.endTime) return events;
		cursor = next;
	}

	throw new WclError(
		'server',
		`Gave up after ${MAX_EVENT_PAGES} pages of events for fight ${fight.id}; WarcraftLogs kept asking for more. The data would be incomplete, so nothing is analysed.`,
	);
}

/** Case- and accent-insensitive, because nobody types Ünkchërñ the way the armoury spells it. */
function normaliseName(name: string): string {
	return name
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase();
}

function resolvePlayer(actors: Actor[], playerName: string): Actor {
	const players = actors.filter((actor) => actor.type === 'Player');
	const wanted = normaliseName(playerName.trim());

	const match = players.find((player) => normaliseName(player.name) === wanted);
	if (match) return match;

	const near = nearMatches(players, wanted);
	if (near.length) {
		throw new WclError('missing', `No player called "${playerName}" in this report. Did you mean ${near.join(', ')}?`);
	}
	const roster = players
		.map((player) => player.name)
		.sort((a, b) => a.localeCompare(b))
		.slice(0, 25)
		.join(', ');
	throw new WclError(
		'missing',
		`No player called "${playerName}" in this report. It has ${players.length} players: ${roster || 'none'}.`,
	);
}

function nearMatches(players: Actor[], wanted: string): string[] {
	// A typo is the usual reason a name misses, so rank by edit distance rather than by substring —
	// "Bigdomgo" shares no useful substring with "Bigdogmo" but is one transposition away.
	const tolerance = Math.max(2, Math.floor(wanted.length / 3));
	return players
		.map((player) => {
			const name = normaliseName(player.name);
			return {
				name: player.name,
				distance: name.startsWith(wanted) ? 0 : editDistance(name, wanted),
			};
		})
		.filter((candidate) => candidate.distance <= tolerance)
		.sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name))
		.slice(0, 5)
		.map((candidate) => candidate.name);
}

function editDistance(a: string, b: string): number {
	let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
	for (let i = 1; i <= a.length; i++) {
		const current = [i];
		for (let j = 1; j <= b.length; j++) {
			const substitution = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
			current.push(Math.min(current[j - 1]! + 1, previous[j]! + 1, substitution));
		}
		previous = current;
	}
	return previous[b.length]!;
}
