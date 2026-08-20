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
 * Flame Shock across the pull: where the dot was up, where it was not, and where there was nothing to
 * put it on.
 *
 * The same three tracks the Rising Sun Kick debuff draws. It used to draw the first two only, on the
 * grounds that the dot is on the primary target so a gap is always the player's — which is true of the
 * *target* and false of the *clock*. The section had already stopped charging for an intermission (the
 * down row below is clipped to `contactSegments`), so a submerge came out of the percentage and stayed
 * in the picture as an unexplained empty stretch: a reader looking at `phased` saw fifty seconds with
 * no band at all above a tile reading 88.67%, and no way to tell that gap from one the player caused.
 */
export default function FlameShockUptime({ analysis }: { analysis: Analysis }) {
	const { t } = useTranslation('report');
	const el = analysis as Analysis & ElementalAuditResult;
	const { flameShock } = el;
	const windows = flameShock.windows;
	const { up, dropped, away } = useMemo(() => {
		const up = windows.map((w): [number, number] => [w.start, w.end]);
		// "Down" is the dot missing while the player was in contact — the complement of the dot,
		// clipped to the contact clock, so an intermission the fight took is not drawn as a dot the
		// player dropped. The fallback (the whole pull) keeps the chart unchanged on a fixture captured
		// before the core carried the contact clock.
		const contact = analysis.timeline?.contactSegments ?? [[0, analysis.durationMs]];
		// And "away" is the rest of the pull: exactly the stretches the clip above threw out of the
		// denominator, taken off the same `contact` array in the same breath rather than rebuilt from
		// somewhere else. Two derivations of one fact is how a band and a percentage end up disagreeing
		// about which seconds were forgiven. On the fallback it is empty, which drops the row.
		return {
			up,
			dropped: intersect(complementOf(up, analysis.durationMs), contact),
			away: complementOf(contact, analysis.durationMs),
		};
	}, [analysis.durationMs, windows, analysis.timeline?.contactSegments]);

	/**
	 * The three rows, in the order the argument runs: up, down, then the ground both were measured
	 * against. The exempt band last so it sits behind the claim rather than over it.
	 *
	 * Only the fault row is gated, and the up row is not. The up row is a list of whole aura windows,
	 * so a short one is a real dot that really was on the target — a dot on an add that died, or one
	 * clipped by the pull ending. Hiding it at sub-pixel width would be the chart disagreeing with the
	 * uptime figure beside it. The down row is a complement, so it fragments on every refresh the log
	 * stamped a few hundred milliseconds early, and widening that jitter would paint a fault the pull
	 * did not have. See `Track.widen`.
	 *
	 * The away row is `widen: false` for the opposite reason to the down row: it is a ground rather
	 * than a mark, and a sliver of it is the sampling either side of a `contactSegments` boundary
	 * rather than a phase — widened to the floor it would claim a break in the fight that never
	 * happened. Left at true width such a sliver is a fraction of a pixel, which is what a rounding
	 * artefact deserves, and the row still adds up to the seconds the denominator dropped.
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
			{ label: t('flameShock.track.away'), tone: EXEMPT, windows: away, lengthLabel: 'for', widen: false },
		],
		[t, up, dropped, away],
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
					{away.length === 0 ? null : <ChartKey tone={EXEMPT}>{t('flameShock.track.away')}</ChartKey>}
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
