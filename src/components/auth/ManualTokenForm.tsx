import { useId } from 'react';
import { Collapsible } from '@base-ui/react/collapsible';
import { format, formatDistanceToNow } from 'date-fns';
import { useForm } from 'react-hook-form';

import { cleanToken, inspectToken, useSession } from '~/lib/auth';

import { buttonClass, fieldClass, labelClass } from '../primitives/controls';

interface Values {
	token: string;
}

/**
 * The second way in: a token the visitor generated themselves.
 *
 * Collapsed by default and behind a Base UI `Collapsible`, because the sign-in button beside it is
 * what almost everyone wants — but one click away rather than hidden, because for the people who
 * already mint their own tokens this is the shorter road, not a lesser one.
 *
 * Two rules the field obeys. It is a password input, so a token is never readable on screen even
 * while it is being pasted; and it is emptied on submit, so nothing holds a `value` that a
 * screenshot, a devtools pane or the browser's own form restore could bring back.
 *
 * The only refusals here are the ones that can be proved without asking WarcraftLogs: an empty box,
 * and a token whose `exp` has already passed. Everything else — including a payload that will not
 * decode at all — is accepted and allowed to fail against the real API, because a token that looks
 * malformed to us and works is far likelier than the reverse.
 */
export default function ManualTokenForm() {
	const { signInWithToken } = useSession();
	const inputID = useId();
	const errorID = useId();
	const {
		register,
		handleSubmit,
		reset,
		formState: { errors },
	} = useForm<Values>({ defaultValues: { token: '' } });

	const submit = handleSubmit(({ token }) => {
		signInWithToken(token);
		reset({ token: '' });
	});

	const problem = errors.token?.message;

	return (
		<Collapsible.Root className="flex flex-col gap-3 border-t border-line pt-4">
			<Collapsible.Trigger className="group flex min-h-11 w-full items-center justify-between gap-3 rounded-sm text-left font-mono text-sm font-semibold tracking-[0.1em] text-muted uppercase transition-colors hover:text-ink">
				Advanced: use your own access token
				<span aria-hidden="true" className="transition-transform group-data-panel-open:rotate-180">
					&darr;
				</span>
			</Collapsible.Trigger>

			<Collapsible.Panel className="flex flex-col gap-3">
				<p className="m-0 max-w-[64ch] leading-relaxed text-ink-2">
					If you already generate your own WarcraftLogs tokens, paste one here instead. It is kept in this tab exactly
					like a signed-in one: never written to disk, never logged, sent only to warcraftlogs.com, and gone when the
					tab closes. A token from the client-credentials flow works too — it reads public logs only, and you will be
					told so.
				</p>

				<form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
					<div className="flex flex-1 flex-col gap-2">
						<label className={labelClass} htmlFor={inputID}>
							Access token
						</label>
						<input
							id={inputID}
							type="password"
							className={fieldClass}
							placeholder="Paste the token"
							autoComplete="off"
							autoCapitalize="off"
							spellCheck={false}
							enterKeyHint="go"
							aria-invalid={problem !== undefined}
							aria-describedby={problem === undefined ? undefined : errorID}
							{...register('token', { validate: refuse })}
						/>
						{problem === undefined ? null : (
							<p id={errorID} role="alert" className="m-0 text-base leading-relaxed text-miss">
								{problem}
							</p>
						)}
					</div>
					<button type="submit" className={`${buttonClass} w-full sm:w-auto`}>
						Use this token
					</button>
				</form>
			</Collapsible.Panel>
		</Collapsible.Root>
	);
}

/**
 * Why this token cannot be used, or `true`.
 *
 * The expiry check exists so the failure arrives here, naming the moment it lapsed, rather than four
 * steps later as a bare 401 that reads like the report code was wrong.
 */
function refuse(value: string): string | true {
	const token = cleanToken(value);
	if (token === '') return 'Paste the access token WarcraftLogs generated for you.';

	const { expired, expiresAt } = inspectToken(token);
	if (expired && expiresAt !== null) {
		return `That token expired ${formatDistanceToNow(expiresAt, { addSuffix: true })}, on ${format(
			expiresAt,
			'd MMM yyyy',
		)} at ${format(expiresAt, 'HH:mm')}. Generate a fresh one and paste that.`;
	}
	return true;
}
