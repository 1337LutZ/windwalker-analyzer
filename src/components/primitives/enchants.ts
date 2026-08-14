import ENCHANTS from '~/generated/enchants.json';

/**
 * Turning a combat log's bare enchant id into something a reader recognises.
 *
 * A log reports an enchant as an effect id — `4419` — with no name, no icon and no page.
 * `src/generated/enchants.json` is what resolves it; it is built from the simulator's database by
 * `scripts/build-enchant-map.mjs`.
 *
 * Wowhead has a page per enchanting *spell*, not per effect id, which is why the map carries the
 * spell id: it is the only one of the two that can be linked, and the link is what raises the
 * tooltip.
 *
 * Kept out of `EnchantIcon.tsx` because a component module has to export nothing but components for
 * React Fast Refresh to hot-swap it, and this one is reached through the primitives barrel.
 */
export interface Enchant {
	name: string;
	icon: string;
	spellId: number;
}

export const enchantIconUrl = (icon: string): string =>
	`https://wow.zamimg.com/images/wow/icons/large/${icon.replace(/\.jpg$/, '')}.jpg`;

export function enchantById(id: number): Enchant | null {
	return (ENCHANTS as Record<string, Enchant>)[String(id)] ?? null;
}
