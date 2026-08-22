// A duplicate key is React being handed two siblings it cannot tell apart, and it is not a console
// complaint.
//
// `/preview` logged 58 of them on the `poor` pull and nobody could find them, because the shape of the
// evidence — keys like `102749-1`, a timestamp and a number that was always 1 — is all the warning
// gives you. The site was `CastTimeline`'s cast marks, keyed `${t}-${id}`: melee is id 1, a
// dual-wielding monk lands two swings in the same millisecond, and `packCasts` draws a lane of non-GCD
// presses on one row, so the two icons sat exactly on top of each other with one key between them.
// React is free to drop one of a duplicate pair or to reuse the wrong node for it, in a chart whose
// entire claim is that every swing it draws happened. The fix is in that file; this is the guard.
//
// ## Why the jsx runtime rather than the warning
//
// The warning is the obvious thing to assert on, and it cannot be reached from here. React only checks
// for duplicate keys while *reconciling* — the check lives in `react-dom-client.development.js` and in
// no other bundle, so `renderToStaticMarkup` never emits it. Reconciling needs a DOM, and this project
// has no jsdom (nor any other DOM shim) in its dependency tree, deliberately: `vitest.config.ts` runs
// on `node` so that a stray `document` reference fails a test instead of quietly passing.
//
// So this asks the same question one step earlier. Every list React reconciles arrived as an array in
// some element's `children`, and every element the report draws is built by the jsx runtime — so the
// runtime is where the sibling sets are, and mocking it sees all of them without needing anything
// rendered into. The rule below is React's own: an array is a key namespace, a nested array is a
// namespace of its own (React prefixes its keys by its position), and a child with no key is indexed
// rather than matched, so only two *present* and *equal* keys in one array are a collision.
//
// `vi.mock` is scoped to this file's module registry, so no other suite renders through the wrapper.

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement, isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import PreviewSwitcher from '~/components/PreviewSwitcher';
import { initI18n } from '~/lib/i18n/config';
import type { Analysis, FightDataset } from '~/lib/types';
import { analyse as analyseElemental } from '~/specs/elemental';
import { analyse as analyseWindwalker } from '~/specs/windwalker';

/** Every collision seen since the last `watch()`, and how many element creations were inspected. */
const seen: { hits: string[]; calls: number; runtimes: Set<string> } = {
	hits: [],
	calls: 0,
	runtimes: new Set(),
};

const watch = (): void => {
	seen.hits = [];
	seen.calls = 0;
};

/** What to call the element whose children collided, so a failure names something greppable. */
const nameOf = (type: unknown): string => {
	if (typeof type === 'string') return `<${type}>`;
	const fn = type as { displayName?: string; name?: string } | null;
	return `<${fn?.displayName ?? fn?.name ?? 'anonymous'}>`;
};

/**
 * The collisions in one `children` value, by React's own rule.
 *
 * Each array is its own namespace and is recursed into as one — a nested array's keys are prefixed by
 * its position, so `[[<a key="x"/>], [<a key="x"/>]]` is not a collision and this must not call it one.
 * A `null` key is React falling back to the index, which cannot collide.
 */
function collisions(children: unknown, parent: string, into: string[]): void {
	if (!Array.isArray(children)) return;
	const keys = new Set<string>();
	for (const child of children) {
		if (Array.isArray(child)) {
			collisions(child, parent, into);
			continue;
		}
		if (!isValidElement(child)) continue;
		const { key } = child;
		if (key === null) continue;
		if (keys.has(key)) into.push(`${parent} has two children keyed \`${key}\``);
		keys.add(key);
	}
}

/**
 * The runtime the JSX transform compiles to, wrapped.
 *
 * All three entry points, because which one is called is the transform's business and not this file's:
 * vitest's esbuild emits `jsxDEV`, a production build emits `jsx`/`jsxs`, and a guard that only watched
 * one of them would go quiet the day that changed. `wrapAll` only replaces functions the real module
 * actually exports, so neither mock invents an entry point the other one owns.
 */
function wrapAll(actual: Record<string, unknown>, names: readonly string[]): Record<string, unknown> {
	const out = { ...actual };
	for (const name of names) {
		const original = actual[name];
		if (typeof original !== 'function') continue;
		out[name] = (type: unknown, props: unknown, ...rest: unknown[]): unknown => {
			seen.calls += 1;
			seen.runtimes.add(name);
			collisions((props as { children?: unknown } | null | undefined)?.children, nameOf(type), seen.hits);
			return (original as (...args: unknown[]) => unknown)(type, props, ...rest);
		};
	}
	return out;
}

