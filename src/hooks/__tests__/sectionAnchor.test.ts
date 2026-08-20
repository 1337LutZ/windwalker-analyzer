// The fragment half of the address bar: which section the reader is at, and getting back to it.
//
// Three things are worth pinning and none of them are visible from reading the code carefully:
//
// - **The fragment and the query are different owners' property.** A write of one that drops the
//   other turns a shared link into a link to an empty form (or to the top of a long report), and
//   nothing throws either way. Both directions are asserted here, against byte-exact strings.
// - **The restore has to wait.** The report is fetched and analysed before its sections exist, and
//   `ReportFlow` scrolls the finished report into view on the effect after this one — so a jump made
//   on mount is a jump at nothing, or a jump that is immediately overwritten.
// - **And it has to lose to the reader.** Someone already scrolling has said where they want to be.
//
// A local `window`/`document` stub rather than jsdom, the same way `stripCallbackParams.test.ts` does
// it and for the same reason: `vitest.config` picks the node environment on purpose, so a stray
// browser reference fails in a test instead of passing quietly. Only what these functions touch is
// provided, so anything they grow fails loudly here.

import { describe, expect, it, beforeEach } from 'vitest';

import { __test as urlState } from '../useReportUrlState';
import { __test, hrefWithSection, restoreSection, sectionFromHash } from '../useSectionAnchor';

const { nextHref } = urlState;
const { write } = __test;

const SECTIONS = [{ id: 'summary' }, { id: 'cpm' }, { id: 'bank' }, { id: 'tiger-palm' }, { id: 'timeline' }];

interface Browser {
	/** Every `history` write, in order: how it was made and what it wrote. */
	writes: () => { mode: 'push' | 'replace'; href: string }[];
	/** The `state` argument each write was given, so a write that forgets it is visible. */
	states: () => unknown[];
	/** What the address bar is showing now, origin stripped. */
	url: () => string;
	/** Puts a heading on the page — the "section appears late" half. */
	render: (id: string) => void;
	/** Runs the pending animation frame callback, if there is one. Returns whether there was. */
	frame: () => boolean;
	/** What the jump did, in order: `focus:<id>`, `scroll:<id>:<behaviour>`, `tabindex:<id>`. */
	log: () => string[];
	/** The reader taking over. */
	fire: (type: string) => void;
	listeners: () => number;
}

function browserAt(href: string, options: { reducedMotion?: boolean } = {}): Browser {
	let current = new URL(href);
	const writes: { mode: 'push' | 'replace'; href: string }[] = [];
	const states: unknown[] = [];
	const rendered = new Map<string, unknown>();
	const log: string[] = [];
	const listeners = new Map<string, Set<() => void>>();
	let pending: (() => void) | null = null;
	let handles = 0;
	const HISTORY_STATE = { restoredBy: 'the sign-in' };

	const record = (mode: 'push' | 'replace') => (state: unknown, _title: string, next: string) => {
		writes.push({ mode, href: next });
		states.push(state);
		current = new URL(next, current.href);
	};

	const element = (id: string) => ({
		setAttribute: (name: string, value: string) => log.push(`${name}:${id}=${value}`),
		focus: (init: { preventScroll: boolean }) => log.push(`focus:${id}:${String(init.preventScroll)}`),
		scrollIntoView: (init: { behavior: string; block: string }) => log.push(`scroll:${id}:${init.behavior}`),
	});

	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: {
			get location() {
				return { href: current.href, pathname: current.pathname, search: current.search, hash: current.hash };
			},
			history: {
				state: HISTORY_STATE,
				pushState: record('push'),
				replaceState: record('replace'),
			},
			requestAnimationFrame: (callback: () => void) => {
				pending = callback;
				return ++handles;
			},
			cancelAnimationFrame: () => {
				pending = null;
			},
			addEventListener: (type: string, listener: () => void) => {
				const set = listeners.get(type) ?? new Set();
				set.add(listener);
				listeners.set(type, set);
			},
			removeEventListener: (type: string, listener: () => void) => {
				listeners.get(type)?.delete(listener);
			},
			matchMedia: (query: string) => ({
				matches: options.reducedMotion === true && query.includes('prefers-reduced-motion'),
			}),
		},
	});
	Object.defineProperty(globalThis, 'document', {
		configurable: true,
		value: { getElementById: (id: string) => rendered.get(id) ?? null },
	});

	return {
		writes: () => writes,
		states: () => states,
		url: () => `${current.pathname}${current.search}${current.hash}`,
		render: (id) => rendered.set(id, element(id)),
		frame: () => {
			const callback = pending;
			pending = null;
			callback?.();
			return callback !== null;
		},
		log: () => log,
		fire: (type) => {
			// A copy, so a listener that unsubscribes itself while firing cannot skip the next one.
			for (const listener of Array.from(listeners.get(type) ?? [])) listener();
		},
		listeners: () => [...listeners.values()].reduce((total, set) => total + set.size, 0),
	};
}

beforeEach(() => {
	Reflect.deleteProperty(globalThis, 'window');
	Reflect.deleteProperty(globalThis, 'document');
});

