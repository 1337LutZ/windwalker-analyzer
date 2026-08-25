import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { complementOf, intersect, type Interval } from '~/lib/analysis/intervals';
import type { Analysis } from '~/lib/types';

import { ChartFigure } from '~/components/primitives';
import ChartEmpty from '~/components/charts/ChartEmpty';
import ChartKey from '~/components/charts/ChartKey';
import { exemptRows } from '~/components/charts/exempt';
import TrackLane, { type LaneSource } from '~/components/charts/TrackLane';

/**
 * Rising Sun Kick's debuff across the pull: where it was up, where it was not, and where there was
 * nothing to put it on.
 *
 * Three things rather than one, because the third is what makes the second fair. A gap while nothing
 * could be hit is not a drop the player caused, and a single up/down bar cannot tell the two apart —
 * it would show a phase transition as the same red as a missed global.
 *
 * All three are the measurement the tiles above print, and that is the whole point of them: the up
 * source *is* `contactUpSegments`, whose union is the uptime figure, the middle one is what is left
 * of contact time, whose union is the seconds-lost figure, and the third is the complement of contact.
 * They partition the pull with nothing left over. It used to draw the primary target's own windows
 * instead, under tiles that had moved to every enemy — and its third track then called 380 seconds of
 * a 434-second Galakras pull "out of reach" while the player spent 317 of them fighting adds, which is
 * not a scoping quibble but a false sentence about a pull.
 *
 * The primary target's window model has not gone anywhere: it is still what the pull timeline draws,
 * a lane per enemy with that enemy's name on it, which is where one enemy's windows are worth seeing.
 *
 * **One merged lane rather than three rows, and the partition above is exactly what earns it.**
 * `TrackLane` is drawable only where the sources tile the pull, because its bars are laid out end to
 * end: a gap does not leave a hole, it slides everything after it left of the clock the reader is
 * reading against. Measured across all ten committed Windwalker pulls — the six captures and the four
 * raw datasets through `analyse()` — up, dropped and away sum to `durationMs` to the millisecond with
 * every pairwise intersection at zero. `waves` is the widest spread of the three, 254 115 + 56 502 +
 * 123 575 of 434 192ms, and it closes like the rest.
 *
 * What the merge buys here is the same adjacency it bought `FlameShockUptime`: this chart's up source
 * fragments hard, 75 spans on `strong` at a 0.44s median, so a drop and the intermission that excused
 * it sat on separate lines and the reader had to scan down a column to see they were one moment.
 */
