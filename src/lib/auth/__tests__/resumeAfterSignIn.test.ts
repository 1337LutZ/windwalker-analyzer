// Where the tab goes once a sign-in is finished, and where it pointedly does not.
//
// The callback always lands at this build's root, because that is the one URI registered with
// WarcraftLogs — so a sign-in that started on a route has one step left to travel. Today no route
// exists, which makes the cases that must *not* navigate the ones that matter: reloading the page
// the visitor is already standing on would be a visible cost paid for nothing.

import { beforeEach, describe, expect, it } from 'vitest';

import { resumeAfterSignIn } from '../callback';

/**
 * Enough `window` for this one function.
 *
 * A local stub rather than jsdom: `vitest.config` picks the node environment on purpose, so a stray
 * `window` reference fails in a test instead of passing quietly and breaking in a browser. `assign`
 * is here to be caught rather than used — the page being left is the one that spent the authorization
 * code, and the back button must not reach it.
 */
function browserAt(href: string): { replaced: () => string | null } {
	let replaced: string | null = null;
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: {
			location: {
				href,
				replace: (next: string) => {
					replaced = next;
				},
				assign: () => {
					throw new Error('assign would leave the spent-code URL in the history');
				},
			},
		},
	});
	return { replaced: () => replaced };
}

describe('resumeAfterSignIn', () => {
	beforeEach(() => {
		Reflect.deleteProperty(globalThis, 'window');
	});

	it('stays where it is when the target is this page, which is every sign-in today', () => {
		const page = browserAt('https://example.test/?report=AbCd1234');
		resumeAfterSignIn('/?report=AbCd1234');
		expect(page.replaced()).toBeNull();
	});

	/**
	 * The live GitHub Pages case. Astro serves `/windwalker-analyzer` and `/windwalker-analyzer/`
	 * alike, so a visitor can start from the slashed spelling and come back from WarcraftLogs at the
	 * registered one. Reading those as two pages would reload every such sign-in.
	 */
	it('reads `/x` and `/x/` as the one page they are', () => {
		const page = browserAt('https://example.test/windwalker-analyzer?report=AbCd1234');
		resumeAfterSignIn('/windwalker-analyzer/?report=AbCd1234');
		expect(page.replaced()).toBeNull();
	});

	/** The query is already back in the address bar, merged, and that merge is the one that wins. */
	it('does not navigate over a query, only over a route', () => {
		const page = browserAt('https://example.test/?report=Newer');
		resumeAfterSignIn('/?report=Older');
		expect(page.replaced()).toBeNull();
	});

	it('carries a sign-in that started on a route the rest of the way', () => {
		const page = browserAt('https://example.test/?report=AbCd1234');
		resumeAfterSignIn('/monk/windwalker?report=AbCd1234#xuen-heading');
		expect(page.replaced()).toBe('https://example.test/monk/windwalker?report=AbCd1234#xuen-heading');
	});
});
