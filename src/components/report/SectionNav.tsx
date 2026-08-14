import { useEffect, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import '~/lib/i18n';

import { jumpToHeading } from '../jump';

export interface ReportSection {
	/**
	 * The name the section is addressed by. `Section` puts it on the section's own `<h2>` suffixed
	 * `-heading` — the heading owns the id, not the `<section>` — so that is what a link points at,
	 * and it is also the element carrying the `scroll-margin-top` that keeps a jump clear of the bar.
	 */
	id: string;
	/** The section's own title key, so the nav and the heading cannot disagree on what it is called. */
	titleKey: string;
}

/**
 * The sticky selection bar's height, and the same number as the `scroll-mt-14` the headings carry.
 * It answers both halves of the problem: `top-14` parks the nav under the bar rather than behind it,
 * and the observer's top margin starts the reading band there, so a heading covered by the bar is
 * not counted as being in view.
 */
const BAR_PX = 56;

/**
 * Where you are in the report, and a way to jump.
 *
 * **Not a Base UI primitive.** A list of in-page links is semantic markup rather than a widget —
 * there is no focus to trap, no popup to position and no keyboard model to invent, and `<nav>` /
 * `<ol>` / `<a>` already carry the ARIA. The same reasoning `DataGrid` gives for using a real
 * `<table>`. Base UI's `NavigationMenu` is for menus that open, which this never does.
 *
 * **A landmark with an ordered list.** The landmark is what lets a screen reader jump straight to
 * the table of contents and, just as usefully, skip past it; the list announces how many sections
 * there are before the reader commits to walking them. `<ol>` rather than `<ul>` because the report
 * argues in order — headline, then the snapshot the spec turns on, then the clocks, then the ledger
 * — so "5 of 10" is real information about how far in a section sits. It is rendered before the
 * report in the DOM as well as to the left of it, so tabbing reaches the contents before the content
 * it indexes rather than after all of it.
 *
 * **Desktop only, and genuinely not rendered.** `display: none` below `lg` keeps it out of the
 * accessibility tree too, so a phone gets no phantom tab stops and no second announcement of ten
 * headings that are already the page. A drawer would be a control to open, a surface to trap focus
 * in and a thing to close — all of it costing more than scrolling a report that is already a scroll.
 *
 * **The current section comes from an `IntersectionObserver`, never a scroll listener** — the same
 * rule the sticky bar follows. A listener runs on every frame to answer a question whose answer
 * changes a handful of times, and it reads the wrong answer as soon as a chart above it reflows.
 */
export default function SectionNav({ sections }: { sections: readonly ReportSection[] }) {
	// The nav names the report's own sections, so it reads from the report's namespace and reuses the
	// keys the sections title themselves with rather than restating them.
	const { t } = useTranslation('report');
	const [current, setCurrent] = useState<string | null>(null);

	useEffect(() => {
		// The heading is the only element `Section` gives an id, so the section itself is reached
		// through it. The section is what gets observed: a heading is a few pixels tall, so a band
		// tuned to catch one would spend most of a long section matching nothing.
		const ids = new Map<Element, string>();
		for (const { id } of sections) {
			const section = document.getElementById(`${id}-heading`)?.closest('section');
			if (section) ids.set(section, id);
		}
		if (ids.size === 0) return;

		const onScreen = new Set<string>();
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					const id = ids.get(entry.target);
					if (id === undefined) continue;
					if (entry.isIntersecting) onScreen.add(id);
					else onScreen.delete(id);
				}
				// First in document order, so a section rising into the bottom of the band does not
				// take the highlight off the one still being read at the top of it.
				const next = sections.find((section) => onScreen.has(section.id));
				// Nothing in the band means the reader is above the first section or past the bottom of
				// the last, both of which are better served by the last true answer than by no answer:
				// the gaps between sections are far shorter than the band, so this is never a flicker.
				if (next !== undefined) setCurrent(next.id);
			},
			// A reading band rather than the whole viewport, running from just under the sticky bar to
			// a little under half way down. The section covering that line is the one being read; with
			// the full viewport every section on screen would qualify and the answer would be the
			// longest one, not the current one.
			{ rootMargin: `-${BAR_PX}px 0px -55% 0px` },
		);
		for (const section of ids.keys()) observer.observe(section);
		return () => observer.disconnect();
	}, [sections]);

	const jump = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
		// Shared with the timeline's resource labels, so a link into a section behaves the same wherever
		// it is on the page. `false` means the heading is not here — let the browser follow the href.
		if (!jumpToHeading(`${id}-heading`, event)) return;
		// Answered now rather than waiting for the observer, so the click reads as having landed even
		// while a smooth scroll is still travelling.
		setCurrent(id);
	};

	return (
		<nav
			aria-label={t('nav.label')}
			// `self-start` is load-bearing: stretched to the grid row's height the nav would have no
			// room left to travel and `sticky` would do nothing at all.
			className="hidden lg:sticky lg:top-14 lg:block lg:max-h-[calc(100vh_-_5rem)] lg:self-start lg:overflow-y-auto"
		>
			<ol className="m-0 flex list-none flex-col p-0">
				{sections.map(({ id, titleKey }) => (
					<li key={id}>
						<a
							href={`#${id}-heading`}
							onClick={(event) => jump(event, id)}
							// `location` rather than `page`: the section is a place inside this page, not one
							// page of several. It is also what stops the highlight from being colour alone —
							// the rule, the weight and the announcement all say the same thing.
							aria-current={current === id ? 'location' : undefined}
							className={`flex min-h-11 items-center border-l-2 py-2 pr-2 pl-3 leading-snug transition-colors ${
								current === id
									? 'border-kick font-semibold text-ink'
									: 'border-line text-muted hover:border-muted hover:text-ink-2'
							}`}
						>
							{t(titleKey)}
						</a>
					</li>
				))}
			</ol>
		</nav>
	);
}
