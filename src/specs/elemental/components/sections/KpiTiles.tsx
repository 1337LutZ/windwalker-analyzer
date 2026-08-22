import { useReportCopy } from '~/hooks/useReportCopy';
import { formatPercentValue } from '~/lib/format';
import type { Analysis, ElementalAuditResult } from '~/lib/types';

import PaceTiles from '~/components/sections/PaceTiles';
import { StatTile, StatTiles } from '~/components/primitives';

/**
 * The Elemental headline numbers: globals, the dot, and the snapshots.
 *
 * The same shape the Windwalker tiles take, but the figures are the Elemental's own — Flame Shock
 * uptime and the snapshot catch rate stand where the monk's brew and debuff stood, because those
 * are the two habits that move an Elemental's damage.
 */
export default function KpiTiles({ analysis }: { analysis: Analysis }) {
	const el = analysis as Analysis & ElementalAuditResult;
	const { flameShock, snapshots, earthShock } = el;
	// `toneOf` is the grade behind one tile's own number, from the hook — see its doc there for why a
	// tile is coloured by its metric rather than by the section the metric sits in.
	const { t, toneOf } = useReportCopy(analysis);

	const snapshotTotal = snapshots.refreshed + snapshots.missed;

	return (
		<section aria-label={t('kpi.label')}>
			<StatTiles>
				{/* Damage, cast rate and how full the globals were — the three every spec opens with, and
				    the only three read off the part of an analysis every spec shares. */}
				<PaceTiles analysis={analysis} />
				<StatTile
					value={formatPercentValue(flameShock.uptimePct)}
					label={t('kpi.flameShock')}
					grade={toneOf('flameShockUptime')}
				/>
				<StatTile
					value={`${snapshots.refreshed}`}
					suffix={snapshotTotal > 0 ? `/${snapshotTotal}` : undefined}
					label={t('kpi.snapshotRate')}
					grade={toneOf('flameShockSnapshots')}
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
					grade={toneOf('earthShockGood')}
				/>
			</StatTiles>
		</section>
	);
}
