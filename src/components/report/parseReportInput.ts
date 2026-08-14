export interface ParsedReportInput {
	code: string | null;
	fightID: number | null;
	sourceID: number | null;
}

/** The same thing once validation has established there is a code in it. */
export type ResolvedReportInput = ParsedReportInput & { code: string };

/**
 * Anything relative — `reports/abc?fight=3` — needs a base to become a `URL`. The host is never read
 * back out, so which one it is does not matter; it only has to exist.
 */
const BASE = 'https://classic.warcraftlogs.com/';

/**
 * A report code on its own. The optional `a:` marks an **anonymous** report and is part of the code:
 * the API answers "This report does not exist." for the same code without it.
 */
const BARE_CODE = /^(?:a:)?[a-zA-Z0-9]{12,}$/;

/** The code as it appears in a report URL's path. `:` is legal in a path segment and survives. */
const CODE_IN_PATH = /\/reports\/((?:a:)?[a-zA-Z0-9]+)/;

function asUrl(text: string): URL | null {
	try {
		return new URL(text, BASE);
	} catch {
		return null;
	}
}

function asID(value: string | null): number | null {
	return value !== null && /^\d+$/.test(value) ? Number(value) : null;
}

/**
 * Accepts a bare report code or anything copied out of the WarcraftLogs address bar.
 *
 * Parsing goes through `URL`/`URLSearchParams` rather than hand-cut string offsets, so the query and
 * the fragment are separated by the same rules the browser uses. WarcraftLogs writes the selected
 * fight both ways and both are valid links to share: `?fight=30` in the query, `#fight=30` in the
 * fragment. The fragment wins when a URL carries both, because WarcraftLogs rewrites it as you click
 * around inside a report and it is therefore the fresher record of where the reader was.
 *
 * The bare-code case is settled **before** `new URL`, and not for tidiness: `a:6MhZgjyAknFWrYfK`
 * parses as a URL with the scheme `a:` and the path `6MhZgjyAknFWrYfK`, so handing an anonymous code
 * straight to the parser silently truncates it to something that is not a report.
 */
export function parseReportInput(raw: string): ParsedReportInput {
	const text = raw.trim();

	if (BARE_CODE.test(text)) return { code: text, fightID: null, sourceID: null };

	const url = asUrl(text);
	if (url === null) return { code: null, fightID: null, sourceID: null };

	// `url.hash` keeps its leading `#`, which URLSearchParams would otherwise read as part of the
	// first key.
	const fragment = new URLSearchParams(url.hash.slice(1));
	const param = (key: string): string | null => fragment.get(key) ?? url.searchParams.get(key);

	return {
		code: CODE_IN_PATH.exec(url.pathname)?.[1] ?? null,
		fightID: asID(param('fight')),
		sourceID: asID(param('source')),
	};
}
