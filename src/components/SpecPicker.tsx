// The splash, and the whole of the 404 page: which spec do you want read?
//
// One build serves every spec by route now, so the site root is not a report page any more — it is the
// question the route answers. **It never guesses.** A pull is scored against the spec it is told,
// and an Elemental log read as a monk produces a report that is confidently wrong at every heading;
// one click is cheap against that.
//
// The same picker answers an address this build does not serve, because the two cases want the same
// thing from the reader. `pages/404.astro` renders it with `unknownAddress`, which adds a line and
// changes nothing else.
//
// **The old query still works, and this is where it is honoured.** `/?report=…&spec=elemental` was
// the whole address bar before the routes existed, and links in that spelling are in Discord
// messages and in browser histories. A resolvable `?spec=` is forwarded to its route with the rest of
// the query and the fragment intact; anything else falls through to the picker with the report
// carried on every link, so one click finishes what the link started.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import '~/lib/i18n';
import { hasCallbackParams, URL_RESTORED_EVENT } from '~/lib/auth';
import { getSpec, SPECS, type SpecDefinition } from '~/lib/spec';

import { pageShellClass } from './primitives/pageShell';
import { spellIconUrl } from './primitives/spellIcon';

/**
 * The deployment's own path prefix, with the trailing slash taken off so a route can be joined to it.
 *
 * **Nothing in `src/` read this before the routes existed, and that was survivable while there was one
 * page.** GitHub Pages serves this project under `/<repo>/`, so a link written as `/monk/windwalker`
 * is a link to somebody else's site there — it resolves against the origin, not against the base. The
 * value is inlined at build time, so a build for one host cannot ship the other's links.
 *
 * `BASE_URL` is `/` for a root deployment and `/windwalker-analyzer/` for the project site. Trimming
 * the slash rather than trusting either spelling keeps the join to one form: `${BASE}/monk/windwalker`
 * is `/monk/windwalker` in the first case and `/windwalker-analyzer/monk/windwalker` in the second.
 */
const BASE = import.meta.env.BASE_URL.replace(/\/+$/, '');

/** Where one spec's report lives. Class before spec, because `restoration` alone names two of them. */
export function specRoute(spec: SpecDefinition): string {
	return `${BASE}/${spec.classSlug}/${spec.key}`;
}

/**
 * The query a picked link carries over, less the `?spec=` the path now answers.
 *
 * Dropped rather than passed on so that an address never names a spec twice. The two can disagree —
 * a hand-edited link, or a route opened from a bookmark whose query outlived it — and then whichever
 * of the two the page happens to read is a coin toss the reader cannot see.
 */
function carried(search: string): string {
	const params = new URLSearchParams(search);
	params.delete('spec');
	const rest = params.toString();
	return rest === '' ? '' : `?${rest}`;
}

/**
 * One spec's route, carrying whatever else the address bar was holding.
 *
 * The fragment goes too. `useSectionAnchor` writes which section the reader was at, and a link shared
 * out of a report is a link to the paragraph that made the point; dropping it here would quietly
 * demote every one of those to a link to the top of the page.
 */
export function specHref(spec: SpecDefinition, search: string, hash: string): string {
	return `${specRoute(spec)}${carried(search)}${hash}`;
}

/**
 * Where a `?spec=` address migrates to, or null when nothing in it names a registered spec.
 *
 * Null covers both halves of "never guess": a link with no spec in it at all, and a link naming one
 * this build does not have. Neither is a reason to pick for the reader, and the second is the louder
 * of the two — a retired or misspelled key resolving to the first entry in the registry is how a
 * shaman gets read as a monk.
 */
export function migrationTarget(search: string, hash: string): string | null {
	const named = new URLSearchParams(search).get('spec');
	const spec = named === null || named === '' ? undefined : getSpec(named);
	return spec === undefined ? null : specHref(spec, search, hash);
}

interface SpecPickerProps {
	/** Whether the reader asked for an address this build does not serve. `pages/404.astro` sets it. */
	unknownAddress?: boolean;
}

