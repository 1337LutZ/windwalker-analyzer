import { Menu } from '@base-ui/react/menu';
import { Toolbar } from '@base-ui/react/toolbar';
import { useTranslation } from 'react-i18next';

import { DEFAULT_ANALYSIS_MODE, type AnalysisMode } from '~/lib/analysis/analysisMode';

import { compactChoiceClass, labelClass, toolbarMenuClass } from '../primitives/controls';

/**
 * The article the exemption table is transcribed from.
 *
 * The same source `lib/game/rankingExclusions.ts` cites at the top of its own header — a reader who wants
 * to know which adds are struck and why should land on the ruleset rather than on this report's reading
 * of it. Linked from the word `Parsing` because that is the mode the article describes; `Progression` is
 * this report's own idea and has nothing to link to.
 */
const PARSING_RULES_URL = 'https://www.archon.gg/classic-mop/articles/news/siege-of-orgrimmar-on-warcraft-logs';

/** The same declaration `auth/TokenHelp` makes, and the only other place a link sits inside copy. */
const linkClass = 'text-kick underline underline-offset-2';

/**
 * Which question the report is answering, and the reader's right to pick.
 *
 * WarcraftLogs strikes a list of NPCs from its rankings so nobody can pad a parse on adds that respawn
 * or never die. Applying that list is right for a reader comparing themselves against the ladder and
 * wrong for one working through a progression fight: the Foul Slimes were twenty-two real bodies, the
 * decision to press Rushing Jade Wind into them was correct, and a report that pretends they were not
 * there is describing a fight nobody had.
 *
 * **It sits beside the target mode and wears its clothes, because both are re-readings of a pull that has
 * already been fetched.** Neither touches the network: this one feeds `analyse()`, which runs over the
 * events already in the query cache, so switching costs one synchronous re-analysis and no request. That
 * is why it belongs where a reader is looking at the report rather than back at the form.
 *
 * **What it does not share with the target mode is the question.** That control picks which stretch of a
 * pull to read — single target, cleave, the whole fight — and changes nothing about what was measured.
 * This one changes the measurement. Two controls in one place have to say which is which, so both carry a
 * label and a sentence, and neither is offered as a variant of the other. The sentence links out to the
 * article the exemptions are transcribed from, so a reader can check the rule rather than take this
 * report's word for which adds it strikes.
 *
 * State lives with `ReportFlow`, and unlike the target mode it is not view state: it reaches the engine.
 *
 * **Both keys are written out rather than indexed off the mode**, which is the same call
 * `TargetModeControl` makes and for the same reason: `keys.test.ts` finds copy by reading `t('…')` with a
 * literal inside, so a key reached through a record reads as unused and is deleted by the guard that
 * exists to delete unused copy. Two modes make the pair cheap.
 */
export default function AnalysisModeControl({
	value,
	onChange,
}: {
	value: AnalysisMode;
	onChange: (mode: AnalysisMode) => void;
}) {
	const { t } = useTranslation('ui');

	return (
		<div className="flex flex-col gap-2.5">
			<span className={labelClass}>{t('analysisMode.label')}</span>
			{/* A two-column grid at `w-max`, where the target mode uses a flex row — the same switches, laid
			    out for two of them rather than four. `compactChoiceClass` carries `flex-1`, so in a flex row
			    a pair of short words becomes two buttons half the page wide. Grid columns are equal by
			    default and `w-max` shrinks the track to its content, so both come out the width of the
			    longer label and no wider. */}
			<div className="grid w-max grid-cols-2 gap-2" role="radiogroup" aria-label={t('analysisMode.label')}>
				<button
					type="button"
					role="radio"
					aria-checked={value === 'parsing'}
					className={compactChoiceClass(value === 'parsing')}
					onClick={() => onChange('parsing')}
				>
					{t('analysisMode.parsing')}
				</button>
				<button
					type="button"
					role="radio"
					aria-checked={value === 'progression'}
					className={compactChoiceClass(value === 'progression')}
					onClick={() => onChange('progression')}
				>
					{t('analysisMode.progression')}
				</button>
			</div>
			{/* Split around the link the way `TokenHelp` splits its copy, which is this tree's idiom for a
			    sentence with something inline in it — there is no `Trans` anywhere here and one sentence is
			    not worth introducing it for. The link's text is the same key the button uses, so the linked
			    word can never drift from the switch it names. */}
			<span className="max-w-[62ch] text-sm text-muted">
				{t('analysisMode.hintBefore')}{' '}
				<a className={linkClass} href={PARSING_RULES_URL} target="_blank" rel="noopener noreferrer">
					{t('analysisMode.parsing')}
				</a>{' '}
				{t('analysisMode.hintAfter')}
			</span>
		</div>
	);
}

