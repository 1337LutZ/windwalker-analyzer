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
// Type-only, and circular with `spec/apl` on purpose: the ladder is defined beside the model that
// produces it, and a type-only import is erased before it can become a runtime cycle. Restating the
// shape here would give the report two definitions of one audit, free to drift apart.
import type { AplAudit, Band } from '~/lib/spec/apl';
// Circular with `analysis/auras` in the same way and for the same reason: a window that remembers
// which of an aura's ids opened it is defined beside the walk that produces it, and an audit below
// carries those rather than a copy of the shape that could drift from them.
import type { AuraWindow } from '~/lib/analysis/auras';
import type { Gate } from '~/lib/game/model';
// Type-only, and pointing at a spec rather than at `lib`, which is the same trade the two imports
// above make: the Ascendance press verdict is defined beside the rules that produce it, and this file
// already carries `ElementalAuditResult` and `AscendancePress`, so the alternative is not a cleaner
// boundary but a second copy of one audit's shape free to drift from the first.
import type { AscendancePressVerdict, AscendanceSyncVerdict } from '~/specs/elemental/lib/ascendance';
import type { ResourceTypeValue } from '~/lib/game/resources';
import type { FightPhase } from '~/lib/wcl/phases';

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
	/**
	 * The encounter's phase transitions, when WarcraftLogs knows any — one entry per transition, in time
	 * order, joined to the encounter's phase names.
	 *
	 * The type lives in `~/lib/wcl/phases` with the rest of the wire types rather than here. Optional
	 * because it is genuinely absent rather than merely unfetched: transitions come back for 8 of the 14
	 * Siege encounters, and `null` for the rest — Siegecrafter Blackfuse among them, which is the `cleave`
	 * fixture's own encounter.
	 *
	 * Two things about the shape that have caught people already. The ids **repeat and are not
	 * monotonic** — Iron Juggernaut is `1, 2, 1` — because this is a transition log rather than a phase
	 * list, so array position is not the phase number and two entries can legitimately share a name. And
	 * `isIntermission` is `false` on **every** phase in this expansion, including the Garrosh phase named
	 * "Intermission: Realm of Y'shaarj", so nothing may be built on it here; the name is the only signal
	 * MoP gives.
	 */
	phases?: FightPhase[];
	/**
	 * Every Stormlash Totem placement in the fight, from every shaman — the raid-wide view the
	 * Stormlash section needs, since the player's own stream hides the other shamans' totems.
	 */
	raidStormlash?: WclEvent[];
}

// ----------------------------------------------------- analysis result types

export interface Window {
	start: number;
	end: number;
	truncated?: boolean;
	/**
	 * True when the aura was already running at the pull, so `start` is the fight's own zero rather
	 * than the moment it was applied.
	 *
	 * `truncated`'s opposite number — that one says the fight ended before the aura did, this one says
	 * the aura began before the fight did — and read the same way, for truthiness, because it is absent
	 * on every ordinary window and on any analysis captured before it existed. Only `auraWindows` with
	 * `openAtPull` sets it; see there for what makes the inference sound and why it is opt-in.
	 *
	 * **Together with `truncated` it is also the window's provenance**, which is why neither flag has a
	 * companion field saying where the window came from. Neither set: both ends are the log's own
	 * events. `preexisting` alone: the start was inferred from a leading removal, and the removal is
	 * real. **Both: nothing about this window was logged at all** — it comes off the pull's
	 * `combatantinfo` snapshot, which is the weakest evidence in the report. No event-derived window
	 * can carry the pair, because one flag is set where a window closes and the other only on a window
	 * that never did. `auraWindows` holds the three rungs and `CastTimeline` is what draws the
	 * difference.
	 */
	preexisting?: boolean;
}

export interface AbilityDamage {
	id: number;
	name: string;
	total: number;
	hits: number;
	/** Average number of distinct targets hit in one damage timestamp, when target data is available. */
	averageTargetsHit?: number;
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
	/**
	 * Fight-relative ms, like every other timestamp in this file — the instant the press **landed**.
	 *
	 * Deliberately still the landing instant now that `begin` exists beside it, and not because it is
	 * the more useful of the two. It is a **join key**: `chiAudit.walk.points` are stamped on the raw
	 * `cast` event, and `specs/windwalker/lib/index.ts` looks the chi bar up by exact equality against
	 * this field. Re-pointing `t` would turn every one of those lookups into a miss, and the miss path
	 * `continue`s — silently disabling the Blackout Kick starvation audit with no error and no failing
	 * test. `view/blackoutKick.ts` joins `AplPress.t` to the cast list the same way. So `t` keeps its
	 * meaning and the new instant gets a new name.
	 */
	t: number;
	/**
	 * When the press was **committed** — its `begincast`, or `t` for an instant press.
	 *
	 * The decision instant. What the player could see when they chose is what a priority list grades,
	 * and for a 2.5s Lightning Bolt that is two and a half seconds before `t`. Absent on a mark built
	 * before this field existed, and equal to `t` on every instant press, so a reader may treat
	 * `begin ?? t` as always correct.
	 */
	begin?: number;
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
	/**
	 * How long the press took to cast — the `begincast` to the `cast` — in milliseconds.
	 *
	 * Absent on an instant press, which is most of them: a Windwalker's whole bar is instant, which is
	 * why the cast bar did not exist until the Elemental's Lightning Bolt and Chain Heal needed it. A
	 * cancelled cast carries the cast time it *would have* needed, so the red bar it draws is the cast
	 * the reader lost rather than a marker of unknown width.
	 */
	castTimeMs?: number;
	/**
	 * A `begincast` no `cast` ever completed — the press was interrupted. Only ever true on a mark in
	 * `timeline.cancels`, which is what makes it a red bar instead of an icon on the chart.
	 */
	cancelled?: boolean;
	/**
	 * The enemy this press aimed at, for the one button whose whole point is *which* enemy.
	 *
	 * Only Storm, Earth and Fire carries it, and it is copied off `SefAudit.uses` rather than read
	 * from the cast's `targetID` a second time — that array has already done the work, including the
	 * pre-pull case a cast event structurally cannot answer.
	 *
	 * `id` and `name` fail separately and the chart says so separately. A null `name` beside an `id` is
	 * an enemy the report's actor list cannot put a name to — the pull hit *something* and it can be
	 * counted; a null `id` is a press that named no enemy at all, which is the one case where the only
	 * honest answer is that this cannot be said. A button that aims at nothing carries no `target` at
	 * all, which is what an absent field means — as it is on any analysis captured before this existed,
	 * so read it for truthiness.
	 *
	 * `deduced` rides along exactly as it does on the audit: the target was read from where the spirit
	 * *swung* rather than from where a press *sent* it. A pre-pull placement is the case that produces
	 * it, and such a placement has no press inside the pull to sit on — so this flag reaches a mark
	 * only where a pre-pull spirit's arrival and a press of the button coincide. It is carried anyway,
	 * because the mark reads the audit's own entry rather than a filtered copy of it, and silently
	 * printing a swing in a row that says "sent to" is the one outcome that would be a lie.
	 */
	target?: { id: number | null; name: string | null; deduced?: boolean };
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
	 * True for the enemy the pull was about — the boss the report names, or the biggest damage taker
	 * when it names none. It is the lane `debuff.windows` is measured on and the enemy the engaged
	 * windows are read from; it is no longer the only enemy the graded uptime looks at, which is what
	 * `debuff.engagedUptimePct` now says.
	 */
	primary: boolean;
}

/**
 * The player who cast the raid buff a lane's window came from.
 *
 * **Deliberately not `LaneTarget`, and deliberately not reusing `target`.** The per-enemy row machinery
 * is the right *pattern* for this — several rows sharing one aura key, told apart by a field, capped and
 * carried past the cap — but `target` means "enemy" in every other file that reads it, so a caster
 * arriving in that field would read as a victim and would sink into the per-enemy block at the foot of
 * the chart, which is where rows about enemies go.
 *
 * Only a raid buff somebody else pressed has one. Stormlash Totem and Skull Banner are cast by another
 * player, land on the whole raid and do not stack, so "whose was this one" is the only question about
 * either that a single merged bar cannot answer — and it is the question `stormlashOverlaps` already
 * measures a number for. A buff the player put up themselves has no source worth naming.
 */
export interface LaneSource {
	/**
	 * The report actor id of the *player* who cast it, not the object that applied it.
	 *
	 * Both of these buffs are applied by a summon — the totem, the banner — so the event's own `sourceID`
	 * is a pet, and a row labelled `Pet (39)` names nothing a reader can act on. This is that pet's
	 * `petOwner` resolved, falling back to the id the event carried where the actor list cannot answer.
	 */
	id: number;
	/**
	 * The caster's name, or null when the report's actor list did not name them.
	 *
	 * Never invented, for the reason `LaneTarget.name` is not: a row named after the wrong raid-mate is
	 * worse than a row that only names the buff, which is what the chart draws when this is null.
	 */
	name: string | null;
	/**
	 * True on the row for the player the report is about — the totem or banner they pressed themselves.
	 *
	 * **The chart cannot work this out and that is why the engine says it.** `CastTimeline` reads an
	 * `Analysis`, which carries no actor id, so "is this row mine" is not a question it can answer by
	 * comparing anything it holds. It needs the answer to merge the player's own press into their own
	 * row: their cast lane and their buff row are one fact about one totem, and the merge rule cannot
	 * pick which of several same-key rows to fold the press into without being told.
	 *
	 * `LaneSource.id === actor.id` is what this is, resolved through `petOwner` like the id itself —
	 * so a totem is credited to the shaman who placed it rather than to the totem.
	 */
	own: boolean;
}

/**
 * One window of a lane: the engine's `AuraWindow`, with both of its extras optional.
 *
 * The engine builds most lanes through `auraWindows`, so at the moment of measurement both fields
 * are there — but a lane is *serialised*, and what comes back out of a captured analysis is not
 * guaranteed to carry them. Two lanes on the current fixtures already do not: Rising Sun Kick's
 * debuff and Storm, Earth and Fire are assembled from their own walks rather than from that one.
 * Declaring `AuraWindow[]` here would therefore be the type claiming an `id` the data has not got,
 * which is the direction of error this file exists to avoid.
 *
 * `variant` is the half the chart reads. An aura whose ids encode one — Re-Origination logs a
 * different id per stat it converted into — carries the answer on each window, which is what lets
 * the timeline name the stat instead of drawing three indistinguishable bars. Optional, and read for
 * `undefined`: an aura with no variants has none, and neither has an analysis captured before the
 * walk recorded them.
 *
 * **`preexisting` and `truncated` arrive through `Window`, and a lane builder must not drop them.**
 * That pair is the window's provenance (see `Window.preexisting`), and it is the only thing that
 * separates a bar the log proved both ends of from one inferred off the pull snapshot — so a builder
 * that rebuilds each window as `{ start, end }` hands the chart a bar it cannot tell apart from a
 * logged one. This is not a type the compiler can enforce, because a narrower object still satisfies
 * a wider optional type; it is a rule, and it is written here because the Elemental's lane builder
 * broke it — `windows.map((w) => ({ start: w.start, end: w.end }))` — and the marking §6 asked for
 * could not land until it stopped. `id` and `variant` are the two that stay genuinely optional.
 */
export type LaneWindow = Window & Partial<Pick<AuraWindow, 'id' | 'variant'>>;

/** One aura's windows, as a row drawn under the casts. */
export interface AuraLane {
	/** The aura's key in the spec's game model — stable, and what a React list keys on. */
	key: string;
	name: string;
	/** The spell whose icon stands for the row. */
	id: number;
	group: LaneGroup;
	windows: LaneWindow[];
	/**
	 * Which enemy these windows are on, when the aura is per-target.
	 *
	 * Absent on a buff or a proc, and absent on any analysis captured before per-target lanes existed
	 * — so read it for truthiness, never against null. Several lanes then share one `key` and differ
	 * only by target, which is why the chart composes its React key from both.
	 */
	target?: LaneTarget;
	/**
	 * Which raid-mate cast this instance, when the aura is a raid buff somebody else pressed.
	 *
	 * Absent on everything the player put up themselves, and absent on any analysis captured before
	 * per-caster lanes existed — so read it for truthiness, never against null. A lane that carries one
	 * is **one instance**: several lanes then share the aura's key and each holds a single window, which
	 * is what makes two staggered Stormlash totems two rows a reader can see stacking. The chart
	 * composes its React key from the key and the instance for the same reason it does for `target`.
	 */
	source?: LaneSource;
	/**
	 * The counter behind the window, when the aura stacks and the log actually counted it.
	 *
	 * Absent on every plain on-or-off aura, and absent on any analysis captured before this existed —
	 * so read it for truthiness. A lane that has it is drawn as its charge rather than as a bar.
	 */
	stacks?: LaneStacks;
	/**
	 * What became of each window, for an aura that is *spent* rather than waited out.
	 *
	 * One entry per window, matched back to it by `start`. Absent on every aura nothing consumes, and
	 * absent on any analysis captured before this existed — so read it for truthiness.
	 */
	spent?: LaneSpend[];
}

/**
 * How one window of a spendable aura ended.
 *
 * The distinction is the point: a buff that was cashed in and a buff that ran out are the same bar,
 * and only one of them is worth pressing for. `id`/`name` name the press that spent it; both null
 * means nothing did, and `fate` is then how it came off instead — or absent, which is the honest
 * third answer for a window that ended with no press at the removal and no clock run out either. On
 * the reference pulls that last case is the player dying, and every buff coming off at once.
 */
export interface LaneSpend {
	/** The window this is about, identified by the moment it opened. */
	start: number;
	/** The press that spent it, or null when none did. */
	id: number | null;
	name: string | null;
	/** Why it came off when no press spent it: the duration ran out, or the pull ended first. */
	fate?: 'expired' | 'truncated';
}

/**
 * A stacking aura's charge over the pull, and what spending it paid for.
 *
 * Split out of `AuraLane` because a lane that carries one is a different drawing, not a bar with an
 * extra field: the window is the *cycle* and the number inside it is the point.
 */
export interface LaneStacks {
	/**
	 * `[t, n]` after every event that moved the counter, `n` being the charge the log stamped.
	 *
	 * A step series, not samples: a charge holds its level until the next reading, so a slope between
	 * two entries would draw a fraction of a charge nobody ever had.
	 */
	points: Array<[number, number]>;
	/** The ceiling the aura stacks to, from the game model rather than from this pull's peak. */
	max: number;
	/** What reaching the ceiling paid out, by the name of the spell that landed it. */
	payoff: string;
	/** That spell's own id, so the chart can draw its icon without ever learning a spell id itself. */
	payoffId: number;
	/**
	 * Every payoff on the clock, with what it hit for.
	 *
	 * These are damage events and not an inference off the counter: a discharge is drawn where the log
	 * put it, never where the counter suggests it should have been.
	 */
	discharges: Discharge[];
}

