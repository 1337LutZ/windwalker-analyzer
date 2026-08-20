// Each spec's titled sections, keyed by the registry's own key.
//
// A `Report` renders whatever list the spec it was handed names. The registry cannot carry the lists
// themselves — a section is a component, and `lib/` does not import UI — so the one place they live
// is here, beside the page that renders them, and the spec's key is the only join. A spec whose key
// has no list yet renders no sections, which is the honest reading for one that has not shipped one.
//
// The type of a section with its component is defined here rather than in `SectionNav` because the
// nav must stay free of components: it folds *any* section — the summary included — into a contents
// list, and a component requirement would make the summary a lie.
//
// `modeProps` marks the sections that read the reader's target mode as props rather than through
// context — see the rendering comment in `Report`. `'live'` takes the resolved mode, `'forced'` takes
// the reader's explicit choice (null under auto), `'both'` takes both. It discriminates the
// `Component`'s props, so a section that takes the mode can only be given the mode it asked for.

import type { ComponentType } from 'react';

import type { Analysis, TargetMode } from '~/lib/types';
import { WW_SPEC } from '~/specs/windwalker';
import { ELEMENTAL_SPEC } from '~/specs/elemental';

import type { ReportSection } from './SectionNav';
import { excludedButtons, pressedButtons } from '~/specs/windwalker/lib/view/rotationFlow';
import {
	CastLog,
	DamageByAbility,
	GearSetup,
	Method,
	MissLedger,
	PriorityLadder,
	RaidBuffs,
	Resource,
} from '../sections';
import type { ResourceProps } from '../sections';
import {
	BlackoutKick,
	BrewBankTimeline,
	CastsPerMinute,
	EnergizingBrew,
	ChiBrew,
	FistsOfFury,
	KpiTiles,
	PullTimeline,
	RisingSunKick,
	Rotation,
	RushingJadeWind,
	SnapshotTable,
	StormEarthAndFire,
	SummaryWarning,
	TigerPalm,
	TouchOfKarma,
	Xuen,
} from '~/specs/windwalker/components/sections';
import {
	Cooldowns,
	EarthElemental,
	EarthShock,
	FireElemental,
	FlameShock,
	KpiTiles as ElementalKpiTiles,
	LavaBurst,
	LightningShield,
	PullTimeline as ElementalPullTimeline,
	Rotation as ElementalRotation,
	SearingTotem,
	Snapshots,
	Stormlash,
} from '~/specs/elemental/components/sections';

/**
 * One of the spec's resource bars, as a titled section.
 *
 * `Resource` renders whichever half of the bar the audit says it is; what makes the section a
 * section is this wrapper, which closes over the bar's config so the component has a stable
 * identity — `SPEC_SECTIONS` is built once at module load, so an inline arrow here would unmount
 * and remount the section's chart state on every report render. The config is the whole of what
 * distinguishes the bars: which to draw, which half of the copy to read, which tone and colour to
 * draw it in. How a share of waste reads as a colour is *not* in it — that is the spec's own reading
 * aid, and `Resource` takes it off the spec it is drawing for, so this list never has to name one
 * spec's scoring module in order to build another spec's bars.
 */
function resourceSection(config: Omit<ResourceProps, 'analysis'>): ComponentType<{ analysis: Analysis }> {
	return function ResourceSection({ analysis }: { analysis: Analysis }) {
		return <Resource analysis={analysis} {...config} />;
	};
}

export type ReportSectionWithComponent = ReportSection & {
	when?: (analysis: Analysis) => boolean;
} & (
		| {
				modeProps?: undefined;
				Component: ComponentType<{ analysis: Analysis }>;
		  }
		| {
				modeProps: 'live';
				Component: ComponentType<{ analysis: Analysis; mode: TargetMode | null }>;
		  }
		| {
				modeProps: 'forced';
				Component: ComponentType<{ analysis: Analysis; forcedMode: TargetMode | null }>;
		  }
		| {
				modeProps: 'both';
				Component: ComponentType<{ analysis: Analysis; mode: TargetMode | null; forcedMode: TargetMode | null }>;
		  }
	);

