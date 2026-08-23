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
import { i18n } from '~/lib/i18n';
import type {
	FightDamageTableQuery,
	FightDamageTableQueryVariables,
	FightEventsQuery,
	FightEventsQueryVariables,
	FightPlayerDetailsQuery,
	FightPlayerDetailsQueryVariables,
	RaidStormlashQuery,
	RaidStormlashQueryVariables,
	RateLimitQuery,
	RateLimitQueryVariables,
	ReportActorsQuery,
	ReportActorsQueryVariables,
	ReportFightsQuery,
	ReportFightsQueryVariables,
} from '~/generated/wcl-operations';

import { WCL_CLIENT_ENDPOINT, WCL_HOST, endpointFor, otherEndpoint } from './endpoint';
import FIGHT_DAMAGE_TABLE_QUERY from './fightDamageTable.graphql?raw';
import FIGHT_EVENTS_QUERY from './fightEvents.graphql?raw';
import PLAYER_DETAILS_QUERY from './playerDetails.graphql?raw';
import RAID_STORMLASH_QUERY from './raidStormlash.graphql?raw';
import RATE_LIMIT_QUERY from './rateLimit.graphql?raw';
import REPORT_ACTORS_QUERY from './reportActors.graphql?raw';
import REPORT_FIGHTS_QUERY from './reportFights.graphql?raw';
import {
	normaliseEncounterPhases,
	normalisePhaseTransitions,
	type EncounterPhases,
	type PhaseTransition,
} from './phases';
import { readRateLimit, type ApiCredits } from './rateLimit';

/**
 * Every message raised below, read off the i18next instance rather than a hook.
 *
 * This module is not a component, so there is no render to hang `useTranslation` off — the same
 * constraint `fetchFight.ts` answers the same way, and `describeFailure.ts` answers by taking `t` as
 * a parameter because it has two callers and no `~/lib/i18n` import of its own. Threading `t` through
 * seven public methods and a constructor to reach eighteen strings would put the transport's copy in
 * every caller's signature, so the instance it is.
 *
 * Importing `~/lib/i18n` is what makes that safe: the barrel calls `initI18n()` as a module side
 * effect, and every call below happens at throw time, long after this module was evaluated. A message
 * therefore cannot leave here as a raw key path — `errorCopy.test.ts` imports the client and nothing
 * else, so that claim fails if this import is ever narrowed to `~/lib/i18n/config`.
 */
const t = (key: string, values?: Record<string, unknown>): string => i18n.t(key, { ns: 'ui', ...values });

/** A stuck request would otherwise leave the UI's progress indicator frozen with no way out. */
const REQUEST_TIMEOUT_MS = 60_000;
/**
 * WarcraftLogs can briefly answer a report request with the header present and one of its lists
 * missing, while another request against the same report is settling. Both `fetchReport` and
 * `fetchActors` wait this long and ask once more, which is the whole of the retry policy here.
 */
const PARTIAL_REPORT_RETRY_DELAY_MS = 150;

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
	/**
	 * When this pull entered each phase. Empty for the several Siege encounters WarcraftLogs has no
	 * phases for; see phases.ts for which, and for why the ids repeat.
	 */
	phaseTransitions?: PhaseTransition[];
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
	/**
	 * The static phase list of every encounter in the report, which is the only thing that can name a
	 * fight's `phaseTransitions`. Rides along on the same query for no extra points — see phases.ts.
	 */
	encounterPhases: EncounterPhases[];
	fights: FightWithNpcs[];
}

export interface EventPage {
	data: WclEvent[];
	/** Non-null means more events exist; resume from it. Never assume one page is the whole fight. */
	nextPageTimestamp: number | null;
}

export interface WclClientOptions {
	token: string;
	/**
	 * Called with the hourly budget every response reports one, which is every response: each document
	 * in this folder carries `rateLimitData`, and it is free to ask for alongside work already being
	 * done. Injected rather than written to a module the transport reaches for, so this class keeps
	 * having exactly one outward effect — the request in `#send`.
	 */
	onCredits?: (credits: ApiCredits) => void;
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
	readonly #onCredits: ((credits: ApiCredits) => void) | undefined;

