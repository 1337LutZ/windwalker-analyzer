import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { complementOf, intersect } from '~/lib/analysis/intervals';
import type { Analysis, ElementalAuditResult } from '~/lib/types';

import { ChartFigure } from '~/components/primitives';
import ChartEmpty from '~/components/charts/ChartEmpty';
import ChartKey from '~/components/charts/ChartKey';
import type { Track } from '~/components/charts/WindowTracks';
import WindowTracks from '~/components/charts/WindowTracks';

/**
 * Flame Shock across the pull: where the dot was up, and where it was not.
 *
 * The same two tracks the Rising Sun Kick debuff draws, minus the "nothing to hit" row — the dot is on
 * the primary target, so a gap is always a drop the player caused rather than a phase with no enemy.
 */
export default function FlameShockUptime({ analysis }: { analysis: Analysis }) {
	const { t } = useTranslation('report');
	const el = analysis as Analysis & ElementalAuditResult;
	const { flameShock } = el;
	const windows = flameShock.windows;
	const { up, dropped } = useMemo(() => {
		const up = windows.map((w): [number, number] => [w.start, w.end]);
		// "Down" is the dot missing while the player was in contact — the complement of the dot,
		// clipped to the contact clock, so an intermission the fight took is not drawn as a dot the
		// player dropped. The fallback (the whole pull) keeps the chart unchanged on a fixture captured
		// before the core carried the contact clock.
		const contact = analysis.timeline?.contactSegments ?? [[0, analysis.durationMs]];
		return { up, dropped: intersect(complementOf(up, analysis.durationMs), contact) };
	}, [analysis.durationMs, windows, analysis.timeline?.contactSegments]);

	/**
	 * The two rows, and the one asymmetry between them: only the fault row is gated.
	 *
	 * The up row is a list of whole aura windows, so a short one is a real dot that really was on the
	 * target — a dot on an add that died, or one clipped by the pull ending. Hiding it at sub-pixel
	 * width would be the chart disagreeing with the uptime figure beside it. The down row is a
	 * complement, so it fragments on every refresh the log stamped a few hundred milliseconds early,
	 * and widening that jitter would paint a fault the pull did not have. See `Track.widen`.
	 */
	const rows = useMemo(
		(): Track[] => [
			{ label: t('flameShock.track.up'), tone: 'kick', windows: up, lengthLabel: 'held for' },
			{
				label: t('flameShock.track.dropped'),
				tone: 'miss',
				windows: dropped,
				lengthLabel: 'without it for',
				widen: false,
			},
		],
		[t, up, dropped],
	);

	if (up.length === 0 && dropped.length === 0) {
		return <ChartEmpty>{t('flameShock.none')}</ChartEmpty>;
	}

	return (
		<ChartFigure
			gap="wide"
			caption={
				<>
					<ChartKey tone="kick">{t('flameShock.track.up')}</ChartKey>
					<ChartKey tone="miss">{t('flameShock.track.dropped')}</ChartKey>
				</>
			}
		>
			<WindowTracks
				tracks={rows}
				chartId="ele-flame-shock-uptime"
				durationMs={analysis.durationMs}
				label={t('flameShock.chart.uptimeLabel')}
			/>
		</ChartFigure>
	);
}
