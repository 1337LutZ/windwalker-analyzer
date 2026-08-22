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
 * Searing Totem across the pull: where the totem was ticking, where it was not, and the two reasons it
 * could not have been.
 *
 * The Flame Shock graph's three tracks, with the exempt one split in two. Both halves are stretches
 * the denominator dropped and neither is a fault, so they share one tone — but they are not one fact
 * about the pull, so they keep their own names: the Fire Elemental holding the one Fire totem slot is
 * the player's own cooldown, while nothing in reach is the fight. A reader can act on the first and
 * not on the second. Either way a stretch with no band at all reads as a rendering fault instead of an
 * answer, which is what both rows are here to stop.
 *
 * **Three exempt causes now, and the third arrived with the clock that dropped it.**
 * `searingTotem.scoredMs` is contact time less the elemental's slot less every stretch three or more
 * enemies were up, so the tile reads 88.50% of 127 378ms on `cleave` where it used to read 78.72% of
 * 204 835ms — and the section's grade moved `ok` to `good` with it. Until this row landed the red row
 * still spanned those add waves, which is the band and the percentage telling the reader two different
 * stories, the one thing the comment inside this component promises against.
 *
 * The cause is read off `lightningShield.aoeWindows`, the array the audit's own `gradedSpans` is the
 * complement of, rather than from a fourth reading of "when was it AoE" taken here.
 */
export default function SearingTotemUptime({ analysis }: { analysis: Analysis }) {
	const { t } = useTranslation('report');
	const el = analysis as Analysis & ElementalAuditResult;
	const { searingTotem } = el;
	const windows = searingTotem.windows;
	const feWindows = searingTotem.feWindows;
	const aoeWindows = el.lightningShield.aoeWindows;
	const { up, dropped, exempt } = useMemo(() => {
		const up = windows.map((w): [number, number] => [w.start, w.end]);
		const elemental = feWindows.map((w): [number, number] => [w.start, w.end]);
		const aoe = aoeWindows.map((w): [number, number] => [w.start, w.end]);
		// "Down" is the totem missing while the player was in contact, the slot was theirs to fill and a
		// list asked for a fire totem at all. Three clips, and the audit's `stScored` makes the same three
		// in the same order: an intermission the fight took, the Fire Elemental holding the one Fire totem
		// slot, and a stretch above two enemies where `aoe.apl.json` has no fire-totem rung. The section's
		// denominator drops all three, so the band and the percentage beside it cannot tell the reader two
		// different stories.
		const contact = analysis.timeline?.contactSegments ?? [[0, analysis.durationMs]];
		const slotFree = complementOf(elemental, analysis.durationMs);
		const placeable = intersect(intersect(contact, slotFree), complementOf(aoe, analysis.durationMs));
		// The three rows are `complementOf(placeable)` split by cause, and each cause is passed as the
		// array it *is* rather than as a share of that complement — `exemptRows` does the trimming, so the
		// three between them account for every second the percentage forgave and for no second it charged.
		//
		// **Argument order is precedence, strongest claim first**, and it is not the drawing order: the
		// Fire Elemental's slot outranks the intermission, which outranks the add wave. The rows below put
		// the intermission first and the slot last, which is a legibility choice with no claim in it.
		// `exemptTrack.test.ts` pinned the first two as equal to the hand-rolled intersections that used to
		// be here before either moved.
		return {
			up,
			dropped: intersect(complementOf(up, analysis.durationMs), placeable),
			exempt: exemptRows(
				[
					{ label: t('searingTotem.track.elemental'), windows: elemental },
					{ label: t('searingTotem.track.away'), windows: complementOf(contact, analysis.durationMs) },
					{ label: t('searingTotem.track.aoe'), windows: aoe },
				],
				analysis.durationMs,
			),
		};
	}, [analysis.durationMs, windows, feWindows, aoeWindows, analysis.timeline?.contactSegments, t]);
	// Precedence order, so the slot is first, the intermission second and the add wave third; the rows and
	// the key below draw them in a different order again.
	const [slot, away, aoe] = exempt;

	/**
	 * Up, down, then the grounds they were measured against, which sit last so they are behind the claim
	 * rather than over it — four rows on a pull that never exceeded two enemies and five on one that did.
	 *
	 * The up row is a list of whole totem lifetimes, so a short one is a totem that really did tick —
	 * one re-laid at once, or one the pull's end cut off — and hiding it at sub-pixel width would be
	 * the chart disagreeing with the uptime figure beside it. The down row is a complement, so it
	 * fragments on placement jitter, and widening that would paint a fault the pull did not have. See
	 * `Track.widen`.
	 *
	 * `EXEMPT`, not `miss`, for all three grounds: they are the rail the other two are measured on, and
	 * colouring any of them like a fault would say the elemental was a mistake when the list wants it
	 * pressed, or that the player should have kept a totem up through a phase with nothing in it, or
	 * through an add wave nothing asked for a fire totem in.
	 *
	 * **And they disagree about widening, which is the one place "exempt is one concept" stops.** The away
	 * and add-wave rows are grounds and nothing else, so a sliver of either is a `contactSegments` or
	 * target-count boundary rather than a phase, and widening it would claim a break the fight did not
	 * take. Neither carries a length floor either, for the reason `FlameShockUptime` sets out at length:
	 * the rows sum to `durationMs - searingTotem.scoredMs`, and a floor would move that total without
	 * moving anything a reader can see. The elemental row is also a *counted* row — the tile above counts
	 * the overlaps one by one — so a stretch of it drawn too small to see would contradict a number the
	 * reader can read, and it stays widened. Which way a row goes is a fact about the data behind it, not
	 * about its colour. See `Track.widen`.
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
			{ label: away?.label ?? '', tone: EXEMPT, windows: away?.windows ?? [], lengthLabel: 'for', widen: false },
			// Only on the pulls that have one, unlike the two rows either side of it. Those two are on every
			// pull the chart draws at all, so a row of theirs that came and went would read as a rendering
			// fault; a pull that never exceeded two enemies has no add wave to draw and its absence is the
			// answer. Same reasoning as the note under the section.
			...(aoe === undefined || aoe.windows.length === 0
				? []
				: [{ label: aoe.label, tone: EXEMPT, windows: aoe.windows, lengthLabel: 'for', widen: false } satisfies Track]),
			{ label: slot?.label ?? '', tone: EXEMPT, windows: slot?.windows ?? [], lengthLabel: 'out for' },
		],
		[t, up, dropped, away, aoe, slot],
	);

	if (up.length === 0 && dropped.length === 0 && (slot?.windows.length ?? 0) === 0) {
		return <ChartEmpty>{t('searingTotem.none')}</ChartEmpty>;
	}

	return (
		<ChartFigure
			gap="wide"
			caption={
				<>
					<ChartKey tone="kick">{t('searingTotem.track.up')}</ChartKey>
					<ChartKey tone="miss">{t('searingTotem.track.dropped')}</ChartKey>
					{[away, aoe, slot].map((row) =>
						row === undefined || row.windows.length === 0 ? null : (
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
				chartId="ele-searing-totem-uptime"
				durationMs={analysis.durationMs}
				label={t('searingTotem.chart.uptimeLabel')}
			/>
		</ChartFigure>
	);
}
