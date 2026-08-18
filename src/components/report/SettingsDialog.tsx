import { useId } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import type { SettingsState } from '~/hooks/useSettings';
import type { AnalysisSettings } from '~/lib/settings';
import {
	COOLDOWN_LEEWAY,
	SNAPSHOT_LEEWAY,
	TIGER_PALM_REFRESH,
	clampCooldownLeeway,
	clampLeeway,
	clampRefreshWindow,
	isDefault,
} from '~/lib/settings';

import { DialogShell } from '../primitives';
import { buttonClass, fieldClass, labelClass, primaryButtonClass } from '../primitives/controls';

interface Values {
	snapshotLeewayMs: number | string;
	tigerPalmRefreshMs: number | string;
	cooldownLeewayMs: number | string;
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
	const refreshID = useId();
	const refreshHintID = useId();
	const cooldownID = useId();
	const cooldownHintID = useId();

	const {
		register,
		handleSubmit,
		reset: resetForm,
	} = useForm<Values>({
		values: {
			snapshotLeewayMs: settings.snapshotLeewayMs,
			tigerPalmRefreshMs: settings.tigerPalmRefreshMs,
			cooldownLeewayMs: settings.cooldownLeewayMs,
		},
	});

	const submit = handleSubmit((values) => {
		const next: AnalysisSettings = {
			snapshotLeewayMs: clampLeeway(values.snapshotLeewayMs),
			tigerPalmRefreshMs: clampRefreshWindow(values.tigerPalmRefreshMs),
			cooldownLeewayMs: clampCooldownLeeway(values.cooldownLeewayMs),
		};
		save(next);
		// Re-seed from the clamped values, so a refused entry does not sit in the field looking accepted.
		resetForm({
			snapshotLeewayMs: next.snapshotLeewayMs,
			tigerPalmRefreshMs: next.tigerPalmRefreshMs,
			cooldownLeewayMs: next.cooldownLeewayMs,
		});
	});

	return (
		<DialogShell
			trigger={
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
			}
			title={t('settings.title')}
			description={t('settings.intent')}
		>
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
					<label className={labelClass} htmlFor={refreshID}>
						{t('settings.tigerPalm.label')}
					</label>
					<div className="flex items-center gap-2">
						<input
							id={refreshID}
							type="number"
							inputMode="numeric"
							min={TIGER_PALM_REFRESH.min}
							max={TIGER_PALM_REFRESH.max}
							step={TIGER_PALM_REFRESH.step}
							aria-describedby={refreshHintID}
							className={`${fieldClass} max-w-[10rem]`}
							{...register('tigerPalmRefreshMs')}
						/>
						<span className="font-mono text-sm text-muted">{t('settings.tigerPalm.unit')}</span>
					</div>
					<p id={refreshHintID} className="m-0 max-w-[52ch] text-sm leading-relaxed text-muted">
						{t('settings.tigerPalm.hint', {
							min: TIGER_PALM_REFRESH.min,
							max: TIGER_PALM_REFRESH.max,
							default: TIGER_PALM_REFRESH.default,
						})}
					</p>
				</div>

				<div className="flex flex-col gap-2">
					<label className={labelClass} htmlFor={cooldownID}>
						{t('settings.cooldown.label')}
					</label>
					<div className="flex items-center gap-2">
						<input
							id={cooldownID}
							type="number"
							inputMode="numeric"
							min={COOLDOWN_LEEWAY.min}
							max={COOLDOWN_LEEWAY.max}
							step={COOLDOWN_LEEWAY.step}
							aria-describedby={cooldownHintID}
							className={`${fieldClass} max-w-[10rem]`}
							{...register('cooldownLeewayMs')}
						/>
						<span className="font-mono text-sm text-muted">{t('settings.cooldown.unit')}</span>
					</div>
					<p id={cooldownHintID} className="m-0 max-w-[52ch] text-sm leading-relaxed text-muted">
						{t('settings.cooldown.hint', {
							min: COOLDOWN_LEEWAY.min,
							max: COOLDOWN_LEEWAY.max,
							default: COOLDOWN_LEEWAY.default,
						})}
					</p>
				</div>

				<p className="m-0 max-w-[52ch] text-sm leading-relaxed text-muted">{t('settings.storage')}</p>

				<div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
					<button
						type="button"
						className={`${buttonClass} w-full sm:w-auto`}
						onClick={() => {
							reset();
							resetForm({
								snapshotLeewayMs: SNAPSHOT_LEEWAY.default,
								tigerPalmRefreshMs: TIGER_PALM_REFRESH.default,
								cooldownLeewayMs: COOLDOWN_LEEWAY.default,
							});
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
		</DialogShell>
	);
}
