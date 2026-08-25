// The Protection Paladin's half of the analysis: what the core cannot know, and nothing else.
//
// Ported from `nspietz/prot-pala-analyzer`, whose measurements this spec is built on — the spell
// table, the priority ladder, the haste model and the boss rules are all theirs. What is *not* ported
// is their engine: `measure.ts` there is 1,668 lines computing a `FightMeasure`, and fifteen of that
// shape's fields are fields `AnalysisCore` already produces. The globals figure is our `gcdSlots`, the
// holy power bar is a `ResourceBarAudit`, the buttons are the cast table and `lostCasts`. So this file
// is the remainder: the three things a Protection report says that no generic audit can.
//
// **Haste is the denominator, not a stat.** Sanctity of Battle (25956) turns melee haste into cooldown
// reduction on every generator plus Shield of the Righteous, and into a shorter global on top. The
// second half needs nothing from the model — `analyseCore` measures `effectiveGcd` off the median gap
// between presses, and on a hasted pull that median *is* the hasted global. The first half is what
// `cooldownAt` below is for.
//
// **A stun is not a lost global.** `lib/analysis/enforced` holds the boss rules; this spec is the
// first consumer of them, and the three numbers it produces are kept apart rather than netted: what
// the fight enforced, and what is left over for the player. Neither is subtracted from the other,
// which is the fork's rule and the reason the section can be read at all.

import { enforcedDowntime, type EnforcedDowntime } from '~/lib/analysis/enforced';
import { buildHasteCurve, SEAL_OF_INSIGHT_HASTE, type HasteCurve } from '~/lib/analysis/haste';
import { analyseCore, type Handles, type SpecConfig } from '~/lib/analysis/analyseCore';
import { auraWindows } from '~/lib/analysis/auras';
import { readGear } from '~/lib/analysis/gear';
import { eventsOn } from '~/lib/events';
import { unionMs, type Interval } from '~/lib/analysis/intervals';
import { defaultSettings, type AnalysisSettings, type SettingSchema } from '~/lib/settings';
import { CLASS_COLOR } from '~/lib/game/classes';
import { SECONDARY_RESOURCE_TYPE } from '~/lib/game/resources';
import type { Ability } from '~/lib/game/model';
import type { Analysis, FightDataset, ProtectionAudit } from '~/lib/types';

import { GCD_MS, registry } from './data';

export { PROTECTION, registry } from './data';

/**
 * The trailing window a target count is taken over, and the two shares that read it.
 *
 * The Windwalker's numbers, unchanged, and deliberately so: nothing measured says a tank's fan-out
 * reads differently, and inventing three constants for a spec whose report does not yet grade on
 * target count would be three numbers nobody could defend.
 */
const TARGET_WINDOW_MS = 5000;
const MULTI_TARGET_SHARE_PCT = 33;
const SINGLE_TARGET_SHARE_PCT = 66;

/** A gap this long in damage to the primary target means it went untargetable. */
const ENGAGED_GAP_MS = 15_000;

/**
 * How close two differently-identified presses have to be to be the same press.
 *
 * Fifty milliseconds, the same as both other specs, and it does a different job here: Hammer of the
 * Righteous logs its cleave as a second cast in the same millisecond, which `echoCastIds` already
 * removes. This is the backstop for the pairs nobody has named yet.
 */
const SAME_PRESS_MS = 50;

const POTION_SLOTS = 2;
const POTION_CATEGORY_CD_MS = 60_000;

/**
 * Abilities whose cooldown only matters while the boss was up.
 *
 * Hammer of Wrath is the one that has to be here: it is an execute, available only under 20% health,
 * so its idle time outside that window is not a button anybody was holding.
 */
const NEEDS_TARGET: ReadonlySet<string> = new Set(['hammer-of-wrath']);

/**
 * Names for ids the model deliberately does not carry.
 *
 * Melee is the whole list for now, and it is here rather than in the table because an auto-attack has
 * no button behind it — the same reason both other specs name it here.
 */
