import { useReportCopy } from '~/hooks/useReportCopy';
import { formatCompact, formatDecimal, formatPercentValue, formatSeconds } from '~/lib/format';
import type { Analysis } from '~/lib/types';

import { StatTile, StatTiles } from '../primitives';

/** The headline numbers the rest of the report explains. */
export default function KpiTiles({ analysis }: { analysis: Analysis }) {
	const { brew, cpm, damage, debuff, procs, potions } = analysis;
	const { t, card } = useReportCopy(analysis);

	/**
	 * The grade behind a tile, or null where there is none to show.
	 *
	 * Read off the metric rather than off the section, so a tile is coloured by the number it is
	 * actually showing. Null covers two different cases that must look the same: a figure with no
	 * threshold at all (DPS has no target), and one the pull could not answer — debuff uptime on an
	 * add fight, where grading it would be the false red this report already refuses to print.
	 */
	const toneOf = (key: string) => {
		for (const section of Object.values(card.sections)) {
			const metric = section.metrics.find((m) => m.key === key);
			if (metric) return metric.unmeasurable ? null : metric.grade;
		}
		return null;
	};

	/**
	 * The cast rate this pull actually had room for.
	 *
	 * Taken from the engine's own count of available globals rather than from a flat 60-per-minute,
	 * even though a 1.0s global makes 60 the arithmetic ceiling. `gcdSlots` already accounts for the
	 * time Fists of Fury spends channelling, so dividing by it keeps this tile's ratio identical to
	 * the GCD tile beside it — a flat 60 puts them a few points apart and invites the reader to work
	 * out which of the two is lying.
	 */
	const targetCpm = cpm.activeMs > 0 ? cpm.gcdSlots / (cpm.activeMs / 60_000) : null;

	return (
		// A tile value is a number in its own box, not a sentence, so it is formatted here rather than
		// through the copy layer — only prose has to go through the JSON to stay translatable.
		<section aria-label={t('kpi.label')}>
			<StatTiles>
				{/* `formatCompact`, not a hand-rolled divide-by-1000: the same helper the damage sentence
				    below uses, so the tile and the prose cannot disagree on how a number is spelled. */}
				{/* No grade: there is no target DPS, and colouring it would invent a verdict. */}
				<StatTile value={formatCompact(damage.dps)} label={t('kpi.dps')} />
				<StatTile
					value={formatDecimal(cpm.totalCpm)}
					suffix={targetCpm === null ? undefined : `/${formatDecimal(targetCpm)}`}
					label={t('kpi.cpm')}
					grade={toneOf('gcdUtilisation')}
				/>
				<StatTile
					value={formatPercentValue(cpm.gcdUtilisationPct)}
					label={t('kpi.gcd')}
					grade={toneOf('gcdUtilisation')}
				/>
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
