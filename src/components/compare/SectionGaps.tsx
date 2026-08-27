import { useTranslation } from 'react-i18next';

import { leaderOf, ranked, type MetricGap, type SectionGap } from '~/lib/compare';
import i18n from '~/lib/i18n/config';

import { jumpToHeading } from '../jump';
import { ChartFigure } from '../primitives';
import { reading } from '../score/reading';

import PullKey from './PullKey';
import { refusalOf } from './refusal';
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
 * A card per part of the pull, and a line per figure inside it.
 *
 * **One track per figure rather than one track per section.** Every figure in a section shared a rail,
 * so a card holding three of them was three dots on one line and the reader had to match each back to
 * a label above it by horizontal position alone. A figure now owns its own rail, directly under its own
 * name and readings, and nothing has to be matched up.
 *
 * The rails all run the same fixed domain, so a dot two thirds of the way out means the same thing in
 * every card. That is what keeps the cards comparable with each other rather than only internally.
 *
 * The card itself borrows `Scorecard`'s: same border, same padding, same heading treatment, so the
 * page has one card vocabulary rather than two.
 */
const TRACK = 'relative h-4 w-full';

/**
 * Where the two pulls differ: a card per part of the pull, a line per figure inside it.
 *
 * **The unit is bands, and it has to be.** A page comparing a share, a count of potions and a clock in
 * seconds has no common axis available; what it does have is the distance between each rule's own two
 * thresholds, which means the same thing on every rail. `headroom` in the scorecard already measures
 * distance that way and gives the argument in full: "1.4 bands short" is the same statement about all
 * three units.
 *
 * **A rail per figure, not a rail per section.** Every figure in a section used to share one, so a card
 * holding three was three dots on one line and the reader matched each back to its label by horizontal
 * position alone. On its own rail, directly under its own name and readings, a figure needs no matching
 * up — and the two a section is furthest apart on stop being the only two worth naming, which is what
 * the shared rail had forced.
 *
 * **No aggregate survives.** An earlier shape drew one signed bar per section at its *worst* figure with
 * a texture where the section also led the other way, and Snapshots is exactly the case that breaks it:
 * the first log is ahead 2.4 on procs caught and behind 1.7 on depth. One bar and a texture cannot say
 * that. With a rail per figure there is nothing to aggregate, so no rule about how to aggregate is
 * needed either.
 *
 * **Diverging from a centre, because the question has a side.** Left is the first log ahead and right
 * is the second, which is the order the whole page names them in rather than the order the sign of
 * `bands` would give. The rule down the middle is the only place a reader has to look to answer who is
 * winning. Cards are ordered by the section's widest figure, because this is the index into the page
 * and the widest gap is where to start.
 *
 * **A dot inside the tie width is drawn neutral.** It leans neither way, and painting it by the sign of
 * a number smaller than the noise the thresholds admit would claim a lead the scoring model refuses to
 * grade. See `TIE_BANDS`.
 *
 * **A figure with no comparison keeps its line and loses its rail**, saying which log could not answer
 * and why. A rail carrying one dot is a picture of a comparison that did not happen, and a reader would
 * take the absent mark for a zero.
 *
 * All of it is HTML rather than a chart library. `conventions.md` sends charts to ApexCharts and forbids
 * a hand-built SVG one; this is neither, it is the same shape `BandScale` and `Bar` are already built
 * from — a few divs — and staying in HTML is what makes the card a button and keeps the labels out of
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
			<ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
				{rows.map((group) => {
					// Spelled `section`, matching the idiom `Scorecard` titles a card with: the key guard skips
					// this prefix by name, because it is a section arriving at runtime and not a key family.
					const section = group.key;
					const title = i18n.exists(`${section}.title`) ? t(`${section}.title`) : section;
					const named = (gap: MetricGap) => {
						const key = `summary.takeaways.metric.${gap.key}.label`;
						return i18n.exists(key) ? t(key) : gap.key;
					};

					return (
						<li key={section} className="contents">
							{/* The whole card, not a target inside it: a card whose only job is to summarise a part
							    of the pull is a link to that part, which is the treatment `Scorecard` gives its own.
							    A small jump target inside a large clickable-looking box teaches a reader the rest of
							    the card is dead. */}
							<button
								type="button"
								onClick={() => jumpToHeading(sectionAnchor(section))}
								className="flex h-full cursor-pointer flex-col gap-3 rounded-sm border border-line p-3.5 text-left transition-colors hover:border-muted focus-visible:border-muted"
							>
								<span className="font-mono text-sm font-medium tracking-[0.1em] uppercase text-ink-2">{title}</span>

								<span className="flex flex-col gap-3">
									{group.metrics.map((gap) => {
										// A figure with no comparison says why and draws no rail. A rail with one dot on
										// it would be a picture of a comparison that did not happen.
										if (gap.bands === null || gap.a === null || gap.b === null) {
											const refusal = refusalOf(gap, players);
											return (
												<span key={gap.key} className="flex flex-col gap-0.5">
													<span className="text-xs text-muted">{named(gap)}</span>
													<span className="text-xs text-muted italic">
														{t(refusal.key, { player: refusal.player })}
													</span>
												</span>
											);
										}
										const side = leaderOf(gap.bands);
										const mark =
											side === 'a'
												? 'bg-pull-a'
												: side === 'b'
													? 'border-2 border-pull-b bg-bg'
													: // Inside the tie width, so it leans neither way and is drawn saying so.
														'bg-track';
										return (
											<span key={gap.key} className="flex flex-col gap-1">
												<span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
													<span className="text-xs text-muted">{named(gap)}</span>
													<span className="flex items-baseline gap-2 tabular font-mono text-xs text-ink-2">
														<PullKey side="a">{reading(gap.a, t)}</PullKey>
														<PullKey side="b">{reading(gap.b, t)}</PullKey>
													</span>
												</span>
												<span aria-hidden="true" className={TRACK}>
													{/* The rail, then the rule a step brighter so the zero mark does not
													    disappear into the axis it sits on, then the dot over both. */}
													<span className="absolute inset-x-0 top-1/2 block h-px -translate-y-1/2 bg-line" />
													<span className="absolute top-0 left-1/2 block h-full w-px -translate-x-1/2 bg-track" />
													<span
														className={`absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-bg ${mark}`}
														style={{ left: `${at(gap.bands)}%` }}
													/>
												</span>
											</span>
										);
									})}
								</span>

								{/* One axis per card, because the cards sit side by side and a single axis under the
								    grid would line up with none of them. */}
								<span aria-hidden="true" className="mt-auto flex justify-between font-mono text-[11px] text-muted">
									{TICKS.map((tick, index) => (
										<span key={`${tick}-${index}`}>{tick}</span>
									))}
								</span>
							</button>
						</li>
					);
				})}
			</ul>
		</ChartFigure>
	);
}
