import { Dialog } from '@base-ui/react/dialog';

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
	return (
		<DialogShell
			trigger={
				<Dialog.Trigger className={`${buttonClass} w-full sm:w-auto`}>What happens when I sign in?</Dialog.Trigger>
			}
			title="Signing in to WarcraftLogs"
			description="You sign in on WarcraftLogs' own page, not this one. Your password is typed there and this app never sees it — WarcraftLogs asks you whether to let the analyser read your logs, and only your answer comes back."
		>
			<div className="flex flex-col gap-3 leading-relaxed text-ink-2">
				<p className="m-0">
					What comes back is an access token. It is held in this browser tab, sent to{' '}
					<code className="font-mono text-ink">warcraftlogs.com</code> as an{' '}
					<code className="font-mono text-ink">Authorization</code> header, and sent nowhere else. This page has no
					server to send it to: it is a folder of static files, and the content-security policy it ships makes your
					browser enforce that whatever the JavaScript intends.
				</p>
				<p className="m-0">
					Closing this tab discards it. Nothing is written to a cookie, and nothing survives that outlives the tab — on
					a shared machine there is nothing to remember to clean up. Signing out clears it immediately, and you can
					revoke the app's access from your WarcraftLogs account whenever you like.
				</p>
				<p className="m-0">
					The underlying API, and what the analyser reads with that token, is documented at{' '}
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
				<Dialog.Close className={buttonClass}>Close</Dialog.Close>
			</div>
		</DialogShell>
	);
}
