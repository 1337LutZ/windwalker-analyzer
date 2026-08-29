// The em-dash rules `docs/conventions.md` states, applied to both places this repository writes prose.
//
// **There are two rules now, and they are different numbers.** Reader-facing copy carries none: the
// override that kept the dash was reversed on 2026-08-28, when `docs/report-register.md` §7 — the
// measured record of how this project's author writes — won against it. Docblocks and comments keep the
// dash under a ceiling of two, because no reader meets them.
//
// **The copy gate is the one that was missing.** For as long as the override stood, nothing failed when
// a dash entered `report.json`; `i18n/__tests__/conventionsCensus.test.ts` counted them and had no
// opinion, by design. So the retirement removed 288 dashes from `report.json` and 24 from `ui.json` with
// no guard behind it, and the 289th would have arrived unremarked. That is what the first describe below
// is for. It is a gate rather than a census for the same reason the ceiling is: zero is countable.
//
// **The docblocks are where most of this repository's prose actually is, and nothing measured them.**
// The locale carries about 22,000 words; the comments carry more, they are written in the same voice by
// the same hands, and a reviewer reading a docblock has no way to tell whether the rule applies to it.
// It does, and the ceiling is the form it takes there.
//
// Rhythm is still ungated for the reason `conventions.md` gives — a gate could not tell a 40-word
// sentence that earns its length from one that does not — and that reasoning does not reach either rule
// here. A dash in a string is countable, and the document already says what to do about it.

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');

/** The ceiling, as `docs/conventions.md` states it. Read from the document below, not trusted from here. */
const CEILING = 2;

/**
 * The comment prose of one source file, as blocks — a `/** *\/` docblock, or an unbroken run of `//`.
 *
 * Blocks rather than one string per file, because a sentence cannot run from the foot of one docblock
 * into the head of the next. Flattening a file first is how a naive count reports three em-dashes in a
 * "sentence" assembled out of two unrelated comments, which is the false positive this shape exists to
 * avoid — it is the one the first draft of this guard produced.
 */
