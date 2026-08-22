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
 * **Two exempt causes, and the second one arrived with the clock that dropped it.** `flameShock.scoredMs`
 * is `contact` less every stretch three or more enemies were up, so the tile now reads 83.90% of 178 814ms
 * on `cleave` where it used to read 72.30% of 261 572ms. Until this row landed the red row still spanned
 * those add waves — fault time the figure beside it no longer charges — which is the one thing this chart
 * may not do. So the AoE stretches leave the red row and arrive as a ground, in the same breath.
 *
 * `lightningShield.aoeWindows` is where they are read from, because it is the array the audit's own
 * `gradedSpans` is the complement of — one published set, three clocks cut with it, rather than a fourth
 * reading of "when was it AoE" taken here. That is the identity `exemptTrack.test.ts` enforces, and it is
 * checkable on this chart to the millisecond: the two exempt rows sum to `durationMs - flameShock.scoredMs`.
 */
export default function FlameShockUptime({ analysis }: { analysis: Analysis }) {
	const { t } = useTranslation('report');
	const el = analysis as Analysis & ElementalAuditResult;
	const { flameShock } = el;
	const windows = flameShock.windows;
	const aoeWindows = el.lightningShield.aoeWindows;
	const { up, dropped, exempt } = useMemo(() => {
		const up = windows.map((w): [number, number] => [w.start, w.end]);
		// "Down" is the dot missing while the player was in contact and a list asked for the dot — the
		// complement of the dot, clipped to the same clock the percentage is taken over, so neither an
		// intermission the fight took nor an add wave the multi-target order has no Lava Burst in is drawn
		// as a dot the player dropped. The fallback (the whole pull) keeps the chart unchanged on a fixture
		// captured before the core carried the contact clock.
		const contact = analysis.timeline?.contactSegments ?? [[0, analysis.durationMs]];
		const aoe = aoeWindows.map((w): [number, number] => [w.start, w.end]);
		// `intersect(contact, complementOf(aoe))` is `fsGraded` in the audit, spelled the same way round.
		// Rebuilt here rather than published as an array because what the audit publishes is its *length*
		// (`scoredMs`), and the two are checked against each other rather than trusted: the rows below sum
		// to `durationMs - scoredMs` exactly, which is the assertion in `exemptTrack.test.ts`.
		const graded = intersect(contact, complementOf(aoe, analysis.durationMs));
		// The exempt rows are the rest of the pull — exactly the stretches the clip above threw out of the
		// denominator, split by cause. Each cause is passed as the array it *is* rather than as a share of
		// the complement, and `exemptRows` does the trimming: two derivations of one fact is how a band and
		// a percentage end up disagreeing about which seconds were forgiven.
		//
		// Precedence is argument order, strongest claim first, and the intermission outranks the add wave
		// for the reason `exemptRows` gives: "you could not act at all" beats "you were acting against a
		// different order". A reader shown AoE grey over a submerge would conclude the multi-target order
		// excused them when in fact there was nothing there to press at.
		return {
			up,
			dropped: intersect(complementOf(up, analysis.durationMs), graded),
			exempt: exemptRows(
				[
					{ label: t('flameShock.track.away'), windows: complementOf(contact, analysis.durationMs) },
					{ label: t('flameShock.track.aoe'), windows: aoe },
				],
				analysis.durationMs,
			).filter((row) => row.windows.length > 0),
		};
	}, [analysis.durationMs, windows, analysis.timeline?.contactSegments, aoeWindows, t]);

	/**
	 * Up, down, then the grounds both were measured against — those last so they sit behind the claim
	 * rather than over it, and only the ones this pull actually has.
	 *
	 * Only the fault row is gated, and the up row is not. The up row is a list of whole aura windows,
	 * so a short one is a real dot that really was on the target — a dot on an add that died, or one
	 * clipped by the pull ending. Hiding it at sub-pixel width would be the chart disagreeing with the
	 * uptime figure beside it. The down row is a complement, so it fragments on every refresh the log
	 * stamped a few hundred milliseconds early, and widening that jitter would paint a fault the pull
	 * did not have. See `Track.widen`.
	 *
	 * **The exempt rows are `widen: false` and carry no length floor either, which is the report's one
	 * answer to "which slivers count".** They are grounds rather than marks, so a sliver of one is the
	 * sampling either side of a `contactSegments` boundary rather than a phase — widened to the floor it
	 * would claim a break in the fight that never happened. Left at true width it is a fraction of a
	 * pixel, which is what a rounding artefact deserves, and the row still adds up to the seconds the
	 * denominator dropped. Discarding it instead would buy no legibility, because nothing it removes was
	 * ever visible, and would cost the total its identity with the tile: on `cleave` the two rows here sum
	 * to 84 419ms, which is `durationMs - flameShock.scoredMs` to the millisecond, and a 100ms floor would
	 * make that 84 319 against a denominator that dropped 84 419. `DebuffTimeline` and `CastTimeline` both
	 * had a floor and both lost it for this reason.
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
					{exempt.map((row) => (
						<ChartKey key={row.label} tone={EXEMPT}>
							{row.label}
						</ChartKey>
					))}
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