/**
 * The Windwalkers' report, in the order docs/component-specs.md sets: the pull itself, then the
 * economy that paid for it, then the buttons one at a time, then the reference a reader lands on
 * once a section above has told them a number was wrong.
 *
 * **Document order follows the groups.** The list reads down `core`, then `cooldowns`, then
 * `abilities`, then `reference`, each of them one unbroken run. The sidebar's grouping is what leads:
 * the page and the contents list beside it reach every section in the same order, so a reader who has
 * found a heading in one can find it in the other by counting, and neither list has to be read as a
 * translation of the other. This is not the order the list grew in — four sections used to sit away
 * from their group so the page could argue in one order while the nav filed in another — so do not
 * sort it back into an editorial order. Where the grouping cost an adjacency the entry below says
 * which neighbour it lost and what was kept instead.
 *
 * One list, read twice — rendered below and listed by `SectionNav` — because a nav written out by
 * hand is a nav that goes stale the first time a section is added, moved or renamed, and nothing
 * would fail until a reader clicked a link to nowhere. `id` and `titleKey` are what the section
 * itself passes to `Section`; `sectionNav.test.ts` holds the two together.
 *
 * The header and the KPI tiles are not in it. Neither is a `Section` — they have no heading to
 * address and no id to jump to — and a contents list whose first entry is the thing already on
 * screen is a wasted line.
 *
 * `group` is which part of the contents list the section is filed under, and it is here rather than
 * in a table inside the nav for the same reason the rest of this list is: a table of ids would be a
 * second copy, free to name a section that has gone and to miss one that arrived. Being required
 * means a section added below cannot silently fail to appear in a group — it fails the type check
 * instead. `SectionNav` folds the list into groups itself, so a group only exists when a section is
 * in it and an emptied one is never rendered.
 *
 * `when` is what lets a section decline to appear on a pull it has nothing to say about, and it has
 * to live here rather than inside the section: the nav is built from this same list, so a component
 * that quietly returned null would leave a link pointing at a heading that was never rendered.
 * Omitting it means "always", which is what every section but one wants — a section with a real
 * verdict has to say so even when the verdict is that nothing happened.
 */
