// The registry is the only list of specs, so the two lookups and the invariants around them are
// pinned here: a spec the UI can name in the URL must be findable by the API's own spelling, and the
// default must exist.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { DEFAULT_SPEC, findSpecForClass, getSpec, SPECS } from '../registry';

describe('spec registry', () => {
	it('resolves the URL key and the WarcraftLogs spelling to the same spec', () => {
		const byKey = getSpec('windwalker');
		const byClass = findSpecForClass('Monk', 'Windwalker');
		expect(byKey).toBe(byClass);
		expect(byKey?.key).toBe('windwalker');
		expect(byKey?.displayName).toBe('Windwalker Monk');
	});

	it('resolves the second spec the same way', () => {
		const byKey = getSpec('elemental');
		const byClass = findSpecForClass('Shaman', 'Elemental');
		expect(byKey).toBe(byClass);
		expect(byKey?.key).toBe('elemental');
		expect(byKey?.displayName).toBe('Elemental Shaman');
	});

	it('answers undefined rather than guessing for an unknown key or class', () => {
		expect(getSpec('priest')).toBeUndefined();
		expect(findSpecForClass('Priest', 'Shadow')).toBeUndefined();
		expect(findSpecForClass('Monk', 'Brewmaster')).toBeUndefined();
	});

	it('has a default that is actually in the list', () => {
		expect(SPECS).toContain(DEFAULT_SPEC);
	});

	it('carries the pieces the UI runs on', () => {
		const ww = DEFAULT_SPEC;
		expect(ww.gcdMs).toBe(1000);
		expect(ww.analyse).toBeTypeOf('function');
		expect(ww.identify).toBeTypeOf('function');
		expect(ww.score).toBeTypeOf('function');
	});
});

/**
 * Every spec a deploy workflow pins itself to has to be a key this registry answers.
 *
 * `DEFAULT_SPEC` is `getSpec(PUBLIC_SPEC) ?? SPECS[0]`, and that fallback is deliberate — an unset
 * value is a dev server, not a mistake. The cost is that a *typo* is silent: `PUBLIC_SPEC: elementl`
 * builds and deploys perfectly, and the Elemental site comes up branded and behaving as Windwalker.
 * Nothing in the pipeline would fail, and nobody would look at the Actions tab. So the workflows'
 * own values are read off disk and checked against the list here, where a wrong one is a red test
 * instead of a wrong live site.
 */
describe('the spec keys the deploy workflows pin themselves to', () => {
	const dir = '.github/workflows';
	// `spec: <key>` under a caller's `with:`, and the `options:` of the Pages fallback's dispatch
	// choice. Both are plain scalars on their own line, which is what makes a regex honest here rather
	// than a YAML parse: there is nothing to disambiguate.
	const keys = readdirSync(dir)
		.filter((f) => f.endsWith('.yml'))
		.flatMap((f) => {
			const text = readFileSync(`${dir}/${f}`, 'utf8');
			return [...text.matchAll(/^\s*(?:-\s+)?(?:spec|PUBLIC_SPEC):\s*([a-z][a-z0-9-]*)\s*$/gm)].map((m) => m[1]!);
		});

	it('finds some to check, so a rename cannot quietly empty this test', () => {
		expect(keys.length).toBeGreaterThan(0);
		expect(keys).toContain('windwalker');
		expect(keys).toContain('elemental');
	});

	it('resolves every one of them', () => {
		for (const key of keys) expect(getSpec(key), `workflow pins PUBLIC_SPEC=${key}`).toBeDefined();
	});
});
