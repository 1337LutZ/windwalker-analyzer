import type { Grade } from '~/lib/score';

import { gradeClass } from './grade';

/**
 * One headline number. `suffix` is the denominator half of a figure like `7.4/10` — it is part of
 * the same number, so it lives inside the value rather than being demoted to the label.
 *
 * `caption` is the one thing an uncoloured tile cannot say for itself, appended to the label after an
 * em dash: most often that nothing on this reading measured the figure, which is not the same as the
 * figure being bad and not the same as the log being unable to answer. Six call sites spelled that
 * concatenation out — four as an inline ternary in the `label` prop and two behind a local `tile()`
 * helper of their own — so the punctuation lived in six places and could drift in any of them. The
 * tile owns the dash now; the caller supplies only the clause.
 *
 * The colour repeats a judgement the report makes in words further down; it never carries one on its
 * own. Anything it says is also said by the graded sentence in the matching section, so a reader who
 * cannot separate the hues loses nothing. `null` is not a fourth grade — it means this tile has no
 * threshold behind it, or the pull could not answer it, and `gradeClass` draws both as an ordinary
 * number rather than a silent pass. DPS is the standing example: there is no target DPS, so
 * colouring it would invent a verdict.
 */
export default function StatTile({
	value,
	suffix,
	label,
	caption,
	grade = null,
}: {
	value: string;
	suffix?: string;
	label: string;
	/** Appended to `label` after an em dash. Omitted, and the label reads exactly as it is given. */
	caption?: string;
	grade?: Grade | null;
}) {
	return (
		<div className={`border-l-2 bg-surface px-4 py-3.5 sm:px-[18px] sm:py-4 ${gradeClass('edge', grade)}`}>
			<b
				className={`tabular block font-mono text-[22px] leading-none font-semibold tracking-[-0.02em] sm:text-[27px] ${gradeClass(
					'text',
					grade,
				)}`}
			>
				{value}
				{suffix ? <em className="text-sm not-italic text-muted sm:text-base">{suffix}</em> : null}
			</b>
			<span className="mt-2 block font-mono text-sm leading-[1.4] font-medium tracking-[0.1em] uppercase text-muted">
				{caption === undefined ? label : `${label} — ${caption}`}
			</span>
		</div>
	);
}
