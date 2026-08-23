import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { ApexOptions } from 'apexcharts';

import type { Analysis, ElementalAuditResult, FlameShockAudit } from '~/lib/types';

import { formatStamp } from '~/lib/format';

import { fmt, r1, sec } from '~/components/format';
import { ChartFigure } from '~/components/primitives';
import type { ChartEnv } from '~/components/charts/ApexChart';
import ApexChart from '~/components/charts/ApexChart';
import ChartEmpty from '~/components/charts/ChartEmpty';
import ChartKey from '~/components/charts/ChartKey';
import type { ChartTheme, TipContent } from '~/components/charts/apex';
import { LABEL_FONT_SIZE, baseChart, baseGrid, baseTooltip } from '~/components/charts/apex';

const ROW_HEIGHT = 24;
const CHROME = 88;

interface Bar {
	x: string;
	y: number;
	fillColor: string;
	meta: TipContent;
}

/** The two segments of one row: the dot before its last tick, and the part inside it. */
export interface DepthSeries {
	held: Bar[];
	lastTick: Bar[];
	/**
	 * The stretch every drawn dot's **final tick** falls in, in ms since each application: from the
	 * earliest opening to the latest end. See `buildBars`.
	 */
	lastTickZone: { from: number; to: number } | null;
	/**
	 * How far the axis has to reach — the longest thing drawn, which is **not** the declared duration.
	 *
	 * A dot runs `period × RoundToEven(declared / period)`, so it ends *short* of the declared 30s when
	 * the period does not divide it (29.61–29.80s on `phased`) and *past* it when a refresh keeps its
	 * pending tick (30.14s on `unbroken`). Either way the declared number is the wrong right-hand edge:
	 * it left 0.3s of axis nothing could reach, which is what made the shading look unaligned with the
	 * end of the plot.
	 */
	axisMaxMs: number;
}

/**
 * One bar per refresh, in two segments: how far into the dot the press landed, and how much of that
 * was inside the dot's **own last tick**.
 *
 * The dot is a snapshot, so a refresh is only wanted at its end — on the last tick, where the pending
 * tick rolls over — or just before Ascendance. A press earlier than that throws a tick away, and the
 * violet tail is what separates the two, **per row**.
 *
 * ## Why the tail and not a band
 *
 * There was a single shaded band at the right-hand end of the axis, `durationMs − median(tickMs)` wide,
 * and it contradicted the verdicts drawn against it. The axis is elapsed time and elapsed time is
 * measured against the dot's *declared* 30s, while no application runs for 30s — it runs
 * `period × RoundToEven(30 000 / period)`, plus the pending tick a refresh keeps. So the band sat later
 * than every real last tick: measured on a live pull, two credited presses ended 69ms and 343ms *before*
 * a band they belonged inside, and a reader could see the report crediting a press its own chart drew
 * outside the window. A band cannot be fixed by moving it, because an Apex xaxis annotation spans the
 * whole plot and each row's dot is a different length — 13, 17 or 22 ticks on one pull.
 *
 * The tail is that window drawn per row, off `FlameShockPress.intoLastTickMs`, which is the same
 * measurement the grade is made on. A credited bar therefore *ends inside its own tail* by construction
 * and an early one has no tail at all; `flameShockDepth.test.ts` pins that as an invariant over every
 * press of all three fixtures.
 *
 * Tone is unchanged and still the verdict: the row's colour says what the press was, and the tail says
 * where the dot's last tick began. `phased` grades its refreshes against 1 349ms, 1 748ms and 2 275ms
 * ticks in the same fight as Bloodlust and Elemental Mastery fall off, so no one number could have
 * drawn this.
 */
