import { useTranslation } from 'react-i18next';

import { ranked, type SectionGap } from '~/lib/compare';
import i18n from '~/lib/i18n/config';

import { ChartFigure } from '../primitives';

import MetricRow from './MetricRow';
import PullKey from './PullKey';

/**
 * Where the two pulls differ: a card per part of the pull, a line per figure inside it.
 *
 * **Every scale here is the figure's own, and that is the whole design.** The rails used to carry a
 * signed distance on one shared axis, in multiples of the gap between a figure's two targets — a real
 * quantity, and one that could not be written down: `readerVoice.test.ts` keeps `band` and `rule` out
 * of anything a reader is shown, so the axis ran `4 2 0 2 4` with no unit anywhere on the page and no
 * way to add one. An axis whose unit cannot be named is an axis that does not work, and it was asked
 * about twice before it came out.
 *
 * What replaced it is the scale each figure is already graded on: the zones with both logs marked,
 * which is `CompareScale`. Nothing on a card needs explaining now, because every number on it is in
 * the unit the figure is measured in, and the target line says where the line sits.
 *
 * **What that costs, stated plainly.** The old rail let a reader see that one figure was a wider gap
 * than another, across cards. That is gone: two dumbbells on two different scales cannot be compared
 * by eye. It survives in the *ordering* instead — `ranked` puts the card holding the widest single
 * disagreement first — which is the reading worth having, and the one an index owes a reader.
 *
 * **It also folded a duplicate away.** A "Figure by figure" section listed these same figures with
 * these same readings on these same scales, in report order rather than ranked. Two passes over
 * identical rows is one too many, and the cards are the pass that also says where to start.
 *
 * Cards are HTML rather than a chart library. `conventions.md` sends charts to ApexCharts and forbids a
 * hand-built SVG one; this is neither, it is the same shape `BandScale` and `Bar` are already built
 * from — a few divs — and staying in HTML keeps the labels out of SVG text, which that document warns
 * about specifically.
 */
export default function SectionGaps({
	sections,
	players,
}: {
	sections: readonly SectionGap[];
	players: { a: string; b: string };
}) {
	const { t } = useTranslation('report');
	const rows = ranked(sections);
	if (rows.length === 0) return null;

	return (
		<ChartFigure
			gap="wide"
			caption={
				<>
					<PullKey side="a">
						<span className="text-sm text-muted">{players.a}</span>
					</PullKey>
					<PullKey side="b">
						<span className="text-sm text-muted">{players.b}</span>
					</PullKey>
				</>
			}
			note={t('compare.gaps.axis')}
		>
			<ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
				{rows.map((group) => {
					// Spelled `section`, matching the idiom `Scorecard` titles a card with: the key guard skips
					// this prefix by name, because it is a section arriving at runtime and not a key family.
					const section = group.key;
					const title = i18n.exists(`${section}.title`) ? t(`${section}.title`) : section;

					return (
						<li key={section} className="contents">
							{/* Not a link any more. It used to jump to the section that argued this one at length, and
							    that section has gone — these cards are it. A control that goes nowhere is worse than
							    none, and `jumpToHeading` answers false for a heading that is not on the page, which is
							    silent. */}
							<div className="flex h-full flex-col gap-3 rounded-sm border border-line p-3.5">
								<span className="font-mono text-sm font-medium tracking-[0.1em] uppercase text-ink-2">{title}</span>
								<ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
									{group.metrics.map((gap) => (
										<MetricRow key={gap.key} gap={gap} players={players} />
									))}
								</ul>
							</div>
						</li>
					);
				})}
			</ul>
		</ChartFigure>
	);
}
