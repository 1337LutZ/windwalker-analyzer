import type { ComponentType } from 'react';

import type { Analysis } from '~/lib/types';

import SectionNav, { type ReportSection } from './report/SectionNav';
import {
	BrewBankTimeline,
	CastsPerMinute,
	DamageByAbility,
	FistsOfFury,
	KpiTiles,
	Method,
	MissLedger,
	PullTimeline,
	RisingSunKick,
	ReportHeader,
	SnapshotTable,
	SpecRefusal,
	TigerPalm,
	TouchOfKarma,
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
	{ id: 'bank', titleKey: 'brew.title', Component: BrewBankTimeline },
	{ id: 'cpm', titleKey: 'casts.title', Component: CastsPerMinute },
	{ id: 'debuff', titleKey: 'debuff.title', Component: RisingSunKick },
	{ id: 'fof', titleKey: 'fistsOfFury.title', Component: FistsOfFury },
	{ id: 'tiger-palm', titleKey: 'tigerPalm.title', Component: TigerPalm },
	{ id: 'karma', titleKey: 'karma.title', Component: TouchOfKarma },
	{ id: 'damage', titleKey: 'damage.title', Component: DamageByAbility },
	{ id: 'misses', titleKey: 'misses.title', Component: MissLedger },
	{ id: 'method', titleKey: 'method.title', Component: Method },
];

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
			<SectionNav sections={SECTIONS} />
			<article className="flex flex-col gap-10 md:gap-12">
				<ReportHeader analysis={analysis} />
				<KpiTiles analysis={analysis} />
				{SECTIONS.map(({ id, Component }) => (
					<Component key={id} analysis={analysis} />
				))}
			</article>
		</div>
	);
}
