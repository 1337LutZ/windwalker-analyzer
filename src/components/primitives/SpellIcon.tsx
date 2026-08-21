import type { ReactNode } from 'react';

import { iconUrl, spellIconName } from './spellIcon';

/**
 * The game's own icon for a spell, and optionally its name beside it, linked to Wowhead.
 *
 * An unknown id renders nothing at all rather than a broken-image glyph or a placeholder box. Icons
 * here are decoration next to a name that is already on screen: their absence should cost nothing,
 * and a row of grey squares for the trinket procs nobody has an icon for would cost plenty. With a
 * `label` the same rule applies to the pair — no icon means no wrapper and no link, and the caller's
 * own text is what the reader still has.
 *
 * Where the image comes from is `./spellIcon`, deliberately not this file: a component module has to
 * export nothing but components or React Fast Refresh cannot hot-swap it, and this one is reached
 * through the primitives barrel by most of the report.
 *
 * ## The tooltip
 *
 * The href alone raises it. `power.js` — loaded once in `layouts/Base.astro`, and the only host in
 * `script-src` besides self — scans links for a Wowhead URL and fetches the card on hover, which is
 * why there is no `data-wowhead` here. `ItemIcon` needs that attribute because a set bonus has no
 * single item page to point at; a spell does, so the href carries both jobs.
 *
 * ## Why `label` rather than leaving callers to render their own text
 *
 * Because the tooltip should cover the name too. A reader hovering "Rising Sun Kick" expects the same
 * card the icon gives them, and before this the name was plain text a millimetre away from a link.
 * Wrapping both in one anchor is also the only way the two cannot drift apart when a table reflows.
 *
 * ## Accessibility, and why the two shapes differ
 *
 * With a `label` the anchor is real content: it takes the label as its accessible name and sits in the
 * tab order, like `EnchantIcon`.
 *
 * Without one it stays what the old comment said it was — decoration beside a name already rendered as
 * text — so it is `aria-hidden` and out of the tab order. That keeps the screen reader from reading
 * the same ability twice, which is the reason the `alt` was empty in the first place, and it means the
 * tooltip is a pointer affordance rather than something a keyboard user is made to walk through. A
 * caller that wants the name announced passes it as `label`; that is what the prop is for.
 */
const SIZES = {
	sm: 'h-6 w-6',
	md: 'h-7 w-7',
	lg: 'h-8 w-8',
} as const;

export type SpellIconSize = keyof typeof SIZES;

const WOWHEAD = 'https://www.wowhead.com/mop-classic/spell=';

export default function SpellIcon({
	id,
	size = 'md',
	label,
}: {
	id: number;
	size?: SpellIconSize;
	/**
	 * The ability's name, rendered inside the link so the tooltip covers it too.
	 *
	 * A node rather than a string so a caller can keep its own emphasis or a count beside the name; the
	 * accessible name then comes from `labelText`, or from the node's own text when it is already one.
	 */
	label?: ReactNode;
}) {
	const icon = spellIconName(id);
	if (icon === null) return null;

	const img = (
		<img
			src={iconUrl(icon)}
			// Decorative: the ability's name is always rendered next to it — as this component's own
			// `label`, or as the caller's own text — so announcing the icon too would read the same thing
			// twice. Empty alt is what keeps it out of the accessibility tree.
			alt=""
			aria-hidden="true"
			width={56}
			height={56}
			loading="lazy"
			// `decoding=async` and a fixed box so a slow icon never reflows the table it sits in.
			decoding="async"
			className={`${SIZES[size]} shrink-0 rounded-[3px] border border-line/60`}
		/>
	);

	const href = `${WOWHEAD}${id}`;

	if (label === undefined) {
		return (
			<a
				href={href}
				target="_blank"
				rel="noreferrer noopener"
				// See the note above: decoration, so out of the accessibility tree and out of the tab order
				// rather than a link with no name for a screen reader to announce.
				aria-hidden="true"
				tabIndex={-1}
				className="inline-flex shrink-0"
			>
				{img}
			</a>
		);
	}

	return (
		<a
			href={href}
			target="_blank"
			rel="noreferrer noopener"
			className="inline-flex items-center gap-2 rounded-sm transition-colors hover:text-ink"
		>
			{img}
			<span>{label}</span>
		</a>
	);
}
