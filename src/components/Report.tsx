import { useMemo, type ComponentType } from 'react';

import type { Analysis } from '~/lib/types';

import SectionNav, { type ReportSection } from './report/SectionNav';
import { TargetModeContext } from './report/targetModeContext';
import { resolveTargetMode, type TargetModeChoice } from '~/lib/view/targetMode';
import { excludedButtons, pressedButtons } from '~/lib/view/rotationFlow';
import {
	BlackoutKick,
	BrewBankTimeline,
	CastLog,
	CastsPerMinute,
	DamageByAbility,
	EnergizingBrew,
	Chi,
	ChiBrew,
	Energy,
	FistsOfFury,
	GearSetup,
	KpiTiles,
	Method,
	MissLedger,
	PriorityLadder,
	PullTimeline,
	RaidBuffs,
	RisingSunKick,
	ReportHeader,
	Rotation,
	RushingJadeWind,
	SnapshotTable,
	SpecRefusal,
	StormEarthAndFire,
	SummaryWarning,
	Takeaways,
	TigerPalm,
	TouchOfKarma,
	Xuen,
} from './sections';

/**
 * The report's titled sections, in the order docs/component-specs.md sets: the pull itself, then the
 * economy that paid for it, then the buttons one at a time, then the reference a reader lands on once
 * a section above has told them a number was wrong.
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
const SECTIONS: (ReportSection & {
	Component: ComponentType<{ analysis: Analysis }>;
	when?: (analysis: Analysis) => boolean;
})[] = [
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
	{ id: 'energy', titleKey: 'energy.title', group: 'core', Component: Energy },
	// Beside energy, because the two are one economy read from opposite ends: energy is a pool that
	// refills on a clock and wastes by the second, chi arrives in whole points from a press and wastes
	// by the point. Split apart they read as two unrelated bars; together the reader can see that a
	// full energy bar and an overflowing chi bar are the same global going missing.
	{ id: 'chi', titleKey: 'chi.title', group: 'core', Component: Chi },

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
	{ id: 'blackout-kick', titleKey: 'blackoutKick.title', group: 'abilities', Component: BlackoutKick },
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
	{ id: 'priority', titleKey: 'priority.title', group: 'reference', Component: PriorityLadder },
	// Reference, not analysis: it grades nothing and says nothing about how this pull went. It belongs
	// after everything that does grade, because it is where a reader goes once a section above has told
	// them a number was wrong and they want to know what right looked like. Not the same list for every
	// log, though — the rungs it draws are the ones the priority list has at this reader's target count,
	// minus the buttons this log proves were not on their bar.
	{ id: 'rotation', titleKey: 'rotation.title', group: 'reference', Component: Rotation },
	{ id: 'method', titleKey: 'method.title', group: 'reference', Component: Method },
];

/**
 * The summary entry, which is nav-only.
 *
 * It has no `Component` because it is not a `Section` — it is the header and the tiles, which have no
 * heading of their own and are rendered directly below. It still needs to be reachable, though;
 * landing back at the top of a long report is exactly what a contents list is for.
 *
 * Which is also why its group is `null`: it is listed above the groups and never inside one. A way
 * back to the top that a reader has to open a disclosure to reach is not a way back to the top.
 */
const SUMMARY_NAV: ReportSection = { id: 'summary', titleKey: 'summary.title', group: null };

/**
 * The report: headline figures, then the sections above, with a contents list beside them from `lg`
 * up.
 *
 * Composition only. Every section owns its own derivations and its own "nothing to report" state,
 * which is what keeps a clean pull from rendering as a page of empty shells. The wrong-spec refusal
 * returns before any of them, and no hook runs in this file, so nothing sits behind that condition.
 *
 * The grid exists only from `lg`: below it the wrapper is an ordinary block, the nav is not
 * rendered, and the article is laid out exactly as it was. The page's own container — its max width
 * and its centring — is `Analyzer`'s and is not touched here; all the grid does is spend part of the
 * width the report already had.
 *
 * `targetChoice` arrives as a prop and is still resolved and provided here. The control that sets it
 * moved to the sticky toolbar, which is a sibling of this component rather than a child, so the state
 * had to rise to their common parent — but the provider did not follow it there. Every section reads
 * its grades through this context, so the provider belongs where the sections are.
 */
