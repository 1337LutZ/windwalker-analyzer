// The `unslop` banned-phrase scan, run against every string a reader can meet.
//
// `docs/report-register.md` §10 names the three scanners whose output is interpretable on this corpus
// and rules out the other two: at these lengths `voice_score.py` tracks document length rather than
// authorship, and `voice_card.py --coverage` misclassifies this author's own corrections. Of the three
// that survive, this is the only one that returns a verdict rather than a measurement. Readability and
// structure produce numbers a person has to read; this produces a count that should be zero.
//
// **It is a gate rather than a census because the number is already zero.** Measured 2026-08-29 across
// all 1,787 strings of both locale files, with `--include-quoted` so the quoted spans the scanner skips
// by default are swept too: no violations, hard or soft. A rule pinned at its passing value costs
// nothing to keep and refuses the first regression.
//
// ## Why this skips instead of failing when the tool is absent
//
// The skill is vendored and **gitignored** — `skills-lock.json` pins its source and hash so a
// contributor can reinstall it, but a fresh clone does not have it and neither does CI. A gate that
// failed there would be a gate everybody learns to ignore, and one that silently passed would be worse:
// the run would go green having scanned nothing. So it skips loudly, and the non-vacuity assertions
// below make sure a *present* scanner is actually working before its zero is believed.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');
const SCANNER = resolve(ROOT, '.claude/skills/unslop/scripts/banned_phrase_scan.py');
const LOCALES = ['src/locales/en/report.json', 'src/locales/en/ui.json'];

/** Whether the vendored skill and a Python to run it are both here. */
const available = ((): boolean => {
	if (!existsSync(SCANNER)) return false;
	try {
		execFileSync('python3', ['--version'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
})();

interface Violation {
	phrase?: string;
	severity?: string;
	line?: number;
}

interface Report {
	total_violations: number;
	violations: Violation[];
}

/**
 * A placeholder is rendered as its own name rather than as a value.
 *
 * `{{share, percent}}` becomes `share`. Substituting a literal instead — `12`, say — invents sentence
 * openers that are not in the copy: measured, rendering every placeholder as `12` put 42 sentences on
 * the same two words and moved the structure scanner's opener statistics on its own. The name is the
 * closest thing to a word the reader will see there.
 */
const render = (value: string): string =>
	value.replaceAll(/\{\{\s*([A-Za-z0-9_]+)[^}]*\}\}/g, (_, name: string) => name);

/** Every leaf string of one locale file, in file order. */
function leaves(file: string): string[] {
	const out: string[] = [];
	const walk = (node: unknown): void => {
		if (typeof node === 'string') out.push(render(node));
		else if (node !== null && typeof node === 'object') for (const value of Object.values(node)) walk(value);
	};
	walk(JSON.parse(readFileSync(resolve(ROOT, file), 'utf8')));
	return out;
}

/**
 * Run the scanner over a block of text and hand back its report.
 *
 * **A non-zero exit is a finding, not a failure**, and reading it as one cost this file its first run.
 * The scanner exits 1 when it flags something and 0 when it does not, which is correct for a tool meant
 * to be a gate in a shell, and it means `execFileSync` throws on exactly the case the probe below is
 * built to produce. The report is on `stdout` either way, so that is what is read.
 */
function scan(text: string): Report {
	const dir = mkdtempSync(join(tmpdir(), 'unslop-'));
	const path = join(dir, 'copy.txt');
	writeFileSync(path, text);
	// `--include-quoted` because the default skips quoted spans and markdown blockquotes, and this copy
	// has both: a rule that skipped them would be enforcing less than it appears to.
	const args = [SCANNER, path, '--include-quoted'];
	try {
		return JSON.parse(execFileSync('python3', args, { encoding: 'utf8' })) as Report;
	} catch (error) {
		const stdout = (error as { stdout?: string }).stdout;
		// A throw with no report on it is a real failure: the interpreter, the path, or the script itself.
		if (stdout === undefined || stdout.trim() === '') throw error;
		return JSON.parse(stdout) as Report;
	}
}

describe.skipIf(!available)('the unslop banned-phrase scan, over both locale files', () => {
	/**
	 * The scanner fires on prose it should refuse, before its silence on ours is believed.
	 *
	 * **This is the assertion that makes the zero below mean anything.** A wrong path, a changed output
	 * shape or a scanner that has quietly stopped matching all produce `total_violations: 0`, which is
	 * indistinguishable from clean copy. `robust` is used because it is confirmed to trip the current
	 * list; if a future version drops it this test fails loudly rather than going vacuous, which is the
	 * correct direction for a probe to break in.
	 */
	it('refuses prose it is supposed to refuse', () => {
		const found = scan('It is worth noting that we should delve into this robust and seamless solution.');
		expect(found.total_violations).toBeGreaterThan(0);
		expect(found.violations.map((violation) => violation.phrase)).toContain('robust');
	});

	it('finds nothing in any string a reader can meet', () => {
		const strings = LOCALES.flatMap((file) => leaves(file));
		// Non-vacuity of the other half: a walker that returned nothing would pass the scan for ever.
		expect(strings.length).toBeGreaterThan(1500);

		const found = scan(strings.join('\n\n'));
		expect(
			found.violations.map((violation) => `${violation.severity ?? '?'}: ${violation.phrase ?? '?'}`),
			'`unslop` flagged copy a reader can meet. Rewrite the string; do not add an exception here.',
		).toEqual([]);
		expect(found.total_violations).toBe(0);
	});
});

/**
 * Said out loud rather than left as an absent suite.
 *
 * A skipped block is invisible in a passing run, so the one thing a reader of this file needs — whether
 * the gate ran at all — would be findable only by counting tests. This always runs and names the state.
 */
describe('the scanner itself', () => {
	it('is either present and enforced, or absent and reported', () => {
		if (!available) {
			console.warn(
				`[bannedPhrases] skipped: no scanner at ${SCANNER.replace(ROOT, '.')}, or no python3 on PATH.\n` +
					`The unslop skill is gitignored; reinstall it from the source pinned in skills-lock.json to run this gate.`,
			);
		}
		expect(typeof available).toBe('boolean');
	});
});
