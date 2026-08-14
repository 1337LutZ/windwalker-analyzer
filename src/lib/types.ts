// Shared contract between the WarcraftLogs client, the analysis engine and the UI.
//
// WarcraftLogs' own shapes are not written out here. They are generated from the vendored schema
// into ~/generated/wcl-schema and re-exported below, so a field that changes shape becomes a
// compile error instead of a hand-written interface that has quietly drifted from the API. Two
// things the schema cannot describe are modelled by hand instead, and only those two:
//
//   - combat-log events, because `Report.events` is typed `[JSON]` — see ~/lib/events
//   - the damage table, because `Report.table` is typed `[JSON]` too
//
// Everything from `Window` down is ours rather than theirs: the analysis output is this project's
// contract with its own renderer, and nothing in the API describes it.

import type { ReportActor, ReportFight, ReportFightNpc } from '~/generated/wcl-schema';
import type { WclEvent } from '~/lib/events';
import type { Gate } from '~/lib/game/model';

// ---------------------------------------------------------------- WCL types

export type {
	ReportAbility,
	ReportActor,
	ReportEventPaginator,
	ReportFight,
	ReportFightNpc,
	ReportMasterData,
} from '~/generated/wcl-schema';

/** The discriminated union over `type`, with its narrowing helpers, lives in ~/lib/events. */
export type { WclEvent } from '~/lib/events';

/**
 * What actually limits a button, which decides whether a "lost cast" figure means anything. Every
 * ability declares one, so it is the game model's word rather than a second opinion held here.
 */
export type { Gate };

/**
 * Drops WarcraftLogs' `Maybe<>` from the fields the client resolves before the engine sees them.
 *
 * The schema marks almost everything nullable because almost everything is optional *somewhere* —
 * on a dungeon pull, on a trash fight, on an actor with no owner. The analysis cannot run without
 * these, so the check happens once, in the client, rather than at every read downstream.
 */
type Resolved<T> = { [K in keyof T]-?: NonNullable<T[K]> };

/** One pull. `startTime` and `endTime` are report-relative ms, not epoch. */
export type Fight = Resolved<
	Pick<ReportFight, 'id' | 'name' | 'encounterID' | 'kill' | 'difficulty' | 'startTime' | 'endTime'>
> & {
	/**
	 * Raid size — 10 or 25 in this expansion.
	 *
	 * Separate from `difficulty`, which is the mode alone. Collapsing the two is how a 10 Heroic pull
	 * gets labelled 25 Normal: on Classic the difficulty id says Heroic and nothing about size.
	 */
	size: number;
	/** Report actor ids of the players in this pull, with the API's nulls already filtered out. */
	friendlyPlayers?: number[];
};

/** A player, pet or NPC in the report. */
export type Actor = Resolved<Pick<ReportActor, 'id' | 'name' | 'type'>> & {
	/** The class, for players. */
	subType?: string;
	/** Set on pets: the report id of the player they belong to. */
	petOwner?: number | null;
};

/** An enemy in one fight. `id` is the report id events carry; `gameID` is the NPC's game id. */
export type FightNpc = Resolved<Pick<ReportFightNpc, 'id' | 'gameID'>>;

// `Report.table` is another `[JSON]` field, so these three are hand-written — and deliberately
// cover only the handful of columns the analysis reads, rather than the whole table payload.

export interface DamageAbilityRow {
	guid: number;
	name: string;
	total: number;
}

export interface DamageEntry {
	name: string;
	id: number;
	type: string;
	itemLevel?: number;
	total: number;
	/** WarcraftLogs' own active time for the player: CPM against it is the fair read. */
	activeTime: number;
	abilities?: DamageAbilityRow[];
}

export interface FightTable {
	fight: Fight & { enemyNPCs?: FightNpc[] };
	damageDone: { entries: DamageEntry[] };
}

/** Everything the analysis engine needs about one fight. Fetching it is the client's job. */
export interface FightDataset {
	code: string;
	fight: Fight;
	/** The zone's difficulty names by id, so the report can label the pull without a hardcoded table. */
	difficultyNames?: Record<number, string>;
	actor: Actor;
	events: WclEvent[];
	table: FightTable;
	actors: Actor[];
}