/** A shared link: report, fight and player, with the player name a real anonymous report produces. */
const SHARED = 'https://example.test/app?report=a%3A6MhZgjyAknFWrYfK&fight=57&player=Player+%2817%29';

describe('the section fragment', () => {
	/**
	 * The whole query, byte for byte, and the fragment added on the end. Written out as a literal
	 * rather than rebuilt from the input, because a `URL` round trip is exactly what could re-encode
	 * `a:` or `Player (17)` and the point is that nothing was touched.
	 */
	it('leaves the query alone', () => {
		expect(hrefWithSection(SHARED, 'bank')).toBe(
			'/app?report=a%3A6MhZgjyAknFWrYfK&fight=57&player=Player+%2817%29#bank-heading',
		);
	});

	it('replaces a fragment that is already there rather than appending to it', () => {
		expect(hrefWithSection(`${SHARED}#cpm-heading`, 'tiger-palm')).toBe(
			'/app?report=a%3A6MhZgjyAknFWrYfK&fight=57&player=Player+%2817%29#tiger-palm-heading',
		);
	});

	it('drops the fragment, and the hash with it, for no section', () => {
		expect(hrefWithSection(`${SHARED}#cpm-heading`, null)).toBe(
			'/app?report=a%3A6MhZgjyAknFWrYfK&fight=57&player=Player+%2817%29',
		);
	});

	it('names the heading, which is the element the page gives the id to', () => {
		expect(hrefWithSection('https://example.test/app', 'timeline')).toBe('/app#timeline-heading');
	});
});

/**
 * The other direction, and the one that is easy to break from a distance: the selection writer fires
 * whenever the pickers resolve, which on a shared link is after the fragment is already in the bar.
 */
describe('the selection writer', () => {
	it('carries the fragment through a selection write', () => {
		expect(
			nextHref('https://example.test/app?report=Older#bank-heading', {
				code: 'a:6MhZgjyAknFWrYfK',
				fightID: 57,
				player: 'Player (17)',
				spec: 'windwalker',
			}),
		).toBe('/app?report=a%3A6MhZgjyAknFWrYfK&fight=57&player=Player+%2817%29&spec=windwalker#bank-heading');
	});

	it('still writes a bare selection when there is no fragment', () => {
		expect(nextHref('https://example.test/app', { code: 'AbCd1234', fightID: 3, player: null, spec: null })).toBe(
			'/app?report=AbCd1234&fight=3',
		);
	});
});

describe('reading a fragment back', () => {
	it('reads the form it writes', () => {
		expect(sectionFromHash('#bank-heading', SECTIONS)).toBe('bank');
	});

	/** How the request was phrased — "ie. #timeline" — and how anyone shortens one by hand. */
	it('accepts the bare section id too', () => {
		expect(sectionFromHash('#timeline', SECTIONS)).toBe('timeline');
	});

	it('refuses a section this pull did not render', () => {
		expect(sectionFromHash('#xuen-heading', SECTIONS)).toBeNull();
		expect(sectionFromHash('#xuen', SECTIONS)).toBeNull();
	});

	it('has nothing to say about an empty fragment', () => {
		expect(sectionFromHash('', SECTIONS)).toBeNull();
		expect(sectionFromHash('#', SECTIONS)).toBeNull();
	});

	it('decodes before it matches', () => {
		expect(sectionFromHash('#tiger%2Dpalm-heading', SECTIONS)).toBe('tiger-palm');
	});
});

describe('writing where the reader is', () => {
	it('replaces while scrolling, so eight sections are not eight presses of back', () => {
		const page = browserAt(SHARED);
		write('bank', 'replace');
		expect(page.writes()).toEqual([
			{ mode: 'replace', href: '/app?report=a%3A6MhZgjyAknFWrYfK&fight=57&player=Player+%2817%29#bank-heading' },
		]);
	});

	/**
	 * A click is the one navigation here, and the entry it pushes is the one the browser would have
	 * pushed itself if the nav had not taken the click to scroll smoothly instead.
	 */
	it('pushes for a click', () => {
		const page = browserAt(SHARED);
		write('bank', 'push');
		expect(page.writes().map((entry) => entry.mode)).toEqual(['push']);
	});

	/**
	 * The observer re-answers with the same section far more often than it changes its mind, and every
	 * one of those is a `replaceState` a browser is entitled to throttle.
	 */
	it('writes nothing when the address bar already says so', () => {
		const page = browserAt(SHARED);
		write('bank', 'replace');
		write('bank', 'replace');
		write('bank', 'push');
		expect(page.writes().length).toBe(1);
	});

	it('keeps whatever history state the sign-in left behind', () => {
		const page = browserAt(SHARED);
		write('bank', 'replace');
		expect(page.states()).toEqual([{ restoredBy: 'the sign-in' }]);
	});
});

