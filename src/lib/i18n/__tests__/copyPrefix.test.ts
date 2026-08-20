// The copy a component builds from a prefix prop, which no static check can see.
//
// `keys.test.ts` reads literal `t('energy.title')` calls out of the source. A generic section does
// not have those: `Resource` is one component drawing every spec's bars, so it asks for
// ``t(`${copyPrefix}.title`)`` and the prefix arrives as a prop — `energy`, `chi`, `mana`, and
// whatever the next spec's bar is called. Nothing in the suite could see those keys, so a whole
// family of copy was unverified: a bar wired up with a prefix the locale has never heard of renders
// `mana.title` as its own heading, and the section still mounts, still passes every render test, and
// still ships.
//
// Three checks, because completeness alone is not enough:
//
// 1. The table below is filed against the source. Every prefixed key `Resource` asks for has to
//    appear in exactly one profile, and every key in a profile has to be one it asks for — so a
//    template key added to the component cannot be left out of this test's own reckoning.
// 2. Every prefix in use satisfies one profile in full. Which profile is not asserted: which branch
//    a bar takes is a fact about the spec's resource config, not about its copy, and a prefix that
//    completes *some* branch is a prefix no branch can render a raw key for.
// 3. Nothing under a prefix is a key the component never asks for, which is how a typo in the JSON
//    shows up — `energy.captoin` would otherwise sit there passing check 2 by shadowing nothing.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(import.meta.dirname, '../../..');

/**
 * Read as JSON rather than through i18next, deliberately.
 *
 * The claim being tested is about the file a translator edits — that it holds a key for everything
 * the component asks for. Going through `i18n.exists` would test the runtime's fallback chain as
 * well, and a key resolving from the `ui` namespace or from a fallback language is not this test
 * passing.
 */
const COPY = JSON.parse(readFileSync(join(SRC, 'locales/en/report.json'), 'utf8')) as Record<string, unknown>;

function walk(dir: string): string[] {
	return readdirSync(dir).flatMap((entry) => {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) return entry === 'node_modules' ? [] : walk(path);
		return /\.tsx?$/.test(entry) ? [path] : [];
	});
}

const SOURCES = walk(join(SRC, 'components'))
	.concat(walk(join(SRC, 'specs')))
	.map((path) => readFileSync(path, 'utf8'));

/**
 * Every key any component builds from a `copyPrefix`, as the suffix alone.
 *
 * The closing backtick has to follow the key, so this matches a copy key and not the other
 * templates in the tree — a class list (`` `${buttonClass} px-4` ``) or a React key
 * (`` `${cap.at}-${i}` ``) both carry something after the interpolation that a dotted key path
 * cannot contain.
 */
function askedFor(): string[] {
	const keys = new Set<string>();
	for (const source of SOURCES) {
		for (const match of source.matchAll(/`\$\{copyPrefix\}\.([A-Za-z][\w.]*)`/g)) {
			if (match[1] !== undefined) keys.add(match[1]);
		}
	}
	return [...keys].sort();
}

/**
 * Every prefix a `copyPrefix` is actually given, from the section lists that pass it.
 *
 * Scanned rather than listed here, so a bar added for the next spec is checked by the fact of being
 * wired up. Both spellings, because the prop reaches the component through a config object in
 * `specSections` today and could as easily be written in JSX tomorrow.
 */
function prefixesInUse(): string[] {
	const prefixes = new Set<string>();
	for (const source of SOURCES) {
		for (const match of source.matchAll(/\bcopyPrefix(?::\s*|=)'(\w+)'/g)) {
			if (match[1] !== undefined) prefixes.add(match[1]);
		}
		for (const match of source.matchAll(/\bcopyPrefix="(\w+)"/g)) {
			if (match[1] !== undefined) prefixes.add(match[1]);
		}
	}
	return [...prefixes].sort();
}

/**
 * The keys each of `Resource`'s branches renders, filed by branch.
 *
 * Hand-written, because which keys a branch reads is a fact about the component's control flow and
 * nothing can read that off the source — but not free to drift: the first test below holds the union
 * of these three lists against the keys the component actually asks for.
 *
 * `common` is what any bar renders whatever half it is, `none` included: every branch can fall
 * through to the empty state, because a log that carried no resource samples still has to draw the
 * heading its nav link points at.
 */
