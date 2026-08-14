import { Skeleton } from '../primitives';

/**
 * The section blocks the skeleton draws, as the height each body is held open at.
 *
 * Four, not fifteen. The report really does have fifteen sections, but a skeleton of fifteen is six
 * thousand pixels of grey pretending to be a report — and it would still be the wrong six thousand,
 * because every section sizes itself from the pull. Four is roughly a screen: enough to say "a long
 * report is coming and this is its shape", without claiming to know it.
 *
 * The heights are roughly what the charts themselves come out at — a timeline, a resource track, a
 * nine-row bar chart — so the blocks read as the right kind of object rather than as four identical
 * rectangles. Distinct values also give each block a stable key. They are deliberately approximate:
 * a skeleton that matched a chart exactly would still be wrong for the next pull, since every chart
 * here sizes itself from the fight.
 */
const SECTION_HEIGHTS = ['h-[300px]', 'h-[240px]', 'h-[360px]', 'h-[200px]'];

/** The tile row at the top of the report. Six is what the summary card carries. */
const TILES = ['dps', 'cpm', 'brew', 'snapshot', 'debuff', 'misses'];

/** The contents list beside it, which exists from `lg` up and nowhere else. */
const NAV_ROWS = ['w-32', 'w-28', 'w-36', 'w-24', 'w-32', 'w-28'];

/**
 * The report's shape, held open while its events are still being fetched.
 *
 * Reserving the *exact* height of a report nobody has read yet is not possible — the section count
 * is fixed but every one of them sizes itself from the pull, and the pull is what is being fetched.
 * What this can do is stop the page from going from nothing to everything in one frame: the layout
 * appears the moment the reader presses the button, in response to their own click, and the real
 * report then fills into a page that is already the right shape. The residual movement is below the
 * fold, where `ReportFlow` scrolls the reader to the top of the finished report anyway.
 *
 * Entirely decorative, so the whole thing is `aria-hidden` and carries no text and no headings. No
 * text because the fetch already narrates itself once through `FetchProgress`'s live region and a
 * second voice would only talk over it; no headings because `SectionNav`'s observer finds sections
 * by the id on their heading, and a skeleton growing ids would put phantom entries in the contents
 * list of the report that replaces it.
 *
 * The grid, the gaps and the tile row are copied from `Report` rather than invented, so the swap
 * lands the real content where the placeholder already was instead of relaying the page around it.
 */
export default function ReportSkeleton() {
	return (
		<div
			aria-hidden="true"
			// One pulse for the whole skeleton — see `Skeleton` for why the blocks do not carry their own.
			className="motion-safe:animate-pulse lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8"
		>
			<div className="hidden lg:flex lg:flex-col">
				{NAV_ROWS.map((width) => (
					<div key={width} className="flex min-h-11 items-center border-l-2 border-line py-2 pr-2 pl-3">
						<Skeleton className={`h-3.5 ${width}`} />
					</div>
				))}
			</div>

			<div className="flex flex-col gap-10 md:gap-12">
				{/* The header: the eyebrow line, the player's name, the verdict and the paragraph under it. */}
				<div className="flex flex-col">
					<Skeleton className="mb-3 h-3.5 w-64" />
					<Skeleton className="h-8 w-56 sm:h-10 sm:w-72" />
					<Skeleton className="mt-4 h-14 w-full max-w-[56ch]" />
					<Skeleton className="mt-4 h-12 w-full max-w-[64ch]" />
				</div>

				{/* `StatTiles`' own grid: the 1px gap over the border colour is what draws the hairlines. */}
				<div className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-px overflow-hidden rounded-sm border border-line bg-line">
					{TILES.map((tile) => (
						<div key={tile} className="flex flex-col gap-2.5 bg-surface px-4 py-4">
							<Skeleton className="h-3 w-20" />
							<Skeleton className="h-7 w-24" />
						</div>
					))}
				</div>

				{SECTION_HEIGHTS.map((height) => (
					<div key={height} className="flex flex-col">
						{/* `Section`'s heading rule, so the blocks are separated the way the report separates
						    its sections rather than floating in one another's space. */}
						<div className="mb-4 border-b border-line pb-2.5">
							<Skeleton className="h-3.5 w-44" />
						</div>
						<Skeleton className={`w-full ${height}`} />
					</div>
				))}
			</div>
		</div>
	);
}