export const SPEC_SECTIONS: Record<string, ReportSectionWithComponent[]> = {
	windwalker: [
		// First after the summary, because it is the pull itself: every press, every buff, one clock. A
		// reader who has just been handed a verdict wants to see what actually happened before they are
		// shown any argument about it, and every section below this one is an argument about some slice of
		// this chart.
		{ id: 'cast-log', titleKey: 'castLog.title', group: 'core', Component: CastLog },
		// The same four minutes at a coarser grain: the timeline above shows the buttons, this shows the
		// windows they were pressed inside. Reading them the other way round — windows first — meant
		// naming a mechanic before the reader had seen a single press.
		{ id: 'timeline', titleKey: 'timeline.title', group: 'core', Component: PullTimeline },
		{ id: 'snapshots', titleKey: 'snapshots.title', group: 'core', Component: SnapshotTable },

		// How the globals were spent, then what paid for them. Together these two are the whole economy of
		// the pull: the rate says whether the buttons were pressed, the bars say whether there was anything
		// to press them with — and a low cast rate means something different depending on which.
		{ id: 'cpm', titleKey: 'casts.title', group: 'core', Component: CastsPerMinute },
		{
			id: 'energy',
			titleKey: 'energy.title',
			group: 'core',
			Component: resourceSection({
				id: 'energy',
				barKey: 'energy',
				copyPrefix: 'energy',
				tone: 'kick',
				color: WW_SPEC.colors.primary,
			}),
		},
		// Beside energy, because the two are one economy read from opposite ends: energy is a pool that
		// refills on a clock and wastes by the second, chi arrives in whole points from a press and wastes
		// by the point. Split apart they read as two unrelated bars; together the reader can see that a
		// full energy bar and an overflowing chi bar are the same global going missing.
		{
			id: 'chi',
			titleKey: 'chi.title',
			group: 'core',
			Component: resourceSection({
				id: 'chi',
				barKey: 'chi',
				copyPrefix: 'chi',
				tone: 'brew',
				color: WW_SPEC.colors.primary,
			}),
		},

		// -------------------------------------------------------------- the cooldowns, one section each
		//
		// Everything from here to the reference judges a single button, and the page takes them in the
		// sidebar's two button groups: the long timers you spend, then the rotational presses. A reader
		// arrives at this part of the report holding a button rather than a moment, so what they need is to
		// find its heading — and one order across the page and the contents list is how they find it.
		//
		// Tigereye Brew first: it multiplies everything else in the list, so a mistake here is the only one
		// that costs damage the other sections have already counted.
		{ id: 'bank', titleKey: 'brew.title', group: 'cooldowns', Component: BrewBankTimeline },
		// Directly under the bank it feeds: Chi Brew's two stacks a press are the only source of brew that
		// is not chi spent, so a reader looking at a bank that filled slowly wants this row next.
		{ id: 'chi-brew', titleKey: 'chiBrew.title', group: 'cooldowns', Component: ChiBrew },
		// The third brew, beside the other two, and the one adjacency the grouping cost outright. This sat
		// directly under Fists of Fury, because the priority list will not channel Fists through an
		// Energizing Brew unless Rushing Jade Wind covers it and each of those sections counts that same
		// overlap from its own side. Both are a group below now and neither is this section's neighbour any
		// more. The trade was taken because those two still read that rule from their own ends and are
		// still beside *each other* — see Rushing Jade Wind — while a reader who comes looking for this
		// heading is holding a brew, and the three brews are worth finding in one place.
		{ id: 'energizing', titleKey: 'energizingBrew.title', group: 'cooldowns', Component: EnergizingBrew },
		// The first of the three long timers that are not brews, and filed under cooldowns rather than
		// abilities: the nav groups by what a button *is* to the player pressing it — something on a long
		// timer you spend, not a rotational press — and document order follows the nav, so that filing is
		// also what puts it here rather than among the sections that grade placement. Xuen leads the three
		// because it is the one with no placement to judge at all: the sim fires it from an unconditional
		// autocast, so the section grades the clock and nothing else.
		// The two level-90 choices are mutually exclusive. Hide the section when the log proves its talent
		// was not taken; keep it when the log cannot tell, so silence is not mistaken for a forgotten button.
		{
			id: 'xuen',
			titleKey: 'xuen.title',
			group: 'cooldowns',
			Component: Xuen,
			when: (analysis) => !excludedButtons(pressedButtons(analysis.casts)).has(123_904),
		},
		// Beside the other summon, and the only section in the list that can decline to appear. Storm,
		// Earth and Fire is a multi-target button: on a single-target pull it is correct never to press it,
		// so a heading saying "not pressed, and rightly" on every Garrosh kill would be a line of noise on
		// most reports. It renders when the spirits went out, and when they did not but the pull held a
		// second enemy long enough that they should have.
		{
			id: 'sef',
			titleKey: 'sef.title',
			// Cooldowns with the other summon, by the same reading as Xuen above and Touch of Karma below: a
			// two-minute button you spend is not a rotational press. It is also the one section that can
			// decline to appear, so this group is the only one whose membership varies by pull — which
			// `SectionNav` already copes with, since it folds groups out of the sections it is handed.
			group: 'cooldowns',
			Component: StormEarthAndFire,
			when: (analysis) => Boolean(analysis.sef && (analysis.sef.casts > 0 || analysis.sef.justified)),
		},
		// The defensive, and so the last of the cooldowns: it is the only button in this group that is not
		// trying to do damage. Not the last button on the page any more — the rotational presses below are
		// still to come — but it is the end of the run of things you spend.
		{ id: 'karma', titleKey: 'karma.title', group: 'cooldowns', Component: TouchOfKarma },

		// ---------------------------------------------------------------- the presses, one section each
		//
		// The rotational buttons: the ones a Windwalker spends chi and globals on rather than spends off a
		// long timer, which is what the sidebar files them under and so what the page reads them in. The
		// four of them keep the order they had before the grouping — by how much a Windwalker's damage
		// moves when the button goes wrong, not by when it is pressed — with the two by-ability tables
		// after them.
		// The presses, ordered as the priority list reaches them rather than by how much damage each one
		// does: Tiger Palm holds the buff the rest hit through, Rising Sun Kick holds the debuff, and the
		// spenders follow.
		{ id: 'tiger-palm', titleKey: 'tigerPalm.title', group: 'abilities', Component: TigerPalm },
		{ id: 'debuff', titleKey: 'debuff.title', group: 'abilities', Component: RisingSunKick },
		// Directly under the kick, and the adjacency is the argument. This is the chi dump the ladder falls
		// through to, and the one thing it can cost that the ladder cannot see is the section above it: both
		// buttons cost two chi, the kick has an eight-second cooldown and the dump has none, so a press here
		// can empty the bar the kick is about to need. A reader who has just been shown the kick's uptime is
		// the reader who needs that next.
		{
			id: 'blackout-kick',
			titleKey: 'blackoutKick.title',
			group: 'abilities',
			Component: BlackoutKick,
			modeProps: 'forced',
		},
		{ id: 'fof', titleKey: 'fistsOfFury.title', group: 'abilities', Component: FistsOfFury },
		// The third side of a triangle whose other corner is a group away. The priority list's one rule
		// that weighs these buttons against each other is the channel's — Fists of Fury may not be spent
		// through an Energizing Brew *unless Rushing Jade Wind covers it* — and each of the three reads it
		// from its own end: Fists as a per-channel boolean, Energizing Brew as a brew that was or was not
		// covered, and this section as the clock for the button doing the covering, which neither of the
		// others has. Energizing Brew is filed with the brews above and says so; Fists is the half of the
		// pair the grouping could keep, and this sits directly under it.
		//
		// The level-90 sibling is handled the same way as Xuen above. Unknown talent selection keeps the
		// section visible; positive evidence for Invoke Xuen or Spinning Crane Kick removes it.
		{
			id: 'jade-wind',
			titleKey: 'jadeWind.title',
			group: 'abilities',
			Component: RushingJadeWind,
			modeProps: 'both',
			when: (analysis) => !excludedButtons(pressedButtons(analysis.casts)).has(116_847),
		},
		{ id: 'damage', titleKey: 'damage.title', group: 'abilities', Component: DamageByAbility },
		{ id: 'misses', titleKey: 'misses.title', group: 'abilities', Component: MissLedger },

		// Beside the gear, and immediately before it, because the two answer the same kind of question:
		// what the character walked into the pull carrying. Nothing in either is a rotation decision, and
		// most of this one is not even the player's — which is why it sits after everything that grades
		// them rather than among it.
		{ id: 'raid-buffs', titleKey: 'raidBuffs.title', group: 'reference', Component: RaidBuffs },
		// After the pull, before the method: it is the one section about the character rather than the
		// four minutes, so it reads as a footnote to the analysis rather than as part of it.
		{ id: 'gear', titleKey: 'gear.title', group: 'reference', Component: GearSetup },
		// Directly above the rotation reference, and the pair is the point: this section says what the
		// priority list wanted at each of your globals, and the one below it is the list itself. A reader
		// told they passed a button over needs somewhere to go and read what that button was for.
		{ id: 'priority', titleKey: 'priority.title', group: 'reference', Component: PriorityLadder, modeProps: 'forced' },
		// Reference, not analysis: it grades nothing and says nothing about how this pull went. It belongs
		// after everything that does grade, because it is where a reader goes once a section above has told
		// them a number was wrong and they want to know what right looked like. Not the same list for every
		// log, though — the rungs it draws are the ones the priority list has at this reader's target count,
		// minus the buttons this log proves were not on their bar.
		{ id: 'rotation', titleKey: 'rotation.title', group: 'reference', Component: Rotation, modeProps: 'live' },
		{ id: 'method', titleKey: 'method.title', group: 'reference', Component: Method },
	],
	elemental: [
		// First after the summary, because it is the pull itself: every press, every buff, one clock.
		{ id: 'cast-log', titleKey: 'castLog.title', group: 'core', Component: CastLog },
		// The same pull at a coarser grain: the auras without the presses, read against each other.
		{ id: 'timeline', titleKey: 'timeline.title', group: 'core', Component: ElementalPullTimeline },
		// The dot's payoff, directly under it: the proc-window reapplies are the whole reason the dot is
		// snapshotted rather than merely kept up.
		{ id: 'snapshots', titleKey: 'flameShockSnapshots.title', group: 'core', Component: Snapshots },
		// The pool the casts are paid from, beside the dot it gates — the one bar an Elemental has, and
		// the one that is never overcap but is sometimes empty.
		{
			id: 'mana',
			titleKey: 'mana.title',
			group: 'core',
			Component: resourceSection({
				id: 'mana',
				barKey: 'mana',
				copyPrefix: 'mana',
				tone: 'kick',
				color: ELEMENTAL_SPEC.colors.primary,
			}),
		},

		// The rotational presses, one section each: Flame Shock is the dot everything else is gated
		// on, Earth Shock spends the Lightning Shield counter, Searing Totem is the fire-and-forget,
		// and the cooldowns section holds Ascendance and the other long timers.
		{ id: 'flame-shock', titleKey: 'flameShock.title', group: 'abilities', Component: FlameShock },
		// Lava Burst is the dot's spender — the proc that makes it free is the section's own argument.
		{ id: 'lava-burst', titleKey: 'lavaBurst.title', group: 'abilities', Component: LavaBurst },
		{ id: 'earth-shock', titleKey: 'earthShock.title', group: 'abilities', Component: EarthShock },
		// The counter Earth Shock spends from, beside the shock it feeds. Together they are one economy:
		// the shield builds on Rolling Thunder and is spent whole by Fulmination, and the two sections
		// grade the two halves of that loop.
		{ id: 'lightning-shield', titleKey: 'lightningShield.title', group: 'abilities', Component: LightningShield },
		{ id: 'searing-totem', titleKey: 'searingTotem.title', group: 'abilities', Component: SearingTotem },
		{ id: 'cooldowns', titleKey: 'cooldowns.title', group: 'cooldowns', Component: Cooldowns },
		// The two summons beside the cooldowns: Fire Elemental synced with Ascendance (or prepull under
		// Heroism), Earth Elemental in the pull's last minute.
		{ id: 'fire-elemental', titleKey: 'fireElemental.title', group: 'cooldowns', Component: FireElemental },
		{ id: 'earth-elemental', titleKey: 'earthElemental.title', group: 'cooldowns', Component: EarthElemental },
		// The raid cooldown beside the personal ones: Stormlash is assigned across the raid's shamans,
		// and the overlap row is the section's whole point.
		{ id: 'stormlash', titleKey: 'stormlash.title', group: 'cooldowns', Component: Stormlash },

		// The generic tables: what dealt the damage, and every mistake with a link back to the replay.
		{ id: 'damage', titleKey: 'damage.title', group: 'abilities', Component: DamageByAbility },
		{ id: 'misses', titleKey: 'misses.title', group: 'abilities', Component: MissLedger },

		// Reference: what the character walked in carrying, and how the report reached its numbers.
		{ id: 'raid-buffs', titleKey: 'raidBuffs.title', group: 'reference', Component: RaidBuffs },
		{ id: 'gear', titleKey: 'gear.title', group: 'reference', Component: GearSetup },
		{ id: 'priority', titleKey: 'priority.title', group: 'reference', Component: PriorityLadder, modeProps: 'forced' },
		{ id: 'rotation', titleKey: 'rotation.title', group: 'reference', Component: ElementalRotation },
		{ id: 'method', titleKey: 'method.title', group: 'reference', Component: Method },
	],
};

