// Windwalker Monk, MoP Classic 5.4.
//
// Everything specific to the spec lives here: the kit, the thresholds, and the wiring that turns
// the generic primitives in ../analysis into an Analysis. The primitives know nothing about monks;
// this file is the only thing that does.
//
// The kit is declared as data — Ability and Aura objects that name each other — and read back
// through a Registry. That is the whole point: a combat log is a stream of bare spell ids, and
// pairing two of them because their constants had similar names is how every early bug here got in.
// `registry.abilityByCastId(117418)` answers "nothing", because a channel tick is not a press.
//
// Ids are verified against qDZ2J7v4CP98aQmV #57 and KvCazMYkqZxfjRBg #48 (Garrosh HC 25).

import { abilityIdOf, instanceKey, isAbsorbed, isCast, isResourceChange, resourceActorOf } from '~/lib/events';
import { formatGap } from '~/lib/format';
import type { Ability, Aura, Channel, GameData } from '~/lib/game/model';
import { SHARED_ABILITIES, SHARED_AURAS } from '~/lib/game/shared';
import { ignoredMultiTargetActorIDs } from '~/lib/game/multiTargetActors';
import { createRegistry } from '~/lib/game/registry';
import { CLASS_COLOR } from '~/lib/game/classes';
import { RESOURCE_TYPE } from '~/lib/game/resources';
import { maxHealthFrom, readTalents } from '~/lib/analysis/gear';
import { aplAudit } from '~/lib/spec/apl';
import type { AplAudit, Band } from '~/lib/spec/apl';
import { CHI_COST, LADDER, UNARBITRATED } from './apl';
import { defaultSettings, type AnalysisSettings, type SettingSchema } from '~/lib/settings';
import type {
	ChiBrewAudit,
	Analysis,
	AuraLane,
	BlackoutKickAudit,
	BrewUse,
	CastMark,
	StarvedKick,
	FightDataset,
	LaneGroup,
	LaneSpend,
	LaneStacks,
	Miss,
	ProcWindow,
	SnapshotGrade,
	SpecAuditResult,
	WclEvent,
	Window,
} from '~/lib/types';
import {
	auraTimeline,
	auraLevels,
	auraWindows,
	levelWindows,
	cooldownDrift,
	inWindow,
	intersect,
	median,
	mergeIntervals,
	overflowIfHeld,
	overlapMs,
	pairDrainsToWindows,
	damageByTarget,
	r1,
	remainingAtCast,
	remainingIn,
	atCapWindows,
	auraDrops,
	DROP_MS,
	SELF_EVENT_MS,
	stretchesFromPoints,
	snapshotWindowEnd,
	toIntervals,
	trackStackBank,
	unionMs,
	uptimePct,
	analyseCore,
	type Interval,
	type TargetHit,
	type Handles,
	type SpecConfig,
} from '~/lib/analysis';
// Straight from the two modules rather than through the barrel above, which this lane does not own.
// `raidScoped` is the brand `raidSourceLanes` demands, and it is applied at the call site on purpose.
import { raidScoped } from '~/lib/analysis/auras';
import { raidSourceLanes } from '~/lib/analysis/raidCasters';

// ------------------------------------------------------------------ constants
//
// Declared once and handed to the game objects below, so the model carries the number and nothing
// reads a bare one twice.

/** The Tigereye Brew bank caps at 20. Its removals are how a use is read — never the cast. */
export const TEB_CAP = 20;
/** Stacks a full use drains. */
export const TEB_DRAIN = 10;
/** A brew always lasts 15s; a re-cast refreshes it rather than extending it. */
export const TEB_ACTIVE_MS = 15000;

/**
 * What one Tigereye Brew stack adds to damage, before mastery.
 *
 * `sim/monk/windwalker/tigereye_brew.go:52` — `damagePerStack := 0.05 + ww.getMasteryPercent()`,
 * computed inside the buff aura's `OnGain` and captured in a closure variable that `OnExpire` later
 * divides back out. It is read exactly once per cast and never re-read, which is the entire reason a
 * brew is worth holding for a Re-Origination proc: the proc's converted stats are frozen into the
 * buff and keep paying after the proc itself has gone.
 */
const TEB_BASE_PER_STACK = 0.05;

/**
 * Mastery's contribution to that number, from the simulator rather than from memory.
 *
 * `sim/monk/windwalker/windwalker.go:88` — `getMasteryPercent()` returns
 * `(8.0 + ww.GetMasteryPoints()) * 0.002`. The eight is the flat mastery every level-90 character
 * has before any rating; the points come from `sim/core/unit.go:279` → `sim/core/utils.go:238`,
 * which is `masteryRating / MasteryRatingPerMasteryPoint`, and that divisor is
 * `sim/core/base_stats_auto_gen.go:19` — `const MasteryRatingPerMasteryPoint = 600.000000`.
 */
const MASTERY_BASE_POINTS = 8;
const MASTERY_PER_POINT = 0.002;
const MASTERY_RATING_PER_POINT = 600;

/**
 * Damage one brew stack adds, given a mastery rating — or null when the log did not report one.
 *
 * Null rather than a default. Substituting a plausible rating would put a number in front of the
 * reader that came from this file rather than from their pull, and the two costs this section
 * compares are both proportional to it anyway, so the comparison never needs it. Only saying what a
 * choice cost *in damage* does.
 */
function brewDamagePerStack(masteryRating: number | null | undefined): number | null {
	if (typeof masteryRating !== 'number' || masteryRating <= 0) return null;
	return TEB_BASE_PER_STACK + (MASTERY_BASE_POINTS + masteryRating / MASTERY_RATING_PER_POINT) * MASTERY_PER_POINT;
}

const TIGER_POWER_MS = 20000;
const COMBO_BREAKER_MS = 15000;
/**
 * Energizing Brew's window. Six one-second ticks of 10 energy — 60 in total — on a one-minute
 * cooldown, taken from `sim/monk/windwalker/energizing_brew.go` (`Duration: time.Second * 6`,
 * `Period: time.Second * 1`, `NumTicks: int(aura.Duration.Seconds())`, `AddEnergy(sim, 10, …)`) and
 * confirmed against the 5.4 client data the sim ships: spell 115288, `SpellDuration` 6000ms,
 * `SpellCooldowns.RecoveryTime` 60000ms.
 */
const ENERGIZING_BREW_MS = 6000;

/**
 * What the brew adds per second: 60 energy over its 6 seconds.
 *
 * `sim/monk/windwalker/energizing_brew.go` — a periodic action with `Period: time.Second * 1` and
 * `NumTicks` equal to the aura's duration in seconds, each tick `AddEnergy(sim, 10, …)`.
 */
const ENERGIZING_BREW_PER_SEC = 10;

/**
 * Chi each generator returns, by cast id — now declared on the spec's `resources` config, by the
 * model's own ability keys, so the config and the cast table cannot disagree.
 *
 * From the simulator: Jab gives 2 in Fierce Tiger stance and 1 otherwise (`sim/monk/jab.go:91`, a
 * ternary on `StanceMatches(FierceTiger)` — a Windwalker is in Fierce Tiger, which is where the flat
 * ×1.1 comes from too), Spinning Crane Kick 1 (`spinning_crane_kick.go:154`), Rushing Jade Wind 1,
 * and Chi Brew 2 (`talents.go:752`).
 *
 * Needed because a chi *gain* is not logged. `resourcechange` carries chi for Chi Brew alone —
 * measured on a real pull, 12 events, all of it — so every other generator's contribution has to be
 * inferred from the button that produced it. Chi Brew is therefore *not* on the config's gains: its
 * return rides the `resourcechange` the walk applies and credits once, and counting it again would
 * give it four chi.
 */
/** Chi Brew reports its own return as a `resourcechange`, so the walk must not also read it here. */
const CHI_BREW_ID = 115399;
/**
 * The id WarcraftLogs reports Rushing Jade Wind's chi refund under — not the wind's own cast id.
 *
 * Established off the logs rather than looked up: across the three raw Windwalker pulls this id appears
 * beside a wind press and nowhere else — 27 events against 33 presses on `sections.json`, 4 against 9 on
 * `idle.json`, and zero on `uncounted.json`, which presses the wind zero times.
 */
const RJW_CHI_ID = 129_881;
/**
 * Fortifying Brew's window: 20s, from `sim/monk/fortifying_brew.go` (`Duration: time.Second * 20`)
 * and from the client data for aura 120954. Only used to bound the overlap below — nothing here
 * grades it, because Windwalker presses it to survive.
 */
const FORTIFYING_BREW_MS = 20000;
/**
 * What each of the three raid health buffs does to a maximum health pool.
 *
 * Only Touch of Karma's ceiling reads them, and they are here rather than on the aura declarations
 * because an `Aura` describes what the log writes, not what the effect is worth.
 *
 * Fortifying Brew's fifth is `sim/monk/fortifying_brew.go:15`. **Glyph of Fortifying Brew halves it
 * to a tenth** and a Mists Classic log reports no glyphs, so a press under the brew carries that
 * ambiguity — which is the one shape the arithmetic cannot resolve, and the reason the ceiling takes
 * the larger of itself and what the use actually absorbed. Ancestral Vigor's tenth and Rallying
 * Cry's fifth are the client's, and all three are confirmed by drained uses landing on the product
 * to the unit — see `karmaCap`.
 */
const FORTIFYING_BREW_HEALTH = 1.2;
const ANCESTRAL_VIGOR_HEALTH = 1.1;
const RALLYING_CRY_HEALTH = 1.2;
/**
 * Touch of Karma's advertised ten seconds, and deliberately *not* `KARMA_WINDOW_MS`.
 *
 * That one is 20s because redirect ticks run well past the tooltip and every tick has to find an
 * owner. This is the real duration, and it is what an overlap with another cooldown has to be
 * measured against: a Fortifying Brew pressed fifteen seconds after a Karma did not overlap it,
 * however wide the attribution window is.
 */
const TOUCH_OF_KARMA_MS = 10000;

/**
 * Stacks the bank must hold before a proc counts as a chance the player passed up.
 *
 * **The sim does not contain this rule.** An earlier version of this comment said it came from the
 * sim's priority list; that was checked against `ui/monk/windwalker/apls/default.apl.json` and is
 * false — no `4` appears anywhere in its Tigereye Brew logic. What the APL actually gates the
 * snapshot on is relative, not a floor:
 *
 *     "TEB: Stacks > Current"  ⇒  auraNumStacks(1247279) > auraNumStacks(1247275)
 *                                 bank stacks > stacks already frozen into the running brew
 *
 * which, with no brew running, is simply "at least one stack". So this constant is a judgement about
 * what is worth calling a mistake rather than a transcription of the rotation. It is deliberately
 * the stricter of the two readings: it only ever *excuses* procs, so it can never invent a fault.
 * Changing it moves the catch-rate denominator and nothing else.
 *
 * **Kept at four deliberately**, with the divergence from the APL known and accepted: a brew spent on
 * four stacks or fewer is too small to be worth the global, so a proc that only ever offered that is
 * not a chance the player passed up. Do not "correct" it to the APL's condition without asking — the
 * difference is the point, not an oversight.
 *
 * This is what separates a proc the player *missed* from one they were never offered. A pull opens
 * with an empty bank, so the first proc routinely arrives with nothing to spend — counting it as a
 * failure told players they had missed something they could not have taken.
 *
 * Measured against the bank's **peak across the proc window**, not its level at the proc's start:
 * stacks keep building during the ten seconds, so a proc can open under the threshold and cross it
 * with several seconds still to run. Judging at the start alone marks those as impossible when the
 * late brew — which is the play the rotation actually wants — was there to be taken.
 */
const SNAPSHOT_STACK_FLOOR = 4;

/**
 * Fists of Fury is the kit's only channel. Its ticks log as `cast` under their own id, so the
 * channel has to be counted off its own id and its length measured from the ticks; counting by name
 * turned 12 channels into 71 casts.
 */
const FOF_CHANNEL: Channel = { tickId: 117418, baseMs: 4000 };

/**
 * How long the tiger stays out, taken from the sim rather than from a tooltip.
 *
 * `sim/monk/talents.go:1075` — `monk.XuenPet.EnableWithTimeout(sim, monk.XuenPet, time.Second*45.0)`
 * — and the timeline aura beside it (`talents.go:1052`, `Duration: time.Second * 45.0`) agree on 45s.
 * The cooldown that pairs with it is 3 minutes (`talents.go:1070`, `Duration: time.Minute * 3`),
 * which is what `invoke-xuen` already declares below.
 *
 * The window is measured *forward from the cast* rather than off an aura, and that is deliberate.
 * The sim registers a `Xuen, the White Tiger` aura on the monk explicitly commented "For timeline
 * only" (`talents.go:1048-1053`): it exists so the sim's own chart has a bar to draw and so the APL
 * can ask whether the tiger is out. Reading uptime out of a `123904` buff would therefore be reading
 * a fabrication back as though it were data, and on a log that carries no such buff it would report
 * a confident 0% for a pull that summoned Xuen twice. A cast plus 45 seconds is what the sim models.
 */
const XUEN_DURATION_MS = 45000;

/**
 * Crackling Tiger Lightning: the pet's own nuke, `sim/monk/xuen_pet.go:55-81`.
 *
 * Xuen fights as a **separate actor** (`core.NewPet`, `xuen_pet.go:28`), so every point it deals
 * arrives under a `sourceID` that is not the monk's — which is what `petIDs`/`mine()` in `analyse()`
 * exist to fold back in. This id is the one thing unique to the tiger: its autoattacks land under
 * `1` like every other melee swing, so they cannot be told from the monk's own, and a Windwalker can
 * field more than one pet-typed actor. Matching this id is how the tiger's actor is found without
 * trusting a localised name.
 *
 * Deliberately *not* wired into `invoke-xuen`'s `damageIds`. That would move this damage out of the
 * passive column into the button's row, which would still be missing the pet's melee — a row that
 * reads as the summon's whole contribution while quietly understating it. Left as its own passive
 * row it is already counted exactly once, under the name of the thing that actually dealt it.
 */
const XUEN_NUKE_ID = 123996;

/**
 * Lightning Strike: what the Capacitive Primal Diamond pays out when Capacitance fills.
 *
 * `sim/common/mop/metagems.go:46-68` registers the spell and picks its id off the wearer's class —
 * `TernaryInt32(isHunter, 141004, 137597)` on line 48 — so a monk's discharge is **137597**, and the
 * hunter id is not a fallback to try. Both reference reports agree with the simulator here, which is
 * worth saying out loud because the last time an id was taken on the sim's word it disagreed: 137597
 * is the only id either monk deals "Lightning Strike" under (613 hits in a:6MhZgjyAknFWrYfK, 321 in
 * a:YBQzrcgVJnAj7NMP), 141004 appears in both reports but only ever from the hunters, and 137595 —
 * the `ActionID` the sim hangs its proc trigger on, `metagems.go:84` — produces no event at all.
 *
 * Read only to mark the discharge on the timeline. It is already counted as damage without this: the
 * id arrives named through `EXTRA_NAMES` and lands in the passive column of the damage table on its
 * own, at ~4% of a Windwalker's output, so a section counting it again would be a second opinion
 * about a number that is already printed.
 */
const LIGHTNING_STRIKE_ID = 137597;

/**
 * Spirits Storm, Earth and Fire can have out at once.
 *
 * Two, and both sources agree: the 5.4 tooltip says "The Monk can split into up to 2 elemental
 * spirits at a time", and the sim's aura declares `MaxStacks: 2` beside a controller that refuses a
 * third (`sim/monk/ww_storm_earth_and_fire.go`). Only ever read as the aura's ceiling — the count at
 * any given moment is the one the log stamped on the stack.
 */
const SEF_MAX_CLONES = 2;

/**
 * The three spells that put a spirit in the world, one per spirit the cooldown is named after.
 *
 * A `summon` event carries the *pet actor* in `targetID` and nothing about the enemy, which is why
 * these corroborate the placement count rather than defining it — see `sefPlacements`. Measured on
 * both anonymous Dark Shaman pulls: 138122 → the first pet, 138121 → the second, 138123 → the third,
 * and 138122 again on a later press, so a summon id names the *spirit* and an actor id is reused
 * across placements. Neither pull carried a summon from any other source, and Xuen's is 123904.
 */
const SEF_SUMMON_IDS: ReadonlySet<number> = new Set([138121, 138122, 138123]);

/**
 * How many potions one pull is worth: one before the pull and one inside it.
 *
 * **The simulator's rule, not a band cut from a sample**, which is what makes this the one figure in
 * this report gradeable on six fixtures. `sim/core/consumes.go:169-198` registers the two out of two
 * separate configured items — `consumes.PrepotId` takes `SpellFlagPrepullPotion`, `consumes.PotId`
 * takes `SpellFlagCombatPotion` (`sim/core/flags.go:184-185`) — and both are built through
 * `makePotionActivationSpellInternal`, which puts them on one shared timer:
 *
 *     SharedCD: Cooldown{ Timer: character.GetPotionCD(), Duration: time.Minute * 60 }
 *
 * Sixty minutes is "once per encounter". The second slot exists because `makePotionActivationSpell`
 * overrides that lock for a press taken before the pull — `if sim.CurrentTime < 0 { spell.SharedCD.
 * Set(sim.CurrentTime + categoryCooldownDuration) }` — so a pre-pull potion costs only
 * `POTION_CATEGORY_CD_MS` rather than the hour. Two, and the sim will not model a third.
 */
const POTION_SLOTS = 2;

/**
 * How long a pre-pull potion locks the potion category for, which is when the combat one comes up.
 *
 * Virmen's Bite's own `categoryCooldownDuration`, 60 seconds, from the same consumable table its
 * duration comes from (`assets/database/db.json`, `"categoryCooldownDuration": 60`). Used for one
 * thing only: deciding whether a pull was long enough to have *offered* the second slot, so a wipe
 * is not billed for a potion it never had the chance to drink.
 *
 * Confirmed against the log rather than taken on the sim's word. Across 192 player-pulls in the three
 * anonymous reports that show both a pre-pull potion and an in-fight press, the earliest in-fight
 * press lands 60.126s after the pre-pull one went down, and not one of the 192 comes in under sixty
 * seconds. Where there was no pre-pull potion the category was never locked, and presses turn up 7ms
 * into the fight — which is why the guard below is conditional on the pre-pull slot rather than flat.
 */
const POTION_CATEGORY_CD_MS = 60_000;

/**
 * How long a second enemy has to be under the monk's hands before the cooldown was worth pressing.
 *
 * **The reader's rule, not the simulator's**, and written down as such. The sim does have a number
 * and it is not this one: its APL gates the button on `numberTargets == 2` — an exact count at the
 * instant of the press, with no duration attached — and a log cannot answer that, because a log has
 * no notion of what is "in the fight", only of what was hit.
 *
 * What a duration adds is the thing an instant count gets wrong. A spirit costs a global and 10
 * energy to place, takes about two seconds to arrive (`SEF Spawn Delay`, a 2–2.3s roll in the sim's
 * controller) and is recalled the moment its target dies — so an enemy that is only there for a
 * global or two is an enemy that never repays the press.
 *
 * Ten seconds lands in a real gap rather than on either edge of one. Measured across the reference
 * pulls, the longest stretch with a second enemy under the player's hands is 5.9s on Iron Juggernaut
 * and 9.8s on Malkorok — both pulls where the button was correctly never pressed — against 27.5s on
 * Garrosh, 36.7s on Galakras and 63.9s on the Dark Shaman.
 *
 * Nothing grades against it. It decides whether the section speaks at all, which is the most a
 * number this soft may be allowed to decide.
 */
export const SEF_SECOND_TARGET_MS = 10_000;

export const GCD_MS = 1000;

/**
 * Share of a player's damage that has to land on one enemy for the pull to read as single-target.
 *
 * Measured across 25 real kills: single-target pulls sit near 100%, while the add fights that
 * produced the false red grades sit far below. Two thirds is comfortably between the two groups
 * rather than tuned to either.
 *
 * It used to gate the debuff grade, and no longer does — uptime is measured against the enemy being
 * hit, which is fair on an add fight and needs no gate. What still reads it is `debuff.singleTarget`,
 * and through that the caveat the debuff section prints beside a spread pull
 * (`RisingSunKick.tsx:136`) and the damage table's own copy. A whole-pull question, which is what this
 * number is; the per-moment answer is `TARGET_WINDOW_MS` below.
 *
 * **It does not reach the Energizing Brew audit**, whatever this comment said before. That audit's APL
 * exception is `rjwKnown` — `castCount(RUSHING_JADE_WIND_CAST) > 0`, a talent test — and it reads no
 * target count at all. The sim's rule is `Bloodlust inactive OR (Rushing Jade Wind known AND
 * numberTargets >= 2)`, so the second half of it genuinely is unimplemented; that is a gap worth
 * knowing about and not a reader of this constant. Naming a reader that does not exist is the exact
 * failure this codebase keeps writing comments to prevent.
 */
export const SINGLE_TARGET_SHARE_PCT = 66;

/**
 * How far back a per-moment target count looks.
 *
 * A count at an instant is always one: a monk hits one enemy per swing and per global, so asking "how
 * many targets" at a millisecond answers one however many enemies are stood in front of them. The
 * window is what turns a sequence of single hits back into "three enemies were being cycled", so its
 * length is the claim about how long a swing away from an enemy still counts as being on it.
 *
 * Five seconds. It has to clear the gap between two hits on the same enemy — a Windwalker's global is
 * a flat 1.0s and the melee swing runs slower — with room for a global spent on something that does
 * no damage at all, or a target that dodges; below about three the count flickers between one and two
 * on a straightforward two-target pull. And it has to be short enough that an add killed six seconds
 * ago has stopped counting, which is what rules out anything on the scale of Tiger Power's 20s.
 */
export const TARGET_WINDOW_MS = 5000;

/**
 * How much of the time a player was hitting *anything* has to be spent hitting more than one thing
 * before the pull reads as multi-target.
 *
 * A third, and measured rather than picked. Across the same 25 real kills the other thresholds here
 * were calibrated against, the share runs
 *
 *     7.0  10.3  11.4  13.8  14.0  16.8  21.5  22.9  25.0  25.1  27.5  27.8 | 36.7  39.0  47.0
 *     53.0  54.6  56.2  62.7  68.1  85.8  88.5  90.0  93.2  94.4
 *
 * and the widest gap in that distribution — 8.9 points, against a median spacing of about 2 — is the
 * one marked. Below it sit every Iron Juggernaut, Thok, Malkorok, Garrosh and Sha of Pride kill in the
 * set; above it sit both Dark Shaman, both Fallen Protectors, both Spoils, both Galakras and the
 * Paragons, which are the fights whose adds *are* the fight. A third sits inside the gap and can be
 * said out loud, which a number tuned to either edge of it could not.
 *
 * Three encounters land on both sides — Immerseus at 21.5 and 36.7, Norushen at 22.9 and 56.2,
 * Nazgrim at 27.5 and 39.0 — and that is the point rather than noise in it: two monks on the same
 * pull can play it two ways, and this is a reading of what the player did and not of what the
 * encounter is. It is why the reader gets an override rather than a lookup table of boss names.
 *
 * Deliberately a share of time rather than a peak count: every pull in the sample touched two enemies
 * at some point, and nine of them touched five or more, so "did you ever cleave" separates nothing.
 */
export const MULTI_TARGET_SHARE_PCT = 33;

/**
 * How many enemies the Rising Sun Kick debuff may be drawn for on the timeline, primary included.
 *
 * Purely a drawing limit — no metric reads it. Spoils of Pandaria and Galakras spray the debuff across
 * every add in the room, and a lane apiece would push the casts off a laptop screen to say almost
 * nothing, because most of those enemies carried it for one application before they died. Six is the
 * primary plus the five that took the most damage, which covers every enemy that lived long enough to
 * matter on the add fights in the zone while keeping the aura block under a thumb's width. Whatever is
 * left over is counted into `timeline.hiddenTargets` and named in the copy rather than dropped in
 * silence.
 */
export const RSK_TARGET_LANES = 6;

// -------------------------------------------------------------------- the kit
//
// `onGcd` marks the abilities that consume a global cooldown. Everything else the player presses
// (brews, trinkets, racials, potions, Roll) is off-GCD and must not inflate GCD utilisation.
//
// `gate` is what actually limits the button, and it decides whether a "lost cast" figure means
// anything: `chi` and `energy` buttons have no cooldown to drift against, `conditional` ones are
// judged against their conditions, and `other` is counted but never scored.

