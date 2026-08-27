import { useTranslation } from 'react-i18next';

import { SpellIcon } from '../primitives';

import PullKey from './PullKey';

/**
 * One key per reason a button is missing, written out so the key guard can see them.
 *
 * `i18n/__tests__/keys.test.ts` finds a key by reading the source for quoted key paths, and the row
 * carries its key as a value. Without this table every one of these would be reported as copy nothing
 * reads, and the four sentences would be four strings nobody could find.
 */
export const ABSENCE = {
	notPressed: 'compare.rate.notPressed',
	notTalented: 'compare.rate.notTalented',
	cannotHave: 'compare.rate.cannotHave',
	unknown: 'compare.rate.unknown',
} as const;

export interface RateRow {
	id: number;
	name: string;
	/** Null where that pull never produced the thing being measured, which is not the same as zero. */
	a: number | null;
	b: number | null;
	/**
	 * Why the missing side is missing, as a copy key.
	 *
	 * **"not pressed" was every absence until it was measured, and it was wrong three ways.** A talent
	 * the other player took instead, a racial this character could not have, and a log carrying no
	 * talent list to answer from all read as a button somebody declined to press. See `absenceOf`.
	 */
	absent: string;
}

/**
 * One list of abilities on one shared axis, two pulls per row.
 *
 * **Everything on this axis is already length-normalised**, which is what lets a single domain serve
 * every row. A share of a player's own damage and a press rate per minute both survive a pull that ran
 * twice as long; a raw total does not, and comparing two totals would mostly compare how long the boss
 * lived. So the callers hand over shares and rates, never sums.
 *
 * **Sorted by the size of the gap, not by the size of the button.** The report's own damage chart is
 * ordered biggest-first and should stay that way, because there the question is what did the damage.
 * Here the question is what the two pulls did differently, and an ability both players pressed
 * identically is the least interesting row on the page whatever its share.
 *
 * **An ability one pull never pressed reads as that, not as a nought.** The arithmetic treats it as
 * zero, which is honest — the button produced nothing, and the log measured that — but a bare `0.0`
 * in a column beside a real reading invites a reader to take it for a bad number rather than an absent
 * one.
 *
 * **Both values are printed on every row.** The scale is the addition, not the delivery: nothing here
 * is reachable only by measuring a dot against an axis, so the figure survives greyscale, a screen
 * reader and a narrow viewport, where the track is the first thing to lose its precision.
 *
 * **One column, two or three, by how much width there is.** A cast list runs to twenty-odd rows, and a
 * single column of them is a screen and a half of scrolling for a reader after one button. Grid flow is
 * row-major, so the order the caller sorted into — the rotation, by way of `castOrder` — is still the
 * order a reader meets the rows in: left to right, then down.
 *
 * The shared domain is what makes the columns honest. Every track is scaled by the same `max`, so a
 * mark two thirds along in the third column means what it means in the first. The columns fold one
 * list; they are not three lists side by side.
 *
 * **`lg` and `2xl` are measured rather than picked.** A row wants about 380px of content: below that the
 * readings drop onto a second line under the name, and the longest rows go first — "Legacy of the White
 * Tiger" beside "no talents on record" is the widest thing either list can hold. `md` would have given
 * two columns of ~324px, where seven of twenty-four rows wrap; `lg` and `2xl` both clear 380 once the
 * card's own padding is taken off. A wrapped row is still legible, so this is a raggedness ceiling and
 * not a cliff.
 *
 * **A bordered card per row rather than a rule between rows.** `divide-y` cannot survive the grid: it
 * borders every child but the first *in DOM order*, so across three columns the top-left row loses its
 * rule and the two beside it keep theirs. A border that belongs to the row travels with it into any
 * column count. `rounded-sm border border-line p-3.5` is `SectionGaps`' card, unchanged, because these
 * two lists sit on the same page as those and a second card shape would read as a second kind of thing.
 */
export default function RateGaps({
	rows,
	max,
	format,
	players,
}: {
	rows: readonly RateRow[];
	max: number;
	format: (value: number) => string;
	players: { a: string; b: string };
}) {
	const { t } = useTranslation('report');
	// A floor, so a list whose every reading is zero still has a track to sit on rather than dividing
	// by nothing.
	const domain = Math.max(max, 1);
	const at = (value: number) => Math.max(0, Math.min(100, (value / domain) * 100));

	return (
		<ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 lg:grid-cols-2 2xl:grid-cols-3">
			{rows.map((row) => {
				const left = at(row.a ?? 0);
				const right = at(row.b ?? 0);
				return (
					<li key={row.id} className="flex flex-col gap-1.5 rounded-sm border border-line p-3.5">
						<span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
							<span className="flex min-w-0 items-center text-sm text-ink-2">
								<SpellIcon id={row.id} label={row.name} />
							</span>
							<span className="flex items-baseline gap-3 tabular font-mono text-sm text-ink">
								<PullKey side="a">{row.a === null ? t(row.absent) : format(row.a)}</PullKey>
								<PullKey side="b">{row.b === null ? t(row.absent) : format(row.b)}</PullKey>
							</span>
						</span>
						{/* One track, no zones: there is no rule here to draw as ground, only two readings and the
						    distance between them. The connector is neutral because the distance belongs to both. */}
						<span aria-hidden="true" className="relative block h-3.5">
							<span className="absolute inset-x-0 top-[6px] block h-0.5 rounded-full bg-line" />
							<span
								className="absolute top-[5px] block h-1 rounded-full bg-track"
								style={{ left: `${Math.min(left, right)}%`, width: `${Math.abs(right - left)}%` }}
							/>
							{row.b !== null ? (
								<span
									className="absolute top-[1px] size-3 -translate-x-1/2 rounded-full border-2 border-pull-b bg-surface ring-2 ring-surface"
									style={{ left: `${right}%` }}
								/>
							) : null}
							{row.a !== null ? (
								<span
									className="absolute top-[1px] size-3 -translate-x-1/2 rounded-full bg-pull-a ring-2 ring-surface"
									style={{ left: `${left}%` }}
								/>
							) : null}
						</span>
						<span className="sr-only">
							{players.a} {row.a === null ? t(row.absent) : format(row.a)}, {players.b}{' '}
							{row.b === null ? t(row.absent) : format(row.b)}
						</span>
					</li>
				);
			})}
		</ul>
	);
}