export function buildBars(flameShock: FlameShockAudit, theme: ChartTheme): DepthSeries {
	const held: Bar[] = [];
	const lastTick: Bar[] = [];
	/**
	 * Where each drawn press's own last tick *opened*, in ms since its application.
	 *
	 * Collected so the chart can shade the stretch these openings fall in. It is a range and not a
	 * threshold: the opening moves with haste, and on a pull whose haste cooldowns drop it moves by most
	 * of a second — which is exactly what the shading is worth showing.
	 */
	const openings: number[] = [];
	/** Where each drawn dot's schedule actually ran out — its opening plus its own final tick. */
	const ends: number[] = [];
	/** The longest bar, so the axis can be sized to the data rather than to a declared number. */
	let longestBar = 0;
	flameShock.presses
		.filter((p) => p.remainingMs !== null)
		.forEach((p, i) => {
			const label = `${String(i + 1).padStart(2, '0')} · ${fmt(p.t)}`;
			// A refresh during Ascendance is the one outright fault; an early refresh (a tick thrown away)
			// is the amber; the last-tick refresh, the Ascendance prep and a refresh that
			// snapshotted a stronger dot are all the accent. That third one has to be here and not only in
			// the ladder: the tone comes off the same predicate `flameShockWaste` does, so leaving it out
			// would draw a press the section calls correct in the fault colour.
			const tone: keyof ChartTheme = p.duringAscendance
				? 'miss'
				: p.windowed || p.ascPrep || p.kind === 'snapshot'
					? 'kick'
					: 'brew';
			// `durationMs − remainingMs` reduces to `t − applyTime`, because `remainingMs` is
			// `applyTime + durationMs − t`. So the bar's length is the real elapsed time since the
			// application and carries none of the declared duration's error; only a *band* anchored to the
			// right-hand end of the axis did.
			const elapsed = flameShock.durationMs - (p.remainingMs ?? 0);
			/**
			 * The part of the bar inside the dot's own last tick — zero for a press that never reached it.
			 *
			 * Clamped to the bar's own length for the one case that can exceed it: a press onto a spawn whose
			 * application had already delivered every scheduled tick reads `intoLastTickMs` measured back from
			 * a tick that landed before the application this bar is drawn for.
			 */
			const rawTailMs = Math.max(0, Math.min(elapsed, p.intoLastTickMs ?? 0));
			/**
			 * The tail, floored so a real one can be seen.
			 *
			 * A press taken a few milliseconds into its last tick has a genuine tail of a few milliseconds,
			 * which on a 30-second axis is a fraction of a pixel — it draws as nothing, and the bar then reads
			 * as though it never reached its last tick at all. That is the case this chart most needs to show,
			 * because it is the one the old declared-duration band got wrong.
			 *
			 * `/ 400` is the sliver rule this codebase already uses for exactly this — `minimumSpan` in
			 * `LanesTimeline`, "a span shorter than this is a sliver too thin to hover, so it is drawn at this
			 * width". **The bar's total length is preserved**: the floor is taken out of the segment below it,
			 * so only the split moves and never the end. The tooltip carries the true figure to the
			 * millisecond, so nothing here is the only statement of it.
			 *
			 * **Clamped to the bar as well as floored, because the two together are a partition and the floor
			 * alone was not.** `rawTailMs` is already bounded by `elapsed`; the floor is not, so a press taken
			 * less than `durationMs / 400` into its own last tick — 75ms on a 30s dot — got a tail longer than
			 * the bar it sits in, and the segment below it went *negative* to keep the total. A stacked bar
			 * with a negative segment draws backwards past zero, and the sum `held + tail === elapsed` the
			 * suite asserts survives it unchanged, because the two errors are equal and opposite. So the two
			 * segments are asserted disjoint and not merely summing: `flameShockDepth.test.ts` reads both off
			 * every bar of all three fixtures and off a synthetic press short enough to reach the floor, which
			 * is the case no committed pull has — the presses on them are 27-31s apart.
			 */
			const tailMs = rawTailMs > 0 ? Math.min(elapsed, Math.max(rawTailMs, flameShock.durationMs / 400)) : 0;
			const meta: TipContent = {
				title: `Refresh ${String(i + 1).padStart(2, '0')}`,
				tone,
				rows: [
					['pressed at', formatStamp(p.t)],
					['dot had run', `${sec(elapsed)}s`],
					['dot left', `${sec(p.remainingMs ?? 0)}s`],
					// This press's *own* tick, which is the width of the tail drawn on its row. On `unbroken`
					// the pull's median is 1 726ms while the press at 83 852 was judged against its own
					// 2 246ms tick, so a median is not merely imprecise here, it is the wrong number for that
					// bar — which is why nothing pull-wide is drawn any more.
					['last tick', `${sec(p.tickMs)}s`],
					// The count the tone was decided on. Published beside the two lengths so a reader can see
					// that the tail and the verdict are one measurement rather than two that happen to agree.
					...(p.ticksLeft !== null ? [['ticks left', `${p.ticksLeft}`] as [string, string]] : []),
					// How far into that tick the press landed, negative when it never got there. This is the
					// tail's own length, so the row says in words exactly what the drawing says in pixels.
					...(p.intoLastTickMs !== null
						? [
								[
									'into last tick',
									p.intoLastTickMs >= 0 ? `${sec(p.intoLastTickMs)}s` : `${sec(-p.intoLastTickMs)}s short`,
								] as [string, string],
							]
						: []),
					// The snapshot delta, on every refresh that has one rather than only on the credited ones.
					// A reader looking at an amber bar wants to see *why* it did not clear the bar, and a
					// figure that appears only when it is flattering is not evidence.
					...(p.snapshotDeltaPct !== null
						? [
								['dot strength', `${p.snapshotDeltaPct > 0 ? '+' : ''}${r1(p.snapshotDeltaPct * 100)}%`] as [
									string,
									string,
								],
							]
						: []),
					p.duringAscendance
						? (['reason', 'refresh during Ascendance'] as [string, string])
						: p.ascPrep
							? (['reason', 'Ascendance prep'] as [string, string])
							: p.windowed
								? (['reason', 'refreshed on the last tick'] as [string, string])
								: p.kind === 'snapshot'
									? (['reason', 'snapshotted a stronger dot'] as [string, string])
									: (['reason', 'early — a tick thrown away'] as [string, string]),
				],
			};
			// Stacked, so the two segments are one bar: what the dot ran before its last tick, and the part
			// of it inside that tick. The same `meta` on both, because a reader hovering either half is
			// asking about the same press.
			held.push({ x: label, y: (elapsed - tailMs) / 1000, fillColor: theme[tone], meta });
			lastTick.push({ x: label, y: tailMs / 1000, fillColor: theme.rune, meta });
			// `elapsed − intoLastTickMs` is the instant this press's last tick opened, whether the press
			// reached it or not: `intoLastTickMs` is negative when it did not, which puts the opening later
			// than the bar ends. Both belong in the range.
			longestBar = Math.max(longestBar, elapsed);
			if (p.intoLastTickMs !== null) {
				const opening = elapsed - p.intoLastTickMs;
				openings.push(opening);
				ends.push(opening + p.tickMs);
			}
		});
	const lastTickZone = openings.length > 0 ? { from: Math.min(...openings), to: Math.max(...ends) } : null;
	return { held, lastTick, lastTickZone, axisMaxMs: Math.max(longestBar, lastTickZone?.to ?? 0) };
}