const ABILITIES: Ability[] = [
	{
		key: 'jab',
		targeting: { aimed: true },
		name: 'Jab',
		// One id per weapon type, and the full set matters: a monk holding a weapon whose id is missing
		// has every Jab dropped from the cast table silently. Verified against the sim's game database
		// — these are the Mists-era player spells named `Jab`, each with its own icon — after a real
		// log turned up damage under 115693, which this list did not have.
		//
		// 100780 is the sim's canonical id (`sim/monk/jab.go`) and the one the APL casts.
		castIds: [100780, 108557, 115687, 115693, 115695, 115698],
		damageIds: [100780, 108557, 115687, 115693, 115695, 115698],
		onGcd: true,
		// Energy, not chi: 40 energy for 2 chi (`sim/monk/jab.go`, `EnergyCost.Cost: 40` then
		// `AddChi`). It is the generator the spenders live on, so gating it on chi had the economy
		// backwards.
		gate: 'energy',
	},
	{
		key: 'tiger-palm',
		targeting: { aimed: true },
		name: 'Tiger Palm',
		castIds: [100787],
		damageIds: [100787],
		onGcd: true,
		gate: 'chi',
		applies: ['tiger-power'],
		consumes: ['combo-breaker-tiger-palm'],
	},
	{
		key: 'blackout-kick',
		targeting: { aimed: true },
		name: 'Blackout Kick',
		castIds: [100784],
		damageIds: [100784, 128531],
		onGcd: true,
		gate: 'chi',
		applies: ['blackout-kick-dot'],
		consumes: ['combo-breaker-blackout-kick'],
	},
	{
		key: 'rising-sun-kick',
		targeting: { aimed: true },
		name: 'Rising Sun Kick',
		castIds: [107428],
		damageIds: [107428],
		onGcd: true,
		gate: 'cooldown',
		cooldownMs: 8000,
		// The uptime metric hangs off the debuff this applies, never off the cast id.
		applies: ['rising-sun-kick-debuff'],
	},
	{
		key: 'fists-of-fury',
		name: 'Fists of Fury',
		castIds: [113656],
		damageIds: [FOF_CHANNEL.tickId],
		onGcd: true,
		gate: 'conditional',
		cooldownMs: 25000,
		channel: FOF_CHANNEL,
		/**
		 * It has a 25s cooldown but is never played off it. It is a ~4s channel that locks you out of
		 * everything else, so the sim's Windwalker APL
		 * (wowsims-mop/ui/monk/windwalker/apls/default.apl.json, priority 24) gates it on three
		 * conditions and ranks it *below* Rising Sun Kick, Tiger Palm, Chi Wave and Combo Breaker:
		 * Blackout Kick:
		 *   1. time-to-energy-cap must exceed the channel, so the channel never overcaps energy
		 *   2. not during Energizing Brew, unless Rushing Jade Wind covers the whole channel
		 *   3. if Re-Origination is up, only channel when the proc outlasts it AND a brew is running
		 * Scoring it as "N of M possible casts" is the same fabricated indictment as doing it to Jab,
		 * which is what `gate: 'conditional'` is there to prevent.
		 */
		note: 'Judged against the APL conditions, never against its cooldown.',
	},
	{
		key: 'rushing-jade-wind',
		name: 'Rushing Jade Wind',
		castIds: [116847],
		damageIds: [148187],
		onGcd: true,
		// 40 energy, and it generates chi (`sim/monk/talents.go`, `registerRushingJadeWind`).
		gate: 'energy',
		/**
		 * The one ability in this spec whose benefit is a trigger on units *hit* rather than damage dealt.
		 *
		 * The refund fires on the number of units the wind hits, and it does not ask whether any damage
		 * landed — so on Iron Juggernaut a wind spinning through a pack of Crawler Mines pays its chi back
		 * even though every one of those hits comes back `Immune` for zero. That chi is the whole reason
		 * the wind beats Jab into a pack, so a monk who pressed it there played correctly, and a ladder
		 * banded on the damage count would call it a fault. Everything else in this list — Spinning Crane
		 * Kick's flat chi, Rising Sun Kick's cleave, the fan-out averages — is about damage and gains
		 * nothing from a unit that cannot take any.
		 */
		targeting: { multiTargetBenefit: 'trigger' },
		cooldownMs: 6000,
		applies: ['rushing-jade-wind'],
	},
	{
		key: 'spinning-crane-kick',
		name: 'Spinning Crane Kick',
		castIds: [101546],
		damageIds: [107270],
		onGcd: true,
		// 40 energy for 1 chi (`sim/monk/spinning_crane_kick.go`).
		gate: 'energy',
	},
	{
		key: 'chi-wave',
		name: 'Chi Wave',
		castIds: [115098],
		damageIds: [132467],
		onGcd: true,
		gate: 'cooldown',
		cooldownMs: 15000,
	},
	{
		key: 'expel-harm',
		name: 'Expel Harm',
		castIds: [115072],
		// Its damage lands under its own id, not the cast's.
		damageIds: [115129],
		onGcd: true,
		// It has a real 15s cooldown, but it is absent from the Windwalker APL — it is played for the
		// heal, not the damage — so holding it is not a fault this report may name.
		gate: 'other',
	},
	{
		key: 'flying-serpent-kick',
		name: 'Flying Serpent Kick',
		castIds: [101545],
		damageIds: [123586],
		onGcd: true,
		gate: 'other',
		// A movement button. It does damage, and that damage is counted — but it is not a rotation
		// decision, so it is kept out of the per-ability comparison for the same reason a trinket proc
		// is: the chart is about choices, and nobody presses this one for the numbers.
		utility: true,
	},
	{
		key: 'touch-of-karma',
		name: 'Touch of Karma',
		castIds: [122470],
		// The reflect lands under its own id, which is how the damage it returned can be measured.
		damageIds: [124280],
		onGcd: true,
		// A defensive, but one that does real damage: it redirects what you take onto the target, so an
		// unused charge is damage not done as well as damage not avoided. 90s verified in the game
		// database (`SpellCooldowns.RecoveryTime` for 122470); the sim does not model it at all.
		//
		// It was previously left ungated on the reasoning that holding a defensive is not a fault. That
		// still holds for *when* it goes out — which is why it is `conditional` rather than `cooldown`,
		// so it is never billed for drift — but how many of its charges went unused across a pull is a
		// fair thing to show.
		gate: 'conditional',
		cooldownMs: 90000,
	},
	{
		key: 'leg-sweep',
		name: 'Leg Sweep',
		castIds: [119381],
		onGcd: true,
		gate: 'other',
	},
	{
		key: 'energizing-brew',
		name: 'Energizing Brew',
		castIds: [115288],
		onGcd: false,
		/**
		 * Conditional, not a cooldown to hold to. This is the condition, transcribed from priority 14
		 * of wowsims-mop/ui/monk/windwalker/apls/default.apl.json — the only place that file casts
		 * 115288 — and it is the standard the `energizing` audit judges a pull against:
		 *
		 *   AND(
		 *     energyTimeToTarget(maxEnergy) > 5s,
		 *     OR(
		 *       auraIsUnknown(2825 [Bloodlust], tag -1),
		 *       auraIsInactive(2825 [Bloodlust], tag -1, includeReactionTime),
		 *       spellIsKnown(116847 [Rushing Jade Wind])
		 *     )
		 *   )  ->  castSpell(115288)
		 *
		 * So: press it when the bar is at least five seconds from capping, and hold it through
		 * Bloodlust unless Rushing Jade Wind is in the build.
		 * Scored as a cooldown instead, it produced "lost casts" for doing exactly that.
		 *
		 * The audit checks the second clause and declines the first, the same division the Fists of
		 * Fury audit makes. Not because the bar is unreadable — `classResources` reconstructs it, and
		 * the Energy section reports it — but because "five seconds from capping" is a condition about
		 * one instant, and the bar is sampled about three times a second. Grading a press against the
		 * nearest reading would be grading the sampling grid.
		 */
		gate: 'conditional',
		cooldownMs: 60000,
		applies: ['energizing-brew'],
		note: 'Held deliberately through Bloodlust, so it is never judged against its cooldown.',
	},
	{
		key: 'fortifying-brew',
		name: 'Fortifying Brew',
		// 115203 is the button; the buff it applies logs under 120954, which is why the two are
		// declared apart. The sim registers both halves under a third id, 126456
		// (`sim/monk/fortifying_brew.go`), which never appears in a Classic log — all three carry the
		// same name in the client data, so matching by name would have picked whichever came first.
		castIds: [115203],
		onGcd: false,
		// A survival cooldown, and the sim treats it as exactly that: `CooldownTypeSurvival` with
		// `ShouldActivate: CurrentHealthPercent() < 0.4`. Windwalker presses it to live, so there is
		// nothing here to score — it is modelled only so the Touch of Karma overlap can be read.
		gate: 'other',
		cooldownMs: 180000,
		applies: ['fortifying-brew'],
	},
	{
		key: 'chi-brew',
		name: 'Chi Brew',
		castIds: [115399],
		onGcd: false,
		// Two charges on a 45s recharge (`sim/monk/talents.go`: `Charges: 2, RechargeTime: 45s`), and
		// conditional on top. Drift measured against a flat 45s cooldown misreads a charge-banked
		// ability completely — holding both charges for a burst window is correct play, and the old
		// model billed it as two lost casts.
		gate: 'conditional',
		cooldownMs: 45000,
		note: 'Two charges on a 45s recharge, and spent to a condition rather than on cooldown.',
	},
	{
		key: 'storm-earth-and-fire',
		// The log's spelling, comma and all, which is also Wowhead's for 137639 — and not the sim's.
		name: 'Storm, Earth, and Fire',
		/**
		 * 137639, and deliberately **not** the 138228 the simulator uses.
		 *
		 * wowsims registers the spell *and* its aura under one id — `SEFSpellID = int32(138228)` in
		 * `sim/monk/ww_storm_earth_and_fire.go` — and the Windwalker APL both casts that id and reads
		 * its stacks (`auraNumStacks(138228)` against 1 and 2). Taking the id from the sim is therefore
		 * the obvious move, and it is wrong: 138228 appears nowhere in a Mists Classic log. Measured on
		 * a:6MhZgjyAknFWrYfK fight 10 — a Galakras kill with fifteen presses of the button — a cast
		 * query for 138228 returns zero events and a damage query returns zero, while 137639 returns
		 * all fifteen casts, each carrying the enemy the spirit was sent to.
		 *
		 * The two are genuinely different spells rather than one id under two names. In the mop-classic
		 * client data 138228 is "Storm, Earth and Fire", a hidden level-75 monk trigger whose own
		 * tooltip carries no text and links back to 137639 for its description; 137639 is "Storm,
		 * Earth, and Fire" — with the comma — and is what the log prints beside every one of those
		 * casts. The sim picked the trigger; the client logs the ability.
		 */
		castIds: [137639],
		// On the global, which is why its absence mattered: every press was missing from the on-GCD
		// count, so GCD utilisation was understated for anyone playing it.
		onGcd: true,
		gate: 'conditional',
		applies: ['storm-earth-and-fire'],
		note: "Spent on the APL's target conditions rather than on a cooldown.",
	},
	{
		key: 'invoke-xuen',
		name: 'Invoke Xuen, the White Tiger',
		castIds: [123904],
		onGcd: false,
		gate: 'cooldown',
		cooldownMs: 180000,
	},
	{
		key: 'touch-of-death',
		name: 'Touch of Death',
		castIds: [115080],
		onGcd: true,
		// The APL's top priority when it is available, but availability is a health threshold on the
		// target rather than a cooldown coming up, so drift against it would be fiction.
		gate: 'conditional',
	},
	{
		key: 'tigereye-brew',
		name: 'Tigereye Brew',
		castIds: [1247275],
		onGcd: false,
		gate: 'other',
		applies: ['tigereye-brew'],
		consumes: ['tigereye-brew-bank'],
	},
	/**
	 * The agility combat potion, the one kit press that is this spec's own — the flask, the elixirs,
	 * the tinker, the healthstone and the racials live in `~/lib/game/shared` because any class wears
	 * them. Virmen's Bite stays here because its stat is the Windwalker's.
	 *
	 * wowsims keys it on the item rather than the spell — `makePotionActivationSpellInternal` in
	 * `sim/core/consumes.go:254` builds it as `ActionID{ItemID: potion.Id}` — so 105697 is the log's
	 * number and not the sim's. Measured on a:6MhZgjyAknFWrYfK and a:YBQzrcgVJnAj7NMP, where the same
	 * id is both the press and the buff.
	 */
	{
		key: 'virmens-bite',
		name: "Virmen's Bite",
		castIds: [105697],
		onGcd: false,
		gate: 'other',
		onUse: true,
		applies: ['virmens-bite'],
	},
	// The active defensives that put a buff on the monk: not rotation, so `gate: 'other'` and never
	// scored — but the buff window is worth drawing, so the press carries its aura.
	{
		key: 'dampen-harm',
		name: 'Dampen Harm',
		// Halves the next three big hits for up to 45s — `sim/monk/talents.go:763`.
		castIds: [122278],
		onGcd: false,
		gate: 'other',
		cooldownMs: 90_000,
		applies: ['dampen-harm'],
	},
	{
		key: 'diffuse-magic',
		name: 'Diffuse Magic',
		// 90% magic damage reduction for 6s — `sim/monk/talents.go:812`.
		castIds: [122783],
		onGcd: false,
		gate: 'other',
		cooldownMs: 90_000,
		applies: ['diffuse-magic'],
	},
];

const AURAS: Aura[] = [
	{
		key: 'tigereye-brew-bank',
		name: 'Tigereye Brew (bank)',
		ids: [1247279],
		kind: 'buff',
		maxStacks: TEB_CAP,
		drainsPerUse: TEB_DRAIN,
		// Nothing applies it: it is earned by spending chi, and only its removals are readable.
		consumedBy: ['tigereye-brew'],
	},
	{
		key: 'tigereye-brew',
		name: 'Tigereye Brew',
		ids: [1247275],
		kind: 'buff',
		durationMs: TEB_ACTIVE_MS,
		// A re-cast restarts the 15s rather than extending it, and WarcraftLogs records that as a
		// `refreshbuff` inside the running window — so one apply→remove pair can cover two brews, and
		// only the second one's snapshot is live.
		refreshRestarts: true,
		appliedBy: 'tigereye-brew',
	},
	{
		key: 'tiger-power',
		name: 'Tiger Power',
		ids: [125359],
		kind: 'buff',
		durationMs: TIGER_POWER_MS,
		appliedBy: 'tiger-palm',
	},
	{
		key: 'combo-breaker-tiger-palm',
		name: 'Combo Breaker: Tiger Palm',
		ids: [118864],
		kind: 'buff',
		durationMs: COMBO_BREAKER_MS,
		consumedBy: ['tiger-palm'],
	},
	{
		key: 'combo-breaker-blackout-kick',
		name: 'Combo Breaker: Blackout Kick',
		ids: [116768],
		kind: 'buff',
		durationMs: COMBO_BREAKER_MS,
		consumedBy: ['blackout-kick'],
	},
	{
		key: 'rising-sun-kick-debuff',
		name: 'Rising Sun Kick (debuff)',
		ids: [130320],
		kind: 'debuff',
		appliedBy: 'rising-sun-kick',
	},
	{
		key: 'blackout-kick-dot',
		name: 'Blackout Kick (DoT)',
		ids: [128531],
		kind: 'debuff',
		appliedBy: 'blackout-kick',
	},
	{
		/**
		 * The shield the press puts on the monk, so the timeline can draw the ten seconds rather than
		 * only the instant they were bought at.
		 *
		 * Modelled for the row and for nothing else: the section beside the chart measures what a Karma
		 * returned from the reflect and the absorb, and neither figure is read from here. What the chart
		 * could not say before is *how long* each press ran, which is the only thing that makes a press
		 * into a window a reader can line other presses up against.
		 *
		 * The same id as the cast, which is not an assumption — `karmaUses` already matches the log's
		 * `absorbed` events against `TOUCH_OF_KARMA.castIds`, and those events name the *shield* in
		 * `abilityGameID`. So 122470 is the id the absorb is booked under on this player, measured on
		 * the committed pulls rather than taken from a database.
		 */
		key: 'touch-of-karma',
		name: 'Touch of Karma',
		ids: [122470],
		kind: 'buff',
		durationMs: TOUCH_OF_KARMA_MS,
		appliedBy: 'touch-of-karma',
	},
	{
		key: 'energizing-brew',
		name: 'Energizing Brew',
		ids: [115288],
		kind: 'buff',
		durationMs: ENERGIZING_BREW_MS,
		appliedBy: 'energizing-brew',
	},
	{
		key: 'fortifying-brew',
		name: 'Fortifying Brew',
		// Not 115203 and not the sim's 126456: the buff a Classic log actually carries is 120954.
		// Verified on a:YBQzrcgVJnAj7NMP fight 10, where one cast of 115203 produced exactly one
		// apply/remove pair of 120954, twenty seconds apart.
		ids: [120954],
		kind: 'buff',
		durationMs: FORTIFYING_BREW_MS,
		appliedBy: 'fortifying-brew',
	},
	{
		key: 'rushing-jade-wind',
		name: 'Rushing Jade Wind',
		ids: [116847],
		kind: 'buff',
		appliedBy: 'rushing-jade-wind',
	},
	{
		/**
		 * The passive that makes some melee swings land twice.
		 *
		 * Modelled because the extra strikes were visible in the report and their cause was not: the
		 * damage arrives under its own id and drew a lane of its own on the timeline, with nothing to
		 * say why a third swing had appeared between two autos.
		 *
		 * `120273` is the buff and `120274` the extra strike's damage — the two are easy to swap, and
		 * both are named "Tiger Strikes" in the log. Confirmed against `sim/monk/ww_tiger_strikes.go`,
		 * where the aura carrying 120273 is the one with `Duration: 15s` and `MaxStacks: 4`, and
		 * 120274 is the action id given to the extra main-hand swing.
		 */
		key: 'tiger-strikes',
		name: 'Tiger Strikes',
		ids: [120273],
		kind: 'buff',
		durationMs: 15000,
	},
	{
		/**
		 * The same id as the press, and it is a *count of spirits* rather than a plain buff.
		 *
		 * Each press sends one spirit out and the log says so by stacking this aura. Measured on
		 * a:6MhZgjyAknFWrYfK fight 10: `applybuff` → `applybuffstack stack: 2` → `removebuffstack
		 * stack: 1` → `removebuff`, which is one spirit, then two, then one, then none. The APL reads
		 * exactly this state — `auraNumStacks < 1` before the first press of a pair, `== 0` before both
		 * — so the stack count is the rotation's own variable rather than decoration.
		 *
		 * No `durationMs`, deliberately. The spirits stay until the monk cancels them or their target
		 * dies (the 5.4 tooltip says so in as many words), so the window is whatever the log recorded
		 * and can never be a duration measured forward from a press. That is the opposite of Xuen, and
		 * for the opposite reason: Xuen's aura is a fabrication the sim keeps so its own chart has a bar
		 * to draw, while this one is a real aura the game applies and removes.
		 */
		key: 'storm-earth-and-fire',
		name: 'Storm, Earth, and Fire',
		ids: [137639],
		kind: 'buff',
		maxStacks: SEF_MAX_CLONES,
		appliedBy: 'storm-earth-and-fire',
	},
	// The item-effect auras — trinkets, the meta gem, the legendary cloak, the tinker — live in
	// `~/lib/game/shared` now, because any class wears them. What stays here are the two with a
	// Windwalker tie: the tier-16 four-piece, which a chi spender cashes in, and the agility potion.
	{
		key: 'focus-of-xuen',
		name: 'Focus of Xuen',
		// Tier 16, four pieces — not a trinket, and worth saying so on the row. The aura is registered
		// in `sim/monk/items.go:255-258`; what turns it on is in
		// `sim/monk/windwalker/tigereye_brew.go:60-66`, where every tenth Tigereye Brew stack *spent*
		// grants it for ten seconds. So this lane is a readout of how the brews were spent, which is
		// the one section of this report it lines up under.
		ids: [145024],
		kind: 'buff',
		// The two fields the rest of the gear block does without, and the reason is that this aura is the
		// only one that is *spent*. The others fade on a clock and a lane is the whole story; this one is
		// cashed in by the next chi spender, so the interesting question about a window is which button
		// took it — and answering that needs both the list of buttons that can (`consumedBy`,
		// `GetT16Windwalker4PCostReduction` in the sim, which the three call and nothing else does) and
		// the full duration, so a window that simply ran out is never blamed on a press that came later.
		durationMs: 10000,
		consumedBy: ['blackout-kick', 'fists-of-fury', 'rising-sun-kick'],
	},
	{
		key: 'virmens-bite',
		name: "Virmen's Bite",
		// The potion buff, under the same id as the press — see the ability for why the simulator has
		// no spell id to offer here at all.
		ids: [105697],
		kind: 'buff',
		// 25 seconds, and it is load-bearing rather than decorative: it is the bound that lets a bare
		// `removebuff` be read as a potion drunk before the pull — see `auraWindows`' `openAtPull`.
		//
		// Taken from the simulator's own consumable table, which keys on the item for the reason the
		// ability above gives: `assets/database/db.json` carries `{"id": 76089, "name": "Virmen's Bite",
		// "buffDuration": 25, "categoryCooldownDuration": 60}`, built from
		// `assets/db_inputs/dbc/consumables.json`'s `"Duration": 25000` by the divide-by-1000 in
		// `tools/database/dbc/consumable.go:50`, and handed to the aura at `sim/core/consumes.go:265` as
		// `NewTemporaryStatsAura(potion.Name, actionID, potion.Stats, potion.BuffDuration)`. The log
		// agrees to the millisecond: every one of the 365 in-fight potions across the three anonymous
		// reports removes 24.9–25.0s after it applies.
		durationMs: 25_000,
		appliedBy: 'virmens-bite',
	},
	{
		key: 'dampen-harm',
		name: 'Dampen Harm',
		ids: [122278],
		kind: 'buff',
		durationMs: 45_000,
		appliedBy: 'dampen-harm',
	},
	{
		key: 'diffuse-magic',
		name: 'Diffuse Magic',
		ids: [122783],
		kind: 'buff',
		durationMs: 6000,
		appliedBy: 'diffuse-magic',
	},
];

export const WINDWALKER: GameData = {
	abilities: [...SHARED_ABILITIES, ...ABILITIES],
	auras: [...SHARED_AURAS, ...AURAS],
};

/** The one way to ask what a spell id means. Construction validates the links between the two lists. */
export const registry = createRegistry(WINDWALKER);

/** Reads a cooldown from the ability spec instead of duplicating its duration at a call site. */
export function abilityCooldownMs(key: string): number {
	return registry.ability(key).cooldownMs ?? 0;
}

/**
 * Whether Energizing Brew could have been pressed at any point inside a window.
 *
 * The report's standing rule, applied to the one button that was getting away without it: **a chance
 * that never existed is not a chance declined.** The haste-window pairing used to be decided by
 * `hasteWindows.length > 0` alone, so a pull that spent the brew moments before the raid's cooldown
 * went out was told it had missed the pairing — on the Galakras kill in `a:6MhZgjyAknFWrYfK` the brew
 * goes at 6:11.7, Primal Rage opens 2.6 seconds later at 6:14.3 and closes at 6:54.3, and the brew's
 * 60-second cooldown does not return until 7:11.7, seventeen seconds after the window is gone. There
 * was no press to make and the card called it a miss.
 *
 * A use *inside* the window is its own proof of readiness and answers yes outright; otherwise the last
 * use before the window sets the return, and it counts if it lands anywhere at or before the window's
 * end. No use at all means ready from the pull — the log cannot see a pre-pull press, and inventing
 * one would take the report back to refusing chances that did exist.
 *
 * Exported because `./view/jadeWind` asks the same question about the same windows, and two copies
 * of this rule is exactly how one of them came to be missing.
 */
export function energizingBrewPressable(
	window: { start: number; end: number },
	uses: readonly { t: number }[],
): boolean {
	if (uses.some((use) => use.t >= window.start && use.t <= window.end)) return true;
	const before = uses.filter((use) => use.t < window.start).map((use) => use.t);
	const readyAt = before.length === 0 ? 0 : Math.max(...before) + abilityCooldownMs('energizing-brew');
	return readyAt <= window.end;
}

const RISING_SUN_KICK = registry.ability('rising-sun-kick');
const TIGER_PALM = registry.ability('tiger-palm');
const BLACKOUT_KICK = registry.ability('blackout-kick');
const TOUCH_OF_KARMA = registry.ability('touch-of-karma');
const CHI_BREW = registry.ability('chi-brew');
const TIGEREYE_BREW = registry.ability('tigereye-brew');
const INVOKE_XUEN = registry.ability('invoke-xuen');
const STORM_EARTH_AND_FIRE = registry.ability('storm-earth-and-fire');

const BREW = registry.aura('tigereye-brew');
const BREW_BANK = registry.aura('tigereye-brew-bank');
const RE_ORIGINATION = registry.aura('re-origination');
const RSK_DEBUFF = registry.aura('rising-sun-kick-debuff');
const TIGER_POWER = registry.aura('tiger-power');
const CB_TIGER_PALM = registry.aura('combo-breaker-tiger-palm');
const ENERGIZING_BREW = registry.aura('energizing-brew');
const FORTIFYING_BREW = registry.aura('fortifying-brew');
const ANCESTRAL_VIGOR = registry.aura('ancestral-vigor');
const RALLYING_CRY = registry.aura('rallying-cry');
const RUSHING_JADE_WIND = registry.aura('rushing-jade-wind');
const TIGER_STRIKES = registry.aura('tiger-strikes');
const TOUCH_OF_KARMA_AURA = registry.aura('touch-of-karma');
const RUSHING_JADE_WIND_CAST = registry.ability('rushing-jade-wind');
const ENERGIZING_BREW_CAST = registry.ability('energizing-brew');
const COMBO_BREAKERS = [CB_TIGER_PALM, registry.aura('combo-breaker-blackout-kick')];
const SEF_AURA = registry.aura('storm-earth-and-fire');
// Named separately from the `GEAR_PROCS` list it also belongs to, because it is the one piece of
// gear here with a *counter* behind its window rather than an on-or-off buff — see the lane below.
const CAPACITANCE = registry.aura('capacitance');
// Named separately for the same shape of reason: it is the one aura in that list a press *spends*,
// so its lane carries a verdict per window rather than only a bar — see `focusSpends` below.
const FOCUS_OF_XUEN = registry.aura('focus-of-xuen');

/**
 * The gear's own auras, as two lists because the chart groups them differently.
 *
 * Named by key here and resolved through the registry like every other aura above, so adding one to
 * the model is the whole change — the lanes below are built by mapping these, and nothing in the
 * timeline learns a spell id. Re-Origination is deliberately absent from both: it keeps the lane it
 * has always had, drawn from the snapshot analysis' own windows rather than from a second reading.
 */
const GEAR_PROCS: Aura[] = [
	'capacitance',
	'flurry-of-xuen',
	'focus-of-xuen',
	'vicious',
	'ferocity',
	// The weapon enchant, added because it fires and had no row: 18 applications on the committed dataset
	// (12 applies, 6 refreshes) and 13,024 across the item sweep, under the id the game actually writes —
	// 120032, see `shared.ts` for why the sim's own pair is not it. **Nothing in this report consumes it**,
	// which is why it went unnoticed for as long as it did: a proc no metric reads is a proc only the
	// chart can show, so no figure changed by its absence and no test could miss it.
	'dancing-steel',
].map((key) => registry.aura(key));
/** The kit the player pressed. Same windows, drawn as buffs, because a press is not a proc. */
const ITEM_USES: Aura[] = ['synapse-springs', 'virmens-bite'].map((key) => registry.aura(key));

/**
 * The raid's haste cooldown and the two racial buffs — neither gear nor a class button, and none of
 * them with a row until now.
 *
 * Named apart from both lists above because their windows are not this audit's own walk. The core
 * already publishes `hasteWindows` and `berserkingWindows`, both with `openAtPull`, and on the
 * committed dataset that flag is the whole difference between a lane and nothing at all: the pull's
 * Time Warp went up before the pull, so the only event the log carries for it is the removal at 39.9s
 * and a default walk discards it. Reading the published windows also keeps the row and the band the
 * rotation flow shades as one reading rather than two that can drift apart.
 *
 * Blood Fury is the exception and does walk, because nothing else in the engine reads it.
 */
const BLOODLUST = registry.aura('bloodlust');
const BERSERKING = registry.aura('berserking');
const BLOOD_FURY = registry.aura('blood-fury');

/**
 * The combat potion, named apart from the list above because it is the only one of the kit with a
 * *rule* behind it rather than only a window — see `potionAudit`.
 *
 * The flask and the three elixirs are deliberately not here, and the reason is the simulator's own
 * filing rather than a judgement about which consumables matter. They are registered by
 * `registerNonCombatPotions` (`sim/core/consumes.go:43`), carry `SpellFlagNonCombatPotion`, and sit on
 * `character.GetNonCombatPotionCD()` — spell category 79, a three-second timer — while the potion sits
 * on `GetPotionCD()`, category 4. Neither of the two slot flags is ever set on them. The two-potion
 * rule is a rule about potions, and a flask is not in it.
 *
 * Two independent reasons say the same thing, which is why this is a boundary rather than a taste:
 *
 *   - A flask is not a decision taken in the seconds before a pull. As the character's default flask
 *     the sim makes it permanent outright — `MakePermanent(spell.RelatedSelfBuff)` at `consumes.go:51`
 *     sets `Duration = NeverExpires` — so "it was up at the pull" is true of every pull anyone brought
 *     one to and says nothing about this one.
 *   - The recovery the pre-pull reading depends on degenerates on an hour-long buff. Its bound is the
 *     aura's own duration, which for 3,600,000ms covers nearly any fight, and `end - durationMs` then
 *     answers in negative minutes. Measured: six bare removals of Mad Hozen Elixir across the three
 *     anonymous reports land 42.6s to 166.0s into their fights and read as drunk 57.2 to 59.3 minutes
 *     before them. In the `weave` fixture Monk's Elixir shows a bare removal at 10.2s — an elixir the
 *     player cancelled by drinking Elixir of the Rapids in the same millisecond, which the reading
 *     would have reported as a pre-pull consumable drunk 59.8 minutes early.
 */
