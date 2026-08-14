import type { ComponentType } from 'react';

import type { Analysis } from '~/lib/types';

import SectionNav, { type ReportSection } from './report/SectionNav';
import {
	BrewBankTimeline,
	CastLog,
	CastsPerMinute,
	DamageByAbility,
	EnergizingBrew,
	Energy,
	FistsOfFury,
	GearSetup,
	KpiTiles,
	Method,
	MissLedger,
	PullTimeline,
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
	{ id: 'snapshots', titleKey: 'snapshots.title', Component: SnapshotTable },
	{ id: 'timeline', titleKey: 'timeline.title', Component: PullTimeline },
	// Straight after the mechanics clock, because it is the same four minutes at a finer grain: that
	// one shows the windows, this one shows the buttons pressed inside them.
	{ id: 'cast-log', titleKey: 'castLog.title', Component: CastLog },
	{ id: 'bank', titleKey: 'brew.title', Component: BrewBankTimeline },
	{ id: 'cpm', titleKey: 'casts.title', Component: CastsPerMinute },
	{ id: 'debuff', titleKey: 'debuff.title', Component: RisingSunKick },
	{ id: 'fof', titleKey: 'fistsOfFury.title', Component: FistsOfFury },
	// Directly under the channel, because the two share a condition: the priority list will not
	// channel Fists of Fury through an Energizing Brew unless Rushing Jade Wind covers it, and each
	// section counts the same overlap from its own side. Reading them apart loses that.
	{ id: 'energizing', titleKey: 'energizingBrew.title', Component: EnergizingBrew },
	// After the button that hands energy back, because it is the same resource read from the other
	// end: that section grades a press it cannot see the bar behind, this one shows the bar. It sits
	// here rather than beside the cast rate because what it measures is a resource sitting unspent,
	// which is only legible once the reader has seen what spends it.
	{ id: 'energy', titleKey: 'energy.title', Component: Energy },
	{ id: 'tiger-palm', titleKey: 'tigerPalm.title', Component: TigerPalm },
	// Last of the damage cooldowns, because it is the one with no placement to judge: the sim fires it
	// from an unconditional autocast, so it follows the sections that do grade placement rather than
	// sitting among them.
	{ id: 'xuen', titleKey: 'xuen.title', Component: Xuen },
	{ id: 'karma', titleKey: 'karma.title', Component: TouchOfKarma },
	{ id: 'damage', titleKey: 'damage.title', Component: DamageByAbility },
	{ id: 'misses', titleKey: 'misses.title', Component: MissLedger },
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