export default function DebuffTimeline({ analysis, target }: { analysis: Analysis; target: string }) {
	const { t } = useTranslation('report');
	const { debuff } = analysis;

	/**
	 * The three sources as intervals, and which measurement they came from.
	 *
	 * `scoped` is false on an `Analysis` captured before the contact-scoped arrays existed. No committed
	 * fixture is one any more and `analyse()` has emitted both fields since `ba04cbe`, so the branch is
	 * reached only by an object built without them — which is how `risingSunKick.test.ts` pins the copy
	 * it switches to. There the chart falls back to the primary target's window model, which is what such
	 * a pull's tiles were measured on too, so the section stays internally consistent, and the copy
	 * switches with it rather than describing the wrong thing in the right words.
	 *
	 * **Both branches derive the down source as a complement, and the fallback did not used to.** It read
	 * `debuff.drops`, which is the primary target's gaps with the longest one excluded and each length
	 * rounded to a tenth of a second — so it was never the remainder of anything, and the three sources
	 * left holes: 10 712ms across two gaps on `cleave`'s fields stripped, 9 387 on `waves`, 1 093 on
	 * `weave`, 6 999 on `mixed`, 1 251 on `strong`, 1 173 on `poor`. Three rows could carry that, because
	 * a row keeps its own left edge. A lane cannot. Taking the complement of `debuff.windows` inside
	 * `engagedSegments` closes all six to zero, and it is the same construction the scoped branch above
	 * uses, one clock in.
	 *
	 * What is left over on that branch is an *overlap* rather than a gap — the debuff ticking on the
	 * primary target while the player was off it, 21 296ms on a stripped `strong` and under 400ms on the
	 * other five — and an overlap is a thing a lane can say. Up is listed first below, so those seconds
	 * read as coverage the reader had rather than as time nothing was there.
	 */
	const tracks = useMemo(() => {
		const up = debuff.contactUpSegments;
		const contact = debuff.contactSegments;
		if (up === undefined || contact === undefined) {
			const primary = debuff.windows.map(({ start, end }): Interval => [start, end]);
			return {
				scoped: false,
				up: primary,
				down: intersect([...debuff.engagedSegments], complementOf(primary, analysis.durationMs)),
				away: gapsBetween(debuff.engagedSegments, analysis.durationMs),
			};
		}
		return {
			scoped: true,
			up,
			// Contact time that the up source does not cover. Derived rather than carried so it cannot
			// disagree with the array it is the complement of.
			down: intersect([...contact], complementOf([...up], analysis.durationMs)),
			away: gapsBetween(contact, analysis.durationMs),
		};
	}, [debuff.contactUpSegments, debuff.contactSegments, debuff.windows, debuff.engagedSegments, analysis.durationMs]);

	/**
	 * The exempt row, through the partitioner every other chart's exempt row goes through.
	 *
	 * One cause, so the partition is the identity and nothing about what this chart draws moves. What it
	 * buys is the seam: `exemptRows` is where a second cause is added, and the day one is, the overlap
	 * between it and this row is decided by the same precedence rule the Elemental uptime charts use
	 * rather than by a fourth complement written out here.
	 *
	 * **There was a filter in front of this, and it is gone.** `gapsBetween` used to drop gaps of a second
	 * or less, so this row was the seconds the denominator dropped *less the slivers* while
	 * `FlameShockUptime` drew the complement whole — three charts of one pull, three answers to "which
	 * slivers count", and the `away` total in `chartLabel` below stating a number its own denominator did
	 * not drop. Measured across the fixtures, that filter moved the drawn total by 162–483ms on five of six
	 * Windwalker pulls and by the whole of it on `weave`, whose only out-of-contact stretches are 862 and
	 * 57ms: the row vanished, the key with it, and the label printed `0ms` of a 919ms drop. It moved no
	 * graded figure on any pull, because the uptime denominator is `contactSegments` either way.
	 *
	 * A rule that changes a stated total and nothing a reader can see is all cost, so the answer is one
	 * floor and it is none. A lane bar is drawn at true width, so a sliver is a fraction of a pixel —
	 * nothing appears, nothing is claimed, and the total is the denominator's. `CastTimeline` dropped a
	 * three-second floor in the same change for the same reason.
	 */
	const exempt = useMemo(
		() => exemptRows([{ label: t('debuff.track.away'), windows: tracks.away }], analysis.durationMs),
		[t, tracks, analysis.durationMs],
	);
	const away = exempt[0]?.windows ?? [];
	const totalOf = (windows: ReadonlyArray<readonly [number, number]>) =>
		windows.reduce((ms, [start, end]) => ms + (end - start), 0);

	/**
	 * The three things this chart draws, in precedence order — first one wins a millisecond two claim.
	 *
	 * **Nothing turns `widen` off any more, because a lane has no floor to turn off.** Three rows each
	 * needed one: this chart's up source is contact-scoped, so it fragments exactly as hard as the down
	 * source it interleaves with, and on the reference pulls `strong` draws 75 up spans at a 0.44s median
	 * and `waves` 64 at 0.55s. Widening every one of those inflated the green from 467s to 524s of a 535s
	 * pull, and from 256s to 289s of a 434s one, above a tile reading 87%. A lane is continuous, so a bar
	 * too small to see costs the reader nothing and its neighbours already say what that instant was. See
	 * the note where `TrackLane` puts `min-w-px`.
	 *
	 * The away source takes a *kind* rather than one `EXEMPT`: merged onto one line there is no row label
	 * left to tell one grey from another, which is what `EXEMPT_KIND` in `charts/tones.ts` exists for.
	 * `nothing` is the step for "nothing was up to act on", which is exactly what this cause is and is the
	 * step `SearingTotemUptime` and `FlameShockUptime` already give their own out-of-reach ground. One
	 * cause today, so the ramp has one step in use and the rest is headroom for the second.
	 *
	 * Precedence only ever decides anything on the fallback branch, where up and away can overlap; on a
	 * scoped pull the three are disjoint and the order says nothing. See the note above `tracks`.
	 */
	const sources = useMemo(
		(): LaneSource[] => [
			{
				label: t('debuff.track.up'),
				tone: 'kick',
				windows: tracks.up,
				lengthLabel: t('chart.length.held', { ns: 'ui' }),
			},
			{
				label: t('debuff.track.dropped'),
				tone: 'miss',
				windows: tracks.down,
				lengthLabel: t('chart.length.without', { ns: 'ui' }),
			},
			...exempt.map((row): LaneSource => ({
				label: row.label,
				tone: 'nothing',
				windows: row.windows,
				lengthLabel: t('chart.length.plain', { ns: 'ui' }),
			})),
		],
		[t, tracks, exempt],
	);

	// Gated on the tracks rather than on `debuff.windows`, which is the primary target's. A player who
	// spent a wave fight kicking adds and never touched the boss has an empty window model and a full
	// chart, and this used to answer them with "Rising Sun Kick was never cast in this pull".
	if (tracks.up.length === 0 && tracks.down.length === 0) {
		return <ChartEmpty>{t('debuff.verdict', { context: 'none' })}</ChartEmpty>;
	}

	// The three durations the chart itself draws, read off the arrays it draws them from. On a scoped
	// pull the first two are the two tiles above, which is the claim the caption makes.
	const context = tracks.scoped ? undefined : 'primary';
	return (
		<ChartFigure
			gap="wide"
			caption={
				<>
					<ChartKey tone="kick">{t('debuff.track.up')}</ChartKey>
					<ChartKey tone="miss">{t('debuff.track.dropped')}</ChartKey>
					{exempt.map((row) =>
						row.windows.length === 0 ? null : (
							<ChartKey key={row.label} kind tone="nothing">
								{row.label}
							</ChartKey>
						),
					)}
				</>
			}
			note={t('debuff.chartCaption', { context, target })}
		>
			<TrackLane
				sources={sources}
				durationMs={analysis.durationMs}
				label={t('debuff.chartLabel', {
					context,
					target,
					up: totalOf(tracks.up),
					down: totalOf(tracks.down),
					away: totalOf(away),
					drops: tracks.down.length,
				})}
			/>
		</ChartFigure>
	);
}

