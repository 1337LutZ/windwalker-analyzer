import type { ReactNode } from 'react';

/** Body copy. Capped at 64ch because these sections are explanations, not tables of numbers. */
export default function Prose({ children }: { children: ReactNode }) {
	return <p className="m-0 max-w-[64ch] text-base leading-relaxed text-ink-2">{children}</p>;
}
