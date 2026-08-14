import type { ReactNode, Ref } from 'react';

export type StepState = 'active' | 'done' | 'pending';

/**
 * One numbered stage of the flow: token, report, fight, player, result.
 *
 * Every step stays on screen even before it can be used, greyed rather than hidden, so the shape of
 * the whole task is visible from the first screen instead of appearing a piece at a time.
 */
export default function Step({
	index,
	title,
	hint,
	state,
	children,
	ref,
}: {
	index: number;
	title: string;
	hint?: string;
	state: StepState;
	children: ReactNode;
	/** So a step can be scrolled to. React 19 passes `ref` as an ordinary prop — no `forwardRef`. */
	ref?: Ref<HTMLElement>;
}) {
	const done = state === 'done';
	const pending = state === 'pending';

	return (
		<section
			ref={ref}
			aria-labelledby={`step-${index}-heading`}
			className={`rounded-sm border bg-surface ${pending ? 'border-line/70' : 'border-line'}`}
		>
			<div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
				<span
					aria-hidden="true"
					className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border font-mono text-sm font-semibold ${
						done ? 'border-kick bg-kick text-bg' : pending ? 'border-line text-muted' : 'border-kick text-kick'
					}`}
				>
					{done ? '✓' : index}
				</span>
				<h2
					id={`step-${index}-heading`}
					className={`m-0 font-mono text-base font-semibold tracking-[-0.01em] ${pending ? 'text-muted' : 'text-ink'}`}
				>
					{title}
				</h2>
				{hint ? <span className="text-sm text-muted">{hint}</span> : null}
			</div>
			<div className="border-t border-line px-4 py-4 sm:px-5 sm:py-5">{children}</div>
		</section>
	);
}
