// Where in the report the reader is, mirrored into the address bar as a fragment.
//
// The same argument `useReportUrlState` makes for the query, one level finer: a link to a report is
// worth sharing, and a link to the *paragraph* that made the point is worth more. The report is one
// page several thousand pixels long, so "look at the brew bank" is otherwise a sentence rather than
// a link.
//
// It composes with that hook rather than competing with it. This one owns the fragment and never
// touches the query; `useUrlSelectionWriter` owns the query and carries the fragment through
// untouched (`nextHref` there, and the test that pins it). Neither writes what the other owns, so
// there is no order in which one can erase the other's work.

import { useCallback, useEffect, useRef, useState } from 'react';

import { jumpToHeading } from '~/components/jump';

/**
 * The element a section id addresses.
 *
 * `Section` puts the id on the section's own `<h2>`, not on the `<section>` — so the heading is what
 * a fragment points at, and it is also what carries the `scroll-margin-top` that keeps a jump clear
 * of the sticky bar. The whole page already spells its in-page links this way (`SectionNav`'s links,
 * the takeaway cards' jump buttons), which is why the fragment written here is that same string
 * rather than a second, shorter form of it: one vocabulary, so a shared fragment and a clicked link
 * are the same URL.
 */
const HEADING = '-heading';
const headingOf = (section: string) => `${section}${HEADING}`;

/**
 * How long the restore keeps looking for its section before giving up, in animation frames.
 *
 * Frames rather than milliseconds because the loop is a frame loop: a background tab stops painting,
 * and a budget in milliseconds would expire while the page was never given a chance to render the
 * report. About two seconds of a foreground tab, which is far longer than the one or two frames the
 * real case takes — it is a stop, not a schedule.
 */
const RESTORE_FRAMES = 120;

/**
 * What counts as the reader taking over.
 *
 * `scroll` is deliberately not in the list, and that is the whole point: the report announces itself
 * by scrolling — `ReportFlow` brings the finished analysis into view the moment it lands — so a
 * restore that abandoned on any scroll event would abandon on the one it was waiting for. These
 * three are intent rather than movement: a wheel, a hand on the page, a key. `pointerdown` rather
 * than `touchstart` so a mouse counts as a hand too.
 */
const TAKEOVER = ['wheel', 'pointerdown', 'keydown'] as const;

/** The part of the address bar `history` is given: everything after the origin. */
const relative = (location: { pathname: string; search: string; hash: string }) =>
	`${location.pathname}${location.search}${location.hash}`;

/**
 * The section a fragment names, or `null` if it names nothing this report rendered.
 *
 * Checked against the sections rather than trusted, for the same reason `shouldAutoRun` checks the
 * player against the roster: a link is a stale string from someone else's pull, and `#xuen-heading`
 * on a Rushing Jade Wind log names a section that is legitimately not there.
 *
 * Both spellings are accepted — `#bank-heading` is what this writes, and `#bank` is what a reader
 * shortens it to by hand, which is also how the user asked for it ("ie. #timeline"). Only one form
 * is ever written, so this is a lenient read rather than a second scheme.
 */
export function sectionFromHash(hash: string, sections: readonly { id: string }[]): string | null {
	const raw = decodeURIComponent(hash.startsWith('#') ? hash.slice(1) : hash);
	if (raw === '') return null;
	const id = raw.endsWith(HEADING) ? raw.slice(0, -HEADING.length) : raw;
	return sections.some((section) => section.id === id) ? id : null;
}

/**
 * The address bar this section asks for, with everything else left exactly as it was.
 *
 * Built through `URL` and reassembled from its parts, the same way `nextHref` does it, so the query
 * survives verbatim — a fragment write that dropped `?report=…&fight=…` would turn every shared link
 * into a link to an empty form.
 */
export function hrefWithSection(href: string, section: string | null): string {
	const url = new URL(href);
	url.hash = section === null ? '' : `#${headingOf(section)}`;
	return relative(url);
}

/**
 * Writes the fragment.
 *
 * **`replace` while reading, `push` on a click.** Scrolling is not navigation: eight sections
 * scrolled past must not be eight presses of the back button to undo, which is the same argument
 * `useReportUrlState` makes about picking a fight. A click on a contents link is the opposite — it
 * *is* a navigation, and it is one the browser would have pushed itself if the handler had not
 * called `preventDefault` to scroll smoothly instead. Pushing restores what was taken away: back
 * returns to the fragment, and to the scroll position, that the reader clicked from.
 *
 * Skipped when it would write the address bar it is already showing, which is most calls — the
 * observer re-answers with the same section far more often than it changes its mind.
 */
