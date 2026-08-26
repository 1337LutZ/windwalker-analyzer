import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const copy = JSON.parse(
	readFileSync(resolve(import.meta.dirname, '../../../locales/en/report.json'), 'utf8'),
) as Record<string, unknown>;

/** `{{name}}` or `{{name, formatter}}`, capturing both halves. */
const INTERPOLATION = /\{\{\s*([a-zA-Z0-9_]+)\s*(?:,\s*([a-zA-Z]+)\s*)?\}\}/g;

function strings(node: unknown, path: string[] = []): Array<{ key: string; text: string }> {
	if (typeof node === 'string') return [{ key: path.join('.'), text: node }];
	if (node !== null && typeof node === 'object') {
		return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => strings(v, [...path, k]));
	}
	return [];
}

/**
 * A number reaches the page through a formatter or it reaches it raw, and raw is how a catch rate
 * printed as `44.44444444444444%`.
 *
 * The regression this exists for: percentages are stored on the `Analysis` as the full quotient —
 * deliberately, because how many decimals to show is a display question and `Intl.NumberFormat`
 * answers it in one place. Copy that interpolates such a value with `{{value}}` and writes its own
 * `%` sign therefore prints every digit the division produced. The fix is `{{value, percent}}`, which
 * also writes the sign, so the literal one has to go with it.
 *
 * Structural rather than a list of known keys: a new string with a hand-written `%` should fail this
 * the day it is added, not the day someone reads the rendered page.
 */
describe('percentages in the copy', () => {
	it('never writes its own per-cent sign after a bare interpolation', () => {
		const offenders: string[] = [];
		for (const { key, text } of strings(copy)) {
			for (const match of text.matchAll(INTERPOLATION)) {
				const [whole, , formatter] = match;
				if (formatter !== undefined) continue;
				const after = text.slice((match.index ?? 0) + whole.length);
				// A `%` immediately after an unformatted value is the shape of the bug: the number arrives
				// with every decimal it was divided into, and the sign is written by hand beside it.
				if (/^\s*%/.test(after)) offenders.push(`${key}: ${whole}%`);
			}
		}
		expect(offenders, 'use {{value, percent}} — the formatter writes the sign too').toEqual([]);
	});

	it('formats every value in the summary takeaways', () => {
		// The takeaway cards read metric values straight off the scorecard, which holds them unrounded.
		// There is no case there where a bare interpolation of a *value* is right.
		//
		// `cooldown` is not one. It carries the raid's haste cooldown by the name this pull's raid used —
		// Bloodlust, Heroism, Time Warp — so that `fireElementalHasteUptime` names the window it grades
		// instead of calling it "the haste cooldown" at a reader looking at a fight where somebody pressed
		// a particular button. An ability name has nothing to round and no formatter to reach for, and it
		// comes off `AuraWindow.variant` rather than out of the locale, which is the same rule every other
		// ability name on the page follows.
		const NAMES = new Set(['cooldown']);
		const takeaways = strings((copy['summary'] as Record<string, unknown>)['takeaways']);
		const bare = takeaways.flatMap(({ key, text }) =>
			[...text.matchAll(INTERPOLATION)]
				.filter((m) => m[2] === undefined && !NAMES.has((m[1] ?? '').trim()))
				.map((m) => `${key}: ${m[0]}`),
		);
		expect(bare).toEqual([]);
	});

	it('only names formatters that exist', () => {
		// A typo in a formatter name does not throw — i18next quietly prints the raw value — so the set
		// is checked against the one the config registers.
		const known = new Set([
			'percent',
			'integer',
			'decimal',
			'compact',
			'clock',
			'duration',
			'seconds',
			'gap',
			'millis',
		]);
		const unknown = new Set<string>();
		for (const { text } of strings(copy)) {
			for (const match of text.matchAll(INTERPOLATION)) {
				const formatter = match[2];
				if (formatter !== undefined && !known.has(formatter)) unknown.add(formatter);
			}
		}
		expect([...unknown]).toEqual([]);
	});
});
