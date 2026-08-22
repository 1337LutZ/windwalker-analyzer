import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { complementOf, intersect } from '~/lib/analysis/intervals';
import type { Analysis, ElementalAuditResult } from '~/lib/types';

import { ChartFigure } from '~/components/primitives';
import ChartEmpty from '~/components/charts/ChartEmpty';
import ChartKey from '~/components/charts/ChartKey';
import { exemptRows } from '~/components/charts/exempt';
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
 *
 * **One exempt cause here and not two, deliberately.** `lightningShield.aoeWindows` is the stretches
 * with three or more enemies up, it is reachable from `analysis`, and the Lightning Shield chart shades
 * it — because that section's own denominator drops it (`shieldGradedSpans`). Nothing drops it out of
 * `flameShock.uptimePct`, which is still measured over the whole of `contact`. Shading a stretch this
 * chart's own tile still counts would be the worse of the two errors: a wrong percentage is a number a
 * reader can argue with, while grey looks deliberate, so it would read as a promise the figure does not
 * keep. The row goes in the same commit that cuts the clock, not before it — the tone, the label and the
 * partitioner are all already here, so what is missing is the exemption itself.
 */
export default function FlameShockUptime({ analysis }: { analysis: Analysis }) {
	const { t } = useTranslation('report');
	const el = analysis as Analysis & ElementalAuditResult;
	const { flameShock } = el;
	const windows = flameShock.windows;
	const { up, dropped, exempt } = useMemo(() => {
		const up = windows.map((w): [number, number] => [w.start, w.end]);
		// "Down" is the dot missing while the player was in contact — the complement of the dot,
		// clipped to the contact clock, so an intermission the fight took is not drawn as a dot the
		// player dropped. The fallback (the whole pull) keeps the chart unchanged on a fixture captured
		// before the core carried the contact clock.
		const contact = analysis.timeline?.contactSegments ?? [[0, analysis.durationMs]];
		// And the exempt row is the rest of the pull: exactly the stretches the clip above threw out of
		// the denominator, taken off the same `contact` array in the same breath rather than rebuilt
		// from somewhere else. Two derivations of one fact is how a band and a percentage end up
		// disagreeing about which seconds were forgiven. On the fallback it is empty, which drops the row.
		//
		// Through `exemptRows` even though this chart has one cause, and for the same reason
		// `LightningShield` does: the day a second cause arrives the overlap is settled by the one
		// precedence rule every other exempt row uses rather than by a fourth hand-rolled intersection.
		// See the note above the component for which second cause that is and what has to land first.
		return {
			up,
			dropped: intersect(complementOf(up, analysis.durationMs), contact),
			exempt: exemptRows(
				[{ label: t('flameShock.track.away'), windows: complementOf(contact, analysis.durationMs) }],
				analysis.durationMs,
			),
		};
	}, [analysis.durationMs, windows, analysis.timeline?.contactSegments, t]);

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
			...exempt.map((row): Track => ({
				label: row.label,
				tone: EXEMPT,
				windows: row.windows,
				lengthLabel: 'for',
				widen: false,
			})),
		],
		[t, up, dropped, exempt],
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
					{exempt.map((row) =>
						row.windows.length === 0 ? null : (
							<ChartKey key={row.label} tone={EXEMPT}>
								{row.label}
							</ChartKey>
						),
					)}
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
