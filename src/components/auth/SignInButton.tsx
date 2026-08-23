import { useTranslation } from 'react-i18next';

import '~/lib/i18n';

import { useSession } from '~/lib/auth';

import { primaryButtonClass } from '../primitives/controls';

/**
 * Starts the PKCE flow. There is nothing to type and nothing to paste: the next thing the visitor
 * sees is WarcraftLogs' own login page.
 *
 * Disabled until this browser has a client id, because the button would otherwise promise something
 * that cannot happen. What is missing is explained above it — in the setup panel that is asking for
 * exactly that id — rather than in a tooltip on a dead button.
 */
export default function SignInButton() {
	const { status, clientID, signIn } = useSession();
	const { t } = useTranslation('ui');
	const busy = status === 'unknown' || status === 'signing-in';

	return (
		<button
			type="button"
			className={`${primaryButtonClass} w-full sm:w-auto`}
			onClick={signIn}
			disabled={busy || clientID === null}
		>
			{status === 'signing-in' ? t('auth.signIn.opening') : t('auth.signIn.button')}
		</button>
	);
}
