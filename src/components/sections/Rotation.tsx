import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import type { Analysis, TargetMode } from '~/lib/types';
import { bandForMode } from '~/lib/view/targetMode';
import { pressedButtons, rotationFlow, type FlowEntry } from '~/lib/view/rotationFlow';

import { Note, Pill, Prose, Section, SpellIcon } from '../primitives';

/**
 * How many columns a fork's branches sit in once there is room for them.
 *
 * Written out per branch count rather than composed, because Tailwind reads class names as literal
 * strings and never sees a template. Below `md` the map is not consulted and the branches stack,
 * which is the whole degradation story: a fork here is a nested list, not a drawing.
 */
const FORK_COLUMNS: Record<number, string> = { 2: 'md:grid-cols-2', 3: 'md:grid-cols-3' };

/**
 * The rotation itself: what to press, in what order, what decides each fork, and what every
 * condition is there to prevent.
 *
 * The one section on the page that grades nothing. Every other section says what happened in this
 * pull; this one says what the pull was being measured against, so a reader who has just been told
 * their Tigereye Brew averaged six stacks has somewhere to go and find out what ten would have taken.
 *
 * It sits second to last, above the method and below everything that judges the pull, because it is
 * reference rather than argument.
 *
 * ## It is a reference, and it is still not the same list for everyone
 *
 * It used to render identically for every log, and that was two separate lies. It listed the rungs
 * the priority list only reaches from two enemies up to a reader on a single-target kill, where they
 * cannot fire; and it listed talents as buttons to press at a reader who did not bring them. Both are
 * now filtered, and neither filter is this component's decision — the bands come off `LADDER` through
 * `lib/view/rotationFlow`, and the talent evidence is the mutual exclusion the sim declares.
 *
 * ## Why the rungs are a list and not a drawing
 *
 * A fallthrough chain is a graph, and it was worth asking whether drawing it as one reads better. It
 * does not, and the reason is the content rather than the shape. Every node here carries two
 * paragraphs — the condition the list tests, and what that condition is protecting — which average
 * 282 characters and reach 528 on the Tigereye Brew branches. A node that has to hold 282 characters
 * at 390px is a card, whatever is drawn around it, and a column of cards joined top to bottom is
 * already the picture: 19 rungs, one outgoing edge each, three places where the edge forks.
 *
 * `charts/ResourceTrack.tsx` records the mechanical half of the same answer — under
 * `preserveAspectRatio="none"` an SVG `<text>` stretches with its box, and `docs/conventions.md`
 * forbids column labels in SVG text outright because they render at 6px on a phone. The connector is
 * therefore two borders: a line is a border, and a border stays attached to a card that has just
 * wrapped to six lines at 360px, which a viewBox could only do by measuring every node's height after
 * layout on every resize.
 */
