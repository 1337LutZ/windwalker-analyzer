import type { Grade } from '~/lib/score';

/**
 * What a grade looks like, in every place the page draws one.
 *
 * The three verdicts had three homes: `StatTile` carried a text map and an edge map, `ReportHeader`
 * carried a border map, and two test files restated the text map a third time. Each was correct in
 * isolation, which is exactly the problem — one of them could be changed and the page would go on
 * looking consistent everywhere the reader was not looking.
 *
 * The variants are separate keys rather than one class string because a grade is drawn differently
 * depending on what it is grading: a headline number takes the colour, a card takes an edge, a
 * bordered panel takes the whole outline. Same verdict, same hue, different surface.
 *
 * Written out in full, and that is a hard constraint rather than a style: Tailwind only ships a class
 * it can see spelled, so `text-${tone}` compiles to nothing at all. See the same note in
 * `charts/tones.ts`, which governs the band colours for the same reason.
 *
 * **`good` is `--color-good` and not `kick`, which is the one change worth knowing about here.** `kick`
 * follows the spec, so a Windwalker's good verdicts were green and an Elemental's blue — and a verdict is
 * the one thing on the page that has to read the same whoever is reading it. `miss` and `brew` were
 * already fixed for that reason and this was the odd one out. See `--color-good` in `styles/global.css`
 * for the values and what `kick` still does.
 *
 * `null` is not a fourth grade. It means the figure has no threshold behind it, or the pull could not
 * answer it — and those must look like an ordinary number rather than a silent pass, which is why the
 * neutral values live here too instead of being spelled at each call site.
 */
export const GRADE = {
	/** A headline number, coloured by its own verdict. */
	text: {
		good: 'text-good',
		ok: 'text-brew',
		bad: 'text-miss',
	},
	/** The stripe down the side of a card or tile. */
	edge: {
		good: 'border-l-good',
		ok: 'border-l-brew',
		bad: 'border-l-miss',
	},
	/** A whole outline, for a panel that is itself the verdict. */
	border: {
		good: 'border-good',
		ok: 'border-brew',
		bad: 'border-miss',
	},
} as const satisfies Record<string, Record<Grade, string>>;

/** What each variant draws when there is no verdict to draw. */
export const UNGRADED = {
	text: 'text-ink',
	edge: 'border-l-line',
	border: 'border-line',
} as const satisfies Record<keyof typeof GRADE, string>;

/** The class for a grade, or the neutral one when the report has no verdict to give. */
export function gradeClass(variant: keyof typeof GRADE, grade: Grade | null): string {
	return grade === null ? UNGRADED[variant] : GRADE[variant][grade];
}
