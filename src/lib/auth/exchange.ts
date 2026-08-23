// Step 3 of the flow: trade the authorization code for an access token.
//
// Five form fields and no credentials of any kind. There is no `Authorization` header and no client
// secret — the verifier is what proves this is the same client that started the sign-in, and it is
// the only thing here that has to stay private. A `URLSearchParams` body also keeps this a "simple"
// CORS request, so it goes out without a preflight.

import { i18n } from '~/lib/i18n';

import { WCL_TOKEN_URL, redirectUri, requireClientID } from './config';

/** The shell copy, off the instance: no component here either. See `wcl/client.ts` for the reasoning. */
const t = (key: string, values?: Record<string, unknown>): string => i18n.t(key, { ns: 'ui', ...values });

/** A stuck request would otherwise leave the page saying "Signing in…" until someone reloads it. */
const REQUEST_TIMEOUT_MS = 30_000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

/**
 * WarcraftLogs reports a refusal as `{ error, error_description }`, sometimes with HTTP 200.
 *
 * A builder rather than a message, so it takes two keys and not one: WarcraftLogs' own description is
 * preferred whenever it sent one, and what stands in for it is either the error code it named or the
 * status it answered with. Writing those two as one string would put a `null` in front of a reader.
 */
function describeRefusal(payload: unknown, status: number): string {
	const error = isRecord(payload) && typeof payload['error'] === 'string' ? payload['error'] : null;
	const detail =
		isRecord(payload) && typeof payload['error_description'] === 'string' ? payload['error_description'] : null;
	if (detail !== null) return detail;
	if (error !== null) return t('errors.signIn.refused', { error });
	return t('errors.signIn.refusedStatus', { status });
}

export async function exchangeCode({ code, verifier }: { code: string; verifier: string }): Promise<string> {
	const body = new URLSearchParams({
		client_id: requireClientID(),
		code_verifier: verifier,
		redirect_uri: redirectUri(),
		grant_type: 'authorization_code',
		code,
	});

	const abort = new AbortController();
	const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);

	let response: Response;
	try {
		response = await fetch(WCL_TOKEN_URL, {
			method: 'POST',
			body,
			signal: abort.signal,
		});
	} catch {
		// Two keys at one throw site, for the same reason `wcl/client.ts` reads two here: a request that
		// timed out and one that never left the machine send the reader to different fixes.
		throw new Error(
			abort.signal.aborted
				? t('errors.signIn.timeout', { seconds: REQUEST_TIMEOUT_MS / 1000 })
				: t('errors.signIn.unreachable'),
		);
	} finally {
		clearTimeout(timer);
	}

	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		throw new Error(t('errors.signIn.notJson', { status: response.status }));
	}

	if (!response.ok || (isRecord(payload) && typeof payload['error'] === 'string')) {
		throw new Error(describeRefusal(payload, response.status));
	}

	const token = isRecord(payload) ? payload['access_token'] : null;
	if (typeof token !== 'string' || token === '') {
		throw new Error(t('errors.signIn.noAccessToken'));
	}
	return token;
}