vi.mock('react/jsx-runtime', async (importOriginal) =>
	wrapAll((await importOriginal()) as Record<string, unknown>, ['jsx', 'jsxs']),
);
vi.mock('react/jsx-dev-runtime', async (importOriginal) =>
	wrapAll((await importOriginal()) as Record<string, unknown>, ['jsxDEV']),
);

initI18n();

/**
 * The pulls, taken from the fixture directories rather than listed — the same reasoning, and the same
 * shape discrimination, as `interactiveNesting.test.ts`.
 */
function pulls(): Array<[string, Analysis]> {
	const specs = [
		{ dir: 'windwalker', analyse: analyseWindwalker },
		{ dir: 'elemental', analyse: analyseElemental },
	] as const;
	return specs.flatMap(({ dir, analyse }) => {
		const root = resolve(import.meta.dirname, '../../../specs', dir, '__fixtures__');
		return readdirSync(root)
			.filter((file) => file.endsWith('.json'))
			.map((file): [string, Analysis] => {
				const raw = JSON.parse(readFileSync(resolve(root, file), 'utf8')) as Record<string, unknown>;
				const analysis = 'specName' in raw ? (raw as unknown as Analysis) : analyse(raw as unknown as FightDataset);
				return [`${dir}/${file.replace(/\.json$/, '')}`, analysis];
			});
	});
}

const PULLS = pulls();

/** Exactly what `preview.astro` hands the island, one pull at a time. */
const render = (name: string, analysis: Analysis): void => {
	renderToStaticMarkup(createElement(PreviewSwitcher, { fixtures: { [name]: analysis } }));
};

describe('every list the report draws keys its rows apart', () => {
	it.each(PULLS)('%s', (name, analysis) => {
		watch();
		render(name, analysis);
		expect(seen.hits, name).toEqual([]);
	});
});

describe('the sweep above is not vacuous', () => {
	it('is what the components are actually built through', () => {
		// A mock that failed to take would leave `calls` at zero and every pull above would pass on
		// nothing at all. One pull is thousands of elements.
		watch();
		const first = PULLS[0];
		expect(first).toBeDefined();
		if (first !== undefined) render(...first);
		expect(seen.calls).toBeGreaterThan(1000);
		expect(seen.runtimes.size).toBeGreaterThan(0);
	});

	it('sees a collision planted through that same runtime', async () => {
		// End to end rather than by calling `collisions` directly: this goes through the wrapper the
		// components go through, so a wrapper that inspected the wrong argument fails here.
		const { jsxDEV } = await import('react/jsx-dev-runtime');
		const dup = [createElement('span', { key: 'x' }), createElement('span', { key: 'x' })];
		watch();
		jsxDEV('div', { children: dup }, undefined, true);
		expect(seen.hits).toEqual(['<div> has two children keyed `x`']);
	});

	it('holds React’s rule about what a collision is', () => {
		const el = (key: string | null) => createElement('span', key === null ? null : { key });

		watch();
		collisions([el('a'), el('a')], '<p>', seen.hits);
		expect(seen.hits).toHaveLength(1);

		// Different keys, no key at all, and the same key in two *different* arrays — React indexes the
		// keyless ones and prefixes the nested ones, so none of these is a collision.
		watch();
		collisions([el('a'), el('b')], '<p>', seen.hits);
		collisions([el(null), el(null)], '<p>', seen.hits);
		collisions([[el('a')], [el('a')]], '<p>', seen.hits);
		collisions([el('a'), 'text', 7, null, undefined], '<p>', seen.hits);
		collisions(el('a'), '<p>', seen.hits);
		expect(seen.hits).toEqual([]);

		// And it does find one nested a level down, which is how a `flatMap`'d lane of marks arrives.
		watch();
		collisions([[el('a'), el('a')]], '<p>', seen.hits);
		expect(seen.hits).toHaveLength(1);
	});

	it('covers both fixture dirs, and pulls that really do draw keyed lists', () => {
		expect(PULLS.length).toBeGreaterThan(6);
		expect(new Set(PULLS.map(([name]) => name.split('/')[0]))).toEqual(new Set(['windwalker', 'elemental']));
	});
});
