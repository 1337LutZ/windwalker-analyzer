import { useMemo } from 'react';

import type { SpecDefinition } from '~/lib/spec';
import type { Analysis } from '~/lib/types';

import SectionNav, { type ReportSection } from './report/SectionNav';
import { SpecContext } from './report/specContext';
import { TargetModeContext } from './report/targetModeContext';
import { SPEC_SECTIONS, SPEC_SUMMARY } from './report/specSections';
import { resolveTargetMode, type TargetModeChoice } from '~/lib/view/targetMode';
import { ReportHeader, SpecRefusal, Takeaways } from './sections';

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

	if (!analysis.isSpec) return <SpecRefusal analysis={analysis} spec={spec} />;

	return (
		// The spec wraps everything, because every section scores and reads its copy through it; the
		// reading nests inside it, because the scorecard is also a function of that value — so a
		// summary rendered outside either provider would grade the pull differently from the detail
		// underneath it.
		<SpecContext.Provider value={spec}>
			<TargetModeContext.Provider value={mode}>
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
						</section>
						{sections.map((section) =>
							// Still props, though the mode is in context now, because these sections differ from
							// every other. Every other section reads the mode *indirectly*, through the scorecard
							// that weights its metrics; `modeProps` marks the ones that use it to select what is
							// rendered at all — which of the precomputed audits, and which rungs of the priority
							// list exist at that count. A prop says that at the call site, where reading context
							// would hide the places the choice picks data rather than reweighting it.
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
			</TargetModeContext.Provider>
		</SpecContext.Provider>
	);
}
