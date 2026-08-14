import ICONS from '~/generated/spell-icons.json';

/**
 * The game's own icon for a spell, beside its name.
 *
 * Names come from a map generated at build time by `scripts/fetch-spell-icons.mjs`, so the page
 * makes no call to Wowhead — the only third-party request is the image itself, from
 * `wow.zamimg.com`, which the content-security policy names explicitly and the README declares.
 *
 * An unknown id renders nothing at all rather than a broken-image glyph or a placeholder box. Icons
 * here are decoration next to a name that is already on screen: their absence should cost nothing,
 * and a row of grey squares for the trinket procs nobody has an icon for would cost plenty.
 */
const SIZES = {
	sm: 'h-6 w-6',
	md: 'h-7 w-7',
	lg: 'h-8 w-8',
} as const;

export type SpellIconSize = keyof typeof SIZES;

/**
 * Wowhead's `large` is 56px. Every size here draws at 24–32 CSS pixels, so on a 2× display the 36px
 * `medium` would be resampled upwards and look soft; 56px covers all of them with room to spare and
 * the file is still only a couple of kilobytes.
 */
const iconUrl = (icon: string): string => `https://wow.zamimg.com/images/wow/icons/large/${icon}.jpg`;

export function spellIconName(id: number): string | null {
	return (ICONS as Record<string, string>)[String(id)] ?? null;
}

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
