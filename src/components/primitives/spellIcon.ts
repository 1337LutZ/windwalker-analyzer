import ICONS from '~/generated/spell-icons.json';

/**
 * Where a spell's icon lives, kept apart from the component that draws it.
 *
 * The split is not organisational tidiness — it is what keeps React Fast Refresh working. A module is
 * only hot-swappable when *every* export is a component; one plain function beside the component and
 * the module becomes ineligible, the invalidation propagates to whatever imported it, and when it
 * reaches an island root with no refresh boundary left the dev server falls back to reloading the
 * whole page. `SpellIcon.tsx` exported two of these, and 36 files reach it through the primitives
 * barrel, so most edits under `primitives/` were throwing the interface away and rebuilding it.
 *
 * Names come from a map generated at build time by `scripts/fetch-spell-icons.mjs`, so the page makes
 * no call to Wowhead — the only third-party request is the image itself, from `wow.zamimg.com`, which
 * the content-security policy names explicitly and the README declares.
 */

/**
 * Wowhead's `large` is 56px. Every size the icon component draws at is 24–32 CSS pixels, so on a 2×
 * display the 36px `medium` would be resampled upwards and look soft; 56px covers all of them with
 * room to spare and the file is still only a couple of kilobytes.
 */
export const iconUrl = (icon: string): string => `https://wow.zamimg.com/images/wow/icons/large/${icon}.jpg`;

export function spellIconName(id: number): string | null {
	return (ICONS as Record<string, string>)[String(id)] ?? null;
}

/**
 * The image URL for a spell id, or null when nothing is known about it.
 *
 * Used by the cast timeline, which draws hundreds of icons and cannot afford the wrapper element
 * `SpellIcon` would put around each one — it positions a bare `<img>` itself. The URL shape lives
 * here so there is still one place that knows where an icon lives, which is what the
 * content-security policy is written against.
 */
export function spellIconUrl(id: number): string | null {
	const icon = spellIconName(id);
	return icon === null ? null : iconUrl(icon);
}
