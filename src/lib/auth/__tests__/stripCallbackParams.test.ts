// What the address bar is left holding after a sign-in lands back here.
//
// The merge is small and every branch of it is a rule about a credential or about a shared link, so
// it is worth pinning: an authorization code must not survive in the URL, a spent one must not be
// handed back, and the report someone followed a link to must.

import { describe, expect, it, beforeEach } from 'vitest';

import { URL_RESTORED_EVENT, __test } from '../callback';

const { stripCallbackParams } = __test;

/**
 * Enough `window` for this one function.
 *
 * A local stub rather than jsdom: `vitest.config` picks the node environment on purpose, so a stray
 * `window` reference fails in a test instead of passing quietly and breaking in a browser. Only what
 * `stripCallbackParams` touches is provided, so anything it grows fails loudly here.
 */
function browserAt(href: string): {
	search: () => string;
	path: () => string;
	hash: () => string;
	fired: () => number;
} {
	let current = href;
	let fired = 0;
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: {
			get location() {
				return { href: current };
			},
			history: {
				state: null,
				replaceState: (_state: unknown, _title: string, next: string) => {
					current = new URL(next, href).href;
				},
			},
			dispatchEvent: (event: Event) => {
				if (event.type === URL_RESTORED_EVENT) fired++;
				return true;
			},
		},
	});
	return {
		search: () => new URL(current).search,
		path: () => new URL(current).pathname,
		hash: () => new URL(current).hash,
		fired: () => fired,
	};
}

describe('stripCallbackParams', () => {
	beforeEach(() => {
		Reflect.deleteProperty(globalThis, 'window');
	});

	it('takes the authorization code out of the address bar', () => {
		const page = browserAt('https://example.test/?code=abc123&state=xyz');
		stripCallbackParams();
		expect(page.search()).toBe('');
	});

	it('puts back the query the visitor arrived with', () => {
		const page = browserAt('https://example.test/?code=abc123&state=xyz');
		stripCallbackParams('/?report=AbCd1234&fight=11&player=Player+%2817%29');
		const params = new URLSearchParams(page.search());
		expect(params.get('report')).toBe('AbCd1234');
		expect(params.get('fight')).toBe('11');
		// The percent-encoding has to survive: anonymous reports name players `Player (17)`.
		expect(params.get('player')).toBe('Player (17)');
		expect(params.has('code')).toBe(false);
		expect(params.has('state')).toBe(false);
	});

	it('never hands back a spent authorization code that was in the remembered query', () => {
		const page = browserAt('https://example.test/?code=fresh&state=xyz');
		stripCallbackParams('/?code=spent&report=AbCd1234');
		const params = new URLSearchParams(page.search());
		expect(params.has('code')).toBe(false);
		expect(params.get('report')).toBe('AbCd1234');
	});

	it('lets this page load win where both carry the same key', () => {
		const page = browserAt('https://example.test/?report=Newer&code=abc123&state=xyz');
		stripCallbackParams('/?report=Older&fight=3');
		const params = new URLSearchParams(page.search());
		expect(params.get('report')).toBe('Newer');
		expect(params.get('fight')).toBe('3');
	});

	it('announces the restore, so a read that already happened can happen again', () => {
		const page = browserAt('https://example.test/?code=abc123&state=xyz');
		stripCallbackParams('/?report=AbCd1234');
		expect(page.fired()).toBe(1);
	});

	/**
	 * The return target carries a whole URL now, and only its query belongs in this address bar. The
	 * path is where `resumeAfterSignIn` sends the tab; writing it here would leave the address bar
	 * naming a route while the page the callback landed on was still on screen.
	 */
	it('takes only the query from a return target on another route', () => {
		const page = browserAt('https://example.test/?code=abc123&state=xyz');
		stripCallbackParams('/monk/windwalker?report=AbCd1234');
		expect(page.path()).toBe('/');
		expect(new URLSearchParams(page.search()).get('report')).toBe('AbCd1234');
	});

	/**
	 * And not the fragment either. `useSectionAnchor` reads it once, at mount, which is already past
	 * by the time a callback resolves — so a fragment put back here would name a section nothing
	 * opens. It rides home with the navigation instead, to a document that reads it on the way in.
	 */
	it('leaves the fragment to the navigation, which lands somewhere that will read it', () => {
		const page = browserAt('https://example.test/?code=abc123&state=xyz');
		stripCallbackParams('/?report=AbCd1234#xuen-heading');
		expect(page.hash()).toBe('');
		expect(new URLSearchParams(page.search()).get('report')).toBe('AbCd1234');
	});

	it('stays quiet when there was nothing to put back', () => {
		const page = browserAt('https://example.test/?code=abc123&state=xyz');
		stripCallbackParams();
		expect(page.fired()).toBe(0);
		stripCallbackParams('');
		expect(page.fired()).toBe(0);
	});
});
