import { useId } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import type { SettingsState } from '~/hooks/useSettings';
import { isDefault, normaliseSettings } from '~/lib/settings';

import { DialogShell } from '../primitives';
import { buttonClass, fieldClass, labelClass, primaryButtonClass } from '../primitives/controls';

type Values = Record<string, number | string>;

/**
 * The thresholds a reader is allowed to disagree with, behind the toolbar's settings button.
 *
 * Renders whatever schema the spec declares — each entry's `tKey` names its `label`, `hint` and
 * `unit` copy under `ui.settings` — so a second spec's thresholds need no new UI here.
 *
 * A Base UI `Dialog` for the usual reasons — focus trapping, Escape, the ARIA wiring — and stacked
 * above the sticky toolbar it is opened from, which is the bug the Tiger Palm modal hit.
 *
 * Saving re-reads the fight without re-fetching it: the analysis is derived from the cached dataset,
 * so a threshold change costs nothing against the reader's WarcraftLogs point budget.
 */
export default function SettingsDialog({ settings, save, reset, schema }: SettingsState) {
	const { t } = useTranslation('ui');
	const inputID = useId();
	const hintID = useId();

	const defaults = Object.fromEntries(schema.map((s) => [s.key, s.default]));
	const {
		register,
		handleSubmit,
		reset: resetForm,
	} = useForm<Values>({
		values: Object.fromEntries(schema.map((s) => [s.key, settings[s.key]])),
	});

	const submit = handleSubmit((values) => {
		const next = normaliseSettings(values, schema);
		save(next);
		// Re-seed from the clamped values, so a refused entry does not sit in the field looking accepted.
		resetForm(Object.fromEntries(schema.map((s) => [s.key, next[s.key]])));
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
				{schema.map((s) => {
					const id = `${inputID}-${s.key}`;
					const hintId = `${hintID}-${s.key}`;
					return (
						<div key={s.key} className="flex flex-col gap-2">
							<label className={labelClass} htmlFor={id}>
								{t(`${s.tKey}.label`)}
							</label>
							<div className="flex items-center gap-2">
								<input
									id={id}
									type="number"
									inputMode="numeric"
									min={s.min}
									max={s.max}
									step={s.step}
									aria-describedby={hintId}
									className={`${fieldClass} max-w-[10rem]`}
									{...register(s.key)}
								/>
								<span className="font-mono text-sm text-muted">{t(`${s.tKey}.unit`)}</span>
							</div>
							<p id={hintId} className="m-0 max-w-[52ch] text-sm leading-relaxed text-muted">
								{t(`${s.tKey}.hint`, { min: s.min, max: s.max, default: s.default })}
							</p>
						</div>
					);
				})}

				<p className="m-0 max-w-[52ch] text-sm leading-relaxed text-muted">{t('settings.storage')}</p>

				<div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
					<button
						type="button"
						className={`${buttonClass} w-full sm:w-auto`}
						onClick={() => {
							reset();
							resetForm(defaults);
						}}
						disabled={isDefault(settings, schema)}
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
