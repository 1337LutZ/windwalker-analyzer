import { useEffect, useId, useRef } from 'react';
import { useForm } from 'react-hook-form';

import { Field } from '../primitives';
import { buttonClass, fieldClass } from '../primitives/controls';
import { parseReportInput, type ResolvedReportInput } from './parseReportInput';

interface Values {
	report: string;
}

interface Props {
	busy: boolean;
	/**
	 * The code a shared link carried in, to prefill the field with.
	 *
	 * The fights below were loaded from the URL rather than from a submit here, so it also seeds the
	 * `loaded` ref: without that, editing the prefilled field would never count as diverging from
	 * the report on screen, and everything under this step would go stale unchallenged.
	 */
	initialReport?: string | null;
	onSubmit: (parsed: ResolvedReportInput) => void;
	/**
	 * Fired when the field stops matching what is loaded below it.
	 *
	 * Everything under this step — the fight list, the player list, the report itself — belongs to the
	 * code that was submitted. The moment someone types a different one, all of it is about a report
	 * they are no longer looking at, and leaving it on screen invites reading one report's numbers
	 * under another report's name.
	 */
	onDiverge: () => void;
}

const REFUSAL =
	'Paste the whole WarcraftLogs report URL, or just its code — the run of letters and digits after /reports/.';

/**
 * Where a report comes in. One field, because a report URL already carries the fight and the player
 * in its fragment and re-typing them is work nobody should be asked to do twice.
 */
export default function ReportInput({ busy, initialReport = null, onSubmit, onDiverge }: Props) {
	const inputID = useId();
	const {
		register,
		handleSubmit,
		watch,
		formState: { errors },
	} = useForm<Values>({ defaultValues: { report: initialReport ?? '' } });

	// The code the results below currently belong to.
	const loaded = useRef<string | null>(initialReport);

	const submit = handleSubmit(({ report }) => {
		const parsed = parseReportInput(report);
		// Unreachable — `validate` refuses this first — but it is what makes the code non-null.
		if (parsed.code === null) return;
		loaded.current = parsed.code;
		onSubmit({ ...parsed, code: parsed.code });
	});

	// Watched rather than handled on the input's own `onChange`, because `register` already owns that
	// handler and wrapping it is how one of the two ends up not firing.
	useEffect(() => {
		const subscription = watch((values) => {
			if (loaded.current === null) return;
			const typed = parseReportInput(values.report ?? '').code;
			if (typed !== loaded.current) {
				loaded.current = null;
				onDiverge();
			}
		});
		return () => subscription.unsubscribe();
	}, [watch, onDiverge]);

	const problem = errors.report?.message;

	return (
		<form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
			<Field id={inputID} label="Report code or URL" error={problem}>
				<input
					id={inputID}
					type="text"
					inputMode="url"
					enterKeyHint="go"
					className={fieldClass}
					placeholder="classic.warcraftlogs.com/reports/aBcDeFgH12345678"
					autoComplete="off"
					autoCapitalize="off"
					spellCheck={false}
					aria-invalid={problem !== undefined}
					aria-describedby={problem === undefined ? undefined : `${inputID}-error`}
					{...register('report', {
						validate: (value) => parseReportInput(value).code !== null || REFUSAL,
					})}
				/>
			</Field>
			<button type="submit" className={`${buttonClass} w-full sm:w-auto`} disabled={busy}>
				{busy ? 'Loading…' : 'Load fights'}
			</button>
		</form>
	);
}