export default function Report({ analysis, targetChoice }: { analysis: Analysis; targetChoice: TargetModeChoice }) {
	// Resolved rather than taken as given, per the argument in `lib/view/targetMode`: the choice is what
	// the reader asked for and the mode is what that means for this pull, and only the pull knows what
	// `auto` resolves to.
	const { mode } = resolveTargetMode(analysis.targets?.detected, targetChoice);
	const forcedMode = targetChoice === 'auto' ? null : mode;
	// The sections this pull actually renders, and the list the nav is built from — one array, so a
	// section that declines to appear cannot leave a link behind pointing at a heading that is not
	// there. Memoised because `SectionNav` observes whatever it is handed and rebuilds its observer
	// whenever the array's identity changes, which a fresh `filter` per render would do every time.
	const sections = useMemo(() => SECTIONS.filter(({ when }) => when === undefined || when(analysis)), [analysis]);
	const nav = useMemo<ReportSection[]>(() => [SUMMARY_NAV, ...sections], [sections]);

	if (!analysis.isSpec) return <SpecRefusal analysis={analysis} />;

	return (
		// The reading wraps the whole report, not just the sections below the control. Every section
		// reads its grades and its copy from the scorecard, and the scorecard is now a function of this
		// value — so a summary rendered outside the provider would grade the pull one way while the
		// detail underneath it graded the same pull another.
		<TargetModeContext.Provider value={mode}>
			<div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8">
				<SectionNav sections={nav} />
				<article className="flex flex-col gap-10 md:gap-12">
					{/* A section so the nav's observer can find it the same way it finds every other one:
				    by the id on its heading, then the section around it. Labelled by that heading rather
				    than by a string of its own, so there is one name for it and not two. */}
					<section aria-labelledby="summary-heading" className="flex flex-col gap-10 md:gap-12">
						<ReportHeader analysis={analysis} />
						<SummaryWarning analysis={analysis} />
						<KpiTiles analysis={analysis} />
						{/* Derived from the same scorecard every section below reads, so the short list at the top
					    cannot drift out of agreement with the detail underneath it. */}
						<Takeaways analysis={analysis} />
					</section>
					{sections.map(({ id, Component }) =>
						// Still props, though the mode is in context now, because these three uses differ from
						// every other. Every other section reads the mode *indirectly*, through the scorecard that
						// weights its metrics; these three use it to select what is rendered at all — which of the
						// precomputed audits, and which rungs of the priority list exist at that count. A prop says
						// that at the call site, where reading context would hide the places the choice picks data
						// rather than reweighting it.
						//
						// They take the same value for that reason: `PriorityLadder` judges every press at the
						// reader's target count, `Rotation` prints the list that count produces, and
						// `RushingJadeWind` and `BlackoutKick` quote the ladder's verdict on one button's presses —
						// and all four map it through the same `bandForMode`. A reader sent from a skip to the
						// reference has to arrive at a list that contained the button, and the button's own section
						// has to agree with the ladder about whether the list wanted it.
						id === 'priority' ? (
							<PriorityLadder key={id} analysis={analysis} forcedMode={forcedMode} />
						) : id === 'rotation' ? (
							<Rotation key={id} analysis={analysis} mode={mode} />
						) : id === 'jade-wind' ? (
							<RushingJadeWind key={id} analysis={analysis} mode={mode} forcedMode={forcedMode} />
						) : id === 'blackout-kick' ? (
							<BlackoutKick key={id} analysis={analysis} forcedMode={forcedMode} />
						) : (
							<Component key={id} analysis={analysis} />
						),
					)}
				</article>
			</div>
		</TargetModeContext.Provider>
	);
}
