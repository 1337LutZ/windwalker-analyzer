import { useId } from 'react';
import { useForm } from 'react-hook-form';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import '~/lib/i18n';

import { useRedirectUri } from '~/hooks/useRedirectUri';
import { WCL_CLIENTS_URL, looksLikeClientID, useSession } from '~/lib/auth';

import { CopyField, Field } from '../primitives';
import { buttonClass, fieldClass } from '../primitives/controls';

interface Values {
	clientID: string;
}

const linkClass = 'text-kick underline underline-offset-2';

/**
 * Registering an API client, which every visitor has to do once before the sign-in button can work.
 *
 * This is onboarding rather than a deployment detail, and it is here rather than in a README because
 * of *why* it cannot be done once by whoever deploys the app: WarcraftLogs meters its API per
 * client, so a single shared id would pool every visitor's request budget into one quota. One build
 * serves everybody, so a build-time variable cannot give each visitor their own — the id has to be
 * per-browser, which makes it something to ask for on screen.
 *
 * The redirect URI is rendered live and copyable rather than written out in prose, and that is the
 * load-bearing part of this component. WarcraftLogs matches redirect URIs byte for byte and reports
 * a mismatch as `invalid_client` — "Client authentication failed" — which reads as though the id
 * were wrong, so it sends people back to re-check an id they pasted correctly. Copying the string
 * this app will actually send removes the whole class of error.
 */
export default function ClientIdSetup() {
	const { clientID, saveClientID } = useSession();
	const { t } = useTranslation('ui');
	const uri = useRedirectUri();
	const inputID = useId();
	const {
		register,
		handleSubmit,
		reset,
		formState: { errors },
	} = useForm<Values>({ defaultValues: { clientID: '' } });

	const submit = handleSubmit(({ clientID: value }) => {
		saveClientID(value);
		reset({ clientID: '' });
	});

	const problem = errors.clientID?.message;

	return (
		<div className="flex flex-col gap-4 rounded-sm border border-brew/60 bg-surface p-4">
			<h3 className="m-0 font-mono text-base font-semibold text-ink">
				{clientID === null ? t('auth.client.titleFirst') : t('auth.client.titleAnother')}
			</h3>

			<p className="m-0 max-w-[64ch] leading-relaxed text-ink-2">{t('auth.client.intro')}</p>

			{/* Same measure as the prose above it. The steps are read, not scanned, and a 64ch column is
			    what keeps the eye finding the next line — the numbers do not earn the full card width. */}
			<ol className="m-0 flex max-w-[64ch] list-none flex-col gap-3 p-0 leading-relaxed text-ink-2">
				<Step n={1}>
					{t('auth.client.step.open')}{' '}
					<a className={linkClass} href={WCL_CLIENTS_URL} target="_blank" rel="noopener noreferrer">
						{t('auth.client.step.link')}
					</a>{' '}
					{t('auth.client.step.choose')}{' '}
					<strong className="font-semibold text-ink">{t('auth.client.step.create')}</strong>.
				</Step>
				<Step n={2}>{t('auth.client.step.name')}</Step>
				<Step n={3}>
					{t('auth.client.step.redirect')}
					{uri === null ? null : <CopyField label={t('auth.client.redirectLabel')} value={uri} />}
				</Step>
				<Step n={4}>
					{t('auth.client.step.tick')}{' '}
					<strong className="font-semibold text-ink">{t('auth.client.step.publicClient')}</strong>{' '}
					{t('auth.client.step.pkce')}
				</Step>
				<Step n={5}>
					{t('auth.client.step.copy')}{' '}
					<strong className="font-semibold text-ink">{t('auth.client.step.clientId')}</strong>{' '}
					{t('auth.client.step.paste')}
				</Step>
			</ol>

			{/* Held to the same column as the steps. A full-card-width box for a 36-character UUID reads as
			    a field expecting something much longer than what is being asked for. */}
			<form onSubmit={submit} className="flex max-w-[64ch] flex-col gap-3 sm:flex-row sm:items-end">
				<Field id={inputID} label={t('auth.client.field')} error={problem}>
					<input
						id={inputID}
						type="text"
						className={fieldClass}
						placeholder="00000000-0000-0000-0000-000000000000"
						autoComplete="off"
						autoCapitalize="off"
						spellCheck={false}
						enterKeyHint="go"
						aria-invalid={problem !== undefined}
						aria-describedby={problem === undefined ? undefined : `${inputID}-error`}
						{...register('clientID', { validate: (value) => refuse(value, t) })}
					/>
				</Field>
				<button type="submit" className={`${buttonClass} w-full sm:w-auto`}>
					{t('auth.client.save')}
				</button>
			</form>

			<p className="m-0 max-w-[64ch] text-sm leading-relaxed text-muted">{t('auth.client.kept')}</p>
		</div>
	);
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
	return (
		<li className="flex flex-col gap-2">
			<span className="flex gap-3">
				<span aria-hidden="true" className="tabular font-mono font-semibold text-brew">
					{n}.
				</span>
				<span>{children}</span>
			</span>
		</li>
	);
}

/**
 * Why this cannot be a client id, or `true`.
 *
 * The shape check is aimed at one specific mistake: the registration page shows the id and the
 * client secret together, and the secret is the more conspicuous of the two. Catching it here means
 * saying so plainly, instead of storing a secret this app must never hold and then failing the
 * sign-in with a message about authentication.
 *
 * `t` is a parameter rather than a hook because this is a plain function outside the component, and
 * it is a plain function because `react-hook-form` calls it with a value and nothing else.
 */
function refuse(value: string, t: TFunction<'ui'>): string | true {
	const trimmed = value.trim();
	if (trimmed === '') return t('auth.client.empty');
	if (!looksLikeClientID(trimmed)) return t('auth.client.notAnId');
	return true;
}
