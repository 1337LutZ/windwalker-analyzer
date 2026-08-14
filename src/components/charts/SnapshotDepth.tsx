import { useCallback, useMemo } from 'react';
import type { ApexOptions } from 'apexcharts';

import type { Analysis, ProcSummary, ProcWindow } from '~/lib/types';

import { formatGap } from '~/lib/format';

import { fmt, r1, sec } from '../format';
import type { ChartEnv } from './ApexChart';
import ApexChart from './ApexChart';
import ChartEmpty from './ChartEmpty';
import ChartKey from './ChartKey';
import type { ChartTheme, TipContent } from './apex';
import { LABEL_FONT_SIZE, baseChart, baseGrid, baseTooltip } from './apex';

/** Tall enough that a 14px row label is not crowded by the rows above and below it. */
const ROW_HEIGHT = 32;
const CHROME = 88;

interface Bar {
	x: string;
	y: number;
	fillColor: string;
	meta: TipContent;
}

/**
 * A back-to-back roll is a pair, so both halves say so: the snapshot that lost time to a later proc,
 * and the proc that took it. Nothing else in the report shows which two procs were involved.
 */
function backToBack(w: ProcWindow): Array<[string, string]> {
	if (w.b2bRole === 'source') {
		return [
			[
				'back-to-back',
				`${sec(w.devaluedMs)}s devalued${w.b2bWaste ? ' — same stat, pure waste' : ' — different stat'}`,
			],
		];
	}
	if (w.b2bRole === 'follow-up') {
		const partner = w.overlapOfIndex === undefined ? '?' : String(w.overlapOfIndex + 1).padStart(2, '0');
		return [['back-to-back', `overlapped proc ${partner} by ${sec(w.overlapOfMs ?? 0)}s`]];
	}
	return [];
}

/**
 * A row's identity on the y-axis, behind a gutter column carrying the pair bracket.
 *
 * The bracket leads rather than trails because ApexCharts right-aligns these labels: a trailing
 * glyph pushes its own row's timestamp left, and the three rows of a pair end up out of line with
 * every other row — the reader sees the misalignment before they see the bracket. Every row pays for
 * the column whether it uses it or not, which is what keeps the timestamps in one line.
 *
 * Non-breaking spaces, not ordinary ones: SVG collapses leading whitespace in a text node, so an
 * ordinary space pads nothing and the alignment this exists for is lost.
 */
const rowLabel = (w: ProcWindow, i: number, brackets: Map<number, string>): string => {
	const gutter = brackets.size === 0 ? '' : `${brackets.get(i) ?? '\u00a0'}\u00a0`;
	return `${gutter}${String(i + 1).padStart(2, '0')} · ${fmt(w.start)}`;
};

function buildBars(procs: ProcSummary, theme: ChartTheme, brackets: Map<number, string>): Bar[] {
	return procs.windows.map((w, i) => {
		const label = rowLabel(w, i, brackets);
		// A proc that was never caught is drawn full width: the whole thing went past.
		if (w.snapshotAt === null) {
			// The full proc, in the ordinary miss red. A brew that landed a fraction after it expired
			// adds the `late` series on top of this bar rather than recolouring it: the proc is still a
			// proc, and how far past its end the brew went is a separate length worth seeing.
			return {
				x: label,
				y: r1(w.lengthMs / 1000),
				fillColor: theme.miss,
				meta: {
					title: `Proc ${String(i + 1).padStart(2, '0')} · ${w.stat}`,
					tone: 'miss' as const,
					rows: [
						['proc at', fmt(w.start)],
						['proc length', `${sec(w.lengthMs)}s`],
						// "never" is wrong when a brew went out a fraction after the proc expired: the
						// player read it and was late, which is a different thing to not going for it.
						w.missedByMs !== null
							? (['brewed', `${formatGap(w.missedByMs)} too late`] as [string, string])
							: (['brewed at', w.redundant ? 'never — redundant repeat' : 'never'] as [string, string]),
						...backToBack(w),
					],
				},
			};
		}
		const waited = w.snapshotAt - w.start;
		const tone: keyof ChartTheme = w.grade === 'early' ? 'brew' : 'kick';
		return {
			x: label,
			y: r1(waited / 1000),
			fillColor: theme[tone],
			meta: {
				title: `Proc ${String(i + 1).padStart(2, '0')} · ${w.stat}`,
				tone,
				rows: [
					['proc at', fmt(w.start)],
					['brewed at', fmt(w.snapshotAt)],
					['held for', `${sec(waited)}s of the proc`],
					['proc left', `${sec(w.remainingMs ?? 0)}s`],
					['stacks spent', w.snapshotStacks === null ? '—' : `${w.snapshotStacks}/10`],
					...backToBack(w),
				],
			},
		};
	});
}

