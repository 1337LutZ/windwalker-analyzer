import { Dialog } from '@base-ui/react/dialog';

import { buttonClass } from '../primitives';

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
		<Dialog.Root>
			<Dialog.Trigger className={`${buttonClass} w-full sm:w-auto`}>What happens when I sign in?</Dialog.Trigger>
			<Dialog.Portal>
				<Dialog.Backdrop className="fixed inset-0 z-40 min-h-dvh bg-bg/80 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
				<Dialog.Popup className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-sm border border-line bg-surface p-5 text-ink transition-[scale,opacity] duration-150 data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0 sm:p-6">
					<Dialog.Title className="m-0 font-mono text-lg font-semibold tracking-[-0.01em] text-ink">
						Signing in to WarcraftLogs
					</Dialog.Title>

					<Dialog.Description className="m-0 leading-relaxed text-ink-2">
						You sign in on WarcraftLogs' own page, not this one. Your password is typed there and this app never sees it
						— WarcraftLogs asks you whether to let the analyser read your logs, and only your answer comes back.
					</Dialog.Description>

					<div className="flex flex-col gap-3 leading-relaxed text-ink-2">
						<p className="m-0">
							What comes back is an access token. It is held in this browser tab, sent to{' '}
							<code className="font-mono text-ink">warcraftlogs.com</code> as an{' '}
							<code className="font-mono text-ink">Authorization</code> header, and sent nowhere else. This page has no
							server to send it to: it is a folder of static files, and the content-security policy it ships makes your
							browser enforce that whatever the JavaScript intends.
						</p>
						<p className="m-0">
							Closing this tab discards it. Nothing is written to a cookie, and nothing survives that outlives the tab —
							on a shared machine there is nothing to remember to clean up. Signing out clears it immediately, and you
							can revoke the app's access from your WarcraftLogs account whenever you like.
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
				</Dialog.Popup>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
