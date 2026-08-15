import { useId } from 'react';
import { useForm } from 'react-hook-form';

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
				{clientID === null ? 'First, register your own API client' : 'Use a different API client'}
			</h3>

			<p className="m-0 max-w-[64ch] leading-relaxed text-ink-2">
				WarcraftLogs meters its API per client, so this app cannot sign you in with one of its own — everyone using it
				would share a single hourly budget and run each other out of it. Registering your own takes about a minute and
				gives you a budget nobody else spends.
			</p>

			{/* Same measure as the prose above it. The steps are read, not scanned, and a 64ch column is
			    what keeps the eye finding the next line — the numbers do not earn the full card width. */}
			<ol className="m-0 flex max-w-[64ch] list-none flex-col gap-3 p-0 leading-relaxed text-ink-2">
				<Step n={1}>
					Open{' '}
					<a className={linkClass} href={WCL_CLIENTS_URL} target="_blank" rel="noopener noreferrer">
						warcraftlogs.com/api/clients
					</a>{' '}
					and choose <strong className="font-semibold text-ink">Create Client</strong>.
				</Step>
				<Step n={2}>Give it any name. You will see it on the consent screen when you sign in.</Step>
				<Step n={3}>
					Paste this as the redirect URL, exactly as it appears — a URL that differs by so much as a trailing slash is
					refused, and the refusal blames the client id rather than the URL.
					{uri === null ? null : <CopyField label="Redirect URL" value={uri} />}
				</Step>
				<Step n={4}>
					Tick <strong className="font-semibold text-ink">Public Client</strong> so the client can use PKCE, then save.
				</Step>
				<Step n={5}>
					Copy the <strong className="font-semibold text-ink">client ID</strong> it gives you back and paste it below.
					Not the client secret — this app has no use for one and should never be given it.
				</Step>
			</ol>

			{/* Held to the same column as the steps. A full-card-width box for a 36-character UUID reads as
			    a field expecting something much longer than what is being asked for. */}
			<form onSubmit={submit} className="flex max-w-[64ch] flex-col gap-3 sm:flex-row sm:items-end">
				<Field id={inputID} label="Client ID" error={problem}>
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
						{...register('clientID', { validate: refuse })}
					/>
				</Field>
				<button type="submit" className={`${buttonClass} w-full sm:w-auto`}>
					Save client ID
				</button>
			</form>

			<p className="m-0 max-w-[64ch] text-sm leading-relaxed text-muted">
				The client ID is kept in this browser so you do not have to paste it again, and unlike your access token it
				survives closing the tab. It is not a secret — PKCE publishes it with every sign-in — and it goes nowhere but
				warcraftlogs.com.
			</p>
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
 */
function refuse(value: string): string | true {
	const trimmed = value.trim();
	if (trimmed === '') return 'Paste the client ID from your WarcraftLogs API client.';
	if (!looksLikeClientID(trimmed)) {
		return 'That does not look like a client ID — it should be a UUID, like 01234567-89ab-7cde-8f01-23456789abcd. If you copied a long string of letters and digits, that is the client secret: this app never uses one, so leave it where it is.';
	}
	return true;
}
