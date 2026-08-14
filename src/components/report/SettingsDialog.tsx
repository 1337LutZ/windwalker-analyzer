import { useId } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import type { SettingsState } from '~/hooks/useSettings';
import type { AnalysisSettings } from '~/lib/settings';
import { MAX_HEALTH, SNAPSHOT_LEEWAY, clampHealth, clampLeeway, isDefault } from '~/lib/settings';

import { buttonClass, fieldClass, labelClass, primaryButtonClass } from '../primitives';

interface Values {
	snapshotLeewayMs: number | string;
	maxHealth: number | string;
}

/**
 * The thresholds a reader is allowed to disagree with, behind the toolbar's settings button.
 *
 * A Base UI `Dialog` for the usual reasons — focus trapping, Escape, the ARIA wiring — and stacked
 * above the sticky toolbar it is opened from, which is the bug the Tiger Palm modal hit.
 *
 * Saving re-reads the fight without re-fetching it: the analysis is derived from the cached dataset,
 * so a threshold change costs nothing against the reader's WarcraftLogs point budget.
 */
export default function SettingsDialog({ settings, save, reset }: SettingsState) {
	const { t } = useTranslation('ui');
	const inputID = useId();
	const hintID = useId();
	const healthID = useId();
	const healthHintID = useId();

	const {
		register,
		handleSubmit,
		reset: resetForm,
	} = useForm<Values>({
		values: {
			snapshotLeewayMs: settings.snapshotLeewayMs,
			// Empty rather than 0: the field being blank is what "I have not said" looks like.
			maxHealth: settings.maxHealth ?? '',
		},
	});

	const submit = handleSubmit((values) => {
		const next: AnalysisSettings = {
			snapshotLeewayMs: clampLeeway(values.snapshotLeewayMs),
			maxHealth: clampHealth(values.maxHealth),
		};
		save(next);
		// Re-seed from the clamped values, so a refused entry does not sit in the field looking accepted.
		resetForm({ snapshotLeewayMs: next.snapshotLeewayMs, maxHealth: next.maxHealth ?? '' });
	});

	return (
		<Dialog.Root>
			<Dialog.Trigger
				className={`${buttonClass} shrink-0 px-3`}
				// The gear alone is not a name; this is what a screen reader announces.
				aria-label={t('settings.open')}
				title={t('settings.open')}
			>
				<span aria-hidden="true" className="text-base leading-none">
					&#9881;
				</span>
				<span className="sr-only sm:not-sr-only">{t('settings.short')}</span>
			</Dialog.Trigger>
			<Dialog.Portal>
				<Dialog.Backdrop className="fixed inset-0 z-40 min-h-dvh bg-bg/80 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
				<Dialog.Popup className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-sm border border-line bg-surface p-5 text-ink transition-[scale,opacity] duration-150 data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0 sm:p-6">
					<Dialog.Title className="m-0 font-mono text-lg font-semibold tracking-[-0.01em] text-ink">
						{t('settings.title')}
					</Dialog.Title>
					<Dialog.Description className="m-0 leading-relaxed text-ink-2">{t('settings.intent')}</Dialog.Description>

					<form onSubmit={submit} className="flex flex-col gap-4">
						<div className="flex flex-col gap-2">
							<label className={labelClass} htmlFor={inputID}>
								{t('settings.leeway.label')}
							</label>
							<div className="flex items-center gap-2">
								<input
									id={inputID}
									type="number"
									inputMode="numeric"
									min={SNAPSHOT_LEEWAY.min}
									max={SNAPSHOT_LEEWAY.max}
									step={SNAPSHOT_LEEWAY.step}
									aria-describedby={hintID}
									className={`${fieldClass} max-w-[10rem]`}
									{...register('snapshotLeewayMs')}
								/>
								<span className="font-mono text-sm text-muted">{t('settings.leeway.unit')}</span>
							</div>
							<p id={hintID} className="m-0 max-w-[52ch] text-sm leading-relaxed text-muted">
								{t('settings.leeway.hint', {
									min: SNAPSHOT_LEEWAY.min,
									max: SNAPSHOT_LEEWAY.max,
									default: SNAPSHOT_LEEWAY.default,
								})}
							</p>
						</div>

						<div className="flex flex-col gap-2">
							<label className={labelClass} htmlFor={healthID}>
								{t('settings.health.label')}
							</label>
							<input
								id={healthID}
								type="number"
								inputMode="numeric"
								min={MAX_HEALTH.min}
								max={MAX_HEALTH.max}
								step={MAX_HEALTH.step}
								placeholder={t('settings.health.placeholder')}
								aria-describedby={healthHintID}
								className={`${fieldClass} max-w-[14rem]`}
								{...register('maxHealth')}
							/>
							<p id={healthHintID} className="m-0 max-w-[52ch] text-sm leading-relaxed text-muted">
								{t('settings.health.hint')}
							</p>
						</div>

						<p className="m-0 max-w-[52ch] text-sm leading-relaxed text-muted">{t('settings.storage')}</p>

						<div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
							<button
								type="button"
								className={`${buttonClass} w-full sm:w-auto`}
								onClick={() => {
									reset();
									resetForm({ snapshotLeewayMs: SNAPSHOT_LEEWAY.default, maxHealth: '' });
								}}
								disabled={isDefault(settings)}
							>
								{t('settings.reset')}
							</button>
							<Dialog.Close className={`${primaryButtonClass} w-full sm:w-auto`} onClick={() => submit()}>
								{t('settings.save')}
							</Dialog.Close>
						</div>
					</form>
				</Dialog.Popup>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