// ----------------------------------------------------- analysis result types

export interface Window {
	start: number;
	end: number;
	truncated?: boolean;
}

export interface AbilityDamage {
	id: number;
	name: string;
	total: number;
	hits: number;
	crits: number;
	share: number;
	critPct: number;
	avgHit: number;
	/** True when no cast produced it: autoattacks, trinket and enchant procs, external buffs. */
	passive: boolean;
	/** True when it is pressed for something other than damage — movement, mostly. */
	utility: boolean;
}

export interface CastRow {
	id: number;
	name: string;
	count: number;
	onGcd: boolean;
	gate: Gate;
	cpm: number;
	cooldownSec: number | null;
	medianGapSec: number;
	longestGapSec: number;
	times: number[];
}

export interface CpmSummary {
	totalCpm: number;
	onGcdCasts: number;
	offGcdCasts: number;
	gcdSlots: number;
	gcdUtilisationPct: number;
	channelSec: number;
	activeMs: number;
	activePct: number;
}

export interface LostCastRow {
	id: number;
	name: string;
	cooldownSec: number;
	casts: number;
	driftSec: number;
	lostCasts: number;
	openerSec: number;
	tailSec: number;
	worst: Array<{ at: number; seconds: number; link: string }>;
}

export interface BrewUse {
	t: number;
	before: number;
	consumed: number;
	refresh: boolean;
	window: Window | null;
}

export interface BrewSummary {
	uses: number;
	castCount: number;
	totalConsumed: number;
	avgConsumed: number;
	fullUses: number;
	refreshUses: number;
	wastedAtCap: number;
	maxStacks: number;
	bankAtEnd: number;
	uptimePct: number;
	windows: Window[];
	useList: BrewUse[];
	bankTimeline: Array<[number, number]>;
}

export type SnapshotGrade = 'last-gcd' | 'late' | 'early' | 'none';
export type B2bRole = 'source' | 'follow-up' | null;

export interface ProcWindow extends Window {
	spellID: number;
	/** Which stat the proc converted into. */
	stat: string;
	lengthMs: number;
	sameAsPrevious: boolean;
	snapshotAt: number | null;
	snapshotEnd: number | null;
	snapshotStacks: number | null;
	brewEnd: number | null;
	remainingMs: number | null;
	depthPct: number | null;
	grade: SnapshotGrade;
	brewAlreadyUp: boolean;
	heldStat?: string | null;
	redundant: boolean;
	brewCastInside: number;
	stacksInside: number;
	gapToNextMs: number | null;
	overlaps: Array<{ index: number; stat: string; ms: number }>;
	devaluedMs: number;
	wastedMs: number;
	backToBack: boolean;
	backToBackWasted: boolean;
	b2bRole: B2bRole;
	b2bWaste: boolean;
	b2bWith: number[];
	/** Most stacks the bank held while this proc was running. */
	stacksAvailable: number;
	/** True when the bank cleared the rotation's floor at some point during the proc. */
	couldSnapshot: boolean;
	overlapOfMs?: number;
	overlapOfIndex?: number;
	nextStat: string | null;
	/**
	 * How long after this proc expired a brew went out, when one did within the reader's leeway.
	 *
	 * Null when no brew followed closely — which is the difference between missing a proc by a
	 * fraction and never going for it. Both are misses; only one is a timing problem.
	 */
	missedByMs: number | null;
}

export interface ProcSummary {
	procs: number;
	snapshotted: number;
	/** Missed procs where a brew followed within the leeway — read, but late. */
	narrowlyMissed: number;
	/** Procs the bank could have paid for — the denominator a catch rate is fair against. */
	opportunities: number;
	/** Procs that arrived with too few stacks to be worth a brew. Never counted as faults. */
	unaffordable: number;
	/** The stack floor those two were judged against, so the UI can name it. */
	stackFloor: number;
	lastGcd: number;
	late: number;
	early: number;
	unsnapshotted: number;
	redundant: number;
	sameAsPrevious: number;
	backToBack: number;
	backToBackWasted: number;
	devaluedSec: number;
	medianRemainingSec: number | null;
	meanDepthPct: number;
	secondsGivenAway: number;
	brewsOutsideProc: number;
	uptimePct: number;
	statMix: Record<string, number>;
	lastGcdMs: number;
	lateMs: number;
	windows: ProcWindow[];
}

