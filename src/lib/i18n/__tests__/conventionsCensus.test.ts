// The figures `docs/conventions.md` prints are the figures this tree produces.
//
// **This is not the gate that file refuses, and the difference is the whole reason this can exist.**
// `conventions.md` declines to gate sentence rhythm: "No gate, because a gate's honest floor is
// today's number, which makes it a budget rather than a standard, and because it could not tell a
// 40-word sentence that earns its length from one that does not." That refusal is about the *copy* —
// it would fail a locale string for being long. This test cannot fail a string for anything. It has
// no floor, no ceiling and no opinion about the median: if the median moves from 17 to 40 it goes
// green the moment the paragraph says 40. What it fails is a *sentence in the documentation that is
// false*. The paragraph makes a factual claim about this tree, and that claim has been wrong four
// times — most recently reading 1,064 sentences and 258 em-dashes against a tree already holding
// 1,077 and 262, with not a word of copy touched between the two.
//
// Read that again before deleting this, because deleting it is the obvious move for someone who
// remembers the refusal and not the distinction. A standard says what the copy *should be*, and
// reasonable people disagree about it. This says what the document claims the copy *is*, and there
// is exactly one right answer. Only the second one is checkable, and it is the one the repo keeps
// getting wrong.
//
// **The numbers come out of the doc's own block, not a mirror of it here.** `conventions.md` already
// tracks how these implementations multiply — it tells the next lane to reuse `readerVoice.test.ts`'s
// stripper "rather than writing a third". A TypeScript re-implementation of the census would be that
// third, and the first time it disagreed with the Python by one, the reader would be told to re-run a
// block whose output the test then rejected. So this extracts the block from the markdown and runs
// it. There is one census, it lives in the document, and the document is what it measures.
//
// **Every figure in the paragraph, not the four that have drifted.** The leaf counts, the
// percentiles, the em-dashes and the quote lines sit inside one sentence, and a reader cannot see
// which half is held. A guard over part of it is worse than none: it lends the unguarded half a
// credibility it has not earned. The cost is a red on most copy edits, and that cost is the point —
// clearing it means re-running the whole block, which is the instruction the paragraph has been
// giving, unsuccessfully, since it was written.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../../../..');
const CONVENTIONS = resolve(ROOT, 'docs/conventions.md');

/** The census block, as fenced in the document. The first and last lines are the heredoc wrapper. */
const BLOCK = /```python\n# python3 - <<'EOF'\n([\s\S]*?)\n# EOF\n```/;

/**
 * The paragraph the block's output is pasted into, fenced by comments the document carries. The
 * opening one carries its own explanation for whoever is editing the file, so anything up to that
 * comment's `-->` is the marker rather than the paragraph.
 */
const FIGURES = /<!-- census:figures[\s\S]*?-->([\s\S]*?)<!-- \/census:figures -->/;

/**
 * Every number the block prints, with the pattern that finds it in the pasted paragraph and the
 * pattern that finds it in a fresh run. One capture group each, and both sides are searched against
 * whitespace-collapsed text so a reflowed paragraph is not a failure.
 *
 * A figure that matches on neither side is a failure in itself — see the non-vacuity block at the
 * foot. That is the failure mode this kind of guard dies of: the paragraph gets reworded, the parse
 * quietly finds nothing, and a test whose whole subject is a dozen numbers passes against zero of
 * them.
 */
