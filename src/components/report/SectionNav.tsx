import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import '~/lib/i18n';

import { useSectionAnchor } from '~/hooks/useSectionAnchor';
import { jumpToHeading } from '../jump';

/**
 * Which part of the report a section is filed under in the contents list.
 *
 * A closed set, and a required field on every section, because that is what keeps the grouping from
 * being a second list to maintain: a section added to `SECTIONS` without one does not quietly fall
 * out of the nav, it fails the type check. Membership lives on the section rather than in a table of
 * ids here for the same reason the nav is built from `SECTIONS` at all — a table of ids would be a
 * third copy, free to name a section that no longer exists and to miss one that does.
 *
 * `null` is the way out and it means "listed on its own, above the groups". The summary is the only
 * entry that takes it: it is the way back to the top of a long report, and a way back that a reader
 * has to open a group to reach is not one.
 */
export type SectionGroup = 'core' | 'cooldowns' | 'abilities' | 'reference';

export interface ReportSection {
	/**
	 * The name the section is addressed by. `Section` puts it on the section's own `<h2>` suffixed
	 * `-heading` — the heading owns the id, not the `<section>` — so that is what a link points at,
	 * and it is also the element carrying the `scroll-margin-top` that keeps a jump clear of the bar.
	 */
	id: string;
	/** The section's own title key, so the nav and the heading cannot disagree on what it is called. */
	titleKey: string;
	/** Which group of the contents list it sits in, or `null` to stand above them. See `SectionGroup`. */
	group: SectionGroup | null;
}

/**
 * What each group is called.
 *
 * Deliberately literal keys rather than `nav.groups.${group}` assembled at the call site, so every
 * string the nav can render is greppable from the locale — the same reason `TargetModeControl` spells
 * its three out.
 */
const GROUP_TITLE: Record<SectionGroup, string> = {
	core: 'nav.groups.core',
	cooldowns: 'nav.groups.cooldowns',
	abilities: 'nav.groups.abilities',
	reference: 'nav.groups.reference',
};

/**
 * The sticky selection bar's height, and the same number as the `scroll-mt-14` the headings carry.
 * It answers both halves of the problem: `top-14` parks the nav under the bar rather than behind it,
 * and the observer's top margin starts the reading band there, so a heading covered by the bar is
 * not counted as being in view.
 */
const BAR_PX = 56;

/** One entry of the top-level list: a section standing on its own, or a group of them. */
type NavItem =
	| { kind: 'link'; section: ReportSection }
	| { kind: 'group'; group: SectionGroup; sections: ReportSection[] };

/** The panel a group's button opens, and the id that button points `aria-controls` at. */
const panelId = (group: SectionGroup) => `nav-group-${group}`;

/**
 * The sections this pull rendered, folded into their groups.
 *
 * Derived from the sections rather than declared as a list of groups, which is what makes an empty
 * group impossible rather than merely handled: a group nobody is in is a group that was never built,
 * so a `when` that declines on this pull can never leave a heading with nothing under it. It also
 * fixes the order without a second declaration — a group appears where its first section appears, so
 * the nav reads down in the order the report argues.
 *
 * A group whose sections are not contiguous in the report is folded together anyway, at the position
 * of its first. Nothing exercises that now — `SECTIONS` reads down in group order, one unbroken run
 * each, and `sectionNav.test.ts` holds it there — so the fold is insurance rather than a feature: if
 * a section is ever filed away from its run, the nav lists its group once, where the report first
 * reaches it, instead of opening the same heading twice.
 */
function foldIntoGroups(sections: readonly ReportSection[]): NavItem[] {
	const items: NavItem[] = [];
	const started = new Map<SectionGroup, ReportSection[]>();
	for (const section of sections) {
		if (section.group === null) {
			items.push({ kind: 'link', section });
			continue;
		}
		const open = started.get(section.group);
		if (open !== undefined) {
			open.push(section);
			continue;
		}
		const group = [section];
		started.set(section.group, group);
		items.push({ kind: 'group', group: section.group, sections: group });
	}
	return items;
}