describe('restoring a shared fragment', () => {
	/**
	 * The trap this feature is mostly made of. On the frame the hook mounts, the section it was asked
	 * for may not be rendered — and even when it is, `ReportFlow`'s own scroll to the top of the
	 * report runs after this and would overwrite an immediate jump. So: nothing on mount, nothing
	 * while the section is missing, and one jump on the frame it appears.
	 */
	it('waits for a section that appears late, then jumps to it once', () => {
		const page = browserAt(`${SHARED}#bank-heading`);
		const settled: number[] = [];
		restoreSection('bank', () => settled.push(1));

		// Nothing has happened yet: the restore is scheduled, not done.
		expect(page.log()).toEqual([]);

		for (let frame = 0; frame < 4; frame++) expect(page.frame()).toBe(true);
		expect(page.log()).toEqual([]);
		expect(settled).toEqual([]);

		page.render('bank-heading');
		page.frame();
		expect(page.log()).toEqual(['tabindex:bank-heading=-1', 'focus:bank-heading:true', 'scroll:bank-heading:smooth']);
		expect(settled).toEqual([1]);

		// And it stops: no further frame is asked for, and nothing is left listening.
		expect(page.frame()).toBe(false);
		expect(page.listeners()).toBe(0);
	});

	/** The restore reads the address bar; it must never write it. */
	it('leaves the address bar exactly as it found it', () => {
		const page = browserAt(`${SHARED}#bank-heading`);
		restoreSection('bank', () => {});
		page.render('bank-heading');
		page.frame();
		expect(page.writes()).toEqual([]);
		expect(page.url()).toBe('/app?report=a%3A6MhZgjyAknFWrYfK&fight=57&player=Player+%2817%29#bank-heading');
	});

	/**
	 * Deferred by a frame even when the section is already on the page, which is the other half of the
	 * trap and the invisible one: `ReportFlow` scrolls the finished report into view on the effect
	 * *after* this one, so a jump made in the same tick is a jump the parent then scrolls away from.
	 * Nothing may have happened by the time this function returns.
	 */
	it('defers the jump by a frame even when the section is already there', () => {
		const page = browserAt(`${SHARED}#cpm-heading`);
		page.render('cpm-heading');
		restoreSection('cpm', () => {});
		expect(page.log()).toEqual([]);
		page.frame();
		expect(page.log()).toContain('scroll:cpm-heading:smooth');
	});

	/** Focus moves with the viewport, or a keyboard reader is scrolled somewhere they are not. */
	it('moves focus to the heading, not just the viewport', () => {
		const page = browserAt(`${SHARED}#cpm-heading`);
		page.render('cpm-heading');
		restoreSection('cpm', () => {});
		page.frame();
		expect(page.log().indexOf('focus:cpm-heading:true')).toBeLessThan(page.log().indexOf('scroll:cpm-heading:smooth'));
	});

	it('does not glide for a reader who asked for less motion', () => {
		const page = browserAt(`${SHARED}#cpm-heading`, { reducedMotion: true });
		page.render('cpm-heading');
		restoreSection('cpm', () => {});
		page.frame();
		expect(page.log()).toContain('scroll:cpm-heading:auto');
	});

	/**
	 * The reader has said where they want to be, which beats a guess made from a link. The section
	 * arriving afterwards must not change that answer.
	 */
	it('gives up the moment the reader scrolls', () => {
		const page = browserAt(`${SHARED}#bank-heading`);
		const settled: number[] = [];
		restoreSection('bank', () => settled.push(1));
		page.frame();
		page.fire('wheel');
		expect(settled).toEqual([1]);

		page.render('bank-heading');
		expect(page.frame()).toBe(false);
		expect(page.log()).toEqual([]);
	});

	it('gives up for a hand on the page or a key, too', () => {
		for (const takeover of ['pointerdown', 'keydown']) {
			const page = browserAt(`${SHARED}#bank-heading`);
			restoreSection('bank', () => {});
			page.fire(takeover);
			page.render('bank-heading');
			expect(page.frame(), takeover).toBe(false);
			expect(page.log(), takeover).toEqual([]);
		}
	});

	/** A budget rather than a schedule: a report that never renders must not leave a frame loop running. */
	it('stops looking eventually', () => {
		const page = browserAt(`${SHARED}#bank-heading`);
		const settled: number[] = [];
		restoreSection('bank', () => settled.push(1));
		// Bounded, so a loop that never gives up fails here instead of hanging the run.
		let frames = 0;
		while (frames < 1000 && page.frame()) frames++;
		expect(frames).toBeGreaterThan(1);
		expect(frames).toBeLessThan(600);
		expect(settled).toEqual([1]);
		expect(page.listeners()).toBe(0);
		expect(page.log()).toEqual([]);
	});

	/** Abandoned by the caller — the component unmounted — is the same stop, and it settles once. */
	it('can be called off by the caller', () => {
		const page = browserAt(`${SHARED}#bank-heading`);
		const settled: number[] = [];
		const stop = restoreSection('bank', () => settled.push(1));
		stop();
		stop();
		page.render('bank-heading');
		expect(page.frame()).toBe(false);
		expect(settled).toEqual([1]);
	});
});