	constructor({ token, onCredits }: WclClientOptions) {
		// People paste the whole "Bearer eyJ0…" line out of the docs as often as they paste the token.
		const cleaned = cleanToken(token);
		if (!cleaned) throw new WclError('auth', t('errors.wcl.auth.noToken'));
		this.#token = cleaned;
		this.#onCredits = onCredits;
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
		// Read once into a local. Two queries can be in flight on one client — `listReportFights` fires
		// two — and if the first flips `#endpoint` while the second is still waiting, computing the
		// fallback from the field afterwards sends the retry back to the path that just refused it.
		const tried = this.#endpoint;
		try {
			return await this.#send<TData, TVariables>(tried, query, variables);
		} catch (cause) {
			if (!(cause instanceof WclError) || cause.kind !== 'auth') throw cause;

			const fallback = otherEndpoint(tried);
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

	/**
	 * The timeout has to cover the body as well as the headers.
	 *
	 * Clearing it once `fetch` resolves leaves `response.json()` unguarded, and a response that
	 * arrives with headers and then stalls mid-body never settles — which is exactly the frozen
	 * progress bar `REQUEST_TIMEOUT_MS` exists to prevent. The controller is therefore owned here and
	 * only released once the whole exchange is done with it.
	 */
	async #send<TData, TVariables>(endpoint: string, query: string, variables: TVariables): Promise<TData> {
		const abort = new AbortController();
		const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
		try {
			return await this.#exchange<TData, TVariables>(endpoint, query, variables, abort);
		} finally {
			clearTimeout(timer);
		}
	}

	async #exchange<TData, TVariables>(
		endpoint: string,
		query: string,
		variables: TVariables,
		abort: AbortController,
	): Promise<TData> {
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
			// Two keys at one throw site, because these are two different failures wearing one `catch`.
			// A timed-out request and one that never left the machine take the reader to different fixes,
			// and one string covering both would describe a DNS failure as a slow answer.
			throw new WclError(
				'network',
				abort.signal.aborted
					? t('errors.wcl.network.timeout', { seconds: REQUEST_TIMEOUT_MS / 1000 })
					: t('errors.wcl.network.unreachable'),
			);
		}

		if (response.status === 401) {
			throw new WclError('auth', t('errors.wcl.auth.rejected'), 401);
		}
		if (response.status === 403) {
			throw new WclError('auth', t('errors.wcl.auth.refused'), 403);
		}
		if (response.status === 429) {
			throw new WclError('rate-limit', t('errors.wcl.rateLimit.spent'), 429);
		}
		if (!response.ok) {
			throw new WclError('server', t('errors.wcl.server.http', { status: response.status }), response.status);
		}

		let payload: {
			data?: TData;
			errors?: Array<{ message?: string; path?: ReadonlyArray<string | number> }>;
		};
		try {
			payload = (await response.json()) as typeof payload;
		} catch {
			// The same timeout, from the other half of the exchange: the body can stall after the headers
			// arrive, and the reader is owed the same sentence either way. One key, read from both sites.
			if (abort.signal.aborted) {
				throw new WclError('network', t('errors.wcl.network.timeout', { seconds: REQUEST_TIMEOUT_MS / 1000 }));
			}
			throw new WclError('server', t('errors.wcl.server.notJson'), response.status);
		}

		// WCL answers HTTP 200 with a populated `errors` array for archived reports, permission
		// failures and bad arguments, so status alone never proves success.
		//
		// `rateLimitData` is the one field whose failure must not fail the request. It is bolted onto
		// every document here for a display, not for the answer the caller asked for, and a token that
		// could read a report but not the budget would otherwise take the whole app down for the sake
		// of a number in the corner. GraphQL reports which field failed in `path`, so an error that is
		// only about that one is dropped and the report is handed over without a budget reading.
		const errors = payload.errors?.filter((error) => error.path?.[0] !== 'rateLimitData');
		if (errors?.length) {
			const detail = errors
				.map((error) => error.message)
				.filter((message): message is string => Boolean(message))
				.join('; ');
			if (/authenticat|authoriz|permission|token/i.test(detail)) {
				throw new WclError('auth', t('errors.wcl.auth.rejectedDetail', { detail }));
			}
			throw new WclError(
				'graphql',
				t('errors.wcl.graphql.rejected', { detail: detail || t('errors.wcl.graphql.noReason') }),
			);
		}
		if (!payload.data) throw new WclError('graphql', t('errors.wcl.graphql.empty'));

		// After the failure checks, so a budget is only ever read off a response that was accepted.
		// `readRateLimit` answers null for anything it does not recognise, which is what a document
		// without the field, or a null one, arrives as.
		const credits = readRateLimit(payload.data);
		if (credits !== null) this.#onCredits?.(credits);

