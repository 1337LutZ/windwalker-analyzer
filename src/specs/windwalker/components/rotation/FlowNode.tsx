import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import type { FlowEntry } from '~/specs/windwalker/lib/view/rotationFlow';

import { Pill, SpellIcon } from '~/components/primitives';

/**
 * One rung of the priority list, drawn as the decision it is: a question, a **yes** edge, the button
 * that answer presses, and the two paragraphs behind it.
 *
 * ## Why a decision and an action rather than one box
 *
 * A priority list is a chain of `if`s, and the two halves of an `if` are different things. Drawing
 * them as one box loses the only structure the chart has to offer — that the condition is what the
 * reader is being asked and the button is what happens when the answer is yes. So the question sits
 * in its own box with a diamond on it, an edge labelled **yes** leaves it, and the button is at the
 * other end of that edge. Answering no is the line down the left, which `FlowChart` draws.
 *
 * The pair is a row on a wide screen and a column on a phone, and it is one flex container either
 * way: `flex-col lg:flex-row`. Nothing is measured and nothing is positioned, so a question that
 * wraps to four lines at 360px drags its own edge and its own button with it.
 *
 * ## The node is a label; the prose is a disclosure
 *
 * This is the design problem of drawing this list, and it is a content problem rather than a drawing
 * one. Every rung carries a short `test` and a longer `why`; the Tigereye Brew explanations still run
 * several hundred characters. Nothing that holds that much text is a node — it is a card, and a column
 * of cards is what this section used to be.
 *
 * So the decision box holds a one-line `test` naming the condition, and the `why` moves into a panel
 * the action box discloses.
 *
 * **The prose is never lost, and that is the constraint the rest of this file is arranged around.**
 * The chart cannot be a picture that replaced the reference; it has to be a picture that *indexes*
 * the reference. Hence: a real `<button>` with `aria-expanded` rather than hover, which has neither a
 * touch story nor a keyboard one; the panel as a sibling of the button rather than one shared panel
 * far away, which would put the answer somewhere the reader's focus is not; and an "open every rung"
 * control above the chart, so the wall of text is one press away and the browser's own find-in-page
 * can reach every word of it.
 *
 * The short `test` is separate from `why` rather than a truncation of the explanation: clipping a
 * sentence at sixty characters produces "energy will not cap during the channel, you are not inside an
 * Ener…", which is a lie by omission on the one rung that has three conditions.
 *
 * ## What a screen reader gets
 *
 * The reading order is the drawing: "press it when — the dot is not already spinning", "yes", then
 * the ability as a heading with a collapsed button on it. The word **yes** is real text rather than
 * `aria-hidden` decoration, because it is the edge label and the edge is the point; only the rules
 * and the arrowheads are hidden. The ability name stays a real heading with the button inside it,
 * which is the accordion pattern ARIA describes, so moving by heading still walks the sim's
 * evaluation order.
 */
