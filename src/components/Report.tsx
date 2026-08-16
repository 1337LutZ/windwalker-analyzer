import { useMemo, useState, type ComponentType } from 'react';

import type { Analysis } from '~/lib/types';

import SectionNav, { type ReportSection } from './report/SectionNav';
import { TargetModeContext } from './report/targetModeContext';
import TargetModeControl from './report/TargetModeControl';
import { resolveTargetMode, type TargetModeChoice } from '~/lib/view/targetMode';
import {
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
	Takeaways,
	TigerPalm,
	TouchOfKarma,
	Xuen,
} from './sections';

/**
 * The report's titled sections, in the order docs/component-specs.md sets: the snapshot the whole
 * spec turns on, then the two clocks that show it happening, then the rotation, then the ledger of
 * what went wrong.
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

	// ---------------------------------------------------------------- the buttons, one section each
	//
	// Everything below here judges a single ability, ordered by how much a Windwalker's damage moves
	// when it goes wrong rather than by when it is pressed. Grouped rather than scattered because a
	// reader arrives at this part of the report holding a button, not a moment.
	//
	// Tigereye Brew first: it multiplies everything else in the list, so a mistake here is the only one
	// that costs damage the other sections have already counted.
	{ id: 'bank', titleKey: 'brew.title', group: 'cooldowns', Component: BrewBankTimeline },
	// Directly under the bank it feeds: Chi Brew's two stacks a press are the only source of brew that
	// is not chi spent, so a reader looking at a bank that filled slowly wants this row next.
	{ id: 'chi-brew', titleKey: 'chiBrew.title', group: 'cooldowns', Component: ChiBrew },
	{ id: 'debuff', titleKey: 'debuff.title', group: 'abilities', Component: RisingSunKick },
	{ id: 'fof', titleKey: 'fistsOfFury.title', group: 'abilities', Component: FistsOfFury },
	// Directly under the channel, because the two share a condition: the priority list will not
	// channel Fists of Fury through an Energizing Brew unless Rushing Jade Wind covers it, and each
	// section counts the same overlap from its own side. Reading them apart loses that.
	{ id: 'energizing', titleKey: 'energizingBrew.title', group: 'cooldowns', Component: EnergizingBrew },
	// The third side of that triangle, and placed here for it. The priority list's one rule that weighs
	// these buttons against each other is the channel's — Fists of Fury may not be spent through an
	// Energizing Brew *unless Rushing Jade Wind covers it* — and the two sections above each read that
	// rule from their own end, as a per-channel boolean and as a talent the build either has or has not.
	// Neither of them has a clock for the button, which is what this one is.
	//
	// No `when`, unlike Storm, Earth and Fire above. That section may decline because pressing nothing
	// at one target is correct play and there is no verdict to give; here there is one either way. A
	// monk who took the wind is owed the uptime and what it cost, and a monk who did not is owed the
	// sentence saying so — the button shares a talent row with Invoke Xuen, so on a report where the
	// Xuen section is populated an absent heading here would read as a section that failed rather than
	// as the other half of one choice. What it must never do is print that absence as a zero, and that
	// is the section's own job rather than a gate's.
	{ id: 'jade-wind', titleKey: 'jadeWind.title', group: 'abilities', Component: RushingJadeWind },
	{ id: 'tiger-palm', titleKey: 'tigerPalm.title', group: 'abilities', Component: TigerPalm },
	// Last of the damage cooldowns, because it is the one with no placement to judge: the sim fires it
	// from an unconditional autocast, so it follows the sections that do grade placement rather than
	// sitting among them.
	// Filed under cooldowns rather than abilities, along with Touch of Karma below. The nav groups by
	// what a button *is* to the player pressing it — something on a long timer you spend, not a
	// rotational press — while this list's order stays the reading order the report argues in. The two
	// do not have to agree, and here they do not: both sections keep their place on the page.
	{ id: 'xuen', titleKey: 'xuen.title', group: 'cooldowns', Component: Xuen },
	// Beside the other summon, and the only section in the list that can decline to appear. Storm,
	// Earth and Fire is a multi-target button: on a single-target pull it is correct never to press it,
	// so a heading saying "not pressed, and rightly" on every Garrosh kill would be a line of noise on
	// most reports. It renders when the spirits went out, and when they did not but the pull held a
	// second enemy long enough that they should have.
	{
		id: 'sef',
		titleKey: 'sef.title',
		group: 'abilities',
		Component: StormEarthAndFire,
		when: (analysis) => Boolean(analysis.sef && (analysis.sef.casts > 0 || analysis.sef.justified)),
	},
	// The defensive, and so the last button: it is the only one here that is not trying to do damage.
	{ id: 'karma', titleKey: 'karma.title', group: 'cooldowns', Component: TouchOfKarma },
	// Both are indexed by button: the table breaks the pull's damage down by ability and the ledger
	// names the abilities that missed, so they sit with the sections that grade a button rather than
	// starting a group of their own for two tables that answer the same question the others do.
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
 */
export default function Report({ analysis }: { analysis: Analysis }) {
	// View state, per the argument in `lib/view/targetMode`: it changes which reading the report argues
	// from, never anything the engine measured, so it lives for as long as this report is on screen and
	// no longer. `useState` before the refusal below would be a conditional hook, so the refusal moved
	// above it rather than the hook below.
	const [targetChoice, setTargetChoice] = useState<TargetModeChoice>('auto');
	const { mode } = resolveTargetMode(analysis.targets?.detected, targetChoice);
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
					{/* Above the summary rather than below it, because it qualifies everything that follows and a
				    control that changes a reading has to be visible before the reading is read. It sits
				    outside the summary section so it is not announced as part of it — it is a control on the
				    report, not one of the report's findings. */}
					<TargetModeControl targets={analysis.targets} value={targetChoice} onChange={setTargetChoice} />
					{/* A section so the nav's observer can find it the same way it finds every other one:
				    by the id on its heading, then the section around it. Labelled by that heading rather
				    than by a string of its own, so there is one name for it and not two. */}
					<section aria-labelledby="summary-heading" className="flex flex-col gap-10 md:gap-12">
						<ReportHeader analysis={analysis} />
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
						// `RushingJadeWind` quotes the ladder's verdict on one button's presses — and all three map
						// it through the same `bandForMode`. A reader sent from a skip to the reference has to
						// arrive at a list that contained the button, and the button's own section has to agree with
						// the ladder about whether the list wanted it.
						id === 'priority' ? (
							<PriorityLadder key={id} analysis={analysis} mode={mode} />
						) : id === 'rotation' ? (
							<Rotation key={id} analysis={analysis} mode={mode} />
						) : id === 'jade-wind' ? (
							<RushingJadeWind key={id} analysis={analysis} mode={mode} />
						) : (
							<Component key={id} analysis={analysis} />
						),
					)}
				</article>
			</div>
		</TargetModeContext.Provider>
	);
}
