import { useTranslation } from 'react-i18next';

import '~/lib/i18n';
import { useSession } from '~/lib/auth';
import type { SpecDefinition } from '~/lib/spec';

import SignInPanel from './auth/SignInPanel';
import { Step } from './primitives';
import { pageShellClass } from './primitives/pageShell';
import { buttonClass } from './primitives/controls';
import { compareRoute, specRoute } from './SpecPicker';
import CompareFlow from './compare/CompareFlow';
import ReportFlow from './report/ReportFlow';

/**
 * The page: what the app is, then the steps that produce a report.
 *
 * Step one is here because it is the only step that is not about a report. Everything from the
 * report code down — including the report itself, which has to appear and scroll into view the
 * moment its fetch lands — belongs to `ReportFlow`.
 *
 * The header names a spec, and it takes that spec as a prop rather than reading `useSpec()` —
 * deliberately, and the one place in the tree where that is the right read. This sits above every
 * report, so there is no `SpecContext` provider over it and nothing to read from one; and what it is
 * saying is a statement about the *page* — which spec this address analyses — not about an analysis.
 * That is exactly the distinction `specContext.ts` draws when it refuses a default: a section inside a
 * report must never fall back to some ambient spec, because "the spec the page is about" is not an
 * answer to "the spec this pull belongs to". Here the question genuinely is the page's.
 * `pages/[class]/[spec].astro` gives the page's own `<title>` the same reading from the same value,
 * and the two have to agree.
 */
/**
 * The address of the sibling page for the page you are on.
 *
 * Pulled out of the JSX because it is the part that can be wrong. The two arms are one ternary on
 * `mode`, and a ternary is as easy to write backwards as forwards — a compare page offering its own
 * address is a working link to nowhere new, which no type and no render check would catch. Rendering
 * `Analyzer` cannot check it either: the component reaches for a session on its first line, so a static
 * render throws before it emits the anchor, and the test that tried it was passing over an empty string.
 *
 * **The label is deliberately not in here with it.** Returning the copy *key* alongside the href is the
 * tidier shape and it breaks a guard: `keys.test.ts` finds shell copy by reading `t('…')` with a literal
 * inside, so a key reached through a returned field reads as copy nothing asks for and is deleted by the
 * pass that exists to delete it. `AnalysisModeControl` records the same trap for the same reason. So the
 * two keys stay spelled out at the call site and only the address travels.
 */
export function siblingHref(spec: SpecDefinition, mode: 'report' | 'compare'): string {
	return mode === 'compare' ? specRoute(spec) : compareRoute(spec);
}

export default function Analyzer({ spec, mode = 'report' }: { spec: SpecDefinition; mode?: 'report' | 'compare' }) {
	const { token } = useSession();
	// The shell's own copy, in the `ui` namespace — `report` is the analysis, and the two are written
	// and translated by different concerns.
	const { t } = useTranslation('ui');
	const siblingUrl = siblingHref(spec, mode);

	return (
		<main className={pageShellClass}>
			<header className="mb-2 flex flex-col gap-3">
				{/* Interpolated rather than a string per spec: the eyebrow and the title are the spec's name in
				    a fixed frame, and copy per spec would be two more sentences to keep in step with the
				    registry every time it grows. `specName` in the eyebrow, where the line is already the
				    expansion and the short form reads; `displayName` in the heading, which is what
				    `[class]/[spec].astro` puts in the browser tab — the tab and the h1 saying different things
				    would read as two different pages. */}
				<p className="m-0 font-mono text-sm font-medium tracking-[0.16em] uppercase text-muted">
					{t('app.eyebrow', { spec: spec.specName })}
				</p>
				<h1 className="m-0 flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[26px] leading-[1.05] font-semibold tracking-[-0.02em] text-balance text-ink sm:text-[32px] md:text-[38px]">
					{t('app.title', { spec: spec.displayName })}
					{/* Inside the heading rather than beside it, so a screen reader announces the stage with the
					    name instead of leaving it as a stray word after the title. Amber, not rose: this is a
					    caveat about the report's maturity, not an error state. `title` carries what alpha means
					    here — the numbers are measured, the thresholds and wording are not settled. */}
					<span
						title={t('app.stageNote')}
						className="rounded-sm border border-brew px-2 py-[3px] align-middle font-mono text-sm font-medium tracking-[0.1em] uppercase text-brew"
					>
						{t('app.stage')}
					</span>
				</h1>
				{/* Not interpolated, because this paragraph is not a frame with a name in it: what the report
				    measures differs per spec, and a sentence about Tigereye Brew is false about a shaman. An
				    i18next context picks the whole paragraph — `app.intro_windwalker`, `app.intro_elemental`
				    — which is the mechanism the Flame Shock verdicts already use, and a spec with no
				    paragraph of its own renders the key rather than another spec's claims. */}
				<p className="m-0 max-w-[60ch] leading-relaxed text-ink-2">{t('app.intro', { context: spec.key })}</p>

				{/*
				 * The other page for this spec, from the page you are on.
				 *
				 * **A link and not a tab strip, because these are not two views of one thing.** The report reads
				 * one pull and the compare page reads two; they take different selections and are different
				 * addresses on purpose — `[spec]/compare.astro` says the address is the thing being shared. A
				 * strip would promise the pages are interchangeable and lose the reader's selection when they
				 * turned out not to be.
				 *
				 * In the header rather than the footer: a reader who arrived on a bookmark has no other way to
				 * find the sibling page short of going back to the landing page, and the header is where they
				 * are already reading which spec this is.
				 *
				 * `buttonClass` rather than a third copy of the underlined-link style this tree keeps declaring
				 * locally — this is a control that moves you, not a link inside a sentence, and the shared class
				 * brings hover and focus states with it. `self-start` so it is as wide as its own words in a
				 * column that stretches everything else.
				 */}
				<a className={`${buttonClass} self-start no-underline`} href={siblingUrl}>
					{mode === 'compare' ? t('app.toReport') : t('app.toCompare')}
				</a>
			</header>

			<Step
				index={1}
				title={t('steps.signIn')}
				hint={token === null ? undefined : t('steps.thisTabOnly')}
				state={token === null ? 'active' : 'done'}
			>
				<SignInPanel />
			</Step>

			{mode === 'compare' ? <CompareFlow spec={spec} /> : <ReportFlow spec={spec} />}

			<footer className="mt-8 border-t border-line pt-5">
				<p className="m-0 max-w-[70ch] leading-relaxed text-muted">{t('app.privacy')}</p>
			</footer>
		</main>
	);
}
