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
import { EXEMPT } from '~/components/charts/tones';

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
 * Tone is the verdict on three rows in four, and the tail says where the dot's last tick began. `phased`
 * grades its refreshes against 1 349ms, 1 748ms and 2 275ms ticks in the same fight as Bloodlust and
 * Elemental Mastery fall off, so no one number could have drawn this.
 *
 * The fourth tone is `EXEMPT`, and it is not a verdict at all — it is the row the share stopped counting.
 * See the note beside `tone` below, and the section on it in `FlameShockDepth`'s own docblock.
 *
 * **The tail stays violet on a greyed row, deliberately.** `rune` is documented in the key as the dot's
 * own last tick and nowhere as a judgement, so drawing it under a grey bar says "the last tick opened
 * here" and not "this press was credited" — which is a measurement the reader can still check, and the
 * one fact about an ungraded press that is worth keeping. A greyed row also still feeds `lastTickZone`
 * and `axisMaxMs`, for the same reason: those describe the dots that were *drawn*, not the presses that
 * were counted.
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
			//
			// `EXEMPT` comes first and outranks all three, because it is not a fourth opinion about the
			// press — it says the share above the chart never looked at it. `flameShockWaste` divides by
			// `refreshes − unjudgedRefreshes`, so a press with `judged: false` is out of both halves of that
			// fraction; drawing it amber would charge the reader for a press no printed number charges them
			// for. It has to outrank `duringAscendance` for the same reason and not as a tie-break: a
			// refresh taken under Ascendance at four enemies is still a press the share dropped.
			const tone: keyof ChartTheme = !p.judged
				? EXEMPT
				: p.duringAscendance
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
					// The count, on the greyed rows only, and this is where the real number gets named. The key
					// beside the chart has to cover every count at once and so says "more than one enemy"; a
					// tooltip is per press and can say eight.
					//
					// **Off `targets` and not off `band`, which is the whole point of the field.** This read
					// `${p.band}`, and `band` is `1 | 2 | 3 | 4` where 4 means four *or more* — so a press made
					// into eight enemies was described to the reader as "4 enemies up". A specific number is
					// read literally; there is no reading of "4" that means "at least 4", which makes the
					// understatement worse than the key's own countless "more than one enemy". `targets` is the
					// reading `band` and `judged` are both taken from, published one step earlier, so the
					// sentence, the grey and the grade still cannot disagree about one press.
					!p.judged
						? (['reason', `not measured, ${p.targets} enemies up`] as [string, string])
						: p.duringAscendance
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
 * ## Why this chart greys rows instead of shading a region
 *
 * `FlameShockUptime`, `SearingTotemUptime` and the Lightning Shield step chart all shade the *stretches*
 * their own figure stopped counting, because each of those figures is a **share of pull time** and the
 * add waves came out of the denominator. This one is not a share of pull time and its axis is not the
 * pull: `x` is milliseconds since *each application*, 0 to `axisMaxMs`, so the same instant of the fight
 * appears at a different `x` on every row and most instants appear on none. `exemptRows` returns
 * intervals in fight time; there is no coordinate on this axis to put one at. A vertical band here would
 * mean "this many seconds into a dot", which is not a fact about the pull at all. So the treatment is
 * **per row** — the greyed bar — and `exemptRows` is still the wrong tool for it.
 *
 * **This chart used to grey nothing, and the reason it gave was true when it was written.** The rows are
 * `presses.filter(remainingMs !== null)` — the presses made into a live dot — which is
 * `flameShock.refreshes` exactly: 6 on `unbroken`, 2 on `cleave`, 4 on `phased`. That *was* also the
 * denominator of `flameShockWaste`, so the drawn set was the counted set press for press, and there was
 * nothing missing from the figure for a grey row to be honest about. The paragraph that used to stand
 * here went further and argued the other way round — that greying `cleave`'s refresh at 57 499 would be
 * the `SearingTotemUptime` defect in reverse, a picture saying "not measured" beside a tile still
 * charging one wasted refresh. That was the right call against that denominator.
 *
 * **`c93b866` moved the denominator, and this chart did not follow for a commit.** `flameShockWaste` now
 * divides by `flameShock.refreshes − flameShock.unjudgedRefreshes`, and on `cleave` those are 2 and 1 —
 * so the share is taken over **one** press while the chart drew two. The press that left the figure is
 * exactly the one the old paragraph defended drawing in amber: 57 499, inside the add wave
 * `[52 997, 83 587]`, where `aoe.apl.json` rung 1 refuses to refresh a live dot at all. Amber there is
 * now the disagreement rather than the fix — a bar coloured "you threw away a tick" for a press no
 * printed number charges the reader for.
 *
 * **What the audit publishes now, and which field does which job.** `FlameShockPress.judged` is the
 * boolean the share's denominator is built out of (`unjudgedRefreshes` is it counted where it is false),
 * and `FlameShockPress.band` is the band it was read at, `judged` being `band === 1`. Both landed after
 * the paragraph above was written; the older text here said `FlameShockPress` published neither, and
 * named a per-press `judged: boolean` as the field that would change this chart. It did.
 *
 * **Select on `judged`, caption off `targets`, and neither of those is `band`.** The greyed rows are
 * `judged === false`, because that is the flag the denominator uses — not `band >= 3`, which differs on
 * a press made at exactly two enemies. That difference is why the key here cannot borrow the existing
 * "Three or more enemies" label: `judged` is false at two enemies as well, and on `cleave` two of the ten
 * presses are band 2. The key says **"More than one enemy, not measured"**, which is true at two and at
 * thirteen, and each greyed row's tooltip names its own count off `FlameShockPress.targets` — "not
 * measured — 4 enemies up" on `cleave`'s band-4 refresh, which really was made at four.
 *
 * **`targets` and not `band`, and this is the correction.** The caption read `${p.band}` and band 4 means
 * four *or more*, so the same sentence would have said "4 enemies up" of a press made into eight. Not
 * reachable on any pull we hold — `cleave`'s only unjudged refresh is at exactly four — which is why it
 * survived a commit. A legend has to cover every row at once and a tooltip is per press, so this is the
 * one place a real count belongs; it just has to be the real one.
 *
 * **The identity that replaces the old one.** Drawn rows are still `refreshes`; the *greyed* rows are
 * `unjudgedRefreshes`; so the rows left in a verdict colour are `refreshes − unjudgedRefreshes`, which is
 * the share's denominator. `exemptTrack.test.ts` asserts that third form on all three fixtures — it used
 * to assert `held.length === refreshes` while the prose beside it claimed to be tracking the
 * denominator, which passed for a commit while being false on `cleave`.
 *
 * **The thing this used to leave unreconciled, and where it was settled.** For one commit the three
 * surfaces disagreed about one press: this chart greyed `cleave`'s refresh at 57 499 while the sentence
 * under the section read "1 refreshes threw away a tick" and the press table tinted that row
 * `bg-band-warn`. The paragraph here handed the question on as a `score.ts` one. It was not — it was a
 * copy question, and `FlameShock.tsx` answers it at `verdict`: the sentence keeps the pull-wide count,
 * because a press that clipped a tick clipped a tick and an unmeasured figure is not a deleted one, and
 * a second clause names how much of that count is measured. The table's **highlight** gives way where
 * its words do not, on the Stormlash precedent that a red cell cannot say which of two things it means.
 * So all three now agree: this chart greys the press, the row says "not measured with more than one
 * enemy up" with no tint, and the sentence says what the dot did and then how much of it counted.
 * Nothing here follows the graded pair alone; what changed is that nothing here *faults* what it drew
 * grey.
 */
