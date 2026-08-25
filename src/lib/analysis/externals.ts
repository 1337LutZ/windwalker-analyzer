// The damage-reduction cooldowns *other people* can put on a tank, and which of them this pull got.
//
// Every tank in Mists is the target of the same short list of buttons, so this module is generic for the
// reason `vengeance.ts` is: a Blood Death Knight or a Protection Warrior needs the same catalogue, the
// same composition gate and the same reading of the stream, and nothing below names a class. What the
// caller supplies is the pull's event stream, its roster and the audited actor; what it gets back is one
// row per external — was somebody in the raid able to cast it, did it land, whose it was, and how long it
// held.
//
// ------------------------------------------------- why this section may recommend where others describe
//
// **This report grades two things and describes the rest**, and `specs/protection/lib/score.ts` spends its
// header explaining why: a threshold on where a cooldown landed would be the reader's opinion dressed as a
// measurement. An external is a *healer's* decision, made under information this report does not have, so
// the same restraint would seem to apply doubly here — and it does not, for one reason that is worth
// stating precisely because it is unusually clean.
//
// **An external costs the tank nothing.** Vengeance is taken from pre-outcome, pre-mitigation damage:
//
//   - `sim/core/vengeance.go:40` reads `rawDamage := result.PostArmorDamage / result.ArmorMultiplier`.
//   - `sim/core/armor.go:9` sets `PostArmorDamage` inside `applyArmor`, and
//     `sim/core/spell_result.go:275-276` runs `applyArmor` **before** `applyTargetModifiers`.
//   - `applyTargetModifiers` is where `PseudoStats.DamageTakenMultiplier` is applied
//     (`sim/core/spell_result.go:687`), and every external in the catalogue below is one of those
//     multipliers on the tank.
//
// So the quantity Vengeance is computed from is captured one step upstream of the external's effect, and
// the sim says so in its own words at `sim/core/vengeance.go:56-58`: *"result.PreOutcomeDamage does not
// include the impact of the tank's various DamageTakenMultiplier PseudoStats. By default this is the
// desired behavior, since it means that tank DRs are automatically divided out in the calculation."*
//
// An external therefore cuts the damage the tank takes and does **not** cut the attack power they are paid
// for taking it. There is no tradeoff to weigh — which is exactly what a threshold usually cannot say, and
// what licenses a recommendation here. An external the raid could have cast and did not is a pure loss:
// the tank would have been safer at no cost to their damage. That is a stronger claim than "you should have
// pressed this", and it is a claim about an *opportunity* rather than about anyone's play.
//
// **Two things keep that honest, and both are load-bearing.**
//
// The first is the composition gate below. A raid with no priest cannot be told it missed Pain
// Suppression, and a catalogue printed ungated would be a wish list rather than a set of improvements.
//
// The second is that attacker-side mitigation is a *different mechanic* and must not be filed here.
// Weakened Blows, Demoralizing Banner and Demoralizing Shout shrink the blow without shrinking the
// Vengeance, and `sim/core/vengeance.go:44-55` divides each of them back out **by name** for exactly that
// reason. They are debuffs on whatever is swinging, not buffs on the tank, they reach the same total by
// the other side of the exchange, and none of them belongs in this catalogue.
//
// One exception the sim names and does not model, recorded here so nothing below contradicts it:
// *detrimental* contributions to `DamageTakenMultiplier` — Ignite Armor stacks on Iron Juggernaut is the
// example it gives — **do** raise Vengeance in game, and the sim carries an open TODO about it
// (`sim/core/vengeance.go:59-61`). Nothing in this catalogue is detrimental, so the argument above holds
// for every row of it; a general sentence about damage-taken multipliers and Vengeance would not.
//
// **Still not scored.** `score.ts` grades two metrics and adding a third is a separate decision. What this
// module publishes is a finding and a recommendation, which is the shape `EnergizingBrew` already uses on
// the Windwalker — a callout raised on a measured condition, with no graded metric behind it.
//
// ----------------------------------------------------------------------------- what the fetch can see
//
// **The event fetch is scoped to the audited player, and the scope is "involved" rather than "source".**
// `fetchFight.ts` asks for `sourceID: actor.id` (`lib/wcl/fightEvents.graphql`), and the measured
// consequence is that an event reaches the stream when the player is *either* end of it. Counted across
// the three committed Protection captures, the number of events where neither the source nor the target is
// the player or one of their pets is **0 of 8 024**, **0 of 8 271** and **0 of 4 783**.
//
// Three cases follow, and the section may only speak to the first two:
//
//   - An external cast **on this tank** is in the stream, whoever cast it. This is what `received` reads.
//   - An external **this tank cast on somebody else** is in the stream too, with its target — the player is
//     the source. This is what `given` reads, and it is the whole of what can honestly be said about an
//     external going to the other tank instead.
//   - An external cast **by a third party on a third party** — the priest's Pain Suppression landing on the
//     co-tank — is in the stream **not at all**, and no reading of these events can recover it. Answering
//     it needs a second, raid-scoped fetch on the model of `raidStormlash` (one query, one point per page,
//     narrowed by `abilityID`). That fetch does not exist and this module does not pretend to it.
//
// **A self-cast is not an external**, and on this spec that is not a nicety. The audited player is a
// Paladin and Devotion Aura is a Paladin button: on the Garrosh capture, id 31821 carries 130 events, of
// which 64 are the player's own aura fanning out across the raid and only 4 are another Paladin's landing
// on them. `onTarget` plus the source check below is what keeps a button the player pressed themselves out
// of a list of things the raid did for them.
//
// **Some externals arrive with no caster.** Power Word: Barrier and Anti-Magic Zone are ground effects, and
// WarcraftLogs files their aura under the persistent area rather than the player who placed it: every one
// of the 17 Barrier applications and 3 Anti-Magic Zone applications across the three captures carries
// `sourceID` `-1`, the Environment actor. The window is still measured and the row is still real; the
// caster is simply unknown, and `CasterWindows.source` already documents `-1` as the log's own answer for
// that. It also explains their windows: Barrier's measured spans run 0.1s to 10.3s with a median of 0.8s
// against a nominal ten, because the tank walks in and out of a circle on the floor rather than carrying a
// buff. A targeted external's spans do not behave that way, and the catalogue records which is which.

