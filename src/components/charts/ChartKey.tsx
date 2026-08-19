// One entry in a chart's legend: a swatch and what that colour means.
//
// The swatch classes come from `./tones`, which is where the marks themselves get their colours too.
// They used to be written out here instead, and that is exactly how a legend fails: a chart's key is
// the only thing standing between a reader and a chart whose colours are its verdict, and the one
// mistake it can make is naming a colour the chart did not draw.
//
// `band` is the difference between a solid mark and a washed one. A shaded window is painted at a
// fraction of its token, and the full-strength chip beside it is the same colour by name and a
// visibly different one on the page — so which of the two a key is describing has to be said, not
// assumed.

import { BAND, SWATCH, type BandTone, type Tone } from './tones';

export default function ChartKey(
	props: { children: string } & ({ band: true; tone: BandTone } | { band?: false; tone: Tone }) & {
			/** The spec's own colour, drawn inline when the bar it names is not a token colour. */
			color?: string;
		},
) {
	const swatch = props.band === true ? BAND[props.tone].swatch : SWATCH[props.tone];

	return (
		<span className="flex items-center gap-2">
			<i
				className={`inline-block h-3 w-3 shrink-0 rounded-sm ${swatch}`}
				style={props.color === undefined ? undefined : { backgroundColor: props.color }}
				aria-hidden="true"
			/>
			{props.children}
		</span>
	);
}
