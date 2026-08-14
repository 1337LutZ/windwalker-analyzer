import type { ReactNode } from 'react';

/**
 * One titled block of the report.
 *
 * The heading owns the id the section is addressed by, so a reader moving between landmarks hears
 * the section's name rather than "section, section, section".
 */
export default function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
	return (
		<section aria-labelledby={`${id}-heading`} className="flex flex-col">
			<h2
				id={`${id}-heading`}
				className="m-0 mb-4 border-b border-line pb-2.5 font-mono text-sm font-semibold tracking-[0.14em] uppercase text-muted"
			>
				{title}
			</h2>
			{children}
		</section>
	);
}
