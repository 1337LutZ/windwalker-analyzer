import SPELLS from '~/generated/spells.json';

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
 * Names come from a map generated at build time by `scripts/build-spell-map.mjs`, so the page makes
 * no call to Wowhead — the only third-party request is the image itself, from `wow.zamimg.com`, which
 * the content-security policy names explicitly and the README declares.
 */

/**
 * Wowhead's `large` is 56px. Every size the icon component draws at is 24–32 CSS pixels, so on a 2×
 * display the 36px `medium` would be resampled upwards and look soft; 56px covers all of them with
 * room to spare and the file is still only a couple of kilobytes.
 */
export const iconUrl = (icon: string): string => `https://wow.zamimg.com/images/wow/icons/large/${icon}.jpg`;

/** The generated map's payload, keyed by id as a string because that is what JSON gives back. */
const SPELL_BY_ID = SPELLS.spells as Record<string, { name: string; icon: string }>;

export function spellIconName(id: number): string | null {
	return SPELL_BY_ID[String(id)]?.icon ?? null;
}

/**
 * The spell's name, or null when the generated map has never heard of the id.
 *
 * For the ids that reach the page as bare numbers rather than through an ability the spec models — a
 * talent list is the case it was added for. `combatantinfo` gives six ids and no names, and the
 * ability table only carries the handful of talents that are also buttons the rotation presses.
 *
 * Null rather than the id as a fallback, so a caller has to decide what an unnamed spell looks like
 * rather than printing `116844` at a reader and calling it a talent.
 */
export function spellName(id: number): string | null {
	return SPELL_BY_ID[String(id)]?.name ?? null;
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
