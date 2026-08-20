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
		// Named rather than `DEFAULT_SPEC`: the assertions below are the monk's own numbers, and the
		// default is whatever `PUBLIC_SPEC` pinned. Reading the default here is what made the suite
		// unrunnable under an Elemental pin — `expected 1500 to be 1000`.
		const ww = getSpec('windwalker')!;
		expect(ww.gcdMs).toBe(1000);
		expect(ww.analyse).toBeTypeOf('function');
		expect(ww.identify).toBeTypeOf('function');
		expect(ww.score).toBeTypeOf('function');
	});

	/**
	 * The Elemental counterpart, and it pins two ability ids as well as the global.
	 *
	 * `getSpec('elemental')` for the same reason the monk's assertion names itself: these are the
	 * shaman's own numbers, and 1500 is not 1000.
	 *
	 * The two ids are Chain Lightning and Lava Beam, and they are pinned because they were *absent*:
	 * the registry declared sixteen abilities and neither was among them, so the shared core's GCD walk
	 * skipped every press and the report read 56.02% utilisation on a pull that filled 90.81% of its
	 * globals. `onGcd` is the field that did the damage — an unmodelled press falls back to `false` and
	 * is then priced at nothing — so `onGcd` is what is asserted, through the same `abilityByCastId`
	 * lookup the core itself uses rather than by searching the ability list for a name.
	 */
	it("carries the second spec's pieces, including the two ids the core prices globals from", () => {
		const ele = getSpec('elemental')!;
		expect(ele.gcdMs).toBe(1500);
		expect(ele.analyse).toBeTypeOf('function');
		expect(ele.identify).toBeTypeOf('function');
		expect(ele.score).toBeTypeOf('function');
		expect(ele.registry.abilityByCastId(421)?.onGcd).toBe(true);
		expect(ele.registry.abilityByCastId(114074)?.onGcd).toBe(true);
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
