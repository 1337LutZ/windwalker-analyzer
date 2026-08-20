import { useReportCopy } from '~/hooks/useReportCopy';
import { formatCompact, formatDecimal, formatPercentValue } from '~/lib/format';
import type { Analysis } from '~/lib/types';

import { StatTile } from '../primitives';

/**
 * The three tiles every spec's KPI row opens with: what came out, how often a button was pressed,
 * and how much of the pull those presses filled.
 *
 * Shared rather than written per spec because all three are read off `AnalysisCore` — the part of an
 * analysis every spec has, measured the same way for all of them — so a second copy could only ever
 * differ by drifting. They were two copies, and the second had already lost the reasoning the first
 * carries below.
 *
 * A fragment and not its own row: the spec's own `KpiTiles` owns the `StatTiles` grid, because the
 * tiles that follow these three are the spec's own and the row has to be one grid for `auto-fit` to
 * lay it out and for the 1px gaps to draw as hairlines between neighbours.
 */
export default function PaceTiles({ analysis }: { analysis: Analysis }) {
	const { cpm, damage } = analysis;
	const { t, toneOf } = useReportCopy(analysis);

	/**
	 * The cast rate this pull actually had room for.
	 *
	 * Taken from the engine's own count of available globals rather than from a flat 60-per-minute,
	 * even though a 1.0s global makes 60 the arithmetic ceiling. `gcdSlots` already accounts for the
	 * time a channel or a hard cast occupies beyond one global — Fists of Fury for the monk — so
	 * dividing by it keeps this tile's ratio identical to the GCD tile beside it. A flat 60 puts them
	 * a few points apart and invites the reader to work out which of the two is lying.
	 */
	const targetCpm = cpm.activeMs > 0 ? cpm.gcdSlots / (cpm.activeMs / 60_000) : null;

	// A tile value is a number in its own box, not a sentence, so it is formatted here rather than
	// through the copy layer — only prose has to go through the JSON to stay translatable.
	return (
		<>
			{/* `formatCompact`, not a hand-rolled divide-by-1000: the same helper the damage sentences
			    use, so a tile and the prose cannot disagree on how a number is spelled. */}
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
		</>
	);
}
