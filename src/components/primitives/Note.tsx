import type { ReactNode } from 'react';

/**
 * The quieter footnote voice — caveats about what the data cannot prove.
 *
 * Quieter is colour and width, not size: it bottoms out at 14px like everything else, because a
 * caveat nobody can read is a caveat that was not made.
 */
export default function Note({ children }: { children: ReactNode }) {
	return <p className="m-0 max-w-[70ch] text-sm leading-relaxed text-muted">{children}</p>;
}