export default function Rotation({ analysis, mode }: { analysis: Analysis; mode?: TargetMode | null }) {
	const { t } = useReportCopy(analysis);

	/**
	 * The rungs this reader's list actually has.
	 *
	 * `mode` is threaded from the control at the top of the report rather than read off the detection
	 * here, so the reference agrees with the verdicts above it even when the reader has overridden what
	 * the counts said — and `bandForMode` is the same mapping `PriorityLadder` judges through, which is
	 * what makes "agrees" a fact rather than a hope. Undefined `mode` (an older report, a fixture) is
	 * null and shows every band, because no basis to choose is not a reason to choose.
	 */
	const flow = useMemo(
		() => rotationFlow({ band: bandForMode(mode ?? null), pressed: pressedButtons(analysis.casts) }),
		[analysis.casts, mode],
	);

	// One card per entry, whether it holds a rung alone or shares one with its alternatives. `when` is
	// the condition the priority list actually tests; `why` is what that condition is protecting,
	// which is the half a transcription of the APL leaves out and the half a reader needs. Labels sit
	// above their values rather than opposite them: "what the condition is for" is wider than any
	// label column worth giving up on a phone, and stacked it needs no column at all.
	const card = (entry: FlowEntry, heading: 'h4' | 'h5') => {
		const Heading = heading;
		return (
			<>
				<Heading className="m-0 flex items-center gap-2 font-mono text-base font-semibold text-ink">
					<SpellIcon id={entry.id} size="sm" />
					{t(`rotation.entry.${entry.key}.name`)}
				</Heading>
				{entry.gated ? (
					<p className="m-0 mt-2">
						<Pill>{t(`rotation.gate.${entry.key}`)}</Pill>
					</p>
				) : null}
				<dl className="m-0 mt-2 flex flex-col gap-2.5">
					<div className="flex flex-col gap-0.5">
						<dt className="font-mono text-sm font-medium tracking-[0.1em] uppercase text-muted">
							{t('rotation.field.when')}
						</dt>
						<dd className="m-0 max-w-[70ch] text-base leading-relaxed text-ink-2">
							{t(`rotation.entry.${entry.key}.when`)}
						</dd>
					</div>
					<div className="flex flex-col gap-0.5">
						<dt className="font-mono text-sm font-medium tracking-[0.1em] uppercase text-muted">
							{t('rotation.field.why')}
						</dt>
						<dd className="m-0 max-w-[70ch] text-base leading-relaxed text-muted">
							{t(`rotation.entry.${entry.key}.why`)}
						</dd>
					</div>
				</dl>
			</>
		);
	};

	return (
		<Section id="rotation" title={t('rotation.title')}>
			<div className="flex flex-col gap-3.5">
				<Prose>{t('rotation.intent')}</Prose>
				<Prose>{t('rotation.economy')}</Prose>
			</div>

			<h3 className="m-0 mt-7 mb-3 font-mono text-sm font-semibold tracking-[0.1em] uppercase text-muted">
				{t('rotation.flow.title')}
			</h3>
			<Prose>{t('rotation.flow.intent')}</Prose>
			{/* The four target counts collected above the flow rather than only as chips inside it. They
			    are the answer to the question a reader arrives with — at how many does the button change
			    — and nineteen rungs is too far to scan for "three" when the list has already been read
			    once. They stay unfiltered when the flow is not: a reader whose list has just lost a rung
			    needs the count that would bring it back, and that is the one thing a filtered index
			    could not tell them. */}
			<p className="m-0 mt-3.5">
				<Pill>{t('rotation.crossover.rjw')}</Pill>
				<Pill>{t('rotation.crossover.sef')}</Pill>
				<Pill>{t('rotation.crossover.sck')}</Pill>
				<Pill>{t('rotation.crossover.sckOverRsk')}</Pill>
			</p>

			{/* Said here rather than left to the control at the top of the page, on the same argument
			    `PriorityLadder` makes: by the time a reader has scrolled this far the toggle is off
			    screen, and a list with rungs missing from it is worse than useless without the sentence
			    saying which ones and why. */}
			{mode === undefined || mode === null ? null : (
				<div className="mt-3.5">
					<Note>{t(mode === 'single' ? 'rotation.flow.reading_single' : 'rotation.flow.reading_multi')}</Note>
				</div>
			)}

			{/* The rail beside the rungs is the only drawing in the section, and it is two borders — see
			    the note on the component above for why it is not an SVG. `role="list"` because
			    `list-style: none` drops list semantics in WebKit, and the order is the entire point of an
			    ordered list. */}
			<ol role="list" aria-label={t('rotation.flow.caption')} className="m-0 mt-5 flex list-none flex-col p-0">
				{flow.map((slot, index) => {
					const last = index === flow.length - 1;
					return (
						<li
							key={'fork' in slot ? slot.fork : slot.entry.key}
							className="grid grid-cols-[1.75rem_1fr] gap-x-3 sm:gap-x-4"
						>
							{/* Decorative: the number repeats the list's own counter and the line repeats the
							    fact that one `<li>` follows another. */}
							<div aria-hidden="true" className="flex flex-col items-center">
								<span className="flex h-7 w-7 items-center justify-center rounded-full border border-line bg-surface font-mono text-sm text-muted">
									{index + 1}
								</span>
								{last ? null : <span className="mt-1 w-px flex-1 bg-line" />}
							</div>
							<div className={last ? undefined : 'pb-4'}>
								{'fork' in slot ? (
									// Dashed, and a shade below the branches inside it, so the rung reads as a
									// container of choices rather than as a fourth kind of card.
									<div className="rounded-sm border border-dashed border-line bg-surface p-3 sm:p-3.5">
										<h4 className="m-0 font-mono text-base font-semibold text-ink">
											{t(`rotation.fork.${slot.fork}.title`)}
										</h4>
										<p className="m-0 mt-1.5 max-w-[70ch] text-base leading-relaxed text-muted">
											{t(`rotation.fork.${slot.fork}.detail`)}
										</p>
										<ul
											role="list"
											className={`m-0 mt-3 grid list-none gap-3 p-0 ${FORK_COLUMNS[slot.branches.length] ?? ''}`}
										>
											{slot.branches.map((branch) => (
												<li key={branch.key} className="rounded-sm border border-line bg-raised p-3">
													{card(branch, 'h5')}
												</li>
											))}
										</ul>
									</div>
								) : (
									<div className="rounded-sm border border-line bg-surface p-3 sm:p-3.5">{card(slot.entry, 'h4')}</div>
								)}
							</div>
						</li>
					);
				})}
			</ol>

			{/* The six things a rung cannot carry: why the brew is spent where it is, why the channel
			    needs three conditions, why one kick matters to everyone, which talents the list assumes,
			    on what evidence a rung is left out, and one correction the spec's own name invites.
			    Separate notes rather than a closing paragraph, because a reader checking one should not
			    have to read past five. */}
			<div className="mt-6 flex flex-col gap-2.5">
				<Note>{t('rotation.notes.snapshot')}</Note>
				<Note>{t('rotation.notes.channel')}</Note>
				<Note>{t('rotation.notes.debuff')}</Note>
				<Note>{t('rotation.notes.talents')}</Note>
				<Note>{t('rotation.notes.inferred')}</Note>
				<Note>{t('rotation.notes.mastery')}</Note>
			</div>
		</Section>
	);
}