/**
 * The refresh ledger, drawn.
 *
 * ## Why this chart has no unmeasured row, when the other three grew one
 *
 * `FlameShockUptime`, `SearingTotemUptime` and the Lightning Shield step chart all shade the stretches
 * their own figure stopped counting, because each of those figures is a **share of pull time** and the
 * add waves came out of the denominator. This one is not a share of anything and its axis is not the
 * pull: `x` is milliseconds since *each application*, 0 to `axisMaxMs`, so the same instant of the fight
 * appears at a different `x` on every row and most instants appear on none. `exemptRows` returns
 * intervals in fight time; there is no coordinate on this axis to put one at. A vertical band here would
 * mean "this many seconds into a dot", which is not a fact about the pull at all.
 *
 * **And the figures beside it lost nothing to shade.** The rows are `presses.filter(remainingMs !== null)`
 * — the presses made into a live dot — which is `flameShock.refreshes` exactly: 6 on `unbroken`, 2 on
 * `cleave`, 4 on `phased`, asserted in `exemptTrack.test.ts` beside the clocks that do have a row. That
 * same count is the denominator of `flameShockWaste` (`(refreshes − windowed − ascPrep − snapshotGain) /
 * refreshes`) and the numerator of the section's `In the last tick` tile. So the drawn set *is* the
 * counted set, press for press, at every target count — nothing was dropped from the number for the
 * picture to be honest about.
 *
 * **The one press that tests this, and why shading it would be the `SearingTotemUptime` defect in
 * reverse.** `cleave`'s refresh at 57 499 lands inside the add wave `[52 997, 83 587]` — band 4, where
 * `aoe.apl.json` rung 1 refuses to refresh a live dot at all — and it is drawn amber here. It is also
 * counted: `refreshes` is 2 and the verdict sentence's `wasted` is 1, and that 1 is this press. Greying
 * its row would leave the picture saying "not measured" beside a tile that still says one refresh was
 * wasted, which is exactly the disagreement the other three charts were fixed to remove, pointing the
 * other way.
 *
 * **What is genuinely outstanding is a number and not a drawing.** `flameShockWaste` declares
 * `bands: [1]`, but a declaration does not cut a clock — `cleave` reads as `[1, 2, 3, 4]`, so it
 * intersects non-empty and narrows nothing — and the counts above are taken at every band. `score.ts`
 * names the fix at that threshold in its own words: "a numerator per band in the audit, not a wider
 * declaration here", the shape `earthShockGood.judged` already has. This chart cannot run ahead of it,
 * because it has nothing to run on: `FlameShockPress` publishes no target count and no graded flag, so
 * the amber at 57 499 is the only verdict available to draw. **The field that would change this chart is
 * a per-press `judged: boolean` on `FlameShockPress`** (true where the press was made at a count this
 * rule exists at) — with it, the rows the share stopped counting could be greyed as
 * "Three or more enemies" and the identity above would become `drawn rows === refreshes` still, with the
 * grey ones excluded from both sides. Until the numerator moves, the honest drawing is this one.
 */