import { abilityIdOf, isAuraApply, isCast } from '~/lib/events';
import type { Actor, Window } from '~/lib/types';

import { raidScoped, type RaidEvents } from './auras';
import { unionMs, type Interval } from './intervals';
import { windowsBySource } from './raidCasters';

/**
 * How the external reaches the tank, which is what decides how its windows read.
 *
 * `targeted` is cast on one player and holds for its full duration; its measured spans match the sim's
 * nominal ones to the tenth of a second across all three captures. `ground` is a circle on the floor that
 * reapplies while the tank stands in it, so its spans are a record of *position* and are routinely far
 * shorter than nominal. `raid` goes out to everybody at once from one press.
 *
 * The distinction is not decoration: a short `ground` window is the tank having moved, while a short
 * `targeted` window would be the buff having been consumed or dispelled, and a reader told "you had
 * Barrier for 0.8s" deserves to know which of those it is.
 */
export type ExternalDelivery = 'targeted' | 'ground' | 'raid';

/**
 * What the reduction figure rests on.
 *
 * `sim` means the multiplier below is read out of wowsims-mop and cited to a line. `log` means the sim does
 * not model the spell at all and the only measured thing is the window the capture carried — the id and the
 * duration are real, the reduction is unknown, and the row says so rather than carrying a remembered
 * number. Nothing is graded off a `log` row's magnitude, because there is none to grade.
 */
export type ExternalEvidence = 'sim' | 'tooltip' | 'log';

/** Which damage an external actually reduces, as the sim applies it. */
export type ExternalScope = 'all' | 'magic' | 'physical';