const CENSUS: readonly { readonly name: string; readonly doc: RegExp; readonly tree: RegExp }[] = [
	{ name: 'leaves, both files', doc: /prints ([\d,]+) leaves/, tree: /both files: ([\d,]+) leaves/ },
	{ name: 'prose strings, both files', doc: /leaves, ([\d,]+) prose,/, tree: /leaves, ([\d,]+) prose,/ },
	{ name: 'prose words, both files', doc: /prose, ([\d,]+) words/, tree: /prose, ([\d,]+) words/ },
	{ name: 'words/string median', doc: /words; median ([\d,]+),/, tree: /median ([\d,]+) p75/ },
	{ name: 'words/string p75', doc: /p75 ([\d,]+)/, tree: /p75 ([\d,]+)/ },
	{ name: 'words/string p90', doc: /p90 ([\d,]+)/, tree: /p90 ([\d,]+)/ },
	{ name: 'words/string p95', doc: /p95 ([\d,]+)/, tree: /p95 ([\d,]+)/ },
	{ name: 'words/string p99', doc: /p99 ([\d,]+)/, tree: /p99 ([\d,]+)/ },
	{ name: 'words/string max', doc: /max ([\d,]+)/, tree: /max ([\d,]+)/ },
	{ name: 'share carried by longest 9%', doc: /longest 9% carry ([\d,]+)%/, tree: /longest 9% carry ([\d,]+)%/ },
	{
		name: 'prose leaves, report.json',
		doc: /report\.json ([\d,]+) prose leaves/,
		tree: /report\.json: ([\d,]+) prose leaves/,
	},
	{ name: 'sentences, report.json', doc: /prose leaves, ([\d,]+) sentences/, tree: /prose leaves, ([\d,]+) sentences/ },
	{ name: 'sentence median', doc: /sentences, median ([\d,]+),/, tree: /median ([\d,]+) words,/ },
	{ name: 'sentences past 25', doc: /median [\d,]+, ([\d,]+) past 25/, tree: /([\d,]+) past 25/ },
	{ name: 'share past 25', doc: /past 25 \(([\d.]+)%\)/, tree: /past 25 \(([\d.]+)%\)/ },
	{ name: 'em-dashes', doc: /([\d,]+) em-dashes/, tree: /em-dashes ([\d,]+),/ },
	{ name: 'sentences carrying an em-dash', doc: /em-dashes in ([\d,]+) sentences/, tree: /in ([\d,]+) sentences/ },
	{ name: 'share carrying an em-dash', doc: /sentences \(([\d.]+)%\)/, tree: /sentences \(([\d.]+)%\)/ },
	{
		name: 'strings with a straight apostrophe',
		doc: /([\d,]+) \/ [\d,]+ \/ [\d,]+ \/ [\d,]+ on the quote lines/,
		tree: /straight apostrophe: ([\d,]+) strings/,
	},
	{
		name: 'strings with a curly apostrophe',
		doc: /[\d,]+ \/ ([\d,]+) \/ [\d,]+ \/ [\d,]+ on the quote lines/,
		tree: /curly apostrophe: ([\d,]+) strings/,
	},
	{
		name: 'strings with a straight double quote',
		doc: /[\d,]+ \/ [\d,]+ \/ ([\d,]+) \/ [\d,]+ on the quote lines/,
		tree: /straight double: ([\d,]+) strings/,
	},
	{
		name: 'strings with a curly double quote',
		doc: /[\d,]+ \/ [\d,]+ \/ [\d,]+ \/ ([\d,]+) on the quote lines/,
		tree: /curly double: ([\d,]+) strings/,
	},
];

const flat = (text: string): string => text.replaceAll(/\s+/g, ' ').trim();

/** `21,725` and `21725` are the same figure; the guard is about the value, not the typography. */
const read = (source: string, pattern: RegExp): number | undefined => {
	const hit = pattern.exec(source)?.[1];
	return hit === undefined ? undefined : Number(hit.replaceAll(',', ''));
};

const section = (markdown: string, pattern: RegExp, what: string): string => {
	const hit = pattern.exec(markdown)?.[1];
	if (hit === undefined) {
		throw new Error(
			`docs/conventions.md no longer contains ${what}, so nothing can be checked against it.\n` +
				`Restore it, or delete this test and say in the document that its figures are unverified.`,
		);
	}
	return hit;
};

const RERUN =
	`  sed -n "/^# python3 - <<'EOF'$/,/^# EOF$/p" docs/conventions.md | sed '1d;$d' | python3\n` +
	`\nRe-run it from the repo root, then paste every number it prints back into the paragraph\n` +
	`between the <!-- census:figures --> comments — all of them, not only the rows above. That\n` +
	`paragraph is one measurement taken on one day, and taking half of it again is how the count\n` +
	`came to read 270 against a tree holding 257.\n`;

