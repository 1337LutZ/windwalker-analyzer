import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { TEB_CAP } from '~/specs/windwalker/lib';
import type { Analysis } from '~/lib/types';

import ResourceChart from '~/components/charts/ResourceChart';
import type { ShadeWindow } from '~/components/charts/ResourceTrack';
import { cappedOf } from '~/components/charts/capped';
import { resourceCurveFromPoints } from '~/components/charts/resourceCurve';

/**
 * The Tigereye Brew bank across the pull, with every brew marked by what it spent.
 *
 * Drawn by the same component and on the same clock as the timeline's bank row, rather than by
 * ApexCharts as it was: the bank is a counter of whole stacks, and the two charts of it on this page
 * disagreeing about their pitch made one pull look like two measurements.
 *
 * Stepped, like chi and for the same reason — the bank holds whole stacks, and a slope between two
 * readings would draw a fraction of a stack nobody ever had.
 *
 * The brews themselves are the point of the chart, so each is shaded and *labelled with what it
 * spent*. A brew that went out on eight stacks and one that went out on ten are the same bar
 * otherwise, and that difference is the whole argument of the section this sits in. The stretches at
 * the ceiling are picked out underneath, because those are stacks the bank refused to take.
 */
export default function BrewBankTrack({ analysis }: { analysis: Analysis }) {
	const { t } = useTranslation('report');
	const { brew, durationMs } = analysis;

	// `TEB_CAP` rather than the pull's observed peak: a bank that never reached twenty still had twenty
	// to reach, and scaling to the peak would draw a half-full bank as a full one.
	const curve = useMemo(() => resourceCurveFromPoints(brew.bankTimeline, TEB_CAP), [brew.bankTimeline]);

	/**
	 * One shade per brew, carrying its stack count as the note drawn inside it.
	 *
	 * A refresh is skipped: WarcraftLogs records a re-cast inside a running window as a `refreshbuff`,
	 * so the same window would otherwise be shaded twice and labelled with whichever spend was read
	 * last. A brew with no window at all is one the log never showed going up, and a bar drawn for it
	 * would be a claim the events do not support.
	 */
	const brews = useMemo<ShadeWindow[]>(
		() =>
			brew.useList
				.filter((use) => use.window !== null && !use.refresh)
				.map((use) => ({
					start: use.window?.start ?? use.t,
					end: use.window?.end ?? use.t,
					text: t('brew.spentStacks', { count: use.consumed }),
				})),
		[brew.useList, t],
	);

	if (curve === null) return null;

	return (
		<ResourceChart
			curve={curve}
			durationMs={durationMs}
			mode="steps"
			tone="rune"
			legend={t('brew.key.bank')}
			bands={[
				// The cap first, so a brew fired to escape it is drawn on top of the stretch it escaped. The
				// key reads in the same order for the same reason: it is the order the chart was painted in.
				{ tone: 'miss', windows: cappedOf(curve), legend: t('brew.key.capped') },
				{ tone: 'brew', windows: brews, legend: t('brew.key.press'), upright: true },
			]}
			label={t('brew.chartLabel', {
				duration: durationMs,
				peak: Math.max(0, ...curve.points.map(([, n]) => n)),
				cap: curve.max,
				uses: brew.uses,
				avg: brew.avgConsumed,
				capped: brew.wastedAtCap,
			})}
		/>
	);
}
