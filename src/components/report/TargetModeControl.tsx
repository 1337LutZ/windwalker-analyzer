import { Menu } from '@base-ui/react/menu';
import { Toolbar } from '@base-ui/react/toolbar';
import { type TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import type { TargetSummary } from '~/lib/types';
import { TARGET_MODE_CHOICES, resolveTargetMode, type TargetModeChoice } from '~/lib/view/targetMode';

import { compactChoiceClass, labelClass, toolbarChoiceClass, toolbarMenuClass } from '../primitives/controls';
import { Note } from '../primitives';

/**
 * Whether to read this pull as one target or several, and the reader's right to disagree.
 *
 * The report detects the mode from how many enemies were being damaged moment by moment
 * (`analysis.targets`), which is right for the pull as it happened and wrong for the player who
 * deliberately ignored the adds to parse — the rotation they *played* was the single-target one, and
 * grading it against the multi-target list would name mistakes they made on purpose.
 *
 * So the detection is always shown, even when it is being overridden. A control that swallowed what
 * it detected would let a reader force single target on a genuine add fight and never learn that the
 * report disagreed — which is the whole thing this is here to make visible.
 *
 * **Two renderings, one control.** This one is the block above the report, with the detection spelled
 * out; `TargetModeToolbar` below is the same three switches on the sticky bar's single line. They are
 * never both on screen — see `ReportFlow`, which mounts this one directly above the sentinel that
 * mounts the bar — so the reader is looking at exactly one of them at any scroll position, and both
 * read and write the same state.
 *
 * State lives with the caller, not here and not in `AnalysisSettings`: see `lib/view/targetMode` for
 * why this is view state rather than an analysis setting.
 */
interface Props {
	/** The pull's own counts. Undefined on an analysis captured before they existed. */
	targets: TargetSummary | undefined;
	value: TargetModeChoice;
	onChange: (choice: TargetModeChoice) => void;
}

/** Deliberately literal rather than built from the choice, so the copy is greppable from the locale. */
const LABEL: Record<TargetModeChoice, string> = {
	auto: 'targets.auto',
	single: 'targets.single',
	multi: 'targets.multi',
};

/**
 * The same three, at the length a toolbar can hold.
 *
 * Separate keys rather than a truncation of the ones above, for the same reason those are spelled
 * out: what renders has to be findable in the locale. "Single target" is 75px of mono capitals and
 * the bar has the encounter name to fit beside it, which is what these are shorter for — not a
 * different meaning, a different width.
 */
const SHORT_LABEL: Record<TargetModeChoice, string> = {
	auto: 'targets.shortAuto',
	single: 'targets.shortSingle',
	multi: 'targets.shortMulti',
};

/**
 * What the pull detected, and whether the reader is contradicting it.
 *
 * Shared by both renderings so they cannot come to disagree about a pull: one says it in a `Note`
 * under the switches, the other has no line for it and carries it as the group's description.
 */
function detection(t: TFunction<'report'>, targets: TargetSummary | undefined, value: TargetModeChoice): string {
	const { detected, overridden } = resolveTargetMode(targets?.detected, value);
	const seen =
		detected === null
			? t('targets.detectedNone')
			: t('targets.detected', { context: detected, share: targets?.multiTargetPct ?? 0 });
	return overridden ? `${seen} ${t('targets.overridden', { context: value })}` : seen;
}

export default function TargetModeControl({ targets, value, onChange }: Props) {
	const { t } = useTranslation('report');

	return (
		<div className="flex flex-col gap-2.5">
			<span className={labelClass}>{t('targets.label')}</span>
			<div className="flex gap-2" role="radiogroup" aria-label={t('targets.label')}>
				{TARGET_MODE_CHOICES.map((choice) => (
					<button
						key={choice}
						type="button"
						role="radio"
						aria-checked={choice === value}
						className={compactChoiceClass(choice === value)}
						onClick={() => onChange(choice)}
					>
						{t(LABEL[choice])}
					</button>
				))}
			</div>
			<Note>{detection(t, targets, value)}</Note>
			<span className="text-sm text-muted">{t('targets.hint')}</span>
		</div>
	);
}

/**
 * The same control, on the sticky bar.
 *
 * `Toolbar.Button` rather than a bare `<button>`, which is what keeps the bar one tab stop: the
 * buttons register with the toolbar's composite and take arrow keys between them, so three switches
 * cost no tab stops at all. That also happens to be the keyboard model a radio group is supposed to
 * have, which the block above the report — three plain buttons, each its own stop — does not.
 *
 * `role="radiogroup"` over `Toolbar.Group`'s own `role="group"`: three switches where exactly one is
 * chosen is a radio group, and the props passed here are spread after the default. A toolbar is
 * allowed to contain one.
 *
 * **What this cannot show is the sentence.** The block above the report prints what the pull detected
 * and what overriding it means; a bar that has to hold an encounter name at 390px has no line for
 * either. Two things stand in for it, both on screen rather than a scroll away: the group's
 * description carries the same sentence the `Note` does, and a switch that contradicts the detection
 * is amber instead of green. A reader who forces a reading can see from the bar that the report
 * disagrees, which is the part that must never be silent.
 */
export function TargetModeToolbar({ targets, value, onChange }: Props) {
	const { t } = useTranslation('report');
	const { overridden } = resolveTargetMode(targets?.detected, value);
	const detected = detection(t, targets, value);

	return (
		<>
			<TargetModeMenu targets={targets} value={value} onChange={onChange} />

			<Toolbar.Group
				role="radiogroup"
				aria-label={t('targets.label')}
				// `title` and not an `aria-describedby` on a hidden node: with no description of its own the
				// group's title is what a screen reader announces as one, so this is a single string doing
				// both jobs rather than the same sentence written into the tree twice.
				title={detected}
				className="hidden shrink-0 gap-0.5 md:flex md:gap-1"
			>
				{TARGET_MODE_CHOICES.map((choice) => (
					<Toolbar.Button
						key={choice}
						role="radio"
						aria-checked={choice === value}
						className={toolbarChoiceClass(choice === value, overridden)}
						onClick={() => onChange(choice)}
					>
						{t(SHORT_LABEL[choice])}
					</Toolbar.Button>
				))}
			</Toolbar.Group>
		</>
	);
}

/**
 * The same three choices as one button, for the width that cannot hold three.
 *
 * Three switches measure 140px on this row and this button 78px, so collapsing them buys back 62px
 * for the encounter name — most of what the credits readout beside them costs. The switches are the
 * better control where there is room, one press instead of two, so both exist and each is hidden at
 * the width the other one owns.
 *
 * `md` and not `sm`, which is where this was first drawn, because the measurement disagreed. At 640px
 * the settings button has just begun spelling its own label out, and the switches at that width left
 * the encounter name 45px — five characters, worse than it gets at 390px. Swapping them for this
 * takes the name back to 152px, which is nearly the whole of it. `md` is the first width where the
 * switches cost the name nothing worth having.
 *
 * Rendering both costs nothing in keyboard terms: Base UI's composite treats a `display: none` item
 * as disabled and skips it, so whichever of the two is hidden is not in the bar's arrow-key order.
 *
 * `Menu.RadioGroup` / `Menu.RadioItem` rather than three `Menu.Item`s, because exactly one of these
 * is chosen and a list of buttons with one highlighted is not that to a screen reader. The full
 * labels are used in here — the popup has the room that the bar does not, which is the whole reason
 * the short ones exist.
 *
 * **The detection survives the collapse.** The trigger carries the same sentence the switches carry
 * as its `title`, and the popup states it above the choices where it can be read rather than hovered
 * — this control's docstring above insists the pull's own reading stays visible even when it is being
 * overridden, and a trigger that hid it would have quietly dropped that on phones. The trigger also
 * names the current mode, so the state is on the bar and not only inside the popup.
 */
function TargetModeMenu({ targets, value, onChange }: Props) {
	const { t } = useTranslation('report');
	const { overridden } = resolveTargetMode(targets?.detected, value);
	const detected = detection(t, targets, value);

	return (
		<Menu.Root>
			<Toolbar.Button
				render={<Menu.Trigger />}
				title={detected}
				aria-label={`${t('targets.label')}: ${t(LABEL[value])}`}
				className={`${toolbarMenuClass(overridden)} md:hidden`}
			>
				<span aria-hidden="true">{t('targets.mode')}</span>
				{/* The chosen mode on the trigger, not only inside the popup. A control that hid the state
				    it sets would be worse than the switches it replaces — and teal is the same "this one
				    is active" the switches use, dropped when amber is already saying something louder. */}
				<span aria-hidden="true" className={overridden ? undefined : 'text-kick'}>
					{t(SHORT_LABEL[value])}
				</span>
			</Toolbar.Button>

			<Menu.Portal>
				{/* Above the bar's own `z-30`, and inset from the viewport edge by the gap the bar keeps. */}
				<Menu.Positioner className="z-40" side="bottom" sideOffset={8} align="end" collisionPadding={12}>
					<Menu.Popup className="flex min-w-[14rem] flex-col gap-2 rounded-sm border border-line bg-surface p-3 text-ink">
						<p className="m-0 max-w-[36ch] text-sm leading-relaxed text-muted">{detected}</p>
						<Menu.RadioGroup
							value={value}
							onValueChange={(next) => onChange(next as TargetModeChoice)}
							aria-label={t('targets.label')}
							className="flex flex-col gap-1"
						>
							{TARGET_MODE_CHOICES.map((choice) => (
								<Menu.RadioItem
									key={choice}
									value={choice}
									// Base UI leaves a radio item's menu open by default, which suits a menu of several
									// settings and not this one: these three are the whole popup, so staying open after
									// a choice leaves the reader covering the report with a menu they are done with.
									closeOnClick
									className="flex min-h-11 cursor-pointer items-center gap-2 rounded-sm px-2 font-mono text-sm font-semibold tracking-[0.1em] text-ink-2 uppercase transition-colors data-highlighted:bg-raised data-highlighted:text-ink"
								>
									<Menu.RadioItemIndicator
										// A reserved column rather than a conditional glyph, so the labels sit on one
										// left edge whichever of them is the chosen one.
										keepMounted
										className="w-3 shrink-0 text-kick data-unchecked:invisible"
									>
										&bull;
									</Menu.RadioItemIndicator>
									{t(LABEL[choice])}
								</Menu.RadioItem>
							))}
						</Menu.RadioGroup>
					</Menu.Popup>
				</Menu.Positioner>
			</Menu.Portal>
		</Menu.Root>
	);
}
