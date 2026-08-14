import type { ComponentType } from 'react';

import type { Analysis } from '~/lib/types';

import SectionNav, { type ReportSection } from './report/SectionNav';
import {
	BrewBankTimeline,
	CastLog,
	CastsPerMinute,
	DamageByAbility,
	EnergizingBrew,
	Chi,
	Energy,
	FistsOfFury,
	GearSetup,
	KpiTiles,
	Method,
	MissLedger,
	PullTimeline,
	RaidBuffs,
	RisingSunKick,
	ReportHeader,
	Rotation,
	SnapshotTable,
	SpecRefusal,
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
 */
const SECTIONS: (ReportSection & { Component: ComponentType<{ analysis: Analysis }> })[] = [
	// First after the summary, because it is the pull itself: every press, every buff, one clock. A
	// reader who has just been handed a verdict wants to see what actually happened before they are
	// shown any argument about it, and every section below this one is an argument about some slice of
	// this chart.
	{ id: 'cast-log', titleKey: 'castLog.title', Component: CastLog },
	// The same four minutes at a coarser grain: the timeline above shows the buttons, this shows the
	// windows they were pressed inside. Reading them the other way round — windows first — meant
	// naming a mechanic before the reader had seen a single press.
	{ id: 'timeline', titleKey: 'timeline.title', Component: PullTimeline },
	{ id: 'snapshots', titleKey: 'snapshots.title', Component: SnapshotTable },

	// How the globals were spent, then what paid for them. Together these two are the whole economy of
	// the pull: the rate says whether the buttons were pressed, the bars say whether there was anything
	// to press them with — and a low cast rate means something different depending on which.
	{ id: 'cpm', titleKey: 'casts.title', Component: CastsPerMinute },
	{ id: 'energy', titleKey: 'energy.title', Component: Energy },
	// Beside energy, because the two are one economy read from opposite ends: energy is a pool that
	// refills on a clock and wastes by the second, chi arrives in whole points from a press and wastes
	// by the point. Split apart they read as two unrelated bars; together the reader can see that a
	// full energy bar and an overflowing chi bar are the same global going missing.
	{ id: 'chi', titleKey: 'chi.title', Component: Chi },

	// ---------------------------------------------------------------- the buttons, one section each
	//
	// Everything below here judges a single ability, ordered by how much a Windwalker's damage moves
	// when it goes wrong rather than by when it is pressed. Grouped rather than scattered because a
	// reader arrives at this part of the report holding a button, not a moment.
	//
	// Tigereye Brew first: it multiplies everything else in the list, so a mistake here is the only one
	// that costs damage the other sections have already counted.
	{ id: 'bank', titleKey: 'brew.title', Component: BrewBankTimeline },
	{ id: 'debuff', titleKey: 'debuff.title', Component: RisingSunKick },
	{ id: 'fof', titleKey: 'fistsOfFury.title', Component: FistsOfFury },
	// Directly under the channel, because the two share a condition: the priority list will not
	// channel Fists of Fury through an Energizing Brew unless Rushing Jade Wind covers it, and each
	// section counts the same overlap from its own side. Reading them apart loses that.
	{ id: 'energizing', titleKey: 'energizingBrew.title', Component: EnergizingBrew },
	{ id: 'tiger-palm', titleKey: 'tigerPalm.title', Component: TigerPalm },
	// Last of the damage cooldowns, because it is the one with no placement to judge: the sim fires it
	// from an unconditional autocast, so it follows the sections that do grade placement rather than
	// sitting among them.
	{ id: 'xuen', titleKey: 'xuen.title', Component: Xuen },
	// The defensive, and so the last button: it is the only one here that is not trying to do damage.
	{ id: 'karma', titleKey: 'karma.title', Component: TouchOfKarma },
	{ id: 'damage', titleKey: 'damage.title', Component: DamageByAbility },
	{ id: 'misses', titleKey: 'misses.title', Component: MissLedger },
	// Beside the gear, and immediately before it, because the two answer the same kind of question:
	// what the character walked into the pull carrying. Nothing in either is a rotation decision, and
	// most of this one is not even the player's — which is why it sits after everything that grades
	// them rather than among it.
	{ id: 'raid-buffs', titleKey: 'raidBuffs.title', Component: RaidBuffs },
	// After the pull, before the method: it is the one section about the character rather than the
	// four minutes, so it reads as a footnote to the analysis rather than as part of it.
	{ id: 'gear', titleKey: 'gear.title', Component: GearSetup },
	// Reference, not analysis: it says nothing about this pull and renders the same for every log. It
	// belongs after everything that grades, because it is where a reader goes once a section above has
	// told them a number was wrong and they want to know what right looked like.
	{ id: 'rotation', titleKey: 'rotation.title', Component: Rotation },
	{ id: 'method', titleKey: 'method.title', Component: Method },
];

/**
 * The contents list, which is the sections plus the summary at the top of the report.
 *
 * The summary is nav-only: it has no `Component` because it is not a `Section` — it is the header
 * and the tiles, which have no heading of their own and are rendered directly below. It still needs
 * to be reachable, though; landing back at the top of a long report is exactly what a contents list
 * is for.
 */
const NAV: ReportSection[] = [{ id: 'summary', titleKey: 'summary.title' }, ...SECTIONS];

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
	if (!analysis.isSpec) return <SpecRefusal analysis={analysis} />;

	return (
		<div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8">
			<SectionNav sections={NAV} />
			<article className="flex flex-col gap-10 md:gap-12">
				{/* A section so the nav's observer can find it the same way it finds every other one:
				    by the id on its heading, then the section around it. Labelled by that heading rather
				    than by a string of its own, so there is one name for it and not two. */}
				<section aria-labelledby="summary-heading" className="flex flex-col gap-10 md:gap-12">
					<ReportHeader analysis={analysis} />
					<KpiTiles analysis={analysis} />
				</section>
				{SECTIONS.map(({ id, Component }) => (
					<Component key={id} analysis={analysis} />
				))}
			</article>
		</div>
	);
}
