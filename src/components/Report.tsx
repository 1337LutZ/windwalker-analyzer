import { useMemo } from 'react';

import type { SpecDefinition } from '~/lib/spec';
import type { Analysis } from '~/lib/types';

import SectionNav, { type ReportSection } from './report/SectionNav';
import { SpecContext } from './report/specContext';
import { ScoreViewContext } from './report/scoreViewContext';
import { SPEC_SECTIONS, SPEC_SUMMARY } from './report/specSections';
import { resolveBands, resolveTargetMode, type TargetModeChoice } from '~/lib/view/targetMode';
import { ReportHeader, Scorecard, SegmentStrip, SpecRefusal, Takeaways } from './sections';

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
 * The report: headline figures, then the spec's sections, with a contents list beside them from
 * `lg` up.
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
 *
 * `spec` names the sections: the list is `SPEC_SECTIONS[spec.key]`, the same join the rest of the
 * page uses. A spec that has not shipped sections yet renders a report with nothing below the
 * summary, which is honest — there is no list to pretend there is a report under it.
 */
export default function Report({
	analysis,
	targetChoice,
	spec,
}: {
	analysis: Analysis;
	targetChoice: TargetModeChoice;
	spec: SpecDefinition;
}) {
	// Resolved rather than taken as given, per the argument in `lib/view/targetMode`: the choice is what
	// the reader asked for and the mode is what that means for this pull, and only the pull knows what
	// `auto` resolves to.
	const { mode } = resolveTargetMode(analysis.targets?.detected, targetChoice);
	const forcedMode = targetChoice === 'auto' ? null : mode;
	// The reading everything *graded* is read at, and the two resolutions are not the same answer. The
	// mode below this line goes only to the sections that select data by target count — one band each,
	// by their own argument — while every grade in the report comes off the band set, because a metric
	// is graded over a clock and a mixed pull's clock runs through several bands. `resolveBands` carries
	// the mode along inside the view, so the weights still get their whole-pull reading from the same
	// object the bands came on.
	//
	// The pull's own segments travel with it, so that a forced reading *can* cut the clocks and not only
	// the bands — see `BandView.spans`. Handed over here rather than left off because this is the one
	// place holding both halves: `resolveBands` will not go looking for a timeline it was not given,
	// deliberately, so every caller that omits it grades the whole pull whatever the reader asked for.
	//
	// **Populating it is not the same as reading it, and today nothing does.** No scoring call consumes
	// `BandView.spans` yet — `viewBands` and `viewMode` are the whole of what the engines take off a view
	// — so a forced reading still narrows the band set and leaves every clock running over the whole
	// pull. The field is here ahead of its first reader, which is the sequencing `spansForChoice` argues
	// for; until that reader exists, no copy may tell a reader their clocks were cut.
	//
	// Memoised because it is a provider value: a fresh object per render would re-render every graded
	// section in the report for a reading that had not changed.
	const scoreView = useMemo(
		() => resolveBands(analysis.targets, targetChoice, analysis.segments),
		[analysis, targetChoice],
	);
	// The sections this pull actually renders, and the list the nav is built from — one array, so a
	// section that declines to appear cannot leave a link behind pointing at a heading that is not
	// there. Memoised because `SectionNav` observes whatever it is handed and rebuilds its observer
	// whenever the array's identity changes, which a fresh `filter` per render would do every time.
	const sections = useMemo(
		() => (SPEC_SECTIONS[spec.key] ?? []).filter(({ when }) => when === undefined || when(analysis)),
		[analysis, spec],
	);
	const nav = useMemo<ReportSection[]>(() => [SUMMARY_NAV, ...sections], [sections]);
	const summary = SPEC_SUMMARY[spec.key];

	return (
		// The spec wraps everything, because every section scores and reads its copy through it; the
		// reading nests inside it, because the scorecard is also a function of that value — so a
		// summary rendered outside either provider would grade the pull differently from the detail
		// underneath it.
		//
		// The refusal is *inside* the provider, and used to be an early return above it. It was safe
		// there only by accident: `SpecRefusal` takes the spec as a prop and calls no scoring hook, so it
		// happened not to need the context it did not have. One edit putting a `useReportCopy` consumer
		// on that path would have thrown — the context refuses to guess now — and there is no reason for
		// a render path to sit outside the provider in the first place.
		<SpecContext.Provider value={spec}>
			<ScoreViewContext.Provider value={scoreView}>
				{!analysis.isSpec ? (
					<SpecRefusal analysis={analysis} spec={spec} />
				) : (
					<div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8">
						<SectionNav sections={nav} />
						<article className="flex flex-col gap-10 md:gap-12">
							{/* A section so the nav's observer can find it the same way it finds every other one:
				    by the id on its heading, then the section around it. Labelled by that heading rather
				    than by a string of its own, so there is one name for it and not two. */}
							<section aria-labelledby="summary-heading" className="flex flex-col gap-10 md:gap-12">
								<ReportHeader analysis={analysis} />
								{summary?.warning ? <summary.warning analysis={analysis} /> : null}
								{summary ? <summary.kpi analysis={analysis} /> : null}
								{/* Derived from the same scorecard every section below reads, so the short list at the top
					    cannot drift out of agreement with the detail underneath it. */}
								<Takeaways analysis={analysis} />
								{/* Under the short list, because the two answer different questions and in this order: the
					    cards say *what to fix first*, and this says *how everything scored*. A reader who
					    trusts the short list never has to read past it; a reader who wants to see where the
					    other twenty numbers landed, or how badly one of the three actually missed, has the
					    bands here. Both are ordered by the same question — see `headroom` — so the first card
					    above and the first card here are about the same section. */}
								<Scorecard analysis={analysis} />
								{/* Last in the summary, and below the short list rather than above it: the tiles and the
					    cards are the verdict on the pull, and this is the shape of the pull they were read
					    over — so it reads as the lead-in to the sections underneath rather than as a third
					    figure competing with them. It renders nothing at all on a pull that never changed
					    shape, which is why it is not conditioned here. */}
								<SegmentStrip analysis={analysis} />
							</section>
							{sections.map((section) =>
								// Still props, and the mode rather than the band set, because these sections differ from
								// every other in both ways. Every other section reads the reading *indirectly*, through
								// the scorecard that grades and weights its metrics, and that reading is the set;
								// `modeProps` marks the ones that use it to select what is rendered at all — which of the
								// precomputed audits, and which rungs of the priority list exist at that count. Those
								// want one band and say so, which is what `bandForMode` is for. A prop says that at the
								// call site, where reading context would hide the places the choice picks data rather
								// than regrading it.
								//
								// They take the same value for that reason: the priority list is judged at the reader's
								// target count, the rotation reference prints the list that count produces, and the
								// verdict-quoting sections have to agree with the ladder about whether the list wanted
								// their button — so a reader sent from a skip to the reference arrives at a list that
								// contained the button. `modeProps` is which of the two readings the section needs:
								// `'live'` (the resolved mode), `'forced'` (only when the reader chose one, null under
								// auto), or `'both'`. Narrowed through the section object rather than destructured, so
								// the discriminator stays correlated with its `Component`'s props.
								section.modeProps === undefined ? (
									<section.Component key={section.id} analysis={analysis} />
								) : section.modeProps === 'live' ? (
									<section.Component key={section.id} analysis={analysis} mode={mode} />
								) : section.modeProps === 'forced' ? (
									<section.Component key={section.id} analysis={analysis} forcedMode={forcedMode} />
								) : (
									<section.Component key={section.id} analysis={analysis} mode={mode} forcedMode={forcedMode} />
								),
							)}
						</article>
					</div>
				)}
			</ScoreViewContext.Provider>
		</SpecContext.Provider>
	);
}
