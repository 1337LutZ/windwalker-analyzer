import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import '~/lib/i18n';

import { inspectToken, useSession } from '~/lib/auth';

import ApiCredits from '../ApiCredits';
import { Callout } from '../primitives';
import { buttonClass } from '../primitives/controls';

import ClientIdPanel from './ClientIdPanel';
import ManualTokenForm from './ManualTokenForm';
import SignInButton from './SignInButton';
import TokenHelp from './TokenHelp';

/**
 * The first step of the flow: prove who you are to WarcraftLogs. Two ways in, one session out of
 * either — the button, which is what almost everyone wants, and a pasted token folded away beneath
 * it for the people who already have one.
 *
 * The signed-in state never renders the token — not masked, not truncated, not in a `value` a
 * screenshot or a devtools pane would pick up. It says only that one exists, which is all anyone
 * needs to know to carry on.
 */
export default function SignInPanel() {
	const { token, source, status, error, errorIsExpiry, signOut } = useSession();
	const { t } = useTranslation('ui');

	// An expiry is not a failed attempt, and heading it as one tells someone who never touched the
	// button that they did something wrong. `errorIsExpiry` carries the distinction.
	//
	// **One pair of keys, hoisted, and read from both branches below.** The ternary was written out
	// twice — once in each branch — and moving it into the locale as written would have put the same
	// two sentences in the file under four names. The orphan hunt in `lib/i18n/__tests__/keys.test.ts`
	// could not have caught that, because all four would have had a reader.
	const failureTitle = errorIsExpiry ? t('auth.failure.expiredTitle') : t('auth.failure.unfinishedTitle');

	// Reading the payload is only ever used to say something useful; it proves nothing, and a token
	// this page cannot read is one it says nothing about. A signed-in token is always a user token, so
	// this notice is a pasted-token affair by construction.
	const publicOnly = useMemo(() => token !== null && inspectToken(token).kind === 'client', [token]);

	if (status === 'signed-in') {
		return (
			<div className="flex flex-col gap-4">
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<p className="m-0 leading-relaxed text-ink-2">
						<span className="font-mono font-semibold text-kick">
							{source === 'manual' ? t('auth.session.manual') : t('auth.session.oauth')}
						</span>{' '}
						{t('auth.session.tabOnly')}
					</p>
					<button type="button" className={`${buttonClass} w-full sm:w-auto`} onClick={signOut}>
						{source === 'manual' ? t('auth.session.forgetToken') : t('auth.session.signOut')}
					</button>
				</div>

				{/* A failed sign-in no longer takes the session with it — a callback that cannot be validated
				    says nothing about a token this tab already holds, and destroying it was the bug. But that
				    leaves a failure with a live session behind it, which this branch used to render nothing
				    for: someone who pressed the button to switch accounts and was refused saw no answer at
				    all. So the message is shown here too, and the session it did not damage is stated above
				    it. */}
				{error !== null ? (
					<Callout title={failureTitle}>
						<p className="m-0">{error}</p>
					</Callout>
				) : null}

				{/* What the token can still spend. Beneath the line that says a session exists, because it
				    is a fact about that session — and it appears here rather than only on the report's
				    toolbar so that the budget is visible before anything has been spent against it. */}
				<ApiCredits />

				{publicOnly ? (
					<Callout tone="brew" title={t('auth.public.title')}>
						<p className="m-0">{t('auth.public.body')}</p>
						{/* Two keys around the emphasis, because the `<strong>` sits inside the sentence. There is
						    no `<Trans>` anywhere in this repo, and taking the dependency for one sentence is worse
						    than splitting it. */}
						<p className="m-0">
							{t('auth.public.catchBefore')}{' '}
							<strong className="font-semibold text-ink">{t('auth.public.catchEmphasis')}</strong>
							{t('auth.public.catchAfter')}
						</p>
					</Callout>
				) : null}
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			<p className="m-0 max-w-[64ch] leading-relaxed text-ink-2">{t('auth.signIn.intro')}</p>

			<ClientIdPanel />

			{error !== null ? (
				<Callout title={failureTitle}>
					<p className="m-0">{error}</p>
				</Callout>
			) : null}

			<div className="flex flex-col gap-3 sm:flex-row sm:items-center">
				<SignInButton />
				<TokenHelp />
			</div>

			{/* Signed out this says only that a budget exists and where it will appear, which is the one
			    honest thing to say: the figure is a property of a token nobody has yet. */}
			<ApiCredits />

			<ManualTokenForm />
		</div>
	);
}