const EXTRA_NAMES: Record<number, string> = {
	1: 'Melee',
	// Somebody else's totem, attributed to whoever it fires off. Named so a reader looking for it in the
	// damage table finds a name rather than a number, and so it does not read as this spec's own.
	120_687: 'Stormlash',
	// The legendary cloak's proc, under the buff 137596.
	137_597: 'Lightning Strike',
};

/** No press this spec makes costs a global the model does not already know about. */
const EXTRA_GLOBALS: Record<number, number> = {};

export const PROTECTION_SETTINGS: SettingSchema[] = [
	{
		key: 'cooldownLeewayMs',
		tKey: 'settings.prot.cooldown',
		// One global at this spec's own floor, and a global here is a second rather than a second and a
		// half — Sanctity of Battle takes it to 1.0s from 50% haste upwards, which is every geared pull.
		// A whole wait is forgiven rather than a slice off a longer one.
		default: 1000,
		min: 1000,
		max: 2000,
		step: 250,
	},
];

/**
 * Whether this player was actually playing Protection.
 *
 * A spent holy power, and it is the fork's own rule: no Protection Paladin finishes a pull without
 * spending one, and every figure in this report is built on a Protection ladder. Running it over a
 * Retribution parse would print confident numbers about a rotation nobody played.
 *
 * Shield of the Righteous rather than holy power generation, because a Retribution paladin generates
 * holy power too — the shield is the Protection spender and nothing else casts it.
 */
const identify = (h: Handles): boolean => h.castCount(registry.ability('shield-of-the-righteous')) > 0;

/**
 * The pull's haste curve, built from the two things the dataset carries.
 *
 * The rating comes off `combatantinfo` through the gear reader, and the Bloodlust windows off the
 * player's own aura stream. Both are already fetched; nothing here costs a request.
 */
function curveFor(h: Handles): HasteCurve {
	const lust = h.hasteWindows.map((w) => ({ start: w.start, end: w.end }));
	return buildHasteCurve(h.gear.hasteRating ?? null, lust, SEAL_OF_INSIGHT_HASTE);
}

/**
 * The same curve, built from a dataset instead of from the handles.
 *
 * Two callers and one arithmetic. `cooldownAt` runs *before* the handles exist — it is what the cast
 * tables are built with — so it cannot take the route above, and a second reading of the same three
 * terms is exactly the kind of duplication that comes apart later. `WeakMap` rather than a module
 * variable so a second dataset in the same tab cannot be handed the first one's haste.
 */
const CURVES = new WeakMap<FightDataset, HasteCurve>();

function curveForDataset(dataset: FightDataset): HasteCurve {
	const cached = CURVES.get(dataset);
	if (cached !== undefined) return cached;

	const t0 = dataset.fight.startTime;
	const own = eventsOn(dataset.events, dataset.actor.id);
	const lust = auraWindows(own, registry.aura('bloodlust'), t0, dataset.fight.endTime, {
		openAtPull: true,
	}).map((w) => ({ start: w.start, end: w.end }));

	const curve = buildHasteCurve(
		readGear(dataset.events, dataset.actor.id).hasteRating ?? null,
		lust,
		SEAL_OF_INSIGHT_HASTE,
	);
	CURVES.set(dataset, curve);
	return curve;
}

/**
 * The globals the pull had room for, and the three ways one can go unpressed.
 *
 * **None of the three is subtracted from another**, which is the fork's rule and worth keeping
 * verbatim: a reader is owed the total *and* how much of it anybody could have done something about.
 * Netting them produces one number that hides which kind of fault it describes.
 */