export interface ExternalSpell {
	key: string;
	name: string;
	/** Every id that logs as this aura on the protected player. */
	ids: number[];
	/** The class that brings it, in WarcraftLogs' own `subType` spelling — the composition gate's key. */
	providedBy: string;
	/** Full duration in ms. From the sim where it models the spell, else measured off the captures. */
	durationMs: number;
	/** The button's own cooldown in ms, or null where the sim does not model it. */
	cooldownMs: number | null;
	/**
	 * The multiplier the sim puts on damage taken — `0.6` is a 40% reduction — or null when unmodelled.
	 *
	 * Null is not "no reduction". It is "the source of truth does not state one", which is a different
	 * claim and the only one this module is entitled to make about a spell wowsims-mop has no
	 * implementation for. See the `log` evidence note above.
	 */
	takenMultiplier: number | null;
	scope: ExternalScope;
	delivery: ExternalDelivery;
	evidence: ExternalEvidence;
	/**
	 * Buttons that cannot be up on one target at the same time, named by the group they compete for.
	 *
	 * **A Paladin's Hands are the case, and the sim does not model it.** Every Hand carries "Only one
	 * Hand may be active at a time" in its own tooltip, and `sim/paladin/talents.go:375` registers Hand
	 * of Purity's ally aura with no shared group of any kind — so a sim Paladin can hold Purity and
	 * Sacrifice on one target at once and the game cannot. This is therefore sourced from the spell
	 * description rather than from `wowsims-mop`, which is worth saying plainly: everything else in this
	 * catalogue that carries a number carries it because the sim states it.
	 *
	 * What it changes here is the arithmetic of a *fault*. Two Hands unused are not two missed chances —
	 * they are one slot that could only ever have held one of them, and counting both would inflate the
	 * headline of a section whose whole claim is that an unused external is a pure loss. See
	 * `ExternalRow.blocked` for the other half: a Hand that never landed while a competing Hand did is
	 * not a miss at all.
	 */
	exclusiveGroup?: string;
	/**
	 * Whether this report can see the spell at all.
	 *
	 * **Demoralizing Banner is the case, and it is a limit of the fetch rather than a fact about the
	 * raid.** The banner reduces the damage its targets *deal* (`sim/warrior/banners.go:51`,
	 * `DamageDealtMultiplier ×0.9`), so it registers through `NewEnemyAuraArray` at `banners.go:46` — an
	 * aura on the boss and not on the tank. Every other entry here is read off an aura the protected
	 * player carried, and this fetch holds only events the player or their pet is involved in, so a
	 * warrior planting a banner under the boss appears in neither half of the stream.
	 *
	 * Kept in the catalogue rather than dropped, because it is a real tank external carrying the same
	 * licence as the rest — `vengeance.go:50-52` divides it back out by name, so it cuts damage taken and
	 * costs no attack power. But kept **out of the counted gate**: a row this report can never observe
	 * would read as unused on every pull ever analysed, which is a fabricated fault and the exact failure
	 * this section exists to avoid.
	 *
	 * Reading it needs the same second, raid-scoped fetch the co-tank case needs. Until that exists the
	 * section lists it and says it cannot see it.
	 */
	readable?: boolean;
}

