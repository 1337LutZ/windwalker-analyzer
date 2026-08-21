// Every raid-buff provider resolves to an icon in the generated spell map.
//
// **A declaration and a generated artifact drifting apart, with nothing failing.** `RaidBuffRow.iconId` is
// the *first* provider of its group (`raidBuffs.ts`), and `src/generated/spells.json` is built separately by
// `scripts/build-spell-map.mjs`. So adding a provider — or reordering one to the front — silently gives its
// row no icon until somebody regenerates the map, and the report just draws a blank.
//
// It had happened four times over when a reader noticed: 24932 Leader of the Pack (crit), 127830 Spirit Beast
// Blessing (mastery), 77747 Burning Wrath and 109773 Dark Intent (spell power) were all absent from the map.
// Three of those four had been added or moved to the front of their group by commits that had no reason to
// think about a generated file — the crit row was reading the druid's own aura instead of the raid-wide one,
// and fixing that put 24932 first.
//
// This asserts the whole provider list rather than those four, because the next one will be a different id.

import { describe, expect, it } from 'vitest';

import { EFFECTS } from '../raidBuffs';
import { spellIconName } from '~/components/primitives/spellIcon';

describe('raid buff icons', () => {
	it('has a provider list worth checking', () => {
		// Not vacuous, and the count is deliberately loose: this fails if the list is ever emptied or the
		// import stops resolving, not when a provider is legitimately added.
		expect(EFFECTS.length).toBeGreaterThan(4);
		expect(EFFECTS.flatMap((e) => e.providers).length).toBeGreaterThan(20);
	});

	it('resolves every provider in the generated spell map', () => {
		const missing = EFFECTS.flatMap((effect) =>
			effect.providers
				.filter((provider) => spellIconName(provider.id) === null)
				.map((provider) => `${effect.key}: ${provider.id} ${provider.name}`),
		);
		expect(missing).toEqual([]);
	});

	it('resolves the icon each row actually draws — its first provider', () => {
		// The stricter half, and the one that decides whether a reader sees anything. A group whose first
		// provider is missing draws a blank even if every other id in it resolves.
		const blank = EFFECTS.filter((effect) => spellIconName(effect.providers[0]?.id ?? -1) === null).map(
			(effect) => effect.key,
		);
		expect(blank).toEqual([]);
	});

	it('still calls 1459 Arcane Brilliance, which a regeneration could undo', () => {
		// The map is rewritten wholesale by the generator, and WarcraftLogs labels this id "Arcane Intellect"
		// — the modern spell's name backfilled onto it by a later client. A MoP reader saw Arcane Brilliance
		// in their buff frame. Pinned here because the risk is a *regeneration* silently reverting it, which
		// no other test would notice.
		expect(EFFECTS.flatMap((e) => e.providers).find((p) => p.id === 1459)?.name).toBe('Arcane Brilliance');
	});
});
