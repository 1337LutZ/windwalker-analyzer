// The PKCE proof, per RFC 7636.
//
// The verifier is the secret. It is generated here, kept in this tab, and shown to no one until it
// is traded for a token; only its SHA-256 hash travels to WarcraftLogs. That is the whole trick —
// an authorization code intercepted on its way back is worthless without the verifier that was
// never sent anywhere.

/** RFC 7636 §4.1: `unreserved = ALPHA / DIGIT / "-" / "." / "_" / "~"`. 66 characters. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

/** Comfortably inside the permitted 43–128, and short enough to keep the authorize URL sane. */
const VERIFIER_LENGTH = 64;

const STATE_LENGTH = 32;

/**
 * Uniform over the alphabet, which `byte % 66` on its own would not be: 256 is not a multiple of 66,
 * so the first 58 characters would come up slightly more often than the last 8. Bytes past the last
 * whole multiple are discarded rather than folded in, and more are drawn to make up the shortfall.
 */
function randomString(length: number): string {
	const limit = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
	let out = '';
	while (out.length < length) {
		const bytes = new Uint8Array(length - out.length);
		crypto.getRandomValues(bytes);
		for (const byte of bytes) {
			if (byte >= limit) continue;
			out += ALPHABET.charAt(byte % ALPHABET.length);
		}
	}
	return out;
}

/** The secret half of the proof. Never leaves this tab except in the token exchange body. */
export function createVerifier(): string {
	return randomString(VERIFIER_LENGTH);
}

/**
 * The blob handed to WarcraftLogs and handed back on the callback. It proves the callback answers a
 * sign-in this tab started, rather than a link someone else built.
 */
export function createState(): string {
	return randomString(STATE_LENGTH);
}

/** base64url of the SHA-256 of the verifier: `+` and `/` swapped out, padding removed. */
export async function challengeFor(verifier: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
	let binary = '';
	for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
