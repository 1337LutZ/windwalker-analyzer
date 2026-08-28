import { useTranslation } from 'react-i18next';

import type { AnalysisMode } from '~/lib/analysis/analysisMode';

import { compactChoiceClass, labelClass } from '../primitives/controls';

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
