/**
 * Following a fragment link to a section heading, the way the rest of the page does it.
 *
 * A bare `href="#energy-heading"` works, and works badly: the browser teleports. Every other link
 * into a section on this page glides, so a link that jumps reads as a different kind of control
 * rather than as the same one — which is exactly what it was doing on the timeline's resource
 * labels while the sidebar's links glided.
 *
 * Extracted rather than copied because the behaviour is three things, not one, and only the first is
 * obvious: the smooth scroll, the reduced-motion escape, and moving focus to the heading. That last
 * is the half of a fragment link `preventDefault` throws away — without it a keyboard user is
 * scrolled to a section while still tabbing through the control they came from, and a screen reader
 * is told nothing arrived.
 *
 * Returns whether it handled the click. `false` means the heading is not on the page and the caller
 * should let the browser follow the href, which is still better than a link that does nothing.
 */
export function jumpToHeading(id: string, event?: { preventDefault: () => void }): boolean {
	const heading = document.getElementById(id);
	if (heading === null) return false;
	event?.preventDefault();

	// Smooth movement over a page this long is a genuine problem for a reader who has asked for less
	// of it, so the preference is honoured rather than assumed away.
	const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	// The tab stop is programmatic-only and made at the moment of the jump, so the heading never joins
	// the tab order for anyone else.
	heading.setAttribute('tabindex', '-1');
	heading.focus({ preventScroll: true });
	heading.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
	return true;
}
