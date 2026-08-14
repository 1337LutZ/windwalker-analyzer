import { useReportCopy } from '~/hooks/useReportCopy';
import { formatCompact, formatDecimal, formatPercentValue } from '~/lib/format';
import type { Analysis } from '~/lib/types';

import { StatTile, StatTiles } from '../primitives';

/** The six numbers the rest of the report explains. */
export default function KpiTiles({ analysis }: { analysis: Analysis }) {
	const { brew, cpm, damage, debuff, procs } = analysis;
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
				<StatTile
					value={formatPercentValue(debuff.uptimePct)}
					label={t('kpi.rskUptime')}
					grade={toneOf('rskUptime')}
				/>
				{/* Graded on depth rather than on the catch rate: this tile counts the ones held to the
				    final global, which is the timing question, not the discipline one. */}
				<StatTile
					value={`${procs.lastGcd}`}
					suffix={`/${procs.procs}`}
					label={t('kpi.snapshots')}
					grade={toneOf('snapshotDepth')}
				/>
			</StatTiles>
		</section>
	);
}
