import { useReportCopy } from '~/hooks/useReportCopy';
import type { Analysis, GearSlot } from '~/lib/types';

import { EnchantIcon, ItemIcon, Note, Pill, Prose, Section } from '../primitives';

/**
 * What the player was wearing, slot by slot, with what each piece was missing.
 *
 * The report is otherwise entirely about the four minutes of the pull; this is the one section about
 * the character that walked into it. It earns its place because an unenchanted chest costs damage on
 * every pull until it is fixed, which no amount of rotation work recovers — and because the log
 * already carries it, so the reader would otherwise have to go and check by hand.
 *
 * Not a verdict. Item level is reported and never graded: what gear someone has is a function of how
 * long they have been raiding, and colouring it red would be scolding them for a schedule.
 */
export default function GearSetup({ analysis }: { analysis: Analysis }) {
	const { t } = useReportCopy(analysis);
	const { gear } = analysis;

	// The log did not carry a `combatantinfo` for this player. That is "not reported", not "wearing
	// nothing", and the difference matters enough to say plainly rather than draw eighteen empty rows.
	if (gear.slots.length === 0) {
		return (
			<Section id="gear" title={t('gear.title')}>
				<Note>{t('gear.none')}</Note>
			</Section>
		);
	}

	// Laid out in the simulator's own order so the two read the same way round: its left column top
	// to bottom, then its right. Shirt and tabard are not here for the same reason they are not there
	// — they carry no stats, so they are not part of the character being looked at.
	const ordered = SIM_ORDER.map((name) => gear.slots.find((slot) => slot.slot === name)).filter(
		(slot): slot is GearSlot => slot !== undefined,
	);

	// Which pieces of each set are actually being worn, so every tier icon's tooltip can say how much
	// of its set is on the character — the row itself only knows its own item, and the answer is a
	// property of the whole character. Built once here rather than rescanned per row.
	//
	// Grouped by set rather than handing each icon the full equipped list the way the simulator does:
	// the widget ignores ids outside the set either way, so both are correct, but a piece's tooltip
	// asking about eight items it will never match is noise in the markup for every non-tier slot.
	//
	// Guarded on truthiness rather than `=== null`, which is not the fussiness it looks like. A set id
	// is always a positive integer, and the three things that are not one — `null`, `0`, and the
	// missing key in any report captured before this field was read — all mean "not tier". `=== null`
	// would let `undefined` through and file every fieldless piece under a single `undefined` key,
	// handing each of them a set list naming the whole wardrobe. The type says that cannot happen; the
	// fixtures are cast from JSON, so it can.
	const setPieces = new Map<number, number[]>();
	for (const slot of gear.slots) {
		if (slot.id === 0 || !slot.setID) continue;
		setPieces.set(slot.setID, [...(setPieces.get(slot.setID) ?? []), slot.id]);
	}

	return (
		<Section id="gear" title={t('gear.title')}>
			<Prose>{t('gear.intent')}</Prose>

			<p className="m-0 mt-4">
				{gear.averageItemLevel === null ? null : <Pill>{t('gear.pill.ilvl', { ilvl: gear.averageItemLevel })}</Pill>}
				{/* No gem total. Every gem is already drawn on the icon of the slot it sits in, so a count
				    beside the item level was the same fact a second time — and the only question it could
				    answer, "is a socket empty", it cannot, because it counts what is there rather than what
				    is missing. */}
				{gear.missingEnchants.length > 0 ? (
					<Pill>{t('gear.pill.missing', { count: gear.missingEnchants.length })}</Pill>
				) : null}
			</p>

			{gear.missingEnchants.length > 0 ? (
				<div className="mt-4">
					<Note>
						{t('gear.missing', { slots: gear.missingEnchants.join(', '), count: gear.missingEnchants.length })}
					</Note>
				</div>
			) : null}

			{/* Two columns from `sm` up, the way a gear planner lays a character out, rather than as many
			    as fit: eighteen slots across five columns reads as a grid of icons, and down two columns
			    it reads as a character sheet. */}
			{/* `grid-flow-col` over eight rows, so the two columns run top-to-bottom the way the
			    simulator's pickers do rather than wrapping left-to-right. Below `sm` it collapses to one
			    column and the source order — the simulator's left column, then its right — is what reads. */}
			<ul className="mt-5 grid list-none grid-cols-1 gap-px overflow-hidden rounded-sm border border-line bg-line p-0 sm:grid-flow-col sm:grid-cols-2 sm:grid-rows-8">
				{ordered.map((slot) => (
					<GearRow
						key={slot.slot}
						slot={slot}
						unenchanted={gear.missingEnchants.includes(slot.slot)}
						setPieceIds={slot.setID ? setPieces.get(slot.setID) : undefined}
					/>
				))}
			</ul>
		</Section>
	);
}

/**
 * The simulator's own gear layout: its left column, then its right.
 *
 * Taken from `LEFT_ITEM_PICKERS` and `RIGHT_ITEM_PICKERS` in wowsims-mop
 * (ui/core/components/gear_picker/gear_picker.tsx) rather than invented, so a reader moving between
 * the two is looking at the same shape. Shirt and tabard are absent there and absent here.
 */
const SIM_ORDER = [
	'Head',
	'Neck',
	'Shoulder',
	'Back',
	'Chest',
	'Wrist',
	'Main hand',
	'Off hand',
	'Hands',
	'Waist',
	'Legs',
	'Feet',
	'Ring 1',
	'Ring 2',
	'Trinket 1',
	'Trinket 2',
];

/**
 * One slot: icon, where it sits, and the two facts the log knows about it.
 *
 * The missing-enchant warning is on the row rather than only in the list above, because a reader
 * scanning eighteen slots for the one that is wrong should not have to hold three slot names in
 * their head while they do it.
 */
function GearRow({
	slot,
	unenchanted,
	setPieceIds,
}: {
	slot: GearSlot;
	unenchanted: boolean;
	/** The equipped pieces of this item's set, for the tooltip. Absent when it is in no set. */
	setPieceIds?: readonly number[];
}) {
	return (
		<li className="flex items-center gap-3 bg-surface px-3 py-2.5">
			{/* Item level and gems ride on the icon rather than in the text column — the icon is the
			    thing being scanned, and a number beside it is a second place to look. */}
			<ItemIcon
				id={slot.id}
				icon={slot.icon}
				quality={slot.quality}
				itemLevel={slot.itemLevel}
				gems={slot.gems}
				setPieceIds={setPieceIds}
				label={`${slot.slot} — open item ${slot.id} on Wowhead`}
			/>
			<div className="min-w-0">
				<div className="truncate font-mono text-sm text-ink-2">{slot.slot}</div>
				{unenchanted ? (
					<div className="font-mono text-xs text-miss">no enchant</div>
				) : slot.enchantID === null ? null : (
					<EnchantIcon id={slot.enchantID} />
				)}
			</div>
		</li>
	);
}