// ---------------------------------------------------------------- the summary
//
// The summary block — the KPI tiles and the optional warning above them — is the spec's own, for the
// same reason the sections are: a Windwalker's headline is brew stacks and Rising Sun Kick uptime, an
// Elemental's is Flame Shock uptime and snapshot catches, and there is no generic tile between them.
// `Report` renders whichever the spec names here, keyed by the registry's own key.

/** One spec's headline block: the KPI tiles and the optional warning above them. */
export interface SpecSummary {
	kpi: ComponentType<{ analysis: Analysis }>;
	warning?: ComponentType<{ analysis: Analysis }>;
}

export const SPEC_SUMMARY: Record<string, SpecSummary | undefined> = {
	windwalker: { kpi: KpiTiles, warning: SummaryWarning },
	elemental: { kpi: ElementalKpiTiles },
};

/**
 * A spec-specific advice card, folded into the summary's short list ahead of the metric cards.
 *
 * The metric cards are derived from the scorecard and so are the same for every spec; advice is the
 * one card a spec writes by hand, for the case its own model can see that no metric expresses — the
 * Windwalker's "Energizing Brew through Bloodlust with Rushing Jade Wind, but never used to cover
 * it" is a play the ladder condones, so no threshold catches it, and a hand-written card is the only
 * route to a reader's eye.
 */
