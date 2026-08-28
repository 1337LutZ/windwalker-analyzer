import { useTranslation } from 'react-i18next';

import type { AnalysisMode } from '~/lib/analysis/analysisMode';

import { compactChoiceClass, labelClass } from '../primitives/controls';

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
 * label and a sentence, and neither is offered as a variant of the other.
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
			{/* The consequence, not the setting — a reader who has switched wants to know what moved, and a
			    reader who has not wants to know why the default is the safe one. */}
			<span className="max-w-[62ch] text-sm text-muted">
				{value === 'parsing' ? t('analysisMode.parsingHint') : t('analysisMode.progressionHint')}
			</span>
		</div>
	);
}