const POTION = registry.aura('virmens-bite');
const POTION_CAST = registry.ability('virmens-bite');

/**
 * The damage ids that land on exactly one enemy, which is the only evidence of where an actor stood.
 *
 * Here for one question: was the player hitting an enemy one of their own Storm, Earth and Fire
 * spirits was already on. Answering it means reading a target off a damage event, and most of what a
 * Windwalker deals cannot carry that reading — Rushing Jade Wind, Spinning Crane Kick, Fists of Fury,
 * Chi Burst and Chi Wave all spray across whatever is nearby, so on the add fights this metric exists
 * for everything would overlap everything and every pull would be reported as a fault.
 *
 * Measured rather than assumed. Counting distinct enemies hit by one source, under one id, at one
 * timestamp across the Galakras pull: Rushing Jade Wind reaches five, Flurry of Xuen and the weapon's
 * Multistrike proc reach three, Chi Burst two — while melee, Jab, Tiger Palm, Blackout Kick and
 * Rising Sun Kick reach exactly one, every time, across 1,178 timestamps. So these five and no more.
 *
 * Blackout Kick's DoT id rides along inside `damageIds` and is harmless: every one of its 340 events
 * on that pull is flagged `tick`, and ticks are filtered out before this set is consulted. A DoT goes
 * on ticking on an enemy the actor walked away from, which is the same reason `engagedWindows` throws
 * them out.
 */
const SINGLE_TARGET_DAMAGE_IDS: ReadonlySet<number> = new Set([
	// Melee. Modelled nowhere, because there is no button behind it; `EXTRA_NAMES` is what names it.
	1,
	// **Swept off the declaration rather than listed here.** The four keys used to be spelled out on this
	// line, which made this the second place the same judgement lived — a button could be given the
	// property in the model and still be missed here, or dropped from the model and still be counted.
	// `targeting.aimed` is the one statement; a new single-target button joins this set by declaring it.
	...registry.abilities.filter((a) => a.targeting?.aimed === true).flatMap((a) => a.damageIds ?? []),
]);

/** The id an aura is reported under. Every aura above declares at least one. */
const auraId = (aura: Aura): number => aura.ids[0] ?? 0;
/** The id an ability is reported under. Likewise. */
const castId = (ability: Ability): number => ability.castIds[0] ?? 0;

/**
 * The canonical cast ids of the buttons that spend Focus of Xuen, read off the model.
 *
 * `consumedBy` is the declaration and this is only its id form, because a mark carries the canonical
 * cast id — `castIds[0]` — rather than whichever id the log happened to use. So the set and the marks
 * are keyed the same way by construction, and adding a fourth consumer to the spec is the whole edit.
 */
const FOCUS_SPENDER_IDS: ReadonlySet<number> = new Set(
	(FOCUS_OF_XUEN.consumedBy ?? []).map((key) => castId(registry.ability(key))),
);

/** Holding these is only a mistake while the boss is up. The other two are resource cooldowns. */
const NEEDS_TARGET: ReadonlySet<string> = new Set(['rising-sun-kick', 'chi-wave']);

/**
 * Names for the ids the model deliberately does not carry: off-GCD utility, which is counted but
 * never scored, and damage with no cast behind it. Nothing here is an Ability, which is exactly what
 * marks its damage passive — autoattacks, Tiger Strikes, trinket and enchant procs and external
 * buffs are a readout of gear rather than something to coach. WarcraftLogs' own damage table fills
 * in anything not listed; whatever is still unknown renders as `#id`.
 *
 * The consumables left, and they left because the model now carries them: Synapse Springs, Virmen's
 * Bite and the Healthstone are Abilities so that the timeline can sort them as a tier of their own,
 * and an id the registry answers for never reaches this table.
 *
 * Raid buffs are deliberately absent: `RAID_BUFF_NAMES` already carries every provider id the buff
 * section knows, so naming the Monk's own two here would be a second copy of a number that is settled
 * over there — including the one whose cast and aura ids differ. That is still true of their *names*
 * and is not true of what they cost: `EXTRA_GLOBALS` below prices both, because what a global costs a
 * Monk is a fact about this spec and a roster shared with every class could not hold it.
 *
 * **The four ids the second, third and fourth raw pulls added, and why none of them is modelled.**
 * `analysis/__tests__/fixtureCoverage.test.ts` refuses an id that is neither an `Ability` nor named
 * here, and it named these four the moment `idle.json` and `uncounted.json` landed: 115460 Healing
 * Sphere ×14, 115176 Zen Meditation ×1, 115546 Provoke ×5 and 126389 Goblin Glider ×1. The question
 * that guard exists to force is whether each is the Chain Lightning shape — a rotational button priced
 * at nothing — and for these four it is not, on two measurements rather than on a reading of the names.
 *
 * The first is the global. `StartRecoveryTime` in the client data is the global a spell triggers, and
 * every button this spec models as `onGcd: true` reads **1000** there without exception — Tiger Palm,
 * Chi Wave, Leg Sweep, Expel Harm, Flying Serpent Kick, Touch of Karma. Zen Meditation, Provoke and the
 * glider read **0**: off the global entirely, which is exactly the class the paragraph above describes.
 * (The reverse does not hold and is not claimed: Tiger's Lust reads 1000 and has always been named here
 * rather than modelled.) Healing Sphere reads **500** — half the monk's global, and the only id in this
 * spec's whole cast-id set that reads anything but 1000 or 0 — so there is no honest `onGcd` for it.
 *
 * **What this paragraph used to conclude from that was wrong, and `EXTRA_GLOBALS` below is the
 * correction.** It said `onGcd: true` "would credit a full 1.0s slot for a press that costs half of
 * one, fourteen times over on `idle.json`; naming it errs the other way, and errs downward, which is
 * the direction `analyseCore`'s occupancy figure is documented to prefer." Both halves of that were
 * true and the conclusion did not follow. Erring downward is a preference between two defensible
 * prices; **zero** is not a price at all. A named id resolved to no `Ability`, so the GCD walk skipped
 * it outright and it occupied no milliseconds — so the choice on offer was never 1000 against 500, it
 * was 1000 against nothing, and the report said a monk who spent fourteen halves of a global had spent
 * none of it. Two Tiger's Lusts on `idle.json`, both in contact, cost a *full* global each and were
 * priced the same way, which is the same defect with none of the rounding to hide behind.
 *
 * The third option is the one that was missing: state the fraction and let the engine multiply it by
 * the pull's own measured global. `EXTRA_GLOBALS` does that and `SpecConfig.extraGlobals` argues the
 * shape; on this spec `effectiveGcd` measures 1000ms on all four raw pulls, so Healing Sphere is
 * priced at exactly the 500ms the client data says it costs, and nothing is rounded in either
 * direction.
 *
 * The second is damage, and it is the half the Chain Lightning failure actually cost. All four produce
 * **zero** `damage` events across all four raw pulls — Healing Sphere and Provoke log a bare `cast` and
 * nothing else, Zen Meditation and the glider log a `cast` and their own buff window — so there is no
 * output to be filed under `passive` as though no press had produced it. An id with no damage and no
 * rung in the priority list has nothing for a row to say, and modelling it would put a heal, a taunt
 * and an engineering toy in front of a ladder that grades globals.
 *
 * 115546 is worth naming for its own sake: it renders as a bare `#115546` because it is in neither
 * `generated/spells.json` nor WarcraftLogs' damage table, and it is **Provoke**, the Monk taunt. The
 * five presses on `uncounted.json` are the pull's finding rather than a curiosity — each one lands an
 * applydebuff of 116189 on a `Living Corruption`, which is a Windwalker picking adds up off the raid.
 */
const EXTRA_NAMES: Record<number, string> = {
	1: 'Melee',
	116841: "Tiger's Lust",
	109132: 'Roll',
	122783: 'Diffuse Magic',
	116705: 'Spear Hand Strike',
	116709: 'Spear Hand Strike',
	115460: 'Healing Sphere',
	115176: 'Zen Meditation',
	115546: 'Provoke',
	126389: 'Goblin Glider',
	120273: 'Tiger Strikes',
	120274: 'Tiger Strikes',
	120278: 'Tiger Strikes',
	146061: 'Multistrike',
	124335: 'Swift Reflexes',
	115129: 'Expel Harm',
	137596: 'Capacitance',
	137597: 'Lightning Strike',
	146194: 'Flurry of Xuen',
	147891: 'Flurry of Xuen',
	145024: 'Focus of Xuen',
	26297: 'Berserking',
	120032: 'Dancing Steel',
	148903: 'Vicious',
};

/**
 * What one press of an unmodelled id costs this Monk, as a fraction of a Monk's global.
 *
 * **A global spent while the player was in contact has to be measured, whether or not the rotation
 * asked for it.** Nothing here is on the priority ladder and nothing here is graded; what changed is
 * that a press the ladder does not want is no longer priced at *nothing*. `analyseCore`'s
 * `SpecConfig.extraGlobals` carries the argument for the shape and for why the value is a fraction
 * rather than a duration; this is the census behind the numbers.
 *
 * Every figure is `SpellCooldowns.StartRecoveryTime`, joined on `SpellID` (not `ID`, which is the
 * table's own key and joins to nothing), out of the simulator's `tools/database/wowsims.db`. The
 * denominator is **Jab (100780), `StartRecoveryTime` 1000** — this spec's plainest rotational button
 * and the value every one of its `onGcd: true` abilities reads.
 *
 *   1.0   116841 Tiger's Lust          1000    a full Monk global
 *   1.0   116781 Legacy of the White Tiger 1000
 *   1.0   115921 Legacy of the Emperor  1000
 *   0.5   115460 Healing Sphere          500    the one id in this spec's cast set that is neither 1000 nor 0
 *   0     109132 Roll                      0
 *   0     115176 Zen Meditation            0
 *   0     115546 Provoke                   0
 *   0     126389 Goblin Glider             0
 *   0     116705 Spear Hand Strike         0
 *   0     116709 Spear Hand Strike       n/a    absent from the table — see below
 *   0     1      Melee                   n/a    absent from the table — no button, no global
 *
 * **The melee entry is the load-bearing one and it is not a formality.** WarcraftLogs writes a `cast`
 * event for every auto-attack under id 1 — 197, 116, 369 and 236 of them on the four raw pulls — so
 * this table is consulted 918 times for the swing and once each for everything else on the list. A
 * missing entry would be read as "no global", which is correct; a wrong one would price a Windwalker's
 * autoattacks at nine hundred globals. It is stated rather than left to a default for the same reason
 * the guard exists at all.
 *
 * **Two ids are not in `SpellCooldowns` and both are `0` on evidence rather than on absence.** 116709
 * is Spear Hand Strike's second `cast` row: `sections.json` logs 116705 and 116709 within one
 * millisecond of each other, twice, and 116709 carries the silence debuff — one press of the interrupt
 * writing two cast events, and 116705 is the one the table prices at 0. (Pricing both would be
 * harmless anyway: occupancy is a union of intervals, so two spans over the same millisecond count
 * once.) Id 1 has no row because an auto-attack is not a spell.
 *
 * **The two Legacy buffs are here and their names are not.** They are named in the shared
 * `RAID_BUFF_NAMES` roster, which is exactly where a provider id belongs and why `EXTRA_NAMES` above
 * declines to copy them. A global is the other kind of fact: Legacy of the White Tiger costs a Monk
 * 1000ms and a Paladin's Blessing costs a Paladin 1500ms, so the number is the *spec's* and cannot
 * live in a roster shared across every class. Both are pressed once each on `dataset-ironJuggernaut`
 * and `idle` **inside contact**, and once each on `sections` outside it — where the clipping in
 * `occupiedMs` drops them from numerator and denominator together, which is the documented rule and
 * why that pull's figure does not move for them.
 *
 * **`122783` Diffuse Magic is named above and absent here on purpose.** No committed fixture presses
 * it, and the guard asks for a price when a press appears rather than in advance. Declaring one now
 * would be a number nothing in the repository could check — the discipline `SILENT_AURAS` already
 * applies from the other end.
 *
 * **What it moves, measured on the four raw pulls.** `gcdUtilisationPct` reads 88.55 → 89.60 on
 * `dataset-ironJuggernaut` (+1.05, both Legacy buffs in contact), 66.40 → 69.53 on `idle` (+3.13, five
 * whole globals in contact and the largest move in either spec), 89.67 → 90.15 on `uncounted` (+0.48,
 * one Tiger's Lust) and 75.62 → 76.13 on `sections` (+0.50). `sections` is the one to read against the
 * others: it presses eight unmodelled ids and six of them are in contact, but four of those six are
 * the two Spear Hand Strike rows, which are one interrupt at `StartRecoveryTime` 0 — so only its two
 * Tiger's Lusts cost anything, and both of its Legacy presses fall outside contact and are clipped
 * away by `occupiedMs`. Two globals against a 385.8s contact clock is 0.52 points before the union
 * trims the overlap, and 0.50 after.
 *
 * `effectiveGcd` measures 1000ms on all four, which is what makes this spec the clean case: the
 * fraction and the millisecond agree exactly, and Healing Sphere is priced at the 500ms the client
 * data says it costs with nothing rounded in either direction.
 *
 * **No letter moved, on either spec.** `gcdUtilisation` bands at `good` 85 / `ok` 75 here and at 80/65
 * on the Elemental, and all eight raw pulls keep the grade they had — as does every section grade and
 * every overall grade. `idle` at 69.53 is still short of the 75 it would need and `sections` at 76.13
 * was already past it. The figure is a point or three more honest and no reader is told anything
 * different about the player, which is the outcome a measurement correction should want.
 */
const EXTRA_GLOBALS: Record<number, number> = {
	1: 0,
	116841: 1,
	116781: 1,
	115921: 1,
	115460: 0.5,
	109132: 0,
	115176: 0,
	115546: 0,
	126389: 0,
	116705: 0,
	116709: 0,
};

// ---------------------------------------------------------------- thresholds

/**
 * The default Tiger Palm refresh window, and only the default: the reader owns this one.
 *
 * The APL threshold is `auraRemainingTime(Tiger Power) <= 1s`, and the report used to grade against
 * that literally. It is now the floor rather than the rule, and the default sits a global above it —
 * the reasoning is on the `tigerPalmRefreshMs` entry of `WW_SETTINGS` below, and the departure from
 * the APL is deliberate.
 */
export const TP_REFRESH_WINDOW_MS = 2000;

/**
 * How late inside a Re-Origination proc a brew went out. The brew keeps the Rune's converted stats
 * for its whole 15s while the proc lasts 10, so the target is the final global of the proc: every
 * second of proc left on the clock is a second of boosted brew given away.
 *
 * Exactly one global, and derived from `GCD_MS` rather than written out, because that is what the
 * label on the chart claims it is. It used to be a hand-set 1500ms — a reaction-time allowance
 * borrowed from the 1.5s spell global — which made the band half again as wide as a Windwalker
 * global actually is: this spec's buttons cost energy and chi, so the global is a flat 1.0s that
 * haste does not shorten. A brew landing 1.4s before the proc ended was being credited as landing
 * on the last global when a full global had in fact gone by.
 */
/**
 * The default reaction window: one global.
 *
 * Kept as the engine's default rather than its rule. A player on 200ms latency is logged 200ms after
 * they acted, and someone who deliberately brews with a two-second cushion is playing a considered
 * game — so the window is a setting, and this is only where it starts. It is also the `snapshotLeewayMs`
 * entry of `WW_SETTINGS` below.
 */
export const LAST_GCD_MS = GCD_MS;
/** Still respectable. */
export const LATE_MS = 3000;

/**
 * The analysis thresholds a Windwalker reader may disagree with, declared for the settings panel.
 *
 * Everything else this report grades is a judgement it makes and defends in a comment; these three
 * depend on the person rather than on the spec — how late someone can react to a proc is a fact
 * about their latency and their hands, and a number picked here would be wrong for somebody.
 *
 * The defaults are the audit constants above, which is why this schema reads them rather than
 * writing its own numbers; the bands' reasoning lives on the entries.
 */
export const WW_SETTINGS: SettingSchema[] = [
	{
		key: 'snapshotLeewayMs',
		tKey: 'settings.ww.leeway',
		// One global — the rotation's own target is a brew inside the proc's final global. The floor is
		// where there is no window left to react in, so below it the report would grade reflexes rather
		// than play; the ceiling is `LATE_MS`, past which the two bands would overlap and every snapshot
		// would land in the best one, which is not a generous setting but a broken scale.
		default: LAST_GCD_MS,
		min: 250,
		max: LATE_MS,
		step: 50,
	},
	{
		key: 'tigerPalmRefreshMs',
		tKey: 'settings.ww.tigerPalm',
		// Two globals, one wider than the APL — see `TP_REFRESH_WINDOW_MS` above for why the departure
		// is deliberate, with the APL's own value reachable at the floor. The ceiling is a quarter of
		// Tiger Power's 20s: past it a press throws away more of the buff than it renews, and every clip
		// would be graded a refresh, emptying the "wasted" count the section exists to report.
		default: TP_REFRESH_WINDOW_MS,
		min: 1000,
		max: 5000,
		step: 250,
	},
	{
		key: 'cooldownLeewayMs',
		tKey: 'settings.ww.cooldown',
		// A global and a half, and the whole of a wait is forgiven rather than a slice off a longer one.
		// The floor is the one global this setting replaces — the press the player was already committed
		// to when the button returned — and the ceiling is a quarter of Rising Sun Kick's 8s, the
		// shortest cooldown in the audited set, because each wait is forgiven in full and separately.
		default: 1500,
		min: 1000,
		max: 2000,
		step: 250,
	},
];

/**
 * The secondary each swappable consumable puts on top of the sheet, which is what the Rune reads.
 *
 * Rune of Re-Origination converts the two lowest secondaries into twice the highest, so the stat a
 * proc returns is decided entirely by which of these was live when it fired. The three elixirs are
 * +750 of one rating apiece — items 76076, 76078 and 76083 in the simulator's
 * `assets/database/db.json`, at stat indices 6, 7 and 11, which `proto/common.proto` names
 * `StatCritRating`, `StatHasteRating` and `StatMasteryRating`. The flask is agility only and lifts
 * no secondary at all, which is why its stat is `null` rather than a fourth name: it can close a
 * weave but never open one.
 *
 * Monk's Elixir being *mastery* rather than agility is the fact this whole reading turns on. It is
 * the one a weave drops, so the swap has to come after the brew or it lowers the number the brew is
 * about to freeze.
 */
const ELIXIR_STATS: Array<[Ability, string | null]> = [
	[registry.ability('flask-of-spring-blossoms'), null],
	[registry.ability('mad-hozen-elixir'), 'Crit'],
	[registry.ability('elixir-of-the-rapids'), 'Haste'],
	[registry.ability('monks-elixir'), 'Mastery'],
];

/**
 * How far *before* the brew an elixir may stamp and still count as pressed with it.
 *
 * Not a reaction allowance — the opposite of one. A swap made genuinely before the brew lowers the
 * mastery the brew is about to freeze, so it is a real dilution and has to stay chargeable; widening
 * this would forgive the mistake the ordering test exists to catch. All it absorbs is the log's own
 * stamp granularity for a single composite press, and that is measured rather than guessed: on
 * `weave.json` the bank drain and the brew's `applybuff` land 0-1ms apart across all five brews, and
 * the elixir lands exactly 1ms after the drain on all three swaps. One millisecond is the entire
 * observed spread, so one millisecond is the entire allowance.
 */
const WEAVE_ORDER_SLACK_MS = 1;

/** Chi Brew: two charges, forty-five seconds each, from `sim/monk/talents.go:741-742`. */
const CHI_BREW_CHARGES = 2;
/** And two chi a press, from the same file's `monk.AddChi(sim, spell, 2, chiMetrics)`. */
const CHI_BREW_CHI_PER_USE = 2;
const CHI_BREW_RECHARGE_MS = 45_000;

/**
 * What Chi Brew returned, and what it left on the table.
 *
 * Two different kinds of waste, and the section keeps them apart because the fixes are opposite.
 * *Overcapped chi* is a press made with a full-ish bar — the button returns two and the bar had room
 * for one — and the log states it outright: Chi Brew's chi arrives as a `resourcechange` carrying
 * both the amount and the `waste`, so nothing is inferred. *Charges sitting at the ceiling* is the
 * opposite mistake, the button not being pressed at all: a charge that is already full is not
 * recharging, so every second at two of two is forty-five seconds of cooldown that will never be
 * spent.
 *
 * The charge walk is the standard one: dropping below the ceiling starts a timer, each completion
 * returns a charge and restarts the timer while there is still room. Time at the ceiling is
 * accumulated between the moment the last charge came back and the next press.
 */
function chiBrewAudit(
	events: readonly WclEvent[],
	actorID: number,
	// Every audit in this file takes the pull's start stamp in the same third position; this one works
	// entirely in the fight-relative stamps its callers already converted, so it never reads it.
	// Underscored rather than removed to keep the audits callable the same way.
	_t0: number,
	casts: readonly number[],
	durationMs: number,
	contact: readonly Interval[],
): Omit<ChiBrewAudit, 'talented'> {
	let gained = 0;
	let wasted = 0;
	for (const e of events) {
		if (!isResourceChange(e)) continue;
		const side = resourceActorOf(e);
		const owner = side === 1 ? e.sourceID : side === 2 ? e.targetID : undefined;
		if (owner !== actorID) continue;
		if (abilityIdOf(e) !== CHI_BREW_ID) continue;
		gained += e.resourceChange ?? 0;
		wasted += e.waste ?? 0;
	}

	let charges = CHI_BREW_CHARGES;
	let timer: number | null = null;

	// The same walk, recorded as it goes, so the chart draws the counter this audit reasoned about
	// rather than a second reconstruction of it that could disagree with the number printed beside it.
	const points: Array<[number, number]> = [[0, CHI_BREW_CHARGES]];
	const mark = (at: number): void => {
		const last = points[points.length - 1];
		// One point per *change*: a counter that holds two for a minute is one step, not a hundred.
		if (last !== undefined && last[1] === charges) return;
		points.push([at, charges]);
	};

	const advance = (to: number): void => {
		while (timer !== null && timer <= to) {
			// The moment this charge actually landed, which is when the ceiling starts being wasted — not
			// `to`, which is only where the walk happens to be looking. Taking `to` here charged the pull
			// nothing for the gap between a charge coming back and the next press, which is exactly the
			// gap this audit exists to measure.
			const landed = timer;
			charges += 1;
			timer = charges < CHI_BREW_CHARGES ? landed + CHI_BREW_RECHARGE_MS : null;
			mark(landed);
		}
	};

	for (const at of [...casts].sort((a, b) => a - b)) {
		advance(at);
		if (charges > 0) {
			charges -= 1;
			if (timer === null) timer = at + CHI_BREW_RECHARGE_MS;
			mark(at);
		}
	}
	advance(durationMs);

	/**
	 * The stretches the counter sat at its ceiling, derived from the series above rather than tracked
	 * inside the walk.
	 *
	 * This used to be a `fullSince`/`closeCap` pair threaded through the simulation, which made it the
	 * fourth hand-written answer to "when was this counter full" in the codebase. It comes off
	 * `atCapWindows` now, over the very series the chart draws — so the band, the figure and the picture
	 * cannot disagree, because there is only one of them. `stretchesFromPoints` is safe here and not on
	 * an aura's levels: a charge counter always holds *some* level, so the series has no gaps for a
	 * stretch to run across.
	 *
	 * Only the *windows* are kept. The raw millisecond total was dead before this change too — the
	 * section publishes `Math.round(idleMs)`, the contact-cut figure below — but it was a `let` with a
	 * `+=`, which the linter tolerates, so nothing said so. Deriving it as a `const` made the deadness
	 * visible, which is the honest state: there is one at-ceiling number and it is the one a reader
	 * could have acted on.
	 */
	const cappedWindows = atCapWindows(stretchesFromPoints(points, durationMs), CHI_BREW_CHARGES);

	/**
	 * The same idle stretches, cut back to the time the player had something to hit.
	 *
	 * The walk above runs on the pull's own clock and has to: charges come back during an intermission
	 * whether or not anybody is there to spend them, and the counter this draws is a description of the
	 * pull rather than a judgement of it. What is a judgement is the time at the ceiling, and "both
	 * charges sat full while you had nothing to hit" is not a mistake anybody made — it is the fight
	 * standing between the player and the button.
	 *
	 * So the fault is clipped and the description is not. Clipping the *windows* rather than the total
	 * keeps the chart drawing exactly what the number counts; totalling one and shading the other is how
	 * a figure and the picture under it come to disagree.
	 */
	const idleWindows = mergeIntervals(intersect(toIntervals(cappedWindows), [...contact]));
	const idleMs = unionMs(idleWindows);
	// The clock every ceiling and share below is measured against: the time there was a choice to make.
	const contactMs = unionMs([...contact]);

	return {
		casts: casts.length,
		charges: points,
		cappedWindows: idleWindows.map(([start, end]): Window => ({ start, end })),
		maxCharges: CHI_BREW_CHARGES,
		chiGained: gained,
		chiWasted: wasted,
		cappedMs: Math.round(idleMs),
		cappedPct: contactMs > 0 ? (idleMs / contactMs) * 100 : 0,
		// What that idle time was worth, in the unit the button actually pays out.
		//
		// Fractional on purpose, and reported to one decimal. Seconds at the ceiling do not convert to
		// whole presses — 20 seconds of a 45-second recharge is not "half a Chi Brew you could have
		// pressed", it is the share of a recharge that never ran. Rounding it up to a whole press would
		// claim the pull had room for a use it did not, and rounding down to zero would hide the fault
		// entirely on any pull that idled less than a full recharge.
		chiLostToIdle: (idleMs / CHI_BREW_RECHARGE_MS) * CHI_BREW_CHI_PER_USE,
		// Contact time and not the pull's length, for the reason the debuff's cast ceiling gives: a
		// ceiling built on minutes the player could not act in sets a target the fight made impossible.
		// On the Galakras kill in `a:6MhZgjyAknFWrYfK` that is 117 seconds of a 434-second pull, worth
		// two and a half recharges of a ceiling nobody could have reached.
		possibleUses: Math.floor(contactMs / CHI_BREW_RECHARGE_MS) + CHI_BREW_CHARGES,
	};
}

/**
 * How long after a Touch of Karma its redirect can still be landing.
 *
 * Not the ten seconds the tooltip advertises. Measured against a real pull, the redirect ticks once
 * a second from about 2.8s after the cast through to 11.8s — the aura goes up a moment after the
 * press and the ticks run on from there — so a flat ten-second window silently dropped the last two
 * ticks and under-reported the use by a fifth. Generous on purpose: ticks are attributed to the most
 * recent cast before them, so a wide bound cannot steal damage from a neighbouring use, while a
 * tight one loses damage outright.
 *
 * The mechanism behind that overrun, since it is what makes the width safe rather than lucky: 124280
 * is a six-second periodic effect that each absorbed hit *refreshes*, so the ticks run six seconds
 * past the last blow the redirect ate rather than stopping with the ten-second aura.
 *
 * The *cap* on what it redirects is a full health pool, and that pool is computed from the player's
 * stamina rather than read off a health bar — see `karmaCap` in `analyse`, which carries the
 * derivation and the measurement. What is worth not re-deriving: a pool estimated from absolute
 * damage against a *percentage* bar — `maxHitPoints` is 100 on all 1,902 player-describing events of
 * one pull, while NPCs in the same report carry absolute values — is only good to about ±10%, and
 * against one such estimate the Garrosh use read 107% of its own ceiling.
 */
