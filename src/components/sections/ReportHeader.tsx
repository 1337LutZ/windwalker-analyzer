import { useTranslation } from 'react-i18next';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatClock } from '~/lib/format';
import type { Analysis } from '~/lib/types';

import { WCL_REPORT_BASE } from '~/lib/wcl/endpoint';

import { secondaryButtonClass } from '../primitives/controls';
import { gradeClass } from '../primitives/grade';

import SplitGroupCallout from '../report/SplitGroupCallout';

import { difficultyLabel } from '../format';

/**
 * The verdict's rule, in the report's own colour vocabulary: `kick` for a pull that held together,
 * `brew` for one that leaked, `miss` for one that did not.
 *
 * The colour only reinforces the sentence — the words carry the judgement on their own, so nothing
 * is lost to a reader who cannot separate the three hues.
 */

/**
 * WarcraftLogs' own parse bands, as the site paints them.
 *
 * Somebody else's scale in somebody else's colours, deliberately — see `--color-parse-*` in
 * `global.css`. A reader who knows an orange parse from a purple one should not have to translate,
 * and this report has no business recolouring a figure it did not compute.
 *
 * The boundaries are the site's: grey under 25, then green, blue, purple, orange at 95, pink at 99,
 * gold at 100. Read as "the first band this percentile is under", so the order here is the whole
 * rule and there is no arithmetic to get wrong.
 *
 * Filled rather than outlined, and the ink is per band because one ink cannot carry seven of
 * somebody else's hues. **Measured against 4.5:1, not chosen** — white reads 1.4:1 on the uncommon
 * green, 1.6:1 on the artifact gold, 2.5:1 on the legendary orange, 2.7:1 on the common grey and
 * 3.1:1 on the astounding pink, so those five take black, at 7.7 to 15.4. The rare blue is the awkward
 * one: white 4.4, black 4.8, so black. The epic violet is the single band that goes the other way —
 * black 4.3 against white 4.9 — and it is white for that reason alone.
 *
 * Changing a hue to make one ink work is the thing not to do here. The colours are WarcraftLogs' and
 * the whole point of copying them is that a reader already knows what an orange parse looks like.
 */
const PARSE_BANDS: Array<[max: number, tone: string]> = [
	[24, 'border-parse-common bg-parse-common text-black'],
	[49, 'border-parse-uncommon bg-parse-uncommon text-black'],
	[74, 'border-parse-rare bg-parse-rare text-black'],
	[94, 'border-parse-epic bg-parse-epic text-white'],
	[98, 'border-parse-legendary bg-parse-legendary text-black'],
	[99, 'border-parse-astounding bg-parse-astounding text-black'],
	[100, 'border-parse-artifact bg-parse-artifact text-black'],
];

function parseBand(percent: number): string {
	return PARSE_BANDS.find(([max]) => percent <= max)?.[1] ?? 'border-parse-artifact bg-parse-artifact text-black';
}

