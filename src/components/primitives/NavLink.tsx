import type { MouseEvent, ReactNode } from 'react';

/**
 * A pull, or anything else, still being read.
 *
 * **A spinner rather than a pulse on the text.** A pulsing label says "something about this row is
 * provisional" and leaves the reader to guess what; a spinner says "this is working" and says it in the
 * one place the eye already goes for status. It also survives the text being short — a boss name of one
 * word barely reads as pulsing at all.
 *
 * `aria-hidden`, because the row's own copy already carries the state for a screen reader. An icon that
 * announced itself would be the same fact twice.
 */
function Spinner() {
	return (
		<svg
			aria-hidden="true"
			viewBox="0 0 16 16"
			className="size-3 shrink-0 animate-spin text-ink-3 motion-reduce:animate-none"
		>
			{/* The track and the arc, so the shape reads as a ring being travelled rather than a bare tick —
			    and so it is still a circle for a reader whose motion preference stops it turning. */}
			<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
			<path d="M14 8a6 6 0 0 0-6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
		</svg>
	);
}

/**
 * One entry in a sticky rail, current or not.
 *
 * The styling is the shared part and the only part: what the entries *are* — report sections folded into
 * collapsible groups, or reports holding their kills — differs enough between rails that one component
 * serving both would be a worse abstraction than two. What must not differ is how "you are here" looks,
 * because a reader moving between the two pages is reading the same signal.
 *
 * **Never colour alone.** The rule, the weight and `aria-current` all say the same thing, so the state
 * survives a reader who cannot separate the two greens and reaches one who is not looking at all.
 * `location` rather than `page`: the target is a place inside this page, not one page of several.
 */
export default function NavLink({
	href,
	current,
	indented = false,
	pending = false,
	onClick,
	children,
}: {
	href: string;
	current: boolean;
	/** A child entry, set in from its parent. */
	indented?: boolean;
	/**
	 * Still loading. Shows a spinner, and is otherwise an ordinary inactive entry — still a link, because
	 * its heading is already on the page.
	 *
	 * **The text keeps the resting colour rather than taking one of its own.** Tinting it read as *more*
	 * prominent than a settled entry, not less: `text-ink-3` is the brighter of the two, so a rail full of
	 * pending pulls lit up while the one already read receded. The spinner is the state; the label is just
	 * the label.
	 */
	pending?: boolean;
	onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
	children: ReactNode;
}) {
	return (
		<a
			href={href}
			onClick={onClick}
			aria-current={current ? 'location' : undefined}
			className={`flex min-h-11 items-center gap-2 border-l-2 py-2 pr-2 ${indented ? 'pl-6' : 'pl-3'} leading-snug transition-colors ${
				current ? 'border-kick font-semibold text-ink' : 'border-line text-muted hover:border-muted hover:text-ink-2'
			}`}
		>
			<span className="min-w-0 flex-1">{children}</span>
			{pending ? <Spinner /> : null}
		</a>
	);
}
