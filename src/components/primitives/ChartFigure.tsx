import type { ReactNode } from 'react';

/** The key row: swatches and what they mean, wrapping onto as many lines as the width needs. */
const KEYS = 'flex flex-wrap gap-x-4 gap-y-2';

/**
 * A chart and the caption under it.
 *
 * `caption` is the legend and is always a wrapping row of keys. `note` is the sentence some charts
 * put beneath it — and it is a separate prop rather than more `caption`, because a sentence appended
 * to the key row becomes another flex item and sits *beside* the swatches instead of under them.
 * That is a layout the two charts carrying one never wanted, so the distinction is made here rather
 * than left to each caller to remember an inner wrapper for.
 */
export default function ChartFigure({
	children,
	caption,
	note,
	gap = 'normal',
}: {
	children: ReactNode;
	caption: ReactNode;
	note?: ReactNode;
	gap?: 'normal' | 'wide';
}) {
	return (
		<figure className={`m-0 flex flex-col ${gap === 'wide' ? 'gap-3.5' : 'gap-2'}`}>
			{children}
			{note === undefined ? (
				<figcaption className={`${KEYS} text-sm text-muted`}>{caption}</figcaption>
			) : (
				<figcaption className="flex flex-col gap-2 text-sm text-muted">
					<span className={KEYS}>{caption}</span>
					<span>{note}</span>
				</figcaption>
			)}
		</figure>
	);
}