export interface DebuffSummary {
	casts: number;
	uptimeMs: number;
	uptimePct: number;
	engagedMs: number;
	engagedUptimePct: number;
	secondsLost: number;
	intermissionSec: number;
	drops: Array<{ at: number; seconds: number }>;
	windows: Window[];
	engagedSegments: Array<[number, number]>;
	/** Percentage of the player's damage that landed on the primary target. */
	primaryDamageShare: number;
	/**
	 * True when the pull was concentrated enough on one enemy for debuff uptime to mean something.
	 * False on add fights, where uptime against a single target is not a fault to grade.
	 */
	singleTarget: boolean;
}

export interface ChannelAudit {
	casts: number;
	channelSec: number;
	avgChannelSec: number;
	withBrew: number;
	inProc: number;
	clean: number;
	faulted: number;
	energyCheckable: false;
	castList: Array<{
		t: number;
		channelMs: number;
		ticks: number;
		energizingBrew: boolean;
		rjwCovers: boolean;
		brewUp: boolean;
		procRemainingMs: number | null;
		faults: string[];
		link: string;
	}>;
}

export interface FillerAudit {
	casts: number;
	onProc: number;
	/**
	 * Presses that put Tiger Power up rather than refreshing it — the opener, and any after the buff
	 * had lapsed. Justified, but not a decision about timing, so counted apart from a refresh.
	 */
	applied: number;
	refresh: number;
	wasted: number;
	refreshWindowSec: number;
	buffUptimePct: number;
	castList: Array<{
		t: number;
		proc: boolean;
		buffLeftMs: number;
		reason: 'proc' | 'apply' | 'refresh' | 'wasted';
	}>;
}

/**
 * Touch of Karma: a defensive that returns damage, so an unused charge is damage not done.
 *
 * There is no cap here on purpose. What it redirects is a share of maximum health, and MoP Classic
 * logs carry neither `combatantInfo` nor `maxHitPoints` on any event — so the report can say what a
 * use returned and how many uses the pull allowed, and must not claim what a use *could* have
 * returned.
 */
export interface KarmaAudit {
	casts: number;
	/** How many the cooldown allowed across the pull. */
	available: number;
	/** Total damage redirected onto the target. */
	reflected: number;
	/** Share of the player's whole damage that came from the redirect. */
	sharePct: number;
	/** A full health pool per use, from the settings — null until the reader supplies one. */
	capPerUse: number | null;
	uses: Array<{
		t: number;
		reflected: number;
		hits: number;
		/** Share of the per-use ceiling this one returned, or null when no ceiling is known. */
		capPct: number | null;
	}>;
}

export interface Miss {
	kind: string;
	at: number;
	detail: string;
	link: string;
}

/** The full analysis of one fight — what the renderer consumes. */
export interface Analysis {
	player: string;
	code: string;
	fightID: number;
	actorID: number;
	encounter: string;
	difficulty: number;
	/** Raid size, or 0 when the API did not say. Never inferred from `difficulty`. */
	size: number;
	/** The mode's name as the zone gives it — `Heroic`. Null when the zone did not say. */
	difficultyName: string | null;
	kill: boolean;
	durationMs: number;
	itemLevel: number | null;
	/** False when the player never cast the spec's signature ability; the UI must refuse to render. */
	isSpec: boolean;
	specName: string;
	primaryTarget: { id: number | undefined; gameID: number | null };
	damage: {
		wclTotal: number | null;
		eventTotal: number;
		dps: number;
		abilities: AbilityDamage[];
	};
	cpm: CpmSummary;
	casts: CastRow[];
	lostCasts: LostCastRow[];
	brew: BrewSummary;
	procs: ProcSummary;
	debuff: DebuffSummary;
	channel: ChannelAudit;
	filler: FillerAudit;
	karma: KarmaAudit;
	comboBreaker: Array<{
		id: number;
		label: string;
		procs: number;
		wasted: number;
	}>;
	misses: Miss[];
}
