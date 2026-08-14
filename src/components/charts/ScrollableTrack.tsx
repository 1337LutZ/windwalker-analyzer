import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { buttonClass } from '../primitives/controls';
import { fmt } from '../format';
import { ZOOM_LADDER, tickStepMs, useDragScroll, zoomForSlice } from './scroll';

/**
 * How much of the pull a track opens showing, when its caller does not say otherwise.
 *
 * A minute, or the whole pull when it is shorter — a two-minute kill should not open already
 * scrolled. Wide enough that a run at a resource's ceiling is a band rather than a smudge, narrow
 * enough that the presses inside it are distinguishable from each other.
 */
const OPENING_SLICE_MS = 60_000;

/** What a track is laid out against before it has measured itself. */
const ASSUMED_WIDTH_PX = 900;

/**
 * The scroll, zoom and clock a resource track sits inside.
 *
 * Extracted because three sections draw the same chart furniture around different bars — energy, chi,
 * and the energy bar under the Energizing Brew audit — and three copies of a zoom ladder is three
 * places for the ladders to drift apart. Two charts of one pull that disagree about where a minute
 * falls are worse than either alone, so the step helper, the ladder and the drag behaviour are shared
 * rather than reimplemented; see `./scroll`.
 *
 * Everything inside is positioned as a *proportion* of the pull, which is what lets zoom change
 * exactly one number — the track's width — and have the browser re-lay-out the contents without any
 * of them being rebuilt. So this component sets a width and otherwise stays out of the way.
 *
 * The zoom floor is fitting the whole pull. A chart that can be zoomed out past showing everything it
 * has is a scrollbar for nothing.
 */
export default function ScrollableTrack({
	durationMs,
	children,
	openingSliceMs = OPENING_SLICE_MS,
}: {
	durationMs: number;
	children: ReactNode;
	openingSliceMs?: number;
}) {
	const { t } = useTranslation('report');
	const fitted = zoomForSlice(durationMs, durationMs, ASSUMED_WIDTH_PX);
	const [zoom, setZoom] = useState(() => Math.max(fitted, zoomForSlice(durationMs, openingSliceMs, ASSUMED_WIDTH_PX)));
	const drag = useDragScroll();

	const pxPerSec = ZOOM_LADDER[zoom] ?? 12;
	const trackPx = Math.max(320, (durationMs / 1000) * pxPerSec);
	const stepMs = tickStepMs(pxPerSec);
	const ticks: number[] = [];
	for (let at = 0; at < durationMs; at += stepMs) ticks.push(at);

	return (
		<div className="flex flex-col gap-2">
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
					{children}
					{/* The same clock the cast timeline draws, from the same step helper. */}
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
		</div>
	);
}
