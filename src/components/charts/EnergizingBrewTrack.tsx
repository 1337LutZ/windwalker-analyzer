import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Analysis } from '~/lib/types';

import { buttonClass } from '../primitives';
import { fmt } from '../format';
import ChartKey from './ChartKey';
import ResourceTrack, { cappedOf } from './ResourceTrack';
import { ZOOM_LADDER, tickStepMs, useDragScroll, zoomForSlice } from './scroll';

/**
 * How much of the pull the chart opens showing.
 *
 * A minute, or the whole pull when it is shorter — a two-minute kill should not open already
 * scrolled. Wide enough that a run at the cap is a band rather than a smudge, narrow enough that the
 * brews are distinguishable from each other.
 */
const OPENING_SLICE_MS = 60_000;

/** What the chart is laid out against before it has measured itself. */
const ASSUMED_WIDTH_PX = 900;

/**
 * The energy bar across the pull, with every Energizing Brew and every haste cooldown drawn under
 * it, and the stretches spent at the ceiling picked out.
 *
 * A table of presses can say a brew went out at 3:42 under Bloodlust; it cannot show the shape the
 * section is actually about — the bar climbing to full and sitting there, or the brew arriving on an
 * already-full bar. Those are the two outcomes the priority list's condition exists to separate.
 *
 * Scrollable on the same terms as the cast timeline, and for the same reason: a nine-minute pull
 * squeezed into one screen turns a run at the cap into a smudge two pixels wide. The zoom ladder and
 * the drag behaviour are literally shared with it rather than reimplemented — see `./scroll`.
 *
 * Nothing here grades anything: the verdicts stay in the table, where a fault can name which half of
 * the condition failed.
 */
export default function EnergizingBrewTrack({ analysis }: { analysis: Analysis }) {
	const { t } = useTranslation('report');
	const { energizing, resources, durationMs } = analysis;
	// Opens on a minute of pull rather than on the whole thing, and never zooms out past fitting it:
	// a chart scrolled to show less than it could is a scrollbar for nothing.
	const fitted = zoomForSlice(durationMs, durationMs, ASSUMED_WIDTH_PX);
	const [zoom, setZoom] = useState(() =>
		Math.max(fitted, zoomForSlice(durationMs, OPENING_SLICE_MS, ASSUMED_WIDTH_PX)),
	);
	const drag = useDragScroll();

	// A report captured before the events query asked for resources carries no curve, and there is
	// nothing to draw without one — the brews alone would be a row of bars with no bar behind them.
	const energy = resources?.energy;
	if (energizing === undefined || energy === undefined) return null;

	const pxPerSec = ZOOM_LADDER[zoom] ?? 12;
	const trackPx = Math.max(320, (durationMs / 1000) * pxPerSec);
	const stepMs = tickStepMs(pxPerSec);
	const ticks: number[] = [];
	for (let at = 0; at < durationMs; at += stepMs) ticks.push(at);

	return (
		<figure className="m-0 flex flex-col gap-2">
			<div className="flex items-center justify-end gap-1">
				<button
					type="button"
					className={`${buttonClass} px-3`}
					disabled={zoom <= fitted}
					aria-label={t('castLog.zoomOut')}
					title={t('castLog.zoomOut')}
					onClick={() => setZoom((z) => Math.max(fitted, z - 1))}
				>
					<span aria-hidden="true">&minus;</span>
				</button>
				<button
					type="button"
					className={`${buttonClass} px-3`}
					disabled={zoom === ZOOM_LADDER.length - 1}
					aria-label={t('castLog.zoomIn')}
					title={t('castLog.zoomIn')}
					onClick={() => setZoom((z) => Math.min(ZOOM_LADDER.length - 1, z + 1))}
				>
					<span aria-hidden="true">+</span>
				</button>
			</div>

			<div
				ref={drag.ref}
				onPointerDown={drag.onPointerDown}
				onPointerMove={drag.onPointerMove}
				onPointerUp={drag.onPointerUp}
				onPointerCancel={drag.onPointerUp}
				tabIndex={0}
				className={`overflow-x-auto rounded-sm border border-line bg-surface ${
					drag.dragging ? 'cursor-grabbing select-none' : 'cursor-grab'
				}`}
			>
				<div className="relative" style={{ width: trackPx }}>
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
					{/* The same clock the cast timeline draws, from the same step helper — two charts of one
					    pull that disagreed about where a minute falls would be worse than either alone. */}
					<div className="relative h-6">
						{ticks.map((at) => (
							<span
								key={at}
								style={{ left: `${(at / Math.max(1, durationMs)) * 100}%` }}
								className="tabular absolute top-0 pl-1 font-mono text-sm text-muted"
							>
								{fmt(at)}
							</span>
						))}
					</div>
				</div>
			</div>

			<figcaption className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted">
				<ChartKey tone="kick">{t('energizingBrew.key.energy')}</ChartKey>
				<ChartKey tone="rune">{t('energizingBrew.key.brew')}</ChartKey>
				<ChartKey tone="brew">{t('energizingBrew.key.haste')}</ChartKey>
				<ChartKey tone="miss">{t('energizingBrew.key.capped')}</ChartKey>
			</figcaption>
		</figure>
	);
}