/**
 * The same choice, on the sticky bar — one button and a popup, beside the target mode's.
 *
 * **Always offered, where `TargetModeToolbar` beside it can withhold itself.** That one disappears on a
 * pull with a single reading, because a menu holding one item is a way in to a decision already made.
 * Both modes are on offer for every pull ever fetched, so there is no equivalent refusal to make here: a
 * reader can always ask the other question.
 *
 * `toolbarMenuClass` takes the amber treatment on `progression` for the reason the target mode takes it
 * on an override — it marks *"the report is not answering the question it answers by default"*, which is
 * exactly what the non-default mode means. It is the same signal in the same place, so the two triggers
 * do not have to be read differently.
 *
 * **It is not on the bar below `sm`, and that is the one control here withheld for room rather than for
 * meaning.** The bar's docstring keeps a measured px budget: on a 390px row the controls already take 276
 * of 358 and leave 82 for the encounter name, about ten of its twenty characters. A second menu spelling
 * out `Analysis mode` costs more than the name has left, and the name is the part a reader recognises the
 * pull by. Below `sm` the choice is still one press away in the block above the report, which is where it
 * was made in the first place — unlike the target mode, nothing about it is only reachable from here.
 */
export function AnalysisModeToolbar({
	value,
	onChange,
}: {
	value: AnalysisMode;
	onChange: (mode: AnalysisMode) => void;
}) {
	const { t } = useTranslation('ui');
	const overridden = value !== DEFAULT_ANALYSIS_MODE;

	return (
		<Menu.Root>
			<Toolbar.Button
				render={<Menu.Trigger />}
				title={t('analysisMode.hint')}
				aria-label={`${t('analysisMode.label')}: ${value === 'parsing' ? t('analysisMode.parsing') : t('analysisMode.progression')}`}
				// `max-sm:hidden` rather than `hidden sm:inline-flex`: `toolbarMenuClass` already sets the
				// display this needs, and a variant is sorted after the plain utility, so the narrow rule wins
				// without a second `inline-flex` in the string to disagree with it.
				className={`${toolbarMenuClass(overridden)} max-sm:hidden`}
			>
				<span aria-hidden="true">{t('analysisMode.label')}</span>
				{/* Teal for the default and amber's own colour when the mode is not it — the same pairing the
				    target mode uses, where the accent is dropped once the border is already saying more. */}
				<span aria-hidden="true" className={overridden ? undefined : 'text-kick'}>
					{value === 'parsing' ? t('analysisMode.parsing') : t('analysisMode.progression')}
				</span>
			</Toolbar.Button>

			<Menu.Portal>
				<Menu.Positioner className="z-40" side="bottom" sideOffset={8} align="end" collisionPadding={12}>
					<Menu.Popup className="flex min-w-[14rem] flex-col gap-2 rounded-sm border border-line bg-surface p-3 text-ink">
						{/* The sentence the block control carries, minus its link: a popup that closes on the next
						    click is not somewhere to send a reader out to an article from. The block above the
						    report keeps the link, and this states the same thing so the bar is not the terser
						    reading of a control the reader may never have scrolled past. */}
						<p className="m-0 max-w-[36ch] text-sm leading-relaxed text-muted">{t('analysisMode.hint')}</p>
						<Menu.RadioGroup
							value={value}
							onValueChange={(next) => onChange(next as AnalysisMode)}
							aria-label={t('analysisMode.label')}
							className="flex flex-col gap-1"
						>
							{/* Written out rather than mapped, for the reason the block control's own docstring
							    gives: `keys.test.ts` reads copy off a literal inside `t('…')`, and a key reached
							    through a record reads as unused to the guard that deletes unused copy. */}
							<Menu.RadioItem value="parsing" closeOnClick className={radioItemClass}>
								<Menu.RadioItemIndicator keepMounted className="w-3 shrink-0 text-kick data-unchecked:invisible">
									&bull;
								</Menu.RadioItemIndicator>
								{t('analysisMode.parsing')}
							</Menu.RadioItem>
							<Menu.RadioItem value="progression" closeOnClick className={radioItemClass}>
								<Menu.RadioItemIndicator keepMounted className="w-3 shrink-0 text-kick data-unchecked:invisible">
									&bull;
								</Menu.RadioItemIndicator>
								{t('analysisMode.progression')}
							</Menu.RadioItem>
						</Menu.RadioGroup>
					</Menu.Popup>
				</Menu.Positioner>
			</Menu.Portal>
		</Menu.Root>
	);
}

/** One row of the popup, shared by the two items so the pair cannot drift. */
const radioItemClass =
	'flex min-h-11 cursor-pointer items-center gap-2 rounded-sm px-2 font-mono text-sm font-semibold tracking-[0.1em] text-ink-2 uppercase transition-colors data-highlighted:bg-raised data-highlighted:text-ink';
