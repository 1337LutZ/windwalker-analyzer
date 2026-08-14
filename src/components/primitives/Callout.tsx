import type { ReactNode } from 'react';

const CALLOUT_TONE = {
	miss: 'border-miss/60',
	brew: 'border-brew/60',
	kick: 'border-kick/60',
} as const;

/**
 * A refusal or a warning that must not read as a number. Never used for ordinary body copy.
 *
 * `role="alert"` and not a Base UI `Toast`: a toast is transient and self-dismissing, and every one
 * of these says why the app stopped and what to do about it — it has to stay on screen until the
 * reader has done that. Base UI's `AlertDialog` is the other near miss, and it is modal, which
 * would trap focus over a page that is still perfectly usable.
 */
export default function Callout({
	tone = 'miss',
	title,
	children,
	action,
}: {
	tone?: keyof typeof CALLOUT_TONE;
	title: string;
	children?: ReactNode;
	action?: ReactNode;
}) {
	return (
		<div role="alert" className={`flex flex-col gap-3 rounded-sm border bg-surface p-4 ${CALLOUT_TONE[tone]}`}>
			<h3 className="m-0 font-mono text-base font-semibold text-ink">{title}</h3>
			<div className="flex flex-col gap-2 text-base leading-relaxed text-ink-2">{children}</div>
			{action ? <div className="flex flex-wrap gap-2">{action}</div> : null}
		</div>
	);
}
