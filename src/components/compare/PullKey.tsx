import type { ReactNode } from 'react';

import type { Side } from '~/lib/compare';

/**
 * Which pull something belongs to: the swatch, then whatever it is labelling.
 *
 * **The identity channel that is not colour.** Every figure on this page draws the first pull filled
 * and the second as a ring, and this is the one place that shape is set, so a name in the header and a
 * number in a row cannot end up marked differently. A reader who cannot tell violet from azure still
 * reads the page: the mark shapes differ, and both pulls appear in the same order in every row.
 *
 * Filled and hollow rather than two fills, for the reason `CompareScale` gives: at ten pixels a second
 * solid dot is the first one.
 */
export default function PullKey({ side, children }: { side: Side; children: ReactNode }) {
	return (
		// `min-w-0`, or the truncation inside never fires: a flex item defaults to `min-width: auto` and
		// refuses to shrink below its content, so the sticky bar would have overflowed at 320 rather than
		// cutting a long name short.
		<span className="inline-flex min-w-0 items-center gap-1.5">
			<span
				aria-hidden="true"
				className={
					side === 'a'
						? 'size-2.5 shrink-0 rounded-full bg-pull-a'
						: 'size-2.5 shrink-0 rounded-full border-2 border-pull-b bg-surface'
				}
			/>
			{children}
		</span>
	);
}
