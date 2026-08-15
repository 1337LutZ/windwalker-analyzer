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
		<figure className="m-0 flex flex-col gap-2">
			<ScrollableTrack durationMs={durationMs}>
				<ResourceTrack
					curve={energy}
					durationMs={durationMs}
					stroke="var(--color-kick)"
					fill="color-mix(in oklch, var(--color-kick) 18%, transparent)"
					shades={[
						// Painted in the order they should stack: the haste window is the widest claim, the
						// brew sits inside it, and the cap is the thing being looked for.
						{ windows: energizing.hasteWindows, className: 'fill-brew/15', label: 'haste' },
						{ windows: energizing.windows, className: 'fill-rune/25', label: 'brew' },
						{ windows: cappedOf(energy), className: 'fill-miss/25', label: 'capped' },
					]}
					label={t('energizingBrew.trackAria', {
						casts: energizing.casts,
						max: energy.max,
						duration: fmt(durationMs),
					})}
				/>
			</ScrollableTrack>

			<figcaption className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted">
				<ChartKey tone="kick">{t('energizingBrew.key.energy')}</ChartKey>
				<ChartKey tone="rune">{t('energizingBrew.key.brew')}</ChartKey>
				<ChartKey tone="brew">{t('energizingBrew.key.haste')}</ChartKey>
				<ChartKey tone="miss">{t('energizingBrew.key.capped')}</ChartKey>
			</figcaption>
		</figure>
	);
}
