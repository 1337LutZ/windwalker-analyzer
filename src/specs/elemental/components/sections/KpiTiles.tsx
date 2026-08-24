import { useReportCopy } from '~/hooks/useReportCopy';
import { formatPercentValue } from '~/lib/format';
import type { Analysis, ElementalAuditResult } from '~/lib/types';

import PaceTiles from '~/components/sections/PaceTiles';
import { StatTile, StatTiles } from '~/components/primitives';

/**
 * The Elemental headline numbers: globals, the dot, and the shocks.
 *
 * The same shape the Windwalker tiles take, but the figures are the Elemental's own — Flame Shock
 * uptime and the shocks stand where the monk's brew and debuff stood, because those are the habits
 * that move an Elemental's damage.
 *
 * **The snapshot catch rate stood here too and does not any more.** It was the dot's payoff read as a
 * headline, and the dot's own section already draws it: `FlameShock` renders `FlameShockDepth` and
 * words each press by the gain it snapshotted. A tile is the most expensive place in the report to say
 * a thing twice — it is above the fold, and there are five of them.
 */
export default function KpiTiles({ analysis }: { analysis: Analysis }) {
	const el = analysis as Analysis & ElementalAuditResult;
	const { flameShock, earthShock } = el;
	// `toneOf` is the grade behind one tile's own number, from the hook — see its doc there for why a
	// tile is coloured by its metric rather than by the section the metric sits in.
	const { t, toneOf, unasked } = useReportCopy(analysis);
	/**
	 * The one thing an uncoloured tile cannot say for itself.
	 *
	 * `toneOf` returns null for a metric with no threshold, one the log could not answer *and* one nothing
	 * asked — the three have to look alike, so the summary row is where an unasked figure is most easily
	 * read as a judged one. `unasked` separates the third case and the caption states it. See the hook.
	 *
	 * Returns the clause only: `StatTile` owns the em dash that joins it to the label, so this file and
	 * `FlameShock.tsx` can no longer punctuate it differently from each other.
	 */
	const caption = (metric: string) => (unasked(metric) ? t('metric.notAsked') : undefined);

	return (
		<section aria-label={t('kpi.label')}>
			<StatTiles>
				{/* Damage, cast rate and how full the globals were — the three every spec opens with, and
				    the only three read off the part of an analysis every spec shares. */}
				<PaceTiles analysis={analysis} />
				<StatTile
					value={formatPercentValue(flameShock.uptimePct)}
					label={t('kpi.flameShock')}
					caption={caption('flameShockUptime')}
					grade={toneOf('flameShockUptime')}
				/>
				{/*
				 * Over `judged` rather than every press, so this tile and `earthShockGood` beside it are the
				 * same fraction. At three or more enemies no list has an Earth Shock rule, so those presses
				 * are not in the graded set — see `EarthShockPress.good`.
				 */}
				<StatTile
					value={`${earthShock.good}`}
					suffix={earthShock.judged > 0 ? `/${earthShock.judged}` : undefined}
					label={t('kpi.earthShock')}
					caption={caption('earthShockGood')}
					grade={toneOf('earthShockGood')}
				/>
			</StatTiles>
		</section>
	);
}
