import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { complementOf, intersect } from '~/lib/analysis/intervals';
import type { Analysis, ElementalAuditResult } from '~/lib/types';

import { ChartFigure } from '~/components/primitives';
import ChartEmpty from '~/components/charts/ChartEmpty';
import ChartKey from '~/components/charts/ChartKey';
import { exemptRows } from '~/components/charts/exempt';
import TrackLane, { type LaneSource } from '~/components/charts/TrackLane';

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
 *
 * **And the green row is clipped to that clock, which is the same promise kept on the other side of the
 * chart.** `searingTotem.uptimeMs` is *already* the clipped figure — the audit intersects the totem's
 * lifetimes with `stScored` before summing, so `uptimeMs / scoredMs` is `uptimePct` exactly — while this
 * component was drawing `searingTotem.windows`, the raw lifetimes. On `cleave` that is 161 338ms of row
 * above a tile taking 88.50% of 127 378, and a reader measuring the green against the pull saw a totem
 * that barely went out. Clipped, the row is 112 728ms, which is the numerator to the millisecond on all
 * three fixtures. `DebuffTimeline` has drawn its up row contact-scoped from the start for this reason
 * ("both rows are measurements the tiles state, so neither may overstate itself"); this chart and
 * `FlameShockUptime` were the two that did not.
 *
 * The lifetime outside the clock is not thrown away, it gets a row: a totem that really was ticking is a
 * fact about the pull, and `8e011ac`'s rule for this shape is that an unmeasured figure is not a deleted
 * one. It takes the exempt tone, because it is time nothing graded, and its own name, because a grey row
 * saying "the totem was up here and it was not counted" is a different fact from the three saying why.
 */
export default function SearingTotemUptime({ analysis }: { analysis: Analysis }) {
	const { t } = useTranslation('report');
	const el = analysis as Analysis & ElementalAuditResult;
	const { searingTotem } = el;
	const windows = searingTotem.windows;
	const feWindows = searingTotem.feWindows;
	const aoeWindows = el.lightningShield.aoeWindows;
	const { up, uncounted, dropped, exempt } = useMemo(() => {
		// The totem's raw lifetimes, before the clip below. Not a row on its own any more: the two rows it
		// splits into are, and `up + uncounted` is this back again.
		const drawn = windows.map((w): [number, number] => [w.start, w.end]);
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
			// `up + dropped` is `placeable` and `up + dropped + exempt` is the pull — the identity
			// `exemptTrack.test.ts` now asserts alongside the one about the exempt rows alone. `up` is
			// `searingTotem.uptimeMs` to the millisecond, which is what makes the row and the tile one claim.
			up: intersect(drawn, placeable),
			uncounted: intersect(drawn, complementOf(placeable, analysis.durationMs)),
			dropped: intersect(complementOf(drawn, analysis.durationMs), placeable),
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
	 * The up row is the totem's lifetimes cut to the clock, so a short one is very nearly always a totem
	 * that really did tick — one re-laid at once, or one the pull's end cut off — and hiding it at
	 * sub-pixel width would be the chart disagreeing with the uptime figure beside it, which is still the
	 * worse of the two risks now the clip can also truncate a lifetime at a clock boundary. The down row is
	 * a complement, so it fragments on placement jitter, and widening that would paint a fault the pull did
	 * not have. See `Track.widen`.
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
	/**
	 * The five things this chart draws, in precedence order — first one wins a millisecond two claim.
	 *
	 * `uncounted` goes ahead of the grounds for the reason `FlameShockUptime` gives: it sits inside them,
	 * so it has to paint over them or it is not drawn at all. The rest do not overlap — up, dropped and
	 * the three grounds sum to the pull to the millisecond on all four fixtures, which is the partition
	 * `exemptTrack.test.ts` asserts.
	 *
	 * **Four exempt causes to three grey steps**, which is why this chart waited a commit while Flame
	 * Shock went first. `slot` shares the darkest step with `nothing` and is told apart by a texture,
	 * because both mean "this could not have been up" and because the two never draw next to each other
	 * on any committed pull. `EXEMPT_KIND` carries that measurement.
	 */
	const sources = useMemo(
		(): LaneSource[] => [
			{ label: t('searingTotem.track.up'), tone: 'kick', windows: up, lengthLabel: 'ticking for' },
			{ label: t('searingTotem.track.dropped'), tone: 'miss', windows: dropped, lengthLabel: 'without it for' },
			...(uncounted.length === 0
				? []
				: [
						{
							label: t('searingTotem.track.uncounted'),
							tone: 'unmeasured',
							windows: uncounted,
							lengthLabel: 'ticking but unmeasured for',
						} satisfies LaneSource,
					]),
			// The three grounds in the order the rows drew them, which `exemptRows` has already made disjoint
			// by its own precedence — so unlike `uncounted` above, their order here decides only the key's,
			// not what is painted.
			{ label: away?.label ?? '', tone: 'nothing', windows: away?.windows ?? [], lengthLabel: 'for' },
			...(aoe === undefined || aoe.windows.length === 0
				? []
				: [
						{
							label: aoe.label,
							tone: 'otherList',
							windows: aoe.windows,
							lengthLabel: 'for',
						} satisfies LaneSource,
					]),
			{ label: slot?.label ?? '', tone: 'slot', windows: slot?.windows ?? [], lengthLabel: 'out for' },
		],
		[t, up, uncounted, dropped, away, aoe, slot],
	);

	// `uncounted` joins the guard because the up row is clipped now: a pull whose every totem lifetime fell
	// outside the clock has an empty green row and an empty red one, and "Searing Totem was never placed"
	// over it would be false about a pull that placed it throughout.
	if (up.length === 0 && dropped.length === 0 && uncounted.length === 0 && (slot?.windows.length ?? 0) === 0) {
		return <ChartEmpty>{t('searingTotem.none')}</ChartEmpty>;
	}

	return (
		<ChartFigure
			gap="wide"
			caption={
				<>
					<ChartKey tone="kick">{t('searingTotem.track.up')}</ChartKey>
					<ChartKey tone="miss">{t('searingTotem.track.dropped')}</ChartKey>
					{uncounted.length === 0 ? null : (
						<ChartKey kind tone="unmeasured">
							{t('searingTotem.track.uncounted')}
						</ChartKey>
					)}
					{/* Each ground with the kind it is drawn in, so the key cannot name a grey the lane did not
					    use — the two that share the darkest step are the two the reader most needs the chip for. */}
					{(
						[
							[away, 'nothing'],
							[aoe, 'otherList'],
							[slot, 'slot'],
						] as const
					).map(([row, kind]) =>
						row === undefined || row.windows.length === 0 ? null : (
							<ChartKey key={row.label} kind tone={kind}>
								{row.label}
							</ChartKey>
						),
					)}
				</>
			}
		>
			<TrackLane sources={sources} durationMs={analysis.durationMs} label={t('searingTotem.chart.uptimeLabel')} />
		</ChartFigure>
	);
}
