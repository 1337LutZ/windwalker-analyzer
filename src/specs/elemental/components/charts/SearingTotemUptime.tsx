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
 * Searing Totem across the pull: where the totem was ticking, where it was not, and where the Fire
 * Elemental had taken the slot.
 *
 * The Flame Shock graph's two tracks, minus the "nothing to hit" row — the totem ticks regardless of
 * target, so a gap is a summon missed rather than a phase with no enemy — plus the elemental's own.
 * That third row is why it is here rather than folded into the gap: only one Fire totem stands at a
 * time, so the elemental's minute is neither the totem up nor a totem dropped, and a stretch with no
 * band at all reads as a rendering fault instead of the answer.
 */
export default function SearingTotemUptime({ analysis }: { analysis: Analysis }) {
	const { t } = useTranslation('report');
	const el = analysis as Analysis & ElementalAuditResult;
	const { searingTotem } = el;
	const windows = searingTotem.windows;
	const feWindows = searingTotem.feWindows;
	const { up, dropped, elemental } = useMemo(() => {
		const up = windows.map((w): [number, number] => [w.start, w.end]);
		const elemental = feWindows.map((w): [number, number] => [w.start, w.end]);
		// "Down" is the totem missing while the player was in contact and the slot was theirs to fill —
		// clipped to the contact clock, so an intermission the fight took is not drawn as a totem the
		// player failed to keep up, and clipped again against the Fire Elemental, which held the one
		// Fire totem slot while it was out. The section's denominator drops the same stretch, so the
		// band and the percentage beside it cannot tell the reader two different stories.
		const contact = analysis.timeline?.contactSegments ?? [[0, analysis.durationMs]];
		const placeable = intersect(contact, complementOf(elemental, analysis.durationMs));
		return { up, dropped: intersect(complementOf(up, analysis.durationMs), placeable), elemental };
	}, [analysis.durationMs, windows, feWindows, analysis.timeline?.contactSegments]);

	/**
	 * The three rows, and the one asymmetry between them: only the fault row is gated.
	 *
	 * The up row is a list of whole totem lifetimes, so a short one is a totem that really did tick —
	 * one re-laid at once, or one the pull's end cut off — and hiding it at sub-pixel width would be
	 * the chart disagreeing with the uptime figure beside it. The down row is a complement, so it
	 * fragments on placement jitter, and widening that would paint a fault the pull did not have. See
	 * `Track.widen`.
	 *
	 * `track`, not `miss`, for the elemental: this row is the rail the other two are measured on, and
	 * colouring it like a fault would say the elemental was a mistake when the list wants it pressed.
	 * It is not gated either — the tile above counts the overlaps one by one, so a stretch drawn too
	 * small to see would contradict a number the reader can read.
	 */
	const rows = useMemo(
		(): Track[] => [
			{ label: t('searingTotem.track.up'), tone: 'kick', windows: up, lengthLabel: 'ticking for' },
			{
				label: t('searingTotem.track.dropped'),
				tone: 'miss',
				windows: dropped,
				lengthLabel: 'without it for',
				widen: false,
			},
			{ label: t('searingTotem.track.elemental'), tone: 'track', windows: elemental, lengthLabel: 'out for' },
		],
		[t, up, dropped, elemental],
	);

	if (up.length === 0 && dropped.length === 0 && elemental.length === 0) {
		return <ChartEmpty>{t('searingTotem.none')}</ChartEmpty>;
	}

	return (
		<ChartFigure
			gap="wide"
			caption={
				<>
					<ChartKey tone="kick">{t('searingTotem.track.up')}</ChartKey>
					<ChartKey tone="miss">{t('searingTotem.track.dropped')}</ChartKey>
					{elemental.length === 0 ? null : <ChartKey tone="track">{t('searingTotem.track.elemental')}</ChartKey>}
				</>
			}
		>
			<WindowTracks
				tracks={rows}
				chartId="ele-searing-totem-uptime"
				durationMs={analysis.durationMs}
				label={t('searingTotem.chart.uptimeLabel')}
			/>
		</ChartFigure>
	);
}
