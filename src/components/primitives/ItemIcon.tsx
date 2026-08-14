/**
 * An equipped item drawn the way a gear planner draws it: the icon carries the item level in one
 * corner and its gems along the bottom edge, so a set can be read down a column without the eye
 * leaving the icons.
 *
 * The icon file name comes from the log itself — `combatantinfo` hands it over with the item — so
 * unlike `SpellIcon` there is no generated name map to consult. Same image host either way, already
 * named in the content-security policy.
 *
 * The link is what raises the Wowhead tooltip: their script attaches to any anchor pointing at an
 * item page and fetches the card on hover. See `wowheadTooltips` in the layout for what that costs.
 */
const iconUrl = (icon: string): string =>
	`https://wow.zamimg.com/images/wow/icons/large/${icon.replace(/\.jpg$/, '')}.jpg`;

/** Wowhead's Mists Classic item pages, which is the branch this report reads logs from. */
export const itemUrl = (id: number): string => `https://www.wowhead.com/mop-classic/item=${id}`;

/**
 * The tooltip parameter that turns a tier piece's card into a useful one: the set block listing
 * "(2) Set: …" / "(4) Set: …" with the pieces the player owns picked out and the bonuses those
 * pieces actually switch on.
 *
 * Format copied from wowsims-mop rather than guessed — `ui/core/wowhead.ts:127-128`, which writes
 * `params.set('pcs', options.setPieceIds.join(':'))`, fed from `ui/core/player.ts:1217`. That sim
 * targets the same game branch this report reads, so the same widget parses it the same way.
 *
 * Why a `data-wowhead` attribute rather than a query string on the href: `power.js` scans the href
 * for parameters and then the attribute over the top of it, so the two merge. Either would reach the
 * tooltip, but the href also decides where the link *goes*, and a clicked-through item page has its
 * own opinion about which set pieces you own.
 *
 * The list includes this piece's own id. That looks like an off-by-one and is not: the widget walks
 * `pcs`, marks each id it finds among the set's pieces, and counts the marks to fill in the set
 * header's "(0/5)", so omitting the piece being hovered would under-count the set by one and hide a
 * bonus the player has. The simulator passes its entire equipped array for the same reason — ids
 * outside the set never match, so they cost nothing.
 */
const setPiecesParam = (ids: readonly number[]): string => `pcs=${ids.join(':')}`;

/**
 * WoW's rarity scale, as a border. Only the grades raid gear actually arrives at are worth a colour;
 * anything below sits in the neutral line colour rather than inventing a shade for it.
 */
const QUALITY: Record<number, string> = {
	2: 'border-kick/60',
	3: 'border-sky-500/70',
	4: 'border-rune/80',
	5: 'border-brew/80',
};

const SIZES = {
	sm: { box: 'h-6 w-6', gem: 'h-2.5 w-2.5', text: 'text-[9px]' },
	md: { box: 'h-11 w-11', gem: 'h-3 w-3', text: 'text-[10px]' },
	lg: { box: 'h-14 w-14', gem: 'h-3.5 w-3.5', text: 'text-[11px]' },
} as const;

export default function ItemIcon({
	id,
	icon,
	quality,
	itemLevel = null,
	gems = [],
	setPieceIds = [],
	size = 'lg',
	label,
}: {
	id: number;
	icon: string | null;
	quality: number | null;
	itemLevel?: number | null;
	gems?: Array<{ id: number; icon: string | null }>;
	/**
	 * Every equipped piece of this item's set, this one included — see `setPiecesParam`.
	 *
	 * Empty for anything that is not part of a set, which is most of a character and all of a log
	 * captured before the field was read. Empty means the tooltip is left exactly as it was.
	 */
	setPieceIds?: readonly number[];
	size?: keyof typeof SIZES;
	/** What the link announces, since the icon itself carries no name to read. */
	label: string;
}) {
	if (id === 0) return null;

	const scale = SIZES[size];
	const border = QUALITY[quality ?? 0] ?? 'border-line';

	return (
		// A span, not the link. Each gem is its own Wowhead link and an anchor cannot be nested inside
		// another one, so the frame has to be a plain element with the item link filling it and the gem
		// links sitting above.
		//
		// The border is on this wrapper rather than on the image: an absolutely positioned child is
		// placed against its container's *padding* box, so with the border here the item level and the
		// gems land inside the frame instead of on top of it.
		<span
			className={`relative inline-flex shrink-0 overflow-hidden rounded-[3px] border-2 ${border} bg-raised ${scale.box}`}
		>
			<a
				href={itemUrl(id)}
				target="_blank"
				rel="noreferrer noopener"
				aria-label={label}
				// Omitted rather than emitted empty when the piece is in no set: `pcs=` with nothing after
				// it is a parameter the widget still parses, and an empty piece list on a card that has no
				// set block is a request to think about for no reason.
				data-wowhead={setPieceIds.length === 0 ? undefined : setPiecesParam(setPieceIds)}
				className="absolute inset-0 transition-opacity hover:opacity-90"
			>
				{icon === null ? null : (
					<img
						src={iconUrl(icon)}
						alt=""
						aria-hidden="true"
						width={56}
						height={56}
						loading="lazy"
						decoding="async"
						className="h-full w-full"
					/>
				)}
			</a>

			{/* Top-left, over the art. A number in the corner of the icon is how every gear planner
			    prints it, and it keeps the row's text column for things the icon cannot show.
			    `pointer-events-none` so it does not punch a hole in the item's own hover target. */}
			{itemLevel === null ? null : (
				<span
					className={`pointer-events-none absolute top-0 left-0 z-10 rounded-br-[3px] bg-bg/85 px-1 font-mono ${scale.text} leading-tight font-semibold text-ink tabular-nums`}
				>
					{itemLevel}
				</span>
			)}

			{/* Gems along the bottom edge, centred, each linking to its own page so each raises its own
			    tooltip. Above the item link rather than inside it — inside, the hover belonged to the
			    item and a gem could not be pointed at. */}
			{gems.length === 0 ? null : (
				<span className="absolute inset-x-0 bottom-0 z-10 flex justify-center gap-px">
					{gems.map((gem, index) => (
						<a
							key={`${gem.id}-${index}`}
							href={itemUrl(gem.id)}
							target="_blank"
							rel="noreferrer noopener"
							aria-label={`Gem ${gem.id}`}
							className="inline-flex transition-opacity hover:opacity-80"
						>
							{gem.icon === null ? (
								<span className={`${scale.gem} rounded-[2px] border border-bg/70 bg-raised`} aria-hidden="true" />
							) : (
								<img
									src={iconUrl(gem.icon)}
									alt=""
									aria-hidden="true"
									width={56}
									height={56}
									loading="lazy"
									decoding="async"
									className={`${scale.gem} rounded-[2px] border border-bg/70`}
								/>
							)}
						</a>
					))}
				</span>
			)}
		</span>
	);
}
