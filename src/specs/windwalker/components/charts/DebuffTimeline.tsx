import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { complementOf, intersect, type Interval } from '~/lib/analysis/intervals';
import type { Analysis } from '~/lib/types';

import { ChartFigure } from '~/components/primitives';
import ChartEmpty from '~/components/charts/ChartEmpty';
import ChartKey from '~/components/charts/ChartKey';
import { exemptRows } from '~/components/charts/exempt';
import { EXEMPT } from '~/components/charts/tones';
import type { Track } from '~/components/charts/WindowTracks';
import WindowTracks from '~/components/charts/WindowTracks';

/**
 * Rising Sun Kick's debuff across the pull: where it was up, where it was not, and where there was
 * nothing to put it on.
 *
 * Three tracks rather than one, because the third is what makes the second fair. A gap while nothing
 * could be hit is not a drop the player caused, and a single up/down bar cannot tell the two apart —
 * it would show a phase transition as the same red as a missed global.
 *
 * All three are the measurement the tiles above print, and that is the whole point of them: the up
 * track *is* `contactUpSegments`, whose union is the uptime figure, the middle track is what is left
 * of contact time, whose union is the seconds-lost figure, and the third is the complement of contact.
 * They partition the pull with nothing left over. It used to draw the primary target's own windows
 * instead, under tiles that had moved to every enemy — and its third track then called 380 seconds of
 * a 434-second Galakras pull "out of reach" while the player spent 317 of them fighting adds, which is
 * not a scoping quibble but a false sentence about a pull.
 *
 * The primary target's window model has not gone anywhere: it is still what the pull timeline draws,
 * a lane per enemy with that enemy's name on it, which is where one enemy's windows are worth seeing.
 */
export default function DebuffTimeline({ analysis, target }: { analysis: Analysis; target: string }) {
	const { t } = useTranslation('report');
	const { debuff } = analysis;

	/**
	 * The three tracks as intervals, and which measurement they came from.
	 *
	 * `scoped` is false only on the committed fixtures, which are `analyse()` output from before the
	 * contact-scoped arrays existed. There the chart falls back to the primary target's window model —
	 * which is what those pulls' tiles were measured on too, so the section stays internally consistent
	 * — and the copy switches with it rather than describing the wrong thing in the right words. Both
	 * halves of the fallback go away when the fixtures are re-captured.
	 */
	const tracks = useMemo(() => {
		const up = debuff.contactUpSegments;
		const contact = debuff.contactSegments;
		if (up === undefined || contact === undefined) {
			return {
				scoped: false,
				up: debuff.windows.map(({ start, end }): Interval => [start, end]),
				down: debuff.drops.map(({ at, seconds }): Interval => [at, at + seconds * 1000]),
				away: gapsBetween(debuff.engagedSegments, analysis.durationMs),
			};
		}
		return {
			scoped: true,
			up,
			// Contact time that the up track does not cover. Derived rather than carried so it cannot
			// disagree with the array it is the complement of.
			down: intersect([...contact], complementOf([...up], analysis.durationMs)),
			away: gapsBetween(contact, analysis.durationMs),
		};
	}, [
		debuff.contactUpSegments,
		debuff.contactSegments,
		debuff.windows,
		debuff.drops,
		debuff.engagedSegments,
		analysis.durationMs,
	]);

	/**
	 * The exempt row, through the partitioner every other chart's exempt row goes through.
	 *
	 * One cause, so the partition is the identity and nothing about what this chart draws moves. What it
	 * buys is the seam: `exemptRows` is where a second cause is added, and the day one is, the overlap
	 * between it and this row is decided by the same precedence rule the Elemental uptime charts use
	 * rather than by a fourth complement written out here.
	 *
	 * **The filter stays outside it, and the difference is worth knowing about.** `gapsBetween` drops
	 * gaps of a second or less before the windows ever reach here, so this row is the seconds the
	 * denominator dropped *less the slivers* — while `FlameShockUptime` draws the complement whole. Two
	 * charts of one pull can therefore print exempt totals a few hundred milliseconds apart. That is
	 * deliberate on both sides for reasons in each file, not a bug either has, and `exemptRows` cannot
	 * reconcile it because it is a question about what `contactSegments` measures rather than about how
	 * overlapping causes divide.
	 */
	const exempt = useMemo(
		() => exemptRows([{ label: t('debuff.track.away'), windows: tracks.away }], analysis.durationMs),
		[t, tracks, analysis.durationMs],
	);
	const away = exempt[0]?.windows ?? [];
	const totalOf = (windows: ReadonlyArray<readonly [number, number]>) =>
		windows.reduce((ms, [start, end]) => ms + (end - start), 0);

	/**
	 * The rows as the track chart takes them, memoised because it redraws when they change identity.
	 *
	 * **All three turn `widen` off, which is the one place this chart disagrees with the Elemental
	 * uptime tracks, and the reason is in the data.** Their up rows are whole aura windows: a handful
	 * of long bars, where a sub-second one is genuine coverage that has to stay visible. This chart's
	 * up row is contact-scoped, so it fragments exactly as hard as the down row it interleaves with —
	 * measured on the reference pulls, `strong` draws 75 up spans with a median of 0.44s and `waves` 64
	 * with a median of 0.55s. Widening every one of those inflates the green from 467s to 524s of a
	 * 535s pull, and from 256s to 289s of a 434s one: a track drawn near saturated above a tile that
	 * reads 87%. Both rows are measurements the tiles state, so neither may overstate itself.
	 *
	 * The away row is filtered to gaps over a second before it ever reaches here, so every span it
	 * carries already clears `DROP_MS` and the flag cannot change what it draws. It is set anyway, so
	 * that a later reader does not have to work out which of the three rows was the special one.
	 *
	 * Its tone is `EXEMPT` rather than a token written out here, because this row is the precedent the
	 * Elemental uptime charts now follow — it used to be `muted` while theirs was `track`, which is one
	 * meaning wearing two colours. See the note beside `EXEMPT` in `charts/tones.ts`.
	 */
	const rows = useMemo(
		(): Track[] => [
			{ label: t('debuff.track.up'), tone: 'kick', windows: tracks.up, lengthLabel: 'held for', widen: false },
			{
				label: t('debuff.track.dropped'),
				tone: 'miss',
				windows: tracks.down,
				lengthLabel: 'without it for',
				widen: false,
			},
			...exempt.map((row): Track => ({
				label: row.label,
				tone: EXEMPT,
				windows: row.windows,
				lengthLabel: 'for',
				widen: false,
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
							<ChartKey key={row.label} tone={EXEMPT}>
								{row.label}
							</ChartKey>
						),
					)}
				</>
			}
			note={t('debuff.chartCaption', { context, target })}
		>
			<WindowTracks
				tracks={rows}
				chartId="ww-debuff"
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
 * The complement itself is `complementOf` in the interval primitives — the cast timeline shades the
 * same stretches, and two hand-rolled complements would eventually disagree about a boundary. What
 * stays here is the filter: a sliver either side of a segment boundary is rounding, not a phase, and
 * a second's worth of it is a bar too thin to hover on a chart drawn at this width.
 *
 * It stays *here*, at the call site, rather than moving into `WindowTracks` with the rest of the
 * skeleton. The track component draws the arrays it is handed and does not second-guess them, because
 * every row it draws is a figure some tile above it states; deciding that part of an array is not
 * really data is a decision about what `contactSegments` measures, and this is the file that knows.
 */
function gapsBetween(segments: ReadonlyArray<readonly [number, number]>, durationMs: number): Array<[number, number]> {
	return complementOf([...segments], durationMs).filter(([start, end]) => end - start > 1000);
}