export default function SpecPicker({ unknownAddress = false }: SpecPickerProps) {
	// The shell's own copy, in the `ui` namespace — `report` is the analysis, and there is no analysis
	// on this page.
	const { t } = useTranslation('ui');
	/**
	 * The address bar, read once on mount.
	 *
	 * `window` does not exist during Astro's prerender, so this cannot be a lazy initialiser — the same
	 * constraint `useInitialUrlSelection` is built around. It also cannot be anything else: one static
	 * document is served to every reader, so the query in the prerendered links is nobody's, and the
	 * hydrating island is the first thing on the page that knows which link was followed.
	 */
	const [address, setAddress] = useState({ search: '', hash: '' });
	useEffect(() => {
		const read = () => {
			// **A sign-in landing here owns the address bar until it is finished with it.** The root is
			// where every OAuth callback arrives — see `Splash` — so the query on this page can be a live
			// authorization code, and a picker link built from that query would be a link carrying a
			// credential into another document and into whatever the reader pastes it in. So this reads
			// nothing while one is in flight, and the links stay the bare routes they were prerendered as.
			if (hasCallbackParams()) return;
			const { search, hash } = window.location;
			const target = migrationTarget(search, hash);
			if (target === null) {
				setAddress({ search, hash });
				return;
			}
			// `replace`, not `assign`: the old address answered this question already, so leaving it in
			// the history would make Back a way of asking it again and being sent straight back here.
			window.location.replace(target);
		};
		read();
		// The second read, for the case above: `stripCallbackParams` announces when it has put a shared
		// link's query back, which is the moment this page's own address becomes readable again. The
		// same announcement `useInitialUrlSelection` listens to, for the same ordering reason.
		window.addEventListener(URL_RESTORED_EVENT, read);
		return () => window.removeEventListener(URL_RESTORED_EVENT, read);
	}, []);

	// An empty `?report=` is not a report, the same reading `useReportUrlState.parse` takes of it: the
	// line below promises the reader their link survived the click, and it must not promise that of a
	// key with nothing behind it.
	const carrying = (new URLSearchParams(address.search).get('report') ?? '') !== '';

	return (
		<main className={pageShellClass}>
			<header className="mb-2 flex flex-col gap-3">
				<h1 className="m-0 font-mono text-[26px] leading-[1.05] font-semibold tracking-[-0.02em] text-balance text-ink sm:text-[32px] md:text-[38px]">
					{t('app.pickTitle')}
				</h1>
				{unknownAddress ? <p className="m-0 max-w-[60ch] leading-relaxed text-ink-2">{t('app.pickUnknown')}</p> : null}
				<p className="m-0 max-w-[60ch] leading-relaxed text-ink-2">
					{carrying ? t('app.pickCarried') : t('app.pickIntro')}
				</p>
			</header>

			{/* A list, because it is one: a reader on a screen reader is told how many specs there are before
			    working through them. Cards rather than the rows the fight and player pickers draw — those
			    two choose *within* a report and belong to it, and this one chooses which report to build at
			    all. It is the only question on the page, and a row of full-width bars reads as a menu rather
			    than as the thing the page is for.

			    The grid is one column until there is room for two, so the cards never narrow to the point
			    where the icon crowds the name. */}
			<ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2">
				{SPECS.map((spec) => {
					const icon = spellIconUrl(spec.iconSpellId);
					return (
						<li key={specRoute(spec)} className="contents">
							<a
								href={specHref(spec, address.search, address.hash)}
								// The class colour on the border, and only there. It is the one thing on the splash
								// that is a spec's own — the page itself is deliberately neutral, so a card carries
								// its identity without the ground taking a side before the reader has picked.
								className="flex items-center gap-4 rounded-sm border border-line bg-surface p-4 no-underline transition-colors hover:border-muted"
								style={{ borderLeftWidth: '2px', borderLeftColor: spec.colors.primary }}
							>
								{/* `alt=""` and `aria-hidden`: the name is beside it in text, so a screen reader
								    announcing the icon would read the spec twice. Null for an id the spell map does
								    not know, which `registry.test.ts` refuses — so this branch is the runtime half
								    of a guard rather than a fallback anybody should see. */}
								{icon === null ? null : (
									<img
										src={icon}
										alt=""
										aria-hidden="true"
										width={40}
										height={40}
										loading="lazy"
										decoding="async"
										className="h-10 w-10 shrink-0 rounded-[3px] border border-line/60"
									/>
								)}
								<span className="flex flex-col gap-0.5">
									<span className="font-mono text-base font-medium text-ink">{spec.specName}</span>
									<span className="text-sm text-ink-2">{spec.classKey}</span>
								</span>
							</a>
						</li>
					);
				})}
			</ul>

			<footer className="mt-8 border-t border-line pt-5">
				<p className="m-0 max-w-[70ch] leading-relaxed text-muted">{t('app.privacy')}</p>
			</footer>
		</main>
	);
}
