import { useId } from 'react';
import { Collapsible } from '@base-ui/react/collapsible';
import { format, formatDistanceToNow } from 'date-fns';
import { useForm } from 'react-hook-form';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import '~/lib/i18n';

import { cleanToken, inspectToken, useSession } from '~/lib/auth';

import { Field } from '../primitives';
import { buttonClass, fieldClass } from '../primitives/controls';

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
	const { t } = useTranslation('ui');
	const inputID = useId();
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
				{t('auth.token.advanced')}
				<span aria-hidden="true" className="transition-transform group-data-panel-open:rotate-180">
					&darr;
				</span>
			</Collapsible.Trigger>

			<Collapsible.Panel className="flex flex-col gap-3">
				<p className="m-0 max-w-[64ch] leading-relaxed text-ink-2">{t('auth.token.intro')}</p>

				<form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
					<Field id={inputID} label={t('auth.token.field')} error={problem}>
						<input
							id={inputID}
							type="password"
							className={fieldClass}
							placeholder={t('auth.token.placeholder')}
							autoComplete="off"
							autoCapitalize="off"
							spellCheck={false}
							enterKeyHint="go"
							aria-invalid={problem !== undefined}
							aria-describedby={problem === undefined ? undefined : `${inputID}-error`}
							{...register('token', { validate: (value) => refuse(value, t) })}
						/>
					</Field>
					<button type="submit" className={`${buttonClass} w-full sm:w-auto`}>
						{t('auth.token.submit')}
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
 *
 * `t` is a parameter rather than a hook because this is a plain function outside the component, and
 * it is a plain function because `react-hook-form` calls it with a value and nothing else.
 */
function refuse(value: string, t: TFunction<'ui'>): string | true {
	const token = cleanToken(value);
	if (token === '') return t('auth.token.empty');

	const { expired, expiresAt } = inspectToken(token);
	if (expired && expiresAt !== null) {
		return t('auth.token.expired', {
			ago: formatDistanceToNow(expiresAt, { addSuffix: true }),
			date: format(expiresAt, 'd MMM yyyy'),
			time: format(expiresAt, 'HH:mm'),
		});
	}
	return true;
}
