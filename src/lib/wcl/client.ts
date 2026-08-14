// The WarcraftLogs v2 transport.
//
// This runs in the visitor's browser and nowhere else. The token belongs to them: it is held in a
// private field, sent only in the Authorization header to one of the two paths on WCL_HOST, and
// never logged, never stored, and never placed in a URL. `#send` is the single point where a request
// leaves the page, which is what makes that claim checkable.
//
// The queries live in the .graphql files beside this one so codegen can type their results; they are
// pulled in as text with Vite's `?raw` so there is exactly one copy of each document — the one
// codegen read.

import type { Actor, DamageAbilityRow, DamageEntry, Fight, FightNpc } from '~/lib/types';
import { cleanToken, inspectToken } from '~/lib/auth/token';
import { parseEvents, type WclEvent } from '~/lib/events';
import type {
	FightDamageTableQuery,
	FightDamageTableQueryVariables,
	FightEventsQuery,
	FightEventsQueryVariables,
	FightPlayerDetailsQuery,
	FightPlayerDetailsQueryVariables,
	ReportActorsQuery,
	ReportActorsQueryVariables,
	ReportFightsQuery,
	ReportFightsQueryVariables,
} from '~/generated/wcl-operations';

import { WCL_CLIENT_ENDPOINT, WCL_HOST, endpointFor, otherEndpoint } from './endpoint';
import FIGHT_DAMAGE_TABLE_QUERY from './fightDamageTable.graphql?raw';
import FIGHT_EVENTS_QUERY from './fightEvents.graphql?raw';
import PLAYER_DETAILS_QUERY from './playerDetails.graphql?raw';
import REPORT_ACTORS_QUERY from './reportActors.graphql?raw';
import REPORT_FIGHTS_QUERY from './reportFights.graphql?raw';

/** A stuck request would otherwise leave the UI's progress indicator frozen with no way out. */
const REQUEST_TIMEOUT_MS = 60_000;

export type WclErrorKind =
	/** The token is expired, malformed, or lacks the scope for this report. Overwhelmingly the common case. */
	| 'auth'
	/** The hourly point budget or the burst limiter said no. */
	| 'rate-limit'
	/** The request never reached WarcraftLogs, or timed out. */
	| 'network'
	/** WarcraftLogs answered, but with a failure of its own. */
	| 'server'
	/** The query ran and was rejected — a bad code, an archived report, a field we may not read. */
	| 'graphql'
	/** The query succeeded but the thing asked for is not in the report. */
	| 'missing';

/** Every failure this module raises, carrying a message written for the person who pasted the token. */
export class WclError extends Error {
	readonly kind: WclErrorKind;
	readonly status: number | null;

	constructor(kind: WclErrorKind, message: string, status: number | null = null) {
		super(message);
		this.name = 'WclError';
		this.kind = kind;
		this.status = status;
	}
}

/** A fight as the API returns it: `Fight` plus the enemy roster the analysis uses to pick a target. */
export type FightWithNpcs = Fight & {
	enemyNPCs?: FightNpc[];
	/**
	 * How far a wipe got, as WarcraftLogs' own completion percentage. Null on a kill, and null on a
	 * fight the API declined to score.
	 */
	fightPercentage?: number | null;
};

/**
 * One player in one pull, as `playerDetails` groups them.
 *
 * `playerClass` is what the API calls `type` — the class, not the actor type — and `specs` is every
 * spec WarcraftLogs saw them in during that pull, which is normally exactly one.
 */
export interface FightPlayer {
	id: number;
	name: string;
	playerClass: string;
	specs: string[];
}

export interface ReportSummary {
	code: string;
	title: string;
	/** Epoch ms — unlike every other timestamp in this API, which is relative to the report start. */
	startTime: number;
	endTime: number;
	zoneName: string | null;
	/**
	 * The zone's own difficulty names by id, straight from the API.
	 *
	 * Read rather than hardcoded because the ids are not portable — `4` is Heroic on Classic and
	 * means something else on retail — and because the zone is the only thing that actually knows.
	 * Empty when the report has no zone, which is what `difficultyLabel` falls back for.
	 */
	difficultyNames: Record<number, string>;
	fights: FightWithNpcs[];
}

export interface EventPage {
	data: WclEvent[];
	/** Non-null means more events exist; resume from it. Never assume one page is the whole fight. */
	nextPageTimestamp: number | null;
}

export interface WclClientOptions {
	token: string;
}