/**
 * Where you are in the report, and a way to jump.
 *
 * **Not a Base UI primitive, and neither are the groups.** A list of in-page links is semantic markup
 * rather than a widget — there is no focus to trap, no popup to position and no keyboard model to
 * invent, and `<nav>` / `<ol>` / `<a>` already carry the ARIA. The same reasoning `DataGrid` gives for
 * using a real `<table>`. Making the groups collapsible does not change that: a disclosure is a real
 * `<button>` carrying `aria-expanded` and `aria-controls` over a panel that is plainly `hidden`, which
 * is three attributes rather than a component. `Collapsible` would also unmount its panel by default,
 * and a nav that stops listing half the report the moment a group is shut is a nav that has to be
 * queried before it can be trusted. Base UI's `NavigationMenu` is for menus that open over the page,
 * which this never does.
 *
 * **A landmark with an ordered list.** The landmark is what lets a screen reader jump straight to
 * the table of contents and, just as usefully, skip past it; the list announces how many sections
 * there are before the reader commits to walking them. `<ol>` rather than `<ul>` because the report
 * argues in order — headline, then the snapshot the spec turns on, then the clocks, then the ledger
 * — so "5 of 10" is real information about how far in a section sits. Groups nest a second `<ol>`
 * inside the `<li>` their button is in, so that reading holds at both levels: four groups, and this
 * many sections inside this one. It is rendered before the report in the DOM as well as to the left
 * of it, so tabbing reaches the contents before the content it indexes rather than after all of it.
 *
 * **A shut group is `hidden`, not unmounted.** `hidden` takes its links out of the tab order and out
 * of the accessibility tree together, which is the pair that matters: a link that is invisible but
 * still tabbable is the classic disclosure bug, and one that is visually gone but still announced is
 * the same bug wearing a different hat. Keeping the markup means the contents list is still the whole
 * contents list, whatever is open.
 *
 * **Desktop only, and genuinely not rendered.** `display: none` below `lg` keeps it out of the
 * accessibility tree too, so a phone gets no phantom tab stops and no second announcement of ten
 * headings that are already the page. A drawer would be a control to open, a surface to trap focus
 * in and a thing to close — all of it costing more than scrolling a report that is already a scroll.
 *
 * **The current section comes from an `IntersectionObserver`, never a scroll listener** — the same
 * rule the sticky bar follows. A listener runs on every frame to answer a question whose answer
 * changes a handful of times, and it reads the wrong answer as soon as a chart above it reflows. The
 * groups read that same answer rather than watching anything of their own: one observer, one notion
 * of where the reader is, and a highlight and an open group that cannot disagree.
 */