/**
 * The catalogue: every damage-reduction cooldown one player can put on another in 5.4.
 *
 * ## What is in it, and where each number comes from
 *
 * Five rows are modelled by the simulator, and their durations are confirmed to the tenth of a second by
 * the three committed captures — which is worth stating because it is the check that the ids are right:
 *
 * | external          | id     | sim duration                | measured  | reduction                                |
 * | ----------------- | ------ | --------------------------- | --------- | ---------------------------------------- |
 * | Pain Suppression  | 33206  | 8s  (`core/buffs.go:927`)   | 8.0s, n=5 | ×0.6 all (`core/buffs.go:966`)           |
 * | Vigilance         | 114030 | 12s (`core/buffs.go:882`)   | 12.0s,n=10| ×0.7 all (`core/buffs.go:922`)           |
 * | Devotion Aura     | 31821  | 6s  (`core/buffs.go:813`)   | 6.0s, n=8 | ×0.8 (`core/buffs.go:858`)               |
 * | Anti-Magic Zone   | 145629 | 3s  (`death_knight/talents.go:245`) | 3.0s, n=3 | ×0.6 magic (`…:246-252`)         |
 * | Hand of Purity    | 114039 | 6s  (`paladin/talents.go:379`) | never landed | ×0.9 all (`paladin/talents.go:381`) |
 *
 * Cooldowns come from the same blocks: Pain Suppression 3min (`core/buffs.go:928`), Vigilance 2min
 * (`core/buffs.go:883`), Devotion Aura 3min (`core/buffs.go:814`), Anti-Magic Zone 2min
 * (`death_knight/talents.go:279`), Hand of Purity 30s (`paladin/talents.go:415`).
 *
 * **Devotion Aura is filed as `magic` and it is the one row where that understates the button.** The sim
 * branches on the caster's spec (`core/buffs.go:852-867`): a Holy Paladin's reduces *all* damage by 20%,
 * and anyone else's reduces the six magic schools by 20% and physical damage not at all. The branch exists
 * because of a real 5.5 change the sim cites in place. This report cannot tell the two apart — spec is not
 * in the actor list and `combatantinfo` reports `specID` as 0 on Mists logs (see
 * `lib/wcl/playerDetails.graphql`) — so the narrower of the two readings is recorded, on the principle
 * that a row should not claim more coverage than it can establish.
 *
 * Hand of Purity carries a second effect the `takenMultiplier` field cannot hold: harmful periodic damage
 * is additionally cut to a fifth (`paladin/talents.go:384-388`). The ×0.9 recorded here is the part that
 * applies to everything, and it is the conservative half.
 *
 * ## The five the simulator does not model
 *
 * Hand of Sacrifice, Power Word: Barrier, Life Cocoon and Smoke Bomb land on the tank in the captures — so
 * their ids are measured fact rather than recollection — and wowsims-mop implements none of them.
 * `grep -rn` over `sim/` returns nothing for any, and `assets/database/db.json`, which is the project's
 * own spell table, carries no entry either. They are in the catalogue with `evidence: 'log'` and a null
 * reduction, because a raid that used Power Word: Barrier did not miss it, and a catalogue that omitted
 * the spell would report that it had. Their durations are the captures' own: Hand of Sacrifice 12.0s
 * across 7 windows, Smoke Bomb 5.0s across 3, Power Word: Barrier and Life Cocoon consumed early often
 * enough that the nominal figure is taken from the longest window observed.
 *
 * ## What was rejected, and why
 *
 * - **Guardian Spirit** (47788) is in the sim and is not damage reduction. It is
 *   `HealingTakenMultiplier, 1.4` — +40% healing received — plus a one-shot death save that caps a lethal
 *   blow and restores half the tank's health (`core/buffs.go:974-1020`). It touches no
 *   `DamageTakenMultiplier`, so the Vengeance argument above does not apply to it and it does not belong
 *   in a damage-reduction list.
 * - **Rallying Cry** (cast 97462, ally aura 97463) raises maximum health by 20%
 *   (`core/buffs.go:1076-1078`). That is effective health rather than reduction, and it is already read
 *   elsewhere: `vengeance.ts` uses it as the thing that *moves the Vengeance cap*, which is a second reason
 *   not to restate it here as mitigation. It lands 10, 7 and 4 times across the three captures.
 * - **Hand of Protection** (1022) is a damage immunity and is still not a tank external. It drops its
 *   target off the threat table, so a tank who receives one stops being the tank, and a section that
 *   listed it as a chance not taken would be recommending a mistake. The captures agree about how it is
 *   actually used: it appears once across the three, as the audited player casting it on a Warlock, and
 *   it never lands on the tank at all. There is therefore also no window to take a duration from, which
 *   would rule it out on evidence even if the mechanic did not.
 * - **Ironbark, Safeguard and Spirit Link Totem** are real externals and are **not** in this catalogue,
 *   for a reason that is a gap rather than a judgement: there is no verifiable id for them. None is
 *   implemented in `sim/`, none appears in `assets/database/db.json`'s spell table, and none ever landed in
 *   the three captures — so there is no event to read an id off either. Adding them is a one-line change
 *   once an id can be cited; adding them from memory would put an unverifiable number in a table whose
 *   whole claim is that its numbers are checked. Safeguard is the near miss: `assets/database/db.json`
 *   does carry `{"id":114029,"name":"Safeguard"}` and the warrior proto has the talent, but `sim/warrior/`
 *   implements no effect for it, so its reduction would be a guess.
 * - **Weakened Blows, Demoralizing Banner and Demoralizing Shout** are debuffs on the attacker, not buffs
 *   on the tank. See the module header — the sim divides them out of Vengeance by name, which is the
 *   clearest possible statement that they are the other mechanic.
 */
