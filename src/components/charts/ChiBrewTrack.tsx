import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { Analysis } from '~/lib/types';

import ResourceChart from './ResourceChart';
import { resourceCurveFromPoints } from './resourceCurve';

/**
 * Chi Brew's charge counter over the pull, with every stretch at two of two picked out.
 *
 * Drawn on the same component as the Tigereye Brew bank, and stepped for the same reason: charges are
 * whole, and a slope through one and a half of them is a quantity nobody ever had.
 *
 * The shaded stretches are the fault this chart exists to show, and it is the opposite of the one the
 * bank chart shows. A full Tigereye bank is stacks arriving with nowhere to go; a full Chi Brew is
 * the button *not being pressed* — a charge at the ceiling is not recharging, so every second there
 * is forty-five seconds of cooldown the pull will never get back.
 *
 * Both the curve and the windows come from the engine's own charge walk rather than being rebuilt
 * from the cast times here. That walk is what produces the idle figure printed beside this chart, and
 * a second reconstruction is exactly how a chart comes to disagree with the number under it.
 */
export default function ChiBrewTrack({ analysis }: { analysis: Analysis }) {
	const { t } = useTranslation('report');
	const brew = analysis.chiBrew;

	const curve = useMemo(
		() =>
			brew === undefined || brew.charges.length === 0 ? null : resourceCurveFromPoints(brew.charges, brew.maxCharges),
		[brew],
	);

	if (brew === undefined || curve === null) return null;

	return (
		<ResourceChart
			curve={curve}
			durationMs={analysis.durationMs}
			mode="steps"
			tone="rune"
			legend={t('chiBrew.key.charges')}
			bands={[{ tone: 'miss', windows: brew.cappedWindows, legend: t('chiBrew.key.capped') }]}
			label={t('chiBrew.chartLabel', {
				uses: brew.casts,
				max: brew.maxCharges,
				idle: brew.cappedMs,
			})}
		/>
	);
}