export default function FlameShockDepth({ analysis }: { analysis: Analysis }) {
	const { t } = useTranslation('report');
	const el = analysis as Analysis & ElementalAuditResult;
	const { flameShock } = el;
	const refreshes = flameShock.presses.filter((p) => p.remainingMs !== null).length;
	// The rows drawn grey: the refreshes `flameShockWaste` divides neither half of its share by. Counted
	// here so the key can name a colour only when the chart drew it, which is the rule `FlameShockUptime`
	// follows for its own two exempt rows — `unbroken` and `phased` never leave one enemy and get no grey
	// bar and no entry for one. Selected on `judged` rather than on `band >= 3`, because `judged` is the
	// flag `unjudgedRefreshes` is counted out of; the two differ on a press made at exactly two enemies.
	const unmeasured = flameShock.presses.filter((p) => p.remainingMs !== null && !p.judged).length;
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
					{/*
					 * The one row that is not a press's grade but a statement about the share above it: with more
					 * than one enemy up, `flameShockWaste` takes neither the numerator nor the denominator from
					 * this press, so it is drawn in the same grey every other chart in the report uses for a
					 * second its own figure dropped. Named "more than one enemy" and not "three or more": the
					 * flag it is selected on is false at two as well, and `cleave` makes two presses at exactly
					 * two enemies. The exact count is on each row's tooltip, where it is a count of one press.
					 */}
					{unmeasured > 0 ? <ChartKey tone={EXEMPT}>{t('flameShock.chart.key.unmeasured')}</ChartKey> : null}
				</>
			}
		>
			<ApexChart build={build} height={height} label={t('flameShock.chart.label')} />
		</ChartFigure>
	);
}