export const EXTERNALS: readonly ExternalSpell[] = [
	{
		key: 'pain-suppression',
		name: 'Pain Suppression',
		ids: [33206],
		providedBy: 'Priest',
		durationMs: 8_000,
		cooldownMs: 180_000,
		takenMultiplier: 0.6,
		scope: 'all',
		delivery: 'targeted',
		evidence: 'sim',
	},
	{
		key: 'vigilance',
		name: 'Vigilance',
		ids: [114030],
		providedBy: 'Warrior',
		durationMs: 12_000,
		cooldownMs: 120_000,
		takenMultiplier: 0.7,
		scope: 'all',
		delivery: 'targeted',
		evidence: 'sim',
	},
	{
		key: 'hand-of-sacrifice',
		exclusiveGroup: 'hand',
		name: 'Hand of Sacrifice',
		ids: [6940],
		providedBy: 'Paladin',
		durationMs: 12_000,
		cooldownMs: 120_000,
		// 30% of the damage taken is redirected to the casting paladin, so the protected player takes 70%.
		// Off the 5.4 tooltip rather than the sim, which implements no effect for it.
		//
		// **The one entry here whose reduction has a second limit**: the redirect also ends once it has
		// moved a full health bar's worth of damage, so a twelve-second window under heavy damage can stop
		// paying before it expires. Nothing in this module models that, and it errs towards crediting the
		// external with more than it gave — worth knowing before this figure is ever used to size a loss.
		takenMultiplier: 0.7,
		scope: 'all',
		delivery: 'targeted',
		evidence: 'tooltip',
	},
	{
		key: 'hand-of-purity',
		exclusiveGroup: 'hand',
		name: 'Hand of Purity',
		ids: [114039],
		providedBy: 'Paladin',
		durationMs: 6_000,
		cooldownMs: 30_000,
		takenMultiplier: 0.9,
		scope: 'all',
		delivery: 'targeted',
		evidence: 'sim',
	},
	{
		key: 'devotion-aura',
		name: 'Devotion Aura',
		ids: [31821],
		providedBy: 'Paladin',
		durationMs: 6_000,
		cooldownMs: 180_000,
		takenMultiplier: 0.8,
		scope: 'magic',
		delivery: 'raid',
		evidence: 'sim',
	},
	{
		key: 'power-word-barrier',
		name: 'Power Word: Barrier',
		ids: [81782],
		providedBy: 'Priest',
		durationMs: 10_000,
		cooldownMs: 180_000,
		// "Reduces all damage done to friendly targets by 25%" — the 5.4 tooltip, the sim implementing
		// nothing for it. `81782` is the aura the standing player carries; `62618` is the placement cast.
		takenMultiplier: 0.75,
		scope: 'all',
		delivery: 'ground',
		evidence: 'tooltip',
	},
	{
		key: 'smoke-bomb',
		name: 'Smoke Bomb',
		ids: [76577],
		providedBy: 'Rogue',
		durationMs: 5_000,
		cooldownMs: null,
		takenMultiplier: null,
		scope: 'all',
		delivery: 'ground',
		evidence: 'log',
	},
	{
		key: 'demoralizing-banner',
		name: 'Demoralizing Banner',
		// The banner's own id, which is what the enemy aura registers under (`sim/warrior/banners.go:44`).
		ids: [114203],
		providedBy: 'Warrior',
		durationMs: 15_000,
		cooldownMs: 180_000,
		// ×0.9 on the *enemy's* outgoing damage (`sim/warrior/banners.go:51`), which reaches the tank as
		// ten percent less damage taken from anything it is planted on.
		takenMultiplier: 0.9,
		// Physical only: `vengeance.go:44` guards the whole divide-back-out block on `SpellSchoolPhysical`.
		scope: 'physical',
		delivery: 'ground',
		evidence: 'sim',
		readable: false,
	},
] as const;

/** One raider's instances of one external, on the tank or from the tank. */
export interface ExternalCaster {
	/** The report actor id the events carried; `-1` where the log filed a ground effect under nobody. */
	id: number;
	/** The caster's name, or null when the report's actor list could not name them — never invented. */
	name: string | null;
	windows: Window[];
}

