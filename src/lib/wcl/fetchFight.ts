// Turning a report code into something the analysis engine can read.
//
// Two entry points: `listReportFights` for the fight picker, `fetchFightDataset` for the run itself.

import type { FightEventsQueryVariables } from '~/generated/wcl-operations';
import type { WclEvent } from '~/lib/events';
// The shell copy, reached through the instance rather than a hook: this is not a component, and the
// two phase messages below are the same two sentences `useFightAnalysis` shows before this function
// is called. One key each, or the pair drifts.
import { i18n } from '~/lib/i18n';
import type { Actor, FightDataset } from '~/lib/types';
import { WclClient, WclError, type FightWithNpcs } from './client';
import { resolveFightPhases, type FightPhase } from './phases';

/**
 * A single fight's events run to several pages. This ceiling only exists to stop a cursor that
 * refuses to advance from spending the hourly point budget in a loop; no real fight approaches it.
 */
const MAX_EVENT_PAGES = 60;

/**
 * Which of the two questions a pass through `fetchAllEvents` is asking, in the query document's own
 * vocabulary rather than a translation of it.
 *
 * Taken as a `Pick` of the generated variables for the reason codegen exists at all: these three are
 * arguments of one `events(…)` call, the schema already names their types, and a hand-rolled
 * `'All' | 'Deaths'` here would be a second, unchecked copy of an enum WarcraftLogs is free to add
 * to.
 */
type EventScope = Pick<FightEventsQueryVariables, 'sourceID' | 'dataType' | 'hostilityType'>;

/**
 * The enemy deaths pass — see the docblock on fightEvents.graphql for what each argument is doing.
 *
 * `sourceID: 0` is the schema's own value for "every source", written out rather than left to a
 * default so that dropping the source filter is a decision visible at this call site. It is the one
 * request this module makes that is not about the player, and it is only affordable because
 * `dataType` and `hostilityType` narrow it: `All` with no source is the whole raid's stream.
 */
const ENEMY_DEATHS: EventScope = { sourceID: 0, dataType: 'Deaths', hostilityType: 'Enemies' };

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

/**
 * A fetched dataset, plus the boss phases WarcraftLogs reported for that pull and the pull's enemy
 * deaths.
 *
 * `phases` is declared here rather than on `FightDataset` itself only because `lib/types.ts` is the
 * most contended file in the tree; the intersection keeps the field real at the fetch boundary
 * without touching it. Empty for the several encounters WarcraftLogs has no phases for — see
 * phases.ts for which, and for what MoP Classic actually returns.
 *
 * `enemyDeaths` is here for the same reason and one more: **nothing reads it yet.** It is every
 * `death` event WarcraftLogs recorded for a hostile actor in this pull, in order, and it is
 * published ahead of its first reader on purpose — `spawnLives` (~/lib/analysis/targets) currently
 * infers a spawn's lifetime from its last landed hit because no death was in the stream to measure
 * to, and that is the reading this field exists to replace. Adding the field and changing that
 * reading in one step would make a fetch change and a grade change indistinguishable in the diff, so
 * this half lands alone and moves no published figure.
 *
 * Required rather than optional, because the fetch always makes the pass: an empty array is a pull
 * where nothing hostile died — a wipe on a single-target boss — and not a dataset that forgot to
 * ask. Datasets loaded from a fixture captured before this field existed are the case that is
 * genuinely absent, and they arrive as `FightDataset`, which has no opinion about it.
 */