export default function FlameShockDepth({ analysis }: { analysis: Analysis }) {
	const { t } = useTranslation('report');
	const el = analysis as Analysis & ElementalAuditResult;
	const { flameShock } = el;
	const refreshes = flameShock.presses.filter((p) => p.remainingMs !== null).length;
	const height = refreshes * ROW_HEIGHT + CHROME;

	const build = useCallback(
		({ theme, narrow, animate }: ChartEnv): ApexOptions => {
			const series = buildBars(flameShock, theme);
			// The stretch the drawn dots' last ticks began in. Restored after being dropped with the old
			// band, and deliberately a different claim from that one: the old band ran to the right-hand end
			// of a *declared* 30s axis and read as "past here is fine", which contradicted the verdicts drawn
			// against it. This runs from the earliest opening to the latest, so it says "the last tick begins
			// somewhere in here, and it moves with your haste" — context for the tails, not a threshold.
			// A single opening degenerates to a line, which is the honest drawing of a pull whose haste never
			// changed.
			const zone = series.lastTickZone;
			return {
				chart: {
					...baseChart({ id: 'ele-flame-shock-depth', type: 'bar', height, theme, animate }),
					stacked: true,
				},
				series: [
					{ name: 'held', data: series.held },
					{ name: 'last tick', data: series.lastTick },
				],
				// Stacked so a row's two segments are one bar. Nothing here is a second measurement stacked on
				// top of a first: the tail is the part of the same elapsed time that fell inside the dot's own
				// last tick, which is what the verdict is, so the bar's total length is unchanged.
				plotOptions: { bar: { horizontal: true, barHeight: '62%', borderRadius: 2 } },
				dataLabels: { enabled: false },
				legend: { show: false },
				stroke: { width: 0 },
				grid: baseGrid(theme),
				annotations:
					zone === null
						? {}
						: {
								xaxis: [
									{
										x: r1(zone.from / 1000),
										...(zone.to > zone.from ? { x2: r1(zone.to / 1000) } : {}),
										fillColor: theme.rune,
										opacity: 0.12,
										borderColor: theme.rune,
										strokeDashArray: zone.to > zone.from ? 0 : 3,
										label: narrow
											? undefined
											: {
													text: t('flameShock.chart.zone'),
													position: 'top',
													orientation: 'horizontal',
													offsetY: -2,
													borderWidth: 0,
													style: {
														background: 'transparent',
														color: theme.muted,
														fontSize: LABEL_FONT_SIZE,
														fontFamily: theme.mono,
													},
												},
									},
								],
							},
				xaxis: {
					type: 'numeric',
					min: 0,
					max: r1(series.axisMaxMs / 1000),
					tickAmount: narrow ? 3 : 5,
					title: {
						text: narrow ? 'seconds into the dot' : 'seconds held into the dot',
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
						style: { colors: theme.muted, fontSize: LABEL_FONT_SIZE, fontFamily: theme.mono },
						formatter: (value: string | number) => `${r1(Number(value))}s`,
					},
				},
				yaxis: {
					labels: {
						maxWidth: narrow ? 88 : 104,
						style: { colors: theme.muted, fontSize: LABEL_FONT_SIZE, fontFamily: theme.mono },
					},
				},
				tooltip: baseTooltip(theme),
			};
		},
		[flameShock, height, t],
	);

	if (refreshes === 0) {
		return <ChartEmpty>{t('flameShock.chart.empty')}</ChartEmpty>;
	}

	return (
		<ChartFigure
			gap="wide"
			caption={
				<>
					<ChartKey tone="kick">{t('flameShock.chart.key.windowed')}</ChartKey>
					{/*
					 * Two keys in the same accent, on purpose. The colour means "this press was correct", and it
					 * covers two unrelated reasons a press can be — the last tick window and a stronger snapshot.
					 * Naming only the first left the second looking like an unexplained exception to the legend.
					 */}
					<ChartKey tone="kick">{t('flameShock.chart.key.snapshot')}</ChartKey>
					<ChartKey tone="brew">{t('flameShock.chart.key.wasted')}</ChartKey>
					{/*
					 * The one tone here that is not a verdict: the tail every bar carries iff the press reached
					 * the dot's own last tick. It replaces the shaded band, which claimed one window for a pull
					 * whose applications ran 13, 17 and 22 ticks — so it is named as a length on the bar rather
					 * than as a region of the plot.
					 */}
					<ChartKey tone="rune">{t('flameShock.chart.key.lastTick')}</ChartKey>
				</>
			}
		>
			<ApexChart build={build} height={height} label={t('flameShock.chart.label')} />
		</ChartFigure>
	);
}
