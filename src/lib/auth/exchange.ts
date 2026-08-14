// Step 3 of the flow: trade the authorization code for an access token.
//
// Five form fields and no credentials of any kind. There is no `Authorization` header and no client
// secret — the verifier is what proves this is the same client that started the sign-in, and it is
// the only thing here that has to stay private. A `URLSearchParams` body also keeps this a "simple"
// CORS request, so it goes out without a preflight.

import { WCL_TOKEN_URL, redirectUri, requireClientID } from './config';

/** A stuck request would otherwise leave the page saying "Signing in…" until someone reloads it. */
const REQUEST_TIMEOUT_MS = 30_000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

/** WarcraftLogs reports a refusal as `{ error, error_description }`, sometimes with HTTP 200. */
function describeRefusal(payload: unknown, status: number): string {
	const error = isRecord(payload) && typeof payload['error'] === 'string' ? payload['error'] : null;
	const detail =
		isRecord(payload) && typeof payload['error_description'] === 'string' ? payload['error_description'] : null;
	if (detail !== null) return detail;
	if (error !== null) return `WarcraftLogs refused the sign-in (${error}).`;
	return `WarcraftLogs refused the sign-in (HTTP ${status}).`;
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
		throw new Error(
			abort.signal.aborted
				? `WarcraftLogs did not answer within ${REQUEST_TIMEOUT_MS / 1000} seconds. Try signing in again.`
				: 'Could not reach WarcraftLogs to finish signing in. Check your connection, and whether a content blocker is stopping the request.',
		);
	} finally {
		clearTimeout(timer);
	}

	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		throw new Error(
			`WarcraftLogs answered the sign-in with something that was not JSON (HTTP ${response.status}).`,
		);
	}

	if (!response.ok || (isRecord(payload) && typeof payload['error'] === 'string')) {
		throw new Error(describeRefusal(payload, response.status));
	}

	const token = isRecord(payload) ? payload['access_token'] : null;
	if (typeof token !== 'string' || token === '') {
		throw new Error('WarcraftLogs completed the sign-in but returned no access token.');
	}
	return token;
}