export const KARMA_WINDOW_MS = 20000;

/**
 * How close to its ceiling a use has to come to be called drained.
 *
 * A use that drains its pool absorbs exactly one pool, so the honest test is equality — and the
 * slack is here because the *ceiling* carries about a percent of error rather than because the
 * absorb does. Stacked health buffs each snapshot their bonus off the pool as it stood when they
 * landed (`OnGain: bonusHealth = MaxHealth() * modifier`, `sim/monk/fortifying_brew.go:25`), so a
 * press under two of them sits a shade above the product `karmaCap` multiplies out. Measured across
 * sixty ranked Mists Classic Siege pulls: 81 uses that absorbed anything, the two highest reading
 * 101.3% and 101.6% of the product and everything else at or under it, with 27 landing inside this
 * band. One percent is the width of that error, not a tolerance picked to make a number look round.
 */
const KARMA_DRAINED_SHARE = 0.99;

/**
 * How close two differently-identified presses of one ability have to be to be the same press.
 *
 * Measured rather than picked: Spear Hand Strike's interrupt and silence are separate spells that fire
 * on one press, and they land 2ms apart on the reference pull. Twenty times that is still a fiftieth
 * of a global, so it cannot swallow a real second press.
 */
const SAME_PRESS_MS = 50;

/** A proc window this close to the full duration ran out instead of being spent. */
export const CB_EXPIRY_SLACK_MS = 500;

/** A gap this long in damage to the primary target means it went untargetable. */
export const ENGAGED_GAP_MS = 15000;
/**
 * The shortest stretch at the energy cap worth naming a timestamp for.
 *
 * One Windwalker global. Below that there was no press to have made, so a row saying "you were full
 * for 0.4s at 2:13" describes the sampling grid rather than a decision — and a table of forty of
 * them would hide the three stretches that actually cost casts. The total is unaffected: this filters
 * what is listed, never what is counted.
 *
 * Now the engine's own `CAP_ROW_MS` in `lib/analysis/energy.ts`, where the pool audit lives — this
 * spec reads the engine's `worst` list instead of rebuilding it.
 */

// -------------------------------------------------------------------- engine
//
// The spec's half of the engine, beside `lib/analysis/analyseCore.ts`: that file computes everything
// any spec's log shares and hands it to this module as a `Handles`; this module answers with
// `SpecAuditResult`. The two halves merge back into an `Analysis` inside `analyseCore`.

/** The Windwalker's claim to a game — the config that drives the generic core. */
export const WW_SPEC: SpecConfig = {
	specName: 'Windwalker',
	registry,
	gcdMs: GCD_MS,
	extraNames: EXTRA_NAMES,
	extraGlobals: EXTRA_GLOBALS,
	// The two bars the rotation spends, named by the sim's own vocabulary and audited by the engine:
	// energy is a pool that refills on a clock and wastes by the second, chi arrives in whole points
	// from a press and wastes by the point. The generators are the model's own buttons, so the config
	// and the cast table cannot disagree about what returns chi. Chi Brew is not listed: it reports
	// its own return as a `resourcechange`, which the walk applies and credits once.
	resources: {
		energy: { type: RESOURCE_TYPE.energy, kind: 'pool' },
		chi: {
			type: RESOURCE_TYPE.chi,
			kind: 'points',
			gains: [
				{ abilityKey: 'jab', amount: 2 },
				{ abilityKey: 'spinning-crane-kick', amount: 1 },
				// Three or more, per wowsims' `registerRushingJadeWind`. See `ResourceConfig.gains.minTargets`.
				// The gain is declared even though this log reports it — `reportedAs` makes the walk take the
				// log's word wherever it is given and fall back to this only where it is not.
				{ abilityKey: 'rushing-jade-wind', amount: 1, minTargets: 3, reportedAs: RJW_CHI_ID },
			],
		},
	},
	// The Windwalker's report draws in the Monk's own colour — wowsims-mop's `Monk.hexColor` — so it
	// is recognisable as a monk's report before a word is read.
	colors: { primary: CLASS_COLOR.monk },
	thresholds: {
		targetWindowMs: TARGET_WINDOW_MS,
		multiTargetSharePct: MULTI_TARGET_SHARE_PCT,
		singleTargetSharePct: SINGLE_TARGET_SHARE_PCT,
		engagedGapMs: ENGAGED_GAP_MS,
	},
	ignoredMultiTargetActors: ignoredMultiTargetActorIDs,
	needsTarget: NEEDS_TARGET,
	samePressMs: SAME_PRESS_MS,
	potion: {
		abilityKey: POTION_CAST.key,
		auraKey: POTION.key,
		slots: POTION_SLOTS,
		categoryCooldownMs: POTION_CATEGORY_CD_MS,
	},
	aplTargetCountExclude: ['rushing-jade-wind'],
	/**
	 * Whether this player was actually a Windwalker.
	 *
	 * Classic logs report combatantinfo.specID as 0 and talentTree as empty, so the spec has to be
	 * inferred. Tigereye Brew is Windwalker-only, which makes its bank aura the reliable tell: a
	 * Brewmaster or Mistweaver produces none of it. Without this guard the analysis still "succeeds"
	 * and reports nonsense — one Brewmaster came out at 0% Rising Sun Kick uptime with 59 of 61 Tiger
	 * Palms wasted, which is simply what a tank's rotation looks like through a Windwalker lens.
	 *
	 * Deliberately a second pass over the same events the audit itself makes: the bank the audit needs
	 * is the *audit's* to build, and two `trackStackBank` walks of a hundred thousand events cost less
	 * than the plumbing to share one.
	 */
	identify: (h) => trackStackBank(h.events, BREW_BANK, h.actor.id, h.t0).timeline.length > 0,
	audit: windwalkerAudit,
	settings: WW_SETTINGS,
};

/** The full analysis of one fight for one Windwalker. */
export function analyse(dataset: FightDataset, settings: AnalysisSettings = defaultSettings(WW_SETTINGS)): Analysis {
	return analyseCore(dataset, settings, WW_SPEC);
}

/**
 * The Windwalker's half of the analysis, from the engine's `Handles` and nothing else.
 *
 * The core has already assembled the press marks, both resource bars' samples, the contact and
 * engaged clocks, the primary target and the damage table; everything here is what only a Windwalker
 * model can say about them. Sections are in the same order they have always been read in.
 */