/**
 * A bracket drawn in the row labels, tying together the rows of one back-to-back roll: a proc, and
 * the proc that landed on top of it while the brew carrying the first was still running.
 *
 * A pair is two facts about one event, and each row only ever stated its own half — the reader had
 * to hover one row, hold a number in their head, and hover another to discover they were about the
 * same roll. The bracket says it without being read.
 *
 * In the labels rather than as a band behind the rows, because a band has to be positioned in pixels
 * against a row pitch ApexCharts computes internally and does not expose; measured, it covered two
 * rows of a three-row pair. A glyph in the label cannot come unaligned from the row it is part of.
 */
function pairBrackets(procs: ProcSummary): Map<number, string> {
	const marks = new Map<number, string>();
	procs.windows.forEach((w, i) => {
		if (w.b2bRole !== 'source' || w.b2bWith.length === 0) return;
		const last = Math.max(...w.b2bWith);
		// `┌ │ └`, opening to the right. The bracket sits in the gutter *left* of the labels, so the
		// corners have to turn toward the rows they gather; the mirrored pair (`┐ ┘`) turns away from
		// them and reads as a bracket belonging to something off the edge of the chart.
		marks.set(i, '\u250c');
		for (let row = i + 1; row < last; row += 1) marks.set(row, '\u2502');
		marks.set(last, '\u2514');
	});
	return marks;
}

/**
 * The stretch each near-miss bar runs past the end of its proc: how late the brew was, drawn as a
 * dimmer continuation of the bar rather than as a colour of its own.
 *
 * Stacked on the `held` series, so a row reads as one bar with a weaker tail. Rows that are not near
 * misses contribute a zero-length segment and are simply not there.
 */
function buildOvershoot(procs: ProcSummary, theme: ChartTheme, brackets: Map<number, string>): Bar[] {
	return procs.windows.map((w, i) => ({
		// The same label as the bar this stacks on, or the two series land in different categories and
		// the chart grows a phantom row per pair.
		x: rowLabel(w, i, brackets),
		// Not `r1`: a miss by 21ms rounds to 0.0s and the tail disappears entirely, which is the one
		// row the reader most needs to see is a *near* miss rather than an outright one. Three decimals
		// keeps it as a hairline, which is what a miss by a fiftieth of a second honestly looks like.
		y: w.missedByMs === null ? 0 : Math.round(w.missedByMs) / 1000,
		fillColor: theme.missSoft,
		meta: {
			title: `Proc ${String(i + 1).padStart(2, '0')} · ${w.stat}`,
			tone: 'miss' as const,
			rows: [
				['proc at', fmt(w.start)],
				['proc length', `${sec(w.lengthMs)}s`],
				['brewed', `${formatGap(w.missedByMs ?? 0)} too late`],
			],
		},
	}));
}

/**
 * One bar per Re-Origination proc: how long the brew was held into the proc before it went out.
 *
 * Longer is better, which is the whole argument of the section — a brew held to the final global of
 * a ten-second proc carries the converted stats for its own fifteen seconds afterwards, so brewing
 * early does not lose the proc, it loses the tail. The band at the right end is that last global; a
 * bar reaching into it is a brew held to the last moment.
 */
