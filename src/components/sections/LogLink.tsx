/**
 * A timestamp that opens WarcraftLogs' replay at that moment, so a claim can be checked rather than
 * trusted. `rel` is set because nothing on this page should be able to see the opener.
 *
 * Laid out as a 44px-high inline box rather than a bare link: the miss ledger prints these in runs
 * of a dozen, and a run of half-height links is a row of targets nobody can hit with a thumb.
 */
export default function LogLink({ href, title, children }: { href: string; title?: string; children: string }) {
	return (
		<a
			href={href}
			title={title}
			target="_blank"
			rel="noreferrer noopener"
			className="mr-3 inline-flex min-h-11 items-center font-mono text-sm whitespace-nowrap text-kick underline underline-offset-2"
		>
			{children}
		</a>
	);
}
