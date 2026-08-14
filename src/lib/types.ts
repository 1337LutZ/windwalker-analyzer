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

/** One equipped item as the log reports it, re-exported so the analysis layer need not reach in. */
export type { GearPiece } from '~/lib/events/model';

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

/**
 * One press, on the clock.
 *
 * `CastRow` above is the aggregate — how many Jabs, at what rate — and deliberately stays that way.
 * A timeline needs the opposite shape: the flat, time-ordered stream of presses, because the question
 * it answers is "what was up when this button went out", which no per-ability total can reach.
 */
export interface CastMark {
	/** Fight-relative ms, like every other timestamp in this file. */
	t: number;
	/**
	 * The button's canonical cast id, which is what resolves an icon — *not* whichever id the log
	 * happened to use first. Jab logs one id per weapon type, and those ids carry the weapon's icon.
	 */
	id: number;
	name: string;
	/**
	 * Whether the press cost a global. The reader wants to see the rotation, and an off-GCD brew or
	 * trinket sitting in the same lane at the same weight reads as a global that was spent.
	 */
	onGcd: boolean;
}

/** The category a lane belongs to, which is the granularity the reader turns rows off at. */
export type LaneGroup = 'buff' | 'proc' | 'debuff';

/**
 * The enemy a lane's windows were measured on.
 *
 * Only a debuff has one: a buff is on the player and a proc is on their gear, so neither has a target
 * to be grouped under. It exists because a debuff is per-enemy in the game and was not per-enemy on
 * the chart — an add pull drew one lane for whichever enemy took the most damage and silently dropped
 * everything the player did to the rest.
 */
export interface LaneTarget {
	/** The report actor id, which is what events carry as `targetID`. */
	id: number;
	/**
	 * The enemy's name, or null when the report's actor list did not name this id.
	 *
	 * Never invented. A lane the report cannot name is labelled as an unnamed enemy carrying that id,
	 * which is the truth, rather than being given the boss's name or a plausible-looking add's.
	 */
	name: string | null;
	/**
	 * True for the enemy `debuff.engagedUptimePct` is measured against — the one that took the most of
	 * this player's damage. The other lanes are drawn and never graded.
	 */
	primary: boolean;
}

/** One aura's windows, as a row drawn under the casts. */
export interface AuraLane {
	/** The aura's key in the spec's game model — stable, and what a React list keys on. */
	key: string;
	name: string;
	/** The spell whose icon stands for the row. */
	id: number;
	group: LaneGroup;
	windows: Window[];
	/**
	 * Which enemy these windows are on, when the aura is per-target.
	 *
	 * Absent on a buff or a proc, and absent on any analysis captured before per-target lanes existed
	 * — so read it for truthiness, never against null. Several lanes then share one `key` and differ
	 * only by target, which is why the chart composes its React key from both.
	 */
	target?: LaneTarget;
}

/**
 * Every press on one clock, with the aura windows worth drawing underneath.
 *
 * Assembled from what the metrics already computed rather than measured again: the casts are the
 * cast series flattened, and each lane is a window set some section above already needed. So this
 * carries no judgement of its own and costs no extra pass over the events — it is a view, and the
 * moment it starts deciding anything it belongs in a metric instead.
 */
export interface CastTimeline {
	casts: CastMark[];
	/** Only lanes with something on them. An aura that never went up is not drawn as an empty row. */
	lanes: AuraLane[];
	/**
	 * How many further enemies carried a per-target aura and were left off the chart.
	 *
	 * A pull with thirty adds must not draw thirty lanes, so the debuff lanes are capped — and a cap
	 * that truncates in silence is a chart that quietly lies about how many enemies were hit. The
	 * count is carried so the copy can say what is missing. Absent on an analysis captured before this
	 * existed: read it as `?? 0`.
	 */
	hiddenTargets?: number;
}

