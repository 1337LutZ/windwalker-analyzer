import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { SegmentMode } from '~/lib/analysis/segments';
import type { Analysis } from '~/lib/types';

import ChartKey from '../charts/ChartKey';
import { EXEMPT } from '../charts/tones';
import type { Track } from '../charts/WindowTracks';
import WindowTracks from '../charts/WindowTracks';
import { ChartFigure } from '../primitives';

/**
 * The rows, top to bottom, and the only place the order is decided.
 *
 * Ascending by how many enemies were up, with absence at the foot. That puts the four rows a reader
 * scans for in the order they already think in — one, two, three or more — and leaves the row that is
 * *not* one of those at the bottom, under them, which is where every other chart in the report puts a
 * stretch it is not measuring (see `EXEMPT` in `charts/tones.ts`, and the exempt row's position in
 * `charts/__tests__/exemptTrack.test.ts`).
 *
 * `mixed` sits above `idle` and below `aoe` rather than being sorted into the count ladder, because it
 * is not a count at all: it is the stretch where no one count held long enough to name, which is a
 * different kind of answer from "three or more" and belongs beside it rather than inside it.
 *
 * Every mode gets a row whether or not this pull has one. `WindowTracks` drops a row with no windows —
 * that is its documented behaviour and the reason it computes its own height — so an absent mode costs
 * nothing here and a mode this file forgot would be invisible.
 */
const ROWS: readonly SegmentMode[] = ['single', 'cleave', 'aoe', 'mixed', 'idle'];

/**
 * The pull cut into the stretches it was actually fought in, drawn once across the top of the report.
 *
 * A pull is not one shape. Galakras alternates add waves and boss-alone phases for seven minutes, and
 * Immerseus spends more than a third of itself with nothing up at all — and until this row the reader
 * was shown a single word for the whole of it. `analysis.segments` is that reading; this draws it.
 *
 * **It carries a duration and a name, and nothing else — no letter, no colour that means good or bad.**
 * Per-stretch scoring does not exist, and a strip that looked like it was grading would be inventing an
 * answer the analysis has not computed. The one thing the colours say is which stretches are time the
 * player could act in: the four contact rows are the spec's own tone, and the row where nothing was up
 * is the grey every chart in this report already uses for a stretch left out of its figures.
 *
 * **Why the modes are rows and not one strip of four colours.** A single lane would have to carry the
 * mode in its hue, and the four hues this report has are named for mechanics — `brew` is Tigereye Brew
 * on every other chart, `miss` is a fault — so spending them on "two enemies" would give one colour two
 * meanings, which is the drift `charts/tones.ts` exists to stop. A row already carries a name, so the
 * lane does the distinguishing and the colour is left to say the one thing it can say honestly. It is
 * also what `StormlashTotems` does with its rows-per-shaman: rows that are instances of one kind share
 * a tone, and the row that means something else gets its own.
 *
 * **Hidden entirely when the pull has one stretch**, which is a whole-pull reading and already the
 * headline: a chart of one bar spanning one row tells a reader nothing they did not have. Measured
 * across the fourteen Siege bosses that is Iron Juggernaut and Malkorok for the Windwalker, so it draws
 * on twelve of fourteen.
 *
 * `segments` is optional because every captured fixture predates it, so the absent case is the ordinary
 * one rather than a defensive check.
 */
export default function SegmentStrip({ analysis }: { analysis: Analysis }) {
	const { t } = useTranslation('report');
	const segments = analysis.segments?.segments;

	/**
	 * A row per mode, memoised because `WindowTracks` redraws whenever the array changes identity.
	 *
	 * `widen` is left at its default and the reason is arithmetic rather than taste: hysteresis cannot
	 * open a stretch shorter than its own eight-second floor and a silence shorter than ten seconds is
	 * absorbed into its neighbour, so nothing here is anywhere near the sub-pixel width the flag is
	 * about. See `Track.widen`.
	 */
	const rows = useMemo(
		(): Track[] =>
			ROWS.map((mode) => ({
				label: t('summary.shape.row', { context: mode }),
				tone: mode === 'idle' ? EXEMPT : 'kick',
				windows: (segments ?? [])
					.filter((segment) => segment.mode === mode)
					.map((segment): [number, number] => [segment.startMs, segment.endMs]),
				lengthLabel: t('summary.shape.length'),
			})),
		[segments, t],
	);

	if (segments === undefined || segments.length < 2) return null;

	const idle = rows[ROWS.indexOf('idle')];
	return (
		<div className="flex flex-col gap-3.5">
			<h3 className="m-0 font-mono text-sm font-semibold tracking-[0.14em] uppercase text-muted">
				{t('summary.shape.title')}
			</h3>
			<ChartFigure
				gap="wide"
				caption={
					<>
						<ChartKey tone="kick">{t('summary.shape.key.contact')}</ChartKey>
						{/* Named only where there is one, as the exempt key is on every other chart: a swatch for a
						    row the reader cannot find is a swatch they will go looking for. */}
						{idle === undefined || idle.windows.length === 0 ? null : (
							<ChartKey tone={EXEMPT}>{t('summary.shape.row', { context: 'idle' })}</ChartKey>
						)}
					</>
				}
				note={t('summary.shape.note')}
			>
				{/* No counts in the description, for the reason `StormlashTotems` gives: the rows are named
				    beside it and each stretch states its own length on hover, so a sentence restating five
				    totals is five pluralisations to get wrong for a reader who already has them. */}
				<WindowTracks
					tracks={rows}
					chartId="summary-shape"
					durationMs={analysis.durationMs}
					label={t('summary.shape.chartLabel')}
				/>
			</ChartFigure>
		</div>
	);
}