export default function SectionNav({ sections }: { sections: readonly ReportSection[] }) {
	// The nav names the report's own sections, so it reads from the report's namespace and reuses the
	// keys the sections title themselves with rather than restating them.
	const { t } = useTranslation('report');
	const [current, setCurrent] = useState<string | null>(null);
	/**
	 * The address bar's copy of that answer, and the way back from a shared link.
	 *
	 * Here rather than in `Report` because this is where "where the reader is" is already known — the
	 * observer below is the only thing on the page that knows it, and a second one would be a second
	 * answer free to disagree with the highlight. It also mounts at the right moment: this component
	 * is rendered with the report, so a fragment restored from mount finds the sections that link was
	 * asking for. See `useSectionAnchor` for the rest of the reasoning.
	 */
	const pushSection = useSectionAnchor(sections, current);

	const items = useMemo(() => foldIntoGroups(sections), [sections]);
	// Which group to open for a section that scrolls into view. Built from the same array, so it can
	// only ever name a group the nav actually rendered.
	const groupOf = useMemo(() => {
		const byId = new Map<string, SectionGroup>();
		for (const { id, group } of sections) if (group !== null) byId.set(id, group);
		return byId;
	}, [sections]);

	/**
	 * Which groups are open. The first one starts open and the rest shut, which is where the reader
	 * already is: a report is read from the top, so the group holding the top of it is the one whose
	 * contents are worth the height. Deterministic rather than derived from scroll position because
	 * this renders on the server too, and a first paint that disagrees with the hydration is a flicker
	 * on every load to save an assumption that is right anyway.
	 */
	const [open, setOpen] = useState<ReadonlySet<SectionGroup>>(() => {
		const first = items.find((item) => item.kind === 'group');
		return new Set(first?.kind === 'group' ? [first.group] : []);
	});

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

	const currentGroup = current === null ? null : (groupOf.get(current) ?? null);

	/**
	 * The one group the reader shut while reading inside it, which is the one case where opening it
	 * again would be the nav arguing with them.
	 *
	 * The rule this settles: **scrolling opens the group you have arrived in, except the one you just
	 * shut, and that exception lasts until you arrive in another one.** Both halves are the annoying
	 * case avoided. Re-opening on the next section boundary would undo a deliberate click within a
	 * screen of scrolling — the group is shut *because* the reader is working inside it and wants the
	 * height back. Honouring that forever is the other annoyance: they scroll away, come back an hour
	 * later, and the section they are reading is highlighted somewhere they cannot see. Leaving and
	 * returning is a fresh arrival, so it opens.
	 *
	 * A ref rather than state: nothing renders from it, and it must not be a render's worth of stale
	 * when the observer fires.
	 */
	const dismissed = useRef<SectionGroup | null>(null);

	useEffect(() => {
		if (currentGroup === null) return;
		if (currentGroup === dismissed.current) return;
		// The reader has moved on from the group they shut, so the click stops speaking for them.
		dismissed.current = null;
		// Opening only, never shutting. A group that closed itself as the reader scrolled out of it
		// would take the list they were pointing at out from under the cursor, and the nav would move
		// while the page moved — twice the motion to make the same point.
		setOpen((groups) => (groups.has(currentGroup) ? groups : new Set(groups).add(currentGroup)));
	}, [currentGroup]);

	const toggleGroup = (group: SectionGroup, isOpen: boolean) => {
		if (isOpen) {
			if (group === currentGroup) dismissed.current = group;
		} else if (dismissed.current === group) dismissed.current = null;
		setOpen((groups) => {
			const next = new Set(groups);
			if (isOpen) next.delete(group);
			else next.add(group);
			return next;
		});
	};

	const jump = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
		// Shared with the timeline's resource labels, so a link into a section behaves the same wherever
		// it is on the page. `false` means the heading is not here — let the browser follow the href.
		if (!jumpToHeading(`${id}-heading`, event)) return;
		// Pushed, not replaced: this is the history entry the browser would have made itself if the
		// handler above had not taken the click to scroll smoothly instead. `useSectionAnchor` argues
		// it at length.
		pushSection(id);
		// Answered now rather than waiting for the observer, so the click reads as having landed even
		// while a smooth scroll is still travelling.
		setCurrent(id);
	};

	const link = ({ id, titleKey }: ReportSection, indented: boolean) => (
		<a
			href={`#${id}-heading`}
			onClick={(event) => jump(event, id)}
			// `location` rather than `page`: the section is a place inside this page, not one
			// page of several. It is also what stops the highlight from being colour alone —
			// the rule, the weight and the announcement all say the same thing.
			aria-current={current === id ? 'location' : undefined}
			className={`flex min-h-11 items-center border-l-2 py-2 pr-2 ${indented ? 'pl-6' : 'pl-3'} leading-snug transition-colors ${
				current === id
					? 'border-kick font-semibold text-ink'
					: 'border-line text-muted hover:border-muted hover:text-ink-2'
			}`}
		>
			{t(titleKey)}
		</a>
	);

	return (
		<nav
			aria-label={t('nav.label')}
			// `self-start` is load-bearing: stretched to the grid row's height the nav would have no
			// room left to travel and `sticky` would do nothing at all.
			className="hidden lg:sticky lg:top-14 lg:block lg:max-h-[calc(100vh_-_5rem)] lg:self-start lg:overflow-y-auto"
		>
			<ol className="m-0 flex list-none flex-col p-0">
				{items.map((item) => {
					if (item.kind === 'link') return <li key={item.section.id}>{link(item.section, false)}</li>;
					const isOpen = open.has(item.group);
					// The reader is inside this group and cannot see the highlight, because it is on a link
					// under a shut panel. The button says so instead — in the rule and the weight for a reader
					// who is looking, and in `aria-current` for one who is not.
					const holdsCurrent = !isOpen && item.group === currentGroup;
					return (
						<li key={item.group}>
							<button
								type="button"
								aria-expanded={isOpen}
								aria-controls={panelId(item.group)}
								// Only while shut, so there is never a second `aria-current` in the tree: with the
								// panel open the link inside it carries the reader's position, and with it shut that
								// link is `hidden` and so is not in the tree at all.
								aria-current={holdsCurrent ? 'location' : undefined}
								onClick={() => toggleGroup(item.group, isOpen)}
								className={`flex min-h-11 w-full items-center gap-2 border-l-2 py-2 pr-2 pl-3 text-left font-mono text-sm font-semibold tracking-[0.1em] uppercase transition-colors ${
									holdsCurrent ? 'border-kick text-ink' : 'border-line text-muted hover:border-muted hover:text-ink-2'
								}`}
							>
								<svg
									viewBox="0 0 12 12"
									// Decoration: the button's name is its text and its state is `aria-expanded`, so a
									// second announcement of the same thing is noise.
									aria-hidden="true"
									className={`size-3 shrink-0 transition-transform ${isOpen ? 'rotate-90' : 'rotate-0'}`}
								>
									<path
										d="M4 2.5 8 6l-4 3.5"
										fill="none"
										stroke="currentColor"
										strokeWidth="1.5"
										strokeLinecap="round"
										strokeLinejoin="round"
									/>
								</svg>
								{t(GROUP_TITLE[item.group])}
							</button>
							{/* `hidden` rather than an unmount: the whole argument is in the component's docstring.
							    The animation plays when the panel comes back from `display: none`, so it marks the
							    opening and nothing else — and the global `prefers-reduced-motion` rule cuts it to
							    nothing for a reader who has asked for less of it, the same as the rotation's rungs. */}
							<ol
								id={panelId(item.group)}
								hidden={!isOpen}
								className="m-0 flex animate-panel-in list-none flex-col p-0"
							>
								{item.sections.map((section) => (
									<li key={section.id}>{link(section, true)}</li>
								))}
							</ol>
						</li>
					);
				})}
			</ol>
		</nav>
	);
}
