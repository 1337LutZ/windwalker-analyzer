import type { ReactNode } from 'react';
import { Dialog } from '@base-ui/react/dialog';

const backdropClass =
	'fixed inset-0 z-40 min-h-dvh bg-bg/80 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0';
const popupClass =
	'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-sm border border-line bg-surface p-5 text-ink transition-[scale,opacity] duration-150 data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0 sm:p-6';

/** Shared centered dialog chrome; callers retain control of the trigger and content. */
export default function DialogShell({
	trigger,
	title,
	description,
	children,
}: {
	trigger: ReactNode;
	title: ReactNode;
	description: ReactNode;
	children: ReactNode;
}) {
	return (
		<Dialog.Root>
			{trigger}
			<Dialog.Portal>
				<Dialog.Backdrop className={backdropClass} />
				<Dialog.Popup className={popupClass}>
					<Dialog.Title className="m-0 font-mono text-lg font-semibold tracking-[-0.01em] text-ink">
						{title}
					</Dialog.Title>
					<Dialog.Description className="m-0 leading-relaxed text-ink-2">{description}</Dialog.Description>
					{children}
				</Dialog.Popup>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
