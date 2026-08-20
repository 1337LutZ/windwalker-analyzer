import type { ResourceCurve } from '~/lib/types';

import { ChartFigure } from '../primitives';
import ChartKey from './ChartKey';
import ResourceTrack, { type ShadeWindow } from './ResourceTrack';
import ScrollableTrack from './ScrollableTrack';
import { BAND, VAR, type BandTone, type Tone } from './tones';

/**
 * A window shaded on the bar, and the line about it in the key, as one value.
 *
 * The single `tone` is the point: it picks the wash *and* the swatch, so a band cannot be drawn in
 * one colour and described in another. Everything a caller used to hand-write — a `fill-*` class, a
 * `text-*` class for the note, a matching `bg-*` chip in a `<figcaption>` written out separately
 * underneath — is now derived from it.
 */
export interface TrackBand {
	tone: BandTone;
	windows: readonly ShadeWindow[];
	/** What this band means, in the key under the chart. */
	legend: string;
	/** Stand any note inside the band on its side, for a band narrower than its own words. */
	upright?: boolean;
}

/**
 * A resource bar over the pull, whatever went wrong on it, and the key that names both.
 *
 * Four charts are this shape — energy, chi, the Tigereye Brew bank, and the energy bar under the
 * Energizing Brew audit — and each of them used to assemble it by hand out of `ScrollableTrack`,
 * `ResourceTrack` and a `<figcaption>` of `ChartKey`s. Three parts, four copies, and nothing joining
 * a shaded window to the key that explains it: the classes were picked at one end and the swatches at
 * the other, so the energy track shaded its stretches at the cap at a quarter strength and put a
 * full-strength chip beside them. That is the mismatch this component exists to make unwritable.
 *
 * What it does not do is flatten the four into one chart. These differences are real:
 *   - `mode`, because energy is a pool that genuinely slopes between two readings while chi and the
 *     bank hold whole units — a diagonal through 2.5 chi is a quantity nobody had;
 *   - bands versus ticks, because energy's waste is a *duration* at the ceiling and chi's is a
 *     *press* that returned more than the bar could hold. Only chi's curve carries `wasted`, and
 *     `ResourceTrack` marks those itself, so the key for them is asked for separately;
 *   - however many bands the chart needs, painted in the order given: one for energy, two for the
 *     bank, three overlapping ones under Energizing Brew.
 *
 * The key is derived from the bands rather than written again beneath each chart, so it lists exactly
 * what was drawn, in the order it was drawn, and it cannot fall out of step with any of it.
 */
export default function ResourceChart({
	curve,
	durationMs,
	tone,
	legend,
	label,
	bands = [],
	mode,
	smooth,
	wastedLegend,
	color,
	showStepLabels,
	labelDecreases,
}: {
	curve: ResourceCurve;
	durationMs: number;
	/** The bar's own colour: its stroke, the wash under it, and the solid swatch that names it. */
	tone: Tone;
	/** The spec's own bar colour, drawn inline over the tone when given — the reports' bars are their spec's. */
	color?: string;
	/** What the bar is, in the key. */
	legend: string;
	/** The whole chart in a sentence, for a reader who cannot see it. */
	label: string;
	bands?: readonly TrackBand[];
	mode?: 'line' | 'steps';
	/** Round the corners between readings. Energy only — see `ResourceTrack`. */
	smooth?: boolean;
	/**
	 * What the overflow ticks mean, for a curve that carries any.
	 *
	 * Chi's only. Passing it does not draw anything — `ResourceTrack` marks overflow off the curve
	 * itself — it names marks that are already there, and the key stays off a pull that overflowed
	 * nothing rather than pointing at a colour the chart never used.
	 */
	wastedLegend?: string;
	/** Whether to draw the value at each step. False when the caller marks its moments another way. */
	showStepLabels?: boolean;
	/** Label only the decreases, with the level that was unloaded. */
	labelDecreases?: boolean;
}) {
	const stroke = color ?? VAR[tone];
	return (
		<ChartFigure
			caption={
				<>
					<ChartKey tone={tone} color={color}>
						{legend}
					</ChartKey>
					{/* Keyed by the legend, not by the tone.
					    `key={band.tone}` made band granularity a lie: two bands of one tone collided on the
					    React key, so a caller that wanted to name two different faults in the same red had to
					    merge them into one band and one legend line instead. The Elemental's Lightning Shield
					    did exactly that — "fell off", "overcapped" and "spent early" became one entry reading
					    "the shield went wrong" — and it read as a deliberate editorial choice rather than a
					    workaround for this line. The legend is what distinguishes one key entry from another,
					    so it is what identifies it. */}
					{bands.map((band) => (
						<ChartKey key={band.legend} tone={band.tone} band>
							{band.legend}
						</ChartKey>
					))}
					{wastedLegend === undefined || (curve.wasted ?? []).length === 0 ? null : (
						<ChartKey tone="miss">{wastedLegend}</ChartKey>
					)}
				</>
			}
		>
			<ScrollableTrack durationMs={durationMs}>
				<ResourceTrack
					curve={curve}
					durationMs={durationMs}
					mode={mode}
					smooth={smooth}
					stroke={stroke}
					// The area under the line, at the strength every one of these charts already washed it:
					// enough to read the shape off, faint enough that a band shaded behind it still shows.
					fill={`color-mix(in oklch, ${stroke} 18%, transparent)`}
					// The tone doubles as the shade's identity, which `ResourceTrack` uses to key its rects.
					// A chart never draws two bands in one colour — that would be two meanings claiming the
					// same swatch, which is the failure this whole module is about.
					shades={bands.map((band) => ({
						windows: band.windows,
						className: BAND[band.tone].fill,
						textClassName: BAND[band.tone].text,
						label: band.tone,
						upright: band.upright,
					}))}
					label={label}
					showStepLabels={showStepLabels}
					labelDecreases={labelDecreases}
				/>
			</ScrollableTrack>
		</ChartFigure>
	);
}