export default function SnapshotDepth({ analysis }: { analysis: Analysis }) {
	const procs = analysis.procs;
	const height = procs.windows.length * ROW_HEIGHT + CHROME;
	// Every proc is nominally the same length, but the last one of a pull is cut short by the boss
	// dying; the target band belongs to a full proc, so it is measured against the longest one.
	const fullLengthMs = procs.windows.reduce((longest, w) => Math.max(longest, w.lengthMs), 0);
	const longestOvershootMs = procs.windows.reduce((longest, w) => Math.max(longest, w.missedByMs ?? 0), 0);
	const brackets = useMemo(() => pairBrackets(procs), [procs]);

	const build = useCallback(
		({ theme, narrow, animate }: ChartEnv): ApexOptions => ({
			chart: {
				...baseChart({
					id: 'ww-snapshot-depth',
					type: 'bar',
					height,
					theme,
					animate,
				}),
				// Stacked so the overshoot continues the bar it belongs to instead of starting a second
				// row of its own.
				stacked: true,
			},
			series: [
				{ name: 'held', data: buildBars(procs, theme, brackets) },
				{ name: 'late', data: buildOvershoot(procs, theme, brackets) },
			],
			plotOptions: {
				bar: { horizontal: true, barHeight: '62%', borderRadius: 2 },
			},
			dataLabels: { enabled: false },
			legend: { show: false },
			stroke: { width: 0 },
			grid: baseGrid(theme),
			annotations: {
				// The band is spread with the label added only when there is one to add. Passing
				// `label: undefined` throws inside ApexCharts' own mount — it reads `label.text` without
				// checking `label` — and the chart silently never appears. On a phone this is the branch
				// that runs, so the untested path was the broken one.
				xaxis: [
					{
						x: r1((fullLengthMs - procs.lastGcdMs) / 1000),
						x2: r1(fullLengthMs / 1000),
						fillColor: theme.kick,
						borderColor: 'transparent',
						opacity: 0.2,
						...(narrow
							? {}
							: {
									label: {
										text: 'last GCD',
										borderColor: 'transparent',
										// ApexCharts rotates annotation labels vertically by default, which here stands
										// the text on its end inside the band and across the first rows' bars.
										orientation: 'horizontal',
										position: 'top',
										offsetY: -6,
										style: {
											background: theme.raised,
											color: theme.muted,
											fontFamily: theme.mono,
											fontSize: LABEL_FONT_SIZE,
										},
									},
								}),
					},
				],
			},
			xaxis: {
				type: 'numeric',
				min: 0,
				// The axis has to hold the longest bar, and a near miss runs past the proc it belongs to.
				max: r1((fullLengthMs + longestOvershootMs) / 1000),
				tickAmount: narrow ? 3 : 5,
				title: {
					// At 14px mono the long form is 218px of a 258px plot on a 390px screen — it fits, but
					// with nothing either side of it.
					text: narrow ? 'seconds into the proc' : 'seconds held into the proc',
					style: {
						color: theme.muted,
						fontSize: LABEL_FONT_SIZE,
						fontFamily: theme.mono,
						fontWeight: 500,
					},
				},
				axisBorder: { show: false },
				axisTicks: { color: theme.line },
				labels: {
					style: {
						colors: theme.muted,
						fontSize: LABEL_FONT_SIZE,
						fontFamily: theme.mono,
					},
					formatter: (value: string | number) => `${r1(Number(value))}s`,
				},
			},
			yaxis: {
				labels: {
					// `01 · 12:30` is the longest row label there is: ten characters of mono at 14px, plus
					// two more for the bracket column on a pull that has a pair. ApexCharts truncates to
					// this with an ellipsis, and measured, too tight a gutter cut off exactly the mark this
					// was added to show.
					maxWidth: (narrow ? 88 : 104) + (brackets.size > 0 ? 20 : 0),
					style: {
						colors: theme.muted,
						fontSize: LABEL_FONT_SIZE,
						fontFamily: theme.mono,
					},
				},
			},
			tooltip: baseTooltip(theme),
		}),
		[procs, height, fullLengthMs, longestOvershootMs, brackets],
	);

	if (procs.windows.length === 0) {
		return <ChartEmpty>Re-Origination never fired in this pull, so there is nothing to snapshot.</ChartEmpty>;
	}

	return (
		<figure className="m-0 flex flex-col gap-3.5">
			<ApexChart
				build={build}
				height={height}
				label={`How long each of the ${procs.procs} Re-Origination procs ran before Tigereye Brew snapshotted it: ${procs.lastGcd} caught on the last global, ${procs.early} brewed early, ${procs.unsnapshotted} never snapshotted`}
			/>
			{/* Three colours carrying three verdicts, and nothing else on the chart says which is which.
			    Naming them in the prose above was enough while one of them was green; it is not now. */}
			<figcaption className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted">
				<ChartKey tone="kick">Held into the last global — the whole tail kept</ChartKey>
				<ChartKey tone="brew">Brewed early, with proc left on the clock</ChartKey>
				<ChartKey tone="miss">Never snapshotted: the full proc went past</ChartKey>
				{/* Only when the pull actually has one — a key for an outcome nobody hit sends the reader
				    hunting the chart for a colour that is not on it. */}
				{procs.backToBack > 0 ? (
					<span className="flex items-center gap-2">
						{/* Stacked, because a bracket side by side with itself is two corner glyphs rather than
						    a bracket — the shape is the whole point of the key. */}
						<span
							aria-hidden="true"
							className="flex flex-col font-mono text-[10px] leading-[0.85] text-ink-2"
						>
							<span>┌</span>
							<span>└</span>
						</span>
						Bracketed rows are one back-to-back roll: the second proc landed while the first was still being
						carried
					</span>
				) : null}
				{procs.narrowlyMissed > 0 ? (
					<ChartKey tone="missSoft">The tail past a bar: a brew that went out just too late</ChartKey>
				) : null}
			</figcaption>
		</figure>
	);
}
