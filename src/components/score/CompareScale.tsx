import type { Metric } from '~/lib/score/model';

import { domainOf, markAt, ZONE, zonesOf } from './bandScale';

/**
 * Two pulls on one metric's own bands, joined by the distance between them.
 *
 * **The rule is the ground and the two pulls are marks on it**, which is exactly what `BandScale`
 * already drew for one pull — its own docblock says the zones are the rule and "what moves between two
 * pulls of one metric is the marker". This is that sentence with the second marker actually present.
 *
 * **Why a dumbbell and not two bars.** A compare view has to put twenty-odd metrics in four different
 * units on one page. Two bars per metric would be forty bars on incompatible axes, and a reader
 * comparing bar lengths down the page would be comparing seconds against percentages. Here every row
 * keeps its own domain and its own thresholds, and the thing the reader compares between rows is the
 * length of the connector, which means the same thing on all of them: how far apart these two pulls
 * are on this rule.
 *
 * **Both marks are placed on one domain**, which is why the geometry moved into `bandScale.ts`. For an
 * open-ended count the domain runs a quarter past the largest number present, and "largest" has to
 * include both pulls — a track sized for one of them puts the other off its end.
 *
 * **The marks take the pulls' colours, not the grades'.** That is the one thing this does differently
 * from the single-pull scale, and it is forced: with two marks on one track the reader's first
 * question is which is which, and a mark tinted by its verdict answers a question they did not ask
 * while hiding the one they did. The verdict is still on screen — it is the zone the mark is standing
 * in, and the grade beside the number.
 *
 * Colour is not the only channel. The first pull is filled and the second is a ring, so the two are
 * still told apart in greyscale, in print, and under full colour blindness.
 *
 * Neither metric may be unmeasurable or exempt. A pair that cannot be differenced has no distance to
 * draw, and the row says so in words instead of drawing a connector between a number and a guess.
 */
export default function CompareScale({ a, b }: { a: Metric; b: Metric }) {
	// One rule, read off the first pull. The two sides are the same metric key scored by the same spec
	// in the same render, so their thresholds are the same object's numbers; taking them from one side
	// rather than reconciling two is what makes that a fact rather than a hope.
	const max = domainOf(a, [a.value, b.value]);
	const left = markAt(a.value, max);
	const right = markAt(b.value, max);

	return (
		<div className="relative h-3.5" aria-hidden="true">
			<div className="absolute inset-x-0 top-1 flex h-1.5 overflow-hidden rounded-sm">
				{zonesOf(a, max)
					.filter(([, width]) => width > 0.01)
					.map(([grade, width]) => (
						<div key={grade} className={`h-full ${ZONE[grade]}`} style={{ width: `${width}%` }} />
					))}
			</div>
			{/* The connector is the figure. Neutral rather than either pull's colour, because the distance
			    belongs to both of them, and drawn under the marks so neither end is clipped by it.
			
			    **Two pixels, centred on the six-pixel track, and the first attempt was four.** At four it
			    covered two thirds of the zones it sits on and read as a bar rather than as a line between
			    two dots — which loses the whole reason this scale draws the zones at all: whether either
			    pull cleared the line, not only how far apart the two are. Two is also what the marks
			    specification asks of a line. */}
			<div
				className="absolute top-[6px] h-0.5 rounded-full bg-track"
				style={{ left: `${Math.min(left, right)}%`, width: `${Math.abs(right - left)}%` }}
			/>
			{/* The second pull first, so the first pull's mark is the one on top where they coincide. A
			    ring, and a ring rather than a second fill: two solid dots one pixel apart are one dot. */}
			<div
				className="absolute top-[1px] size-3 -translate-x-1/2 rounded-full border-2 border-pull-b bg-surface ring-2 ring-surface"
				style={{ left: `${right}%` }}
			/>
			<div
				className="absolute top-[1px] size-3 -translate-x-1/2 rounded-full bg-pull-a ring-2 ring-surface"
				style={{ left: `${left}%` }}
			/>
		</div>
	);
}
