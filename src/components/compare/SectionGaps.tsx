import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

import { leaderOf, ranked, type MetricGap, type SectionGap } from '~/lib/compare';
import i18n from '~/lib/i18n/config';

import { jumpToHeading } from '../jump';
import { ChartFigure } from '../primitives';
import { reading } from '../score/reading';

import PullKey from './PullKey';
import { sectionAnchor } from './sectionAnchor';

/**
 * How far from the centre the axis runs, in bands.
 *
 * A fixed domain rather than one taken from the data, and the reason is that this chart is read down
 * its rows: dots scaled to whichever gap happened to be largest would make a page where the two pulls
 * are close look exactly like one where they are far apart, and only the axis numbers would say which.
 * Four bands is past anything the committed captures reach. Measured over all fifteen pairings of the
 * six of them: 105 section readings, none above four, and the widest single figure is Tiger Palm waste
 * at **3.60** on `cleave` against `mixed`. So a dot on the rail is a genuine outlier rather than the
 * ordinary case, and a gap past the domain is clamped rather than rescaling every other row to fit it.
 */
const DOMAIN = 4;

/** The axis, in bands either side of nothing. */
const TICKS = [4, 2, 0, 2, 4];

/**
 * Where a signed gap sits across the track, as a percentage, clamped to the rail.
 *
 * **The first log is drawn on the left, and the sign is inverted here to put it there.** `bands` is
 * positive when the first log is ahead — that is the library's convention and every figure on the page
 * reads it — and the naive mapping sends positive to the right, which put the *second* log first when
 * the chart is read left to right. Every other figure on this page names the first log first: the
 * header, the three framing figures, the tally, each dumbbell, each row of the two ability lists and
 * the bar. A chart that reverses them is a chart the reader has to remember an exception for.
 */
const at = (bands: number) => 50 - Math.max(-1, Math.min(1, bands / DOMAIN)) * 50;

/**
 * Two columns: what is being compared, and where the two logs sit on it.
 *
 * **The left column is a stack rather than a line.** Each figure takes two rows — its name, then both
 * logs' readings under it — because a name and two numbers on one line ran to
 * "Stacks overcapped 0/151 10/84", which needed more width than the column had and more than the axis
 * beside it could spare. Split, each row is short and the column narrows to fit the longer of the two.
 *
 * **Every comparable figure is listed, not just the widest one either way.** The chart drew a dot per
 * figure and named only the outermost on each side, so a section with three lost one and a section the
 * two logs tied on lost all of them: Potions drew a dot and said nothing about it. A dot with no
 * reading beside it is a position on an axis and nothing else.
 *
 * Below `sm` the column and the track stack, which is the only way both survive at 320: a fixed column
 * wide enough for these labels would leave the axis with nothing.
 */
const COLUMN = 'flex min-w-0 flex-col gap-0.5 sm:w-56 sm:shrink-0';
/** The same column, empty, so the axis starts where the track does. */
const GUTTER = 'hidden sm:block sm:w-56 sm:shrink-0';
const TRACK = 'relative h-5 w-full sm:min-w-0 sm:flex-1 sm:basis-0';

/**
 * Where the two pulls differ: every figure in every part of the pull, on one signed axis.
 *
 * **The unit is bands, and it has to be.** A page comparing a share, a count of potions and a clock in
 * seconds has no common axis available; what it does have is the distance between each rule's own two
 * thresholds, which means the same thing on every row. `headroom` in the scorecard already measures
 * distance that way and gives the argument in full: "1.4 bands short" is the same statement about all
 * three units.
 *
 * **A dot per figure, not a bar per section, and that is the whole design.** This drew one signed bar
 * per section at its worst figure, with a texture where the section also led the other way — and on the
 * two committed captures that is not a corner case, it is the first row: Snapshots has the first log
 * ahead 2.4 on procs caught and behind 1.7 on depth. One bar and a texture cannot say that. A reader
 * looking at the bar saw a section decided by 2.4 and had to scroll to find out it was not decided at
 * all. Dots carry it natively: a split section has dots either side of the rule and reads as split
 * before a word is read, and a decided one has all of them on one side.
 *
 * It also removes an aggregate that had to be argued for. The old bar took the section's *worst*
 * figure, following the rule `SectionScore.grade` uses, and summing or averaging instead would have
 * contradicted it. With no bar there is nothing to aggregate, so neither argument is needed.
 *
 * **Diverging from a centre, because the question has a side.** Left is the first log ahead and right
 * is the second — the order the whole page names them in, rather than the order the sign of `bands`
 * would give — and the rule down the middle is the only place a reader has to look to answer who is
 * winning. Rows are still ordered by the section's widest figure, because this is the index into the
 * page and the widest gap is where to start.
 *
 * **A dot inside the tie width is drawn neutral.** It leans neither way, and painting it by the sign of
 * a number smaller than the noise the thresholds admit would claim a lead the scoring model refuses to
 * grade. See `TIE_BANDS`.
 *
 * Rows are HTML rather than a chart library. `conventions.md` sends charts to ApexCharts and forbids a
 * hand-built SVG one; this is neither, it is the same shape `BandScale` and `Bar` are already built
 * from — a few divs — and staying in HTML is what makes the row a button and keeps the labels out of
 * SVG text, which that document warns about specifically.
 */