export interface ExternalRow {
	key: string;
	name: string;
	providedBy: string;
	/**
	 * Whether anyone *other than the audited player* was in this pull who could have cast it.
	 *
	 * The gate the whole section turns on. A row that is not available is not a fault and is not a
	 * recommendation; it is a fact about who was in the raid.
	 */
	available: boolean;
	/** How many raiders of the providing class were in the pull, excluding the audited player. */
	providers: number;
	/**
	 * The slot this competes for, when it shares one — `'hand'` for a Paladin's Hands.
	 *
	 * Null for everything that stacks freely, which is all but two entries.
	 */
	group: string | null;
	/**
	 * This never landed, but something it competes with did, so its absence is not a fault.
	 *
	 * Only one Hand may be active on a target at a time, so a pull that had Hand of Sacrifice on the tank
	 * could not also have had Hand of Purity. Listing the second as a missed chance would recommend an
	 * impossibility.
	 */
	blocked: boolean;
	/** This report cannot observe the spell, so its absence says nothing. See `ExternalSpell.readable`. */
	readable: boolean;
	/** Instances that landed on the audited player, by caster, in first-seen order. */
	received: ExternalCaster[];
	/** How many landed in total. */
	count: number;
	/** Milliseconds of the pull the audited player spent under it, overlap counted once. */
	heldMs: number;
	/**
	 * Instances the audited player put on *somebody else*, by recipient.
	 *
	 * The only honest answer to "did another tank get this instead", and it is a partial one: it covers
	 * externals the audited player cast, because those are the ones the fetch carries. See the module
	 * header for the case it cannot reach.
	 */
	given: ExternalCaster[];
}

export interface ExternalsAudit {
	rows: ExternalRow[];
	/** Classes present in the pull, excluding the audited player, sorted — the gate's input. */
	classes: string[];
	/** Catalogue entries somebody in this raid could have cast. */
	available: number;
	/** Of those, how many landed on the player at least once. */
	used: number;
	/** Of those, how many never landed. The section's headline. */
	unused: number;
	/**
	 * Externals somebody in this raid could have cast that this report cannot observe at all.
	 *
	 * Named rather than counted, and kept out of every other figure here — see `ExternalSpell.readable`.
	 */
	unreadable: string[];
}

/**
 * Which classes were in this pull, other than the audited player's own.
 *
 * **Off `fight.friendlyPlayers` and never off the report's whole actor list**, which is the difference
 * between the raid and the raid night: the three committed Protection captures carry 39 players in
 * `actors` and 25 in `friendlyPlayers`, so gating on the roster would offer a raid externals from people
 * who were not in the pull.
 *
 * **The audited player is excluded**, and it is not a formality even though it changes no committed
 * figure. The player is a Paladin, so a raid whose only Paladin is the tank must not be told it could have
 * had Hand of Sacrifice on the tank: nobody was there to cast it. All three captures happen to carry a
 * second Paladin, which is why this is argued rather than measured.
 */
export function classesInPull(friendlyPlayers: readonly number[], actors: readonly Actor[], actorID: number): string[] {
	const byID = new Map(actors.map((actor) => [actor.id, actor]));
	const classes = new Set<string>();
	for (const id of friendlyPlayers) {
		if (id === actorID) continue;
		const subType = byID.get(id)?.subType;
		if (subType !== undefined && subType !== 'Unknown') classes.add(subType);
	}
	return [...classes].sort();
}

/**
 * The pull's externals: what was available, what landed, and what the tank passed on to somebody else.
 *
 * `events` is branded `RaidEvents` for the reason `windowsBySource` demands it: this walk buckets by
 * *caster*, which is meaningless on a stream already narrowed to one actor, and the widening has to be a
 * decision at the call site rather than an accident. The stream really is raid-wide in the sense that
 * matters — it carries every actor that touched the audited player — even though the fetch is scoped.
 *
 * Windows are read with `onTarget` set to the audited player, which is what keeps a raid-wide external from
 * being counted once per raider it reached; see `windowsBySource`, whose own docblock records the 38-to-1
 * measurement that made the argument.
 */