		return payload.data;
	}

	/**
	 * The budget on its own, for the one moment nothing else has been asked for.
	 *
	 * This is the only query here that costs a point without answering a question about a report, and
	 * it exists so the sign-in step can show a real figure the moment there is a token rather than a
	 * promise that one will appear later. It is asked once per session and never on a timer — every
	 * other request carries the same field for free.
	 */
	async fetchRateLimit(): Promise<ApiCredits> {
		const data = await this.#graphql<RateLimitQuery, RateLimitQueryVariables>(RATE_LIMIT_QUERY, {});
		const credits = readRateLimit(data);
		if (credits === null) {
			throw new WclError('missing', t('errors.wcl.missing.credits'));
		}
		return credits;
	}

	async fetchReport(code: string): Promise<ReportSummary> {
		const read = async () =>
			this.#graphql<ReportFightsQuery, ReportFightsQueryVariables>(REPORT_FIGHTS_QUERY, { code });
		let data = await read();
		let report = data.reportData?.report;
		if (report && !report.fights?.length) {
			// The same transient partial response `fetchActors` retries for, in the other list: the header
			// arrives and `fights` is empty. Nothing in `reportFights.graphql` filters fights, so an empty
			// list is never a narrowing this app asked for — and a caller that believes it tells the reader
			// their pull does not exist. Retried once, like the actor list, and not turned into a general
			// retry policy. Keeping the first `report` if the second read has none means a report that
			// exists cannot be reported as missing by the extra request that was made on its behalf.
			await new Promise((resolve) => setTimeout(resolve, PARTIAL_REPORT_RETRY_DELAY_MS));
			data = await read();
			report = data.reportData?.report ?? report;
		}
		if (!report) {
			const notFound = t('errors.wcl.missing.report', { code, host: WCL_HOST });
			// The endpoint decides what "not found" means here, and saying so is the difference between
			// re-typing a code that was right all along and going to make the log public. Its own key
			// rather than a clause bolted onto the one above: it is a second sentence, and it was written
			// as one for as long as it was a `+`.
			throw new WclError(
				'missing',
				this.#endpoint === WCL_CLIENT_ENDPOINT ? `${notFound} ${t('errors.wcl.missing.reportPublicOnly')}` : notFound,
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
			encounterPhases: normaliseEncounterPhases(report.phases),
			fights: (report.fights ?? []).filter((fight): fight is QueriedFight => fight !== null).map(normaliseFight),
		};
	}

	async fetchActors(code: string): Promise<Actor[]> {
		const read = async () =>
			this.#graphql<ReportActorsQuery, ReportActorsQueryVariables>(REPORT_ACTORS_QUERY, { code });
		let data = await read();
		let actors = data.reportData?.report?.masterData?.actors;
		if (!actors && data.reportData?.report !== null && data.reportData?.report !== undefined) {
			// WarcraftLogs can briefly return the report without masterData while another report request is
			// settling. This is the same transient state a refresh used to hide, so retry only this partial
			// response rather than enabling retries for every API failure.
			await new Promise((resolve) => setTimeout(resolve, PARTIAL_REPORT_RETRY_DELAY_MS));
			data = await read();
			actors = data.reportData?.report?.masterData?.actors;
		}
		if (!actors) throw new WclError('missing', t('errors.wcl.missing.actors', { code }));

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
			throw new WclError('missing', t('errors.wcl.missing.players', { code, fightID }));
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
		// An absent node is a refusal, not an empty page — the report went private, or the source is not
		// in it. Reading it as "this fight had no events" is how a pull gets analysed as zero casts and
		// 0% uptime and printed as fact; `fetchReport` and `fetchActors` both refuse the same shape.
		if (!events) {
			throw new WclError('missing', t('errors.wcl.missing.events', { code: params.code, fightID: params.fightID }));
		}
		return {
			// `data` is the JSON scalar, so it arrives as `unknown`: it is parsed, never asserted.
			data: parseEvents(events.data),
			nextPageTimestamp: events.nextPageTimestamp ?? null,
		};
	}

	/** Every Stormlash Totem placement in the fight, from every shaman in the raid. */
	async fetchRaidStormlash(code: string, fightID: number, startTime: number, endTime: number): Promise<WclEvent[]> {
		const data = await this.#graphql<RaidStormlashQuery, RaidStormlashQueryVariables>(RAID_STORMLASH_QUERY, {
			code,
			fightID,
			startTime,
			endTime,
		});
		// A raid with no Stormlash is a normal night, not a refusal — an empty list, not an error.
		const events = data.reportData?.report?.events;
		return events === null || events === undefined ? [] : parseEvents(events.data);
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
		phaseTransitions: normalisePhaseTransitions(fight.phaseTransitions),
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
