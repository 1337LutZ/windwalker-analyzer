import { useTranslation } from 'react-i18next';

import '~/lib/i18n';
import { useSession } from '~/lib/auth';

import SignInPanel from './auth/SignInPanel';
import { Step } from './primitives';
import { pageShellClass } from './primitives/pageShell';
import ReportFlow from './report/ReportFlow';

/**
 * The page: what the app is, then the steps that produce a report.
 *
 * Step one is here because it is the only step that is not about a report. Everything from the
 * report code down — including the report itself, which has to appear and scroll into view the
 * moment its fetch lands — belongs to `ReportFlow`.
 */
export default function Analyzer() {
	const { token } = useSession();
	// The shell's own copy, in the `ui` namespace — `report` is the analysis, and the two are written
	// and translated by different concerns.
	const { t } = useTranslation('ui');

	return (
		<main className={pageShellClass}>
			<header className="mb-2 flex flex-col gap-3">
				<p className="m-0 font-mono text-sm font-medium tracking-[0.16em] uppercase text-muted">{t('app.eyebrow')}</p>
				<h1 className="m-0 flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[26px] leading-[1.05] font-semibold tracking-[-0.02em] text-balance text-ink sm:text-[32px] md:text-[38px]">
					{t('app.title')}
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
				<p className="m-0 max-w-[60ch] leading-relaxed text-ink-2">{t('app.intro')}</p>
			</header>

			<Step
				index={1}
				title={t('steps.signIn')}
				hint={token === null ? undefined : t('steps.thisTabOnly')}
				state={token === null ? 'active' : 'done'}
			>
				<SignInPanel />
			</Step>

			<ReportFlow />

			<footer className="mt-8 border-t border-line pt-5">
				<p className="m-0 max-w-[70ch] leading-relaxed text-muted">{t('app.privacy')}</p>
			</footer>
		</main>
	);
}