export type PhasedFightDataset = FightDataset & { phases: FightPhase[]; enemyDeaths: WclEvent[] };

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
export async function fetchFightDataset(client: WclClient, options: FetchFightOptions): Promise<PhasedFightDataset> {
	const { code, fightID, playerName, onProgress } = options;

	onProgress?.({ phase: 'report', message: i18n.t('progress.report', { ns: 'ui' }) });
	const [report, actors] = await Promise.all([client.fetchReport(code), client.fetchActors(code)]);

	const fight = report.fights.find((candidate) => candidate.id === fightID);
	if (!fight) {
		// Two different facts, and for a while they shared one sentence. A report with pulls in it that
		// are not this one is a wrong id, and listing the ids is the fix. A report with *no* fights at
		// all is not evidence about `fightID` in either direction: `client.fetchReport` has already
		// retried the transient partial answer that produces it, so what is left is a report still being
		// processed — and telling that reader "Boss pulls in it: none" states as fact the one thing this
		// answer cannot establish. Note the tail below is still reachable and still true: a report of
		// nothing but trash has fights and no boss pulls.
		if (report.fights.length === 0) {
			throw new WclError(
				'missing',
				`Report "${code}" came back with no fights at all, so nothing can be said about fight ${fightID}. ` +
					'A report WarcraftLogs is still processing reads this way. If the log shows pulls on the site, try again in a moment.',
			);
		}
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

	onProgress?.({ phase: 'table', message: i18n.t('progress.table', { ns: 'ui' }) });
	const damageDone = await client.fetchDamageTable(code, fightID);

	const events = await fetchAllEvents(client, code, fight, { sourceID: actor.id }, onProgress);
	// The two requests the player-scoped stream above cannot answer, and they go out together for the
	// reason `listReportFights` fires its two together: they are independent, so serialising them buys
	// nothing and costs the reader a round trip. Neither reports progress — the counter is the player's
	// event stream, and a second pass restarting it at zero would read as the first one having lost its
	// place.
	const [enemyDeaths, raidStormlash, rankPercent] = await Promise.all([
		// Every hostile death in the pull, for the spawn lifetimes `spawnLives` currently has to infer.
		fetchAllEvents(client, code, fight, ENEMY_DEATHS, undefined),
		// The raid's Stormlash placements ride alongside the player's own stream, for the Stormlash section.
		client.fetchRaidStormlash(code, fightID, fight.startTime, fight.endTime),
		// The parse WarcraftLogs prints beside the name, which the report header shows next to it. It
		// rides on the roster query rather than one of its own, and a pull with no ranking — a wipe, an
		// unranked difficulty, a log still being processed — answers null rather than failing the fetch.
		client.fetchRankPercent(code, fightID, actor.name).catch(() => null),
	]);
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
		rankPercent,
		events,
		table: { fight, damageDone },
		actors,
		raidStormlash,
		enemyDeaths,
		phases: resolveFightPhases(fight, report.encounterPhases),
	};
}

/**
 * One scope's events for the whole fight, in order — the player's own stream, or the enemy deaths.
 *
 * The cursor is the whole point. `limit` does not decide the page size — the server does — so a page
 * that comes back with a non-null `nextPageTimestamp` is a partial answer, and treating the first
 * page as the fight is how a nine-minute pull silently turns into its first ninety seconds.
 *
 * Both scopes walk it, rather than the deaths getting a shorter reader on the grounds that a pull
 * only produces a few dozen of them: that reasoning is true of the Siege pulls measured and is an
 * assumption about content, not about the API, and the failure it buys is silent truncation of the
 * exact fights — the add-heavy ones — the deaths were fetched for.
 */
async function fetchAllEvents(
	client: WclClient,
	code: string,
	fight: FightWithNpcs,
	scope: EventScope,
	onProgress: FetchFightOptions['onProgress'],
): Promise<WclEvent[]> {
	const events: WclEvent[] = [];
	let cursor = fight.startTime;

	for (let page = 1; page <= MAX_EVENT_PAGES; page++) {
		const result = await client.fetchEventPage({
			code,
			fightID: fight.id,
			...scope,
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
		// `null` is the server saying that was the last page, and is the only clean way out of here.
		if (next === null) return events;
		// A cursor that does not move forward would page forever over the same window, and one past the
		// fight's end is the server pointing outside it. Neither can be walked, and neither means the
		// stream finished — so this refuses for the same reason the page cap below does: what is in
		// hand is a prefix of the pull, and analysing a prefix prints CPM and uptime for a fight that
		// did not happen.
		if (next <= cursor || next > fight.endTime) {
			throw new WclError(
				'server',
				`WarcraftLogs stopped advancing through the events for fight ${fight.id} after page ${page}. The data would be incomplete, so nothing is analysed.`,
			);
		}
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
