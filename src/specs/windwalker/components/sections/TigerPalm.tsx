import { useReportCopy } from '~/hooks/useReportCopy';
import { formatPercentValue } from '~/lib/format';
import type { Analysis } from '~/lib/types';

import { TigerPalmTimeline } from '../charts';
import { Note, Pill, Prose, Section, StatTile } from '~/components/primitives';

/**
 * What every Tiger Palm bought: a card per outcome, and every press on a clock.
 *
 * The chart replaced a strip of squares and a modal table, and the reason is that Tiger Palm is a
 * *timing* button. Whether the waste is spread thinly across a pull or clustered into two frantic
 * stretches is the difference between a habit and a phase the fight forced, and neither a row of
 * undated squares nor forty timestamps behind a button could show it.
 *
 * The wording is not written here. `intent` says what the section measures and never changes;
 * `verdict` is chosen by this pull's grade, so the same component says "every press bought
 * something" for one log and "that is a habit rather than a slip" for another without a conditional
 * in sight.
 *
 * The cards replace the legend the strip used to carry. They hold the same three labels in the same
 * three colours, so they decode the squares underneath them, and they say how many and what share
 * rather than repeating a count the cards already show.
 */
export default function TigerPalm({ analysis }: { analysis: Analysis }) {
	const { filler, comboBreaker } = analysis;
	const { t, card, verdict } = useReportCopy(analysis);
	/**
	 * How many presses the single-target habit could be read off, which the sentence below has to name.
	 *
	 * There are now three ways this section can have nothing to grade, and they need three sentences —
	 * which is what `f832015` left owed. It dropped the clause rather than print "Tiger Palm was never
	 * pressed in this pull" over twelve drawn presses, and a silence is better than a falsehood and worse
	 * than the reason.
	 *
	 *   - No presses at all: the branch below, which keeps that sentence on its own key.
	 *   - Too few presses made with one enemy up to tell a habit from chance: `verdict_none`, which names
	 *     this number against the press count, so the sentence cannot disagree with the cards above it.
	 *   - The pull being read as multi-target, where the single-target filler is not the question:
	 *     `verdict_exempt`, chosen by `gradeOf` and deliberately *not* naming this number — `strong` read
	 *     that way has twenty-six presses with one enemy up and still no grade, so "too few" would be a
	 *     plain falsehood there.
	 *
	 * Read off the metric's own `sampleSize` rather than counted again here, for the reason the dropped
	 * clause exists: a component that re-derives what the scorer already published is how the two got out
	 * of step in the first place.
	 */
	const sample = card.sections['tigerPalm']?.metrics.find((m) => m.key === 'tigerPalmWaste')?.sampleSize;

	const counts = {
		casts: filler.casts,
		onProc: filler.onProc,
		applied: filler.applied,
		refresh: filler.refresh,
		wasted: filler.wasted,
		sample,
	};

	// Written out rather than mapped from `reason`, because Tailwind only ships a class it can see
	// spelled in full — and because the colour of an outcome is a decision, not a lookup.
	//
	// Worst first. The wasted presses are the only outcome here a reader can act on, and they led the
	// row of cards in every pull that had a problem — putting them last meant scanning past three
	// numbers that were fine to reach the one that was not.
	const outcomes = [
		{ key: 'wasted', label: t('tigerPalm.key.wasted'), count: filler.wasted, edge: 'border-miss' },
		// Putting the buff up and refreshing it are both justified presses, so they share the colour —
		// but they are separate cards, because a pull with no refreshes and several applications is a
		// buff that kept falling off, which reads nothing like keeping it rolling.
		{ key: 'apply', label: t('tigerPalm.key.apply'), count: filler.applied, edge: 'border-kick' },
		{ key: 'refresh', label: t('tigerPalm.key.refresh'), count: filler.refresh, edge: 'border-kick' },
		{ key: 'proc', label: t('tigerPalm.key.proc'), count: filler.onProc, edge: 'border-rune' },
	];

	return (
		<Section id="tiger-palm" title={t('tigerPalm.title')}>
			<Prose>{t('tigerPalm.intent')}</Prose>

			{filler.casts === 0 ? (
				<div className="mt-5">
					<Note>{t('tigerPalm.unpressed')}</Note>
				</div>
			) : (
				<>
					{/* Its own grid rather than `StatTiles`, because each card carries a coloured top edge
					    and `bg-surface` of its own — so a label that wraps on one card cannot open a gap of
					    border colour under its neighbour. The column rule is the same `auto-fit` though:
					    fixed at three across, the four outcomes here ran 3 + 1 and left most of a second
					    row as bare border colour, which reads as a card that failed to render. */}
					<div className="mt-4.5 grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-px overflow-hidden rounded-sm border border-line bg-line">
						{outcomes.map((o) => (
							<div key={o.key} className={`border-t-4 bg-surface ${o.edge}`}>
								<StatTile
									value={`${o.count}`}
									suffix={` · ${formatPercentValue((o.count / filler.casts) * 100)}`}
									label={o.label}
								/>
							</div>
						))}
					</div>

					<div className="mt-4.5">
						<TigerPalmTimeline analysis={analysis} />
					</div>

					<div className="mt-5 flex flex-col gap-3.5">
						{/* Always a sentence now, whichever of the four it is: three grades and the two ways to have
						    none each have their own wording, so there is no reading of this pull the section goes
						    quiet on. The uptime clause beside it is true either way and has never depended on the
						    grade. */}
						<Prose>
							{`${verdict('tigerPalm', counts)} `}
							{t('tigerPalm.uptime', { uptime: filler.buffUptimePct })}
						</Prose>
						{comboBreaker.length > 0 ? (
							<p className="m-0">
								{comboBreaker.map((cb) => (
									<Pill key={cb.id}>
										{cb.label} {cb.procs} proc
										{cb.procs === 1 ? '' : 's'}
										{cb.wasted > 0 ? `, ${cb.wasted} unspent` : ''}
									</Pill>
								))}
							</p>
						) : null}
					</div>
				</>
			)}
		</Section>
	);
}
