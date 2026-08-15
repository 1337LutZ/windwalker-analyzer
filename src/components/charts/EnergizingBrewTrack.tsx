import { useTranslation } from 'react-i18next';

import type { Analysis } from '~/lib/types';

import { fmt } from '../format';
import ResourceChart from './ResourceChart';
import { cappedOf } from './capped';

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
	const energy = resources?.energy;
	if (energizing === undefined || energy === undefined) return null;

	return (
		<ResourceChart
			curve={energy}
			durationMs={durationMs}
			tone="kick"
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