/** One payoff on the clock: when it landed, what it hit for, and the charge it spent getting there. */
export interface Discharge {
	t: number;
	amount: number;
	/**
	 * When the counter that paid for this emptied — always at or before `t`, and null when the log
	 * shows no emptying before it at all.
	 *
	 * The gap between the two is real and is the gem's, not a sampling artefact: the buff comes off,
	 * then the strike lands a median of ~260ms later, tailing to 2.8s. It is carried so the chart can
	 * *draw* that wait rather than leaving a reader with a counter that quits early beside a strike
	 * that arrives from nowhere — but it moves neither timestamp, and the discharge is still placed on
	 * its own damage event.
	 *
	 * Attribution is by order alone and needs no tolerance: the last emptying before this strike. A
	 * fill cannot discharge twice, and across both reference reports every strike follows an emptying
	 * and none precedes one. Null is the honest answer where that does not hold, and the chart then
	 * draws the strike with no wait behind it.
	 */
	from: number | null;
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
	/**
	 * The lanes that count is about, carried rather than discarded.
	 *
	 * `lanes` is the set the chart draws by default and stays exactly that — the cap is a reading
	 * decision the engine still makes, and a reader who touches nothing sees what they always saw. But
	 * the enemies past the cap used to be reduced to a number here and thrown away, which left the
	 * chart unable to offer them at all: a picker cannot draw a lane it was never handed. These are
	 * the same lanes in the same order the cap cut them at, so `lanes` ++ `hiddenLanes` is the full
	 * per-target set, primary first and then by damage taken.
	 *
	 * Absent on an analysis captured before this existed, where `hiddenTargets` is a count with no
	 * lanes behind it — so read it for truthiness and treat the count as the last word when it is
	 * bigger than what arrived here.
	 */
	hiddenLanes?: AuraLane[];
	/**
	 * The player's own deaths, in order.
	 *
	 * Empty on most pulls and absent on any analysis captured before this existed, so read it for
	 * truthiness. A death is not graded anywhere in this report — the sections measure what was
	 * pressed, and a corpse presses nothing — but it is the single loudest explanation for a lane that
	 * simply stops, which is why the timeline marks it.
	 */
	deaths?: DeathMark[];
}

/**
 * One death, on the clock.
 *
 * The event carries `sourceID: -1` and names the victim in `targetID`, so this is filtered by target
 * and not by source — the same event WarcraftLogs returns for a `sourceID` filter matching the
 * victim, which is what makes these free of any extra query.
 */
export interface DeathMark {
	/** Fight-relative ms, like every other timestamp in this file. */
	t: number;
	/**
	 * The spell that landed the killing blow, or null when the log did not name one — it logs a `0`
	 * for an environmental death, and a zero would resolve to an icon nobody has.
	 */
	abilityId: number | null;
	/**
	 * That spell's name, resolved through the same table every other id in this report goes through.
	 * Null when there was no id to resolve; `#<id>` when there was one and nothing could name it,
	 * which is this report's standing answer for an id it does not know rather than an invented name.
	 */
	ability: string | null;
	/**
	 * When the player was back on their feet, or the end of the pull when they never were.
	 *
	 * A death is a span, not an instant: everything between it and the resurrection is time the player
	 * could not act, and drawing it as a line understates it to nothing. `resurrected` is what tells
	 * the two cases apart — a battle res two seconds later and a corpse held to the kill are the same
	 * mark otherwise, and only one of them explains a chart that stops.
	 */
	until: number;
	resurrected: boolean;
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
	/**
	 * Every stack the pull earned, cap losses included — `totalConsumed + bankAtEnd + wastedAtCap`.
	 *
	 * The denominator the two leaks are read against. It arrives from the bank walk rather than being
	 * added up from those three fields by whoever needs it, because the identity only holds when every
	 * drain paired to a buff window: `totalConsumed` sums `useList`, which drops any that did not, so a
	 * caller's arithmetic and the chart drawn from `bankTimeline` could disagree by a whole brew.
	 *
	 * A stack the cap refused counts as gained. The chi that bought it was spent either way, which is
	 * what makes it a loss rather than a stack that was never earned.
	 *
	 * Optional because the committed fixtures predate it. `undefined` there, never `0` — a pull that
	 * earned nothing and a pull captured before this existed are different answers, and only the second
	 * one means "cannot say".
	 */
	stacksGained?: number;
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
	/**
	 * True when this proc was skipped on purpose, by weaving a battle elixir straight after the brew.
	 *
	 * Not a miss and not a near miss — the play the report's own copy asks for. Tigereye Brew freezes
	 * `0.05 + masteryPercent` at cast, so a brew held to the end of a Mastery proc is already carrying
	 * that proc's mastery for its whole fifteen seconds. Swapping to a secondary-lifting elixir
	 * immediately afterwards makes a *different* secondary the highest on the sheet, so the Rune's
	 * next conversion returns that stat instead of re-serving mastery the brew is already holding —
	 * and a second brew cast during it would freeze nothing but base mastery. There was never
	 * anything here to catch, so it is excluded from `opportunities` rather than counted as a chance
	 * missed. `undefined` on the committed fixtures, which predate it.
	 */
	weaved?: boolean;
	/**
	 * The Rune returned a stat Tigereye Brew cannot freeze, and no brew was cast on it.
	 *
	 * The wider fact that `weaved` is one cause of. The brew's multiplier is `0.05 + masteryPercent`,
	 * read once at cast — mastery and nothing else — so a proc that converted into crit or haste offers
	 * a brew nothing to hold, whether the player engineered it with an elixir or the Rune simply landed
	 * on a secondary that was already top of the sheet. There was no snapshot on offer either way, so
	 * this is what the charts colour and what leaves `opportunities`.
	 *
	 * `weaved` survives as the *engineered* subset because the two need different words: one is a trade
	 * the player made, the other a roll they were handed, and saying "on purpose" about the second
	 * asserts an intent the log does not show.
	 */
	unholdable?: boolean;
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
	/**
	 * Procs skipped on purpose by weaving an elixir. Out of `opportunities`, and never a fault.
	 *
	 * A subset of neither `snapshotted` nor `unaffordable` — its own reason for a proc leaving the
	 * denominator, and the only one of the three that is a thing the player *did* rather than a thing
	 * that happened to them. Optional because the fixtures predate it.
	 */
	weaved?: number;
	/** Procs the brew could not have held at all — the engineered ones above plus the unlucky rolls. */
	unholdable?: number;
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
	/** The debuff on the primary target: the window model the timeline draws and the drops are read from. */
	uptimeMs: number;
	uptimePct: number;
	/**
	 * The **primary target's** clock: the union of `engagedSegments`, and not what this section grades.
	 *
	 * What still reads it: the chart's out-of-reach track, which is this array's complement and is
	 * labelled as that one enemy's absence. Every fraction the report grades a choice by — this
	 * section's three tiles, Chi Brew's ceiling and idle share, the energy bar's capped/downtime split —
	 * is against `contactMs` below. Keeping both is deliberate; merging them is how the section came to
	 * measure a numerator that follows the player against a denominator that follows the boss.
	 */
	engagedMs: number;
	/**
	 * The clock this section measures against: the union of `contactSegments`, when the player was in
	 * contact with **anything**.
	 *
	 * On the Galakras kill in `a:6MhZgjyAknFWrYfK` the boss is reachable for 66.6 seconds of a 434-second
	 * pull, so `engagedMs` described 15% of the fight and the section reported 97.5% uptime for a player
	 * who spent 317 seconds fighting. Against this the same pull reads 80.7%, and the cast ceiling goes
	 * from 8 kicks to 39 against the 38 they actually made.
	 *
	 * Optional because the committed fixtures are `analyse()` output captured before it existed — read it
	 * for truthiness and fall back to `engagedMs`, which is what those fixtures were graded on.
	 */
	contactMs?: number;
	/**
	 * The graded figure: how much of contact time the debuff was up **on the enemy being hit**.
	 *
	 * Not the primary target's uptime, which is what this used to be and what `uptimeMs`, `uptimePct`,
	 * `drops` and `intermissionSec` still are. At each moment the enemy in question is the one the
	 * player's most recent landed hit was on, and the question is asked of that enemy's own debuff
	 * windows — the reader's own rule, that uptime counts as long as there is no downtime and a target in
	 * melee range.
	 *
	 * The difference is not a rounding one. On a real 33-enemy pull the primary-only reading was 20.5%
	 * and this one is 69.1%; the pull was not 20% covered, it was a player kicking adds that were
	 * carrying the debuff while a metric watched one enemy they had left. Its denominator moved with it:
	 * measuring the same numerator against the boss's clock is the same fault one level up, and read 97.5%
	 * on a Galakras pull that is 80.7%. The name is now a half-truth — this is contact time, not the
	 * `engagedMs` above — and it stays only because renaming it would strand the committed fixtures. It
	 * should become `contactUptimePct` in the same commit that re-captures them.
	 */
	engagedUptimePct: number;
	/**
	 * That figure's remainder: contact seconds whose enemy was **not** carrying the debuff.
	 *
	 * `engagedUptimePct + secondsLost / contactMs` is 100% by construction — it is one measurement split
	 * in two, which is the whole point of it. It used to be the primary target's dropped time, and the
	 * section printed the two beside each other as though they answered the same question: on a two-boss
	 * pull that read 1.4s lost next to 59% uptime, a tile claiming a fight was all but perfect against an
	 * uptime saying it was nothing of the sort.
	 *
	 * So it is *not* the sum of `drops` below and must not be presented as one. Those are the primary
	 * target's own gaps and are a shorter list than this number is made of.
	 */
	secondsLost: number;
	/**
	 * The longest gap between the primary target's debuff windows, read as the pull's intermission.
	 *
	 * A heuristic, and only ever load-bearing for one thing: it is the gap `drops` leaves out, on the
	 * theory that an untargetable phase is not a drop anybody caused. It is not what keeps intermissions
	 * out of `engagedUptimePct` — `contactSegments` does that, from the player's own damage — so copy
	 * quoting this must say it is about the drop list and about that one enemy. On a two-boss fight it
	 * measures the stretch spent on the other boss and calls it an intermission.
	 */
	intermissionSec: number;
	/** The primary target's own gaps, longest one excluded: what the timeline plots and the ledger lists. */
	drops: Array<{ at: number; seconds: number }>;
	windows: Window[];
	/** The primary target's windows, summed as `engagedMs`. The chart's out-of-reach track is their complement. */
	engagedSegments: Array<[number, number]>;
	/**
	 * When the player was in contact with any enemy, not only the graded one.
	 *
	 * The wider of the two, summed as `contactMs`, and the one a chart should shade against.
	 * `engagedSegments` is scoped to the primary target, so its complement is "you were not on the boss",
	 * which on an add fight is most of the pull and is not downtime. Optional because the committed
	 * fixtures predate it — read it for truthiness and fall back to the narrower one rather than to
	 * nothing.
	 *
	 * These are also the windows Rising Sun Kick is measured against: uptime, the time without it, and
	 * the cast ceiling are all fractions of this one clock, so they cannot disagree about which fight
	 * they are describing.
	 */
	contactSegments?: Array<[number, number]>;
	/**
	 * The graded figure as a picture: when the enemy the player was hitting was carrying the debuff.
	 *
	 * `unionMs` of this **is** `engagedUptimePct`'s numerator, which is the point of publishing it — the
	 * section's chart draws these stretches rather than the primary target's own windows, so the picture
	 * and the tiles above it are one measurement in two shapes. Against `contactSegments` the three
	 * tracks partition the pull exactly: up here, down elsewhere inside contact, and outside contact
	 * nothing was being fought at all.
	 *
	 * What it replaced was a chart of the boss's windows sitting under tiles about every enemy, whose
	 * third track called 380 seconds of a 434-second Galakras pull "out of reach" while the player spent
	 * 317 of them fighting.
	 *
	 * Optional because the committed fixtures predate it; without it a reader has to fall back to the
	 * primary target's window model, which is what those fixtures were measured on anyway.
	 */
	contactUpSegments?: Array<[number, number]>;
	/** Percentage of the player's damage that landed on the primary target. */
	primaryDamageShare: number;
	/**
	 * True when the pull's damage was concentrated on the primary target.
	 *
	 * A whole-pull average, and read as one: it no longer decides whether uptime is graded — the figure
	 * above is fair on an add fight — and what is left of it is the Energizing Brew audit's reading of
	 * the priority list's `numberTargets >= 2` exception, plus the caveat the section prints beside a
	 * spread pull. `Analysis.targets` is the per-moment answer to the same question.
	 */
	singleTarget: boolean;
}

/**
 * What a pull was fought against: one enemy, or several.
 *
 * Two values and no third. `unknown` was considered and rejected — a pull always has a count of
 * enemies being hit, and the honest expression of doubt here is the detected/overridden pair below
 * rather than a mode nothing can act on.
 */
export type TargetMode = 'single' | 'multi';

/**
 * How many enemies the player was damaging, moment by moment, and what that makes the pull.
 *
 * The report could previously only answer this as a whole-pull average — `debuff.primaryDamageShare`
 * — which cannot say that four minutes of one target and one minute of six adds were different
 * minutes. That average is what the APL ladder in `lib/spec/apl.ts` refuses on, and it refuses whole
 * pulls at a time.
 */
export interface TargetSummary {
	/**
	 * The trailing window a count is taken over.
	 *
	 * A count at an instant is always one — a monk hits one enemy per swing — so the window is what
	 * turns a sequence of single hits back into "three enemies were being cycled".
	 */
	windowMs: number;
	/**
	 * The count over the pull, as `[ms, enemies]` steps holding until the next point.
	 *
	 * Deliberately the same shape as the energy and chi bars: `apl.ts` reads those with one binary
	 * search over `[t, value]` pairs, and a series in a shape of its own would need a second reader
	 * that could disagree with the first. `max` is the most enemies damaged inside one window.
	 */
	counts: ResourceCurve;
	/**
	 * Time spent damaging two or more enemies, and its share of the time anything was being damaged.
	 *
	 * Contact time is the denominator, not engaged time and not pull length: engaged time is the boss's
	 * clock and would call a fight whose middle three minutes are add waves single-target, and pull
	 * length counts intermissions nobody could hit anything in as evidence for one target.
	 */
	multiTargetMs: number;
	multiTargetPct: number;
	/** The share `detected` was decided against, so the copy can name the line rather than repeat it. */
	thresholdPct: number;
	/**
	 * What the pull looks like from the counts alone.
	 *
	 * Detected, never enforced: a reader who deliberately ignored the adds to parse can say so, and
	 * `lib/view/targetMode` is where their answer and this one are reconciled. This field is what the
	 * report shows them so they can see they are disagreeing with it.
	 */
	detected: TargetMode;
}

