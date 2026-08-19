import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CROSSOVERS, flowKeys, type FlowSlot } from '~/specs/windwalker/lib/view/rotationFlow';

import { buttonClass } from '~/components/primitives/controls';

import FlowNode from './FlowNode';

/**
 * How many columns a fork's branches sit in once there is room for them, and how many the bar drawn
 * above them splits into.
 *
 * Written out per branch count rather than composed, because Tailwind reads class names as literal
 * strings and never sees a template. Below `md` the map is not consulted and the branches stack,
 * which is the whole degradation story: a fork at 390px is a nested list, not a drawing.
 *
 * One map for both grids, deliberately — the split bar's drop lines land on the centre of each
 * column, so the two grids have to agree about how many columns there are *and* about the gap
 * between them, or the lines point between the boxes instead of at them.
 */
const FORK_COLUMNS: Record<number, string> = { 2: 'md:grid-cols-2', 3: 'md:grid-cols-3' };

/**
 * The rungs whose gate is drawn across the line rather than inside the box.
 *
 * These are the four crossovers, and they are exactly the plain rungs the ladder bands — the target
 * count is the only thing that puts them in the list, so in a decision tree it is a boundary the line
 * crosses and not a label on a box. Everything else that carries a gate is a *branch inside a fork*,
 * where the chip is doing a different job: it says which of two alternatives this lane is, and it
 * belongs on the lane.
 *
 * Drawn whichever reading is on, and that is a departure from `rotationFlow`'s `gated` flag rather
 * than a use of it. `gated` answers "should this rung repeat the count in a list that has already
 * been filtered to one", and its answer is rightly no — nine chips all saying `3+ targets` under a
 * note that has just said "this is the list at three enemies" is noise. In a chart the question is
 * different: the reader can see that eighteen rungs became sixteen, and the useful thing is *which
 * three the pack handed them*. So the chip stays, and it stays in the one place that answers that.
 */
const CROSSOVER_KEYS: ReadonlySet<string> = new Set(CROSSOVERS.map((c) => c.key));

/**
 * The priority list drawn as the decision tree it is.
 *
 * Every rung is one question with two ways out. **Yes** presses the button beside it and the list
 * stops there; **no** is the line down the left, on to the next question. Three of the rungs are
 * forks — one question with two or three answers — and those are the part of this list a column of
 * cards could not show at all.
 *
 * ## Why there is no library under this
 *
 * Every graph-drawing library on the shortlist solves the same problem — given nodes of a known size,
 * compute an (x, y) for each — and that is not the problem this chart has. These nodes are text. They
 * wrap at 390px, they hold an ability name that is two words or five, and one of them grows by 528
 * characters when a reader opens it. A layout engine has to measure every node and re-run on every
 * resize and every disclosure; CSS flex and grid do that continuously, for free, and are the only
 * approach where an edge stays attached to a box that has just wrapped to four lines.
 *
 * Measured, bundled and gzipped, for the record: mermaid 945 KB, elkjs 440 KB, @xyflow/react 59 KB
 * plus 3 KB of CSS, dagre 17 KB, d3-hierarchy 2 KB. The whole site is 663 KB gzipped and the report
 * chunk 121 KB, so mermaid is larger than the application it would be drawing inside of.
 * `docs/conventions.md` does say to reach for a library rather than hand-roll, and the row it says it
 * on is *charts* — where the argument is that a chart has axes, scales and tooltips nobody should
 * rewrite. This has none of those. It has nineteen boxes and a line.
 *
 * The accessibility half weighs as much as the kilobytes. React Flow positions nodes absolutely
 * inside a pan-and-zoom viewport of an explicit pixel height, which has no reading order and no
 * document flow to reflow at a phone width; mermaid renders the whole thing as SVG `<text>`, which
 * `docs/conventions.md` bans outright for the reason it gives — SVG text scales with the viewport and
 * lands around 6px on a phone. This chart is a list of headings and buttons, so a screen reader gets
 * the sim's evaluation order for nothing and the browser's own find-in-page works.
 *
 * ## It redraws when the reading changes
 *
 * The chart is not one picture with rows hidden. `rotationFlow` hands back a different list per
 * target count — fourteen rungs at one enemy, eighteen at three, nineteen unfiltered — and forks
 * whose answer the count has already settled arrive as plain rungs instead. Because each `<li>` is
 * keyed by its own rung, React remounts exactly the boxes that entered and leaves the rest alone, so
 * `animate-rung-in` plays on the difference and on nothing else. That is the clearest thing this
 * chart can say about a control at the top of the page: here is what your reading just added.
 *
 * Nothing is drawn in SVG, and nothing carries meaning in colour alone: every mark here is a border,
 * and every mark has words beside it.
 */
