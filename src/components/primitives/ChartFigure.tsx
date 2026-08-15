import type { ReactNode } from 'react';

/** Keeps chart spacing and caption structure consistent without constraining caption content. */
export default function ChartFigure({
	children,
	caption,
	gap = 'normal',
}: {
	children: ReactNode;
	caption: ReactNode;
	gap?: 'normal' | 'wide';
}) {
	return (
		<figure className={`m-0 flex flex-col ${gap === 'wide' ? 'gap-3.5' : 'gap-2'}`}>
			{children}
			<figcaption className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted">{caption}</figcaption>
		</figure>
	);
}