export default function FlowNode({
	entry,
	heading,
	open,
	onToggle,
	horizontal,
	showGate,
}: {
	entry: FlowEntry;
	heading: 'h4' | 'h5';
	open: boolean;
	onToggle: () => void;
	/**
	 * True for a rung that owns a whole row, so the question and the button can sit side by side once
	 * there is width for it. A branch inside a fork is already sharing its row with one or two
	 * siblings and stacks at every width.
	 */
	horizontal: boolean;
	/**
	 * False when `FlowChart` has already drawn this rung's gate across the line above it, which is
	 * what it does for the four target-count crossovers. Two chips saying `3+ targets` on one rung is
	 * one chip too many, and the one on the line is the one that means something in a chart.
	 */
	showGate: boolean;
}) {
	const { t } = useTranslation('report');
	const Heading = heading;
	const id = useId();
	const buttonId = `${id}-node`;
	const panelId = `${id}-why`;

	/**
	 * The **yes** edge: a rule, the word, a rule, an arrowhead.
	 *
	 * Rotated squares with two borders rather than an SVG marker — the arrowhead has to point down in a
	 * stacked layout and right in a side-by-side one, and a border can be turned by a class where a
	 * `<marker>` would need a second drawing.
	 */
	const edge = (
		<div
			className={`flex shrink-0 items-center gap-1.5 self-start py-1.5 ${horizontal ? 'lg:flex-row lg:self-center lg:px-1 lg:py-0' : ''} flex-col`}
		>
			<span aria-hidden="true" className={`h-2.5 w-px shrink-0 bg-line ${horizontal ? 'lg:h-px lg:w-2.5' : ''}`} />
			<span className="font-mono text-sm font-medium tracking-[0.1em] uppercase text-muted">
				{t('rotation.flow.yes')}
			</span>
			<span aria-hidden="true" className={`h-2.5 w-px shrink-0 bg-line ${horizontal ? 'lg:h-px lg:w-2.5' : ''}`} />
			<span
				aria-hidden="true"
				className={`h-1.5 w-1.5 shrink-0 rotate-45 border-r border-b border-line ${horizontal ? 'lg:-rotate-45' : ''}`}
			/>
		</div>
	);

	return (
		<div className="flex flex-col">
			<div className={`flex flex-col items-stretch ${horizontal ? 'lg:flex-row lg:items-stretch lg:gap-1' : ''}`}>
				{/* The question. `rotation.field.when` labels the condition that determines whether this rung fires. */}
				{/* `basis-0` on both halves, so the row splits evenly rather than letting the question take
				    whatever the button did not want. With the question on `flex-1` against a fixed `w-72`
				    button, a 1040px article gave the question about 710px and the button 288 — two and a half
				    to one, with the widest box being the one that is only a label and the narrowest the one
				    the reader is meant to press. The `test` strings are capped at 64 characters, so half a row
				    is already more than any of them needs. */}
				<div
					className={`flex min-w-0 flex-1 items-start gap-2.5 rounded-sm border border-line bg-bg px-3 py-2.5 ${horizontal ? 'lg:basis-0 lg:items-center' : ''}`}
				>
					<span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rotate-45 border border-muted" />
					<span className="flex min-w-0 flex-col gap-0.5">
						<span className="font-mono text-sm font-medium tracking-[0.1em] uppercase text-muted">
							{t('rotation.field.when')}
						</span>
						<span className="text-base leading-snug text-ink-2">{t(`rotation.entry.${entry.key}.test`)}</span>
					</span>
				</div>

				{edge}

				{/* The button the answer presses. It is the interactive half of the rung, so it is the one
				    that discloses the prose: a reader who wants to know why presses the thing they were
				    being told to press. */}
				<Heading className={`m-0 ${horizontal ? 'lg:min-w-72 lg:flex-1 lg:basis-0' : ''}`}>
					<button
						type="button"
						id={buttonId}
						aria-expanded={open}
						aria-controls={panelId}
						onClick={onToggle}
						// Open is `kick`, the same border every pick-one control in this app wears when it is the
						// chosen one — see `selectionPalette` in `primitives/controls`. It is never the only
						// signal: `aria-expanded`, the chevron and the panel itself all say the same thing, so
						// nothing here is carried by colour alone.
						className={`flex min-h-11 w-full items-center gap-2.5 rounded-sm border px-3 py-2.5 text-left transition-colors ${
							open ? 'border-kick bg-raised' : 'border-line bg-surface hover:border-muted hover:bg-raised'
						}`}
					>
						<SpellIcon id={entry.id} size="sm" />
						<span className="flex min-w-0 flex-1 flex-col gap-1">
							<span className="font-mono text-base font-semibold text-ink">
								{t(`rotation.entry.${entry.key}.name`)}
							</span>
							{/* A gate naming something other than the target count — whether the Rune is equipped,
							    which half of a split rung this is. The target-count gates on rungs that own a whole
							    row are drawn across the line instead, by `FlowChart`, because there they are a
							    boundary in the chart rather than a label on a box. */}
							{entry.gated && showGate ? (
								<span className="-mb-1.5">
									<Pill>{t(`rotation.gate.${entry.key}`)}</Pill>
								</span>
							) : null}
						</span>
						{/* The affordance, named rather than left as a bare glyph: the one way this chart could be
						    worse than the list it replaced is a reader not realising the paragraphs are still
						    here. The word is the same word the panel labels its second paragraph with. */}
						<span className="flex shrink-0 items-center gap-1.5">
							<span className="font-mono text-sm font-medium tracking-[0.1em] uppercase text-muted">
								{t('rotation.flow.details')}
							</span>
							<span
								aria-hidden="true"
								className={`h-2 w-2 border-r border-b border-muted transition-transform ${open ? 'rotate-[225deg]' : 'rotate-45'}`}
							/>
						</span>
					</button>
				</Heading>
			</div>

			{/* `hidden` rather than unmounted, so the panel keeps one identity for `aria-controls` to point
				    at whether it is showing or not. */}
			<div id={panelId} hidden={!open} className="mt-2 rounded-sm border border-line bg-bg p-3">
				<dl className="m-0 flex flex-col gap-2.5">
					<div className="flex flex-col gap-0.5">
						<dt className="font-mono text-sm font-medium tracking-[0.1em] uppercase text-muted">
							{t('rotation.field.why')}
						</dt>
						<dd className="m-0 max-w-[70ch] text-base leading-relaxed text-muted">
							{t(`rotation.entry.${entry.key}.why`)}
						</dd>
					</div>
				</dl>
			</div>
		</div>
	);
}
