// The registry is the only list of specs, so the two lookups and the invariants around them are
// pinned here: a spec the UI can name in the URL must be findable by the API's own spelling, and the
// default must exist.
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

	it('answers undefined rather than guessing for an unknown key or class', () => {
		expect(getSpec('elemental')).toBeUndefined();
		expect(findSpecForClass('Shaman', 'Elemental')).toBeUndefined();
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
