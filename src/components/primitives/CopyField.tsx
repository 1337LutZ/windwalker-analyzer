import { useEffect, useRef, useState } from 'react';

import { buttonClass } from './controls';

/**
 * A value the reader has to reproduce somewhere else, exactly.
 *
 * Read-only and selectable rather than an input: there is nothing to edit, and a real input invites
 * a stray keystroke into a string whose whole point is that it is byte-exact. `break-all` because
 * the values here are URLs with no spaces to wrap at, and a URL that overflows its box is one the
 * reader cannot check.
 *
 * The copy button is the feature. Anything asked to be transcribed by hand will eventually be
 * transcribed wrong.
 */
export default function CopyField({ label, value }: { label: string; value: string }) {
	const [copied, setCopied] = useState(false);
	// Copying twice quickly would otherwise let the first timer reset the label while the second copy
	// is still fresh.
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

	useEffect(() => () => clearTimeout(timer.current), []);

	const copy = () => {
		// `writeText` rejects without a user gesture, over plain HTTP, and wherever the permission is
		// refused. The value is on screen and selectable in every one of those cases, so the fallback
		// is to say nothing rather than to raise an error about a convenience.
		void navigator.clipboard?.writeText(value).then(
			() => {
				setCopied(true);
				clearTimeout(timer.current);
				timer.current = setTimeout(() => setCopied(false), 2000);
			},
			() => undefined,
		);
	};

	return (
		<div className="flex flex-col gap-2">
			<span className="block font-mono text-sm font-medium tracking-[0.1em] text-muted uppercase">{label}</span>
			<div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
				<code className="flex flex-1 items-center rounded-sm border border-line bg-bg px-3 py-2 font-mono text-base break-all text-ink">
					{value}
				</code>
				<button type="button" onClick={copy} className={`${buttonClass} shrink-0`}>
					{copied ? 'Copied' : 'Copy'}
				</button>
			</div>
			{/* Polite, and separate from the button's own label: a screen reader should hear that the copy
			    happened without the button renaming itself under the user's cursor. */}
			<span aria-live="polite" className="sr-only">
				{copied ? `${label} copied to the clipboard` : ''}
			</span>
		</div>
	);
}