function globalsOf(h: Handles, enforced: EnforcedDowntime): ProtectionAudit['globals'] {
	const available = h.gcdSlots;
	const pressed = h.onGcdCasts;
	const missed = Math.max(0, available - pressed);

	// The enforced stretches, cut to the time the player was actually in the fight — a rule that runs
	// past the kill is not seconds anybody could have pressed in.
	const inPull: Interval[] = [[0, h.duration]];
	const enforcedMs = unionMs(
		enforced.windows.map(([start, end]): Interval => [Math.max(start, 0), Math.min(end, h.duration)]),
	);

	/**
	 * The globals the fight took, **measured** rather than priced.
	 *
	 * The room inside the enforced windows, less the presses actually made in them. That subtraction is
	 * the whole of it and it is not a refinement: the first version of this priced the windows in
	 * globals and clamped the result at the gap, and on the Paragons capture that read *98 of 98
	 * globals taken by the fight, 0 left for the player* — a pull with 329 presses graded flawless
	 * because the arithmetic could not see that 93 presses happened **inside** those windows.
	 *
	 * A window with presses in it is a window the player could act in, whatever the rule says about the
	 * mechanic, and the press stream is the only thing that can say so. That is the same evidence the
	 * `lockout` rules were measured with in the first place — this just applies it per pull instead of
	 * trusting the table.
	 *
	 * Floored at nought: more presses inside a window than the window had room for means the window is
	 * not costing the player anything, not that the fight owes them globals.
	 *
	 * **And capped at the gap, which is a presentation rule rather than a measurement.** The two sides
	 * are counted on different clocks — `available` divides WarcraftLogs' own *active* time, which
	 * already excludes much of a stretch where the player was not attacking — so the room a window
	 * removes can genuinely exceed the gap it explains. On the Paragons capture that is 138 globals of
	 * enforced downtime against 98 missed, and a sentence reading "the encounter accounts for 138 of
	 * those 98" is nonsense whatever the arithmetic behind it. The cap says what the report can support:
	 * the fight covers the whole gap. `enforcedMs` beside it is uncapped and is the measurement.
	 */
	const roomInside = Math.floor(enforcedMs / h.effectiveGcd);
	const pressedInside = h.marks.filter(
		(mark) => mark.onGcd && enforced.windows.some(([start, end]) => mark.t >= start && mark.t < end),
	).length;
	const enforcedGlobals = Math.min(missed, Math.max(0, roomInside - pressedInside));

	return {
		available,
		pressed,
		missed,
		enforcedMs,
		enforcedGlobals,
		/**
		 * What is left when the fight's own share is taken off: the player's half of the gap.
		 *
		 * Floored at nought for one case that is real rather than defensive — an encounter whose windows
		 * cover more room than the pull's own gap. `missed` stays whole either way; it is the *share*
		 * that is taken off, and the report prints both.
		 */
		missedFree: Math.max(0, missed - enforcedGlobals),
		gcdMs: h.effectiveGcd,
		measuredMs: unionMs(inPull),
	};
}

/** The Protection half of the analysis, from the handles and nothing else. */
function protectionAudit(h: Handles): ProtectionAudit {
	const curve = curveFor(h);
	const enforced = enforcedDowntime({
		encounterID: h.fight.encounterID,
		events: h.events,
		actorID: h.actor.id,
		phases: h.phases,
		t0: h.t0,
		endTime: h.fight.endTime,
		durationMs: h.duration,
	});

	return {
		haste: curve.measure,
		globals: globalsOf(h, enforced),
		/**
		 * The two fields `analyseCore` reads back off an audit, rather than merges blindly.
		 *
		 * `wastedGcds` is nought and is a claim rather than a placeholder: it is the count of presses
		 * that occupied a global and bought nothing, and the Windwalker can say that of a Tiger Palm
		 * because the same global had a strictly better press available on the same terms. Nothing in a
		 * Protection rotation is that — every generator returns holy power, so a press the ladder
		 * wanted elsewhere still bought something, and charging it as wasted would double-count what
		 * the priority ledger already says about it.
		 *
		 * `channelSec` is nought because this spec channels nothing.
		 */
		cpm: { wastedGcds: 0, channelSec: 0 },
		/**
		 * No fault ledger yet, and empty rather than absent because the shape is the seam.
		 *
		 * The ledger lists what the *sections* found, one row per kind with a link back to the moment,
		 * and this spec's two sections find nothing itemisable: a globals count is a total and an
		 * enforced window is the encounter's rather than the player's. The rows arrive with the priority
		 * ledger, which is the first thing here that can point at a press and say what was wrong with it.
		 */
		misses: [],
		/**
		 * The presses, and no aura lanes yet.
		 *
		 * `marks` straight through — the core built them and this audit decorates none of them. An empty
		 * lane list means the timeline draws the press rows and nothing above them, which is honest for
		 * a first cut and is what `drawnAuras.test.ts` will start arguing with as soon as this spec has
		 * a fixture swept: every aura the pull puts on the player wants a lane or a stated reason.
		 */
		timeline: { casts: h.marks, lanes: [] },
		fight: {
			encounter: enforced.profile?.name ?? null,
			note: enforced.profile?.note ?? null,
			rules: enforced.rules.map(({ rule, windows, ms }) => ({
				key: rule.key,
				name: rule.name,
				basis: rule.basis,
				source: rule.source,
				evidence: rule.evidence,
				windows: windows.map(([start, end]) => ({ start, end })),
				ms,
			})),
			enforcedMs: enforced.ms,
		},
	};
}

