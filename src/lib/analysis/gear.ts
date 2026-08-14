import type { GearPiece, GearSlot, GearSummary, WclEvent } from '~/lib/types';

import { isCombatantInfo } from '~/lib/events/guards';

/**
 * The equipment array's slot order, which `combatantinfo` gives positionally with no names.
 *
 * Verified against a real pull rather than assumed: index 14 held the ilvl 608 legendary cloak, 15
 * and 16 the two weapons a Windwalker dual-wields, and 3 and 17 the ilvl 1 shirt and an empty
 * tabard. A mislabelled array here would put every warning on the wrong row, so it is worth stating
 * how it was checked.
 */
const SLOTS = [
	'Head',
	'Neck',
	'Shoulder',
	'Shirt',
	'Chest',
	'Waist',
	'Legs',
	'Feet',
	'Wrist',
	'Hands',
	'Ring 1',
	'Ring 2',
	'Trinket 1',
	'Trinket 2',
	'Back',
	'Main hand',
	'Off hand',
	'Tabard',
] as const;

/**
 * The slots this report will call out when they carry no enchant.
 *
 * Deliberately narrower than "every slot that *can* be enchanted". Rings are enchantable only by an
 * enchanter, so an empty ring is a profession the player does not have rather than a mistake, and
 * flagging it would be the same fabricated indictment this report refuses elsewhere. Head, neck,
 * waist and trinkets take no enchant at all in Mists — the waist slot takes a belt buckle, which is
 * a socket and shows up as a gem.
 *
 * What is left is the set anyone can buy or have applied, which is exactly the set the observed
 * pull had covered: shoulder, chest, legs, feet, wrist, hands, back and both weapons.
 */
const ENCHANTABLE = new Set(['Shoulder', 'Chest', 'Legs', 'Feet', 'Wrist', 'Hands', 'Back', 'Main hand', 'Off hand']);

/** Slots that never count toward an item level average, whatever they hold. */
const COSMETIC = new Set(['Shirt', 'Tabard']);

const EMPTY: GearSummary = { slots: [], averageItemLevel: null, missingEnchants: [], gems: 0, masteryRating: null };

/**
 * What the player was wearing, from the `combatantinfo` event the fight fetch already returns.
 *
 * No extra request: `dataType: All` filtered to this player already carries one `combatantinfo`, so
 * the gear costs nothing beyond reading it. Which is worth saying, because the obvious
 * implementation is a second query for something already in hand.
 */
export function readGear(events: readonly WclEvent[], sourceID: number): GearSummary {
	const info = events.find((event) => isCombatantInfo(event) && event.sourceID === sourceID);
	if (info === undefined || !isCombatantInfo(info) || info.gear === undefined) return EMPTY;

	const slots = info.gear.slice(0, SLOTS.length).map((piece, index) => toSlot(piece, SLOTS[index] ?? `Slot ${index}`));
	const levelled = slots.filter((s) => s.id !== 0 && s.itemLevel !== null && !COSMETIC.has(s.slot));

	return {
		slots,
		averageItemLevel:
			levelled.length === 0
				? null
				: Math.round((levelled.reduce((sum, s) => sum + (s.itemLevel ?? 0), 0) / levelled.length) * 10) / 10,
		// An empty slot is not an unenchanted one. A monk with no off-hand has nothing to enchant
		// there, and saying otherwise would invent a fault out of a two-handed weapon.
		missingEnchants: slots.filter((s) => s.enchantable && s.id !== 0 && s.enchantID === null).map((s) => s.slot),
		gems: slots.reduce((count, s) => count + s.gems.length, 0),
		masteryRating: readMastery(info.mastery),
	};
}

/**
 * The player's mastery rating at the pull, or null when the log did not report one.
 *
 * Wanted because Tigereye Brew's per-stack bonus is `0.05 + masteryPercent`
 * (`sim/monk/windwalker/tigereye_brew.go:52`), so mastery is the only thing that turns a count of
 * brew stacks into a damage figure.
 *
 * `0` has to mean "not reported" rather than "no mastery". Nobody at level 90 has zero mastery
 * rating — the stat exists on gear, on reforges and on two raid buffs — and every `combatantinfo`
 * checked on a Mists Classic report carries `mastery: 0` beside a perfectly plausible
 * `critMelee` and `hasteMelee`, which is WarcraftLogs declining to fill the field rather than a
 * character sheet. Reading it as a real zero would hand every pull the same invented number, which
 * is exactly the failure this report refuses elsewhere.
 */
function readMastery(rating: unknown): number | null {
	return typeof rating === 'number' && rating > 0 ? rating : null;
}

function toSlot(piece: GearPiece, slot: string): GearSlot {
	return {
		slot,
		id: piece.id,
		itemLevel: piece.itemLevel ?? null,
		quality: piece.quality ?? null,
		icon: piece.icon ?? null,
		gems: (piece.gems ?? []).filter((gem) => gem.id > 0).map((gem) => ({ id: gem.id, icon: gem.icon ?? null })),
		// `0` reaches this field as often as the key is absent, and it means the same thing.
		enchantID: piece.permanentEnchant === undefined || piece.permanentEnchant === 0 ? null : piece.permanentEnchant,
		enchantable: ENCHANTABLE.has(slot),
		// Same shape as the enchant above: absent and `0` both mean "belongs to no set". Absent is the
		// common one — the field is missing from every fixture captured before it was read, and from
		// every piece that simply is not tier — so this has to degrade to null rather than assume a key.
		setID: piece.setID === undefined || piece.setID === 0 ? null : piece.setID,
	};
}