function commentBlocks(source: string): string[] {
	const blocks: string[] = [];
	for (const match of source.matchAll(/\/\*\*([\s\S]*?)\*\//g)) {
		blocks.push(match[1]!.replaceAll(/^[ \t]*\*[ \t]?/gm, ''));
	}
	let run: string[] = [];
	for (const line of source.split('\n')) {
		const trimmed = line.trim();
		if (trimmed.startsWith('//')) {
			run.push(trimmed.replace(/^\/\/[ \t]?/, ''));
			continue;
		}
		if (run.length > 0) blocks.push(run.join('\n'));
		run = [];
	}
	if (run.length > 0) blocks.push(run.join('\n'));
	return blocks;
}

/**
 * The sentences of one block, with the furniture taken out.
 *
 * A docblock in this tree holds more than sentences: markdown headings, bullet lists, `@param` tags, and
 * indented figure blocks — the measured tables the house style prints results in. None of those is a
 * sentence, and every one of them will merge with its neighbours into a run of text carrying three
 * em-dashes that no reader ever met as one sentence. So they are dropped, and paragraphs are split on
 * the blank line rather than joined across it.
 *
 * The sentence split itself is the census's own — `(?<=[.!?])\s+` — so the two agree about where a
 * sentence ends, and a change to one is a visible change to the other.
 *
 * Inline code spans come out first. A dash inside backticks is quoted source, a rendered string or a
 * shell line, and the ceiling is a rule about prose punctuation: counting `` `a — b` `` against a
 * sentence's budget would charge an author for a character they are reporting rather than writing.
 */
function sentences(block: string): string[] {
	const paragraphs = block.split(/\n[ \t]*\n/);
	const out: string[] = [];
	for (const paragraph of paragraphs) {
		const kept = paragraph
			.replaceAll(/``[^`]*``|`[^`]*`/g, 'CODE')
			.split('\n')
			.filter((line) => {
				const trimmed = line.trim();
				if (trimmed === '') return false;
				// Headings, bullets and JSDoc tags.
				if (/^(#{1,6}\s|[-*]\s|\|)/.test(trimmed)) return false;
				if (/^@\w+/.test(trimmed)) return false;
				// A figure block: indented from the paragraph, or holding aligned columns.
				if (/^ {4,}/.test(line)) return false;
				if (/\S {2,}\S/.test(trimmed)) return false;
				return true;
			})
			.join(' ');
		for (const sentence of kept.split(/(?<=[.!?])\s+/)) {
			if (sentence.trim() !== '') out.push(sentence.trim());
		}
	}
	return out;
}

/**
 * Every `.ts`/`.tsx` under `src` — the guard's subject is the prose, not one directory of it.
 *
 * Walked rather than listed, for the reason `analysis/fixtures.ts` walks its directories: a listed set
 * has to be edited by whoever adds the next file, and that is the same person who would forget. A file
 * missed here is not a failure anyone sees.
 */
const sourceFiles = (dir = 'src'): string[] =>
	readdirSync(resolve(ROOT, dir), { withFileTypes: true })
		.sort((a, b) => (a.name < b.name ? -1 : 1))
		.flatMap((entry) =>
			entry.isDirectory()
				? sourceFiles(`${dir}/${entry.name}`)
				: /\.tsx?$/.test(entry.name)
					? [`${dir}/${entry.name}`]
					: [],
		);

interface Over {
	file: string;
	dashes: number;
	sentence: string;
}

const overCeiling = (): Over[] => {
	const found: Over[] = [];
	for (const file of sourceFiles()) {
		// This file's own fixtures are comment syntax inside string literals, and the extractor above is a
		// pair of regexes rather than a TypeScript parser: it cannot tell a docblock from a docblock being
		// quoted. Skipping one file is honest where teaching it to parse TypeScript would not be worth it —
		// and the fixtures the skip costs are asserted directly in the last test instead.
		if (file === 'src/__tests__/proseDashes.test.ts') continue;
		const source = readFileSync(resolve(ROOT, file), 'utf8');
		for (const block of commentBlocks(source)) {
			for (const sentence of sentences(block)) {
				const dashes = [...sentence].filter((c) => c === '—').length;
				if (dashes > CEILING) found.push({ file, dashes, sentence });
			}
		}
	}
	return found;
};

/**
 * The one string allowed to carry an em dash, and why it is not prose.
 *
 * A table cell with no value renders `—`. That is a typographic glyph standing where a number would be,
 * the same exemption `docs/labels-and-figures.md` gives labels: "a value in a table cell, an axis label
 * or a KPI tile is not a sentence". Named here rather than pattern-matched, so adding a second one is a
 * decision somebody has to write down.
 */
const DASH_EXEMPT = ['energizingBrew.cells.noReadings'];

const localeLeaves = (file: string): [string, string][] => {
	const out: [string, string][] = [];
	const walk = (node: unknown, path: string[]) => {
		if (typeof node === 'string') return void out.push([path.join('.'), node]);
		if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, [...path, k]);
	};
	walk(JSON.parse(readFileSync(resolve(ROOT, file), 'utf8')), []);
	return out;
};

describe('the em dash is retired from reader-facing copy', () => {
	it('is the rule docs/conventions.md states, read from the document', () => {
		// Same discipline as the ceiling below: the rule lives in the document, and this reads it there.
		// If the retirement is ever reversed, this fails and names the sentence that has to change.
		const conventions = readFileSync(resolve(ROOT, 'docs/conventions.md'), 'utf8');
		expect(
			/\*\*The em-dash is retired from reader-facing copy/.test(conventions),
			'docs/conventions.md no longer states the em-dash retirement, so this gate has no rule to enforce.\n' +
				'Restore the sentence, or delete this describe and say in the document that copy is unenforced.',
		).toBe(true);
	});

	it('holds in every string of both locale files', () => {
		const carrying = ['src/locales/en/report.json', 'src/locales/en/ui.json']
			.flatMap((file) => localeLeaves(file))
			.filter(([key, value]) => value.includes('—') && !DASH_EXEMPT.includes(key));
		expect(
			carrying.map(([key, value]) => `${key}: ${value.slice(0, 120)}`),
			`${carrying.length} string(s) carry an em dash.\n\n` +
				'docs/report-register.md §7: the dash is not used in this register, and the sentence is\n' +
				'restructured instead. A comma, a colon, a full stop or parentheses will each do it.\n',
		).toEqual([]);
	});

	it('is measuring something, and is measuring copy rather than the file', () => {
		// Non-vacuity, the same guard the ceiling carries. A leaf-walker that returned nothing would pass
		// the assertion above by having no subject.
		const leaves = ['src/locales/en/report.json', 'src/locales/en/ui.json'].flatMap(localeLeaves);
		expect(leaves.length).toBeGreaterThan(1500);
		expect(leaves.filter(([, v]) => v.split(' ').length > 20).length).toBeGreaterThan(200);
	});

	it('names an exemption that exists, so the list cannot rot', () => {
		const keys = new Set(localeLeaves('src/locales/en/report.json').map(([k]) => k));
		for (const key of DASH_EXEMPT) expect(keys, key).toContain(key);
	});
});

describe('the em-dash ceiling, over the tree’s own docblocks', () => {
	it('is the ceiling docs/conventions.md states, read from the document', () => {
		// The number lives in one place. A guard carrying its own copy of a rule is a second rule, and the
		// day the document relaxes to three this would go on failing and nobody would know which to believe.
		const conventions = readFileSync(resolve(ROOT, 'docs/conventions.md'), 'utf8');
		const stated = /\*\*Ceiling of (\w+) in one sentence\.\*\*/.exec(conventions)?.[1];
		expect(
			stated,
			'docs/conventions.md no longer states the em-dash ceiling, so this guard has no rule to enforce.\n' +
				'Restore the sentence, or delete this file and say in the document that the ceiling is unenforced.',
		).toBe('two');
	});

	it('holds in every docblock and comment in the tree', () => {
		const over = overCeiling();
		expect(
			over.map(({ file, dashes, sentence }) => `${file} [${dashes}] ${sentence.slice(0, 160)}`),
			`${over.length} sentence(s) carry more than ${CEILING} em-dashes.\n\n` +
				`docs/conventions.md: "Ceiling of two in one sentence. Nothing reaches three today, and a\n` +
				`sentence that wants three is two sentences." Split it, or turn one pair into parentheses,\n` +
				`which is what the dash was standing in for.\n`,
		).toEqual([]);
	});

	it('is measuring something, and is measuring sentences rather than files', () => {
		// Non-vacuity. A stripper that dropped every line would satisfy the assertion above by having no
		// subject, which is the failure this whole family of guards keeps being written to avoid.
		const files = sourceFiles();
		expect(files.length).toBeGreaterThan(400);
		const all = files.flatMap((file) =>
			commentBlocks(readFileSync(resolve(ROOT, file), 'utf8')).flatMap((block) => sentences(block)),
		);
		expect(all.length).toBeGreaterThan(15_000);
		// And the dash it counts is present in the corpus at the rate the document claims, so a guard that
		// counted the wrong character would not pass by finding nothing.
		expect(all.filter((sentence) => sentence.includes('—')).length).toBeGreaterThan(1000);
	});

	it('counts a three-dash sentence and does not invent one across a blank line', () => {
		const one = '/** a — b — c — d */';
		expect(sentences(commentBlocks(one)[0]!).map((s) => [...s].filter((c) => c === '—').length)).toEqual([3]);
		// Two paragraphs, two dashes each: four in the block and never three in a sentence.
		const two = '/**\n * a — b — c.\n *\n * d — e — f.\n */';
		expect(sentences(commentBlocks(two)[0]!).map((s) => [...s].filter((c) => c === '—').length)).toEqual([2, 2]);
		// Two adjacent docblocks, likewise: the flattening bug this shape exists to prevent.
		const apart = '/** a — b. */\nconst x = 1;\n/** c — d. */';
		expect(commentBlocks(apart)).toHaveLength(2);
		// And a figure block is furniture, not a sentence.
		const table = '/**\n * The reading:\n *\n *     one — 1   two — 2   three — 3\n */';
		expect(sentences(commentBlocks(table)[0]!)).toEqual(['The reading:']);
	});
});
