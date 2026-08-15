import type { Grade } from '~/lib/score';

/**
 * How a graded headline number is coloured.
 *
 * `null` is not a fourth grade — it means this tile has no threshold behind it, or the pull could
 * not answer it, and those must look like an ordinary number rather than a silent pass. DPS is the
 * standing example: there is no target DPS, so colouring it would invent a verdict.
 */
const GRADE_TONE: Record<Grade, string> = {
	good: 'text-kick',
	ok: 'text-brew',
	bad: 'text-miss',
};

/**
 * The same edge the summary's advice cards carry, on the same four states.
 *
 * A stripe rather than a fill, and 2px rather than a border all the way round: a row of filled tiles
 * at the top of a report reads as an error state whatever the grades actually say, and most rows have
 * at least one amber. The stripe is legible at a glance without shouting, which is what lets every
 * card on the page use one visual language instead of the tiles saying it in text colour and the
 * cards saying it in an edge.
 *
 * Neutral is the ungraded case and it is a real state, not a missing one — a tile with no threshold
 * behind it keeps the edge so the row stays aligned, in the line colour so it reads as a rule rather
 * than as a verdict nobody reached.
 */
const GRADE_EDGE: Record<Grade, string> = {
	good: 'border-l-kick',
	ok: 'border-l-brew',
	bad: 'border-l-miss',
};

/**
 * One headline number. `suffix` is the denominator half of a figure like `7.4/10` — it is part of
 * the same number, so it lives inside the value rather than being demoted to the label.
 *
 * The colour repeats a judgement the report makes in words further down; it never carries one on its
 * own. Anything it says is also said by the graded sentence in the matching section, so a reader who
 * cannot separate the hues loses nothing.
 */
export default function StatTile({
	value,
	suffix,
	label,
	grade = null,
}: {
	value: string;
	suffix?: string;
	label: string;
	grade?: Grade | null;
}) {
	return (
		<div
			className={`border-l-2 bg-surface px-4 py-3.5 sm:px-[18px] sm:py-4 ${
				grade === null ? 'border-l-line' : GRADE_EDGE[grade]
			}`}
		>
			<b
				className={`tabular block font-mono text-[22px] leading-none font-semibold tracking-[-0.02em] sm:text-[27px] ${
					grade === null ? 'text-ink' : GRADE_TONE[grade]
				}`}
			>
				{value}
				{suffix ? <em className="text-sm not-italic text-muted sm:text-base">{suffix}</em> : null}
			</b>
			<span className="mt-2 block font-mono text-sm leading-[1.4] font-medium tracking-[0.1em] uppercase text-muted">
				{label}
			</span>
		</div>
	);
}