export default function FlowChart({ flow }: { flow: readonly FlowSlot[] }) {
	const { t } = useTranslation('report');
	const keys = flowKeys(flow);
	/**
	 * Which rungs are open, as a set of keys rather than one selected key.
	 *
	 * Independent disclosures rather than an accordion: a reader comparing the two Tigereye Brew
	 * branches, or the two halves of a split rung, wants both paragraphs at once, and closing one
	 * because another was opened is what makes a comparison impossible.
	 */
	const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set<string>());
	const allOpen = keys.length > 0 && keys.every((k) => open.has(k));

	const toggle = (key: string) =>
		setOpen((prev) => {
			const next = new Set(prev);
			if (!next.delete(key)) next.add(key);
			return next;
		});

	/**
	 * The bar that splits the line into a fork's lanes, at `md` and up.
	 *
	 * Borders rather than an SVG: it has to line up with a grid whose column widths the browser
	 * decides, and the only thing that can be certain of those is the same grid.
	 */
	const splitBar = (count: number) => (
		<div aria-hidden="true" className="mt-3 hidden md:block">
			<span className="mx-auto block h-3 w-px bg-line" />
			<div className={`grid gap-3 ${FORK_COLUMNS[count] ?? ''}`}>
				{Array.from({ length: count }, (_, i) => (
					<span key={i} className="relative block h-4">
						{/* The outermost lanes stop at their own centre, so the rule runs from the first drop to
						    the last rather than out past both. The inner edges reach half the grid's `gap-3` into
						    the gutter — a cell's own box stops at the gutter, and without this the rule ships
						    with a 12px hole in it between every pair of lanes. */}
						<span
							className="absolute top-0 h-px bg-line"
							style={{ left: i === 0 ? '50%' : '-6px', right: i === count - 1 ? '50%' : '-6px' }}
						/>
						<span className="absolute inset-y-0 left-1/2 w-px bg-line" />
					</span>
				))}
			</div>
		</div>
	);

	return (
		<>
			<div className="mt-5 rounded-sm border border-line bg-surface p-3 sm:p-3.5">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<h4 className="m-0 font-mono text-sm font-semibold tracking-[0.1em] uppercase text-muted">
						{t('rotation.flow.legend.title')}
					</h4>
					{/* The escape hatch, and what makes a disclosure an honest place to put the prose: one press
					    restores every paragraph the chart folded away, which is also what lets the browser's own
					    find-in-page reach them. */}
					<button type="button" className={buttonClass} onClick={() => setOpen(new Set(allOpen ? [] : keys))}>
						{t(allOpen ? 'rotation.flow.collapse' : 'rotation.flow.expand')}
					</button>
				</div>
				<ul role="list" className="m-0 mt-2.5 flex list-none flex-col gap-1.5 p-0">
					<li className="max-w-[70ch] text-sm leading-relaxed text-muted">{t('rotation.flow.legend.spine')}</li>
					<li className="max-w-[70ch] text-sm leading-relaxed text-muted">{t('rotation.flow.legend.gate')}</li>
					<li className="max-w-[70ch] text-sm leading-relaxed text-muted">{t('rotation.flow.legend.fork')}</li>
				</ul>
			</div>

			{/* `role="list"` because `list-style: none` drops list semantics in WebKit, and the order is the
			    entire point of an ordered list. */}
			<ol role="list" aria-label={t('rotation.flow.caption')} className="m-0 mt-5 flex list-none flex-col p-0">
				{flow.map((slot, index) => {
					const last = index === flow.length - 1;
					const gate = 'entry' in slot && CROSSOVER_KEYS.has(slot.entry.key) ? slot.entry : null;
					return (
						<li
							key={'fork' in slot ? slot.fork : slot.entry.key}
							className="grid animate-rung-in grid-cols-[2.75rem_1fr] gap-x-2 sm:gap-x-3"
						>
							{/* A gate on a rung that owns a whole row is a boundary in the chart, so it is drawn
							    across the line rather than inside the box under it: below the count on the chip the
							    list never reaches the question that follows. Announced rather than hidden — the
							    count is the content, and the two rules it separates are not otherwise
							    distinguishable. */}
							{gate === null ? null : (
								<p className="col-span-2 m-0 mb-2.5 flex items-center gap-2">
									<span aria-hidden="true" className="h-px w-9 shrink-0 bg-line" />
									<span className="rounded-sm border border-muted bg-raised px-2 py-[3px] font-mono text-sm font-medium tracking-[0.06em] text-ink-2">
										{t(`rotation.gate.${gate.key}`)}
									</span>
									<span aria-hidden="true" className="h-px flex-1 bg-line" />
								</p>
							)}

							{/* The **no** edge, and it is decorative: the number repeats the list's own counter, and
							    the line repeats the fact that one `<li>` follows another. Eighteen announcements of
							    the word "no" is noise in an ordered list that already reads in order — the legend
							    above says once what the line means. */}
							<div aria-hidden="true" className="flex flex-col items-center">
								<span className="flex h-7 w-7 items-center justify-center rounded-full border border-line bg-surface font-mono text-sm text-muted">
									{index + 1}
								</span>
								{last ? null : (
									<>
										<span className="mt-1 w-px flex-1 bg-line" />
										<span className="my-1 font-mono text-sm font-medium tracking-[0.1em] uppercase text-muted">
											{t('rotation.flow.no')}
										</span>
										<span className="w-px flex-1 bg-line" />
										<span className="mb-1 h-1.5 w-1.5 -translate-y-px rotate-45 border-r border-b border-line" />
									</>
								)}
							</div>

							<div className={last ? undefined : 'pb-4'}>
								{'fork' in slot ? (
									// Dashed, and a shade below the branches inside it, so the rung reads as one
									// question holding answers rather than as a fourth kind of box.
									<div className="rounded-sm border border-dashed border-line bg-surface p-3 sm:p-3.5">
										<h4 className="m-0 flex items-start gap-2.5 font-mono text-base font-semibold text-ink">
											<span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rotate-45 border border-muted" />
											{t(`rotation.fork.${slot.fork}.title`)}
										</h4>
										<p className="m-0 mt-1.5 max-w-[70ch] pl-[1.125rem] text-base leading-relaxed text-muted">
											{t(`rotation.fork.${slot.fork}.detail`)}
										</p>
										{splitBar(slot.branches.length)}
										<ul
											role="list"
											className={`m-0 mt-3 grid list-none gap-3 p-0 md:mt-0 ${FORK_COLUMNS[slot.branches.length] ?? ''}`}
										>
											{slot.branches.map((branch) => (
												<li key={branch.key}>
													<FlowNode
														entry={branch}
														heading="h5"
														open={open.has(branch.key)}
														onToggle={() => toggle(branch.key)}
														horizontal={false}
														showGate
													/>
												</li>
											))}
										</ul>
									</div>
								) : (
									<FlowNode
										entry={slot.entry}
										heading="h4"
										open={open.has(slot.entry.key)}
										onToggle={() => toggle(slot.entry.key)}
										horizontal
										// The chip is already across the line above this box; printing it inside as well
										// would say the same count twice on one rung.
										showGate={gate === null}
									/>
								)}
							</div>
						</li>
					);
				})}
			</ol>
		</>
	);
}
