import type { ReactNode } from 'react';
import { Dialog } from '@base-ui/react/dialog';

import { buttonClass } from './controls';

const backdropClass =
	'fixed inset-0 z-40 min-h-dvh bg-bg/80 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0';
const popupShared =
	'z-50 flex flex-col gap-4 overflow-y-auto rounded-sm border border-line bg-surface text-ink transition-[scale,opacity] duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0';

/**
 * Prose reads at 34rem; a table does not; a picture wants the screen.
 *
 * `prose` is the reading width every dialog here has had, and it is right for a paragraph or two. A
 * dialog whose content is a grid needs the room its columns ask for — below it the table grows a
 * horizontal scrollbar and hides its last columns behind the edge, which is how the per-encounter
 * figures first shipped. Both cap at the viewport, so neither escapes a narrow screen.
 *
 * `full` is the third, for content that is a drawing rather than a document: a map of a pull inside a
 * 52rem box is a map of a pull the reader has to squint at, and the room is the whole point of opening
 * it. `inset-2 sm:inset-4` rather than a true edge-to-edge — the same geometry `CastLog` already uses
 * for the same reason, so the app has one full-screen dialog shape and not two that nearly agree. It
 * takes a `closeLabel`, because a dialog with no visible backdrop has nothing to click past.
 *
 * **The geometry is per variant rather than overrides layered on one base.** `top-1/2` and `inset-2`
 * are both Tailwind utilities setting the same properties, and which one wins is decided by the order
 * they sit in the stylesheet rather than the order they sit in the class attribute — so a `full`
 * built by appending overrides to the centred base is a coin flip that happens to land right today.
 */
const popups = {
	prose: `${popupShared} fixed top-1/2 left-1/2 max-h-[calc(100dvh-2rem)] w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 p-5 data-ending-style:scale-[0.98] data-starting-style:scale-[0.98] sm:p-6`,
	table: `${popupShared} fixed top-1/2 left-1/2 max-h-[calc(100dvh-2rem)] w-[min(52rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 p-5 data-ending-style:scale-[0.98] data-starting-style:scale-[0.98] sm:p-6`,
	full: `${popupShared} fixed inset-2 p-4 data-ending-style:scale-[0.99] data-starting-style:scale-[0.99] sm:inset-4 sm:p-6`,
};

/** Shared dialog chrome; callers retain control of the trigger and content. */
export default function DialogShell({
	trigger,
	title,
	description,
	children,
	width = 'prose',
	closeLabel,
}: {
	trigger: ReactNode;
	title: ReactNode;
	description: ReactNode;
	children: ReactNode;
	/** `table` when the content is a grid rather than prose, `full` when it is a drawing — see `popups`. */
	width?: keyof typeof popups;
	/**
	 * The words on the close button, which only the `full` variant draws.
	 *
	 * Copy belongs to the caller and not to shared chrome: this module has no namespace of its own and a
	 * string hardcoded here would be one line of the interface no locale could reach. The centred
	 * variants need no button — the backdrop around them is the way out, and Escape closes all three.
	 */
	closeLabel?: ReactNode;
}) {
	const full = width === 'full';
	return (
		<Dialog.Root>
			{trigger}
			<Dialog.Portal>
				<Dialog.Backdrop className={backdropClass} />
				<Dialog.Popup className={popups[width]}>
					<div className="flex items-start justify-between gap-4">
						<Dialog.Title className="m-0 font-mono text-lg font-semibold tracking-[-0.01em] text-ink">
							{title}
						</Dialog.Title>
						{full && closeLabel !== undefined ? (
							<Dialog.Close className={`${buttonClass} shrink-0 px-3`}>{closeLabel}</Dialog.Close>
						) : null}
					</div>
					{/* Kept for the dialog's accessible description, which Base UI wires to the popup. Read out
					    on the centred variants and only announced on `full`, where the width belongs to the
					    content and a paragraph above it is the first thing that would push the drawing down. */}
					<Dialog.Description className={full ? 'sr-only' : 'm-0 leading-relaxed text-ink-2'}>
						{description}
					</Dialog.Description>
					{children}
				</Dialog.Popup>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
