import { useTranslation } from 'react-i18next';

import type { TargetSummary } from '~/lib/types';
import { TARGET_MODE_CHOICES, resolveTargetMode, type TargetModeChoice } from '~/lib/view/targetMode';

import { compactChoiceClass, labelClass } from '../primitives/controls';
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

export default function TargetModeControl({ targets, value, onChange }: Props) {
	const { t } = useTranslation('report');
	const { detected, overridden } = resolveTargetMode(targets?.detected, value);

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
			<Note>
				{detected === null
					? t('targets.detectedNone')
					: t('targets.detected', { context: detected, share: targets?.multiTargetPct ?? 0 })}
				{overridden ? ` ${t('targets.overridden', { context: value })}` : ''}
			</Note>
			<span className="text-sm text-muted">{t('targets.hint')}</span>
		</div>
	);
}
