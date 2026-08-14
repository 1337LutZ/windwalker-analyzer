import { Collapsible } from '@base-ui/react/collapsible';

import { useSession } from '~/lib/auth';

import { buttonClass } from '../primitives';

import ClientIdSetup from './ClientIdSetup';

/**
 * Where the API client lives in the sign-in step, and how much room it takes up.
 *
 * Registering one is a real chunk of instructions, and it is unavoidable — WarcraftLogs meters per
 * client, so nobody can sign in on somebody else's. But it is a once-ever chunk, so it is front and
 * centre until it is done and folded away afterwards.
 *
 * Folded away, not gone: the id is worth being able to see and change. Showing it back is safe in a
 * way showing a token never is — PKCE publishes the client id with every sign-in, so it is
 * configuration on display, not a credential leaking onto the screen.
 */
export default function ClientIdPanel() {
	const { clientID, forgetClientID } = useSession();

	if (clientID === null) return <ClientIdSetup />;

	return (
		<Collapsible.Root className="flex flex-col gap-3 rounded-sm border border-line bg-surface p-4">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<p className="m-0 leading-relaxed text-ink-2">
					Signing in with your own API client,{' '}
					<code className="font-mono break-all text-ink">{clientID}</code>.
				</p>
				<Collapsible.Trigger className="group inline-flex min-h-11 shrink-0 items-center gap-2 rounded-sm text-left font-mono text-sm font-semibold tracking-[0.1em] text-muted uppercase transition-colors hover:text-ink">
					Change
					<span aria-hidden="true" className="transition-transform group-data-panel-open:rotate-180">
						&darr;
					</span>
				</Collapsible.Trigger>
			</div>

			<Collapsible.Panel className="flex flex-col gap-3">
				<ClientIdSetup />
				<div className="flex justify-end">
					<button type="button" className={`${buttonClass} w-full sm:w-auto`} onClick={forgetClientID}>
						Forget this client
					</button>
				</div>
			</Collapsible.Panel>
		</Collapsible.Root>
	);
}
