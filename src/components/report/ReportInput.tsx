import { useEffect, useId, useRef } from 'react';
import { useForm } from 'react-hook-form';

import { buttonClass, fieldClass, labelClass } from '../primitives';
import { parseReportInput, type ResolvedReportInput } from './parseReportInput';

interface Values {
	report: string;
}

interface Props {
	busy: boolean;
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
export default function ReportInput({ busy, onSubmit, onDiverge }: Props) {
	const inputID = useId();
	const errorID = useId();
	const {
		register,
		handleSubmit,
		watch,
		formState: { errors },
	} = useForm<Values>({ defaultValues: { report: '' } });

	// The code the results below currently belong to.
	const loaded = useRef<string | null>(null);

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
			<div className="flex flex-1 flex-col gap-2">
				<label className={labelClass} htmlFor={inputID}>
					Report code or URL
				</label>
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
					aria-describedby={problem === undefined ? undefined : errorID}
					{...register('report', {
						validate: (value) => parseReportInput(value).code !== null || REFUSAL,
					})}
				/>
				{problem === undefined ? null : (
					<p id={errorID} role="alert" className="m-0 text-base leading-relaxed text-miss">
						{problem}
					</p>
				)}
			</div>
			<button type="submit" className={`${buttonClass} w-full sm:w-auto`} disabled={busy}>
				{busy ? 'Loading…' : 'Load fights'}
			</button>
		</form>
	);
}