export default function SectionGaps({
	sections,
	players,
}: {
	sections: readonly SectionGap[];
	players: { a: string; b: string };
}) {
	const { t } = useTranslation('report');
	const rows = ranked(sections);
	if (rows.every((section) => section.bands === null)) return null;

	return (
		<ChartFigure
			gap="wide"
			caption={
				<>
					<PullKey side="a">
						<span className="text-sm text-muted">{t('compare.gaps.ahead', { player: players.a })}</span>
					</PullKey>
					<PullKey side="b">
						<span className="text-sm text-muted">{t('compare.gaps.ahead', { player: players.b })}</span>
					</PullKey>
				</>
			}
			note={t('compare.gaps.axis')}
		>
			<ul className="m-0 flex list-none flex-col gap-2 p-0">
				{rows.map((group) => {
					// Spelled `section`, matching the idiom `Scorecard` titles a card with: the key guard skips
					// this prefix by name, because it is a section arriving at runtime and not a key family.
					const section = group.key;
					const title = i18n.exists(`${section}.title`) ? t(`${section}.title`) : section;
					const drawn = group.metrics.filter((gap): gap is MetricGap & { bands: number } => gap.bands !== null);
					/**
					 * A figure's name, and beneath it what each log actually read on it.
					 *
					 * **Not the distance.** This printed the gap in the axis's own unit — "Health reflected 1.6"
					 * — and a name beside a bare number reads as that name's value, which 1.6 is not: it is how
					 * far apart the two logs are, in threshold-widths. `labels-and-figures.md` states the test
					 * it failed: read the label and the figure aloud as one phrase, and if it needs arithmetic
					 * before it means anything then the number is wrong rather than the label.
					 *
					 * The size is already on screen twice over, as the dot's distance from the rule and as the
					 * axis under the chart, so nothing is lost by giving these rows to the readings instead.
					 * They come from the scorecard's own formatter, so a share over countable events prints as
					 * the count here exactly as it does everywhere else.
					 *
					 * Both logs, always, in the page's own order. A row that named one of them would be a row
					 * whose number the reader has to attribute by guessing.
					 */
					const named = (gap: MetricGap & { bands: number }) => {
						const key = `summary.takeaways.metric.${gap.key}.label`;
						return i18n.exists(key) ? t(key) : gap.key;
					};

					return (
						<li key={section}>
							{/* The whole row, not a target inside it: a row whose only job is to point at a part of
							    the pull is a link to it, and 44px is the floor a tap target may reach. */}
							<button
								type="button"
								onClick={() => jumpToHeading(sectionAnchor(section))}
								className="flex w-full cursor-pointer flex-col items-stretch gap-2 rounded-sm px-1 py-1.5 text-left hover:bg-raised focus-visible:bg-raised sm:flex-row sm:items-center sm:gap-4"
							>
								<span className={COLUMN}>
									<span className="text-sm text-ink-2">{title}</span>
									{drawn.map((gap) =>
										gap.a === null || gap.b === null ? null : (
											<Fragment key={gap.key}>
												<span className="mt-1 text-xs text-muted">{named(gap)}</span>
												<span className="flex flex-wrap gap-x-3 gap-y-0.5 tabular font-mono text-xs text-ink-2">
													<PullKey side="a">{reading(gap.a, t)}</PullKey>
													<PullKey side="b">{reading(gap.b, t)}</PullKey>
												</span>
											</Fragment>
										),
									)}
								</span>
								<span aria-hidden="true" className={TRACK}>
									{/* The rail first, then the rule, then the dots over both.
									
									    **The rule is drawn a step brighter than the rail it crosses.** Both were `line` to
									    begin with and the zero mark disappeared into the axis it sits on, which on a chart
									    whose whole question is "which side" is the one line that has to be findable. It
									    takes the same neutral the tied dots take, so nothing on the chart reads as a side
									    unless it is one. */}
									<span className="absolute inset-x-0 top-1/2 block h-px -translate-y-1/2 bg-line" />
									<span className="absolute top-0 left-1/2 block h-full w-px -translate-x-1/2 bg-track" />
									{drawn.map((gap) => {
										const side = leaderOf(gap.bands);
										const mark =
											side === 'a'
												? 'bg-pull-a'
												: side === 'b'
													? 'border-2 border-pull-b bg-bg'
													: // Inside the tie width, so it leans neither way and is drawn saying so.
														'bg-track';
										return (
											<span
												key={gap.key}
												className={`absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-bg ${mark}`}
												style={{ left: `${at(gap.bands)}%` }}
											/>
										);
									})}
								</span>
							</button>
						</li>
					);
				})}
			</ul>
			<div aria-hidden="true" className="flex gap-4 px-1 pt-1">
				<span className={GUTTER} />
				<span className="flex min-w-0 flex-1 basis-0 justify-between font-mono text-xs text-muted">
					{TICKS.map((tick, index) => (
						<span key={`${tick}-${index}`}>{tick}</span>
					))}
				</span>
			</div>
		</ChartFigure>
	);
}
