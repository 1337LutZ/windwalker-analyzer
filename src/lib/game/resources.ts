// The vocabulary specs declare their resource bars in: wowsims-mop's `proto/spell.proto`, mirrored
// here because this repo does not import the sim's protos. Two enums, because the game keeps two
// kinds of bar: the primary `ResourceType` every class has (mana, energy, rage, chi…), and the
// `SecondaryResourceType` some classes spend off a separate clock that the log reports as an aura
// (holy power, soul shards…).
//
// These are the sim's own numbers, not the ones WarcraftLogs reports — the sim numbers the bars it
// models (energy 2, chi 14), the log staples the game's own power enum onto `classResources`
// (energy 3). `~/lib/analysis/energy` holds the mapping between the two.

/** Mirror of `wowsims-mop/proto/spell.proto`'s `ResourceType`. */
export const RESOURCE_TYPE = {
	mana: 1,
	energy: 2,
	rage: 3,
	comboPoints: 4,
	focus: 5,
	health: 6,
	runicPower: 7,
	bloodRune: 8,
	frostRune: 9,
	unholyRune: 10,
	deathRune: 11,
	solarEnergy: 12,
	lunarEnergy: 13,
	chi: 14,
	generic: 15,
} as const;

/** Mirror of `wowsims-mop/proto/spell.proto`'s `SecondaryResourceType`. */
export const SECONDARY_RESOURCE_TYPE = {
	arcaneCharges: 36032,
	shadowOrbs: 95740,
	demonicFury: 104315,
	burningEmbers: 108647,
	soulShards: 117198,
	holyPower: 138248,
} as const;

/** Any bar a spec can declare — one of the two enums above, which is how the sim names them. */
export type ResourceTypeValue =
	| (typeof RESOURCE_TYPE)[keyof typeof RESOURCE_TYPE]
	| (typeof SECONDARY_RESOURCE_TYPE)[keyof typeof SECONDARY_RESOURCE_TYPE];

/**
 * The colour each bar draws in, straight from the sim's own palette.
 *
 * Mirrors `wowsims-mop/ui/scss/shared/_variables.scss` — its `$resource-colors` map plus the
 * lunar/solar-energy colours it defines beside it — so a report's bars are the same colours the sim
 * itself draws them in (energy gold, chi green, and so on) rather than the report inventing a
 * palette of its own. Keyed by the sim's `ResourceType` value, which is what a spec's `resources`
 * config declares, so a bar's colour is a property of the bar, not of the spec drawing it.
 *
 * Partial, deliberately: the sim colours the bars it models and leaves the rest uncoloured, and a
 * map with a row for every enum value would invite a guessed colour for a bar nobody has ever seen.
 * `resourceColorOf` says when there is no colour; the view layer decides what an uncoloured bar
 * falls back to.
 */
export const RESOURCE_COLOR: Readonly<Partial<Record<ResourceTypeValue, string>>> = {
	[RESOURCE_TYPE.mana]: '#2e93fa',
	[RESOURCE_TYPE.energy]: '#ffd700',
	[RESOURCE_TYPE.rage]: '#ff0000',
	[RESOURCE_TYPE.comboPoints]: '#ffa07a',
	[RESOURCE_TYPE.focus]: '#cd853f',
	[RESOURCE_TYPE.health]: '#22ba00',
	[RESOURCE_TYPE.solarEnergy]: '#d2952b',
	[RESOURCE_TYPE.lunarEnergy]: '#4a8aff',
	[RESOURCE_TYPE.chi]: '#00ff98',
	[SECONDARY_RESOURCE_TYPE.holyPower]: '#eed98a',
};

/** The sim's colour for a bar, or undefined when the sim has none for it. */
export function resourceColorOf(type: ResourceTypeValue): string | undefined {
	return RESOURCE_COLOR[type];
}

/**
 * How a resource bar moves, and therefore how it wastes.
 *
 * The two halves of the generic resource section: a **pool** refills on a clock, so its fault is a
 * *duration* spent full with the tap still running (energy, mana, rage); a **points** bar arrives in
 * whole units from a button that was pressed, so its fault is a *count* — a return the cap refused
 * (chi, holy power, combo points).
 */
export type ResourceKind = 'pool' | 'points';

/**
 * One resource bar a spec declares, in the sim's own vocabulary.
 *
 * `type` is the `spell.proto` value the bar rides on — `RESOURCE_TYPE.energy`, `RESOURCE_TYPE.chi`
 * or a `SECONDARY_RESOURCE_TYPE` — and `~/lib/analysis/energy` maps it to the value WarcraftLogs
 * reports before anything is sampled.
 *
 * A `points` bar also names the presses that put whole units on it, by the model's own ability keys
 * so the two lists cannot disagree about a button. Gains the log reports as `resourcechange` events
 * (Chi Brew, Power Strikes) must *not* be listed here: the walk applies those from the events
 * themselves and credits them once, and a press listed twice would give it four points.
 */
export interface ResourceConfig {
	type: ResourceTypeValue;
	kind: ResourceKind;
	gains?: ReadonlyArray<{
		abilityKey: string;
		amount: number;
		/**
		 * The button pays this only when it hit at least this many units. Omitted means it always pays.
		 *
		 * One button in the tree needs it and it was wrong without it: **Rushing Jade Wind pays its chi
		 * only at three or more** — wowsims' `registerRushingJadeWind` guards the refund with
		 * `if sim.Environment.ActiveTargetCount() >= 3`. Declared as a flat gain, the walk credited a chi
		 * to every single-target press, which is a fault in the *opposite* direction from the one the
		 * ladder makes when it calls a fanned-out wind press off-list. Two faults that cancel in a report
		 * and hide each other, which is why this is a declaration and not a note.
		 *
		 * Counted against the units the press **hit**, damage or not — the same reading
		 * `targeting.multiTargetBenefit: 'trigger'` names, because a refund that fires on units hit does not ask
		 * whether any of them could take damage. `analyseCore`'s `triggerTargetCountAt` is that series.
		 */
		minTargets?: number;
	}>;
}