function write(section: string, mode: 'replace' | 'push'): void {
	const next = hrefWithSection(window.location.href, section);
	if (next === relative(window.location)) return;
	// `history.state` carried rather than cleared: `stripCallbackParams` writes through the same
	// address bar, and a fragment write is no reason to forget what it left there.
	if (mode === 'push') window.history.pushState(window.history.state, '', next);
	else window.history.replaceState(window.history.state, '', next);
}

/**
 * Follows a fragment to its section as soon as the section exists.
 *
 * The report is not on the page when the link is opened — it is fetched and analysed first — so this
 * cannot be a jump on mount. Two things make it wait rather than fire:
 *
 * - **The section may not be rendered yet.** `jumpToHeading` says so by returning `false`, and this
 *   asks again on the next frame until it lands or the budget runs out.
 * - **The report scrolls itself into view.** `ReportFlow` does that on the effect that follows the
 *   analysis arriving, and effects run child-first — so a jump made synchronously from a child would
 *   be overwritten a moment later by the parent's scroll to the top of the report. Waiting a frame
 *   puts this last, which is where the reader's own request belongs.
 *
 * And it stops if the reader takes over. A restore is a guess about intent, made a second or two
 * after the page was opened; someone already scrolling has stated theirs, and yanking the page out
 * from under them is worse than not restoring at all.
 *
 * `settled` is called exactly once, whether it landed, gave up or was abandoned — the caller uses it
 * to know when the address bar is its own again.
 */
export function restoreSection(section: string, settled: () => void): () => void {
	let frames = 0;
	let handle = 0;
	let stopped = false;
	const stop = () => {
		if (stopped) return;
		stopped = true;
		window.cancelAnimationFrame(handle);
		for (const type of TAKEOVER) window.removeEventListener(type, stop);
		settled();
	};
	for (const type of TAKEOVER) window.addEventListener(type, stop, { passive: true });
	const tick = () => {
		if (stopped) return;
		// `jumpToHeading` is the page's one way of following a fragment — smooth unless the reader has
		// asked for less motion, and focus moved to the heading so a keyboard user arrives with it
		// rather than watching the viewport leave without them.
		if (jumpToHeading(headingOf(section))) return stop();
		if (++frames >= RESTORE_FRAMES) return stop();
		handle = window.requestAnimationFrame(tick);
	};
	handle = window.requestAnimationFrame(tick);
	return stop;
}

/**
 * Keeps the fragment and the reader's position in step, and returns the writer a click should use.
 *
 * **"The current section" is not defined here.** It is `SectionNav`'s `current` — the first section
 * in document order whose box crosses the reading band that runs from just under the sticky bar to
 * 45% of the way down the viewport, holding its last answer when nothing crosses it. That answer is
 * already computed, already the one the sidebar highlights, and already stable across a boundary:
 * both sections cross the band while one hands over to the other, and "first in document order"
 * resolves that to the upper one until it has genuinely left. So it changes once per boundary, in
 * one direction, however slowly the boundary is crossed — an observer per notion of position would
 * be a second answer to a question that already has one, free to disagree with the highlight.
 */
export function useSectionAnchor(
	sections: readonly { id: string }[],
	current: string | null,
): (section: string) => void {
	/**
	 * Whether a restore is still in flight.
	 *
	 * State rather than a ref because the write below has to run again when it clears: the reader's
	 * position while the restore travels is where the report *opened*, not where the link asked to
	 * be, and writing it would erase the fragment being followed. When it clears, whatever position
	 * the reader ended up at is written — the one they scrolled to if they took over, the one the
	 * link named if they did not.
	 */
	const [restoring, setRestoring] = useState(false);

	// Mount only, and the fragment is read once rather than watched — `useInitialUrlSelection` gives
	// the argument: after the first render this app's own state is the truth and the address bar is a
	// mirror of it, so a hook watching the URL it writes would race itself. This component mounts with
	// the report, so the sections it is handed on that first render are the ones the link was opened
	// against, and a later pull is a new position rather than a link to restore.
	//
	// Held in a ref rather than read from the prop with an empty dependency list, so the code says that
	// out loud instead of leaving a lint rule to be argued with in a comment: `atMount` cannot go stale
	// because nothing reassigns it, and the effect genuinely has no reactive input.
	const atMount = useRef(sections);
	useEffect(() => {
		const target = sectionFromHash(window.location.hash, atMount.current);
		if (target === null) return;
		setRestoring(true);
		return restoreSection(target, () => setRestoring(false));
	}, []);

	useEffect(() => {
		if (current === null || restoring) return;
		write(current, 'replace');
	}, [current, restoring]);

	return useCallback((section: string) => write(section, 'push'), []);
}

export const __test = { write };