const PROFILES = {
	common: ['title', 'intent', 'none', 'key.bar', 'chartLabel', 'clean', 'summary', 'resolution'],
	/** The pool half: a fault measured in seconds at the ceiling, split into engaged and downtime. */
	pool: [
		'key.lost',
		'kpi.wasted',
		'kpi.engaged',
		'summaryNoRate',
		'split',
		'wasted',
		'caption',
		'columns.at',
		'columns.held',
		'columns.where',
		'noRows',
		'where.engaged',
		'where.downtime',
	],
	/** Mana: the one pool whose fault is the floor, so it reads an empty duration and no cap table. */
	mana: ['key.empty'],
	/** The points half: a fault measured as a count of what a press threw away. */
	points: [
		'kpi.wasted',
		'kpi.spent',
		'kpi.gained',
		'key.wasted',
		'tableCaption',
		'columns.at',
		'columns.wasted',
		'noRows',
	],
} as const;

const BRANCHES = ['pool', 'mana', 'points'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

/**
 * Whether the locale holds one key under one prefix.
 *
 * A key is legitimately stored only as its suffixed variants — `split_none` / `split_some` for a
 * context, `summary_one` / `summary_other` for a count — so a leaf whose name is the key plus `_`
 * counts, which is the same rule `keys.test.ts` applies to a literal key.
 */
function has(prefix: string, key: string): boolean {
	const parts = `${prefix}.${key}`.split('.');
	const leaf = parts.pop() ?? '';
	let node: unknown = COPY;
	for (const part of parts) node = isRecord(node) ? node[part] : undefined;
	return isRecord(node) && Object.keys(node).some((k) => k === leaf || k.startsWith(`${leaf}_`));
}

/** Every key stored under a prefix, as dotted paths with any `_context` suffix taken back off. */
function storedUnder(prefix: string): string[] {
	const out = new Set<string>();
	const visit = (node: unknown, path: string) => {
		if (!isRecord(node)) {
			out.add(path.replace(/_[a-z]+$/, ''));
			return;
		}
		for (const [key, value] of Object.entries(node)) visit(value, path === '' ? key : `${path}.${key}`);
	};
	visit(COPY[prefix], '');
	return [...out].sort();
}

describe('prefixed copy families', () => {
	it('files every prefixed key the components ask for under a profile', () => {
		const asked = askedFor();
		expect(asked.length, 'no `${copyPrefix}.…` keys found — has the pattern changed?').toBeGreaterThan(10);
		const filed = [...new Set(BRANCHES.flatMap((b) => [...PROFILES.common, ...PROFILES[b]]))].sort();
		expect(filed).toEqual(asked);
	});

	it('every prefix in use carries a complete profile', () => {
		const prefixes = prefixesInUse();
		expect(prefixes, 'no `copyPrefix` values found — has the prop changed?').not.toEqual([]);

		const failures: string[] = [];
		for (const prefix of prefixes) {
			const missing = BRANCHES.map((branch) => ({
				branch,
				keys: [...PROFILES.common, ...PROFILES[branch]].filter((key) => !has(prefix, key)),
			}));
			// The branch it came closest to is the one worth reporting: a prefix missing one key of the
			// pool profile is a bar with a gap, not a bar that should have been points.
			const best = missing.reduce((a, b) => (a.keys.length <= b.keys.length ? a : b));
			if (best.keys.length > 0) failures.push(`${prefix} (nearest ${best.branch}): ${best.keys.join(', ')}`);
		}
		expect(failures, `incomplete copy families:\n${failures.join('\n')}`).toEqual([]);
	});

	it('carries no key no component asks for', () => {
		const asked = new Set(askedFor());
		const orphans = prefixesInUse().flatMap((prefix) =>
			storedUnder(prefix)
				.filter((key) => !asked.has(key))
				.map((key) => `${prefix}.${key}`),
		);
		expect(orphans, `copy nothing reads:\n${orphans.join('\n')}`).toEqual([]);
	});
});
