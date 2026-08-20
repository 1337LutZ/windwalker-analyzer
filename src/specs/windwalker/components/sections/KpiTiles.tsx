import { useReportCopy } from '~/hooks/useReportCopy';
import { formatDecimal, formatPercentValue, formatSeconds } from '~/lib/format';
import type { Analysis } from '~/lib/types';

import PaceTiles from '~/components/sections/PaceTiles';
import { StatTile, StatTiles } from '~/components/primitives';

/** The headline numbers the rest of the report explains. */
export default function KpiTiles({ analysis }: { analysis: Analysis }) {
	const { brew, debuff, procs, potions } = analysis;
	// `toneOf` is the grade behind one tile's own number, from the hook — see its doc there for why a
	// tile is coloured by its metric rather than by the section the metric sits in.
	const { t, toneOf } = useReportCopy(analysis);

	return (
		// A tile value is a number in its own box, not a sentence, so it is formatted here rather than
		// through the copy layer — only prose has to go through the JSON to stay translatable.
		<section aria-label={t('kpi.label')}>
			<StatTiles>
				{/* Damage, cast rate and how full the globals were — the three every spec opens with, and
				    the only three read off the part of an analysis every spec shares. */}
				<PaceTiles analysis={analysis} />
				<StatTile
					value={formatDecimal(brew.avgConsumed)}
					suffix="/10"
					label={t('kpi.brewStacks')}
					grade={toneOf('brewStacks')}
				/>
				{/* The graded figure, not the primary target's raw uptime over pull length — which is what this
				    showed while wearing the grade of a number it was not displaying. The two are not close on
				    an add fight: a Galakras pull reads 97.5% one way and 80.7% the other, and the section
				    below argues from the second. A headline that disagrees with the section it summarises
				    sends a reader looking for which of the two is lying. */}
				<StatTile
					value={formatPercentValue(debuff.engagedUptimePct)}
					label={t('kpi.rskUptime')}
					grade={toneOf('rskUptime')}
				/>
				{/* Graded on depth rather than on the catch rate: this tile counts the ones held inside
				    the leeway window, which is the timing question, not the discipline one. The label
				    carries the leeway actually used, because "last GCD" is only its name at the
				    default — the same reason the depth chart's band is labelled the way it is. */}
				<StatTile
					value={`${procs.lastGcd}`}
					suffix={`/${procs.procs}`}
					label={t('kpi.snapshots', { leeway: formatSeconds(procs.lastGcdMs) })}
					grade={toneOf('snapshotDepth')}
				/>
				{/* A tile rather than a sentence somewhere, and a tile that appears whatever the answer is.
				    Drinking both potions is correct play and has to read as a fact — a figure that only
				    surfaced when it was missing would make the report silent on everyone who got it right,
				    and would turn the summary's short list into the only place it was ever mentioned.

				    `value` + `suffix` and the count in the label, which is the shape every ratio on this page
				    already takes — the brew tile above reads `7.4/10 avg brew stacks` by exactly this route.
				    So the figure reads `2/2 potions used`, and the summary card says the same five words.

				    An em dash, not a zero, when the pull could not say, and a label of its own to go with it:
				    a fight that ended before both slots were on offer has no count, and `0/2 potions used`
				    over it would be the invented fault the metric's own `measurable` flag exists to prevent.
				    `toneOf` already returns null there, so the tile is uncoloured either way. Fixtures
				    captured before the audit existed take the same branch. */}
				<StatTile
					value={potions?.measurable === true ? `${potions.used}` : '—'}
					suffix={potions?.measurable === true ? `/${potions.slots}` : undefined}
					label={t('kpi.potions', { context: potions?.measurable === true ? undefined : 'unknown' })}
					grade={toneOf('potionsUsed')}
				/>
			</StatTiles>
		</section>
	);
}