// The generated query types nest everything under nullable parents, so pick the two rows out of them
// once rather than re-deriving the path at every use.
type QueriedFight = NonNullable<
	NonNullable<NonNullable<NonNullable<ReportFightsQuery['reportData']>['report']>['fights']>[number]
>;
type QueriedActor = NonNullable<
	NonNullable<
		NonNullable<NonNullable<NonNullable<ReportActorsQuery['reportData']>['report']>['masterData']>['actors']
	>[number]
>;

export class WclClient {
	#endpoint: string;
	readonly #token: string;

	constructor({ token }: WclClientOptions) {
		// People paste the whole "Bearer eyJ0…" line out of the docs as often as they paste the token.
		const cleaned = cleanToken(token);
		if (!cleaned) throw new WclError('auth', 'No WarcraftLogs API token was given.');
		this.#token = cleaned;
		// Reading the payload picks the path this token most likely works on. It is a guess and never
		// a verification — `#graphql` tries the other path if WarcraftLogs disagrees.
		this.#endpoint = endpointFor(inspectToken(cleaned).kind);
	}

	/** Which of the two paths this client is talking to, after any fallback has settled. */
	get endpoint(): string {
		return this.#endpoint;
	}

	/**
	 * One query, on the endpoint the token was routed to — and, if that answers with an auth failure,
	 * one retry on the other before anything is surfaced.
	 *
	 * The retry is what makes the decode safe to be wrong about: scope names can change, a payload
	 * may not decode at all, and neither should strand a token that WarcraftLogs would have accepted
	 * on the other path. A working fallback sticks, so the cost is one wasted request per client and
	 * not one per query. The original failure is what gets raised if both refuse, because it is the
	 * one that describes the endpoint this token was meant for.
	 */
	async #graphql<TData, TVariables>(query: string, variables: TVariables): Promise<TData> {
		try {
			return await this.#send<TData, TVariables>(this.#endpoint, query, variables);
		} catch (cause) {
			if (!(cause instanceof WclError) || cause.kind !== 'auth') throw cause;

			const fallback = otherEndpoint(this.#endpoint);
			let data: TData;
			try {
				data = await this.#send<TData, TVariables>(fallback, query, variables);
			} catch {
				throw cause;
			}
			this.#endpoint = fallback;
			return data;
		}
	}

