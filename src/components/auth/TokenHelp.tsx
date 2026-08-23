import { Dialog } from '@base-ui/react/dialog';
import { useTranslation } from 'react-i18next';

import '~/lib/i18n';

import { DialogShell } from '../primitives';
import { buttonClass } from '../primitives/controls';

const linkClass = 'text-kick underline underline-offset-2';

/**
 * What signing in actually does, for someone who has never touched the WarcraftLogs API.
 *
 * A Base UI `Dialog` rather than a hand-built one: focus trapping, restore-on-close, Escape and the
 * ARIA wiring come with it, and none of them are things to reimplement for a help panel.
 *
 * No token, real or invented, appears anywhere in here. An example that looks like a credential is
 * the thing people copy.
 */
export default function TokenHelp() {
	const { t } = useTranslation('ui');

	return (
		<DialogShell
			trigger={<Dialog.Trigger className={`${buttonClass} w-full sm:w-auto`}>{t('auth.help.trigger')}</Dialog.Trigger>}
			title={t('auth.help.title')}
			description={t('auth.help.description')}
		>
			<div className="flex flex-col gap-3 leading-relaxed text-ink-2">
				<p className="m-0">
					{t('auth.help.tokenBefore')} <code className="font-mono text-ink">warcraftlogs.com</code>{' '}
					{t('auth.help.tokenBetween')} <code className="font-mono text-ink">Authorization</code>{' '}
					{t('auth.help.tokenAfter')}
				</p>
				<p className="m-0">{t('auth.help.tab')}</p>
				<p className="m-0">
					{t('auth.help.docs')}{' '}
					<a
						className={linkClass}
						href="https://www.warcraftlogs.com/api/docs"
						target="_blank"
						rel="noopener noreferrer"
					>
						warcraftlogs.com/api/docs
					</a>
					.
				</p>
			</div>

			<div className="flex justify-end pt-1">
				<Dialog.Close className={buttonClass}>{t('auth.help.close')}</Dialog.Close>
			</div>
		</DialogShell>
	);
}