export function windwalkerAudit(h: Handles): SpecAuditResult {
	const {
		fight,
		actor,
		events,
		actors,
		t0,
		duration,
		nameOf,
		link,
		selfEvents,
		castTimes,
		castBeginTimes,
		castPresses,
		castCount,
		channels,
		damageEvents,
		eventTotal,
		gear,
		primaryID,
		primaryName,
		primaryDamageShare,
		singleTarget,
		engaged,
		engagedMs,
		contact,
		inContactMs,
		landedHits,
		multiTargetWindows,
		aplTargetCountAt,
		triggerTargetCountAt,
		resourceAudits,
		lostCasts,
		marks,
		potionWindows,
		hasteWindows,
		berserkingWindows,
		settings,
	} = h;
	const { snapshotLeewayMs, cooldownLeewayMs } = settings;
	// The bars this spec declared, fully audited by the core. The config's keys are what say which bars
	// exist and the core always fills every one it declared, so both reads below are guaranteed — but
	// `kind` still has to narrow, because the audits are one record holding two shapes and the fields
	// each half of this audit reads are the other half's.
	const energyAudit = resourceAudits.energy;
	const chiAudit = resourceAudits.chi;
	if (energyAudit?.kind !== 'pool' || chiAudit?.kind !== 'points') {
		throw new Error('Windwalker audit: the declared energy or chi bar is missing or mis-configured');
	}

	// ---------------------------------------------------------- Tigereye Brew
	const bank = trackStackBank(events, BREW_BANK, actor.id, t0);

	const brewWindows = auraWindows(selfEvents, BREW, t0, fight.endTime);
	const uses: BrewUse[] = pairDrainsToWindows(bank.drains, brewWindows).filter((d) => d.window !== null);
	const totalConsumed = uses.reduce((s, u) => s + u.consumed, 0);

	// ---------------------------------------------------------- Re-Origination
	// Each window carries the id that opened it, which is what says which stat came back.
	const rawProcs = auraWindows(selfEvents, RE_ORIGINATION, t0, fight.endTime);
	const statOf = (index: number): string => rawProcs[index]?.variant ?? RE_ORIGINATION.name;

	const procs: ProcWindow[] = rawProcs.map((w, i) => ({
		...w,
		spellID: w.id,
		stat: statOf(i),
		lengthMs: w.end - w.start,
		// Filled in below, once the brew bank is known.
		stacksAvailable: 0,
		couldSnapshot: false,
		// A proc that grants the same stat as the one before it changes nothing you were not already
		// holding — worth flagging, because a "missed" repeat is far cheaper than a missed switch.
		sameAsPrevious: i > 0 && statOf(i - 1) === statOf(i),
		snapshotAt: null,
		snapshotEnd: null,
		snapshotStacks: null,
		brewEnd: null,
		remainingMs: null,
		depthPct: null,
		grade: 'none' as SnapshotGrade,
		brewAlreadyUp: false,
		heldStat: null,
		redundant: false,
		brewCastInside: 0,
		stacksInside: 0,
		gapToNextMs: null,
		overlaps: [],
		devaluedMs: 0,
		wastedMs: 0,
		backToBack: false,
		backToBackWasted: false,
		b2bRole: null,
		b2bWaste: false,
		b2bWith: [],
		nextStat: null,
		// Filled in below, once the brew uses are known.
		missedByMs: null,
		// Null rather than 0 on a proc no brew was spent on: there was no decision to price.
		earlyCostStackSec: null,
		holdCostStackSec: null,
		holdStacksLost: null,
		protectedBrew: false,
	}));

	for (const w of procs) {
		// A brew that landed just after the proc expired is a different mistake from never brewing at
		// all: the player read the proc and moved, and their latency or their hand cost them the
		// snapshot. Judged against the reader's own leeway — the same number that decides how late a
		// brew can be and still count as the final global — because it is the same slop, on the other
		// side of the boundary.
		const justAfter = uses.find((u) => u.t > w.end && u.t - w.end <= snapshotLeewayMs);
		w.missedByMs = justAfter ? justAfter.t - w.end : null;

		const inside = uses.filter((u) => u.t >= w.start && u.t <= w.end);
		// The last brew inside the proc is the one whose 15s carries furthest past it.
		const snap = inside[inside.length - 1] ?? null;
		w.brewCastInside = inside.length;
		w.stacksInside = inside.reduce((s, u) => s + u.consumed, 0);
		if (snap) {
			const remaining = w.end - snap.t;
			w.snapshotAt = snap.t;
			w.snapshotStacks = snap.consumed;
			// Seconds of proc still on the clock when the brew went out — lower is better, 0 is ideal.
			w.remainingMs = remaining;
			w.depthPct = ((snap.t - w.start) / w.lengthMs) * 100;
			w.grade = remaining <= snapshotLeewayMs ? 'last-gcd' : remaining <= LATE_MS ? 'late' : 'early';

			// What each way of playing this proc actually cost.
			//
			// The grade above is the whole story only while the bank has room. When it does not, the two
			// available moves punish each other: hold for the last global and the bank keeps filling into
			// its cap, brew early to make room and the snapshot reads as sloppy. Both costs are
			// measurable, so both get measured, in one currency — stack-seconds, meaning one Tigereye
			// Brew stack amplifying for one second. `damagePerStack` multiplies both sides identically,
			// so it cancels out of the comparison and is needed only to state a cost as damage.
			//
			// Brewing early costs the tail. The bonus is frozen at cast over a fixed 15s window
			// (`sim/monk/windwalker/tigereye_brew.go`, `Duration: time.Second * 15`, with
			// `damagePerStack` read once in `OnGain`), so a brew cast with `remaining` still on the
			// proc's clock spends that much of its window alongside stats the player already had rather
			// than carrying them past the proc.
			w.earlyCostStackSec = r1((remaining / 1000) * snap.consumed);
			// Holding costs whatever the bank would have overflowed while waiting. Replayed from
			// `snap.before` — the level the bank carried *into* the drain, which is exactly what a player
			// who did not brew would have been sitting on.
			w.holdStacksLost = overflowIfHeld(bank.timeline, snap.before, snap.t, w.end, TEB_CAP);
			// Each stack the cap refuses would have amplified a later brew for that brew's whole 15
			// seconds. That equivalence is what makes the two sides comparable at all.
			w.holdCostStackSec = r1(w.holdStacksLost * (TEB_ACTIVE_MS / 1000));
			// Ties go to the player: a decision the arithmetic calls level is not a fault worth naming.
			//
			// Only `early` is tested, because only `early` is charged anywhere — a `late` brew is
			// described but never listed as a miss, and a `last-gcd` brew gave nothing up to protect
			// anything with.
			w.protectedBrew = w.grade === 'early' && w.earlyCostStackSec > 0 && w.holdCostStackSec >= w.earlyCostStackSec;
		} else {
			// A brew already running when the proc landed benefits from it but was not aimed at it.
			w.brewAlreadyUp = brewWindows.some((b) => b.start < w.end && b.end > w.start);
		}
	}

	// Not every unsnapshotted proc costs anything. If the brew that was already running had itself
	// snapshotted a proc of the *same* stat, the player is already holding exactly those stats and
	// re-brewing would capture nothing new — that is redundant, not a miss. A different stat is a real
	// loss, because the running brew is holding the wrong conversion.
	// Which window a drain opened is already known — `pairDrainsToWindows` decided it — so it is read
	// back rather than re-derived by comparing timestamps. `snapshotAt` is the bank-drain stamp and
	// lands ~1 ms *before* the brew's own `applybuff`, so `snapshotAt >= brew.start` never matches the
	// window that drain actually opened. That is the same trap the back-to-back walk below documents;
	// this loop was falling into it.
	const windowByDrain = new Map(uses.map((u) => [u.t, u.window]));

	for (const w of procs) {
		if (w.snapshotAt !== null || !w.brewAlreadyUp) continue;
		const brew = brewWindows.find((b) => b.start < w.end && b.end > w.start);
		if (!brew) continue;
		const heldBy = procs.find((p) => p.snapshotAt !== null && windowByDrain.get(p.snapshotAt) === brew);
		w.heldStat = heldBy?.stat ?? null;
		w.redundant = !!heldBy && heldBy.stat === w.stat;
	}

	/**
	 * The proc that was skipped on purpose, which the two paragraphs above cannot tell from a fumble.
	 *
	 * `redundant` forgives a proc that returned the stat the running brew is already holding. Its
	 * mirror image is the case that mattered more and was being charged as a fault: a proc that
	 * returned a *different* stat because the player made it do so. Tigereye Brew freezes
	 * `0.05 + masteryPercent` at cast and never re-reads it, so a brew held to the end of a Mastery
	 * proc carries that mastery for its own fifteen seconds; swapping to a secondary-lifting battle
	 * elixir straight afterwards puts a different secondary on top of the sheet, and the Rune's next
	 * conversion returns *that* instead of re-serving mastery the brew already has frozen in. A
	 * second brew during it would capture base mastery and nothing else. There is no snapshot to
	 * miss, so this is not a missed snapshot — it is the play `snapshots.oneStat` tells the reader to
	 * make.
	 *
	 * **The elixir has to come after the brew, and that ordering is mechanical rather than stylistic.**
	 * Monk's Elixir is +750 *mastery* — item 76083 in the simulator's `assets/database/db.json`, stat
	 * index 11, `StatMasteryRating` in `proto/common.proto` — so it is usually the live consumable a
	 * weave drops. Dropping it before the brew lowers the very number the brew is about to freeze.
	 * After the brew it cannot: the multiplier is already closed over in `OnGain`.
	 *
	 * The rule is checked against the log rather than assumed: on `weave.json` the battle elixir live
	 * at each proc's start predicts that proc's converted stat five times out of five — flask then
	 * Monk's (mastery) for the four Mastery procs, Elixir of the Rapids (haste) for the one Haste
	 * proc. Nothing here rests on a timing threshold; the one tolerance is `WEAVE_ORDER_SLACK_MS`,
	 * and it exists only to absorb the log's stamp granularity.
	 *
	 * False positives forgive a real miss on the report's heaviest metric, so every clause is a
	 * conjunction and the doubtful case stays charged.
	 */
	const battleElixirs = ELIXIR_STATS.flatMap(([ability, stat]) => castTimes(ability).map((t) => ({ t, stat }))).sort(
		(a, b) => a.t - b.t,
	);
	/**
	 * Which consumable was live at an instant: the last one pressed, because they cancel each other.
	 *
	 * A flask and a battle elixir share the `FlaskVsBattleElixir` exclusive category and
	 * `sim/core/consumes.go` deactivates whichever is running when the other goes up, so "live" is
	 * simply "most recent press" and needs no duration. Virmen's Bite is deliberately not in the
	 * list: a combat potion is its own category and cancels nothing.
	 */
	const elixirAt = (t: number): { t: number; stat: string | null } | null => {
		let live: { t: number; stat: string | null } | null = null;
		for (const e of battleElixirs) {
			if (e.t > t) break;
			live = e;
		}
		return live;
	};

	for (const w of procs) {
		// A proc someone did brew on is a decision of a different kind and is graded as one; a proc with
		// no brew running has nothing being protected and is an ordinary miss.
		if (w.snapshotAt !== null || !w.brewAlreadyUp) continue;
		if (w.heldStat === null || w.heldStat === w.stat) continue;
		const live = elixirAt(w.start);
		// The elixir has to explain this proc, not merely precede it: the stat it lifts must be the
		// stat the Rune returned. The flask lifts no secondary at all and so can never satisfy this.
		if (live === null || live.stat !== w.stat) continue;
		const brew = brewWindows.find((b) => b.start < w.end && b.end > w.start);
		if (!brew || live.t < brew.start - WEAVE_ORDER_SLACK_MS) continue;
		w.weaved = true;
	}

	/**
	 * The wider fact the weave is one cause of: the Rune returned a stat the brew cannot hold.
	 *
	 * Tigereye Brew freezes `0.05 + masteryPercent` at cast and re-reads nothing, so a proc that came
	 * back crit or haste offers a brew no mastery to carry — the elixir that caused it is why it
	 * happened, not whether it counts. Set for every unsnapshotted non-mastery proc, engineered or not.
	 *
	 * Gated on `snapshotAt === null` deliberately. A player who *did* brew on a crit proc spent a brew
	 * on base mastery, which is a real mistake of a different kind — forgiving it here would hide it,
	 * and it is not what this flag is about.
	 */
	for (const w of procs) {
		if (w.snapshotAt === null && w.stat !== 'Mastery') w.unholdable = true;
	}

	// Back-to-back procs are the unlucky roll. You hold the brew to the end of a proc, snapshot it, and
	// the Rune immediately fires again — so for those seconds you would have had those stats live
	// anyway, and the snapshot you paid 10 stacks for is worth only its margin over a proc you were
	// getting for free. Measured as the overlap between the later procs and the brew this one
	// snapshotted; that overlap is exactly the devalued portion.
	procs.forEach((w, i) => {
		const next = procs[i + 1];
		w.gapToNextMs = next ? next.start - w.end : null;
		w.nextStat = next?.stat ?? null;

		const snapStart = w.snapshotAt;
		if (snapStart === null) return;
		// Take the window already paired with the drain rather than searching by timestamp: snapshotAt
		// is the bank-drain stamp, which lands ~1 ms before the brew's own applybuff, so a
		// `>= window.start` search misses its own window every time and silently reports zero
		// back-to-back procs.
		const brew = uses.find((u) => u.t === snapStart)?.window ?? null;
		w.brewEnd = brew?.end ?? null;
		if (!brew) return;

		const nextUse = uses.find((u) => u.t > snapStart);
		const snapEnd = snapshotWindowEnd(snapStart, brew, BREW, nextUse?.t ?? null);
		w.snapshotEnd = snapEnd;
		// A snapshot runs up to 15s and the Rune's internal cooldown is 10s, so one can still be
		// overlapped by more than one later proc. Walk forward until a proc starts after it has expired.
		for (let j = i + 1; j < procs.length; j++) {
			const p = procs[j];
			if (!p || p.start >= snapEnd) break;
			const ms = Math.min(snapEnd, p.end) - Math.max(snapStart, p.start);
			if (ms > 0) w.overlaps.push({ index: j, stat: p.stat, ms });
		}
		w.devaluedMs = w.overlaps.reduce((s, o) => s + o.ms, 0);
		// Whether an overlap wastes anything depends entirely on the stat. Another Mastery proc on top
		// of a snapshotted Mastery brew hands back what is already frozen in; a proc that returns a
		// *different* stat stacks something new on top. That is what elixir weaving buys — swapping the
		// Agility elixir for a Haste one makes Haste the highest secondary, so the next proc converts
		// into Haste (energy regen) instead of re-serving the Mastery already frozen into the brew.
		w.wastedMs = w.overlaps.filter((o) => o.stat === w.stat).reduce((s, o) => s + o.ms, 0);
		w.backToBack = w.overlaps.length > 0;
		w.backToBackWasted = w.wastedMs > 0;
	});

	// A back-to-back is a relationship, so both halves belong to it: the proc whose snapshot was
	// overlapped *and* every proc that overlapped it. Marking only the source leaves single-row bands
	// in the report for what is by definition a two-or-more-row event.
	procs.forEach((w, i) => {
		if (!w.backToBack) return;
		w.b2bRole = 'source';
		w.b2bWaste ||= w.backToBackWasted;
		for (const o of w.overlaps) {
			const p = procs[o.index];
			if (!p) continue;
			p.b2bRole ??= 'follow-up';
			p.overlapOfMs = o.ms;
			p.overlapOfIndex = i;
			p.b2bWaste ||= o.stat === w.stat;
			w.b2bWith.push(o.index);
		}
	});

	// The most the bank held at any point the proc was still running.
	//
	// It starts from the level carried in from before the window rather than from zero: the timeline
	// only records changes, so a proc that spans no change at all would otherwise read as an empty
	// bank when in fact it sat on a full one the whole time.
	const peakBankDuring = (start: number, end: number): number => {
		let carried = 0;
		let peak = 0;
		for (const [at, stacks] of bank.timeline) {
			if (at < start) {
				carried = stacks;
				continue;
			}
			if (at > end) break;
			peak = Math.max(peak, stacks);
		}
		return Math.max(peak, carried);
	};
	for (const w of procs) {
		w.stacksAvailable = peakBankDuring(w.start, w.end);
		// A proc the player actually brewed on was affordable by demonstration, whatever the floor
		// says — the rotation permits brewing below it, and excluding those produced catch rates above
		// 100% (a caught proc counted in the numerator and not the denominator).
		// A proc weaved past leaves the denominator for the same reason a proc below the floor does:
		// there was no snapshot on offer to buy. The floor says the bank could not pay for one; the
		// weave says the Rune did not return a stat Tigereye Brew can hold. Both are the absence of a
		// chance rather than a chance declined, and `snapshotRate` is the heaviest weight on the card —
		// so a proc that was never catchable must not sit in its denominator.
		w.couldSnapshot = w.snapshotAt !== null || (w.unholdable !== true && w.stacksAvailable > SNAPSHOT_STACK_FLOOR);
	}

	const opportunities = procs.filter((w) => w.couldSnapshot);
	const snapshotted = procs.filter((w) => w.snapshotAt !== null);
	const weaved = procs.filter((w) => w.weaved === true);
	const unholdable = procs.filter((w) => w.unholdable === true);
	// Every early snapshot throws away the proc's remainder; every proc never captured throws away its
	// whole window — unless it was redundant, which costs nothing. Same currency throughout: seconds of
	// Re-Origination-boosted brew not taken. A weaved proc is on neither side of that ledger: its
	// window was spent on live haste or crit exactly as intended, so counting it as time given away
	// would price a deliberate trade as a loss.
	const secondsGivenAway = r1(
		(snapshotted.reduce((s, w) => s + (w.remainingMs ?? 0), 0) +
			procs
				.filter((w) => w.snapshotAt === null && !w.redundant && w.unholdable !== true)
				.reduce((s, w) => s + w.lengthMs, 0)) /
			1000,
	);
	const devaluedSec = r1(procs.reduce((s, w) => s + w.wastedMs, 0) / 1000);

	/**
	 * Stacks lost at the cap that were the price of holding a brew for a proc.
	 *
	 * The other half of the comparison above, applied to the player who *did* hold. A stack refused by
	 * the cap while a proc was running and the brew had not yet gone out could only have been saved by
	 * brewing at that instant — which would have given up the rest of the proc's clock at the stacks
	 * the brew went out with. When that tail is worth more than the stack, the stack was correctly
	 * spent, and charging for it is the mirror image of charging an early brew for protecting the bank.
	 *
	 * Waste outside a proc is untouched, which is where a bank genuinely left to fill shows up: on the
	 * poor fixture the two stretches at the cap sit at 2:26–2:33 and 3:30–3:57, neither of them inside
	 * any proc, so all ten of its lost stacks stay charged.
	 *
	 * The counter-argument, written down rather than buried: a bank that reaches its cap during a proc
	 * usually got there through the preceding minute, and better management then would have made the
	 * whole dilemma disappear. That is true, and it is a decision this cannot see — which is why only
	 * the waste inside the proc window is forgiven and none of the waste before it is.
	 */
	const wastedProtecting = bank.wastedAt.filter((at) =>
		procs.some((w) => {
			if (w.snapshotAt === null || at < w.start || at > w.snapshotAt) return false;
			return ((w.end - at) / 1000) * (w.snapshotStacks ?? TEB_DRAIN) > TEB_ACTIVE_MS / 1000;
		}),
	).length;

	const statMix = procs.reduce<Record<string, number>>((acc, w) => {
		acc[w.stat] = (acc[w.stat] ?? 0) + 1;
		return acc;
	}, {});

	// ------------------------------------------------------------- debuff
	//
	// The primary target itself is the core's answer now — `h.primaryID` is whichever enemy the
	// report's own boss list and this player's damage agree on. Everything below reads the debuff off
	// that enemy's windows.
	/**
	 * The debuff, merged, once per **spawn** that carried it — and once per enemy for anything drawing.
	 *
	 * One pass over the events, bucketed, rather than a filtered pass per enemy: Spoils of Pandaria
	 * sprays it across thirty-odd adds, and a pass apiece is thirty passes over a hundred thousand
	 * events to answer one question.
	 *
	 * Keyed by `(targetID, targetInstance)` and not by `targetID`, because WarcraftLogs gives one actor
	 * id to an NPC *type*: every Kor'kron Ironblade on a Galakras pull shares one id, and bucketing by
	 * it alone hands `auraWindows` ten spawns' applies and removes interleaved into a single stream,
	 * where each remove closes whichever window is open and every apply arriving while one is already
	 * open is dropped. That is not a rounding error — on `a:6MhZgjyAknFWrYfK` #10 it discarded 17.4
	 * seconds of coverage.
	 *
	 * `openOnRefresh` is the second half of the same repair and the larger one: a refresh with nothing
	 * open is proof the debuff was up, and throwing it away cost another 42.3 seconds on that pull.
	 * Together they take its uptime from 61.8% to 80.6%, which an independently written script puts at
	 * 80.7%.
	 *
	 * Two maps out of one walk. The numerator asks about the spawn the player was hitting and must have
	 * the instance; every lane, the drop list and the intermission are *drawn* per enemy, where one row
	 * per Ironblade would be forty rows of the same add — so those get the union of a target's spawns,
	 * which is the honest reading of "this enemy had it" for a row labelled with one name.
	 */
	const { byInstance: rskByInstance, byTarget: rskByTarget } = (() => {
		const byInstance = new Map<string, Interval[]>();
		const debuffIDs = new Set(RSK_DEBUFF.ids);
		const buckets = new Map<string, { target: number; events: WclEvent[] }>();
		for (const e of events) {
			const id = abilityIdOf(e);
			if (id === null || !debuffIDs.has(id) || e.targetID === undefined) continue;
			const key = instanceKey(e.targetID, e.targetInstance);
			const bucket = buckets.get(key);
			if (bucket) bucket.events.push(e);
			else buckets.set(key, { target: e.targetID, events: [e] });
		}
		const perTarget = new Map<number, Interval[]>();
		for (const [key, bucket] of buckets) {
			const merged = mergeIntervals(
				toIntervals(auraWindows(bucket.events, RSK_DEBUFF, t0, fight.endTime, { openOnRefresh: true })),
			);
			byInstance.set(key, merged);
			perTarget.set(bucket.target, [...(perTarget.get(bucket.target) ?? []), ...merged]);
		}
		const byTarget = new Map<number, Interval[]>();
		for (const [target, all] of perTarget) byTarget.set(target, mergeIntervals(all));
		return { byInstance, byTarget };
	})();

	// Scoped to the primary target: this is the window model — the lane the timeline draws, the drops
	// the miss ledger lists, and the intermission. Read out of the map above rather than walked a
	// second time, so the lane a reader compares a number against is the array it was measured from.
	// The graded figure below is a different reading of these same windows and does not replace them.
	const rskMerged = (primaryID === undefined ? undefined : rskByTarget.get(primaryID)) ?? [];

	/**
	 * The debuff on the enemy the player was actually hitting, across the time they were hitting one.
	 *
	 * The reader's own rule: uptime counts as long as there is no downtime and a target to be hit in
	 * melee range. So the question is asked of one enemy at every moment — the one the most recent
	 * landed hit was on — and answered from that enemy's own windows.
	 *
	 * Clipped to `contact` rather than to the boss's `engaged`, and that is the whole of what makes the
	 * fraction describe one fight: the numerator already followed the player, so a denominator that only
	 * ran while the boss was reachable measured the numerator's minutes against somebody else's.
	 *
	 * Measured against a real 33-enemy pull, the three candidate definitions are not variations on a
	 * number, they are different numbers:
	 *
	 *     primary target only — what this used to ship      20.5% of engaged
	 *     the debuff up on any engaged enemy                71.2%
	 *     the debuff up on the enemy being hit              69.1%
	 *
	 * The first is what a player is told when a metric watches one enemy they left four minutes ago;
	 * engaged time on that pull was 456.1s of 464.8s in a single segment, so downtime was not what made
	 * it 20%. The second is the wrong question — it credits a debuff sitting on an add across the room
	 * while the player was hitting something else. This is the third.
	 *
	 * Ties inside one millisecond go to the last event in the stream. An area hit lands on every enemy
	 * at one timestamp, so which of them is "the" target is arbitrary there — but only for the sliver
	 * until the next hit, and it is the same 15s debuff on each of them.
	 */
	// Keyed by spawn, not by enemy: the question is whether the add being hit had the debuff, and on a
	// pull where forty spawns share one actor id, that enemy's *union* would credit the player for a
	// debuff sitting on an Ironblade they killed two minutes ago.
	const contactDebuffOn = new Map<string, Interval[]>();
	const debuffOn = (key: string): Interval[] => {
		const known = contactDebuffOn.get(key);
		if (known) return known;
		// Merged because `overlapMs` sums its ranges rather than unioning them, and clipped to contact
		// time here rather than per hit so an enemy carried through a long stretch is intersected once.
		const windows = mergeIntervals(intersect(rskByInstance.get(key) ?? [], contact));
		contactDebuffOn.set(key, windows);
		return windows;
	};
	/**
	 * The covered stretches themselves, and not only their total.
	 *
	 * Kept as intervals because the chart under the tiles has to draw this exact measurement: it used to
	 * draw the primary target's windows beside a number about every enemy, which put a picture and a
	 * figure describing two different fights in one section. Summing this array is what produces the
	 * figure, so the two cannot drift — the same reason the timeline's primary lane *is* the array the
	 * old number was measured from.
	 *
	 * `debuffOn` returns merged, ascending windows already clipped to contact time, so the inner loop
	 * can stop at the first window that starts after this hit's slice ends.
	 */
	const coveredParts: Interval[] = [];
	for (let i = 0; i < landedHits.length; i++) {
		const hit = landedHits[i];
		if (hit === undefined) continue;
		// Each hit owns the time until the next one — that is how long the player was demonstrably on
		// that enemy — and the last one owns the rest of the pull, which the intersection with contact
		// time clips back to nothing past the final window.
		const until = landedHits[i + 1]?.t ?? duration;
		for (const [start, end] of debuffOn(hit.key)) {
			if (start >= until) break;
			if (end > hit.t) coveredParts.push([Math.max(start, hit.t), Math.min(end, until)]);
		}
	}
	/** One quantity, two shapes: the union is the figure, the array is the picture. */
	const rskCovered = mergeIntervals(coveredParts);
	const rskContactMs = unionMs(rskCovered);

	/**
	 * The other half of that reading: contact time whose enemy was *not* carrying the debuff.
	 *
	 * Subtracted from the denominator rather than accumulated in a second pass, so the tile printed
	 * beside the uptime is its exact complement by construction — `uptimePct + lost/contact` is 100%
	 * because the two are one quantity split in two, not because two walks agreed.
	 *
	 * What this replaces was the primary target's dropped time, and on a fight with two bosses the two
	 * numbers were not describing the same thing at all: the Kor'kron Dark Shaman kill in
	 * `a:YBQzrcgVJnAj7NMP` printed 1.4s lost beside 59.0% uptime, because the one drop the boss suffered
	 * was all a primary-scoped reading could see while the player spent 98 seconds hitting the *other*
	 * boss without the debuff on it. The drops themselves are still the primary's — see `drops` below —
	 * but they are a list of that enemy's gaps, not this measurement's remainder.
	 *
	 * Never negative: the hit windows are disjoint and each one's debuffed overlap is bounded by its
	 * contact overlap, so the sum cannot exceed the union it was measured inside.
	 */
	const rskLostMs = inContactMs - rskContactMs;

	// The primary target's gaps, and the intermission: the same reading that has always been here, now
	// off the same windows the graded figure was measured from — and through `auraDrops`, which is where
	// both rules (drop the longest gap, ignore sub-`DROP_MS` jitter) now live for both specs.
	const { drops, intermissionMs: longestGap } = auraDrops(rskMerged, DROP_MS);

	// ----------------------------------------------------------------- energy
	// The bars were built by the core (`h.resourceAudits`), read straight off the `classResources`
	// snapshots the events query asks for and split by the contact windows it computed — a bar that
	// fills while there is nothing to hit is the fight's doing, and only the other half of the number
	// describes anything the player chose. Contact and not `engaged`, which is what this shipped with.
	// The split exists to separate the seconds the player could have spent energy in from the seconds
	// they could not, and the boss being away is not the same question: on the Galakras kill in
	// `a:6MhZgjyAknFWrYfK` the boss is reachable for 66.6s of a 434.2s pull while the player is
	// swinging at adds for 317.2s, so a boss-scoped split forgave every capped second of five minutes
	// of add waves as downtime nobody could act in.
	//
	// The chi walk is the audit's `walk`, not the sampled curve: the readings land only on spenders and
	// are a median 2.4 seconds apart, which is right for a chart — it draws what the log said — and
	// useless for judging a press. Chi Brew is excluded from the config's generators because it emits
	// a `resourcechange` carrying its own amount, which the walk applies and credits once.
	const talents = readTalents(events, actor.id);
	const chiBrew: ChiBrewAudit = {
		// A talent list the log did carry and Chi Brew is not on it is a real "not talented"; no list at
		// all is a report that cannot say, and must not be rendered as a choice the player made.
		talented: talents === null ? null : talents.has(CHI_BREW_ID),
		...chiBrewAudit(events, actor.id, t0, castTimes(CHI_BREW), duration, contact),
	};

	// ---------------------------------------------------------- Combo Breaker
	const comboBreaker = COMBO_BREAKERS.map((aura) => {
		const windows = auraWindows(selfEvents, aura, t0, fight.endTime);
		const full = aura.durationMs ?? COMBO_BREAKER_MS;
		const expired = windows.filter((w) => w.end - w.start >= full - CB_EXPIRY_SLACK_MS);
		// The label is the button the proc makes free, which is exactly what consumes it.
		const label = (aura.consumedBy ?? []).map((key) => registry.ability(key).name).join(', ') || aura.name;
		return {
			id: auraId(aura),
			label,
			procs: windows.length,
			wasted: expired.length,
			expired,
			// Both kept for the cast timeline, which draws a lane per proc and names it from the aura.
			// Carried out of here rather than re-derived down there: `auraWindows` is a pass over the whole
			// event stream, and two passes that must agree is exactly how a lane comes to disagree with the
			// count printed beside it.
			aura,
			windows,
		};
	});

	// ------------------------------------------------------------ Tiger Palm
	// Every Tiger Palm should be either a free Combo Breaker proc or a Tiger Power refresh. Anything
	// else clipped a healthy buff and burned a global that a Jab or Blackout Kick wanted. The buff
	// clock is read through `remainingAtCast`, which is blind to the refresh the press itself caused
	// — that refresh is stamped a millisecond *before* the cast, and reading it scored every press a
	// full 20s.
	const cbTigerPalmWindows = auraWindows(selfEvents, CB_TIGER_PALM, t0, fight.endTime);
	const tigerPowerTimeline = auraTimeline(selfEvents, TIGER_POWER, t0);
	// The buff's own windows, which the uptime figure and the timeline's Tiger Power lane both read.
	// The timeline is not allowed to disagree with the percentage printed above it, and computing it
	// twice is what would let it.
	const tigerPowerWindows = auraWindows(selfEvents, TIGER_POWER, t0, fight.endTime);

	// The commit, because every question in this map is about the **choice**: was there a Combo Breaker
	// proc up when the player pressed, and how much Tiger Power were they clipping when they decided to.
	// Both were true or false at the instant the finger went down, which `Handles`' ruling sends to
	// `castBeginTimes`. Nothing downstream joins on this instant — `TigerPalmTimeline` plots it, the miss
	// ledger links it, and the rest of the map is counted into `cpm.wastedGcds` — so unlike Blackout
	// Kick's below it is free to be the commit, and it matters that it is: `wastedGcds` reaches
	// `overall()`, and on the landing a press made inside a proc that expired mid-cast would be scored a
	// wasted global, which is a mistake the player did not make. Identical to the landing today, because
	// Tiger Palm is an instant; `castClocks.test.ts` is where the two come apart.
	const tigerPalmCasts = castBeginTimes(TIGER_PALM).map((t) => {
		const proc = inWindow(t, cbTigerPalmWindows);
		// The commit is also the cleaner instant for the self-refresh problem named above: that refresh
		// is stamped a millisecond before the `cast`, so on a press with a cast bar it lands *after* this
		// `t` and is excluded outright rather than by `remainingAtCast`'s 250 ms guard.
		const buffLeftMs = remainingAtCast(tigerPowerTimeline, t, TIGER_POWER);
		// Putting the buff up is not refreshing it, and the two were indistinguishable here: both read
		// zero remaining, so the opening Tiger Palm of a pull — and every one after the buff had
		// actually lapsed — was reported as a refresh, which is how a "refresh" turned up seven seconds
		// into a fight for a buff that lasts twenty. Both are justified presses, but only one of them
		// is a decision about timing, and the detail table has to be able to say which.
		const reason = proc
			? 'proc'
			: buffLeftMs <= 0
				? 'apply'
				: buffLeftMs <= settings.tigerPalmRefreshMs
					? 'refresh'
					: 'wasted';
		return { t, proc, buffLeftMs, reason: reason as 'proc' | 'apply' | 'refresh' | 'wasted' };
	});

	/**
	 * Globals spent on a press that bought nothing — the audit's contribution to the core's `cpm`.
	 *
	 * Globals used to count every on-GCD press alike, which made the report argue against itself: a
	 * Tiger Palm that clipped a healthy Tiger Power with no Combo Breaker up is flagged as a mistake
	 * one section down and was credited as a global well spent here. On the poor fixture that is 30
	 * presses — 11.9 points of utilisation, 90.2% with them and 78.3% without — so acting on the
	 * report's own advice made its headline number worse.
	 *
	 * This removes an undeserved credit rather than adding a second penalty. The correct play was never
	 * to press nothing: it was to press Jab or Blackout Kick instead, which occupies the same global
	 * and keeps the figure where it was. Only the presses that bought nothing come off.
	 *
	 * Tiger Palm is the only button this can be said of. Every other press on the list either costs
	 * chi, spends a proc or is on a cooldown, and "was that Blackout Kick worth its global" is not a
	 * question the log can answer.
	 */
	const wastedGcds = tigerPalmCasts.filter((c) => c.reason === 'wasted').length;

	// ------------------------------------------------------- Touch of Karma
	// A defensive that does damage: it redirects what the player takes onto the target for ten
	// seconds. What makes a use good or bad is therefore not when the cooldown came up but whether
	// anything was hitting them while it ran — a Karma pressed into a quiet stretch returns almost
	// nothing, and that is the only judgement here the log can actually support.
	const karmaCasts = castTimes(TOUCH_OF_KARMA);
	const karmaDamageIds = new Set(TOUCH_OF_KARMA.damageIds ?? []);
	const karmaDamage = damageEvents.filter((e) => karmaDamageIds.has(abilityIdOf(e) ?? -1));
	// Each tick belongs to the most recent press before it, rather than to a window measured forward
	// from every press. Forward windows overlap when two Karmas land inside one another's tails and
	// double-count the tick; this cannot, and it loses nothing to a tail that runs long.
	const karmaUses = karmaCasts.map((t) => ({ t, reflected: 0, absorbed: 0, exhausted: false, hits: 0 }));
	/** The use a moment belongs to: the most recent press before it, or none at all. */
	const karmaOwner = (at: number): (typeof karmaUses)[number] | undefined => {
		let owner: (typeof karmaUses)[number] | undefined;
		for (const use of karmaUses) {
			if (use.t <= at && at - use.t <= KARMA_WINDOW_MS) owner = use;
		}
		return owner;
	};
	for (const event of karmaDamage) {
		const owner = karmaOwner(event.timestamp - t0);
		if (owner === undefined) continue;
		owner.reflected += event.amount ?? 0;
		owner.hits += 1;
	}
	const karmaReflected = karmaUses.reduce((sum, u) => sum + u.reflected, 0);

	/**
	 * What each use *absorbed*, which is the quantity the cap actually constrains.
	 *
	 * `reflected` is not it. Measured across the three reference pulls, every one of the seven uses
	 * that took damage redirected exactly 1.05× what it absorbed — 805,148 absorbed against 845,405
	 * redirected on Garrosh, and the same ratio to five decimals on the other six. Whatever applies
	 * that extra twentieth lands on the damage dealt and not on the pool being drained, so dividing
	 * `reflected` by a health pool printed 105% of a ceiling the game says cannot be exceeded. That is
	 * the bug this replaces.
	 *
	 * Read from the `absorbed` *events*, which name the shield in `abilityGameID`, and never from the
	 * `absorbed` field on the damage taken: that field is every shield's total on one hit, and
	 * Malkorok hands the raid an absorb of its own, so on that pull it would credit Karma with what
	 * Ancient Barrier paid for.
	 */
	const karmaAbsorbIds = new Set(TOUCH_OF_KARMA.castIds ?? []);
	for (const absorb of events.filter(isAbsorbed)) {
		if (!karmaAbsorbIds.has(abilityIdOf(absorb) ?? -1) || absorb.targetID !== actor.id) continue;
		const owner = karmaOwner(absorb.timestamp - t0);
		if (owner === undefined) continue;
		owner.absorbed += absorb.amount ?? 0;
	}
	/**
	 * The health pool, computed rather than inferred from what the pull happened to demonstrate.
	 *
	 * The ceiling is a *full* pool, and `Spell.Description_lang` for 122470 in
	 * `tools/database/wowsims.db` is where that comes from — the simulator itself says nothing, since
	 * `sim/monk/` registers no spell, no aura and no APL entry for Touch of Karma, and the only trace
	 * of it anywhere in wowsims-mop is a glyph enum. The database: "All damage you take is redirected
	 * to the enemy target as Nature damage over $124280d instead of you. **Damage cannot exceed your
	 * total health.**"
	 *
	 * **The pool comes from stamina, because it is the only absolute health figure these logs carry.**
	 * A player's health *bar* is a percentage on a Mists Classic report — `maxHitPoints` is 100 on
	 * every player-describing event — but `combatantinfo` reports stamina in points, and
	 * `maxHealthFrom` turns it into health at the game's own rate. See that function for the citation.
	 *
	 * **Times whatever was raising maximum health when the press went out.** Three auras do, and all
	 * three are declared in `SHARED_AURAS` because none of them is the monk's to press except one:
	 * Ancestral Vigor (+10%), Fortifying Brew (+20%) and Rallying Cry (+20%). Read at the *cast*
	 * rather than across the redirect, because the shield's capacity is fixed when it goes up — a brew
	 * pressed halfway through does not refill it.
	 *
	 * **What replaced, and why.** This used to be the largest absorb on any use whose last absorb came
	 * up short of the blow behind it, on the reasoning that a shield paying less than it was asked for
	 * had run out. That test cannot tell a drained pool from a blow another shield ate part of —
	 * Divine Aegis, Spirit Shell, Guard, Malkorok's own Ancient Barrier — and the Malkorok reference
	 * pull `a:YBQzrcgVJnAj7NMP` #30 is the demonstration: all three uses flagged, reading 689,443 /
	 * 686,656 / 734,249 for one pool that never moved. Swept over sixty ranked Mists Classic Siege
	 * pulls the old flag fires on 38 uses, seven of which absorbed only 90-94% of the real pool, and
	 * misses two that genuinely drained.
	 *
	 * **And it is falsifiable, which the old measurement was not.** A use cannot absorb more than one
	 * pool, so the arithmetic can be checked against every use on every pull rather than only against
	 * the ones it was derived from: across those sixty pulls the highest of 81 uses reads 101.57% of
	 * prediction, only two clear 100.5% at all, and 27 land inside 99-100.5% — drained, onto the
	 * predicted number. Drained uses hit it to the unit: 742,145 absorbed against 146,403 + 14 × 42,553
	 * with no health buff up, 816,344 against the same base × 1.1 under Ancestral Vigor, 890,557
	 * against × 1.2 under Fortifying Brew.
	 *
	 * Null when the log reports no stamina, which is a legacy Mists report carrying no `combatantinfo`
	 * at all. The section then says it cannot state a pool, exactly as it did on a pull where nothing
	 * drained — that branch has not gone away, it has become rare instead of usual.
	 */
	const karmaCap = maxHealthFrom(gear.stamina);

	/**
	 * Whether Fortifying Brew was up while the redirect ran — reported, and deliberately not praised.
	 *
	 * The request behind this was "flag Touch of Karma used with Fortifying Brew, for the extra damage
	 * done". The simulator does not support that, and it is worth writing down why rather than
	 * quietly shipping the flag as a bonus:
	 *
	 *   - Touch of Karma is not in wowsims-mop at all. `sim/monk/` registers no spell, no aura and no
	 *     APL entry for 122470 — the only trace of it anywhere is the range glyph enum. So the sim can
	 *     neither confirm nor deny anything about what the redirect returns.
	 *   - Fortifying Brew, which *is* modelled (`sim/monk/fortifying_brew.go`), does two things at
	 *     once: `MaxHealth * 0.20` more health and `DamageTakenMultiplier *= 0.8`. Karma redirects the
	 *     damage you take, capped at a share of maximum health. Those pull opposite ways — the cap
	 *     goes up a fifth, and the thing that fills it comes in a fifth slower.
	 *
	 * So a use that would have hit its ceiling gains, and every use that would not — which is most of
	 * them, and this report cannot tell which is which because MoP Classic logs carry no health —
	 * simply redirects a fifth less. That is not a pairing to recommend, so the overlap is surfaced as
	 * a fact about the pull and the copy says what it is.
	 *
	 * Measured against `TOUCH_OF_KARMA_MS`, the redirect's real ten seconds, rather than the wide
	 * attribution window: a brew pressed after the redirect finished did not overlap it.
	 */
	const fortifyingWindows = auraWindows(selfEvents, FORTIFYING_BREW, t0, fight.endTime);
	const vigorWindows = auraWindows(selfEvents, ANCESTRAL_VIGOR, t0, fight.endTime);
	const rallyingWindows = auraWindows(selfEvents, RALLYING_CRY, t0, fight.endTime);
	/**
	 * The ceiling this particular press had, which is not the pull's pool whenever a health buff moved
	 * it. See `karmaCap` above for where the pool and the three multipliers come from.
	 *
	 * **At the cast and not across the redirect**, which is the one place this differs from the
	 * `fortifyingBrew` flag beside it. That flag answers "did the pairing happen", so it takes any
	 * overlap with the ten seconds; this answers "how big was the shield", and a shield's capacity is
	 * fixed when it goes up. A brew pressed halfway through the redirect does not refill it.
	 *
	 * **The absorb is a floor under the answer.** A shield cannot pay out more than it held, so a use
	 * that absorbed more than the arithmetic predicts has demonstrated a larger pool than the
	 * arithmetic knew about — a health buff applied a moment before the press and logged a moment
	 * after it, or two of them snapshotting off each other. Taking the larger is what stops `capPct`
	 * printing above 100% on the two uses in eighty-one that do this.
	 */
	const upAt = (windows: readonly { start: number; end: number }[], at: number): boolean =>
		windows.some((w) => w.start <= at && w.end >= at);
	const karmaWithFortifying = karmaUses.map((use) => {
		const pool =
			karmaCap === null
				? null
				: karmaCap *
					(upAt(vigorWindows, use.t) ? ANCESTRAL_VIGOR_HEALTH : 1) *
					(upAt(fortifyingWindows, use.t) ? FORTIFYING_BREW_HEALTH : 1) *
					(upAt(rallyingWindows, use.t) ? RALLYING_CRY_HEALTH : 1);
		// Rounded, because a health pool is a whole number of points and the multipliers are not: the
		// Garrosh reference use absorbs 805,148 against a raw 805,148.3, which would otherwise print as
		// 99.99996% of a ceiling it demonstrably reached.
		const cap = pool === null ? null : Math.max(Math.round(pool), use.absorbed);
		return {
			...use,
			cap,
			// Restated off the ceiling rather than off the last absorb's shortfall — see `karmaCap`.
			exhausted: cap !== null && cap > 0 && use.absorbed >= cap * KARMA_DRAINED_SHARE,
			fortifyingBrew: fortifyingWindows.some((w) => w.start <= use.t + TOUCH_OF_KARMA_MS && w.end >= use.t),
		};
	});

	// ------------------------------------------------------------ Invoke Xuen
	//
	// The sim presses it on cooldown and on nothing else, and that is the whole standard here.
	//
	// It is registered as a major cooldown — `sim/monk/talents.go:1080-1083`,
	// `monk.AddMajorCooldown(core.MajorCooldown{Spell: spell, Type: core.CooldownTypeDPS})` — and the
	// Windwalker APL never casts it by name. Its only action for it is the bare
	//
	//     { "action": { "autocastOtherCooldowns": {} } }
	//
	// in `ui/monk/windwalker/apls/default.apl.json`, which carries no `condition` key at all; the
	// machinery behind it (`sim/core/apl_actions_casting.go:491-511`) just fires the first ready major
	// cooldown. So unlike Fists of Fury or Energizing Brew there is no gate to grade a press against —
	// the cooldown *is* the condition, which is what `gate: 'cooldown'` on the ability already says.
	//
	// The APL does name `123904` twice, but in the opposite direction. Its "Cooldowns: On use" list
	// fires trinkets when
	//
	//     auraIsActive(2825) OR auraIsActive(123904) OR (spellTimeToReady(123904) + 25s > remainingTime)
	//
	// — the trinkets are held for Xuen, not Xuen for the trinkets. That is a rule about trinkets, and
	// charging a Xuen press with it would invent a condition the sim does not put on the button.
	const xuenTimes = castTimes(INVOKE_XUEN);
	// The drift row the cast table already shows, rather than a second `cooldownDrift` call: two
	// different "lost Xuen casts" figures in one report would be a bug whichever of them was right.
	const xuenDrift = lostCasts.find((row) => row.id === castId(INVOKE_XUEN)) ?? null;

	// Xuen's damage is already inside `damageEvents` — the core folded pet sources into the player's —
	// but telling which of it was the tiger's needs the actor rather than the ability, because its
	// autoattacks log under id 1 exactly like the monk's own swings. So the tiger's actor is whichever
	// non-player source dealt Crackling Tiger Lightning, an id nothing else in the kit produces.
	// Excluding the player's own id is not defensive noise: were that nuke ever attributed to the monk
	// directly, taking the id from it would sweep the entire pull's damage in as the pet's.
	const xuenActors = new Set(
		damageEvents
			.filter((e) => abilityIdOf(e) === XUEN_NUKE_ID)
			.map((e) => e.sourceID)
			.filter((id): id is number => id !== undefined && id !== actor.id),
	);
	const xuenDamageEvents = damageEvents.filter((e) => e.sourceID !== undefined && xuenActors.has(e.sourceID));
	const xuenPetDamage = xuenDamageEvents.reduce((sum, e) => sum + (e.amount ?? 0), 0);

	// Each summon runs 45s from the press and is clipped to the pull: a tiger sent in twenty seconds
	// before the boss died was out for twenty seconds, not forty-five, and counting the whole window
	// would claim more uptime than the fight had room for. The 180s cooldown is four times the 45s
	// window, so two of these can never overlap and no point of damage can fall inside two of them.
	const xuenUses = xuenTimes.map((t) => {
		const end = Math.min(t + XUEN_DURATION_MS, duration);
		const inside = xuenDamageEvents.filter((e) => {
			const at = e.timestamp - t0;
			return at >= t && at <= end;
		});
		return {
			t,
			windowMs: end - t,
			truncated: t + XUEN_DURATION_MS > duration,
			damage: inside.reduce((sum, e) => sum + (e.amount ?? 0), 0),
			hits: inside.length,
			link: link(t),
		};
	});
	const xuenUptimeMs = unionMs(xuenUses.map((use): Interval => [use.t, use.t + use.windowMs]));

	// ----------------------------------------------- Storm, Earth and Fire
	//
	// Two questions, and they are not the same question.
	//
	// Whether the button was worth pressing is about the *pull*: a spirit needs a second body to stand
	// on, and the target counts the core computed already say when there was one. Whether the presses
	// were spent well is about the *player*, and there is exactly one way to get it wrong once the
	// spirits are out — a spirit mirrors the monk onto its own target, so a monk stood on an enemy a
	// spirit is already handling has paid a global and a damage penalty for a clone that is duplicating
	// them. The sim will not even model that case: `CastCopySpell` skips any clone whose target equals
	// the owner's (`sim/monk/ww_storm_earth_and_fire.go`), so the copy the press bought does not happen.
	/**
	 * How many spirits were out, moment by moment — and read as a *level*, never as apply→remove.
	 *
	 * 137639 is a counter: its stack count is the spirit count, and a second spirit arrives as
	 * `applybuffstack stack: 2` carrying no second `applybuff`. `auraWindows` classes stack events as
	 * neither an apply nor a removal and drops them, which broke this section twice over on any pull
	 * where the aura ever stacked. Measured on a:YBQzrcgVJnAj7NMP fight 15 — a monk who placed a spirit
	 * before the pull, so the fight's first aura event is `applybuffstack stack: 2` at 6.1s:
	 *
	 *   the log:        stack 2 at 6.1s → stack 1 at 52.7s → removed at 2:43.3 → applied at 2:49.8
	 *   the pets:       one swinging from 2.6s to 2:41.3, a second from 6.2s to 50.6s, then one again
	 *   `auraWindows`:  a single window opening at 2:49.8 — 30.6% uptime, one spirit, the first two
	 *                   minutes and forty-three seconds absent, and the second spirit's whole 328
	 *                   events uncounted because `sefCloneActors` below only looks inside a window
	 *   `auraLevels`:  2 out from 6.1s, 1 from 52.7s, none from 2:43.3, 1 from 2:49.8 — which is what
	 *                   all three of the log's independent witnesses (the stack walk, the `summon`
	 *                   events naming each spirit's pet actor, and the pets' own swings) agree on
	 *
	 * `sefWindows` is the "at least one spirit was out" bar and stays the union it always was, so
	 * everything measured against it below is unchanged in meaning and only correct in extent.
	 */
	const sefLevels = auraLevels(selfEvents, SEF_AURA, t0, fight.endTime);
	const sefWindows = levelWindows(sefLevels, 1);
	const sefUptimeMs = unionMs(toIntervals(sefWindows));
	/**
	 * Stretches with *both* spirits out — the thing a single apply→remove pair could never say.
	 *
	 * **And this is as far as the log can be pushed.** The obvious next figure is "time at the *optimal*
	 * spirit count", and the sim states the rule plainly enough to tempt it: `SEF: Use` in
	 * `ui/monk/windwalker/apls/default.apl.json` sends one spirit at exactly two targets and two at more
	 * than two (`Targets: More than 2` is `numberTargets >= 3`), so the target would be 1 enemy → no
	 * spirit, 2 → one, 3+ → two. It was built, measured against both anonymous Dark Shaman pulls, and
	 * refused. Three findings, in rising order of how fatal they are:
	 *
	 *   - The pulls report 36.9% and 63.3% "at optimal" — a wide spread that looks like signal.
	 *   - It is not. The optimal count changes 23 and 25 times across those pulls, and `targetCounts`
	 *     reads a *trailing five-second window*, so the count is stale near every one of those changes.
	 *     Worst-case lag exposure is 115s and 125s: **over half of each pull**. The uncertainty band is
	 *     larger than the quantity, which is the same objection that keeps the overlap figure off the
	 *     scorecard, an order of magnitude worse.
	 *   - Fatally, the sim is not measuring what this report can measure. `numberTargets` compiles to
	 *     `sim.ActiveTargetCount()` — `len(env.Encounter.ActiveTargets)`, the enemies that *exist* — while
	 *     a log can only offer "distinct enemies this player damaged in the last five seconds". An enemy
	 *     standing untouched is active to the sim and invisible here; one killed four seconds ago is gone
	 *     there and still counted here. There are no enemy death events in the fetched stream to close
	 *     that gap. Mapping one onto the other is a reinterpretation of the APL, not a reading of it.
	 *
	 * The measured "under" time is mostly the two lags stacked — a spirit costs a global plus a ~2s
	 * spawn, and the count decays for 5s after an add dies — so the figure would have charged players
	 * for the seconds after a target dies, which is exactly the mistake the overlap figure avoids.
	 * `sefDoubleMs` stays: it is what the log actually witnessed, with nothing inferred on top.
	 */
	const sefDoubleMs = unionMs(toIntervals(levelWindows(sefLevels, SEF_MAX_CLONES)));

	/** The presses themselves — globals spent inside the pull, which is not the same as spirits sent. */
	const sefCasts = events
		.filter((e) => isCast(e) && e.sourceID === actor.id && abilityIdOf(e) === castId(STORM_EARTH_AND_FIRE))
		.map((e) => ({ t: e.timestamp - t0, target: e.targetID ?? null }))
		.sort((a, b) => a.t - b.t);

	/**
	 * Every spirit sent out — **counted from the aura, not from the presses**, and that is the fix.
	 *
	 * Counting in-fight casts undercounts a pull by exactly the spirits placed before the pull started.
	 * On a:YBQzrcgVJnAj7NMP fight 15 the log carries two casts of 137639 and the pull had three spirits:
	 * one already out at the pull (its pet swinging at 2.6s, four seconds before the first cast, and the
	 * fight's first aura event arriving already at `stack: 2`), then Darkfang at 6.1s, then Wavebinder
	 * Kardris at 2:49.8. The section said "2 presses" beside a chart drawing a spirit on Kardris from
	 * 2.6s, and nothing on the page accounted for it.
	 *
	 * **The stack walk is primary and the `summon` events corroborate.** Three reasons for that order.
	 * It is the same array `sefWindows` is built from, so the count and the bar drawn beside it are one
	 * reading rather than two free to disagree. It is the only witness that can see a pre-pull placement
	 * at all — a spirit sent before the pull has no cast *and* no summon inside the fight window, and
	 * only the arithmetic of `stack: 2` says it was there. And the aura is the mechanic itself, where a
	 * summon is a side effect of it.
	 *
	 * What the summons add is the pet actor, which the aura cannot name, and a cross-check: on both
	 * reference pulls the two agree exactly — 4 rises and 4 summons on a:6MhZgjyAknFWrYfK fight 16, 2
	 * rises and 2 summons plus one inferred pre-pull spirit on the pull above. A log carrying summons
	 * but no stack events would still be counted here, because a rise from an `applybuff` is a rise; a
	 * log carrying stacks but no summons loses only the actor, and `actorID` goes null rather than
	 * guessing at one.
	 *
	 * A press that lands on an enemy that already has a spirit *recalls* it rather than sending a
	 * second, and produces no rise — so counting rises cannot double-count a recall-and-replace. That is
	 * reasoned from the mechanic rather than observed: neither reference pull contains such a press.
	 */
	const sefPlacements = (() => {
		const summons = events.filter(
			(e) => e.type === 'summon' && e.sourceID === actor.id && SEF_SUMMON_IDS.has(abilityIdOf(e) ?? -1),
		);
		// Co-timed rather than nearest: the game stamps the cast, the summon and the aura change on one
		// millisecond, and a tolerance would let a later press claim an earlier spirit's arrival.
		const at = <T extends { t: number }>(list: readonly T[], t: number): T | undefined =>
			list.find((x) => Math.abs(x.t - t) <= SELF_EVENT_MS);

		const rises: Array<{ t: number; prePull: boolean }> = [];
		let held = 0;
		let previousEnd: number | null = null;
		for (const l of sefLevels) {
			// `auraLevels` never emits a level of zero — a gap between two stretches *is* the aura at
			// nothing — so a stretch that does not begin where the last one ended opens from an empty bar.
			// Without this the four separate presses on a:6MhZgjyAknFWrYfK fight 16 counted as one: each
			// stretch sits at level 1, and 1 is not greater than the 1 the previous stretch left behind.
			if (previousEnd === null || previousEnd !== l.start) held = 0;
			// Every stack the level climbed is one more spirit in the world, so a rise of two is two
			// placements. A *fall* is a recall and adds nothing, which is what stops a press that merely
			// moved an existing spirit from being counted as a new one.
			//
			// A stretch the fight began inside is a placement that happened before it. Its clock is 0
			// because that is where the evidence starts, not because it was pressed there — `prePull` is
			// what stops the section reading it as a global spent at the pull.
			const prePull = l.preexisting === true;
			for (let level = held; level < l.level; level++) rises.push({ t: prePull ? 0 : l.start, prePull });
			held = l.level;
			previousEnd = l.end;
		}

		return rises.map(({ t, prePull }) => {
			const cast = prePull ? undefined : at(sefCasts, t);
			const summon = prePull ? undefined : summons.find((s) => Math.abs(s.timestamp - t0 - t) <= SELF_EVENT_MS);
			// The press names the enemy. A pre-pull placement has none inside the fight, and its target is
			// filled in further down from the spirit's own first swings — see `sefUses`.
			const target = cast?.target ?? null;
			return {
				t,
				prePull,
				target,
				name: actors.find((a) => a.id === target)?.name ?? null,
				actorID: summon?.targetID ?? null,
				link: link(t),
			};
		});
	})();

	/**
	 * The spirits' own actors: this player's pets that dealt damage while the aura was up, less Xuen.
	 *
	 * They arrive in the fetched stream for free, and that was worth checking rather than assuming.
	 * WarcraftLogs reads a `sourceID` filter as "that actor or its pets", which is what already folds
	 * the tiger's damage in, and the report's master data lists each spirit as a `Pet` owned by the
	 * monk — so the core's `damageEvents` has put them in before this line runs. Verified on
	 * a:6MhZgjyAknFWrYfK fight 10: three pet actors, 1,911 damage events between them, of which 1,910
	 * fall inside a Storm, Earth and Fire window.
	 *
	 * Identified by what they did rather than by what they are called. The anonymous reports name every
	 * pet `Pet (105)`, and a Windwalker's only other pet is the tiger — which `xuenActors` above has
	 * already picked out by the one spell nothing else casts.
	 */
	const sefCloneActors = new Set(
		damageEvents
			.filter(
				(e) => e.sourceID !== actor.id && !xuenActors.has(e.sourceID ?? -1) && inWindow(e.timestamp - t0, sefWindows),
			)
			.map((e) => e.sourceID)
			.filter((id): id is number => id !== undefined),
	);
	const sefCloneDamage = damageEvents
		.filter((e) => e.sourceID !== undefined && sefCloneActors.has(e.sourceID))
		.reduce((sum, e) => sum + (e.amount ?? 0), 0);

	/** Where one actor's hands were: its single-target hits, in time order. See `SINGLE_TARGET_DAMAGE_IDS`. */
	const contactHits = (source: number): TargetHit[] => {
		const hits: TargetHit[] = [];
		for (const e of damageEvents) {
			if (e.sourceID !== source || e.tick === true || e.targetID === undefined) continue;
			if (!SINGLE_TARGET_DAMAGE_IDS.has(abilityIdOf(e) ?? -1)) continue;
			hits.push({ t: e.timestamp - t0, target: e.targetID });
		}
		return hits.sort((a, b) => a.t - b.t);
	};

	/**
	 * The enemy an actor was on, moment by moment, inside one window.
	 *
	 * Each hit owns the time until that actor's next hit — the rule the debuff's contact figure already
	 * uses — and the last one owns the rest of the window. Bounded by the window at *both* ends,
	 * because a spirit does not exist outside it: its last swing before the aura dropped says nothing
	 * about where the next press sent it, and letting a segment run across the gap put spirits on
	 * enemies they had been recalled from forty seconds earlier.
	 */
	const contactIn = (
		hits: readonly TargetHit[],
		w: Window,
		/**
		 * How the *last* segment ends, and the two callers genuinely need different answers.
		 *
		 * The player is there for the whole window, so their last hit owns the rest of it — `'window'`.
		 * A spirit is not: `sefWindows` is the union of "at least one spirit was out", and a spirit
		 * recalled while its partner stays out leaves a window that is still open with nobody in it. Run
		 * to the window's end there and the recalled spirit is drawn on an enemy it left — thirty
		 * seconds of it in the suite below. So `'cadence'` lets its last swing own only the time until
		 * its next swing would have landed, read from that spirit's own median gap between swings.
		 *
		 * With fewer than two swings there is no cadence to read and the swing owns nothing beyond
		 * itself. That under-claims by one swing, which is the direction that cannot invent presence.
		 */
		tail: 'window' | 'cadence' = 'window',
	): Array<{ from: number; to: number; target: number }> => {
		const own = hits.filter((h) => h.t >= w.start && h.t <= w.end);
		const last = own[own.length - 1];
		let close = w.end;
		if (tail === 'cadence' && last !== undefined) {
			const gaps = own.slice(1).map((h, i) => h.t - (own[i]?.t ?? h.t));
			close = Math.min(w.end, last.t + (gaps.length > 0 ? median(gaps) : 0));
		}
		return own.map((h, i) => ({ from: h.t, to: own[i + 1]?.t ?? close, target: h.target }));
	};

	const sefCloneHits = [...sefCloneActors].map(contactHits);
	const sefPlayerHits = sefWindows.length > 0 ? contactHits(actor.id) : [];
	let sefOverlapMs = 0;
	let sefMeasuredMs = 0;
	const sefOverlapByTarget = new Map<number, number>();
	/**
	 * Where the spirits actually stood, per enemy — the per-target lanes' only source.
	 *
	 * Deliberately *not* the press's `targetID`, and the reason is measured rather than argued. A spirit
	 * placed before the pull has **no press inside the fight at all**: on a:YBQzrcgVJnAj7NMP fight 15 the
	 * spirit that spent 232 of the pull's 245 seconds on Wavebinder Kardris was summoned pre-combat, and
	 * the only press anywhere in that stretch named Darkfang — which is where the *other* spirit went.
	 * Keyed to the press, Kardris's four minutes would have been drawn on Darkfang or not drawn at all.
	 *
	 * The single-target filter matters as much, for a different reason. Every spirit across both
	 * reference pulls dealt damage to four or five enemies while standing on exactly one: that spread is
	 * Rushing Jade Wind, and an area effect is not evidence of where anyone stood. `SINGLE_TARGET_DAMAGE_IDS`
	 * is what stops a spinning spirit claiming the whole room — pet 55 above hit five enemies and swung
	 * at one, and only the second number is a position.
	 */
	const sefHeldByTarget = new Map<number, Interval[]>();
	for (const w of sefWindows) {
		const spirits = sefCloneHits.flatMap((hits) => contactIn(hits, w, 'cadence'));
		for (const s of spirits) {
			const bucket = sefHeldByTarget.get(s.target);
			if (bucket === undefined) sefHeldByTarget.set(s.target, [[s.from, s.to]]);
			else bucket.push([s.from, s.to]);
		}
		for (const stood of contactIn(sefPlayerHits, w)) {
			sefMeasuredMs += stood.to - stood.from;
			// Merged before it is measured. Two spirits can never share a target — the controller recalls
			// whichever is already there — but a union cannot report more overlap than the stretch it is
			// measured across, and a sum of ranges could.
			const held = mergeIntervals(
				spirits.filter((s) => s.target === stood.target).map((s): Interval => [s.from, s.to]),
			);
			const ms = overlapMs(stood.from, stood.to, held);
			if (ms <= 0) continue;
			sefOverlapMs += ms;
			sefOverlapByTarget.set(stood.target, (sefOverlapByTarget.get(stood.target) ?? 0) + ms);
		}
	}
	/**
	 * Whether the overlap could be read at all — and it is a real third answer, not a zero.
	 *
	 * A pull that pressed the button and whose spirits left no identifiable actor behind cannot be
	 * asked this question, and "the player never doubled up" is precisely the wrong thing to print
	 * there. So the audit carries null and the section says it cannot say.
	 */
	const sefResolved = sefCloneActors.size > 0 && sefMeasuredMs > 0;

	/**
	 * The placements again, with the pre-pull ones' enemies read off the spirits themselves.
	 *
	 * "Not in this log" was too quick. The *cast* that aimed a pre-pull spirit is outside the fight
	 * window, which is true and is why `sefPlacements` leaves its target null — but the spirit is in the
	 * log from the first second, and the machinery that answers "which enemy is this spirit on" already
	 * runs above for every other placement. It answers this one too: the spirit's own first swing names
	 * the enemy it was standing on. On a:YBQzrcgVJnAj7NMP fight 15 that is Wavebinder Kardris, swung at
	 * from 2.6s and held for 232 of the pull's 245 seconds.
	 *
	 * **It is deliberately marked as a different kind of answer.** A press is a statement of intent; a
	 * swing is evidence of position, and the two can disagree — a spirit recalled and re-sent stands
	 * somewhere its press never named. So `deduced` rides along and the section says "where it swung"
	 * rather than silently printing it in the column headed "sent to".
	 *
	 * Which spirit belongs to which pre-pull placement is settled by debut order: at the pull only the
	 * pre-pull spirits are out, so the earliest first-swings are theirs, taken in time order and one
	 * apiece. Actor identity cannot do this job — the reference pull reuses one pet id for both its
	 * pre-pull spirit and a later placement.
	 *
	 * A spirit that never swings — its enemy died before it connected, or it was recalled first — leaves
	 * nothing to read, and that placement keeps its null. "Cannot say" survives as an answer.
	 */
	const sefUses = (() => {
		// A pre-pull spirit was already swinging before the pull's first press landed one. That bound is
		// what separates it from a spirit the pull itself sent: without it, a pre-pull spirit that never
		// connected would silently inherit the *next* spirit's enemy — the suite covers exactly that, and
		// the honest answer there is null. A pull with no press at all bounds nothing and takes any debut.
		const firstPress = sefPlacements.find((p) => !p.prePull)?.t ?? Infinity;
		const debuts = sefCloneHits
			.map((hits) => hits[0])
			.filter((hit): hit is TargetHit => hit !== undefined && hit.t < firstPress)
			.sort((a, b) => a.t - b.t);
		let next = 0;
		return sefPlacements.map((use) => {
			if (!use.prePull || use.target !== null) return use;
			const debut = debuts[next++];
			if (debut === undefined) return use;
			return {
				...use,
				target: debut.target,
				name: actors.find((a) => a.id === debut.target)?.name ?? null,
				deduced: true,
			};
		});
	})();

	/**
	 * The reader's ten-second rule, as a measurement.
	 *
	 * A stretch where the counts above say two or more enemies were being damaged, lasting longer than
	 * `SEF_SECOND_TARGET_MS`. `multiTargetWindows` is the same array the pull's own target mode was
	 * decided from, reused rather than counted a third time.
	 *
	 * It deliberately does **not** require the second enemy to be the *same* enemy throughout.
	 * `targetCounts` asks how many distinct enemies were hit in a trailing five seconds, so an add that
	 * dies and is replaced by the next one holds the count at two without a break, and the whole wave
	 * reads as one stretch. That is the right answer for this cooldown rather than a shortcut: a spirit
	 * is recalled when its target dies and re-placed for one global and 10 energy, so a chain of adds
	 * is one continuous reason to be pressing the button. Demanding one enemy survive ten seconds would
	 * refuse exactly the fights Storm, Earth and Fire is for.
	 */
	const sefSustained = multiTargetWindows.filter(([start, end]) => end - start > SEF_SECOND_TARGET_MS);

	/**
	 * One lane per enemy of this pull, saying when a spirit was standing on it.
	 *
	 * **On the short-lived rule, and what it really measures.** The rule asked for is "drop an enemy
	 * that died within ten seconds of first being engaged", and the honest thing to report is that this
	 * report cannot see a single enemy death. The event stream is fetched under a `sourceID` filter for
	 * the player, and WarcraftLogs returns a `death` event on that filter only when the *player* is the
	 * victim — measured on both anonymous Dark Shaman pulls, which contain 5,239 and 5,600 events and
	 * exactly zero enemy deaths between them. So what is measured here is the **engaged span**: the time
	 * between the first and the last damage the player's side landed on that enemy. An add killed in
	 * four seconds has a four-second span and is dropped; nothing is claimed about *why* the damage
	 * stopped, because the log does not say.
	 *
	 * An enemy that never died is therefore handled by the same rule and needs no special case, which is
	 * the point of measuring it this way: a boss alive at the end was being hit right up to the last
	 * event, so its span is the pull and it is kept. The rule only ever removes enemies the player was
	 * demonstrably finished with almost as soon as they started — which is exactly the clutter it was
	 * asked to remove, and is a weaker claim than "it died" rather than a guess dressed up as one.
	 *
	 * **What earns a lane.** Every enemy the player themselves damaged, plus every enemy a spirit was
	 * measured standing on — the second half matters because a spirit sent somewhere the monk never went
	 * is the case this whole chart exists to show. Unlike the debuff lanes, an enemy with *no* spirit
	 * time keeps its (empty) lane: there, an empty row said only that an add existed, whereas here it
	 * answers the reader's actual question — that enemy was up, and no spirit was ever put on it.
	 */
	const sefTargetsAll = (() => {
		// First and last contact from the player's side. `damageEvents` already folds the pets in, which is
		// what makes this the span the *player's side* was engaged rather than the monk's own attention.
		const engaged = new Map<number, { first: number; last: number }>();
		for (const e of damageEvents) {
			if (e.targetID === undefined) continue;
			const at = e.timestamp - t0;
			const span = engaged.get(e.targetID);
			if (span === undefined) engaged.set(e.targetID, { first: at, last: at });
			else span.last = at;
		}

		const named = (id: number): string | null => actors.find((a) => a.id === id)?.name ?? null;
		const damageTaken = damageByTarget(damageEvents);
		const ids = new Set([...engaged.keys(), ...sefHeldByTarget.keys()]);

		return (
			[...ids]
				.map((id) => {
					const span = engaged.get(id);
					const held = mergeIntervals(sefHeldByTarget.get(id) ?? []);
					const heldMs = unionMs(held);
					return {
						id,
						name: named(id),
						windows: held.map(([start, end]): Window => ({ start, end })),
						heldMs,
						heldPct: duration > 0 ? (heldMs / duration) * 100 : 0,
						// Zero only for an enemy that reached this list through a spirit alone, which cannot happen
						// while the spirit is identified from damage events — but the type should not depend on that.
						engagedMs: span === undefined ? 0 : span.last - span.first,
						// The pull-wide overlap figure, kept per enemy instead of summed — the same intersection
						// of "a spirit was here" with "so were you", off the same loop that produces the total.
						// It is an intersection of two stretches, so it can never exceed either of them; the suite
						// asserts that rather than trusting it, because a segment-bound slip would show up here
						// first and as a number the reader would have no way to challenge.
						overlapMs: sefOverlapByTarget.get(id) ?? 0,
						damage: damageTaken.get(id) ?? 0,
					};
				})
				// Ordered by the time a spirit held the enemy, then by the damage it took. The debuff lanes sort
				// on damage alone and that is right *there* — it is the currency their own section grades in —
				// so the principle is reused rather than the column: this chart is about where the spirits were,
				// so the spirits' own currency leads and damage breaks the ties among the enemies none held.
				.sort((a, b) => b.heldMs - a.heldMs || b.damage - a.damage || a.id - b.id)
		);
	})();

	/** Kept: enemies the player's side stayed on for longer than the reader's ten seconds. */
	const sefTargetsLived = sefTargetsAll.filter((target) => target.engagedMs > SEF_SECOND_TARGET_MS);
	// Capped exactly as the debuff lanes are, and by the same constant: past six rows the chart stops
	// being read and starts being scrolled. What is dropped is counted and printed rather than silently
	// cut — `hiddenTargets` below is what the section says out loud.
	const sefTargets = sefTargetsLived.slice(0, RSK_TARGET_LANES);

	// -------------------------------------------------------- Fists of Fury
	// Graded against the two APL conditions a log can answer. Condition 1 (energy cap) is not
	// checkable: WarcraftLogs emits only a handful of resourcechange events per fight, nowhere near
	// enough to reconstruct an energy curve, so a channel marked ok here may still have overcapped.
	// The channels themselves are the core's measurement — `h.channels` — measured at their real length
	// from the tick stream, so haste is already in the number.
	const fofChannels = channels.get('fists-of-fury') ?? [];
	const fofChannelMs = fofChannels.reduce((s, c) => s + c.channelMs, 0);
	const ebWindows = auraWindows(selfEvents, ENERGIZING_BREW, t0, fight.endTime);
	const rjwWindows = auraWindows(selfEvents, RUSHING_JADE_WIND, t0, fight.endTime);
	const tigerStrikesWindows = auraWindows(selfEvents, TIGER_STRIKES, t0, fight.endTime);
	const fofCasts = fofChannels.map((ch) => {
		const t = ch.start;
		const channelMs = ch.channelMs || (FOF_CHANNEL.baseMs ?? 4000);
		const energizingBrew = inWindow(t, ebWindows);
		const rjwCovers = remainingIn(t, rjwWindows) >= channelMs;
		const proc = procs.find((p) => t >= p.start && t <= p.end) ?? null;
		const brewUp = inWindow(t, brewWindows);
		// APL condition 3 allows a channel inside a proc only if the proc outlasts it (plus a GCD) and a
		// brew is already holding the snapshot.
		const procOutlasts = proc ? proc.end - t + GCD_MS >= channelMs : true;
		const faults: string[] = [];
		if (energizingBrew && !rjwCovers)
			faults.push('channelled through Energizing Brew with no Rushing Jade Wind covering it');
		if (proc && !procOutlasts)
			faults.push(`started with only ${r1((proc.end - t) / 1000)}s of the Rune proc left, so it expired mid-channel`);
		if (proc && procOutlasts && !brewUp) faults.push('channelled inside a Rune proc with no brew holding the snapshot');
		return {
			t,
			channelMs,
			ticks: ch.ticks,
			energizingBrew,
			rjwCovers,
			brewUp,
			procRemainingMs: proc ? proc.end - t : null,
			faults,
			link: link(t),
		};
	});
	const channelledMs = fofCasts.reduce((s, c) => s + c.channelMs, 0);

	// ----------------------------------------------------- Energizing Brew
	// Judged against priority 14 of the sim's Windwalker APL, transcribed in full on the
	// `energizing-brew` ability above. Two clauses, and only one of them a log can answer:
	//
	//   1. `energyTimeToTarget(maxEnergy) > 5s` — not checkable, and for exactly the reason the
	//      channel's own energy clause is not: WarcraftLogs emits a handful of resource events per
	//      fight, nowhere near enough to rebuild the bar. `energyCheckable: false` says so, and the
	//      section prints the caveat rather than implying a use was well timed.
	//   2. `Bloodlust inactive OR Rushing Jade Wind known` — checkable. The haste cooldown is an aura on
	//      the player whoever cast it, and having Rushing Jade Wind in the build is a cast somewhere in
	//      the pull.
	// `hasteWindows` off the handles, not a second walk of its own. The core reads the Bloodlust group
	// once for the timeline band every spec shades, and this audit grades presses against that same
	// band — a private walk here would be a second definition of when the raid cooldown was up, and
	// the two drifting apart would show as a press the section faults sitting inside a band the
	// timeline draws as clean.
	const hasteAt = (t: number): string | null => hasteWindows.find((w) => t >= w.start && t <= w.end)?.variant ?? null;
	// Both halves of the APL's exception, and it is only ever used to *excuse* a press. With Rushing
	// Jade Wind in the build and the damage spread across enemies the priority list genuinely does
	// want Energizing Brew inside Bloodlust, so faulting it there would invent a mistake.
	const rjwKnown = castCount(RUSHING_JADE_WIND_CAST) > 0;
	/**
	 * Both of the press's instants, because this block asks one question of each kind — the mixed site
	 * `Handles`' ruling keeps `castPresses` for.
	 *
	 * The Bloodlust clause grades a **choice**: whether the player pressed the brew into raid haste
	 * without the talent that would excuse it. That was true or false at the moment they committed, so
	 * it reads `begin`. Everything else here measures the **effect** the press had — the buff window it
	 * opened, the channels that started inside it, the energy it poured onto a bar that was already
	 * full — and the game decides all of that at the completion, so those read `t`. Picking one clock
	 * for the whole block would get one of the two halves wrong the day this button grows a cast bar;
	 * both instants are the same today, because Energizing Brew is an instant. Pinned either way in
	 * `castClocks.test.ts`, which is the only place the two can be told apart.
	 */
	const ebPresses = castPresses(ENERGIZING_BREW_CAST);
	const ebUses = ebPresses.map(({ t, begin }) => {
		// The landing, and a join against the buff's own events rather than arithmetic on the press: the
		// buff is stamped at the same millisecond as the `cast`, and occasionally a hair before it, which
		// is what `SELF_EVENT_MS` exists for — a strict `t >= w.start` drops the window entirely and
		// reports a six-second buff as never having gone up. A 250 ms guard cannot absorb a cast bar, so
		// asking this at `begin` would not shift the window, it would lose it: `lengthMs` would read 0
		// and `wasted` would read null on a press whose buff plainly went up.
		const window = ebWindows.find((w) => t >= w.start - SELF_EVENT_MS && t <= w.end) ?? null;
		// The commit. The fault this feeds says "you pressed this into Bloodlust", so the raid cooldown
		// has to be checked at the instant the finger went down and not at the one the brew arrived on.
		const haste = hasteAt(begin);
		// Channels that began inside this window. Counted from the channel audit's own rows rather
		// than recomputed, so the two sections cannot disagree about which channel was where — and
		// deliberately *not* raised as a fault here, because that audit already raises it and the miss
		// ledger would otherwise carry the same channel twice.
		const channels = fofCasts.filter((c) => window !== null && c.t >= window.start && c.t <= window.end);
		const faults: string[] = [];
		if (haste !== null && !rjwKnown) {
			faults.push(`used under ${haste} without Rushing Jade Wind, which is what would allow it`);
		}
		/**
		 * Energy the brew poured into a bar that was already full.
		 *
		 * The point of the button is 60 energy over 6 seconds — 10 a second on top of the regen that
		 * was already running — so a press onto a full bar throws away both rates for as long as the
		 * bar stays there. That is the loss the priority list's "at least five seconds from capping"
		 * condition exists to prevent, and it is worth naming per press rather than only in aggregate.
		 *
		 * Measured from the same capped stretches the energy audit uses, intersected with this window,
		 * so a brew and the section above it cannot disagree about when the bar was full. Null when
		 * the pull carried no readings to measure a regen rate from — an unmeasured loss is not zero.
		 */
		const cappedInside = window === null ? 0 : overlapMs(window.start, window.end, energyAudit.capped);
		const wasted =
			window === null || energyAudit.regenPerSec === null
				? null
				: Math.round((cappedInside / 1000) * (energyAudit.regenPerSec + ENERGIZING_BREW_PER_SEC));

		return {
			t,
			lengthMs: window ? window.end - window.start : 0,
			haste,
			channels: channels.length,
			cappedMs: cappedInside,
			wasted,
			faults,
			link: link(t),
		};
	});
	// Only the windows the brew could actually have been pressed in. Without the second clause this is
	// the card that says "Missed" at a player who had nothing to press — see `energizingBrewPressable`.
	// `hasteWindows` itself is published unfiltered, because the section draws the raid cooldown's real
	// extent beside the uses and a window trimmed to this question would be the wrong picture.
	const hasteRjwEligible = rjwKnown && hasteWindows.some((w) => energizingBrewPressable(w, ebUses));
	const hasteRjwUses = ebUses.filter((use) => use.haste !== null).length;

	// ----------------------------------------------------------- miss ledger
	const misses: Miss[] = [
		// Deliberately still the primary target's gaps, and deliberately named after it. A ledger is a
		// list of things that went wrong, and the contact-scoped remainder the section's tile now prints
		// is not that list: on a pull spread across thirty adds most of it is time nobody could have kept
		// a 15s debuff on a 8s cooldown across every enemy they touched, and listing each stretch as a
		// linked fault would be the invented mistake this report refuses everywhere else. A drop on the
		// enemy the pull was about is a real one — so it stays, wearing that enemy's name so a reader
		// cannot mistake one row for the whole of the time the tile counts.
		...drops.map((g) => ({
			kind: primaryName === null ? 'RSK dropped' : `RSK dropped (${primaryName})`,
			at: g.t,
			detail: `${r1(g.ms / 1000)}s without the debuff`,
			link: link(g.t),
		})),
		// `!w.weaved` for the same reason as `!w.redundant` beside it, and with more force: the ledger is
		// the report's list of things that went wrong, and a proc the player deliberately traded for a
		// live secondary is the one entry on it that would have been describing correct play.
		...procs
			.filter((w) => w.grade === 'none' && !w.redundant && w.unholdable !== true)
			.map((w) => ({
				kind: `Rune proc unsnapshotted (${w.stat})`,
				at: w.start,
				detail:
					w.missedByMs !== null
						? `brewed ${formatGap(w.missedByMs)} after the proc ended — you saw the proc, but were late`
						: w.brewAlreadyUp
							? `a brew was already running, holding ${w.heldStat ?? 'no proc at all'} instead of ${w.stat}`
							: 'proc expired with no brew cast at all',
				link: link(w.start),
			})),
		// An early brew that bought the bank more than it gave up is not a miss, so it is not listed as
		// one. The ledger is the report's list of things that went wrong; a defensible trade on it is
		// the fabricated fault this codebase refuses everywhere else.
		...procs
			.filter((w) => w.grade === 'early' && !w.protectedBrew)
			.map((w) => ({
				kind: `Snapshot too early (${w.stat})`,
				at: w.snapshotAt ?? w.start,
				// The second clause is what makes the first one a fault rather than a trade, so it says
				// which of the two it is: a bank with room protected nothing, and a bank that would have
				// spilled a little still spilled less than the tail was worth. Neither is asserted on a
				// captured fixture, where the counterfactual was never run and the field is `undefined`.
				detail:
					`brewed with ${r1((w.remainingMs ?? 0) / 1000)}s of the proc still remaining` +
					(w.holdStacksLost === null || w.holdStacksLost === undefined
						? ''
						: w.holdStacksLost === 0
							? ', and the bank had room, so waiting was possible'
							: `, and waiting would have cost only ${w.holdStacksLost} stack${w.holdStacksLost === 1 ? '' : 's'}`),
				link: link(w.snapshotAt ?? w.start),
			})),
		...lostCasts.flatMap((l) =>
			l.worst
				.filter((w) => w.seconds >= l.cooldownSec)
				.map((w) => ({
					kind: `${l.name} held`,
					at: w.at,
					detail: `ready and unused for ${w.seconds}s`,
					link: w.link,
				})),
		),
		...fofCasts
			.filter((c) => c.faults.length)
			.map((c) => ({
				kind: 'Fists of Fury misplaced',
				at: c.t,
				detail: c.faults.join('; '),
				link: c.link,
			})),
		...ebUses
			.filter((u) => u.faults.length)
			.map((u) => ({
				kind: 'Energizing Brew held through',
				at: u.t,
				detail: u.faults.join('; '),
				link: u.link,
			})),
		...tigerPalmCasts
			.filter((c) => c.reason === 'wasted')
			.map((c) => ({
				kind: 'Tiger Palm wasted',
				at: c.t,
				detail: `no Combo Breaker, and Tiger Power still had ${r1(c.buffLeftMs / 1000)}s`,
				link: link(c.t),
			})),
		...uses
			.filter((u) => u.consumed < TEB_DRAIN)
			.map((u) => ({
				kind: 'Partial brew',
				at: u.t,
				detail: `${u.consumed} of ${TEB_DRAIN} stacks`,
				link: link(u.t),
			})),
		...comboBreaker.flatMap((cb) =>
			cb.expired.map((w) => ({
				kind: `Combo Breaker: ${cb.label} expired`,
				at: w.start,
				detail: 'proc timed out unused',
				link: link(w.start),
			})),
		),
	].sort((a, b) => a.at - b.at);

	// --------------------------------------------------------- cast timeline
	// Every press on one clock, with the auras that were up underneath it.
	//
	// Assembled here rather than in a primitive, and deliberately: it invents nothing. The presses are
	// the core's `marks` — the same `castSeries` the cast table is built from, flattened out of their
	// per-ability buckets — and every lane is a window set some metric above already had to compute. So
	// this costs no extra pass over the events and — more importantly — cannot disagree with the
	// numbers printed beside it, which a second reading of the same auras eventually would.
	/**
	 * Hands each Storm, Earth and Fire press the placement it made, once.
	 *
	 * Stateful on purpose: a placement may be claimed by one mark and no more, so two presses inside
	 * a quarter-second cannot both be told they sent the same spirit. Nearest wins, which is what
	 * keeps a press at the very start of a pull with a spirit already out from taking the pre-pull
	 * placement's entry — that one is clocked at 0 and the press's own at the press.
	 */
	const sefTargetOf = (() => {
		const unclaimed = [...sefUses];
		return (t: number): Pick<CastMark, 'target'> => {
			let best = -1;
			for (const [i, use] of unclaimed.entries()) {
				if (Math.abs(use.t - t) > SELF_EVENT_MS) continue;
				if (best === -1 || Math.abs(use.t - t) < Math.abs((unclaimed[best]?.t ?? 0) - t)) best = i;
			}
			const [use] = best === -1 ? [] : unclaimed.splice(best, 1);
			if (use === undefined) return {};
			// `in`, because `sefUses` is a union of the entries that needed a target read off the spirit's
			// own swings and the ones that did not — the flag is absent from the second shape, not false.
			return { target: { id: use.target, name: use.name, ...('deduced' in use ? { deduced: use.deduced } : {}) } };
		};
	})();

	// The one press whose target is worth carrying onto the mark: which enemy a spirit was sent to.
	//
	// Copied off `sefUses` rather than read from the cast's own `targetID`, which is the same array
	// the section's table prints — so the two cannot disagree, and the mark inherits the work that
	// array already did, including a target read from where a pre-pull spirit *swung*.
	//
	// Claimed one apiece, nearest first, because a placement and its press are stamped on the same
	// millisecond only most of the time: `sefPlacements` clocks a placement at the aura's rise and
	// `SELF_EVENT_MS` is this file's standing answer for "the same instant, as the client wrote it".
	// A press that matches no placement is a press that sent no spirit — it recalled one, which
	// produces no rise — and it keeps no target rather than being handed the next spirit's.
	const castMarks: CastMark[] = marks.map((mark) =>
		mark.id === castId(STORM_EARTH_AND_FIRE) ? { ...mark, ...sefTargetOf(mark.t) } : mark,
	);

	const lane = (aura: Aura, group: LaneGroup, windows: Window[]): AuraLane => ({
		key: aura.key,
		name: aura.name,
		id: auraId(aura),
		group,
		windows,
	});

	// The debuff, merged. `rskWindows` is one entry per application and Rising Sun Kick is re-applied
	// long before it falls off, so the raw windows would draw one continuous bar as thirty abutting
	// pieces. `rskMerged` is what the uptime figure is measured over, so it is what the row shows.
	const rskLaneWindows: Window[] = rskMerged.map(([start, end]): Window => ({ start, end }));

	/**
	 * The same debuff again, one window set per enemy that carried it — for drawing.
	 *
	 * The window sets are `rskByTarget`, computed once up in the debuff section, so a lane here and the
	 * graded figure are readings of one array rather than two passes that have to agree. The primary's
	 * lane is `rskLaneWindows` itself for the same reason: the row the reader compares the number
	 * against is the very array that number's own window model was measured from.
	 *
	 * What is decided here and nowhere else is *order and cut* — which enemies are drawn, in what order,
	 * and which are held back for the picker. Nothing computed here reaches a number.
	 */
	const rskTargets = (() => {
		// The report's actor list is the only thing that can name an enemy — `enemyNPCs` carries ids and
		// no names at all. An id it does not answer for stays null and is labelled as an unnamed enemy by
		// the chart's own copy: a lane named after the wrong add is worse than a lane named after none.
		const named = (id: number): string | null => actors.find((a) => a.id === id)?.name ?? null;
		const damageTaken = damageByTarget(damageEvents);

		const others = [...rskByTarget]
			.filter(([id]) => id !== primaryID)
			.map(([id, windows]) => ({
				id,
				name: named(id),
				damage: damageTaken.get(id) ?? 0,
				windows: windows.map(([start, end]): Window => ({ start, end })),
			}))
			// An enemy that shows up only in a stray refresh has no window to draw, and an empty lane
			// costs a row to say that the add existed.
			.filter((target) => target.windows.length > 0)
			// Ordered by the damage the enemy took from this player: the same currency `primaryTargetID`
			// and `primaryDamageShare` are measured in, so the lane order agrees with the "which enemy was
			// this pull about" answer the debuff section already prints rather than offering a second one.
			// Time up was the alternative and it ranks a tagged-and-forgotten add above the one the player
			// actually killed, because the debuff runs its full 15s either way.
			.sort((a, b) => b.damage - a.damage || (a.windows[0]?.start ?? 0) - (b.windows[0]?.start ?? 0));

		const drawn = others.slice(0, Math.max(0, RSK_TARGET_LANES - 1));
		return {
			targets: [
				...(primaryID === undefined
					? []
					: [
							{
								id: primaryID,
								name: named(primaryID),
								damage: damageTaken.get(primaryID) ?? 0,
								windows: rskLaneWindows,
							},
						]),
				...drawn,
			],
			// The remainder, kept rather than counted and dropped. The cap decides what the chart draws
			// *by default* and that is unchanged; but a reader who wants to see the seventh add can only
			// be offered it if it survived this far, and an id with no windows behind it is not a lane
			// anyone can draw. Same order the sort left them in, so the two lists concatenate back into
			// the full damage order.
			rest: others.slice(drawn.length),
			hidden: others.length - drawn.length,
		};
	})();

	/** A per-enemy lane, in the one shape both the drawn set and the remainder are built from. */
	const targetLane = (target: { id: number; name: string | null; windows: Window[] }): AuraLane => ({
		...lane(RSK_DEBUFF, 'debuff', target.windows),
		target: { id: target.id, name: target.name, primary: target.id === primaryID },
	});

	/**
	 * One row per raid buff another player cast on this monk, per caster.
	 *
	 * A caster who pressed twice gets both bars in their own single row — see the Elemental's call site for
	 * why that is per caster rather than per instance; it is a user correction to what shipped first, and
	 * the monk inherits it for free because the walk is shared.
	 *
	 * The same call the Elemental audit makes, and that is the whole of what "generic implementation"
	 * bought: neither spec owns the walk, so a monk gets rows for Stormlash and Skull Banner without either
	 * buff appearing in a single metric here. `dataset-ironJuggernaut` had two totems and three banners on
	 * the player and drew none of them.
	 *
	 * `raidScoped(events)` widens the handle to the brand the walk demands, explicitly and here rather than
	 * inside it: bucketing by *caster* is meaningless on a stream narrowed to one actor — it would answer
	 * with one bucket and look like it had worked — and `raidSourceLanes` then narrows back to what landed
	 * on this monk. That narrowing is load-bearing: the fight's stream carries these buffs going out to
	 * every raider, and bucketing all of them by caster reports one caster with a row per raid member.
	 *
	 * Resolved out of the registry by key so that a buff the model has not declared is absent rather than a
	 * crash. `skull-banner` belongs in `game/shared.ts` — it lands on both specs — and the day it is
	 * declared there this draws it with no further edit.
	 */
	const RAID_SOURCE_AURAS = ['stormlash-totem', 'skull-banner'];
	const raidLanes = raidSourceLanes(
		raidScoped(events),
		registry.auras.filter((a) => RAID_SOURCE_AURAS.includes(a.key)),
		{ t0, pullMs: duration, actorID: actor.id, actors },
	);

	/**
	 * Capacitance as the counter it is, so its lane can be drawn as a charge rather than as a window.
	 *
	 * `trackStackBank` unchanged and unwrapped: the meta gem's counter is read by the very function the
	 * Tigereye Brew bank is read by, because they are the same shape of thing — an aura whose `stack`
	 * field is the number that matters. Reusing it is also what keeps the awkward cases already solved:
	 * the `applybuff` that opens a cycle counts as charge 1, and the `refreshbuff` the client emits
	 * beside every stack event moves nothing.
	 *
	 * The discharges are the **Lightning Strike damage events themselves** and not a reading of the
	 * counter. On both reference reports the pairing is exact — every one of the 613 hits in
	 * a:6MhZgjyAknFWrYfK and all 321 in a:YBQzrcgVJnAj7NMP follows a Capacitance removal, none precedes
	 * one, and every discharging cycle had reached charge 4 — but they are not the same instant: the
	 * damage lands a median of ~260ms after the aura comes off, tailing to 2.8s.
	 *
	 * So the strike is placed on its own damage event and the *wait* is carried beside it rather than
	 * either end being nudged to meet the other. Which fill a strike spent is decided by order alone —
	 * the last emptying before it — which needs no tolerance and is why a tolerance is not picked here:
	 * one wide enough to keep the 2.8s stragglers would start claiming fills that never discharged at
	 * all. Those exist and must keep their silence: 6 cycles here and 7 in the second report emptied
	 * with no hit behind them, the proc having found nobody, and a row that ends with no mark is the
	 * truthful drawing of that.
	 *
	 * Null when the gem was not worn, which is most monks — the lane is dropped by the filter below and
	 * this would be a counter with nothing in it.
	 */
	const capacitance = ((): LaneStacks | null => {
		const counter = trackStackBank(events, CAPACITANCE, actor.id, t0);
		if (counter.timeline.length === 0) return null;
		const points = counter.timeline.map(([at, n]): [number, number] => [at, n]);
		// Every moment the counter went to nothing, which is what a strike is attributed back to.
		const emptied = points.filter(([, n]) => n === 0).map(([at]) => at);
		return {
			points,
			// The model's ceiling and not this pull's peak, which is the whole point: the peak a log can
			// show is 4, and scaling to it would draw a counter that fills every cycle.
			max: CAPACITANCE.maxStacks ?? 0,
			payoff: nameOf(LIGHTNING_STRIKE_ID),
			payoffId: LIGHTNING_STRIKE_ID,
			discharges: damageEvents
				.filter((e) => abilityIdOf(e) === LIGHTNING_STRIKE_ID)
				.map((e) => {
					const t = e.timestamp - t0;
					// `findLast`, so a strike is paired with the fill it actually spent however long the wait
					// ran. Null on the pathological case the reference reports never show — a strike with no
					// emptying anywhere before it — and the chart then draws it with no wait behind it.
					return { t, amount: e.amount ?? 0, from: emptied.findLast((at) => at <= t) ?? null };
				}),
		};
	})();

	/**
	 * Which press spent each Focus of Xuen, and what happened when none did.
	 *
	 * The tier-16 four-piece grants the buff for every ten Tigereye Brew stacks spent, and the next
	 * Blackout Kick, Fists of Fury or Rising Sun Kick cashes it in for a chi. So the removal and the
	 * press that caused it are one event written twice, and the job here is only to pair them back up.
	 *
	 * **The tolerance is measured, not assumed.** Across 276 windows on every Windwalker boss pull in
	 * both anonymous reports, 270 removals have a spender stamped within four milliseconds — 131 on
	 * the same millisecond, 137 one before it, one at two and one at four, and never a single one
	 * after. The next-nearest spender is never closer than 981ms. So anything from 5ms to 900ms picks
	 * out the same press on every window in the population, and `SELF_EVENT_MS` is taken rather than a
	 * new number invented: it is this codebase's standing answer for "the client wrote these on one
	 * instant", it is two orders of magnitude clear of the runner-up, and the two other places that
	 * pair an aura event to a cast already speak in it.
	 *
	 * Directional, and that is what keeps an expiry honest: the press must land at or before the
	 * removal and inside the window. Both windows that ran out on those pulls have a Rising Sun Kick
	 * about 1.2s *after* the buff came off — the press that would have spent it, had it been pressed
	 * in time — and a symmetric window would have named it as the consumer of a buff it never got.
	 *
	 * The three answers when nothing matched are separated because they are three different things.
	 * A window within `CB_EXPIRY_SLACK_MS` of the full ten seconds ran out — measured at 10.01s and
	 * 10.02s, against a longest *consumed* window of 9.70s, so the band is not close to contested. One
	 * still open at the last event was cut off by the pull ending. Anything else came off early with
	 * no press behind it at all, which on these pulls is the player dying and every buff leaving at
	 * once — and calling that "expired" would be inventing a clock that had not run out.
	 */
	const focusSpends = (windows: readonly Window[]): LaneSpend[] =>
		windows.map((w) => {
			// `findLast`, so a window that somehow held two spenders inside the tolerance is attributed to
			// the one that actually took it off rather than to the earlier of the pair.
			const press = castMarks.findLast(
				(m) => FOCUS_SPENDER_IDS.has(m.id) && m.t >= w.start && m.t <= w.end && w.end - m.t <= SELF_EVENT_MS,
			);
			if (press !== undefined) return { start: w.start, id: press.id, name: press.name };
			const full = FOCUS_OF_XUEN.durationMs ?? 0;
			const fate =
				w.truncated === true ? 'truncated' : w.end - w.start >= full - CB_EXPIRY_SLACK_MS ? 'expired' : undefined;
			return { start: w.start, id: null, name: null, ...(fate === undefined ? {} : { fate }) };
		});

	// A lane with nothing on it is dropped rather than drawn empty: an unlit row costs a line of height
	// and a label, and tells the reader only that the aura exists.
	const lanes: AuraLane[] = [
		lane(RE_ORIGINATION, 'proc', rawProcs),
		...comboBreaker.map((cb) => lane(cb.aura, 'proc', cb.windows)),
		lane(BREW, 'buff', brewWindows),
		lane(TIGER_POWER, 'buff', tigerPowerWindows),
		lane(ENERGIZING_BREW, 'buff', ebWindows),
		lane(RUSHING_JADE_WIND, 'buff', rjwWindows),
		lane(TIGER_STRIKES, 'buff', tigerStrikesWindows),
		// The defensive, as the window it actually ran for. Nothing above reads these windows — the
		// section's figures come from the reflect and the absorb — so this is measured here and used
		// only for the row, which is what turns a press mark into ten seconds a reader can line the
		// rest of the pull up against.
		lane(TOUCH_OF_KARMA_AURA, 'buff', auraWindows(selfEvents, TOUCH_OF_KARMA_AURA, t0, fight.endTime)),
		// The spirits' own lane. It is the one buff here that is not a damage modifier the reader is
		// meant to line other presses up against — it is a bar saying "a clone of you was out" — and it
		// earns its row because every fault the section below names happened somewhere inside it.
		lane(SEF_AURA, 'buff', sefWindows),
		// The gear, and the kit that was pressed. Read here rather than anywhere above because no metric
		// wants them: nothing in this report grades a trinket, and the reader's question — "what was my
		// gear doing when I pressed that" — is one only the chart can answer. The empty-lane filter below
		// is what keeps a monk who wore none of this from paying a row apiece to be told so.
		...GEAR_PROCS.map((aura) => {
			const windows = auraWindows(selfEvents, aura, t0, fight.endTime);
			return {
				...lane(aura, 'proc', windows),
				// One of these five has a counter behind it and the other four are on-or-off, so the field is
				// attached rather than declared: a lane carrying an empty counter would be drawn as a charge
				// that never charges.
				...(aura === CAPACITANCE && capacitance !== null ? { stacks: capacitance } : {}),
				// And one of them is spent rather than waited out, so its windows carry a verdict apiece.
				...(aura === FOCUS_OF_XUEN ? { spent: focusSpends(windows) } : {}),
			};
		}),
		// The potion's row is `potionWindows` itself rather than a second walk, for the reason the debuff's
		// primary lane is the graded array: the bar the reader checks the count against has to be the very
		// windows the count was taken from. It is also the only one of these that can carry a `preexisting`
		// window — a bar that starts at the pull because the buff did not.
		...ITEM_USES.map((aura) =>
			lane(aura, 'buff', aura === POTION ? potionWindows : auraWindows(selfEvents, aura, t0, fight.endTime)),
		),
		// **The haste band is not a substitute for these rows, which is what having only the band assumed.**
		// `hasteWindows` is drawn as one full-height wash behind the pull, so it says "a haste cooldown was
		// up somewhere in here" and stops there: it cannot be hovered for a start, an end or a duration, and
		// for a buff that is not haste it does not exist at all. Blood Fury grants attack power, so it had no
		// representation anywhere in this report despite being declared with the right id.
		//
		// Both are kept, because they are different claims — the wash is the *region*, the reason a stretch
		// of the pull looks faster, and the row is the *aura*. The Elemental excused these three as covered
		// by its own band one commit before reversing it, and that excuse is the evidence: a reason in a
		// ledger is only as good as the reasoning in it.
		//
		// Grouped as presses. A racial is a button and Bloodlust is somebody's button, which is the same
		// distinction `ITEM_USES` above draws against the procs — a tone that called these procs would claim
		// the pull handed the player something that was in fact pressed.
		lane(BLOODLUST, 'buff', hasteWindows),
		lane(BERSERKING, 'buff', berserkingWindows),
		lane(BLOOD_FURY, 'buff', auraWindows(selfEvents, BLOOD_FURY, t0, fight.endTime)),
		// One row per raid buff somebody else cast on this monk, per caster — see `raidLanes`. Beside the
		// racials and Bloodlust because they answer the same question: what the raid was giving the player,
		// as against what the player pressed.
		...raidLanes.drawn,
		// One lane per enemy, sharing the aura's key and separated by their target — the primary first,
		// which is the row that used to stand for the whole pull.
		...rskTargets.targets.map(targetLane),
	].filter((l) => l.windows.length > 0);

	// The enemies past the cap, in the same shape, and the raid-buff casters past theirs. Not in `lanes`,
	// deliberately: that array is what the chart draws, and these are what it may be asked to draw instead.
	// `hiddenTargets` stays a count of *enemies* — the caption it feeds says "enemies" — so the raid-buff
	// overflow is carried without being counted there.
	const hiddenLanes: AuraLane[] = [...rskTargets.rest.map(targetLane), ...raidLanes.hidden];

	// ----------------------------------------------------------- Blackout Kick
	/**
	 * Rising Sun Kick coming off cooldown onto a bar that could not pay for it, and whether a Blackout
	 * Kick is why.
	 *
	 * Down here rather than beside the Combo Breaker block it belongs with, because it needs the press
	 * marks and the reconstructed bar and those are the last two things this pass builds — the same
	 * reason the priority list is assembled below it.
	 *
	 * **Nothing here judges a press.** Whether a global should have gone to this button is the ladder's
	 * question and the section reads `apl.presses` for it. This measures the one thing a per-press
	 * verdict structurally cannot: a cost that lands on a *later* global. Both kicks cost two chi, one
	 * has an eight-second cooldown and the other has none, so a dump can empty the bar the kick is about
	 * to need — and the sim's own dump rule is written against exactly that, firing only when the energy
	 * banked by the kick's return still covers the generator.
	 *
	 * **The attribution is deliberately narrow, because a wrong finger-point costs more than a missing
	 * one.** Tiger Palm, a Jab that never happened, Fists of Fury and Chi Brew all move the same bar, so
	 * a wait is charged to a Blackout Kick only when three things hold at once: the bar could not pay for
	 * the kick at the first global after it came up, a Blackout Kick was pressed while that cooldown was
	 * running, and holding that press would have covered the shortfall. The third is the load-bearing
	 * one and it is checked rather than assumed — see the counterfactual below. Starved time with no
	 * press that survives all three stays in `starvedMs` and is never blamed on this button.
	 */
	const blackoutKick = ((): BlackoutKickAudit => {
		/**
		 * The landings, and deliberately both halves of this block on that one clock.
		 *
		 * The two halves do ask different questions, and only one of them looks like a choice: selecting
		 * the press below — "the last Blackout Kick pressed while the kick was coming back" — reads like
		 * the choice the ruling sends to `castBeginTimes`. It is not one. Nothing here judges a press
		 * (see above); what it measures is when two chi *left the bar*, which is the completion, and
		 * every consumer of the instant this hands out is stamped on completions too. `chiAudit.walk`'s
		 * points are keyed by the `cast` event, so the counterfactual's `t <= pressAt` bound is a
		 * landing-keyed comparison; and `view/blackoutKick.ts` joins `StarvedKick.pressAt` against
		 * `apl.presses[].t` by equality, which the ruling fixes as a landing.
		 *
		 * That join is the map-key trap the ruling names. Moving this to the commit for a Blackout Kick
		 * with a cast bar would make every `followedList` lookup miss in silence, and it would also let
		 * in a press whose chi left the bar *after* the kick came up — which cannot have starved it, and
		 * whose own drain point the surplus walk would then skip. So if this button ever grows a cast
		 * time the selection bound is the only half that moves, and it moves to `castPresses`. Both
		 * instants are the same today: Blackout Kick is an instant.
		 */
		const bkTimes = castTimes(BLACKOUT_KICK);
		// The same clock and the same function the lost-cast row uses for this button, so every second
		// charged here is a second that row has already counted. Rising Sun Kick is in `NEEDS_TARGET`, so
		// `engaged` is what it passes, and the fallback is the one it makes for a log that measured none.
		const live: Interval[] = engaged.length ? engaged : [[0, duration]];
		// Both clocks, so this call reads the cooldown the way `analyseCore`'s lost-cast row does (`:804`).
		// **Nothing here moves and nothing can be made to fail if the sixth argument were dropped**, which
		// is why it is passed rather than tested: a drift window opens at a completion and closes at the
		// next *commit*, and this spec declares no `castTimeMs` at all, so its landings are its commits and
		// `commits` defaults to exactly the array now passed explicitly. What it buys is the day that stops
		// being true — a Windwalker cooldown with a cast time would otherwise be charged its own cast time
		// as drift on every press, and 1500ms of `minWindowMs` cannot forgive a 2000ms cast.
		const drift = cooldownDrift(
			castTimes(RISING_SUN_KICK),
			RISING_SUN_KICK,
			live,
			duration,
			cooldownLeewayMs,
			castBeginTimes(RISING_SUN_KICK),
		);

		// Presses that cost a global. An off-GCD trinket is not a global spent instead of the kick, so a
		// wait that ran through one was not waiting on a decision.
		const globals = castMarks.filter((m) => m.onGcd);
		/**
		 * The reconstructed bar at a press, keyed by the press.
		 *
		 * A map rather than a search backwards, and the difference is the honesty of the answer: the walk
		 * emits a point for every cast it has a bar for and *none at all* before the first reading, so a
		 * miss here means "the bar was never seen", which is not the same fact as "the bar was empty".
		 * Reading the last value at or before the press would quietly hand that case a zero.
		 */
		const chiAtPress = new Map(chiAudit.walk.points);
		// Read once, and on the same clock as `waitMs` below, so "the debuff was down" and "the kick was
		// waiting" are stretches of one timeline rather than two. The primary target's windows, exactly as
		// `debuff.drops` is scoped — these are that enemy's gaps.
		const debuffUp = intersect(rskMerged, live);

		const charged: StarvedKick[] = [];
		let starvedMs = 0;
		let starvedWaits = 0;

		for (const window of drift.windows) {
			// Globals spent while the kick sat ready. None means nothing was pressed at all through the
			// stretch, which is not a choice this audit can read anything into.
			const spent = globals.filter((g) => g.t >= window.start && g.t < window.end);
			const first = spent[0];
			if (first === undefined) continue;
			const chi = chiAtPress.get(first.t);
			if (chi === undefined) continue;
			// The bar could have paid and something else was pressed anyway. That is a priority mistake and
			// the ladder already counts it by name; it is not a chi one and not this button's.
			if (chi >= CHI_COST.risingSunKick) continue;

			// How long the shortfall lasted: to the first global the bar could have paid a kick at, or to
			// the end of the wait when it never could.
			const recovered = spent.find((g) => (chiAtPress.get(g.t) ?? 0) >= CHI_COST.risingSunKick)?.t ?? window.end;
			const waitMs = overlapMs(window.start, recovered, live);
			if (waitMs <= 0) continue;
			starvedMs += waitMs;
			starvedWaits += 1;

			// The only press that can be answerable: the last Blackout Kick pressed while the kick was
			// coming back. `window.start` is the moment it came up, so that cooldown runs back exactly one
			// cooldown from there.
			const pressAt = bkTimes.findLast(
				(t) => t > window.start - abilityCooldownMs('rising-sun-kick') && t <= window.start,
			);
			if (pressAt === undefined) continue;

			/**
			 * The counterfactual, and the whole of what lets this name a press.
			 *
			 * Hold that Blackout Kick and its two chi ride along to here — unless the fuller bar would have
			 * hit the ceiling in between, which is what this walk subtracts point by point. Two chi is
			 * exactly one Rising Sun Kick, and the bar was short by at most that, so one held press always
			 * covers a shortfall it did not overflow away.
			 *
			 * The counterfactual is *hold the press*, not *press something else*, and that is the narrow
			 * claim on purpose. What the list wants in a global it does not want dumped is Jab, which
			 * returns two chi and would leave the bar fuller than this test assumes; the one alternative
			 * that would leave it thinner is a Tiger Palm, which still gives back one of the two. So this
			 * clears a press only when the chi it spent was demonstrably the difference.
			 */
			let surplus: number = CHI_COST.blackoutKick;
			for (const [t, held] of chiAudit.walk.points) {
				if (t <= pressAt) continue;
				if (t > first.t) break;
				surplus = Math.min(surplus, chiAudit.walk.max - held);
			}
			if (chi + surplus < CHI_COST.risingSunKick) continue;

			charged.push({
				at: window.start,
				ms: waitMs,
				chi,
				pressAt,
				debuffDown: overlapMs(window.start, recovered, debuffUp) < waitMs,
				link: link(window.start),
			});
		}

		return {
			casts: castCount(BLACKOUT_KICK),
			driftMs: drift.driftMs,
			starvedMs,
			starvedWaits,
			chargedMs: charged.reduce((sum, c) => sum + c.ms, 0),
			// In clock order, not worst first: `cooldownDrift` hands its windows over sorted by length and
			// a ledger of presses is read against the pull, not against each other.
			charged: charged.sort((a, b) => a.at - b.at),
			chiExact: chiAudit.exact,
			chiPredicted: chiAudit.predicted,
		};
	})();

	/**
	 * The priority list run against every global of this pull.
	 *
	 * Assembled here rather than inside the ladder because every input it needs already exists on this
	 * pass — the press marks, both bars, the aura windows, the measured channel — and re-deriving any
	 * of them would give the section a second reading free to disagree with the one printed above it.
	 *
	 * `chiCostReduction` is zero: the tier-16 four-piece knocks a chi off three of these buttons, and
	 * nothing in this report reads set bonuses yet. Zero is the conservative direction — it makes the
	 * ladder demand *more* chi than a tiered player needed, so it can only ever fail to flag a skip,
	 * never invent one.
	 */
	const aplInputs: Parameters<typeof aplAudit>[0] = {
		casts: castMarks,
		energy: energyAudit.curve,
		chi: { max: chiAudit.walk.max, points: chiAudit.walk.points },
		regenPerSec: energyAudit.regenPerSec ?? 0,
		gcdMs: GCD_MS,
		// The pull's whole length, which is what the list's `currentTime + remainingTime` sums to. Entry
		// 31 reads it and nothing else does; the fight's own boundaries rather than the first and last
		// press, because a pull that ends twenty seconds after its final global is still that long.
		pullMs: duration,
		auras: {
			'tiger-power': tigerPowerWindows,
			'combo-breaker-tiger-palm': cbTigerPalmWindows,
			'combo-breaker-blackout-kick': comboBreaker.find((cb) => cb.aura.key === 'combo-breaker-blackout-kick')?.windows,
			'energizing-brew': ebWindows,
			'rushing-jade-wind': rjwWindows,
			'tigereye-brew': brewWindows,
			're-origination': rawProcs,
			// The merged debuff, which APL entries 18 and 20 read rather than Tiger Power. Merged across
			// every enemy that carried it, because the log does not say which enemy a press was aimed at
			// and the sim's condition is written against the current target. Exact at one target; above
			// that it answers "the debuff was up on something you were fighting".
			'rising-sun-kick-debuff': rskLaneWindows,
		},
		// Measured from this pull rather than assumed: the channel is hasted, and the list's condition
		// is written in units of how long it actually runs.
		fofChannelSec: fofCasts.length > 0 ? channelledMs / fofCasts.length / 1000 : (FOF_CHANNEL.baseMs ?? 4000) / 1000,
		// The live count at each press rather than a figure summarised over the pull. `singleTarget` is
		// deliberately no longer passed: it is a damage-concentration boolean, and what the list needs is a
		// live count.
		//
		// **Not the step function the target-count section draws**, which this comment used to claim. That
		// section draws `targets.counts.points`, the core's `targetPoints`; this is `aplTargetPoints`, the
		// same series less the spec's own area damage — and this spec is the one that declares an exclusion
		// (`aplTargetCountExclude: ['rushing-jade-wind']`), so on a pull whose fan-out is the wind the two
		// really are different numbers. That is the point of the exclusion rather than a defect in it: the
		// wind must not be the evidence that the list wanted more wind. But it means the chart and the
		// ladder can print different counts for the same instant, so a reader comparing them is not seeing
		// a bug. `analyseCore`'s `multiTargetWindows` docblock owns the argument for the split, and
		// `lib/analysis/__tests__/targetSeries.test.ts` pins both sides of it.
		targetsAt: aplTargetCountAt,
		// The second count, for the one rung pair that fires on units hit rather than units damaged.
		triggerTargetsAt: triggerTargetCountAt,
		// Read off the ability model through the registry rather than declared per ladder entry: the wind
		// has two rungs (17 and 31) and hand-writing the flavour on each is how the two would come to
		// disagree. An id no ability claims bands on damage, which is the safe direction — it can only
		// under-count, never invent a target.
		benefitOf: (id) => registry.abilityByCastId(id)?.targeting?.multiTargetBenefit ?? 'damage',
		// The two on-GCD buttons the ladder declares off its own business, so their presses read `off-list`
		// naming the section that judges them instead of being charged to whichever rung the band happened
		// to leave standing. The declaration lives on the ladder and is read here: `LADDER` and this belong
		// to the same transcription, and a second copy of the id list in this file could disagree with it.
		//
		// Passed once and inherited by all four forced walks below, which is the point of it being read
		// ahead of the first rung: which section judges a button is a fact about the button, so the verdict
		// cannot be allowed to move with the target count the way the charged rung used to.
		unarbitrated: UNARBITRATED,
	};
	const apl = aplAudit(aplInputs, LADDER);
	/**
	 * The same walk at each band the reader can force it to.
	 *
	 * Computed here rather than in the browser because the inputs above are not on `Analysis` and never
	 * will be — the reconstructed chi bar alone is a walk of the whole log. Measured at 0.18ms a walk on
	 * a 409-press pull, so four more is under a millisecond, which is less than the code to make them
	 * lazy would cost to read.
	 */
	const aplForced: Partial<Record<Band, AplAudit | null>> = {};
	for (const band of [1, 2, 3, 4] as const) {
		aplForced[band] = aplAudit({ ...aplInputs, forceBand: band }, LADDER);
	}

	// --------------------------------------------------------------- assembly
	// The fields the core owns — the player, the fight, the damage, the cast table, the target mode,
	// the lost casts, the potions, the deaths — are merged over these in `analyseCore`. What is left
	// here is everything only the Windwalker's model could say.
	return {
		brew: {
			uses: uses.length,
			castCount: castCount(TIGEREYE_BREW) || uses.length,
			totalConsumed,
			avgConsumed: uses.length ? totalConsumed / uses.length : 0,
			fullUses: uses.filter((u) => u.consumed >= TEB_DRAIN).length,
			refreshUses: uses.filter((u) => u.refresh).length,
			wastedAtCap: bank.wastedAtCap,
			wastedProtecting,
			maxStacks: bank.maxStacks,
			bankAtEnd: bank.bankAtEnd,
			// Straight off the bank walk, which counted the rises as it saw them. Not rebuilt here from
			// `totalConsumed + bankAtEnd + wastedAtCap`: `totalConsumed` sums `uses`, which drops any drain
			// that paired to no brew window, so the two versions would part company on exactly the pull
			// where one of them is wrong.
			stacksGained: bank.gained,
			uptimePct: uptimePct(brewWindows, duration),
			// Read from the same `combatantinfo` the gear comes from, and null on every Mists Classic
			// report checked so far — the field is there and always zero. Null is the answer that
			// stops the copy inventing a damage figure out of a rating the log never gave.
			damagePerStack: brewDamagePerStack(gear.masteryRating),
			windows: brewWindows,
			useList: uses,
			bankTimeline: bank.timeline,
		},
		procs: {
			procs: procs.length,
			snapshotted: snapshotted.length,
			/**
			 * Procs where a brew landed inside the reader's leeway *after* the proc ended.
			 *
			 * Never a weaved one, even though a weaved proc can carry a `missedByMs`: Tigereye Brew has no
			 * cooldown, so the brew opening the *next* rotation can easily land within a global of a
			 * weaved proc expiring. Counting it here would have the section call one proc a deliberate
			 * trade and a brew a fraction too late in the same paragraph.
			 */
			narrowlyMissed: procs.filter((w) => w.snapshotAt === null && w.missedByMs !== null && w.unholdable !== true)
				.length,
			/** Procs the bank could actually have paid for — the honest denominator for a catch rate. */
			opportunities: opportunities.length,
			/**
			 * Procs that arrived with too few stacks to be worth a brew. Reported, never counted as faults.
			 *
			 * The weaved ones are subtracted rather than swept in here: both leave the denominator, but
			 * this count is printed under copy that says "too few stacks banked", which is the wrong
			 * reason and a false one.
			 */
			unaffordable: procs.length - opportunities.length - unholdable.length,
			weaved: weaved.length,
			unholdable: unholdable.length,
			stackFloor: SNAPSHOT_STACK_FLOOR,
			lastGcd: procs.filter((w) => w.grade === 'last-gcd').length,
			late: procs.filter((w) => w.grade === 'late').length,
			early: procs.filter((w) => w.grade === 'early').length,
			protectedEarly: procs.filter((w) => w.protectedBrew).length,
			// The weaved proc is excluded here too, and not only from the score. This count is what the
			// chart's accessible label reads out as "never snapshotted", and a screen-reader listener has
			// no colour to tell them the section means something else by it.
			unsnapshotted: procs.filter((w) => w.grade === 'none' && w.unholdable !== true).length,
			redundant: procs.filter((w) => w.redundant).length,
			sameAsPrevious: procs.filter((w) => w.sameAsPrevious).length,
			backToBack: procs.filter((w) => w.backToBack).length,
			backToBackWasted: procs.filter((w) => w.backToBackWasted).length,
			devaluedSec,
			medianRemainingSec: snapshotted.length ? r1(median(snapshotted.map((w) => w.remainingMs ?? 0)) / 1000) : null,
			meanDepthPct: snapshotted.length
				? snapshotted.reduce((s, w) => s + (w.depthPct ?? 0), 0) / snapshotted.length
				: 0,
			secondsGivenAway,
			brewsOutsideProc: uses.filter((u) => !procs.some((w) => u.t >= w.start && u.t <= w.end)).length,
			uptimePct: uptimePct(procs, duration),
			statMix,
			lastGcdMs: snapshotLeewayMs,
			lateMs: LATE_MS,
			windows: procs,
		},
		debuff: {
			casts: castCount(RISING_SUN_KICK),
			uptimeMs: unionMs(rskMerged),
			uptimePct: duration > 0 ? (unionMs(rskMerged) / duration) * 100 : 0,
			engagedMs,
			// Each scalar is the union of the segment array it is named after, and the pair below is
			// measured against `contactMs` rather than `engagedMs` — the boss's clock cannot be the
			// denominator of a numerator that follows the player. Both are still published because the
			// pull timeline draws the primary target's own lane and labels it with that enemy's name; the
			// section's three tiles and the chart under them are all fractions of the contact clock.
			contactMs: inContactMs,
			// The graded figure and its own remainder, and the two numbers here that are not about the
			// primary target: the debuff on whichever enemy the player was hitting, across the time they
			// were hitting one, and the rest of that time. The section prints them side by side, so they
			// are one reading split in two rather than two readings of two different fights.
			engagedUptimePct: inContactMs ? (rskContactMs / inContactMs) * 100 : 0,
			secondsLost: r1(rskLostMs / 1000),
			intermissionSec: r1(longestGap / 1000),
			// No link here. The section plots drops on a timeline rather than listing them, and the miss
			// ledger already carries a linked row per drop — a second copy nothing renders is a field
			// that quietly goes stale.
			drops: drops.map((g) => ({ at: g.t, seconds: r1(g.ms / 1000) })),
			windows: rskLaneWindows,
			engagedSegments: engaged,
			contactSegments: contact,
			// The numerator as a picture. Its union is `engagedUptimePct`, its complement inside
			// `contactSegments` is `secondsLost`, and the complement of those is the time nothing was
			// being fought — which is the whole pull, in three parts, with nothing left over.
			contactUpSegments: rskCovered,
			primaryDamageShare,
			singleTarget,
		},
		chiBrew,
		blackoutKick,
		channel: {
			casts: fofCasts.length,
			channelSec: r1(channelledMs / 1000),
			avgChannelSec: fofCasts.length ? r1(channelledMs / fofCasts.length / 1000) : 0,
			withBrew: fofCasts.filter((c) => c.brewUp).length,
			inProc: fofCasts.filter((c) => c.procRemainingMs !== null).length,
			clean: fofCasts.filter((c) => !c.faults.length).length,
			faulted: fofCasts.filter((c) => c.faults.length).length,
			energyCheckable: false,
			castList: fofCasts,
		},
		energizing: {
			// Carried so the section can draw the overlap rather than only name it per row.
			hasteWindows,
			casts: ebPresses.length,
			// The same reading Touch of Karma gets: the opener plus one per full recharge inside the
			// pull. It is a ceiling on presses, not a target — the priority list holds this button.
			available: ENERGIZING_BREW_CAST.cooldownMs
				? Math.floor(duration / ENERGIZING_BREW_CAST.cooldownMs) + 1
				: ebPresses.length,
			uptimeMs: unionMs(toIntervals(ebWindows)),
			uptimePct: uptimePct(ebWindows, duration),
			duringHaste: ebUses.filter((u) => u.haste !== null).length,
			faulted: ebUses.filter((u) => u.faults.length).length,
			rushingJadeWind: rjwKnown,
			hasteRjwEligible,
			hasteRjwUses,
			channelsInside: fofCasts.filter((c) => c.energizingBrew).length,
			channelsCovered: fofCasts.filter((c) => c.energizingBrew && c.rjwCovers).length,
			energyCheckable: false,
			uses: ebUses,
			windows: ebWindows,
		},
		// Pressed on cooldown and on nothing else — the sim's APL fires it from a bare, unconditional
		// `autocastOtherCooldowns`, so there is no gate here to grade a press against.
		xuen: {
			casts: xuenTimes.length,
			// What the pull actually allowed: the presses taken plus the ones drift proves were dropped
			// between them. Deliberately not `floor(duration / cooldown) + 1` — `cooldownDrift` clips its
			// windows to the time the target was there, and ignores both the stretch before the first press
			// (opener noise) and the stretch after the last (a boss dying on a cooldown that was coming back
			// anyway), so this counts only presses the player could have made and did not.
			//
			// It follows that a pull with no Xuen at all reports 0 of 0 rather than a shortfall. Invoke Xuen
			// is a talent, and a log cannot tell "chose a different tier-90 talent" from "never pressed it";
			// naming the second would be inventing a fault out of the first.
			available: xuenTimes.length + (xuenDrift?.lostCasts ?? 0),
			cooldownSec: (INVOKE_XUEN.cooldownMs ?? 0) / 1000,
			durationSec: XUEN_DURATION_MS / 1000,
			driftSec: xuenDrift?.driftSec ?? 0,
			uptimeMs: xuenUptimeMs,
			uptimePct: duration > 0 ? (xuenUptimeMs / duration) * 100 : 0,
			petDamage: xuenPetDamage,
			petSharePct: eventTotal > 0 ? (xuenPetDamage / eventTotal) * 100 : 0,
			uses: xuenUses,
		},
		// Reported, never graded. The two numbers here have no threshold anyone can defend: the sim's
		// answer to "how much overlap is acceptable" is zero, because it refuses to copy a spell onto the
		// owner's own target at all, and a zero line would call a real pull a failure for the seconds
		// after a player's enemy dies and they roll onto one a spirit is holding. The ten-second rule is
		// the reader's and is a gate on speaking, not a grade. So `lib/score` knows nothing about this.
		sef: {
			// Spirits sent, not globals spent — and `pressed` keeps the second number beside it rather than
			// replacing it. The two differ by exactly the spirits placed before the pull, and a reader
			// comparing this section against the cast table, which counts presses and is right to, needs to
			// be able to see why the two disagree instead of finding one of them wrong.
			casts: sefPlacements.length,
			pressed: sefCasts.length,
			prePlaced: sefPlacements.filter((p) => p.prePull).length,
			uses: sefUses,
			windows: sefWindows.map(({ start, end, truncated }): Window => ({
				start,
				end,
				...(truncated ? { truncated } : {}),
			})),
			uptimeMs: sefUptimeMs,
			uptimePct: duration > 0 ? (sefUptimeMs / duration) * 100 : 0,
			clones: sefCloneActors.size,
			cloneDamage: sefCloneDamage,
			cloneSharePct: eventTotal > 0 ? (sefCloneDamage / eventTotal) * 100 : 0,
			// Null, not zero, when the spirits left nothing to measure against — see `sefResolved`.
			overlapMs: sefResolved ? sefOverlapMs : null,
			measuredMs: sefMeasuredMs,
			overlapPct: sefResolved ? (sefOverlapMs / sefMeasuredMs) * 100 : null,
			overlaps: [...sefOverlapByTarget]
				.sort((a, b) => b[1] - a[1])
				.map(([target, ms]) => ({
					target,
					name: actors.find((a) => a.id === target)?.name ?? null,
					ms,
				})),
			secondTargetMs: SEF_SECOND_TARGET_MS,
			justified: sefSustained.length > 0,
			justifiedMs: unionMs(sefSustained),
			longestSecondTargetMs: Math.max(0, ...multiTargetWindows.map(([start, end]) => end - start)),
			// The per-enemy lanes, and the two counts that keep the chart from lying by omission: what the
			// short-lived rule removed, and what the lane cap did. Both are printed, neither is a silent cut.
			doubledMs: sefDoubleMs,
			targets: sefTargets.map(({ id, name, windows, heldMs, heldPct, engagedMs, overlapMs: doubled }) => ({
				id,
				name,
				windows,
				heldMs,
				heldPct,
				engagedMs,
				overlapMs: doubled,
			})),
			hiddenTargets: sefTargetsLived.length - sefTargets.length,
			shortLivedTargets: sefTargetsAll.length - sefTargetsLived.length,
			// Null, not zero, on a pull whose spirits left no actor to follow: an empty lane set there means
			// "nothing could be measured", and drawing it as "no spirit was ever on anything" would be the
			// same invented compliment `overlapMs` refuses to print.
			targetsResolved: sefResolved,
		},
		karma: {
			casts: karmaCasts.length,
			// Uses the cooldown allowed: the opener plus one per full recharge inside the pull.
			available: TOUCH_OF_KARMA.cooldownMs ? Math.floor(duration / TOUCH_OF_KARMA.cooldownMs) + 1 : karmaCasts.length,
			reflected: karmaReflected,
			absorbed: karmaUses.reduce((sum, u) => sum + u.absorbed, 0),
			sharePct: eventTotal > 0 ? (karmaReflected / eventTotal) * 100 : 0,
			// The character's pool, with nothing on it. What each press was actually scored against is
			// `use.cap`, which is this times whatever health buff was up — so a press under Fortifying
			// Brew is not credited for clearing a bare pool, and the two numbers are printed together.
			capPerUse: karmaCap,
			exhausted: karmaWithFortifying.filter((use) => use.exhausted).length,
			withFortifyingBrew: karmaWithFortifying.filter((use) => use.fortifyingBrew).length,
			uses: karmaWithFortifying.map((use) => ({
				...use,
				// The absorb over this press's own ceiling — never the redirect, which is 1.05× larger, and
				// never the pull's bare pool, which a press under a health buff would exceed. `use.cap` is
				// itself floored at what the press absorbed, so this cannot print above 100.
				capPct: use.cap === null || use.cap <= 0 ? null : (use.absorbed / use.cap) * 100,
			})),
		},
		filler: {
			casts: tigerPalmCasts.length,
			onProc: tigerPalmCasts.filter((c) => c.reason === 'proc').length,
			applied: tigerPalmCasts.filter((c) => c.reason === 'apply').length,
			refresh: tigerPalmCasts.filter((c) => c.reason === 'refresh').length,
			wasted: tigerPalmCasts.filter((c) => c.reason === 'wasted').length,
			refreshWindowSec: settings.tigerPalmRefreshMs / 1000,
			buffUptimePct: uptimePct(tigerPowerWindows, duration),
			castList: tigerPalmCasts,
		},
		comboBreaker: comboBreaker.map(({ id, label, procs: count, wasted }) => ({
			id,
			label,
			procs: count,
			wasted,
		})),
		apl,
		aplForced,
		misses,
		cpm: { wastedGcds, channelSec: r1(fofChannelMs / 1000) },
		timeline: { casts: castMarks, lanes, hiddenTargets: rskTargets.hidden, hiddenLanes },
	};
}