describe('the census in docs/conventions.md', () => {
	it('prints the figures this tree currently produces', () => {
		const markdown = readFileSync(CONVENTIONS, 'utf8');
		const block = section(markdown, BLOCK, "the fenced `python3 - <<'EOF'` census block");
		const paragraph = flat(section(markdown, FIGURES, 'the <!-- census:figures --> paragraph'));

		let printed: string;
		try {
			printed = execFileSync('python3', ['-'], { input: block, cwd: ROOT, encoding: 'utf8' });
		} catch (error) {
			throw new Error(
				`The census block in docs/conventions.md did not run, so its figures cannot be checked.\n` +
					`If python3 is missing, the document's own instruction to re-run the block is unavailable\n` +
					`too, which is why this fails rather than skips.\n\n${String(error)}`,
			);
		}
		const tree = flat(printed);

		// Non-vacuity, first half: every figure has to be found on both sides. A reworded paragraph or
		// a changed `print` is a failure of this test to have a subject, and it says so rather than
		// passing over an empty comparison.
		const unparsed = CENSUS.flatMap(({ name, doc, tree: treePattern }) => [
			...(read(paragraph, doc) === undefined ? [`${name} — not found in the paragraph`] : []),
			...(read(tree, treePattern) === undefined ? [`${name} — not found in the block's output`] : []),
		]);
		expect(
			unparsed,
			`This test could not locate ${unparsed.length} of the ${CENSUS.length * 2} figures it reads, and ` +
				`a figure it cannot find is one it silently stops checking:\n\n  ${unparsed.join('\n  ')}\n\n` +
				`Either the paragraph was reworded or the block's \`print\` lines changed. Fix the patterns ` +
				`in CENSUS to match — do not delete the rows, because a row deleted here is a number in the ` +
				`document that nothing checks.`,
		).toEqual([]);

		const drifted = CENSUS.flatMap(({ name, doc, tree: treePattern }) => {
			const said = read(paragraph, doc);
			const holds = read(tree, treePattern);
			return said === holds
				? []
				: [`${name.padEnd(36)} doc ${String(said).padStart(7)}   tree ${String(holds).padStart(7)}`];
		});
		expect(
			drifted,
			`docs/conventions.md states ${drifted.length} figure(s) this tree does not produce:\n\n  ` +
				`${drifted.join('\n  ')}\n\n${RERUN}`,
		).toEqual([]);
	});

	it('is checked by a comparison that can go red', () => {
		// Non-vacuity, second half. The test above is green whenever the document is right, which is
		// indistinguishable from green because it compared nothing. So: take a real paragraph, move one
		// figure by one, and assert the comparison names that figure and only that figure.
		const paragraph = flat(
			'it prints 1377 leaves, 697 prose, 21,725 words; median 26, p75 41, p90 63, p95 77, p99 97, ' +
				'max 160; longest 9% carry 24%; report.json 635 prose leaves, 1,088 sentences, median 17, ' +
				'206 past 25 (18.9%), 261 em-dashes in 227 sentences (20.9%); 50 / 25 / 1 / 3 on the quote lines.',
		);
		const printed = flat(
			'both files: 1377 leaves, 697 prose, 21725 words\n' +
				'  words/string — median 26 p75 41 p90 63 p95 77 p99 97 max 160\n' +
				'  longest 9% carry 24% of prose words\n' +
				'report.json: 635 prose leaves, 1088 sentences\n' +
				'  median 17 words, 206 past 25 (18.9%)\n' +
				'  em-dashes 262, in 227 sentences (20.9%)\n' +
				'  straight apostrophe: 50 strings\n  curly apostrophe: 25 strings\n' +
				'  straight double: 1 strings\n  curly double: 3 strings',
		);

		// Every figure parses on both sides — the same check the real run makes, against text pinned
		// here, so a patterns-vs-document mismatch and a patterns-vs-`print` mismatch stay separable.
		expect(CENSUS.filter(({ doc }) => read(paragraph, doc) === undefined).map(({ name }) => name)).toEqual([]);
		expect(CENSUS.filter(({ tree }) => read(printed, tree) === undefined).map(({ name }) => name)).toEqual([]);

		// And exactly one of them disagrees: 261 written down against 262 measured, which is the
		// smallest version of the drift this whole test exists for.
		expect(
			CENSUS.filter(({ doc, tree }) => read(paragraph, doc) !== read(printed, tree)).map(({ name }) => name),
		).toEqual(['em-dashes']);
	});
});