export interface AdviceTakeaway {
	kind: 'advice';
	key: string;
	section: string;
}

/** The spec-scoped half of `Takeaways`: where its sections live, and its hand-written advice. */
export interface SpecTakeaways {
	/** Scorecard section name → page anchor id, for the takeaway card's jump link. */
	anchors: Record<string, string>;
	advice?: (analysis: Analysis) => AdviceTakeaway[];
}

export const SPEC_TAKEAWAYS: Record<string, SpecTakeaways> = {
	windwalker: {
		// The scorecard names its sections for the thing they measure; the page names them for the id
		// a reader jumps to. The two lists were never going to be the same — `tigerPalm` is
		// `#tiger-palm`, `brew` is `#bank` — and a card that cannot take you to the section arguing its
		// case is a card that has to be taken on trust.
		anchors: {
			snapshots: 'snapshots',
			brew: 'bank',
			casts: 'cpm',
			debuff: 'debuff',
			tigerPalm: 'tiger-palm',
			energizingBrew: 'energizing',
			// The one card whose section is not a section. Nothing on the page argues the potion count in
			// prose — the evidence is the potion's own row on the timeline — so that is where the reader
			// is sent.
			potions: 'timeline',
		},
		advice: (analysis) => {
			const energizing = analysis.energizing;
			return energizing?.rushingJadeWind === true && energizing.hasteWindows.length > 0 && energizing.hasteRjwUses === 0
				? [{ kind: 'advice', key: 'energizingBrewRjw', section: 'energizingBrew' }]
				: [];
		},
	},
	elemental: {
		// The same join the Windwalker map makes, in the Elemental's own section ids. `casts` is absent
		// on purpose: the Elemental report draws no cast-rate section of its own yet, so the gcd card
		// has no heading to jump to and its takeaway renders without a link rather than being sent
		// somewhere that argues a different number.
		anchors: {
			flameShock: 'flame-shock',
			earthShock: 'earth-shock',
			searingTotem: 'searing-totem',
			flameShockSnapshots: 'snapshots',
		},
	},
};
