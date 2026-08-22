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
	 * The cast rate a pull on this player's measured global had room for.
	 *
	 * Taken from the engine's own count of available globals rather than from a flat 60-per-minute, even
	 * though a 1.0s global makes 60 the arithmetic ceiling: `gcdSlots` is built from the *measured*
	 * effective global, so a hasted caster is held to the rate their own haste afforded rather than to a
	 * melee's. On the four raw fixtures that is 52.92 / 53.22 / 57.62 / 59.77 against a flat 60.
	 *
	 * **The reason written here before was wrong twice, and the correction matters because it decides
	 * what the tile beside this one may be compared against.**
	 *
	 * It claimed `gcdSlots` "already accounts for the time a channel or a hard cast occupies beyond one
	 * global". It does not, and deliberately so: `effectiveGcd` is the median gap measured **only after
	 * an instant press**, because a cast-time spell's gap is its cast time and including those pairs
	 * would measure the spellbook instead of the global. So `gcdSlots` counts the pull as though every
	 * press were instant, which is the honest count of *globals* and an over-count of *presses* for
	 * anyone who hard-casts.
	 *
	 * It then claimed dividing by `gcdSlots` "keeps this tile's ratio identical to the GCD tile beside
	 * it". Measured, the two are 18.72 points apart on the Elemental's `phased` (75.36 against 94.08) and
	 * 11.26 on `unbroken` (80.68 against 91.94), and agree only on the Windwalker (88.36 against 88.55)
	 * and on `cleave` (87.93 against 87.32). The agreement was never structural — it holds exactly where
	 * every press is instant and nothing is wasted, which is what a monk's bar is and what a shaman's is
	 * not. Two separate reasons, both now measured: this ratio counts *presses* and cannot see a hard cast
	 * that occupied two globals, while the GCD tile counts *milliseconds*; and since `fe3d7ad` the GCD
	 * tile is measured against the contact clock while `cpm.totalCpm` is still per WarcraftLogs' active
	 * minute, and on `phased` those two clocks are 32.7 seconds apart.
	 *
	 * So the pair here is one self-consistent reading — a rate over the clock its own denominator came
	 * from — and it is **not** a second opinion on the GCD tile. `cpm.activeMs` cancels out of the
	 * division to within `gcdSlots`' floor, which is why this tile is nearly indifferent to which clock
	 * that field is on and the GCD tile beside it is not.
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