export const PROTECTION_SPEC: SpecConfig = {
	specName: 'Protection',
	registry,
	// The floor rather than the base, and the two are 500ms apart. `analyseCore` caps its measured
	// median at this, and Sanctity of Battle puts every geared pull on the floor — so a cap of 1500
	// here would let a mis-measured median through as a plausible number.
	gcdMs: GCD_MS,
	extraNames: EXTRA_NAMES,
	extraGlobals: EXTRA_GLOBALS,
	// A points bar: holy power arrives in whole units from a button that was pressed, so its fault is a
	// count — a return the cap refused — rather than a duration spent full. The generators are declared
	// with what they pay so the walk can rebuild the bar between the log's own samples.
	resources: {
		holyPower: {
			type: SECONDARY_RESOURCE_TYPE.holyPower,
			kind: 'points',
			gains: [
				{ abilityKey: 'crusader-strike', amount: 1 },
				{ abilityKey: 'hammer-of-the-righteous', amount: 1 },
				{ abilityKey: 'judgment', amount: 1 },
				{ abilityKey: 'avengers-shield', amount: 1 },
			],
		},
	},
	colors: { primary: CLASS_COLOR.paladin },
	thresholds: {
		targetWindowMs: TARGET_WINDOW_MS,
		multiTargetSharePct: MULTI_TARGET_SHARE_PCT,
		singleTargetSharePct: SINGLE_TARGET_SHARE_PCT,
		engagedGapMs: ENGAGED_GAP_MS,
	},
	ignoredMultiTargetActors: () => new Set(),
	needsTarget: NEEDS_TARGET,
	samePressMs: SAME_PRESS_MS,
	potion: {
		abilityKey: 'potion-of-mogu-power',
		auraKey: 'potion-of-mogu-power',
		slots: POTION_SLOTS,
		categoryCooldownMs: POTION_CATEGORY_CD_MS,
	},
	/**
	 * The first spec to declare one, and the reason the seam exists.
	 *
	 * Memoised per dataset rather than per call. `cooldownDrift` asks once per press, and rebuilding a
	 * curve — which means re-reading `combatantinfo` and re-walking the Bloodlust stream — for every
	 * press of every button would be the whole event list walked a few dozen times over.
	 */
	cooldownAt: (dataset: FightDataset, ability: Ability, t: number): number =>
		curveForDataset(dataset).cooldownMsAt(ability, t),
	identify,
	audit: protectionAudit as unknown as SpecConfig['audit'],
	settings: PROTECTION_SETTINGS,
};

/** The full analysis of one fight for one Protection paladin. */
export function analyse(
	dataset: FightDataset,
	settings: AnalysisSettings = defaultSettings(PROTECTION_SETTINGS),
): Analysis {
	return analyseCore(dataset, settings, PROTECTION_SPEC);
}