/**
 * The stretches *not* covered by `segments`, which is where there was nothing to fight.
 *
 * `complementOf` and nothing else now — the cast timeline shades the same stretches off the same
 * primitive, and this is what makes the two agree to the millisecond. There used to be a `> 1000` filter
 * here on the argument that a sliver either side of a segment boundary is rounding rather than a phase.
 * That argument is about how the span is *drawn*, and it was applied to the array as well: the row went
 * into `chartLabel`'s `away` total, so the sentence stated a figure the uptime denominator had not
 * dropped. Nothing a reader could see changed either way, because a 442ms span is a fraction of a pixel
 * at any width a lane bar can take.
 *
 * The three kinds of span in here, measured rather than assumed, are worth knowing before anyone puts a
 * floor back: on every fixture the complement is the lead-in before the first hit lands (862–2475ms), the
 * tail after the last (57–483ms), and the genuine intermissions in between (17.8s on `strong`, 116.6s
 * across six waves on `waves`, 39.0s on `mixed`). A duration threshold is a poor proxy for the first two
 * and cuts the third on a short phase — at three seconds, four of nine pulls shaded nothing at all while
 * spending 1.6–2.7s out of contact.
 */
function gapsBetween(segments: ReadonlyArray<readonly [number, number]>, durationMs: number): Array<[number, number]> {
	return complementOf([...segments], durationMs);
}
