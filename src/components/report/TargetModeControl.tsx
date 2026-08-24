import { Menu } from '@base-ui/react/menu';
import { Toolbar } from '@base-ui/react/toolbar';
import { type TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import type { SegmentTimeline } from '~/lib/analysis/segments';
import type { TargetSummary } from '~/lib/types';
import { type OfferedChoice, resolveTargetMode, targetModeChoices } from '~/lib/view/targetMode';

import { compactChoiceClass, labelClass, toolbarMenuClass } from '../primitives/controls';
import { Note } from '../primitives';

/**
 * Which of this pull's rotations to read it at, and the reader's right to disagree.
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
 * **The positions come from the pull, and there are up to four of them.** The whole fight first, then
 * Single Target, Cleave and AoE — but only the ones this pull held for `TARGET_MODE_MIN_MS`. A fixed
 * menu offered a reading of nothing: measured on the committed pulls, the Elemental fixture *named*
 * `cleave` spends 15 s of 263 s in a cleave segment, and the plan's own case is a Norushen pull with no
 * single-target segment at all. `targetModeChoices` is the derivation and carries the measurements.
 *
 * **Two renderings, one control.** This one is the block above the report, with the detection spelled
 * out and the positions laid out as switches; `TargetModeToolbar` below is the same choice as one
 * button on the sticky bar's single line. They are never both on screen — see `ReportFlow`, which
 * mounts this one directly above the sentinel that mounts the bar — so the reader is looking at exactly
 * one of them at any scroll position, and both read and write the same state.
 *
 * State lives with the caller, not here and not in `AnalysisSettings`: see `lib/view/targetMode` for
 * why this is view state rather than an analysis setting.
 */
interface Props {
	/** The pull's own counts. Undefined on an analysis captured before they existed. */
	targets: TargetSummary | undefined;
	/** The pull's own mode timeline, which is what the menu is derived from. Undefined on an old capture. */
	segments: SegmentTimeline | undefined;
	value: OfferedChoice;
	onChange: (choice: OfferedChoice) => void;
}

/**
 * Deliberately literal rather than built from the choice, so the copy is greppable from the locale.
 *
 * Keyed by `OfferedChoice` and not by `TargetModeChoice`, which is the type doing a job here: `'multi'`
 * is a legal reading for a caller holding a detected mode and is not a position any control offers, so
 * a record over the wider type would have demanded a label for a button that cannot exist — and then
 * left it in the locale for ever, unread, which is the shape of dead copy `keys.test.ts` hunts.
 */
const LABEL: Record<OfferedChoice, string> = {
	auto: 'targets.auto',
	single: 'targets.single',
	cleave: 'targets.cleave',
	aoe: 'targets.aoe',
};

/**
 * The same four, at the length a toolbar can hold.
 *
 * Separate keys rather than a truncation of the ones above, for the same reason those are spelled
 * out: what renders has to be findable in the locale. "Single target" is 75px of mono capitals and
 * the bar has the encounter name to fit beside it, which is what these are shorter for — not a
 * different meaning, a different width.
 */
const SHORT_LABEL: Record<OfferedChoice, string> = {
	auto: 'targets.shortAuto',
	single: 'targets.shortSingle',
	cleave: 'targets.shortCleave',
	aoe: 'targets.shortAoe',
};

/**
 * What the pull detected, and whether the reader is contradicting it.
 *
 * Shared by both renderings so they cannot come to disagree about a pull: one says it in a `Note`
 * under the switches, the other has no line for it and carries it as the group's description.
 */
function detection(t: TFunction<'report'>, targets: TargetSummary | undefined, value: OfferedChoice): string {
	const { detected, overridden } = resolveTargetMode(targets?.detected, value);
	const seen =
		detected === null
			? t('targets.detectedNone')
			: t('targets.detected', { context: detected, share: targets?.multiTargetPct ?? 0 });
	return overridden ? `${seen} ${t('targets.overridden', { context: value })}` : seen;
}

export default function TargetModeControl({ targets, segments, value, onChange }: Props) {
	const { t } = useTranslation('report');
	const choices = targetModeChoices(segments);

	return (
		<div className="flex flex-col gap-2.5">
			<span className={labelClass}>{t('targets.label')}</span>
			{/* No switches at all when the whole fight is the only reading, and the sentence below says so
			    instead. One always-checked radio is not a choice: it reads as a control that has broken
			    rather than as a pull that held one rotation, which is the fact there is to report. What is
			    *not* dropped with it is the detection — a reader is still told what the pull looked like,
			    which is this control's first job and the one it has whether or not it has switches. */}
			{choices.length > 1 ? (
				<div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('targets.label')}>
					{choices.map((choice) => (
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
			) : null}
			<Note>{detection(t, targets, value)}</Note>
			<span className="text-sm text-muted">{choices.length > 1 ? t('targets.hint') : t('targets.onlyWhole')}</span>
		</div>
	);
}

/**
 * The same control, on the sticky bar — one button, and only where there is something to choose.
 *
 * **Nothing at all when the pull offers one reading**, which is the same refusal the block above the
 * report makes and for the same reason: a permanently-checked control is not a choice, and a menu whose
 * popup holds one item is a way in to a decision that has already been made. The bar was drawing both —
 * a one-item radio group at `md` and up, a one-item popup below it — on every pull whose only offer is
 * the whole fight, which is every captured fixture and Immerseus.
 *
 * **The switches are gone from here and the button is the only rendering.** They were the better control
 * where there was room — one press instead of two — and the room was the problem: measured on this row a
 * row of switches is 140px against the button's 78px, and a pull holding every rotation offers four of
 * them, 45px more off the encounter name at every width. `md` was where the trade was drawn, and above it
 * the bar carried a second copy of the same list, keyboard model and all. One rendering cannot disagree
 * with itself about which readings a pull offers, which the two of them had to be tested against.
 *
 * `choices` is derived here and handed down, rather than derived again inside the menu: the visibility
 * decision above and the list inside the popup are then the same array by construction.
 */
export function TargetModeToolbar({ targets, segments, value, onChange }: Props) {
	const choices = targetModeChoices(segments);
	if (choices.length <= 1) return null;
	return <TargetModeMenu targets={targets} choices={choices} value={value} onChange={onChange} />;
}

/**
 * The choices as one button and a popup — the bar's whole rendering of this control.
 *
 * 78px against the 140px a row of switches costs on this row, which is most of what the credits readout
 * beside it takes from the encounter name; a pull that offers four readings makes that louder rather than
 * different, since this button is the same width whatever the menu holds. Those numbers were the argument
 * for collapsing the switches below `md` and they are the argument for collapsing them at every width:
 * the switches bought one press instead of two, and cost a second copy of the offered list.
 *
 * `Menu.RadioGroup` / `Menu.RadioItem` rather than three `Menu.Item`s, because exactly one of these is
 * chosen and a list of buttons with one highlighted is not that to a screen reader. The full labels are
 * used in here — the popup has the room the bar does not, which is what the short ones on the trigger are
 * for.
 *
 * **The detection survives the collapse.** The trigger carries the sentence as its `title` and the popup
 * states it above the choices where it can be read rather than hovered — this control's docstring above
 * insists the pull's own reading stays visible even when it is being overridden. The trigger also names
 * the current mode, so the state is on the bar and not only inside the popup.
 */
function TargetModeMenu({
	targets,
	choices,
	value,
	onChange,
}: Omit<Props, 'segments'> & { choices: readonly OfferedChoice[] }) {
	const { t } = useTranslation('report');
	const { overridden } = resolveTargetMode(targets?.detected, value);
	const detected = detection(t, targets, value);

	return (
		<Menu.Root>
			<Toolbar.Button
				render={<Menu.Trigger />}
				title={detected}
				aria-label={`${t('targets.label')}: ${t(LABEL[value])}`}
				className={toolbarMenuClass(overridden)}
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
							onValueChange={(next) => onChange(next as OfferedChoice)}
							aria-label={t('targets.label')}
							className="flex flex-col gap-1"
						>
							{choices.map((choice) => (
								<Menu.RadioItem
									key={choice}
									value={choice}
									// Base UI leaves a radio item's menu open by default, which suits a menu of several
									// settings and not this one: these are the whole popup, so staying open after a
									// choice leaves the reader covering the report with a menu they are done with.
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
