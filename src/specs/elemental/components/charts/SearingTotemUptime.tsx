import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { complementOf, intersect } from '~/lib/analysis/intervals';
import type { Analysis, ElementalAuditResult } from '~/lib/types';

import { ChartFigure } from '~/components/primitives';
import ChartEmpty from '~/components/charts/ChartEmpty';
import ChartKey from '~/components/charts/ChartKey';
import { EXEMPT } from '~/components/charts/tones';
import type { Track } from '~/components/charts/WindowTracks';
import WindowTracks from '~/components/charts/WindowTracks';

/**
 * Searing Totem across the pull: where the totem was ticking, where it was not, and the two reasons it
 * could not have been.
 *
 * The Flame Shock graph's three tracks, with the exempt one split in two. Both halves are stretches
 * the denominator dropped and neither is a fault, so they share one tone — but they are not one fact
 * about the pull, so they keep their own names: the Fire Elemental holding the one Fire totem slot is
 * the player's own cooldown, while nothing in reach is the fight. A reader can act on the first and
 * not on the second. Either way a stretch with no band at all reads as a rendering fault instead of an
 * answer, which is what both rows are here to stop.
 */
export default function SearingTotemUptime({ analysis }: { analysis: Analysis }) {
	const { t } = useTranslation('report');
	const el = analysis as Analysis & ElementalAuditResult;
	const { searingTotem } = el;
	const windows = searingTotem.windows;
	const feWindows = searingTotem.feWindows;
	const { up, dropped, away, elemental } = useMemo(() => {
		const up = windows.map((w): [number, number] => [w.start, w.end]);
		const elemental = feWindows.map((w): [number, number] => [w.start, w.end]);
		// "Down" is the totem missing while the player was in contact and the slot was theirs to fill —
		// clipped to the contact clock, so an intermission the fight took is not drawn as a totem the
		// player failed to keep up, and clipped again against the Fire Elemental, which held the one
		// Fire totem slot while it was out. The section's denominator drops the same stretch, so the
		// band and the percentage beside it cannot tell the reader two different stories.
		const contact = analysis.timeline?.contactSegments ?? [[0, analysis.durationMs]];
		const slotFree = complementOf(elemental, analysis.durationMs);
		const placeable = intersect(contact, slotFree);
		// Everything `placeable` threw out, which is the same array read from the other side: exempt is
		// `complementOf(placeable)`, and the two rows that draw it are that one set split by cause —
		// `elemental` is the half the slot row already carries, `away` is the rest. Split off the
		// denominator's own complement rather than derived a second way, so the two rows between them
		// account for every second the percentage forgave and for no second it charged.
		const away = intersect(complementOf(placeable, analysis.durationMs), slotFree);
		return { up, dropped: intersect(complementOf(up, analysis.durationMs), placeable), away, elemental };
	}, [analysis.durationMs, windows, feWindows, analysis.timeline?.contactSegments]);

	/**
	 * The four rows, in the order the argument runs: up, down, then the two grounds they were measured
	 * against, which sit last so they are behind the claim rather than over it.
	 *
	 * The up row is a list of whole totem lifetimes, so a short one is a totem that really did tick —
	 * one re-laid at once, or one the pull's end cut off — and hiding it at sub-pixel width would be
	 * the chart disagreeing with the uptime figure beside it. The down row is a complement, so it
	 * fragments on placement jitter, and widening that would paint a fault the pull did not have. See
	 * `Track.widen`.
	 *
	 * `EXEMPT`, not `miss`, for both grounds: they are the rail the other two are measured on, and
	 * colouring either like a fault would say the elemental was a mistake when the list wants it
	 * pressed, or that the player should have kept a totem up through a phase with nothing in it.
	 *
	 * **And they disagree about widening, which is the one place "exempt is one concept" stops.** The
	 * away row is a ground and nothing else, so a sliver of it is a `contactSegments` boundary rather
	 * than a phase and widening it would claim a break the fight did not take. The elemental row is
	 * also a *counted* row — the tile above counts the overlaps one by one — so a stretch of it drawn
	 * too small to see would contradict a number the reader can read, and it stays widened. Which way a
	 * row goes is a fact about the data behind it, not about its colour. See `Track.widen`.
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
			{ label: t('searingTotem.track.away'), tone: EXEMPT, windows: away, lengthLabel: 'for', widen: false },
			{ label: t('searingTotem.track.elemental'), tone: EXEMPT, windows: elemental, lengthLabel: 'out for' },
		],
		[t, up, dropped, away, elemental],
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
					{away.length === 0 ? null : <ChartKey tone={EXEMPT}>{t('searingTotem.track.away')}</ChartKey>}
					{elemental.length === 0 ? null : <ChartKey tone={EXEMPT}>{t('searingTotem.track.elemental')}</ChartKey>}
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