/**
 * One ground effect is one placement, however many times the player walked out of it and back in.
 *
 * **Measured, not assumed.** Power Word: Barrier on the Garrosh capture logs
 * `applybuff@35.0 removebuff@36.2 applybuff@36.2 removebuff@36.4 applybuff@37.1 removebuff@40.6
 * applybuff@40.7 removebuff@41.8 applybuff@41.9 removebuff@41.9`, then nothing until 360.5. That is a
 * priest placing one Barrier and a tank stepping over its edge four times — not five Barriers. Read
 * raw, the pull reports five instances of a ten-second cooldown inside seven seconds, which is not a
 * thing that can happen.
 *
 * A placement therefore runs for the spell's own duration from the moment it first covered the player,
 * and every window opening inside that belongs to it. Nothing else would be principled: a fixed gap
 * threshold would be a number picked to fit these two captures.
 *
 * **Ground deliveries only.** A targeted external cannot pulse — Pain Suppression is on you or it is
 * not — so merging one would hide a genuine second cast. Devotion Aura and Smoke Bomb pass through
 * unchanged on all three captures, which is the check that this narrows nothing it should not.
 *
 * The windows themselves are kept rather than filled in: the seconds the player spent *outside* the
 * circle were seconds without cover, and `heldMs` should not claim them.
 */
export function mergePlacements(windows: readonly Window[], durationMs: number): Window[][] {
	const placements: Window[][] = [];
	let openedAt: number | null = null;
	for (const w of windows) {
		const current = placements[placements.length - 1];
		if (current === undefined || openedAt === null || w.start >= openedAt + durationMs) {
			openedAt = w.start;
			placements.push([w]);
		} else current.push(w);
	}
	return placements;
}

export function readExternals(
	events: RaidEvents,
	{
		t0,
		pullMs,
		actorID,
		actors,
		friendlyPlayers,
	}: {
		t0: number;
		pullMs: number;
		actorID: number;
		actors: readonly Actor[];
		friendlyPlayers: readonly number[];
	},
): ExternalsAudit {
	const classes = classesInPull(friendlyPlayers, actors, actorID);
	const present = new Set(classes);
	const nameOf = (id: number): string | null => actors.find((actor) => actor.id === id)?.name ?? null;

	const auras = auraOnly(events);

	const rows = EXTERNALS.map((external): ExternalRow => {
		// Everything the log put on this player under these ids, bucketed by whoever put it there — then
		// the player's own presses dropped. A self-cast is not an external, and on a Paladin auditing a
		// Paladin button that is the difference between 4 instances and 68.
		const received = windowsBySource(auras, external.ids, {
			t0,
			pullMs,
			holdsMs: external.durationMs,
			onTarget: actorID,
		})
			.filter(({ source }) => source !== actorID)
			.map(({ source, windows }): ExternalCaster => ({ id: source, name: nameOf(source), windows }));

		const given = givenBySource(auras, external, { t0, pullMs, actorID, nameOf });
		const spans = received.flatMap((caster) => caster.windows.map((w): Interval => [w.start, w.end]));
		// A ground effect is counted by placements rather than by the times the player crossed its edge.
		// Pooled across casters first, because two priests dropping one Barrier each are two placements
		// and the walk above buckets by caster.
		const placements =
			external.delivery === 'ground'
				? mergePlacements(
						received.flatMap((caster) => caster.windows).sort((a, b) => a.start - b.start),
						external.durationMs,
					).length
				: spans.length;

		return {
			key: external.key,
			name: external.name,
			providedBy: external.providedBy,
			available: present.has(external.providedBy),
			providers: countProviders(friendlyPlayers, actors, actorID, external.providedBy),
			group: external.exclusiveGroup ?? null,
			readable: external.readable ?? true,
			// Filled in a second pass: whether a competitor took the slot cannot be known until every row
			// has been read.
			blocked: false,
			received,
			count: placements,
			// Overlap counted once: two Vigilances from two warriors covering the same second are one
			// second of cover, and a sum of window lengths would report two.
			heldMs: unionMs(spans),
			given,
		};
	});

	// Which competitive slots were filled, now that every row has been read. A Hand that landed takes the
	// Hand slot, and the Hands that did not are then not misses — see `ExternalSpell.exclusiveGroup`.
	const filledGroups = new Set(rows.filter((row) => row.count > 0 && row.group !== null).map((row) => row.group));
	for (const row of rows) row.blocked = row.count === 0 && row.group !== null && filledGroups.has(row.group);

	// Unreadable rows are listed and never counted — see `ExternalSpell.readable`.
	const available = rows.filter((row) => row.available && row.readable);
	const missed = available.filter((row) => row.count === 0 && !row.blocked);
	// **Counted per slot rather than per button**, which is the whole point of the group. Two Hands that
	// both went unused are one chance nobody took, because only one of them could ever have been up.
	const missedSlots = new Set(missed.map((row) => row.group ?? row.key));
	return {
		rows,
		classes,
		available: available.length,
		used: available.filter((row) => row.count > 0).length,
		unused: missedSlots.size,
		unreadable: rows.filter((row) => row.available && !row.readable).map((row) => row.name),
	};
}