/** Which pull this is, who it belongs to, how it went, and what the report is about to argue. */
export default function ReportHeader({ analysis }: { analysis: Analysis }) {
	const { t, card } = useReportCopy(analysis);
	// The outcome words live in `ui`, not `report`: the fight picker shows the same three strings
	// before a report exists, and two copies drifted apart once already.
	const { t: tUi } = useTranslation('ui');
	// The analysis already carries the mode's name as the zone gave it, so the header needs no table
	// and no second query — just the one entry, keyed by the id it belongs to.
	const difficultyNames = analysis.difficultyName === null ? {} : { [analysis.difficulty]: analysis.difficultyName };
	// How much of what the spec asks for the letter above was actually taken over. Absent on a scorecard
	// captured before the field existed and on any spec that has not adopted it, and an absent
	// denominator prints nothing rather than a guessed one.
	const judged = card.judged;
	/**
	 * Whether the report has a reading of the pull at all.
	 *
	 * `overallOf` parks the grade at `ok` when too little of the weight survived to make the letter a
	 * claim, which is the right thing for the arithmetic to do and the wrong thing to print: "some parts
	 * were solid and others lost damage" is a confident sentence about a pull the report could barely
	 * read. So the flag beside the grade decides the wording, and the rule loses its colour with it —
	 * amber down the side of a refusal reads as a middling verdict, which is the claim being withdrawn.
	 */
	const cannotSay = judged?.unmeasurable === true;
	// Undefined on an analysis captured before the fetch asked, null when WarcraftLogs has no ranking
	// for the pull. Both mean "no parse", and both draw nothing.
	const parse = analysis.rankPercent ?? undefined;

	return (
		<header>
			<p className="m-0 mb-3 font-mono text-sm font-medium tracking-[0.16em] uppercase text-muted">
				{analysis.encounter} &middot; {difficultyLabel(analysis.difficulty, analysis.size, difficultyNames)} &middot;{' '}
				{tUi(analysis.kill ? 'common.kill' : 'common.wipe')} &middot; {formatClock(analysis.durationMs)}
			</p>
			{/* The anchor the contents list jumps to. The summary has no heading of its own — the report
			    title *is* its heading — so it borrows this one rather than growing a second, redundant
			    line above it. `scroll-mt-14` matches the sticky bar, as on every section heading. */}
			<h1
				id="summary-heading"
				className="scroll-mt-14 m-0 font-mono text-[28px] leading-[1.05] font-semibold tracking-[-0.02em] text-balance text-ink sm:text-[34px] md:text-[38px]"
			>
				{analysis.player}
				{/* WarcraftLogs' own percentile, beside the name because that is where the site puts it and
				    where a reader looks for it, and set as a tag on the same terms as the alpha marker in
				    `Analyzer` — inside the heading, so a screen reader announces it with the name rather
				    than leaving it as a stray number after the title. Nothing this report computes is a
				    substitute: every grade below is against a rule, and this is against everybody else who
				    killed the same boss.

				    Absent rather than nought when there is none — a wipe, an unranked difficulty, a private
				    log, an analysis captured before the field existed. A `0` here would read as a
				    bottom-percentile pull, which is the one thing "no ranking" does not mean. */}
				{typeof parse === 'number' ? (
					<span
						className={`ml-3 rounded-sm border px-2 py-[3px] align-middle font-mono text-sm font-semibold tracking-[0.1em] whitespace-nowrap uppercase ${parseBand(parse)}`}
					>
						{t('summary.parse', { value: parse })}
					</span>
				) : null}
			</h1>
			{/* The only line that answers "how did this pull go", so it is set as a verdict rather than as
			    a caption: brightest ink, above body size, and a rule in the grade's own colour. Everything
			    below it is detail that this sentence has already framed.

			    The denominator goes inside the same rule rather than somewhere below it, because the two
			    lines are one claim — a grade, and how much of the pull it was drawn over. A reader who gets
			    no further than the top of the report has to be able to tell a `good` over ten thirteenths of
			    the weight from a `good` over all of it, and anywhere else on the page is a place to hunt. */}
			<div className={`mt-4 max-w-[56ch] border-l-2 pl-4 ${gradeClass('border', cannotSay ? null : card.overall)}`}>
				<p className="m-0 text-lg leading-snug font-semibold text-balance text-ink sm:text-xl">
					{cannotSay ? t('overall.none') : t(`overall.${card.overall}`)}
				</p>
				{/* Printed on every pull, including the ones judged in full. A line that appeared only when the
				    reckoning was short would be indistinguishable from a line that was never built, and "judged
				    on all of it" is only readable as reassurance if it is said. */}
				{judged === undefined ? null : (
					<p className="mt-2 mb-0 font-mono text-sm leading-snug text-muted">
						{t('summary.judged', {
							context: judged.unmeasurable ? 'partial' : undefined,
							measured: judged.measured,
							total: judged.total,
						})}
					</p>
				)}
			</div>
			{/* Back to the log, at the pull and the player this page is about. The report argues from
			    numbers a reader cannot check on this page, so the way to check them has to be one click
			    away and pointed at the same three things the analysis was built from — the report, the
			    fight and the source. `#fight=…&source=…` is WarcraftLogs' own deep-link fragment, the same
			    one every miss row in this report uses.

			    A new tab, because leaving loses the report: it is held in memory, and coming back is
			    another fetch of everything. `noreferrer` with `noopener` for the ordinary reason. */}
			<a
				className={`${secondaryButtonClass} mt-4`}
				href={`${WCL_REPORT_BASE}/${analysis.code}#fight=${analysis.fightID}&type=damage-done&source=${analysis.actorID}`}
				target="_blank"
				rel="noopener noreferrer"
			>
				{t('summary.openInLogs')}
			</a>
			{/* Directly under the way back to the log, and that is the placement argued for rather than a
			    slot that happened to be free. The callout says the raid split up and this player went with
			    the half that walked away. It is a claim about *which pull this is*, and it belongs with the
			    encounter, the difficulty and the parse rather than beside a control. A reader who doubts it
			    has the log open one line above, at the same fight and the same source.

			    Renders nothing on a pull the raid fought together, which is every pull on eleven of the
			    fourteen Siege encounters, so the header keeps its shape. */}
			{analysis.splitGroup ? (
				<div className="mt-5">
					<SplitGroupCallout split={analysis.splitGroup} />
				</div>
			) : null}
		</header>
	);
}
