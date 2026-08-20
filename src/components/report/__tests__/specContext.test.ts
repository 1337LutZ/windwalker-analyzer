// The spec context refuses to guess.
//
// It used to default to the build's pinned `DEFAULT_SPEC`, on the argument that a section rendered in
// isolation should still score rather than crash. The evidence went the other way: under
// `PUBLIC_SPEC=elemental`, twelve test files rendered Windwalker sections through the Elemental scorer
// and stayed green, because the fallback does not hand a consumer "the spec this analysis belongs to" —
// it hands it whichever spec the *build* was pinned to, which is the right answer only by coincidence.
//
// So the failure mode this pins is not a crash. It is a wrong grade that renders happily, and the throw
// exists to turn one into the other.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SpecContext, useSpec } from '~/components/report/specContext';
import { getSpec } from '~/lib/spec';

/** A consumer that does nothing but read the spec, so the test is about the context and not a section. */
function Reader() {
	return createElement('span', null, useSpec().key);
}

describe('a consumer with no provider above it', () => {
	it('throws, and names what is missing', () => {
		expect(() => renderToStaticMarkup(createElement(Reader))).toThrow(/No spec in context/);
	});

	it('reads the spec it was given when one is provided', () => {
		const ww = getSpec('windwalker');
		expect(ww).toBeDefined();
		const html = renderToStaticMarkup(createElement(SpecContext.Provider, { value: ww! }, createElement(Reader)));
		expect(html).toContain('windwalker');
	});

	it('is the provided spec and not the build default, when the two differ', () => {
		const elemental = getSpec('elemental');
		expect(elemental).toBeDefined();
		const html = renderToStaticMarkup(
			createElement(SpecContext.Provider, { value: elemental! }, createElement(Reader)),
		);
		// The assertion that would have caught the original bug: a Windwalker-pinned build rendering an
		// Elemental provider must read Elemental, and vice versa. The default could satisfy only one.
		expect(html).toContain('elemental');
	});
});
