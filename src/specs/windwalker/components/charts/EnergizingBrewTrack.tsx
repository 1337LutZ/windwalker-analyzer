import { useTranslation } from 'react-i18next';

import type { Analysis } from '~/lib/types';
import { barColor, curveOfBar } from '~/lib/view/resourceBars';
import { specColorsOf } from '~/lib/view/specColors';

import { fmt } from '~/components/format';
import ResourceChart from '~/components/charts/ResourceChart';
import { cappedOf } from '~/components/charts/capped';

/**
 * The energy bar across the pull, with every Energizing Brew and every haste cooldown drawn under
 * it, and the stretches spent at the ceiling picked out.
 *
 * A table of presses can say a brew went out at 3:42 under Bloodlust; it cannot show the shape the
 * section is actually about — the bar climbing to full and sitting there, or the brew arriving on an
 * already-full bar. Those are the two outcomes the priority list's condition exists to separate.
 *
 * The scroll, the zoom ladder and the clock are `ScrollableTrack`, shared with the energy and chi
 * sections rather than reimplemented here: three charts of one pull that disagreed about where a
 * minute falls would be worse than any of them alone.
 *
 * Nothing here grades anything: the verdicts stay in the table, where a fault can name which half of
 * the condition failed.
 */
export default function EnergizingBrewTrack({ analysis }: { analysis: Analysis }) {
	const { t } = useTranslation('report');
	const { energizing, resources, durationMs } = analysis;

	// A report captured before the events query asked for resources carries no curve, and there is
	// nothing to draw without one — the brews alone would be a row of bars with no bar behind them.
	// The curve is read through the same gate the timeline and the energy section use, so a fixture
	// that predates the audits (a bare curve, no `kind`) draws exactly like one that came after them.
	const energy = curveOfBar(resources?.energy);
	if (energizing === undefined || energy === undefined || energy.points.length === 0) return null;

	return (
		<ResourceChart
			curve={energy}
			durationMs={durationMs}
			tone="kick"
			color={barColor(resources?.energy, specColorsOf(analysis.specName).primary)}
			smooth
			legend={t('energizingBrew.key.energy')}
			bands={[
				// Painted in the order they should stack: the haste window is the widest claim, the brew sits
				// inside it, and the cap is the thing being looked for. Order is what separates three
				// overlapping washes now that each tone is drawn at one strength everywhere.
				{ tone: 'brew', windows: energizing.hasteWindows, legend: t('energizingBrew.key.haste') },
				{ tone: 'rune', windows: energizing.windows, legend: t('energizingBrew.key.brew') },
				{ tone: 'miss', windows: cappedOf(energy), legend: t('energizingBrew.key.capped') },
			]}
			label={t('energizingBrew.trackAria', {
				casts: energizing.casts,
				max: energy.max,
				duration: fmt(durationMs),
			})}
		/>
	);
}