export interface CpmSummary {
	totalCpm: number;
	onGcdCasts: number;
	offGcdCasts: number;
	gcdSlots: number;
	/**
	 * Share of available globals spent on a press that bought something.
	 *
	 * Deliberately not "share of globals spent pressing anything". A global given to a Tiger Palm
	 * that clipped a healthy Tiger Power with no Combo Breaker up did occupy the global, and counting
	 * it as used made the report advise against its own finding: fixing the thirty wasted presses the
	 * Tiger Palm section flags would have dropped this figure by 11.9 points on the poor fixture, from
	 * 90.2% to 78.3%. The right play was never "press nothing" — it was "press Jab instead", which
	 * keeps the global. So the credit for a wasted press is removed rather than a second penalty added.
	 */
	gcdUtilisationPct: number;
	/**
	 * Globals spent on a press that bought nothing, and so excluded from the figure above.
	 *
	 * Carried so the copy can show the deduction rather than quietly applying it. Optional because
	 * every committed fixture is `analyse()` output captured before it existed — on those it is
	 * `undefined`, not `0`, and anything reading it has to guard on truthiness.
	 */
	wastedGcds?: number;
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
	/**
	 * The share of `wastedAtCap` that was the price of holding a brew for a Re-Origination proc.
	 *
	 * A stack lost at the cap while the player waited out a proc is not the same mistake as one lost
	 * to a bank left full for a minute, and this report used to charge for both identically — while
	 * separately faulting the brew that would have prevented it for going out early. Only the stacks
	 * outside this count are graded; all of them are still reported.
	 *
	 * Optional because the committed fixtures predate it. `undefined` there, never `0`.
	 */
	wastedProtecting?: number;
	maxStacks: number;
	bankAtEnd: number;
	uptimePct: number;
	/**
	 * What one brew stack adds to damage, as a fraction — `0.05 + masteryPercent` from
	 * `sim/monk/windwalker/tigereye_brew.go:52`.
	 *
	 * Null when the log did not report a mastery rating, which on every Mists Classic report checked
	 * so far is always. The comparison between brewing early and holding does not need it — both
	 * sides scale by it identically — but stating either cost *as damage* does, so the copy says the
	 * log does not carry it rather than printing a plausible number.
	 */
	damagePerStack?: number | null;
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
	/**
	 * What brewing here rather than at the end of the proc gave up, in stack-seconds.
	 *
	 * One stack-second is one Tigereye Brew stack amplifying for one second. The brew's bonus is
	 * frozen at cast — `damagePerStack` is read once in `OnGain` and never again — over a fixed 15s
	 * window, so a brew cast with `remainingMs` still on the proc's clock spends that much of its
	 * window overlapping stats the player already had, instead of carrying them past the proc. The
	 * cost is therefore `remainingMs` seconds at the stacks the brew actually spent.
	 *
	 * Null on a proc no brew was spent on, and `undefined` on the committed fixtures.
	 */
	earlyCostStackSec?: number | null;
	/**
	 * What waiting for the proc's last global would have cost instead, in the same stack-seconds.
	 *
	 * Stacks the bank would have overflowed during the wait, each one worth a full brew's 15 seconds
	 * of one stack. Zero is the common answer and the honest one: with room in the bank, holding
	 * costs nothing at all and an early brew protected nothing.
	 */
	holdCostStackSec?: number | null;
	/** Stacks the wait would have thrown away — the count behind `holdCostStackSec`. */
	holdStacksLost?: number | null;
	/**
	 * True when this brew went out early *and* holding for the last global would have cost at least
	 * as much as the tail it gave up.
	 *
	 * The one case the report used to have no correct answer for. Ties go to the player: a decision
	 * the arithmetic calls level is not a fault to name.
	 */
	protectedBrew?: boolean;
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
	/**
	 * Early brews the arithmetic endorses: the bank was close enough to its cap that holding for the
	 * last global would have cost at least as much as the tail the brew gave up.
	 *
	 * A subset of `early`, so the two are not added together. Optional because the fixtures predate it.
	 */
	protectedEarly?: number;
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
	/**
	 * This audit does not read the energy bar. Always false.
	 *
	 * It used to say the bar could not be read at all, which was wrong — see `EnergyAudit`. What is
	 * still true is narrower and is why the flag stays: the APL's energy clause is about the moment
	 * of the press, and grading a channel against a bar sampled three times a second would turn the
	 * sampling grid into a verdict. The Energy section reports the bar on its own terms instead.
	 */
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

/**
 * Energizing Brew: six seconds of energy, judged against the priority list's own conditions.
 *
 * The sim hands back 10 energy a second for six one-second ticks on a one-minute cooldown, so what a
 * use is *worth* depends entirely on how starved the bar was when it went out — and this audit does
 * not ask. Not because the bar is unreadable, which is what this comment used to claim and what
 * `EnergyAudit` disproves, but because "five seconds from filling" is a condition about one instant
 * and the bar is sampled about three times a second: judging a press against the nearest reading
 * would grade the sampling grid. What is graded here is the Bloodlust clause, which is an aura and
 * therefore exact, and the overlap with the channel, which the channel audit already reads.
 */
export interface EnergizingBrewAudit {
	casts: number;
	/** How many the cooldown allowed across the pull. */
	available: number;
	uptimeMs: number;
	uptimePct: number;
	/** Uses that went out with Bloodlust, Heroism, Time Warp or an equivalent already running. */
	duringHaste: number;
	/** Uses the priority list rules out. Never more than `duringHaste` — see the engine for why. */
	faulted: number;
	/** True when Rushing Jade Wind was pressed at all, which is half of the APL's Bloodlust exception. */
	rushingJadeWind: boolean;
	/**
	 * The haste cooldowns running over the pull — Bloodlust, Time Warp and the rest of that group.
	 *
	 * Carried so the section can draw them behind the brews rather than only naming them per row:
	 * whether a brew sat inside one is the condition being judged, and an overlap is a thing to see.
	 */
	hasteWindows: Window[];
	/** Fists of Fury channels that began inside one of these windows. Read from the channel audit. */
	channelsInside: number;
	/** Of those, the ones Rushing Jade Wind covered end to end — which is what the APL allows. */
	channelsCovered: number;
	/** This audit does not read the energy bar, exactly as for the channel. Always false. */
	energyCheckable: false;
	uses: Array<{
		t: number;
		lengthMs: number;
		/** The haste cooldown running at the press — `Bloodlust`, `Time Warp` — or null for none. */
		haste: string | null;
		channels: number;
		/** How long the bar sat full inside this window. */
		cappedMs: number;
		/**
		 * Energy thrown away during it, at the brew's own rate plus the regen it stacked on.
		 *
		 * Null when the pull carried no readings to measure a rate from, which is not the same as zero
		 * and must not be printed as one.
		 */
		wasted: number | null;
		faults: string[];
		link: string;
	}>;
	windows: Window[];
}

/** Time at the energy cap over one stretch of the pull, and what it cost. */
export interface EnergyCapSplit {
	cappedMs: number;
	/** Against the length of the stretch this describes, not of the whole pull. */
	pct: number;
	/** Energy that arrived on a full bar and evaporated. Null when no regen rate could be measured. */
	wasted: number | null;
}

/**
 * The energy bar over the pull, and what topping it out cost.
 *
 * Reconstructed rather than assumed, and the correction to a claim this report used to make in
 * three places. `resourcechange` events really are useless as a curve — around twenty on a
 * five-minute pull, every one an Energizing Brew tick — but they are not where the bar lives.
 * WarcraftLogs staples a `classResources` snapshot onto ordinary casts, damage and heals when the
 * events query passes `includeResources: true`, at about three readings a second, and that flag
 * costs no API points at all.
 *
 * The split is the point of the whole audit. Raw time at the cap is not a fault: energy fills while
 * a boss is untargetable exactly as it does while you are hitting one, and a metric that charged a
 * player for an intermission would be inventing a mistake out of the fight's own script. Only
 * `engaged` describes a decision.
 */
export interface EnergyAudit {
	/** The bar's ceiling, straight off the samples — so a talent that widens it needs no inference. */
	max: number;
	/** Readings the curve was built from. Zero means the log carried none, which is a caveat not a zero. */
	samples: number;
	/** Energy per second, measured from the samples. Null when the pull was too quiet to measure one. */
	regenPerSec: number | null;
	/** Median gap between readings: the shortest cap this can see at all. */
	medianGapMs: number;
	/** 99th percentile gap. A cap that opened and closed inside one of these is invisible here. */
	p99GapMs: number;
	total: EnergyCapSplit;
	engaged: EnergyCapSplit;
	downtime: EnergyCapSplit;
	/** The longest stretches spent full, longest first, each with a link into the log. */
	worst: Array<{ at: number; ms: number; engaged: boolean; link: string }>;
}

/**
 * One resource bar over the pull, for drawing.
 *
 * Points are `[ms, amount]` tuples rather than objects: a pull carries one to two thousand readings
 * and the shape is repeated in every captured fixture, where the key names would be most of the
 * bytes. Nothing is interpolated — these are the readings the log carried, at the ~3/s the events
 * happened to sample, so a line drawn through them is a reconstruction and not a measurement
 * between the points.
 */
export interface ResourceCurve {
	max: number;
	points: Array<[number, number]>;
	/**
	 * Moments the bar overflowed, and by how much.
	 *
	 * Only chi carries these. Energy overflow is a rate against a clock — time at the cap times the
	 * regen — while chi arrives in whole points from a button, so its waste is a discrete event with
	 * a press behind it.
	 */
	wasted?: Array<{ t: number; wasted: number }>;
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
	/**
	 * Uses that overlapped Fortifying Brew, which is *not* a damage bonus — see the engine.
	 *
	 * Optional because the committed fixtures were captured before this field existed and are read
	 * back as `Analysis` with no migration: absent means "analysed by an older build", not "zero".
	 */
	withFortifyingBrew?: number;
	uses: Array<{
		t: number;
		reflected: number;
		hits: number;
		/** Share of the per-use ceiling this one returned, or null when no ceiling is known. */
		capPct: number | null;
		/** Fortifying Brew was running for part of the redirect. Absent on a fixture, never null. */
		fortifyingBrew?: boolean;
	}>;
}

/**
 * Invoke Xuen, the White Tiger: a three-minute summon that fights as its own actor for 45 seconds.
 *
 * Both numbers come from the sim — `sim/monk/talents.go:1070` for the cooldown, `talents.go:1075`
 * (`EnableWithTimeout(sim, monk.XuenPet, time.Second*45.0)`) for how long the pet stays out — and the
 * sim's Windwalker APL presses it from an unconditional `autocastOtherCooldowns`, i.e. on cooldown
 * and on nothing else. There is therefore no per-use verdict here of the kind `ChannelAudit` carries:
 * the only thing a press can be judged against is the clock, so this reports the clock.
 */
export interface XuenAudit {
	casts: number;
	/**
	 * How many the pull allowed — the presses taken plus the ones cooldown drift shows were dropped
	 * between them, so it inherits that function's two exclusions: idle time is clipped to the
	 * stretches the target was there, and neither the run-up to the first press nor the tail after the
	 * last is charged.
	 */
	available: number;
	cooldownSec: number;
	/** How long one summon lasts: 45s, from the sim. */
	durationSec: number;
	/** Time the cooldown sat ready and unused between presses. */
	driftSec: number;
	/** Time the tiger was out, clipped to the pull. */
	uptimeMs: number;
	uptimePct: number;
	/**
	 * Damage dealt by the pet's own actor across the pull.
	 *
	 * Its Crackling Tiger Lightning only — the pet's autoattacks log under id 1 like every other melee
	 * swing, so they cannot be separated from the monk's own and are not claimed here.
	 */
	petDamage: number;
	/** Share of the player's whole damage that came from the pet. */
	petSharePct: number;
	uses: Array<{
		t: number;
		/** The 45s window, clipped to the fight — shorter than that means the pull ended first. */
		windowMs: number;
		truncated: boolean;
		damage: number;
		hits: number;
		link: string;
	}>;
}

export interface Miss {
	kind: string;
	at: number;
	detail: string;
	link: string;
}

/** The full analysis of one fight — what the renderer consumes. */
export interface GearSlot {
	slot: string;
	id: number;
	itemLevel: number | null;
	quality: number | null;
	icon: string | null;
	/** The gems socketed into this piece, with the icon each one draws. */
	gems: Array<{ id: number; icon: string | null }>;
	enchantID: number | null;
	/** True when this slot takes an enchant any player can obtain — see `~/lib/analysis/gear`. */
	enchantable: boolean;
	/**
	 * The item set this piece belongs to, or null when it belongs to none.
	 *
	 * Only exists to group the equipped tier pieces so each one's Wowhead tooltip can show its set
	 * block — see `ItemIcon`. Deliberately not surfaced as text anywhere: the log gives a set *id* and
	 * no name, so naming a tier set would mean shipping another generated map for something the
	 * tooltip already says.
	 */
	setID: number | null;
}

export interface GearSummary {
	slots: GearSlot[];
	/** Mean item level over equipped, non-cosmetic slots. Null when the log carried no gear. */
	averageItemLevel: number | null;
	/** Enchantable slots holding an item and no enchant. */
	missingEnchants: string[];
	/** Total gems socketed, which is the other half of "is this character finished". */
	gems: number;
	/**
	 * Mastery rating as `combatantinfo` reported it, or null when it reported none.
	 *
	 * Null is the normal answer on a Mists Classic report: the field is present on every one checked
	 * and carries `0` beside believable crit and haste ratings, which is WarcraftLogs not filling it
	 * rather than a character with no mastery. Optional on top of that because the committed fixtures
	 * predate the field entirely.
	 */
	masteryRating?: number | null;
}

/** One raid-buff *effect* — not one spell. Several classes supply each, and they do not stack. */
export interface RaidBuffRow {
	/** Effect key: `stats`, `attackPower`, `meleeHaste`, `spellHaste`, `crit`, `mastery`. */
	key: string;
	/** The spell whose icon stands for the effect. */
	iconId: number;
	/** The providers the log actually named, deduplicated. Empty when it named none. */
	providers: string[];
	/**
	 * True when the log carried nothing at all about this effect.
	 *
	 * Not the same as 0% uptime, and must never be rendered as one: a buff applied before the pull
	 * that never drops logs no events for the whole fight, so silence is "cannot say" rather than
	 * "was not there".
	 */
	notReported: boolean;
	uptimeMs: number;
	uptimePct: number;
	/** True when some provider was already running at the first millisecond of the pull. */
	fromPull: boolean;
	/** True when the player was one of the casters — which makes any gap theirs to fix. */
	byPlayer: boolean;
	/** True when a Monk can supply this effect at all, whether or not this one did. */
	selfProvided: boolean;
	/** Stretches with no provider up, in time order, including one before the first application. */
	gaps: Array<{ at: number; seconds: number }>;
}

export interface RaidBuffSummary {
	rows: RaidBuffRow[];
	/** Player deaths in the pull. A corpse holds no buffs, so these explain gaps in every row. */
	deaths: number;
	notReported: number;
	/** Effects the Monk supplies that were not up for the whole pull. */
	selfGaps: number;
}

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
	/**
	 * Every press on one clock, with the auras that were up underneath it.
	 *
	 * Optional for the same reason `energizing` below is: the committed fixtures are `analyse()` output
	 * captured before this field existed and are cast to `Analysis` rather than migrated, so on a
	 * fixture it arrives as `undefined` — not `null`, not an empty timeline. `analyse()` always fills it
	 * in; anything reading it has to guard on truthiness.
	 */
	timeline?: CastTimeline;
	lostCasts: LostCastRow[];
	brew: BrewSummary;
	procs: ProcSummary;
	debuff: DebuffSummary;
	channel: ChannelAudit;
	/**
	 * Optional for one reason only: every committed fixture in `~/lib/__fixtures__` is captured
	 * `analyse()` output from before this field existed, and they are cast to `Analysis` rather than
	 * migrated — so on a fixture this is `undefined`, not `null` and not an empty audit. `analyse()`
	 * always fills it in. Anything reading it has to guard on truthiness.
	 */
	energizing?: EnergizingBrewAudit;
	/**
	 * Optional for the same reason every field above it is: the committed fixtures are `analyse()`
	 * output captured before the events query asked for resources, and they are cast to `Analysis`
	 * rather than migrated — so on a fixture this is `undefined`, not `null` and not an empty audit.
	 * `analyse()` always fills it in, and fills it in with zero samples when a log genuinely carried
	 * none. Anything reading it has to guard on truthiness.
	 */
	energy?: EnergyAudit;
	filler: FillerAudit;
	karma: KarmaAudit;
	/**
	 * Optional only because the committed fixtures predate it.
	 *
	 * `analyse()` always produces it, but the fixtures in `lib/__fixtures__` are captured output read
	 * back as `JSON.parse(...) as Analysis` — a cast, not a check — so on those this is `undefined`,
	 * not `null`. Marking it optional is what forces the renderer to guard instead of reading through
	 * a field TypeScript would otherwise promise was there.
	 */
	xuen?: XuenAudit;
	comboBreaker: Array<{
		id: number;
		label: string;
		procs: number;
		wasted: number;
	}>;
	/**
	 * What the player was wearing. Empty when the log carried no `combatantinfo` for them, which the
	 * UI has to treat as "not reported" rather than as "nothing equipped".
	 */
	gear: GearSummary;
	/**
	 * The raid buffs that move a Windwalker's damage, one row per effect.
	 *
	 * Optional for the same reason every field above it is: the committed fixtures are captured
	 * `analyse()` output from before this field existed and are cast to `Analysis` rather than
	 * migrated, so on a fixture it arrives as `undefined` — not `null`, not an empty summary.
	 * `analyse()` always fills it in. Anything reading it has to guard on truthiness.
	 */
	raidBuffs?: RaidBuffSummary;
	/**
	 * The energy and chi bars over the pull, for the charts that draw them.
	 *
	 * Optional because a report captured before the events query asked for resources carries none,
	 * and because a log that answers without them is a real case rather than an error — the analysis
	 * above still stands, it simply cannot draw the bar.
	 */
	resources?: { energy: ResourceCurve; chi: ResourceCurve };
	misses: Miss[];
}