	async #send<TData, TVariables>(endpoint: string, query: string, variables: TVariables): Promise<TData> {
		const abort = new AbortController();
		const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);

		let response: Response;
		try {
			response = await fetch(endpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${this.#token}`,
				},
				body: JSON.stringify({ query, variables }),
				signal: abort.signal,
			});
		} catch {
			throw new WclError(
				'network',
				abort.signal.aborted
					? `WarcraftLogs did not answer within ${REQUEST_TIMEOUT_MS / 1000} seconds. Check your connection and try again.`
					: 'Could not reach WarcraftLogs. Check your connection, and whether a content blocker is stopping the request.',
			);
		} finally {
			clearTimeout(timer);
		}

		if (response.status === 401) {
			throw new WclError(
				'auth',
				'WarcraftLogs rejected the token (401). Tokens expire, so the most likely fix is a fresh one: sign in again, or paste a newly generated token.',
				401,
			);
		}
		if (response.status === 403) {
			throw new WclError(
				'auth',
				"WarcraftLogs refused the request (403). The token is valid but is not allowed to read this: a client-credentials token reads public logs only, and a report private to another account is off limits to any token but that account's own.",
				403,
			);
		}
		if (response.status === 429) {
			throw new WclError(
				'rate-limit',
				'WarcraftLogs rate-limited the request (429). The hourly point budget is spent, or too many queries went out at once. Wait a minute and try again.',
				429,
			);
		}
		if (!response.ok) {
			throw new WclError(
				'server',
				`WarcraftLogs returned HTTP ${response.status}. Nothing is wrong on your side; try again shortly.`,
				response.status,
			);
		}

		let payload: { data?: TData; errors?: Array<{ message?: string }> };
		try {
			payload = (await response.json()) as typeof payload;
		} catch {
			throw new WclError('server', 'WarcraftLogs returned a response that was not JSON.', response.status);
		}

		// WCL answers HTTP 200 with a populated `errors` array for archived reports, permission
		// failures and bad arguments, so status alone never proves success.
		if (payload.errors?.length) {
			const detail = payload.errors
				.map((error) => error.message)
				.filter((message): message is string => Boolean(message))
				.join('; ');
			if (/authenticat|authoriz|permission|token/i.test(detail)) {
				throw new WclError(
					'auth',
					`WarcraftLogs rejected the token: ${detail}. An expired token is the usual cause — generate a new one and paste it again.`,
				);
			}
			throw new WclError('graphql', `WarcraftLogs rejected the query: ${detail || 'no reason given'}.`);
		}
		if (!payload.data) throw new WclError('graphql', 'WarcraftLogs returned an empty response.');

		return payload.data;
	}

	async fetchReport(code: string): Promise<ReportSummary> {
		const data = await this.#graphql<ReportFightsQuery, ReportFightsQueryVariables>(REPORT_FIGHTS_QUERY, { code });
		const report = data.reportData?.report;
		if (!report) {
			throw new WclError(
				'missing',
				`No report "${code}" on ${WCL_HOST}. Check the code — this analyser only reads Mists of Pandaria Classic logs, and a code from another WarcraftLogs site does not exist here.` +
					// The endpoint decides what "not found" means here, and saying so is the difference
					// between re-typing a code that was right all along and going to make the log public.
					(this.#endpoint === WCL_CLIENT_ENDPOINT
						? ' This token also reads public logs only, and a private report answers "not found" rather than saying it is private — so if the code is right, the log may not be public.'
						: ''),
			);
		}

		return {
			code,
			title: report.title || code,
			startTime: report.startTime,
			endTime: report.endTime,
			zoneName: report.zone?.name ?? null,
			difficultyNames: Object.fromEntries(
				(report.zone?.difficulties ?? [])
					.filter((d): d is { id: number; name: string } => typeof d?.id === 'number' && !!d.name)
					.map((d) => [d.id, d.name]),
			),
			fights: (report.fights ?? []).filter((fight): fight is QueriedFight => fight !== null).map(normaliseFight),
		};
	}

	async fetchActors(code: string): Promise<Actor[]> {
		const data = await this.#graphql<ReportActorsQuery, ReportActorsQueryVariables>(REPORT_ACTORS_QUERY, { code });
		const actors = data.reportData?.report?.masterData?.actors;
		if (!actors) throw new WclError('missing', `Report "${code}" has no actor list, so nothing in it can be named.`);

		// An actor with no report id cannot be matched to an event, so it is dropped rather than
		// given a placeholder that would silently never match anything.
		return actors.flatMap((actor: QueriedActor | null): Actor[] =>
			actor && typeof actor.id === 'number'
				? [
						{
							id: actor.id,
							name: actor.name ?? `Actor ${actor.id}`,
							type: actor.type ?? 'Unknown',
							subType: actor.subType ?? undefined,
							petOwner: actor.petOwner ?? null,
						},
					]
				: [],
		);
	}

	/**
	 * The roster of one pull with each player's class and spec.
	 *
	 * Cheap on purpose: it is what decides whether the expensive event fetch is worth starting.
	 */
	async fetchPlayerDetails(code: string, fightID: number): Promise<FightPlayer[]> {
		const data = await this.#graphql<FightPlayerDetailsQuery, FightPlayerDetailsQueryVariables>(PLAYER_DETAILS_QUERY, {
			code,
			fightID,
		});
		const roles = unwrapPlayerDetails(data.reportData?.report?.playerDetails);
		if (!roles) {
			throw new WclError(
				'missing',
				`WarcraftLogs returned no player list for fight ${fightID} of report "${code}", so nothing in it can be matched to a spec.`,
			);
		}
		// The three buckets are the API's own split by role; a Windwalker is always under `dps`, but
		// reading all three means a mis-bucketed player is still found rather than silently missing.
		return ['tanks', 'healers', 'dps'].flatMap((role) => normalisePlayers(roles[role]));
	}

	async fetchDamageTable(code: string, fightID: number): Promise<{ entries: DamageEntry[] }> {
		const data = await this.#graphql<FightDamageTableQuery, FightDamageTableQueryVariables>(FIGHT_DAMAGE_TABLE_QUERY, {
			code,
			fightID,
		});
		const table = data.reportData?.report?.table;
		// `table` is an untyped JSON leaf whose payload sits one level down under `data`. Older
		// report versions hand back the payload directly, so accept both rather than crash on one.
		const payload = isRecord(table) && isRecord(table['data']) ? table['data'] : table;
		return {
			entries: normaliseDamageEntries(isRecord(payload) ? payload['entries'] : null),
		};
	}

	async fetchEventPage(params: FightEventsQueryVariables): Promise<EventPage> {
		const data = await this.#graphql<FightEventsQuery, FightEventsQueryVariables>(FIGHT_EVENTS_QUERY, params);
		const events = data.reportData?.report?.events;
		return {
			// `data` is the JSON scalar, so it arrives as `unknown`: it is parsed, never asserted.
			data: parseEvents(events?.data),
			nextPageTimestamp: events?.nextPageTimestamp ?? null,
		};
	}
}

