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
 * **Nothing renders this today.** It was the shared half of each spec's `KpiTiles`, and the summary's
 * tile row came out when the scorecard grid below it was already printing every one of those figures
 * as a card headline. Kept rather than deleted because the arithmetic in it is argued at length and
 * is cited from `analysis/analyseCore.ts` and two of its tests; a future home for DPS, casts per
 * minute and global utilisation wants this file rather than a third derivation of them.
 *
 * A fragment and not its own row: a spec's KPI block owned the `StatTiles` grid, because the
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
	 * it". It does not, and one of the two reasons it did not has since been removed.
	 *
	 * The reason that is gone: the two tiles used to be on different **clocks**. `cpm.totalCpm` was per
	 * WarcraftLogs' active minute while the GCD tile has been measured against the contact clock since
	 * `fe3d7ad`, and on `phased` those two clocks are 32.7 seconds apart. `totalCpm` is on contact now,
	 * so both tiles describe the same span of the same pull.
	 *
	 * The reason that remains: this ratio counts **presses** and the GCD tile counts **milliseconds**, so
	 * this one cannot see a hard cast that occupied two globals. Measured, with the clocks now shared:
	 * `phased` 87.28 against 94.08, `unbroken` 81.35 against 91.94, the Windwalker 88.41 against 88.55,
	 * `cleave` 87.93 against 87.32. Moving the clock closed most of the gap on `phased` — it was 18.72
	 * points and is 6.80 — and closed almost none of it on `unbroken`, where the two clocks were only
	 * 1.5 seconds apart to begin with and the 10.59 points left are entirely hard casts. The pair agrees
	 * on the Windwalker and on `cleave` for the same reason it always did: an all-instant bar with
	 * nothing wasted is where counting presses and counting milliseconds give the same answer.
	 *
	 * So the pair here is one self-consistent reading — a rate over the clock its own denominator came
	 * from — and it is **not** a second opinion on the GCD tile. That the two clocks now agree does not
	 * make it one.
	 *
	 * The target below is deliberately left on `cpm.activeMs`, and that is not a third clock: `gcdSlots`
	 * is `floor(activeMs / effectiveGcd)`, so `activeMs` cancels and what survives is ≈`60_000 /
	 * effectiveGcd` — globals per minute, which is the same number on either clock to within the floor.
	 * Pairing it with a rate per contact minute is therefore sound; rebuilding it on contact moves it by
	 * under 0.4 cpm, which is argued at `cpm.gcdSlots` in `analyseCore`.
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