/**
 * Chi Brew, which is a talent — so a pull with none of it is two different reports.
 *
 * `talented` comes from `combatantinfo`, not from whether the button was ever pressed: "did not take
 * it" and "took it and never used it" are opposite findings, and inferring the first from the second
 * reads a forgotten cooldown as a deliberate choice. Null when the log carried no `combatantinfo`,
 * which is a third answer again — the report cannot say.
 */
export interface ChiBrewAudit {
	talented: boolean | null;
	casts: number;
	/** Chi it actually returned, summed from the log's own `resourcechange` amounts. */
	chiGained: number;
	/** Chi it returned into a bar with no room, summed from those events' own `waste`. */
	chiWasted: number;
	/**
	 * The charge counter over the pull, one point per change.
	 *
	 * Recorded by the same walk that produces `cappedMs`, not rebuilt from the casts afterwards — a
	 * chart drawn from a second reconstruction is free to disagree with the figure printed beside it.
	 */
	charges: Array<[number, number]>;
	/** The stretches both charges sat full, for the chart to shade. Zero-width instants are excluded. */
	cappedWindows: Window[];
	maxCharges: number;
	/** Time both charges sat full, which is recharge time that will never be spent. */
	cappedMs: number;
	cappedPct: number;
	/**
	 * The chi that idle time would have returned, as a fraction of a press.
	 *
	 * Idle seconds priced in the unit the button pays out, because "20 seconds at two charges" is a
	 * fact about the cooldown and this is what it cost. Deliberately not rounded to a whole press: a
	 * recharge that never ran is a share of one, and calling it a use the player missed would claim
	 * the pull had room for something it did not.
	 */
	chiLostToIdle: number;
	/** Roughly how many uses the pull had room for: the opening two charges plus one per recharge. */
	possibleUses: number;
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
 * would grade the sampling grid. What is graded here is the haste clause, which is an aura and
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
	/** True when a haste window overlapped at least two live targets while Rushing Jade Wind was active. */
	hasteRjwEligible: boolean;
	/** Energizing Brew uses made during an eligible haste/RJW window. */
	hasteRjwUses: number;
	/**
	 * The haste cooldowns running over the pull — Bloodlust, Time Warp and the rest of that group.
	 *
	 * Carried so the section can draw them behind the brews rather than only naming them per row:
	 * whether a brew sat inside one is the condition being judged, and an overlap is a thing to see.
	 *
	 * `AuraWindow` rather than `Window`, which is what the engine has always put here: one effect
	 * logged under five ids, each window carrying the one that opened it. The narrower type threw that
	 * away at the boundary, and the cast timeline needs it — a band shading a stretch of the pull has
	 * to be able to say it was Time Warp rather than "one of five spells".
	 */
	hasteWindows: AuraWindow[];
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

/** Time at a resource bar's cap over one stretch of the pull, and what it cost. */
export interface ResourceCapSplit {
	cappedMs: number;
	/** Against the length of the stretch this describes, not of the whole pull. */
	pct: number;
	/** Points that arrived on a full bar and evaporated. Null when no regen rate could be measured. */
	wasted: number | null;
}

/**
 * The audit of a pool bar — one that refills on a clock (energy, mana, rage) — and what topping it
 * out cost.
 *
 * Reconstructed rather than assumed, and the correction to a claim this report used to make in
 * three places. `resourcechange` events really are useless as a curve — around twenty on a
 * five-minute pull, every one an Energizing Brew tick — but they are not where the bar lives.
 * WarcraftLogs staples a `classResources` snapshot onto ordinary casts, damage and heals when the
 * events query passes `includeResources: true`, at about three readings a second, and that flag
 * costs no API points at all.
 *
 * The split is the point of the whole audit. Raw time at the cap is not a fault: a pool fills while
 * a boss is untargetable exactly as it does while you are hitting one, and a metric that charged a
 * player for an intermission would be inventing a mistake out of the fight's own script. Only
 * `engaged` describes a decision.
 *
 * Computed once per configured pool bar by the engine (`~/lib/analysis/energy`), so a second spec
 * that spends a pool gets the same audit without writing any of it.
 */
export interface PoolResourceAudit {
	/** Which half of the generic resource section this is. */
	kind: 'pool';
	/**
	 * Which bar this is, in the sim's own vocabulary — so the view can colour it from the sim's
	 * palette rather than the spec's.
	 */
	type: ResourceTypeValue;
	/** The readings themselves, for the charts. */
	curve: ResourceCurve;
	/** The bar's ceiling, straight off the samples — so a talent that widens it needs no inference. */
	max: number;
	/** Readings the curve was built from. Zero means the log carried none, which is a caveat not a zero. */
	samples: number;
	/** Points per second, measured from the samples. Null when the pull was too quiet to measure one. */
	regenPerSec: number | null;
	/** Median gap between readings: the shortest cap this can see at all. */
	medianGapMs: number;
	/** 99th percentile gap. A cap that opened and closed inside one of these is invisible here. */
	p99GapMs: number;
	/** The stretches the bar was provably full, merged and in time order. */
	capped: Array<[number, number]>;
	total: ResourceCapSplit;
	engaged: ResourceCapSplit;
	downtime: ResourceCapSplit;
	/** The longest stretches spent full, longest first, each with a link into the log. */
	worst: Array<{ at: number; ms: number; engaged: boolean; link: string }>;
}

/**
 * The audit of a points bar — one that arrives in whole units from a button (chi, holy power) —
 * and every point of it that went nowhere.
 *
 * The complement to `PoolResourceAudit`, deliberately. A pool's fault is a *duration* at the ceiling
 * with the tap still running, and it has to be split into engaged and downtime before it can be
 * judged. A points bar's fault is a *count*: a press that returned two into a bar with room for one
 * threw one away, and it did so whether or not there was a boss in front of you. Nothing to split.
 *
 * The curve's `wasted`/`gained`/`spent` ride on the readings because the chart draws both: the walk
 * that reconstructs the bar clamps each gain at the ceiling, so the three are one accounting rather
 * than three numbers that need not add up.
 */
export interface PointsResourceAudit {
	/** Which half of the generic resource section this is. */
	kind: 'points';
	/**
	 * Which bar this is, in the sim's own vocabulary — so the view can colour it from the sim's
	 * palette rather than the spec's.
	 */
	type: ResourceTypeValue;
	/**
	 * The readings themselves, for drawing, carrying the bar's accounting — the moments it
	 * overflowed and by how much (`wasted`), what the pull generated (`gained`) and paid out
	 * (`spent`).
	 */
	curve: ResourceCurve;
	/**
	 * The reconstructed bar, for the ladder and the audits that judge presses.
	 *
	 * Not the sampled curve, deliberately. The readings land only on spenders and are a median 2.4
	 * seconds apart on a real pull, which makes them useless for judging a press; the walk fills the
	 * gaps, and its accuracy is measured (`predicted`/`exact`) rather than asserted.
	 */
	walk: { max: number; points: Array<[number, number]> };
	/** How many of the walk's steps the log's own readings checked. */
	readings: number;
	/** Of those, how many the walk had predicted to the point. */
	predicted: number;
	/** And how many of those predictions were exactly right. */
	exact: number;
}

/** One declared bar's full audit — which half the generic resource section renders. */
export type ResourceBarAudit = PoolResourceAudit | PointsResourceAudit;

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
	/**
	 * What the bar took in and paid out over the pull. Chi's only, and both counted by the same
	 * forward walk that reconstructs the curve — gains clamped at the ceiling so that gained, spent and
	 * wasted are three views of one accounting rather than three numbers that need not add up.
	 */
	gained?: number;
	spent?: number;
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

/** One stretch Rising Sun Kick sat ready on a bar a Blackout Kick had emptied. */
export interface StarvedKick {
	/** When the kick came off cooldown, fight-relative. */
	at: number;
	/** How long it then waited on a bar too thin to pay for it, on the same clock the drift uses. */
	ms: number;
	/**
	 * What the reconstructed bar read at the first global after the kick came up.
	 *
	 * The evidence, carried rather than summarised, and it settles a caveat that would otherwise have to
	 * be stated as a doubt: the tier-16 four-piece knocks a chi off both kicks and nothing in this
	 * report reads set bonuses, so a row that read 1 would be a row a tiered player could have kicked
	 * through. A row that read 0 could not have been kicked through at any cost the game offers.
	 */
	chi: number;
	/** The Blackout Kick answerable for it — the last one pressed while the kick was coming back. */
	pressAt: number;
	/** Whether the debuff was actually off the primary target for part of that wait. */
	debuffDown: boolean;
	link: string;
}

/**
 * Blackout Kick: the chi dump, and the one cost it carries that is not its own.
 *
 * The presses themselves are judged by the priority list and nowhere else — `apl.presses` already
 * carries a verdict per global and the section reads them there, so nothing in this audit re-decides
 * whether a press was wanted. What the ladder cannot say is what a press cost *later*: both kicks
 * cost two chi, Rising Sun Kick has an eight-second cooldown and this one has none, so a dump can
 * empty the bar the kick is about to need. The sim's own dump rule is written against exactly that —
 * APL 32 fires only when the energy banked by the kick's return still covers the generator — so this
 * measures the failure the list exists to avoid rather than a standard invented here.
 *
 * Every figure is about the *bar*, never about the list, which is why none of it moves with the
 * reader's target count: how many enemies were in front of the player does not change whether they
 * had two chi.
 */
export interface BlackoutKickAudit {
	casts: number;
	/**
	 * Time Rising Sun Kick sat ready and unpressed — the same drift the lost-cast row prints for it,
	 * from the same function over the same engaged clock, so the two can never disagree.
	 */
	driftMs: number;
	/**
	 * The part of that drift the reconstructed chi bar could not have paid for a kick through.
	 *
	 * The remainder is a priority mistake rather than a chi one: the kick was affordable and something
	 * else was pressed, which is the ladder's business and not this audit's.
	 */
	starvedMs: number;
	/**
	 * How many separate waits that starved time was, so the section can say what share of them this
	 * button is answerable for rather than implying it is answerable for all of them.
	 */
	starvedWaits: number;
	/**
	 * The part of the starved time a specific Blackout Kick is answerable for, and the presses.
	 *
	 * Answerable is a deliberately narrow test — see `starvedKicks` in the engine. A wait is charged to
	 * a press only when holding that press would demonstrably have covered the shortfall, so starved
	 * time with no press behind it stays in `starvedMs` and is never blamed on this button.
	 */
	chargedMs: number;
	charged: StarvedKick[];
	/**
	 * How the reconstructed bar scored itself: readings the walk predicted, and how many it got right.
	 *
	 * Carried because every judgement above rests on it. WarcraftLogs stamps chi onto a spender and
	 * nothing else, so the bar between readings is walked forward through what each button gains and
	 * costs; a press judged on a bar one point out is exactly the error that turns "could not afford
	 * it" into "chose not to". A section that cannot state its own accuracy should not be printing
	 * these numbers, so it is handed the means to.
	 */
	chiExact: number;
	chiPredicted: number;
}

/**
 * Touch of Karma: a defensive that returns damage, so an unused charge is damage not done.
 *
 * The cap *is* claimed here now, and only on a pull that measured it. What the redirect absorbs
 * cannot exceed a full health pool, so a use that drained its pool states one outright — see
 * `karmaCap` in `spec/windwalker` for the game-database citation and the measurement. A pull where
 * no use drained one says "cannot say" instead: no pool is ever derived from a player's health bar,
 * because on these logs that bar is a percentage — `maxHitPoints` is 100 on every player-describing
 * event, while NPCs in the same report carry absolute values — and the estimate it yields is only
 * good to about ±10%.
 */
export interface KarmaAudit {
	casts: number;
	/** How many the cooldown allowed across the pull. */
	available: number;
	/** Total damage redirected onto the target. */
	reflected: number;
	/**
	 * Total damage the redirect *absorbed*, which is the quantity the cap constrains.
	 *
	 * Not interchangeable with `reflected`: the redirect deals a twentieth more than it took, so this
	 * is the only one of the two a health pool divides. Optional because the committed fixtures are
	 * captured `analyse()` output from before it existed and are cast to `Analysis` rather than
	 * migrated — absent means "analysed by an older build", never zero.
	 */
	absorbed?: number;
	/** Share of the player's whole damage that came from the redirect. */
	sharePct: number;
	/**
	 * The health pool, measured from a use that drained it — null when no use on the pull did.
	 *
	 * This used to come from the settings, and asking was never necessary: an exhausted use absorbs
	 * exactly one pool. The setting is gone, so a stored `maxHealth` from an older build is now an
	 * unknown key that `normaliseSettings` drops.
	 */
	capPerUse: number | null;
	/** Uses that reached their ceiling. Absent on a fixture captured before it was measured. */
	exhausted?: number;
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
		/** What this use absorbed. Absent on a fixture, for the same reason the total above is. */
		absorbed?: number;
		hits: number;
		/**
		 * This use drained its pool, so it returned everything it was worth.
		 *
		 * The actionable half of the section, and the half that needs no pool: a use that drained one
		 * cannot be faulted, whatever the number beside it. Absent on a fixture, never `false`.
		 */
		exhausted?: boolean;
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

/**
 * Storm, Earth and Fire: up to two spirits that mirror the monk onto other enemies.
 *
 * The spell is 137639 in a Mists Classic log — both the press and the aura whose stacks count the
 * spirits — and not the 138228 the simulator registers; see `castIds` on the ability in
 * `~/specs/windwalker/lib`, which carries the evidence.
 *
 * Two things are worth knowing about a pull, and this carries both without grading either. Whether
 * the button was worth pressing is `justified`, decided by the reader's ten-second rule. Whether the
 * presses were spent well is `overlapMs`: the time the player spent hitting an enemy one of their own
 * spirits was already on, which is the one way the cooldown is wasted after it goes out.
 */
/** One enemy of the pull, and when a Storm, Earth and Fire spirit was standing on it. */
export interface SefTargetLane {
	id: number;
	/** Null when the report's actor list cannot name this id. Never guessed from a neighbour. */
	name: string | null;
	/**
	 * Stretches a spirit was demonstrably on this enemy. Empty is a real answer — the player engaged it
	 * and no spirit ever went there — so the lane is still drawn rather than dropped.
	 */
	windows: Window[];
	heldMs: number;
	heldPct: number;
	/**
	 * First to last damage the player's side landed on this enemy.
	 *
	 * The measurable stand-in for "how long it stood in front of the player". Enemy deaths are *not* in
	 * the fetched stream — a `sourceID` filter returns a death only when the player is the victim — so
	 * nothing here claims an enemy died, only that contact with it started and stopped.
	 */
	engagedMs: number;
	/**
	 * Time the player was hitting this enemy while one of their own spirits was already on it.
	 *
	 * The pull-wide `SefAudit.overlapMs` kept per enemy instead of summed, and off the same loop — so
	 * the rows add to the total by construction rather than by two passes agreeing. It is an
	 * intersection of "a spirit was here" with "so were you", which means it can never exceed `heldMs`
	 * or `engagedMs`; the suite asserts that rather than trusting it, because a slip in the segment
	 * bounds would surface here first and as a figure a reader has no way to challenge.
	 *
	 * Absent on an analysis captured before the column existed, so read it for truthiness.
	 */
	overlapMs?: number;
}

export interface SefAudit {
	/**
	 * Spirits sent out on this pull — **not** the number of presses, and the difference is real.
	 *
	 * A spirit placed before the pull costs no global inside it and logs no cast inside it, so counting
	 * casts undercounts the pull by exactly those. One reference pull carries two casts and had three
	 * spirits. See `pressed` for the press count and `prePlaced` for the gap between them.
	 */
	casts: number;
	/** Presses of the button inside the pull. What the cast table and the GCD figures count, correctly. */
	pressed?: number;
	/** Spirits already out when the pull began. Not a missing cast — a thing players deliberately do. */
	prePlaced?: number;
	/**
	 * Every spirit sent out, with the enemy it was aimed at.
	 *
	 * `target`/`name` are null when the log named no target and when the actor list cannot name it.
	 *
	 * `deduced` marks a target read from the spirit's own first swings rather than from a press — the
	 * pre-pull case, whose cast lies outside the fight window. It stays visibly a different quality of
	 * evidence: a press states where a spirit was *sent*, a swing proves where it *stood*, and the two
	 * can disagree for a spirit that was recalled and re-sent. A pre-pull spirit that never swung leaves
	 * nothing to read and keeps its null, because "cannot say" is still an answer.
	 *
	 * `actorID` is the pet the `summon` event named, or null on a log carrying no summon for it.
	 */
	uses: Array<{
		t: number;
		prePull?: boolean;
		target: number | null;
		name: string | null;
		deduced?: boolean;
		actorID?: number | null;
		link: string;
	}>;
	/** Stretches with at least one spirit out, read off the aura rather than measured from a press. */
	windows: Window[];
	uptimeMs: number;
	uptimePct: number;
	/** Distinct pet actors the spirits used. Three exist; at most two are out at once. */
	clones: number;
	/**
	 * Damage the spirits dealt, and its share of the player's whole.
	 *
	 * Already inside the player's total — WarcraftLogs returns a pet's damage under its owner's filter
	 * — and deliberately not broken out into the ability rows: a spirit's Blackout Kick logs under the
	 * monk's own id, so separating them would mean claiming a split the log does not state.
	 */
	cloneDamage: number;
	cloneSharePct: number;
	/**
	 * Time the player spent hitting an enemy one of their own spirits was already on.
	 *
	 * **Null is a real answer and is not zero.** A pull that pressed the button but whose spirits left
	 * no identifiable actor cannot be asked this at all, and printing "never doubled up" there would be
	 * an invented compliment in the same way a fabricated fault is an invented accusation.
	 */
	overlapMs: number | null;
	/** Time inside the spirits' windows the player was demonstrably on some enemy: the denominator. */
	measuredMs: number;
	overlapPct: number | null;
	/** The enemies it happened on, worst first. `name` is null when the actor list cannot name one. */
	overlaps: Array<{ target: number; name: string | null; ms: number }>;
	/** The rule the section speaks under, so the copy names the number rather than restating it. */
	secondTargetMs: number;
	/** True when some stretch held a second enemy for longer than `secondTargetMs`. */
	justified: boolean;
	/** Total time inside those stretches. */
	justifiedMs: number;
	/** The longest stretch with two or more enemies, whether or not it cleared the rule. */
	longestSecondTargetMs: number;
	/**
	 * Time both spirits were out at once.
	 *
	 * Readable only because the aura is followed as a stack *level* rather than as apply→remove pairs:
	 * a second spirit arrives as `applybuffstack stack: 2` carrying no second apply, so a pair model
	 * cannot see it at all. Zero on a pull that only ever had one out — a measurement, not an absence.
	 */
	doubledMs?: number;
	/**
	 * One lane per enemy: when a spirit of the player's was standing on it, and for how long.
	 *
	 * Read from the **spirits' own single-target swings**, never from the press's target. A cast names
	 * where a spirit was sent and stops being true the moment it moves — a spirit is recalled when its
	 * enemy dies and can be re-sent — so keying these to the press draws a spirit on an enemy it left.
	 * Ordered with the enemies a spirit actually held first.
	 *
	 * Absent on an analysis captured before this chart existed, so read it for truthiness.
	 */
	targets?: SefTargetLane[];
	/** Enemies past the lane cap. Printed rather than truncated in silence. */
	hiddenTargets?: number;
	/** Enemies dropped for an engaged span no longer than `secondTargetMs`. Also printed. */
	shortLivedTargets?: number;
	/** False when the spirits left no actor to follow, so the lanes say nothing rather than nothing-happened. */
	targetsResolved?: boolean;
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

/**
 * The pull's potions, against the two the game allows: one before the pull and one inside it.
 *
 * The two slots are separate facts and are kept separate here, because which one a press filled is
 * not a question the count can answer and is the whole of the advice. A pre-pull potion reaches this
 * by either of two routes: drunk before the fight's event window opened, where it survives only as
 * the bare `removebuff` where it expired, or drunk inside that window but before the player joined
 * the fight, where it logs the ordinary way and is told apart by *when* rather than by *what*. See
 * `potions` in `spec/windwalker` for both readings and the ceiling, `engagedAt` beside it for the
 * boundary the second turns on, and `auraWindows`' `openAtPull` for the first's recovery.
 */
export interface PotionAudit {
	/** The potion this is about, so copy naming it does not hardcode a name the model already holds. */
	name: string;
	/** Its spell id, for an icon or a link. */
	id: number;
	/** Potions the log witnessed, capped at `slots`. */
	used: number;
	/** The ceiling. The simulator's rule rather than a number cut from a sample. */
	slots: number;
	/**
	 * The potion that filled the pre-pull slot, or null when nothing did.
	 *
	 * **Two shapes, and `preexisting` is which.** The slot is about combat rather than about the
	 * clock, and WarcraftLogs starts the clock when the boss is engaged by *anyone* — so a player who
	 * has not joined the fight yet can drink inside the fight window and fill this slot with an
	 * ordinary, fully logged press. `preexisting` is true for the potion that was already running at
	 * the pull and survives only as its own expiry, and false for the press the stream witnessed
	 * before the player themselves entered the fight.
	 *
	 * `drunkMs` is **signed and fight-relative**, so one field covers both: negative on the preexisting
	 * shape, where it is how long before the pull the potion went down and a reader can see the seconds
	 * of its own duration the press spent outside the fight; positive on the other, where it is simply
	 * when the press happened. `expiredMs` is when the potion ran out, fight-relative — the removal it
	 * was recovered from on the first shape, and the end of the press's own window on the second.
	 */
	prePull: { drunkMs: number; expiredMs: number; preexisting: boolean } | null;
	/** Every press inside the fight that was not the one above, fight-relative and in order. */
	combat: number[];
	/**
	 * False when this pull cannot answer the question, which is not the same as answering zero.
	 *
	 * A fight shorter than the potion's own duration hides a pre-pull one completely — it would still
	 * have been running at the last event — and a fight that ended before the potion came back off
	 * cooldown never offered the second slot at all. Either way the count must not be graded, and the
	 * copy must say nothing rather than print `0 of 2` about a pull that was over too soon to ask.
	 */
	measurable: boolean;
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
	/**
	 * True when **this spec** can supply the effect itself, whether or not it did on this pull.
	 *
	 * Written by the spec, not measured: the shared pass has no view on who brings what, and the set
	 * inverts almost completely between the two — a Monk brings all-stats and crit, an Elemental brings
	 * mastery, spell power and spell haste. Getting it wrong turns "the raid did not have this" into "you
	 * failed to press this", which is why it is declared rather than inferred.
	 */
	selfProvided: boolean;
	/** Stretches with no provider up, in time order, including one before the first application. */
	gaps: Array<{ at: number; seconds: number }>;
}

export interface RaidBuffSummary {
	rows: RaidBuffRow[];
	/** Player deaths in the pull. A corpse holds no buffs, so these explain gaps in every row. */
	deaths: number;
	notReported: number;
	/** Effects **this spec** supplies itself that were not up for the whole pull. */
	selfGaps: number;
}

/**
 * The half of an `Analysis` the engine's core produces: the shape every spec's log shares, computed
 * from the fight and the spec's `SpecConfig` alone. The other half — every figure that needs the
 * spec's own model in hand — is `SpecAuditResult`, and `Analysis` is the two intersected.
 */
export interface AnalysisCore {
	player: string;
	code: string;
	fightID: number;
	/** Report-relative fight start, used to build event links from fight-relative timestamps. */
	fightStartMs?: number;
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
	/**
	 * The bars the spec declared, each fully audited.
	 *
	 * One entry per key in the spec's `resources` config, so a pool and a points bar are both here
	 * and the generic resource section renders whichever half the `kind` names. Optional because a
	 * report captured before the engine sampled resources carries none, and because a log that
	 * answers without them is a real case rather than an error — the analysis above still stands, it
	 * simply cannot draw the bar. Anything reading it has to guard on truthiness.
	 */
	resources?: Record<string, ResourceBarAudit>;
	/**
	 * The enemy every primary-scoped number in the report is about.
	 *
	 * `name` is what the copy needs and the report's actor list is the only thing that can supply it:
	 * "the boss" is enough on a pull with one, and says nothing on the Kor'kron Dark Shaman, where the
	 * primary is whichever of the two this player spent the pull on. Null when the list cannot answer —
	 * naming the wrong enemy is worse than naming none — and `undefined` on the committed fixtures,
	 * which are `analyse()` output captured before the field existed.
	 */
	primaryTarget: { id: number | undefined; gameID: number | null; name?: string | null };
	damage: {
		wclTotal: number | null;
		eventTotal: number;
		dps: number;
		abilities: AbilityDamage[];
	};
	cpm: CpmSummary;
	casts: CastRow[];
	/**
	 * The player's own deaths — the core's half of the timeline.
	 *
	 * The presses are the spec's half of the picture: the audit decorates them (Storm, Earth and Fire
	 * carries the enemy it sent a spirit to) and returns them as `SpecAuditResult.timeline`; the two
	 * merge back into a `CastTimeline` in `analyseCore`. Optional here because a merged `CastTimeline`
	 * may carry no deaths — the field is optional there, so it must be optional in both halves for the
	 * intersection to stay assignable.
	 *
	 * The whole field is optional for the same reason `energizing` below is: the committed fixtures are
	 * `analyse()` output captured before this existed and are cast to `Analysis` rather than migrated,
	 * so on a fixture it arrives as `undefined` — not `null`, not an empty timeline. `analyse()` always
	 * fills it in; anything reading it has to guard on truthiness.
	 */
	timeline?: {
		deaths?: DeathMark[];
		/**
		 * When the player was in contact with *any* enemy — the clock the timeline shades intermissions
		 * against. Optional for the reason `deaths` is, and read for truthiness: a fixture captured
		 * before this existed arrives without it, and the chart falls back to the spec's own segments.
		 */
		contactSegments?: Array<[number, number]>;
		/**
		 * Casts that were started and never finished — a `begincast` with no `cast` after it. Drawn as a
		 * red bar at the moment the cast began, at the length the cast would have needed, so the reader
		 * sees the global a cancelled cast threw away. The player's own actions, so the core computes them
		 * alongside the marks rather than the spec's audit.
		 */
		cancels?: CastMark[];
		/**
		 * The raid's haste cooldown — Bloodlust, Heroism, Time Warp, Primal Rage or Drums of Rage —
		 * whichever class brought it, with each window named for the spell that opened it. Detected by
		 * the core so every spec shades it without writing its own audit.
		 */
		hasteWindows?: AuraWindow[];
		/** The Troll racial's 10s haste burst, detected alongside `hasteWindows` for the same reason. */
		berserkingWindows?: AuraWindow[];
		/**
		 * The encounter's phase transitions, carried through from the fetched dataset unchanged.
		 *
		 * Here rather than re-derived because there is nothing to derive: WarcraftLogs states them and the
		 * audit has no view of its own to add. Optional twice over — the committed fixtures predate the
		 * fetch, and WarcraftLogs itself returns none for 6 of the 14 Siege encounters. See `FightDataset`
		 * for the two traps in the shape.
		 */
		phases?: FightPhase[];
	};
	lostCasts: LostCastRow[];
	/**
	 * How many enemies were being damaged, moment by moment.
	 *
	 * Optional for the reason every field below it is: the committed fixtures are captured `analyse()`
	 * output from before this existed and are cast to `Analysis` rather than migrated, so on a fixture
	 * it arrives as `undefined` — not `null`, not an empty summary. `analyse()` always fills it in, and
	 * fills it in with an empty series on a pull with no damage at all. Anything reading it has to
	 * guard on truthiness.
	 */
	targets?: TargetSummary;
	/**
	 * What the player was wearing. Empty when the log carried no `combatantinfo` for them, which the
	 * UI has to treat as "not reported" rather than as "nothing equipped".
	 */
	gear: GearSummary;
	/**
	 * The raid buffs that move this spec's damage, one row per effect.
	 *
	 * Optional for the same reason every field above it is: the committed fixtures are captured
	 * `analyse()` output from before this field existed and are cast to `Analysis` rather than
	 * migrated, so on a fixture it arrives as `undefined` — not `null`, not an empty summary.
	 * `analyse()` always fills it in. Anything reading it has to guard on truthiness.
	 */
	raidBuffs?: RaidBuffSummary;
	/**
	 * Which of the pull's two potion slots were filled.
	 *
	 * Optional for the same reason every field above it is: the committed fixtures are captured
	 * `analyse()` output from before this field existed and are cast to `Analysis` rather than
	 * migrated, so on a fixture it arrives as `undefined` — not `null`, not an audit reading zero,
	 * which is the one thing it must never be mistaken for. `analyse()` always fills it in. Anything
	 * reading it has to guard on truthiness.
	 */
	potions?: PotionAudit;
}

/**
 * The half of an `Analysis` the spec's own audit produces: every figure a log can only answer with
 * the spec's model in hand — its cooldowns, its auras, its priority list. Computed by the spec's
 * `audit` hook, which sees the engine's `Handles` and nothing else, and merged over `AnalysisCore`
 * by `analyseCore`.
 */
export interface SpecAuditResult {
	brew: BrewSummary;
	procs: ProcSummary;
	debuff: DebuffSummary;
	/**
	 * Optional for the same reason every audit below it is: a report captured before this existed
	 * carries `undefined` here, not a `null` and not an audit reading zero — and zero is the one thing
	 * it must never be mistaken for, since "no kick was ever starved" and "nobody looked" are opposite
	 * facts about the same button. `analyse()` always fills it in. Anything reading it has to guard.
	 */
	blackoutKick?: BlackoutKickAudit;
	channel: ChannelAudit;
	/** Optional against a stored analysis, per `energizing` below; `analyse()` always fills it in. */
	chiBrew?: ChiBrewAudit;
	/**
	 * Optional against a *stored* analysis: captured output is read back as `JSON.parse(...) as
	 * Analysis` — a cast, not a check — so a field added after the capture arrives `undefined`, not
	 * `null` and not an empty audit. `analyse()` always fills it in, so anything reading it has to
	 * guard on truthiness.
	 *
	 * **No committed fixture is that case for this field, and the directory this used to cite is
	 * gone.** The captured Windwalker analyses live in `~/specs/windwalker/__fixtures__` — six of them,
	 * and all six carry a populated `energizing` — while the Elemental has no captured `Analysis` at
	 * all, only raw `FightDataset`s that `analyse()` runs over. So the reason is a guard against stored
	 * output in general rather than a case any fixture exercises.
	 *
	 * That the guard is worth keeping is one field away, not hypothetical: those same six analyses have
	 * no `timeline.hasteWindows` key *at all*, because that field postdates their capture, and
	 * `windwalker/components/charts/__tests__/castTimeline.test.ts` patches it in to render the band.
	 */
	energizing?: EnergizingBrewAudit;
	filler: FillerAudit;
	karma: KarmaAudit;
	/**
	 * Optional for the same reason `energizing` above it is, and with the same caveat: `analyse()`
	 * always produces it, a stored analysis read back as `JSON.parse(...) as Analysis` can be missing
	 * it, and **no committed fixture actually is** — all six captures in
	 * `~/specs/windwalker/__fixtures__` carry a `xuen`, and the Elemental stores no `Analysis` to be
	 * missing one. Marking it optional is what forces the renderer to guard instead of reading through
	 * a field TypeScript would otherwise promise was there.
	 */
	xuen?: XuenAudit;
	/**
	 * Optional for the same reason `xuen` above it is: a stored analysis captured before this field
	 * existed and cast to `Analysis` rather than migrated arrives `undefined` here — not `null`, and
	 * not an audit full of zeroes. No committed fixture is that case either. `analyse()` always fills
	 * it in. Anything reading it has to guard on truthiness.
	 */
	sef?: SefAudit;
	comboBreaker: Array<{
		id: number;
		label: string;
		procs: number;
		wasted: number;
	}>;
	/**
	 * The priority list run against the pull, press by press.
	 *
	 * Three states, all distinct and none collapsible into the others. `undefined` is an analysis
	 * captured before the ladder existed. `null` is the ladder having nothing to walk — a log fetched
	 * without resources, so there is no bar to reconstruct. An audit is an answer. Reading any of the
	 * three as either of the others would either invent a verdict or hide one.
	 *
	 * `null` no longer means "add fight". The ladder bands on the live target count and judges a wave
	 * pull against what the list wanted during the waves.
	 */
	apl?: AplAudit | null;
	/**
	 * The same walk, forced to one target count, keyed by band.
	 *
	 * Precomputed because the walk's inputs — the reconstructed chi bar, the aura windows, the cast
	 * marks — are not on `Analysis` and reconstructing them in the browser to answer a toggle would
	 * mean shipping the engine to the client. Four extra walks cost 0.6ms on the longest pull, which is
	 * cheaper than the plumbing to defer them.
	 *
	 * This is what makes the reader's override real rather than decorative: it answers the one question
	 * no count taken off the log can, which is whether ignoring the adds was a decision.
	 */
	aplForced?: Partial<Record<Band, AplAudit | null>>;
	misses: Miss[];
	/**
	 * The spec's contribution to `cpm`: the globals its own audit found spent on a press that bought
	 * nothing, and the seconds its channels really occupied. `analyseCore` merges these into the
	 * summary it computes, so the two halves of the figure cannot disagree about the pull.
	 */
	cpm: Pick<CpmSummary, 'wastedGcds' | 'channelSec'>;
	/**
	 * The spec's half of the timeline: every press on one clock, decorated — Storm, Earth and Fire
	 * carries the enemy it sent a spirit to — and the auras that were up underneath them. Merged with
	 * the core's `deaths` into a `CastTimeline`.
	 *
	 * The casts live here rather than in `AnalysisCore` because the decoration is the audit's work:
	 * only the spec's own audit can say which press sent a spirit to which enemy, and the core's marks
	 * are the undecorated input to that.
	 *
	 * `hiddenTargets` and `hiddenLanes` are optional for the same reason they are on `CastTimeline`:
	 * a merged timeline may be the chart's full set with nothing capped. The whole field is optional
	 * because an analysis captured before the timeline existed arrives without it.
	 */
	timeline?: {
		casts: CastMark[];
		lanes: AuraLane[];
		hiddenTargets?: number;
		hiddenLanes?: AuraLane[];
	};
}

/** The full analysis of one fight — what the renderer consumes. */
export type Analysis = AnalysisCore & SpecAuditResult;

// ---------------------------------------------------------------- Elemental

/**
 * The Elemental audit's own shape, alongside `SpecAuditResult` rather than inside it.
 *
 * `SpecAuditResult` is the Windwalker's shape — brew, chi, energy, karma — and nothing in it could
 * hold a Flame Shock audit without lying about the pull. The engine's merge is typed `Analysis`
 * either way (`analyseCore` casts the spread), so the Elemental module returns this shape, casts it
 * at the `SpecConfig` boundary, and the Elemental sections cast it back: the same bounded, stated
 * cast the Windwalker views already make for their rule keys.
 */

/** One Flame Shock press on the primary target: an apply or a refresh. */
/**
 * What a Flame Shock press *was*, where "the dot was down" is three different things.
 *
 * `remainingMs === null` used to carry all three, and the section rendered every one of them as "Late
 * Refresh" — an accusation, and one that also banded the row as a fault. On a pull with one apply, six
 * clean refreshes and 100% uptime, the opener was told it refreshed late.
 *
 * The Windwalker's Tiger Palm audit had already made this distinction and written down why ("putting the
 * buff up is not refreshing it… both read zero remaining"); the Elemental was written from it and
 * collapsed the states again.
 *
 *   - `apply`     the dot had never been up on this spawn. The opener. Not a decision about timing.
 *   - `reapply`   it had lapsed, but not on the player's watch — the target was away, or the gap was
 *                 under `DROP_MS` and is refresh jitter. Not a fault.
 *   - `late`      it had lapsed with the player in contact for longer than the jitter floor. A fault.
 *   - `windowed`  refreshed with at most one tick still owed, so the pending tick rolled over and
 *                 nothing was thrown away.
 *   - `ascPrep`   refreshed early on purpose, for the sim's Ascendance prep rule.
 *   - `snapshot`  refreshed early on purpose, because the new application snapshots a stronger dot.
 *   - `early`     refreshed with more left than any of those rules wants. A fault.
 *
 * `windowed` used to mean "inside the reader's own `flameShockRefreshMs`", a fixed millisecond window
 * the reader owned. It now means what that number was standing in for: **at most one tick still owed**,
 * so a tick was pending and reapplying rolled it over. Both halves of that are read off the dot's own
 * ticks per press rather than declared — see `lib/analysis/ticks.ts` — because a dot in this expansion
 * is hasted on its ticks and not on its duration, so a pull has no one number and no application runs
 * for the 30s it declares. It is a **count** and not a remaining time: `remainingMs` is against the
 * declared duration, which over-states a fresh application by the half-tick bankers rounding drops and
 * under-states a refreshed one by the pending tick it kept, and both errors flip a fixture verdict.
 */
export type FlameShockPressKind = 'apply' | 'reapply' | 'late' | 'windowed' | 'ascPrep' | 'snapshot' | 'early';

export interface FlameShockPress {
	/** When the press landed. */
	t: number;
	/** Which of the seven the press was — see `FlameShockPressKind`. */
	kind: FlameShockPressKind;
	/**
	 * The dot's remaining time at the press against its **declared** duration; null when the dot was
	 * down and this press applied one.
	 *
	 * **It therefore runs long, and it is not what grades the press.** A dot in this expansion is hasted
	 * on its ticks and not on its duration, so the game schedules `RoundToEven(duration / period)` whole
	 * ticks and the application ends with the last of them (`sim/core/dot.go:122-146`) — 29 410ms at a
	 * 1 730ms period, not 30 000ms. A refresh onto a live dot keeps its pending tick on top of that,
	 * which can push the real end the other way, *past* the declared one.
	 *
	 * Published because it is the figure the section's table and the chart's tooltip show and the one a
	 * reader recognises. Graded on `ticksLeft`, which is counted rather than subtracted.
	 */
	remainingMs: number | null;
	/**
	 * How long the dot had been down *while the player was in contact*, for the three down-states.
	 *
	 * Null on a refresh, where nothing was down. Zero on an `apply` — there was no previous window to be
	 * absent from — and that is why it cannot be inferred from `remainingMs` alone.
	 */
	exposedMs: number | null;
	/**
	 * The last tick window this press was judged against, in ms: the dot's tick cadence measured off the
	 * log just before it, or the unhasted period when the log carried too few ticks to measure one.
	 *
	 * On the record per press rather than once per pull, because it genuinely differs press to press —
	 * `phased` grades its refreshes against 1 349ms, 1 748ms and 2 275ms as the raid's haste cooldowns
	 * fall off. `FlameShockAudit.tickMs` is the median of these, for a chart that can only draw one
	 * band.
	 */
	tickMs: number;
	/**
	 * How many ticks the dot this press replaced still owed: `RoundToEven(30 000 / period)` for the
	 * application being refreshed — plus the pending tick it kept if it began as a refresh itself —
	 * minus the ticks it had actually landed.
	 *
	 * **The number `windowed` is decided on**, which is why it is published: one owed is the pending tick
	 * that rolls over and nothing thrown away, two owed is a tick clipped. Counted rather than projected
	 * off `remainingMs`, because that figure is half a tick out in either direction — see its own doc
	 * and `dotTickBudgetIn` in `lib/analysis/ticks`.
	 *
	 * Null when the log cannot count: the application landed fewer than three ticks before the press, so
	 * it has no measurable period. Those presses fall back to comparing `remainingMs` against `tickMs`,
	 * and on the committed fixtures they are only the openers, whose dot was down anyway.
	 */
	ticksLeft: number | null;
	/**
	 * How far **into** the dot's own last tick the press landed, in ms — negative when it landed before
	 * that tick was due, and by how much.
	 *
	 * The same fact as `ticksLeft <= 1` expressed as a length, and it exists because the verdict has to
	 * be *drawable*. A chart's x-axis is elapsed time, and elapsed time at a press can only be measured
	 * against the declared duration, so a band at the right-hand end of a 30s axis is systematically
	 * later than any real last tick: measured against two credited presses on a live log it sat 69ms and
	 * 343ms past them, and both bars stopped short of a band they belonged inside. With this the last
	 * tick is drawn per press, as the tail of the bar itself, and the drawing cannot disagree with the
	 * grade.
	 *
	 * Null exactly when `ticksLeft` is: the application landed too few ticks to measure a period.
	 */
	intoLastTickMs: number | null;
	/** Whether the press landed on the dot's last tick, which is what rolls the pending tick over. */
	windowed: boolean;
	/** Whether the press was the sim's Ascendance prep (rule 12): dot under 16s with Ascendance ready inside 2s. */
	ascPrep: boolean;
	/**
	 * How much stronger the dot this press applied is than the one it replaced, as a ratio: `0.104` is a
	 * new application worth 10.4% more. Negative when the press snapshotted a weaker dot.
	 *
	 * The sim's `Flame Shock Rules` value variable refreshes early when `dotPercentIncrease(8050) > 10%`
	 * (`ui/shaman/elemental/apls/p5.apl.json`), and that is what this measures — **damage per millisecond
	 * of dot**, cadence included, because Flame Shock snapshots its tick period as well as its damage. See
	 * `DotSnapshot.strength` in `lib/analysis/ticks` for the sim citations and for the two committed presses
	 * where reading tick damage instead of the combined form gives the opposite verdict.
	 *
	 * Read off `unmitigatedAmount`, which strips the crit roll and the target's damage-taken multipliers,
	 * so no stat model is involved and nothing has to be reconstructed.
	 *
	 * **Null means the log could not say**, per press and not per pull: the application this press created
	 * got fewer than three ticks before the fight ended, or there was no previous application to compare
	 * against (an `apply`). A null press keeps the classification it would have had with no snapshot reading
	 * at all — it is never credited on the strength of a measurement that was not taken.
	 *
	 * **Known looseness, stated rather than hidden.** The sim's rule is a conjunction: a talent, a
	 * ten-stack Intellect proc, a second trigger proc, *and* the >10% delta. Only the delta is checked
	 * here, because no committed fixture's shaman wore any of the six items involved — `snapshots` reads
	 * `{ windows: 0, refreshed: 0, missed: 0 }` on all three — so requiring the proc window would credit
	 * nothing at all and the fix would be untestable. So a lucky press reads the same as a read one, which
	 * is the same looseness the `flameShockSnapshots` metric already lives with.
	 */
	snapshotDeltaPct: number | null;
	/**
	 * Whether the dot **this press applied** froze Clearcasting's +20% into itself.
	 *
	 * Elemental Focus (16246) is `SpellMod_DamageDone_Pct` +0.2 over `SpellSchoolElemental`, and the dot is
	 * a Fire spell inside that mask, so an application made under the proc carries the whole 20% for all
	 * thirty seconds — proven five ways out of the sim and then measured off these fixtures at 1.236 and
	 * 1.262 in `clearcasting.test.ts`.
	 *
	 * True at the closing millisecond of a window as well as inside it, and that is load-bearing rather
	 * than tidy: Flame Shock spends a stack, `applyEffects` runs before `OnCastComplete`
	 * (`sim/core/cast.go:329-332`), and the log stamps the resulting `removebuff` in the same millisecond
	 * as the cast — three of the committed fixtures' presses are exactly that case.
	 *
	 * **Not a grade and not gradeable.** No `ui/shaman/elemental/apls/*.apl.json` mentions the proc, so
	 * nothing here says a press should or should not have been made under it. It is published so the
	 * section can say *which term* made a dot stronger — see below.
	 */
	snapshotClearcasting: boolean;
	/**
	 * `snapshotDeltaPct` with Clearcasting's +20% divided back out of whichever of the two applications
	 * froze it — how much stronger the new dot is on everything **except** the proc.
	 *
	 * Plan §87, and the fault it fixes is in a number the report already showed. `snapshotDeltaPct` is the
	 * sim's own total and stays what the press is graded on; but the proc is +20% against a threshold of
	 * ten and is up for 52-72% of these pulls, so on its own it clears the bar — and the section's copy
	 * named a trinket's spellpower as the reason. Two of the three credited presses in the fixtures were
	 * made under it. This field is what lets the sentence name the term that actually did the work instead
	 * of implying one that did not.
	 *
	 * **Strictly equal to `snapshotDeltaPct`, not merely close, when the proc is not a term** — both
	 * applications froze it, or neither did. A reader decides whether to name the proc by whether the two
	 * differ, so the equality is exact by construction and asserted.
	 *
	 * Null exactly when `snapshotDeltaPct` is null, for the same reasons and never for others.
	 *
	 * It is an attribution and **not a second threshold**. Netting the proc out of the grade would put this
	 * report at odds with the list it grades against, whose own `dotPercentIncrease` numerator has the proc
	 * in it; and on the committed fixtures it would change no press either way. See `FS_SNAPSHOT_GAIN`.
	 */
	snapshotDeltaWithoutClearcastingPct: number | null;
	/** Whether Ascendance was up under the press — a refresh thrown away while Lava Burst wanted the global. */
	duringAscendance: boolean;
}

export interface FlameShockAudit {
	/** The dot's up-windows on the primary target, one per application, refresh-open. */
	windows: Window[];
	/**
	 * The dot's whole life on the **primary target**, unclipped — the union of `windows`.
	 *
	 * **It is not the numerator of `uptimePct`, and the two were documented as one figure for as long
	 * as they were.** This is the drawn bar's own length: what the timeline lane shows and what the
	 * drop ledger reads, deliberately left whole so a stretch where the boss merely stopped being
	 * hittable does not put a seam in the dot. `contactUptimeMs` below is the graded numerator.
	 */
	uptimeMs: number;
	/**
	 * `contactUptimeMs / scoredMs`, as a percentage — the dot on **whichever spawn was being hit**,
	 * over the time the player was in contact with anything *and* a list asked for the dot at this bar.
	 *
	 * Neither half of it is `uptimeMs`. Both of its own halves are published beside it precisely so
	 * this can be checked rather than taken on trust, which is the whole of plan §29.
	 */
	uptimePct: number;
	/** Presses made while the dot was down — the count of fresh applies. */
	applies: number;
	/** Presses made while the dot was up. */
	refreshes: number;
	/** Refreshes that landed in the dot's last tick window. */
	windowed: number;
	/** Refreshes that were the sim's Ascendance prep — never "wasted". */
	ascPrep: number;
	/**
	 * Refreshes that were early on purpose, because the new application snapshotted a dot more than 10%
	 * stronger per millisecond — the sim's own `dotPercentIncrease(8050) > 10%`. Never "wasted" either.
	 *
	 * Counted only where `windowed` and `ascPrep` do not already excuse the press, so the three excuses
	 * partition the refreshes rather than overlapping: a last-tick refresh needs no snapshot justification
	 * and must not be credited twice. See `FlameShockPress.snapshotDeltaPct`.
	 */
	snapshotGain: number;
	/**
	 * The pull's typical tick period: the median of the per-press `tickMs`, since a pull whose haste
	 * moved has no single one — on one committed pull the period ran at three plateaus, ~1 348, ~1 752
	 * and ~2 281 ms, as Bloodlust and Elemental Mastery fell off one after the other.
	 *
	 * **It has no reader left, and that is stated rather than hidden.** It existed for the depth chart's
	 * single shaded band, and that band is gone: anchored to the declared 30s duration it sat later than
	 * any real last tick, so it contradicted the verdicts drawn against it (see
	 * `FlameShockPress.intoLastTickMs`). Each press is judged and now drawn against **its own** cadence.
	 * Left published because §66's brief was explicit that this field stay, and because deleting a
	 * pull-level figure is the plan owner's call and not a side effect of fixing a chart — but nothing
	 * reads it today.
	 */
	tickMs: number;
	/** The dot's full duration, so the chart can scale its bars against it. */
	durationMs: number;
	/** Every press with the dot state at it, for the section's table. */
	presses: FlameShockPress[];
	/**
	 * The cleave preset's multi-dot rule ("keep Flame Shock on both targets"): the dot's uptime on the
	 * secondary target over the stretches **two** enemies were up. Zero on a pull that never went
	 * multi-target, and clipped to the same array `multiTargetMs` is the length of.
	 */
	multiDotUptimeMs: number;
	multiDotUptimePct: number;
	/**
	 * The denominator `multiDotUptimePct` is against, and **also the graded length the score refuses an
	 * empty one on**: the time two enemies were up — not two *or more* — and **zero when none of the other
	 * enemies deserved a second dot**, an immune unit never being a target and one that died before the dot
	 * could pay for its global not being a target for a dot.
	 *
	 * Read as the gate on whether this question can be asked at all; `score.ts` passes it through
	 * `gradedOver` so a zero from either cause grades nothing, and the section hides the tile. That is how
	 * a pull whose only other enemy was an immune mine, and a pull that spent every one of its two-target
	 * seconds inside an add wave, are both left unjudged rather than handed a 0% neither could have beaten.
	 *
	 * **Band 2 alone, which makes this the one clock in the audit cut at both ends.** `cleave.apl.json`
	 * rung 9 is `maxDots: 2`: there is no such rule at one enemy, because there is no second target, and
	 * none at three, because `aoe.apl.json` has no multi-dot rung anywhere in it. So the floor is the
	 * core's `>= 2` series and the ceiling is the same `aoeWindows` complement the dot's uptime clock, the
	 * totem's and the shield's overcap all take — `>= 2` less `>= 3`. The other three are band-1-or-2 rules
	 * and need the ceiling only. The derivation, and why it is a difference of two count series rather than
	 * an "exactly two" series computed once, is at `mdGraded` in the Elemental's `index.ts`.
	 *
	 * It is deliberately *not* the core's `targets.multiTargetMs`, which it used to be verbatim. That field
	 * is the mode share's own numerator and is untrimmed by design ("evidence and a denominator, not
	 * exemptions"); borrowing it made this rule's clock run through bands 3 and 4, which are counts the
	 * rule does not exist at.
	 */
	multiTargetMs: number;
	/**
	 * What `uptimePct` is a share of: the contact clock **less every stretch three or more enemies were
	 * up** — the seconds the player was on an enemy they could damage under a list this figure's bar was
	 * written from.
	 *
	 * **The band cut, and why the dot's clock carries one at all**, since `aoe.apl.json` plainly does want
	 * the dot up: rung 1 casts it whenever it is down. What that list has no rung for is the thing the
	 * 95%/85% bar is *derived* from — it carries no Lava Burst at all, so the cascade the threshold rests
	 * on, a dropped dot costing far more than the global that would have replaced it, does not exist above
	 * two enemies. A 95% clock is not "put it back up once, below the beam" stated in percent. Band 2
	 * keeps the bar, because `cleave.apl.json` rung 9 is a Flame Shock rule and Lava Burst is in that
	 * list twice. The whole argument is at `flameShockUptime` in the Elemental's `score.ts`.
	 *
	 * **`contactUptimeMs` is cut by the identical array**, not by a second reading of it — each spawn's dot
	 * is clipped to this clock before the walk sums it, so the numerator is inside the denominator by
	 * construction. Two halves of one ratio measured over two different spans is how this very field once
	 * produced 100.21%, and clipping one half of a band cut and not the other is that defect with a new
	 * cause.
	 *
	 * **Also the graded length the score refuses an empty one on.** A pull spent wholly at three or more
	 * enemies arrives here at zero, and `gradedOver` makes that "cannot say" instead of a dot clock nobody
	 * measured reading as one nobody dropped.
	 *
	 * It was the engaged clock, scoped to the primary target. That is a different question, and dividing a
	 * dot measured across every spawn by a denominator scoped to one of them is the mismatched-halves
	 * defect this field exists to make checkable.
	 *
	 * Published for the reason `searingTotem.scoredMs` is. Without it a reader can see `uptimeMs` and
	 * `uptimePct` and derive neither from the other, so they cannot tell a dropped dot from a boss that
	 * was untargetable — the distinction the chart above spends a whole exempt band making, still
	 * unanswerable from the data. It is also the only way to assert that the ratio is a ratio, which is
	 * what let the numerator and denominator be measured over different spans for as long as they were.
	 */
	scoredMs: number;
	/**
	 * `uptimePct`'s **numerator**: the dot's up-time on the spawn the player was actually hitting,
	 * clipped to the same graded clock `scoredMs` is the length of.
	 *
	 * Published because `scoredMs` alone did not close §29. With the denominator visible and the
	 * numerator invisible, `uptimeMs / scoredMs` still did not come to `uptimePct / 100` — `uptimeMs`
	 * is the primary target's whole dot and this is a different span, per spawn and clipped — so the
	 * section's own complaint, that a reader cannot derive either of the two named fields from the
	 * other, stayed true of exactly the pair it named. These two are the ratio, and nothing else is.
	 *
	 * The gap between this and `uptimeMs` is not slack to be reconciled: it is dot time on an enemy the
	 * player was not hitting, plus dot time outside contact altogether. Measured: 9 309 ms on `phased`,
	 * 1 071 on `unbroken`, 45 896 on `cleave` — the third one is 17% of the pull, which is the size of
	 * the mistake a reader was invited to make.
	 *
	 * `unbroken`'s 100% is a real 100 and not `uptimePct`'s clamp: this and `scoredMs` come to the same
	 * 181 775 ms exactly. Worth stating, because a clamped reading would have made the ratio unprovable
	 * on the one fixture where the dot never dropped.
	 */
	contactUptimeMs: number;
}

/** Why an Earth Shock failed the sim's rule, in the order the section reads them. */
/**
 * Why the list did not want an Earth Shock press.
 *
 * `Earth Shock Rules` is an **or of two branches** and the tier-16 two-piece proc picks which one
 * applies, so these do not all coexist on one press. With the proc down the branch asks for the shield
 * at the ceiling, the dot above six seconds and Ascendance six seconds away (`belowFull`, `fsLow`,
 * `ascReady`); with it up the branch asks for the shield at the ceiling, the proc's debuff inside its
 * last four seconds and the dot outliving two ticks (`belowFull`, `twoPiece`, `fsTail`).
 *
 *   - `belowFull`  the shield was under its ceiling, so Fulmination was spent early. Either branch.
 *   - `fsLow`      the dot had under six seconds, with no proc up. The proc-down branch only.
 *   - `ascReady`   Ascendance was within six seconds of the shared shock timer. The proc-down branch only.
 *   - `twoPiece`   a proc was up with **more than four seconds** left on its debuff, so the list wanted
 *                  the shock held for its tail. The proc-up branch only.
 *   - `fsTail`     a proc was up and the dot would not have outlived two of its own ticks. The proc-up
 *                  branch's dot floor, which is two measured tick periods and not `fsLow`'s six seconds.
 *
 * **And at two targets none of those five apply, because it is a different list.**
 * `ui/shaman/elemental/apls/cleave.apl.json` rung 13 asks for `auraNumStacks(324) >= 6` and
 * `dotRemainingTime(8050) >= 8s` and nothing else — no Ascendance hold, no two-piece term, and no
 * branch for the set to pick. So the Cleave regime has its own two reasons rather than looser
 * versions of the five above, because a reader told "below 7 stacks" about a press the list wanted at
 * six has been told the opposite of the truth:
 *
 *   - `cleaveStacks` the shield was under **six**, which is the count the two-target list spends at.
 *   - `cleaveDot`    the dot had under **eight** seconds, which is that list's own floor and higher
 *                    than the single-target one, not lower.
 */
export type EarthShockReason =
	| 'belowFull'
	| 'fsLow'
	| 'ascReady'
	| 'twoPiece'
	| 'fsTail'
	| 'cleaveStacks'
	| 'cleaveDot';

/** One Earth Shock press, with everything the sim's rule reads, at the press. */
export interface EarthShockPress {
	t: number;
	/** Lightning Shield's stacks at the press; null when the log never carried the aura. */
	lsStacks: number | null;
	/** The dot's remaining time at the press, in ms. */
	fsRemainingMs: number;
	/** Seconds until Ascendance is back at the press. */
	ascReadyInSec: number;
	/** Whether the tier-16 two-piece proc was up under the press. */
	twoPiece: boolean;
	/**
	 * How many enemies the player was damaging at this press, banded the way the sim's lists band.
	 *
	 * **Per press, never per pull**, and that is the whole reason it is a field on the press rather than
	 * one number on the audit. `cleave` runs from one enemy to thirteen inside a single pull, so a
	 * whole-pull verdict would judge four of its twelve shocks against a list that was not in play.
	 * Which list a press is judged against is decided from here: band 1 is `p5.apl.json`, band 2 is
	 * `cleave.apl.json`.
	 */
	band: Band;
	/**
	 * Whether the applicable branch of the sim's rule wanted the press — see `EarthShockReason` for all
	 * of them.
	 *
	 * A press inside a two-piece window is **not** automatically bad: the proc's own branch asks for the
	 * shock in the debuff's last four seconds, which is the one thing this used to fault outright.
	 *
	 * **Null at bands 3 and 4, meaning no list had anything to say about the press.** `aoe.apl.json` has
	 * five rungs and Earth Shock is not one of them, so at three or more enemies there is no rule for a
	 * shock to be good or bad against; a null press is left out of `EarthShockAudit.judged` and therefore
	 * out of `earthShockGood` rather than counted as either. Read it as "cannot say", never as "fine":
	 * `press.good === false` is the fault ledger's test and `!press.good` is not.
	 */
	good: boolean | null;
	/** Which conditions of the applicable branch failed, in the order the section reads them; empty when good. */
	reasons: EarthShockReason[];
}

export interface EarthShockAudit {
	presses: EarthShockPress[];
	good: number;
	/**
	 * How many presses a list had a rule for — the denominator `earthShockGood` is taken over, and not
	 * `presses.length`.
	 *
	 * The two differ by the band-3 and band-4 presses, which no list judges (see `EarthShockPress.good`).
	 * Published rather than recomputed at each reader because the section's tile, its verdict sentence, the
	 * summary tile and the scorecard all have to be over the same set or the report contradicts itself.
	 */
	judged: number;
	/** Shocks spent below the ceiling — the whole Fulmination the player left on the table. */
	belowFull: number;
}

export interface SearingTotemAudit {
	/**
	 * The totem's up-windows, cut short wherever the Fire Elemental took the slot.
	 *
	 * One Fire totem stands at a time — the sim's own summons disable each other — so these never
	 * overlap `feWindows`, and a window is a placement's minute only if nothing displaced it.
	 */
	windows: Window[];
	/** How much of `scoredMs` the totem was up for. */
	uptimeMs: number;
	/**
	 * The clock `uptimePct` is taken against: contact time, less every Fire Elemental window, less every
	 * stretch three or more enemies were up.
	 *
	 * Three exempt causes composed into one array, and none of them is a totem the player could have had
	 * up. The elemental owns the slot while it is out. An intermission is not time the player was in the
	 * fight. And from three enemies the running list has no fire-totem rung at all — neither Searing
	 * Totem nor Magma Totem appears in `aoe.apl.json` — so the empty slot was not a press anything asked
	 * for; the ladder bands its own `searing-totem` rung `[1, 2]` off that same reading. Two enemies stay
	 * in the clock, because `cleave.apl.json` keeps the totem and ranks it above four other rungs.
	 *
	 * **Also the graded length the score refuses an empty one on.** A pull spent wholly above two enemies
	 * arrives here at zero, and `gradedOver` turns that into "cannot say" rather than into a totem clock
	 * the player kept perfectly.
	 */
	scoredMs: number;
	uptimePct: number;
	/** The stretches the Fire Elemental held the slot, so the graph can exclude the same time. */
	feWindows: Window[];
	/** Every placement, with the totem it overwrote and the two faults a placement can carry. */
	presses: SearingTotemPress[];
	/** Re-presses that clipped a healthy totem — more than the leeway left on it. */
	clipped: number;
	/** The dot-time those clips threw away. */
	wastedMs: number;
	/** Placements made while the Fire Elemental was out, which the list forbids. */
	feOverlaps: number;
	/** Placements made with less than ten seconds of fight left. */
	latePlacements: number;
}

/** One Searing Totem placement and the faults it can carry. */
export interface SearingTotemPress {
	t: number;
	/** Time left on the totem this press overwrote; null when none was up. */
	remainingMs: number | null;
	/** Whether the press clipped a healthy totem — more than the leeway left on it. */
	clipped: boolean;
	/** Whether the Fire Elemental was out when this was placed. */
	feOverlap: boolean;
	/** Whether this was placed with less than ten seconds of fight left. */
	late: boolean;
}

/** A stretch the sim's Flame Shock rule (priority 7) would have claimed a refresh. */
export interface ElementalSnapshotWindow {
	start: number;
	end: number;
	/** Which of the three triggers opened it: the UVLS buff, the UVLS counter, or Black Blood of Y'Shaarj. */
	source: 'unerring-vision' | 'uvls-stacks' | 'black-blood';
}

export interface SnapshotsAudit {
	windows: ElementalSnapshotWindow[];
	/** Flame Shock refreshes that landed inside a window. */
	refreshed: number;
	/** Windows the dot was up through with no refresh inside. */
	missed: number;
}

/** One Ascendance press and the dot it found, for the cooldowns section. */
/**
 * Which single demand a faulted Ascendance press failed, for the table's verdict column.
 *
 * **Not a second grade.** `sync.grade` decides whether a press was bad; this only ever names why, and
 * is null on every press that was not. It exists because `grade: 'bad'` is the `and` of two or three
 * conditions and each has a different thing for a reader to do about it — the decomposition, and the
 * argument for reading rule 2 off the published shape rather than re-deriving it, are on
 * `ascendanceFault` in `specs/elemental/lib/index.ts`.
 *
 * Declared here beside `AscendancePress` rather than in `specs/elemental/lib/ascendance.ts`, which owns
 * the grade itself: that module is a pure function over the rules and says nothing about how a report
 * draws them, and this is a presentation split of its answer.
 */
export type AscendanceFault =
	/** Rule 1 (§80.1). Outside the opener entirely — the one press the list treats as mandatory. */
	| 'opener-late'
	/** Rule 2 (§80.2). The fifteen seconds ran past the kill, on a press that could have come sooner. */
	| 'window-past-the-kill'
	/** Entry 14. In the opener, but too long after the haste cooldown opened to be spent into it. */
	| 'late-into-haste'
	/** Entry 15. Pressed with less Elemental Discharge left than the sync demands. */
	| 'discharge-too-short'
	/** Rule 3. The window held less Skull Banner than the rule's own floor, with pull enough to hold it. */
	| 'no-banner';

export interface AscendancePress {
	t: number;
	/**
	 * Which demand this press failed, or null when it failed none — including on a press that could not
	 * be judged at all, where `sync.reason` is the field with something to say.
	 */
	fault: AscendanceFault | null;
	/** The dot's remaining time at the press; null when the dot was down. */
	fsRemainingMs: number | null;
	/**
	 * Whether the press was the opener rule — within `OPENER_MS + OPENER_GRACE_MS` of the pull, i.e. 5 250 ms.
	 *
	 * Not a flat five seconds: a real press landed at 5 006 ms and read as not-the-opener by six
	 * milliseconds, which is measuring the log's clock rather than the play. The grace is stated separately
	 * from the bound so the bound stays the number the priority list actually names.
	 */
	opener: boolean;
	/** Whether the press was the two-piece rule (the debuff on the target with 10s+ left). */
	twoPiece: boolean;
	/**
	 * How this press read against the one rule that governs it — the sim's priority 14 for the opener,
	 * priority 15 for every later press. See `specs/elemental/lib/ascendance.ts` for both rules and the
	 * refusals, which is also where the shape is declared, for the reason `AplAudit` is imported rather
	 * than restated at the top of this file.
	 *
	 * Carried **per press** rather than as a second array beside `presses`: the two would be one
	 * quantity in two shapes with nothing but an index tying them together. `sync.t` and `t` are the
	 * same number by construction — the audit builds its press rows off these verdicts.
	 */
	sync: AscendancePressVerdict;
}

export interface AscendanceAudit {
	presses: AscendancePress[];
	/**
	 * Whether Ascendance was already running when the bell went.
	 *
	 * Published for the same reason `fireElemental.prepull` is: it is the difference between a press
	 * the player did not make and a press made before the log starts, and without it a reader cannot
	 * tell why `grade` refused. It is also the input that makes the refusal possible — see
	 * `AscendanceSyncInput.ascendanceAtPull`, which explains what it can and cannot prove.
	 */
	atPull: boolean;
	/**
	 * The pull's Ascendance verdict: the worst grade any press earned.
	 *
	 * `none` is not a middle value and must not be read as one. It means not one press could be judged
	 * — no haste cooldown on the pull, no Elemental Discharge in evidence, the button already running
	 * at the bell, or nothing to hit — and a pull that pressed Ascendance zero times comes back `none`
	 * with an empty `presses`. The per-press `reason` says which.
	 */
	grade: AscendanceSyncVerdict['grade'];
}

/** One Elemental Mastery press and the branch of the list's rule it hit. */
export interface ElementalMasteryPress {
	t: number;
	/**
	 * The first branch this press satisfied, or null when none did — a press the rotation would not have
	 * made.
	 *
	 * **`off` used to be one name for two opposite situations**, and no honest sentence could be written
	 * for it: the arm is `!t15Active && (ascReady >= 85 || ascReady < 4)`, which covers Ascendance being a
	 * minute and a half away *and* Ascendance being about to come up. Both are fine and they are fine for
	 * opposite reasons — one because a ninety-second cooldown should not be held that long for a
	 * three-minute one, the other because Ascendance lands inside the haste anyway — so the copy for a
	 * single label had to be vague to stay true. The two conditions are disjoint, so splitting the name
	 * changes no press's classification; only what the report can say about it.
	 */
	reason: 'opener' | 'sync' | 't15' | 'off-near' | 'off-far' | null;
	/**
	 * How long until Ascendance was back, in seconds, at this press — 0 where it was already up.
	 *
	 * Published so the sentence can name the gap rather than gesture at it: "Ascendance {{n}}s away" is
	 * what makes the `off-far` arm's reasoning legible to a reader who cannot see the cooldown. Read off
	 * `ascendanceReadyInSec`, the same helper the branch above uses, so the number in the copy is the
	 * number the classification was made on and cannot disagree with it.
	 */
	ascReadySec: number;
}

/** One Fire Elemental press and the branch of the list's rule it hit. */
export interface FireElementalPress {
	/** Fight-relative, and **0 on an inferred use** — a pre-pull press's real instant is not in the log. */
	t: number;
	/**
	 * The first branch this press satisfied, or null when none did — a press the list would not have made.
	 *
	 * `'prepull'` is not one of those branches: it is the use the list opens with, and it is named rather
	 * than run through the others because the arithmetic would call it `'early'` on any pull longer than
	 * three minutes.
	 */
	reason: 'prepull' | 'near-end' | 'sync' | 'early' | null;
	/**
	 * Whether this use was recovered rather than read: `true` means no cast event, only a pre-pull window.
	 *
	 * Published because the tile that counts these rows has to count the inferred one — a pull that
	 * summoned before the bell used the cooldown — and a reader looking at the table then has to be able
	 * to see which row the log does not carry a press for. §57d's rule for drawn bars, on a counted row.
	 */
	inferred: boolean;
}

/**
 * What the list's own Earth Elemental rule says about one press — three-valued, and it has to be.
 *
 * `Earth Elemental Rules` in `ui/shaman/elemental/apls/p5.apl.json` is an **or of three** branches, and
 * a log can read them to three different depths:
 *
 * ```
 * A  remainingTime <= 62s
 * B  NOT auraIsActive(2894) AND remainingTime >= 5s AND spellTimeToReady(114049) <= 20s
 *    AND shamanFireElementalDuration == 60s AND spellTimeToReady(114206 Skull Banner) < 20s
 *    AND spellTimeToReady(2894) > 60s
 * C  shamanFireElementalDuration < 60s AND NOT auraIsActive(2894) AND spellTimeToReady(2894) < 65s
 * ```
 *
 *   - `'near-end'` — **branch A**, which is the only one a log can read all the way to *true*. The
 *     pull's own clock, and nothing else.
 *   - `'off-rule'` — every branch was **refuted** by something the log does say. A real fault.
 *   - `'unknown'` — A was false and at least one of B and C came down to a term this log cannot
 *     answer, so nothing can be said. `spellTimeToReady(114206 Skull Banner)` is **another player's
 *     cooldown**, which no combat log carries; `spellTimeToReady(2894)` needs the instant the Fire
 *     Elemental was pressed, which a pre-pull summon does not log, and the Primal Elementalist talent,
 *     which decides whether that clock is three minutes or five.
 *
 * `unknown` rather than a fault, deliberately: an unreadable rule silences the press instead of
 * guessing, the same three-valued discipline the priority-list engine documents at `lib/spec/apl.ts`.
 * A wrong "you misplayed here" costs a reader more than a missing one.
 *
 * **There is no verdict for a press branch B or C wanted**, and that is a statement about the log
 * rather than an omission. Neither branch can be read to *true*: B always ends at the Skull Banner
 * term, and C opens on the player having Glyph of Fire Elemental Totem — a 30-second summon — which
 * an observed window can refute (a summon that ran 57 seconds was not a 30-second one) but never
 * confirm, because a short window is also what a long one looks like when a Searing Totem or the kill
 * cut it off.
 */
export type EarthElementalVerdict = 'near-end' | 'off-rule' | 'unknown';

/** One Earth Elemental press and what the list's own three-branch rule says about it. */
export interface EarthElementalPress {
	/** Fight-relative, and **0 on an inferred use** — a pre-pull press's real instant is not in the log. */
	t: number;
	/**
	 * What the list's rule says about this press. See `EarthElementalVerdict` for the three branches.
	 *
	 * Computed for an inferred use as well as a read one — one expression cannot disagree with itself
	 * about whether a summon that predates the bell was inside a 50-second pull's end window — but an
	 * inferred use is **not counted into `good` or `graded`**: the list has no pre-pull Earth Elemental
	 * play, so grading one would invent a rule (§75).
	 */
	verdict: EarthElementalVerdict;
	/** Whether this use was recovered from a pre-pull window rather than read off a cast. */
	inferred: boolean;
}

/** One Earth Shock that spent the shield below its ceiling — a spend that threw Fulmination away. */
export interface LightningShieldBadSpend {
	t: number;
	/** The stacks the press actually spent; null when the log never carried the shield. */
	stacks: number | null;
}

/** One Lava Surge proc window, and whether a Lava Burst consumed it before it expired. */
export interface LavaSurgeProc {
	start: number;
	end: number;
	consumed: boolean;
	/**
	 * A surge that expired with no Lava Burst inside *while the player could act* — one that ran out
	 * during an intermission is the fight taking the free cast back, not a cast the player threw away.
	 */
	wasted: boolean;
}

/** One Lava Burst press, what made it free, and whether Flame Shock paid for it. */
export interface LavaBurstPress {
	/** The commit instant — the `begincast`, or the cast itself for a surge-instant press. */
	t: number;
	/** Free from a Lava Surge proc. */
	surge: boolean;
	/** Free from Ascendance's reset. */
	ascendance: boolean;
	/**
	 * Flame Shock up on the enemy this press was **aimed at**, read at the cast's **completion**.
	 *
	 * Not at `t`, which is this row's commit instant. Whether the multiplier applied is a fact about the
	 * game and the game decides it when the cast completes; whether the press was a good idea is a
	 * judgement about the player and is read at the commit, like `surge` and `ascendance`. The audit
	 * filling this in carries the argument.
	 *
	 * False is a fault: Flame Shock is Lava Burst's ×1.5 damage multiplier, so a press committed with
	 * no dot on its target threw a third of the hit away. Published and drawn, not graded — the
	 * reasoning is at the audit that fills this in.
	 *
	 * Null is "cannot say", never "no dot": the cast event named no target and the pull had no landed
	 * hit to fall back on. Reading that as false would invent a fault out of a missing measurement.
	 */
	flameShock: boolean | null;
}

/** Lava Burst and its two resets — the free casts, and the surges that expired with no press. */
export interface LavaBurstAudit {
	procs: LavaSurgeProc[];
	presses: LavaBurstPress[];
	/** Surges that expired with no Lava Burst inside — a free cast thrown away. */
	wasted: number;
}

/** One shaman's Stormlash placements, so the raid's coordination can be read per player. */
export interface StormlashShaman {
	id: number;
	/** The shaman's name, or null when the actor list did not name this id. */
	name: string | null;
	windows: Window[];
}

/**
 * One Stormlash Totem this player was actually given, whoever laid it.
 *
 * **A different source from `StormlashShaman`, and that is the whole point of it.** `shamans` comes out
 * of `raidStormlash`, a separate raid-wide *placement* fetch, and no committed fixture carries that
 * field — so `shamans` is `[]` and `totems` is `0` on every pull we hold, and a table built off them
 * renders empty while looking finished. This comes off the fight's own event stream narrowed to the buff
 * that landed on *this* player, which is populated on all three (2, 4 and 4 totems). The two answer
 * different questions — `shamans` is what the raid laid, this is what reached the player — and only the
 * second can be read without the extra fetch.
 */
export interface StormlashReceived {
	/** When the buff went up on the player, fight-relative ms. */
	t: number;
	/** When it came off, clamped to the kill. */
	end: number;
	/** Who laid it — the same `petOwner`-resolved caster the timeline row carries. */
	source: LaneSource;
	/**
	 * Whether **the player's own press** landed inside their own Ascendance — plan §80 rule 6.
	 *
	 * Shown, never graded. The user wrote "should *ideally* not be cast during Ascendance", and §92 set
	 * the precedent that §80's hedge is read per sentence: "should have at least" grades, "should
	 * ideally" shows. Nothing reads this into a grade expression.
	 *
	 * Read off the **press**, not off the bar's start. The two differ by up to a global — on `phased` the
	 * press is at 1 620 ms and the buff went up at 2 427 — and the thing rule 6 is about is the global,
	 * because during Ascendance every one of them was wanted on Lava Beam.
	 *
	 * Null for a totem somebody else laid. A raid-mate's Stormlash landing inside this player's
	 * Ascendance is not a press this player made, and calling that `false` would put a column of
	 * reassurance beside rows nobody could have done anything about.
	 */
	duringAscendance: boolean | null;
}

/**
 * The raid's Stormlash Totems, read together — the buff does not stack, so two totems up at once is
 * a totem wasted, and the section exists to show where that happened.
 */
export interface StormlashAudit {
	shamans: StormlashShaman[];
	/** The stretches two or more totems were up at once. */
	overlaps: Window[];
	/** Total placements across the raid. */
	totems: number;
	/**
	 * The totems that reached this player, in time order — the rows of the section's table.
	 *
	 * Optional because an `Analysis` captured before this field existed carries none, and absent has to
	 * read as "this pull was analysed without it" rather than as "no totem reached them".
	 */
	received?: StormlashReceived[];
}

/**
 * Lightning Shield's counter, audited for the questions a counter aura raises: did it sit at the
 * ceiling too long, did it come off, and were the spends taken at the ceiling.
 */
export interface LightningShieldAudit {
	/** The charge over time, one point per stack change — the step series the section draws. */
	points: Array<[number, number]>;
	/** The ceiling, from the game model rather than from this pull's peak. */
	maxStacks: number;
	/** Time spent at the ceiling past the reader's leeway, summed across `gradedMs`. */
	overcapMs: number;
	/**
	 * The length of the clock `overcapMs` was measured inside — the pull less `aoeWindows`.
	 *
	 * **The field that keeps this exemption from becoming a free pass**, and the reason it is a published
	 * number rather than something the score infers. `overcapMs` is a fault counted only inside the
	 * stretches a list spends the shield in, so a pull that never left three-plus enemies has `0ms` of
	 * overcap over `0ms` of gradable time — and zero against a `good: 0` threshold is the best mark on
	 * the card, awarded to precisely the pull the exemption just excused. No proxy detects that:
	 * `maxStacks > 0` is true there, because the shield was up and counting throughout. Only the graded
	 * length distinguishes "nothing to fault" from "nothing judged", which is what `gradedOver` hands
	 * `metricOf` so it can null instead of grading.
	 *
	 * Same name and same job as `ManaAudit`'s two clocks, which is where the name comes from.
	 */
	gradedMs: number;
	/** The leeway the overcap was measured beyond, so the section can name the number it used. */
	leewayMs: number;
	/**
	 * The stretches the aoe list applied to — three enemies or more — which `overcapMs` drops.
	 *
	 * Published so the chart shades the same array the denominator refused. Not `fellOff`'s clock: that
	 * stays graded at every band, because Rolling Thunder returns 2% of maximum mana per charge and only
	 * while the buff is up. Keeping the shield up is always right; spending its stacks is only right where
	 * a rung spends them, and from three targets none does.
	 */
	aoeWindows: Window[];
	/** The overcap stretches, for drawing red. */
	overcapWindows: Window[];
	/** How many times the shield came all the way off. */
	fellOff: number;
	/** The stretches the shield was down, for drawing red. */
	downWindows: Window[];
	/** The Earth Shock presses that spent fewer than the ceiling. */
	badSpends: LightningShieldBadSpend[];
}

/**
 * One stretch the pool sat below a line, and the lowest it got inside it.
 *
 * `pct` is the deepest reading in the stretch rather than its average or its edge: what a reader
 * wants from a row is how bad it got, and the edges of a stretch are both sitting on the line by
 * construction.
 */
export interface ManaLowStretch {
	start: number;
	end: number;
	/** The lowest reading inside the stretch, as a share of the ceiling. */
	pct: number;
	link: string;
}

/**
 * One of the Mana section's two faults: the pool below a line with the button for it in hand.
 *
 * **An omission, which is why the fields below are four numbers rather than one.** The player is
 * charged for not pressing something, so the pull has to be shown to have offered the press before a
 * second of it can be charged — and the three ways it can fail to offer one are all real and all
 * different. Time below the line with the button provably coming back is the fight taking the mana
 * and is never a fault; time inside the opening no press can be placed in is a fact about how much
 * the log carries; and a sliver too short for the priority list to have looked at the pool even once
 * is not a press anybody passed over. Only what is left is `ms`.
 *
 * Neither tool is in the model — both are named in `EXTRA_NAMES` as off-rotation globals — so there
 * is no cooldown series to read and availability comes out of the presses themselves. See
 * `manaFault` in `specs/elemental/lib/index.ts` for the two rules that turns into.
 */
export interface ManaFault {
	/** Time below this fault's line over the whole pull, whatever was or was not in hand. */
	lowMs: number;
	/** Of it, the time the button was provably in hand across a stretch at least one global long. */
	ms: number;
	/** How many such stretches — one per press the priority list asked for and did not get. */
	stretches: number;
	/** Of `lowMs`, the part the button was provably still coming back. Never charged. */
	onCooldownMs: number;
	/** Of `lowMs`, the part inside the opening no press can be placed either side of. Never charged. */
	unprovenMs: number;
	/**
	 * The clock this fault was actually graded over: time below the line with the button provably in hand,
	 * before the one-global floor is applied.
	 *
	 * **Published so the score module can refuse to grade an empty one**, which is the same hazard
	 * `lightningShieldOvercap`'s comment names and could not fix for want of exactly this number: `0ms of
	 * starvation` measured over no time at all is `good`, a free full mark rather than the honest "this
	 * pull never asked". Zero here covers three different pulls that must all read the same way — the pool
	 * never went near the line, it went low only while both buttons were away, and it went low only inside
	 * the opening the log cannot speak for — and in none of them did the player decline a press.
	 *
	 * `ms` can still be zero with this above zero, and that one *is* a real full mark: the pool dipped
	 * under the line with the button up, and never for long enough for the list to look at it.
	 */
	gradedMs: number;
	/** The charged stretches, in time order, each with the lowest reading it reached. */
	windows: ManaLowStretch[];
}

/**
 * The pool an Elemental casts from, and the two buttons that refill it.
 *
 * `cleave.apl.json` is the only one of the spec's three priority lists that hand-codes either of
 * them — `:15` casts Thunderstorm at `mana <= 15%`, `:0` casts Shamanistic Rage at `mana <= 70%`,
 * both `OpLe` — and that is itself the evidence that mana binds on a multi-target pull and not on a
 * single-target one, where `autocastOtherCooldowns` is left to find the Rage on its own.
 *
 * **Read off the bar the cast log already draws** (`resources.mana`) rather than walked out of the
 * events a second time. Two independent readings of one pool is how this report has already produced
 * a share above 100%, and the windows below are the same arrays the two figures were measured over,
 * so the chart shades exactly what was charged.
 */
export interface ManaAudit {
	/** Readings the bar was built from. Zero means the log carried none and nothing here is measurable. */
	samples: number;
	/** The ceiling, straight off the samples. */
	max: number;
	/** The lowest reading of the pull, as a share of the ceiling. Null with no samples. */
	minPct: number | null;
	/** The two lines, as shares of the ceiling, so the copy names the numbers it was measured against. */
	starvedPct: number;
	strainedPct: number;
	/** The shortest stretch either fault charges for: one global, the cadence the list re-reads the pool at. */
	floorMs: number;
	/** Thunderstorm's fault — at or under 15%, the rescue in hand and not taken. */
	starved: ManaFault;
	/** Shamanistic Rage's fault — at or under 70%, the cost reduction in hand and not taken. */
	strained: ManaFault;
	/**
	 * Time at or under 15% with **both** tools provably coming back.
	 *
	 * Published separately from either fault's `onCooldownMs` because it is the one number that says
	 * "the fight took this mana": at 15% the list wants both buttons, so a stretch with neither of them
	 * available is a stretch the player could not have rescued by any press. Nothing charges it, and
	 * the section says so in as many words.
	 */
	bothOnCooldownMs: number;
	/**
	 * The same stretches as an array, so the chart shades exactly what the figure above was measured
	 * over rather than a second guess at it — the identity `exemptTrack.test.ts` exists to enforce,
	 * after three charts each derived the same idea differently.
	 */
	bothOnCooldownWindows: Window[];
	/**
	 * Thunderstorm presses taken above the starvation line.
	 *
	 * **Stated and never graded, deliberately.** Thunderstorm costs a global, so pressing it on a full
	 * pool trades a Lightning Bolt for mana nobody needed — a small waste, and a real one. But charging
	 * for it would build the mirror of the fault above and the two together would push a player toward
	 * pressing it exactly once per starved stretch and never otherwise, which is a precision no reader
	 * has and no log can confirm they had. So the count is on the page, uncoloured, with the trade named
	 * beside it, and it reaches no scorecard. The section must not be made to reward spamming the button
	 * either: nothing here counts a press as a credit.
	 */
	earlyThunderstorms: number;
	/**
	 * Of `starved.ms`, the part the Lightning Shield was down through.
	 *
	 * Amendment 1's link to Amendment 3, and it is a cause rather than a coincidence: Rolling Thunder
	 * (88765) returns 2% of maximum mana per charge it grants and only fires while the shield is up
	 * (`sim/shaman/talents_elemental.go:137`, `ExtraCondition` on the shield being Lightning Shield), off
	 * Lightning Bolt, Chain Lightning and Lava Beam — the bottom rung of all three lists. So a shield
	 * that fell off is a mana fault as well as a damage one.
	 *
	 * Zero is the common case and the section says nothing about the shield when it is zero. A pull whose
	 * starvation did not coincide with shield downtime must not be told it did.
	 */
	shieldDownMs: number;
}

/** The Elemental half of the analysis. See the `SpecAuditResult` fields for the shared half. */
export interface ElementalAuditResult {
	flameShock: FlameShockAudit;
	earthShock: EarthShockAudit;
	searingTotem: SearingTotemAudit;
	snapshots: SnapshotsAudit;
	ascendance: AscendanceAudit;
	lavaBurst: LavaBurstAudit;
	/** The pool, and the two buttons that refill it — see `ManaAudit`. */
	mana: ManaAudit;
	/** Elemental Mastery's presses, judged against the sync-with-Ascendance rule rather than drift. */
	elementalMastery: {
		presses: ElementalMasteryPress[];
		/**
		 * Whether the player took the talent: true, false, or **null for a log that could not say**.
		 *
		 * The same three-state field as `ChiBrewAudit.talented` and for the same reason. A `combatantinfo`
		 * list that does not name 16166 is a real "not talented" and a section gated on it should vanish;
		 * a report with no list at all has said nothing, and rendering that as a choice the player made
		 * would be the report inventing a decision. Read it against `null` rather than for truthiness:
		 * `false` is an answer.
		 *
		 * **Optional, and that is a fourth case rather than a fourth answer.** An `Analysis` is serialised
		 * — every captured fixture in this repository is one — so a pull audited before this field existed
		 * arrives without it. Absent has to read as `null` for the same reason a missing list does, which
		 * is what `elementalMasteryTalented` in the sections' `gates.ts` already does with `?? null`. The
		 * audit itself always publishes one of the three.
		 */
		talented?: boolean | null;
	};
	/** Fire Elemental's presses, judged against the sync-with-Ascendance rule rather than drift. */
	fireElemental: {
		presses: FireElementalPress[];
		/** Whether it was already out when the bell went. */ prepull: boolean;
		/**
		 * How much of the raid's on-pull haste cooldown the Primal Fire Elemental was standing for.
		 *
		 * The user's fifth scoring rule (plan §80), "100% uptime during Bloodlust", as a numerator and its
		 * own denominator rather than as a percentage. The share is the score's to take, the same pairing
		 * `EarthShockAudit` and `LightningShieldAudit` publish, so a reader can derive the figure instead of
		 * being handed one — and so the two halves cannot be measured over different stretches.
		 *
		 * **`gradedMs` is a clock that is legitimately empty, and that is the field's whole point.** It is
		 * zero on three different pulls, all of which must read "cannot say" and none of which may read
		 * 100%: a player who did not take Primal Elementalist, a log with no `combatantinfo` to say either
		 * way, and a pull whose haste cooldown did not go out on the pull. `metricOf` nulls on
		 * `gradedMs <= 0`, which is where all three are refused; the argument for each is on the audit.
		 *
		 * Not optional, unlike `elementalMastery.talented` beside it. That field hedges against a stored
		 * `Analysis` captured before it existed, and this spec has none — `__fixtures__/previewRoute.test.ts`
		 * pins that the Elemental commits raw `FightDataset`s and analyses them, which is why its own
		 * preview page had to be built that way.
		 */
		hasteUptime: {
			/** ms of that cooldown the summon's own aura windows covered. */
			coveredMs: number;
			/** ms of cooldown this rule was allowed to grade. Zero grades nothing. */
			gradedMs: number;
		};
	};
	/** Earth Elemental's presses, judged against the list's own three-branch rule rather than drift. */
	earthElemental: {
		presses: EarthElementalPress[];
		/**
		 * Whether it was already out when the bell went.
		 *
		 * Not graded, and deliberately so — the p5 list has no pre-pull Earth Elemental play to grade
		 * against. It is published because without it "no presses" was one field covering two different
		 * pulls: a cooldown nobody used, and one used before the log starts.
		 */
		prepull: boolean;
		/**
		 * Presses the rule wanted: branch A, the only branch a log can read to true.
		 *
		 * Over `graded`, never over `presses.length` — the same numerator-and-its-own-denominator pairing
		 * `EarthShockAudit` publishes, so a reader can derive the share rather than being handed one.
		 */
		good: number;
		/**
		 * Presses the log could answer at all: `good` plus the ones every branch refuted.
		 *
		 * Excludes both the `unknown` verdicts and every inferred pre-pull use, which is what makes this
		 * a denominator rather than a count of rows. An `unknown` in the denominator would charge the
		 * player for a Skull Banner cooldown nobody can read; a pre-pull use in it would grade a play the
		 * list does not contain.
		 */
		graded: number;
	};
	/** The raid's Stormlash placements, for the coordination section. */
	stormlash: StormlashAudit;
	lightningShield: LightningShieldAudit;
	/**
	 * The priority list run against the pull, press by press. The same three-state field as the
	 * Windwalker audit's: `undefined` is an analysis captured before the ladder existed, `null` is
	 * the ladder having nothing to say, an audit is an answer.
	 */
	apl?: AplAudit | null;
	/** The same walk, forced to one target count, keyed by band. */
	aplForced?: Partial<Record<Band, AplAudit | null>>;
	misses: Miss[];
	/** The spec's contribution to `cpm`, as in the Windwalker audit. */
	cpm: Pick<CpmSummary, 'wastedGcds' | 'channelSec'>;
	/** The spec's half of the timeline, as in the Windwalker audit. */
	timeline?: {
		casts: CastMark[];
		lanes: AuraLane[];
		hiddenTargets?: number;
		hiddenLanes?: AuraLane[];
	};
}
