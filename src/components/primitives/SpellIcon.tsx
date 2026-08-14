import { iconUrl, spellIconName } from './spellIcon';

/**
 * The game's own icon for a spell, beside its name.
 *
 * An unknown id renders nothing at all rather than a broken-image glyph or a placeholder box. Icons
 * here are decoration next to a name that is already on screen: their absence should cost nothing,
 * and a row of grey squares for the trinket procs nobody has an icon for would cost plenty.
 *
 * Where the image comes from is `./spellIcon`, deliberately not this file: a component module has to
 * export nothing but components or React Fast Refresh cannot hot-swap it, and this one is reached
 * through the primitives barrel by most of the report.
 */
const SIZES = {
	sm: 'h-6 w-6',
	md: 'h-7 w-7',
	lg: 'h-8 w-8',
} as const;

export type SpellIconSize = keyof typeof SIZES;

export default function SpellIcon({ id, size = 'md' }: { id: number; size?: SpellIconSize }) {
	const icon = spellIconName(id);
	if (icon === null) return null;

	return (
		<img
			src={iconUrl(icon)}
			// Decorative: the ability's name is always rendered next to it, so announcing the icon too
			// would read the same thing twice. Empty alt is what keeps it out of the accessibility tree.
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
}
