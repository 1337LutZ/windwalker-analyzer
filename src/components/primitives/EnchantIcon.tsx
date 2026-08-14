import { enchantById, enchantIconUrl } from './enchants';

/**
 * The enchant on a slot, as its own icon rather than the word "enchanted".
 *
 * A combat log reports an enchant as a bare effect id — `4419` — with no name, no icon and no page.
 * `src/generated/enchants.json` is what turns that into something a reader recognises; it is built
 * from the simulator's database by `scripts/build-enchant-map.mjs`.
 *
 * Wowhead has a page per enchanting *spell*, not per effect id, which is why the map carries the
 * spell id: it is the only one of the two that can be linked, and the link is what raises the
 * tooltip.
 */
export default function EnchantIcon({ id }: { id: number }) {
	const enchant = enchantById(id);

	// An enchant the map does not know is still an enchant — the slot is not bare, and saying nothing
	// would read as unenchanted. It gets the plain fact and no link, since there is no page to open.
	if (enchant === null) {
		return <span className="font-mono text-xs text-muted">enchanted</span>;
	}

	return (
		<a
			href={`https://www.wowhead.com/mop-classic/spell=${enchant.spellId}`}
			target="_blank"
			rel="noreferrer noopener"
			aria-label={enchant.name}
			className="inline-flex items-center gap-1.5 rounded-sm text-muted transition-colors hover:text-ink-2"
		>
			<img
				src={enchantIconUrl(enchant.icon)}
				alt=""
				aria-hidden="true"
				width={56}
				height={56}
				loading="lazy"
				decoding="async"
				className="h-4 w-4 shrink-0 rounded-[2px] border border-line/60"
			/>
			{/* The name is trimmed of its category, which the slot beside it already says: every chest
			    enchant is called "Enchant Chest — …" and repeating that costs the width the actual name
			    needs. */}
			<span className="truncate font-mono text-xs">{enchant.name.replace(/^Enchant [A-Za-z ]+ - /, '')}</span>
		</a>
	);
}
