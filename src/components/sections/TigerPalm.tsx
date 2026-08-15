import { useReportCopy } from '~/hooks/useReportCopy';
import { formatPercentValue } from '~/lib/format';
import type { Analysis } from '~/lib/types';

import { TigerPalmTimeline } from '../charts';
import { Note, Pill, Prose, Section, StatTile } from '../primitives';

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
	const { t, verdict } = useReportCopy(analysis);

	const counts = {
		casts: filler.casts,
		onProc: filler.onProc,
		applied: filler.applied,
		refresh: filler.refresh,
		wasted: filler.wasted,
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
					<Note>{t('tigerPalm.verdict', { context: 'none' })}</Note>
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
						<Prose>
							{verdict('tigerPalm', counts)} {t('tigerPalm.uptime', { uptime: filler.buffUptimePct })}
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
