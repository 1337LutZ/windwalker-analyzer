import type { ReactNode } from 'react';

/** A small tally set into a paragraph — a stat count, a proc pairing. */
export default function Pill({ children }: { children: ReactNode }) {
	return (
		<span className="mr-1.5 mb-1.5 inline-block rounded-sm border border-line bg-surface px-2 py-[3px] font-mono text-sm font-medium tracking-[0.06em] text-ink-2">
			{children}
		</span>
	);
}
