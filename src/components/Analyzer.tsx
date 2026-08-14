import { useTranslation } from 'react-i18next';

import '~/lib/i18n';
import { useSession } from '~/lib/auth';

import SignInPanel from './auth/SignInPanel';
import { Step } from './primitives';
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
		<main className="mx-auto flex w-full max-w-[1280px] flex-col gap-4 px-4 pt-8 pb-16 sm:gap-5 sm:px-6 sm:pt-10 md:px-8 md:pt-12 md:pb-20 2xl:max-w-[1440px]">
			<header className="mb-2 flex flex-col gap-3">
				<p className="m-0 font-mono text-sm font-medium tracking-[0.16em] uppercase text-muted">{t('app.eyebrow')}</p>
				<h1 className="m-0 font-mono text-[26px] leading-[1.05] font-semibold tracking-[-0.02em] text-balance text-ink sm:text-[32px] md:text-[38px]">
					{t('app.title')}
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
