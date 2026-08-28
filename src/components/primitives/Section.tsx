import type { ReactNode } from 'react';

/**
 * One titled block of the report.
 *
 * The heading owns the id the section is addressed by, so a reader moving between landmarks hears
 * the section's name rather than "section, section, section".
 */
export default function Section({
	id,
	title,
	action,
	children,
}: {
	id: string;
	title: string;
	/**
	 * Something to do with this section, sitting on its heading rule — a link back to the log, say.
	 *
	 * Optional and absent everywhere but the segment tool, so every existing heading renders exactly as
	 * it did. Inside the `h2` rather than beside it because the rule and the spacing belong to the
	 * heading, and a sibling would need both restated to line up with it. The wrapper drops the
	 * heading's uppercase and tracking, which are a label's and not a control's.
	 */
	action?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section aria-labelledby={`${id}-heading`} className="flex flex-col">
			<h2
				id={`${id}-heading`}
				className="section-heading m-0 mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b pb-2.5 font-mono text-sm font-semibold tracking-[0.14em] uppercase text-muted"
			>
				{title}
				{action === undefined ? null : <span className="font-normal tracking-normal normal-case">{action}</span>}
			</h2>
			{children}
		</section>
	);
}