/**
 * The stream with the `cast` events dropped, which `windowsBySource` needs and cannot do for itself.
 *
 * **This is a correction to a measured fault rather than a tidy-up, and the figures it moves are large.**
 * `windowsBySource` opens a window on `isCast(e) || isAuraApply(e)`, because the two raid buffs it was
 * written for log exactly one of those each: a Stormlash placement arrives as a `cast` from a raid-wide
 * fetch with no aura events in it, and a Skull Banner arrives as an `applybuff` from a pet that logs no
 * cast on this player's stream. Its docblock says so in those words.
 *
 * An external is the case neither of them is. The caster's `cast` event carries the tank as its target, so
 * the player-scoped fetch holds **both** halves: on the Paragons capture, Pain Suppression logs 4 casts
 * and 4 applications, Vigilance 11 and 11, Hand of Sacrifice 5 and 5. Handed to that walk unfiltered,
 * every instance opens twice against one removal, so each pass leaves one extra window running and the
 * next removal closes a window that opened an instance earlier. The error compounds across the pull rather
 * than staying local: Vigilance read 22 instances holding 470.7s of a 545s pull, against a true 11
 * instances holding 132s, and Pain Suppression read 289.2s against 32s.
 *
 * Fixed here and not there, deliberately. `windowsBySource` is correct for both of its existing callers,
 * and widening it to reconcile a cast with the application it caused would change what the Elemental's
 * Stormlash and Skull Banner rows measure — a pinned-figure change on eight committed captures, made as a
 * side effect of adding a section. The narrowing belongs to the caller whose stream is the unusual one.
 *
 * The aura events alone are the right reading anyway: what is wanted is the window the buff *held*, and a
 * cast that was interrupted or that landed on somebody else never became one.
 */
function auraOnly(events: RaidEvents): RaidEvents {
	return raidScoped(events.filter((event) => !isCast(event)));
}

/**
 * The instances the audited player put on other people, grouped by who received them.
 *
 * Read straight off the apply stream rather than through `windowsBySource`, because the grouping key is the
 * *target* here and that function groups by source — the same walk with the two ends swapped would need a
 * second parameter on a shared primitive to serve one caller. What is wanted is narrower anyway: who got
 * it and when, not a reconstructed window per recipient, because the recipient's removal events are only in
 * the stream when the player is also their source.
 *
 * A raid-wide external is skipped entirely. The player's own Devotion Aura reaching 24 other raiders is not
 * an external they redirected away from themselves — it landed on them too — and listing 24 recipients
 * would drown the one case this field exists for.
 */
function givenBySource(
	events: RaidEvents,
	external: ExternalSpell,
	{
		t0,
		pullMs,
		actorID,
		nameOf,
	}: { t0: number; pullMs: number; actorID: number; nameOf: (id: number) => string | null },
): ExternalCaster[] {
	if (external.delivery === 'raid') return [];
	const wanted = new Set(external.ids);
	const byTarget = new Map<number, ExternalCaster>();

	for (const event of events) {
		if (!isAuraApply(event)) continue;
		const id = abilityIdOf(event);
		if (id === null || !wanted.has(id)) continue;
		const { sourceID, targetID } = event as { sourceID?: number; targetID?: number };
		if (sourceID !== actorID || targetID === undefined || targetID === actorID) continue;

		const start = Math.min(Math.max(event.timestamp - t0, 0), pullMs);
		const entry = byTarget.get(targetID) ?? { id: targetID, name: nameOf(targetID), windows: [] };
		entry.windows.push({ start, end: Math.min(start + external.durationMs, pullMs) });
		byTarget.set(targetID, entry);
	}

	return [...byTarget.values()];
}

/** How many raiders of one class were in the pull, the audited player excluded. */
function countProviders(
	friendlyPlayers: readonly number[],
	actors: readonly Actor[],
	actorID: number,
	subType: string,
): number {
	const byID = new Map(actors.map((actor) => [actor.id, actor]));
	return friendlyPlayers.filter((id) => id !== actorID && byID.get(id)?.subType === subType).length;
}