// ------------------------------------------------------------- JSON boundary
//
// The damage table is the other JSON leaf the schema cannot describe. WCL documents it as not
// frozen and old reports disagree with new ones about field names, so it is read defensively here
// and nowhere downstream.

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function toNumber(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normaliseFight(fight: QueriedFight): FightWithNpcs {
	return {
		id: fight.id,
		name: fight.name,
		encounterID: fight.encounterID,
		kill: fight.kill ?? false,
		// Trash pulls report a null difficulty; 0 already means "not a boss" everywhere else here.
		difficulty: fight.difficulty ?? 0,
		// 0 when the API omits it, which reads as "unknown size" downstream rather than as 10-man.
		size: fight.size ?? 0,
		// v2 returns a percentage, but reports exported under the v1 shape carry the same value in
		// hundredths — 1234 for 12.34%. Anything over 100 is therefore the older units, not a fight
		// that somehow finished twelve times over.
		fightPercentage:
			typeof fight.fightPercentage === 'number' && Number.isFinite(fight.fightPercentage)
				? fight.fightPercentage > 100
					? fight.fightPercentage / 100
					: fight.fightPercentage
				: null,
		startTime: fight.startTime,
		endTime: fight.endTime,
		friendlyPlayers: (fight.friendlyPlayers ?? []).filter((id): id is number => typeof id === 'number'),
		enemyNPCs: (fight.enemyNPCs ?? []).filter(
			(npc): npc is FightNpc => typeof npc?.id === 'number' && typeof npc.gameID === 'number',
		),
	};
}

/**
 * `playerDetails` wraps its roles twice — `{ data: { playerDetails: { tanks, healers, dps } } }` —
 * and older reports hand back one or neither of those wrappers, so each is peeled only if it is
 * actually there.
 */
function unwrapPlayerDetails(value: unknown): Record<string, unknown> | null {
	let node: unknown = value;
	if (isRecord(node) && isRecord(node['data'])) node = node['data'];
	if (isRecord(node) && isRecord(node['playerDetails'])) node = node['playerDetails'];
	return isRecord(node) ? node : null;
}

function normalisePlayers(rows: unknown): FightPlayer[] {
	if (!Array.isArray(rows)) return [];
	return rows.filter(isRecord).flatMap((row): FightPlayer[] => {
		// A player with no report id cannot be matched to an event stream, so there is nothing useful
		// to offer for them.
		const id = row['id'];
		if (typeof id !== 'number') return [];
		const specs = Array.isArray(row['specs']) ? row['specs'] : [];
		return [
			{
				id,
				name: typeof row['name'] === 'string' ? row['name'] : `Actor ${id}`,
				playerClass: typeof row['type'] === 'string' ? row['type'] : 'Unknown',
				specs: specs.filter(isRecord).flatMap((entry) => (typeof entry['spec'] === 'string' ? [entry['spec']] : [])),
			},
		];
	});
}

function normaliseDamageEntries(rows: unknown): DamageEntry[] {
	if (!Array.isArray(rows)) return [];
	return rows.filter(isRecord).map((row) => ({
		name: typeof row['name'] === 'string' ? row['name'] : '',
		id: toNumber(row['id'], -1),
		type: typeof row['type'] === 'string' ? row['type'] : 'Unknown',
		itemLevel: typeof row['itemLevel'] === 'number' ? row['itemLevel'] : undefined,
		total: toNumber(row['total'], 0),
		activeTime: toNumber(row['activeTime'], 0),
		abilities: normaliseAbilityRows(row['abilities']),
	}));
}

function normaliseAbilityRows(rows: unknown): DamageAbilityRow[] | undefined {
	if (!Array.isArray(rows)) return undefined;
	return rows.filter(isRecord).map((row) => ({
		// The damage table spells the spell id `guid`; other JSON leaves in the same API use
		// `gameID` or `id` for the same thing, and a report can be old enough to do either.
		guid: toNumber(row['guid'] ?? row['gameID'] ?? row['id'], 0),
		name: typeof row['name'] === 'string' ? row['name'] : '',
		total: toNumber(row['total'], 0),
	}));
}
