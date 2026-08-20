import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatClock, formatInteger, formatSeconds } from '~/lib/format';
import { resourceColorOf, RESOURCE_TYPE } from '~/lib/game/resources';
import type { SpecDefinition } from '~/lib/spec';
import type { Analysis, PointsResourceAudit, PoolResourceAudit } from '~/lib/types';

import { useSpec } from '../report/specContext';
import ResourceChart from '../charts/ResourceChart';
import { cappedOf, emptiedOf } from '../charts/capped';
import type { Tone } from '../charts/tones';
import { DataGrid, Note, Prose, Section, StatTile, StatTiles, type GridRow } from '../primitives';
import LogLink from './LogLink';

/**
 * The spec's resource bar over the pull, rendered by whichever half the audit says it is.
 *
 * A pool bar (energy) refills on a clock, so its fault is a *duration* — seconds spent at the
 * ceiling with the tap still running — and it has to be split into engaged and downtime before it
 * can be judged, because a bar filling behind an untargetable boss is the fight's doing. A points
 * bar (chi) arrives in whole points from a button that was pressed, so its fault is a *count*: a
 * press that returned two into a bar with room for one threw one away, and it did so whether or not
 * there was a boss in front of you. There is nothing to split — which is also why it is drawn as
 * steps rather than as a line: chi is an integer holding four, and sloping between two readings
 * would draw a value the resource cannot hold.
 *
 * Neither half is graded, deliberately. A threshold would have to say how many seconds at the cap,
 * or points of waste, are acceptable, and neither the sim nor the priority list contains such a
 * number — the APL spends a resource when it has something worth spending it on and pools it when
 * it does not. The tiles carry a colour anyway, from the spec's own reading aid, so a number a
 * reader cannot calibrate hints at its own size; the copy beside it never says good or bad. It
 * states the number.
 */
export default function Resource({ analysis, id, barKey, copyPrefix, tone, color }: ResourceProps) {
	const bar = analysis.resources?.[barKey];
	// The reading aid the tiles are coloured by, read off the spec this report argues from rather than
	// passed in beside the bar's config. The same route `useReportCopy` takes to the spec's scoring: a
	// bar's own props say what to draw, and what a share of waste *means* is the spec's to say. Handed
	// in, the generic section list had to name one spec's module to build any spec's bars — which is
	// how every bar came to be coloured by the monk's bands and the Elemental's by a stub.
	const { wasteTone } = useSpec();

	// A report captured before the engine sampled resources carries no bar at all, and one captured
	// between the events query and the audits carries the bare curve without its `kind` — either way
	// there is no bar to draw, and the heading still has to render, because `SectionNav` lists every
	// section unconditionally and a link with no heading behind it is a jump to nowhere.
	if (bar === undefined || !('kind' in bar)) {
		return <EmptyBar analysis={analysis} id={id} copyPrefix={copyPrefix} />;
	}

	// The bar's own colour from the sim's palette; the spec's primary is only the fallback for a bar
	// the sim has not coloured.
	const barColor = resourceColorOf(bar.type) ?? color;

	return bar.kind === 'pool' ? (
		<PoolBar
			analysis={analysis}
			id={id}
			copyPrefix={copyPrefix}
			tone={tone}
			color={barColor}
			wasteTone={wasteTone}
			bar={bar}
		/>
	) : (
		<PointsBar
			analysis={analysis}
			id={id}
			copyPrefix={copyPrefix}
			tone={tone}
			color={barColor}
			wasteTone={wasteTone}
			bar={bar}
		/>
	);
}

export interface ResourceProps {
	analysis: Analysis;
	/** The nav anchor — the same id the section list carries, so the heading lives behind its link. */
	id: string;
	/** The bar this section draws, by its key in the spec's `resources` config. */
	barKey: string;
	/** The copy namespace: every key this section reads starts with it (`energy`, `chi`, …). */
	copyPrefix: string;
	/** The swatch tone the bar draws in when neither the sim's colour nor the spec's is available. */
	tone: Tone;
	/** The spec's primary, as the fallback for a bar the sim has not coloured. */
	color: string;
}

/**
 * The heading every empty state shares, whatever the reason the bar is missing.
 *
 * The copy says what it says — the log carried no readings — for the bar that was never sampled
 * and the one whose snapshot predates the audits alike, because both claims are the same fact
 * stated at different degrees of confidence. Nothing is wrong with the pull either way; the report
 * was simply not given the numbers.
 */
function EmptyBar({ analysis, id, copyPrefix }: { analysis: Analysis; id: string; copyPrefix: string }) {
	const { t } = useReportCopy(analysis);
	return (
		<Section id={id} title={t(`${copyPrefix}.title`)}>
			<Prose>{t(`${copyPrefix}.intent`)}</Prose>
			<div className="mt-5">
				<Note>{t(`${copyPrefix}.none`)}</Note>
			</div>
		</Section>
	);
}

/**
 * The pool half: a bar that refills on a clock, so the fault is a duration, split into engaged and
 * downtime before it can be judged.
 */
function PoolBar({
	analysis,
	id,
	copyPrefix,
	tone,
	color,
	wasteTone,
	bar,
}: {
	analysis: Analysis;
	id: string;
	copyPrefix: string;
	tone: Tone;
	color: string;
	wasteTone: SpecDefinition['wasteTone'];
	bar: PoolResourceAudit;
}) {
	const { t } = useReportCopy(analysis);

	const rows = useMemo<GridRow[]>(
		() =>
			// Selected by severity, shown on the clock — and those are two different jobs. The engine still
			// picks the five longest stretches, because a table of every cap on a four-minute pull is not a
			// table anyone reads; sorting here before that cut would have shown the first five stretches
			// instead of the worst five, which is a quietly different claim. What changes is only the order
			// the five are drawn in, so a row can be matched to the chart above it. The `held` column is
			// what carries severity now.
			[...(bar.worst ?? [])]
				.sort((a, b) => a.at - b.at)
				.map((cap, i) => ({
					key: `${cap.at}-${i}`,
					// Only the engaged stretches are banded. A cap through an intermission is a fact about the
					// fight, and colouring it the same as one taken with a boss in front of you would undo the
					// split the rest of the section exists to make.
					band: cap.engaged ? ('warn' as const) : undefined,
					cells: {
						at: <LogLink href={cap.link}>{formatClock(cap.at)}</LogLink>,
						held: <b className="font-semibold text-ink-2">{formatSeconds(cap.ms)}</b>,
						where: (
							<span className={cap.engaged ? undefined : 'text-ink-2'} style={cap.engaged ? { color } : undefined}>
								{t(cap.engaged ? `${copyPrefix}.where.engaged` : `${copyPrefix}.where.downtime`)}
							</span>
						),
					},
				})),
		[bar, t, color, copyPrefix],
	);

	// No samples is not "never capped": it is a log that carried no resource snapshots, and saying
	// "the bar never reached the top" about one would be a claim made out of missing data.
	if (bar.samples === 0) {
		return <EmptyBar analysis={analysis} id={id} copyPrefix={copyPrefix} />;
	}

	// Mana is the one pool whose being full is not a fault — it sits at the ceiling until cast, and a
	// full bar is exactly where it should be. Its fault is the floor: running out, which no other bar
	// can do. So the mana half of a pool section shades the empty stretches in red instead of the
	// capped ones, and reads the empty duration instead of a cap table.
	if (bar.type === RESOURCE_TYPE.mana) {
		const emptied = emptiedOf(bar.curve);
		const emptiedMs = emptied.reduce((s, w) => s + w.end - w.start, 0);
		return (
			<Section id={id} title={t(`${copyPrefix}.title`)}>
				<Prose>{t(`${copyPrefix}.intent`)}</Prose>
				<div className="mt-4.5">
					<ResourceChart
						curve={bar.curve}
						durationMs={analysis.durationMs}
						tone={tone}
						color={color}
						smooth
						legend={t(`${copyPrefix}.key.bar`)}
						bands={[{ tone: 'miss', windows: emptied, legend: t(`${copyPrefix}.key.empty`) }]}
						label={t(`${copyPrefix}.chartLabel`, {
							max: bar.curve.max,
							empty: emptiedMs,
							duration: analysis.durationMs,
						})}
					/>
				</div>
				<div className="mt-5">
					<Prose>
						{emptiedMs === 0
							? t(`${copyPrefix}.clean`)
							: t(`${copyPrefix}.summary`, { empty: emptiedMs, duration: analysis.durationMs })}
					</Prose>
				</div>
				<div className="mt-4">
					<Note>
						{t(`${copyPrefix}.resolution`, {
							samples: formatInteger(bar.samples),
							median: bar.medianGapMs,
							p99: bar.p99GapMs,
						})}
					</Note>
				</div>
			</Section>
		);
	}

	const capped = bar.total.cappedMs > 0;
	const wasted = bar.engaged.wasted;
	const curve = bar.curve;
	/**
	 * The clock both tiles below are fractions of: the time the player had something to hit.
	 *
	 * The same one the debuff section and Chi Brew's ceiling use, and the same one `bar.engaged` is
	 * now split on — so the numerator and the denominator of each tile come from one reading of the
	 * pull. It is published on `debuff` because that is the section that owns it; `durationMs` is the
	 * fixture fallback, which is what those pulls were measured on.
	 */
	const measuredMs = analysis.debuff.contactMs || analysis.durationMs;

	return (
		<Section id={id} title={t(`${copyPrefix}.title`)}>
			<Prose>{t(`${copyPrefix}.intent`)}</Prose>

			{/* The bar itself, drawn by the same component and at the same scale as the timeline's row for
			    it, so the two are recognisably one reading rather than two charts of the same pull. The
			    numbers below are all derived from this line, and a reader who cannot see it has to take
			    them on trust — a run at the cap is a shape long before it is a figure. */}
			{curve.points.length === 0 ? null : (
				<div className="mt-4.5">
					<ResourceChart
						curve={curve}
						durationMs={analysis.durationMs}
						tone={tone}
						color={color}
						smooth
						legend={t(`${copyPrefix}.key.bar`)}
						// The shaded stretches are regeneration that arrived on a full bar and went nowhere, so
						// the key says what was lost rather than what the bar was doing. It reads close enough
						// to the table's "full for" column to have borrowed it, and that is precisely why it
						// has its own string: one describes a colour, the other heads a column of durations.
						bands={[{ tone: 'miss', windows: cappedOf(curve), legend: t(`${copyPrefix}.key.lost`) }]}
						label={t(`${copyPrefix}.chartLabel`, {
							max: curve.max,
							capped: bar.total.cappedMs,
							duration: analysis.durationMs,
						})}
					/>
				</div>
			)}

			{capped ? (
				<>
					<div className="mt-4.5">
						<StatTiles>
							{/* Waste first, as in the points half. Its denominator is the energy generated at the
							    measured refill rate over the time there was something to spend it on — so a log too
							    busy to measure a rate on gets the number with no colour rather than a colour built
							    on a guess.

							    Over contact time and not the pull's length, which is what this shipped with: the
							    pull's length credits the player with regen through every second they could not act,
							    and on a Galakras pull that is 117 seconds of energy nobody could ever have spent
							    padding the denominator of their own waste. */}
							{wasted === null ? null : (
								<StatTile
									value={formatInteger(wasted)}
									label={t(`${copyPrefix}.kpi.wasted`)}
									grade={wasteTone(wasted, (bar.regenPerSec ?? 0) * (measuredMs / 1000))}
								/>
							)}
							{/* Seconds, and only seconds. This tile used to sit beside a second one showing the
							same quantity as a share of engaged time — two tiles, one fact, and the reader
							left to work out that they were the same number twice. The share moved into the
							sentence below, which has room to say what it is a share *of*; a bare percentage
							in a tile does not.

							Coloured as that share all the same, because a bare duration is the one thing a
							reader cannot calibrate: eleven seconds is nothing on a nine-minute pull and most
							of a short one. Same reading aid and same caveat as everywhere else on this page —
							`lib/score` still grades no resource metric, because neither the sim nor the priority
							list says how many seconds at the cap are acceptable, and this number never reaches
							the scorecard or the headline. */}
							<StatTile
								value={formatSeconds(bar.engaged.cappedMs)}
								label={t(`${copyPrefix}.kpi.engaged`)}
								grade={wasteTone(bar.engaged.cappedMs, measuredMs)}
							/>
						</StatTiles>
					</div>

					<div className="mt-5 flex flex-col gap-3.5">
						<Prose>
							{bar.regenPerSec === null
								? t(`${copyPrefix}.summaryNoRate`, {
										capped: bar.total.cappedMs,
										duration: analysis.durationMs,
										pct: bar.total.pct,
									})
								: t(`${copyPrefix}.summary`, {
										capped: bar.total.cappedMs,
										duration: analysis.durationMs,
										pct: bar.total.pct,
										regen: bar.regenPerSec,
									})}
						</Prose>
						<Prose>
							{t(`${copyPrefix}.split`, {
								context: bar.engaged.cappedMs > 0 ? 'some' : 'none',
								engaged: bar.engaged.cappedMs,
								engagedPct: bar.engaged.pct,
								downtime: bar.downtime.cappedMs,
							})}{' '}
							{wasted !== null && wasted > 0 ? t(`${copyPrefix}.wasted`, { wasted }) : null}
						</Prose>
					</div>

					<div className="mt-5">
						<DataGrid
							caption={t(`${copyPrefix}.caption`)}
							minWidth="420px"
							columns={[
								{ key: 'at', label: t(`${copyPrefix}.columns.at`), width: '96px' },
								{ key: 'held', label: t(`${copyPrefix}.columns.held`), align: 'right', width: '110px' },
								{ key: 'where', label: t(`${copyPrefix}.columns.where`), align: 'right' },
							]}
							rows={rows}
							empty={t(`${copyPrefix}.noRows`)}
						/>
					</div>
				</>
			) : (
				<div className="mt-5">
					<Prose>{t(`${copyPrefix}.clean`)}</Prose>
				</div>
			)}

			{/* Always shown, capped or not. The resolution is a property of how the bar was read, so it
			    qualifies "you never capped" exactly as much as it qualifies a number of seconds. */}
			<div className="mt-4">
				<Note>
					{t(`${copyPrefix}.resolution`, {
						samples: formatInteger(bar.samples),
						median: bar.medianGapMs,
						p99: bar.p99GapMs,
					})}
				</Note>
			</div>
		</Section>
	);
}

/**
 * The points half: whole points from a button that was pressed, so the fault is a count of what a
 * press threw away — whether or not there was a boss in front of you, which is why nothing here is
 * split into engaged and downtime.
 */
function PointsBar({
	analysis,
	id,
	copyPrefix,
	tone,
	color,
	wasteTone,
	bar,
}: {
	analysis: Analysis;
	id: string;
	copyPrefix: string;
	tone: Tone;
	color: string;
	wasteTone: SpecDefinition['wasteTone'];
	bar: PointsResourceAudit;
}) {
	const { t } = useReportCopy(analysis);

	const curve = bar.curve;
	const overflow = useMemo(() => curve.wasted ?? [], [curve]);
	const total = useMemo(() => overflow.reduce((sum, w) => sum + w.wasted, 0), [overflow]);

	const rows = useMemo<GridRow[]>(
		() =>
			// The clock, matching the curve directly above it. This table used to rank worst-first, on the
			// argument that a press throwing away two points is a different mistake from one throwing away
			// one — which is true, and is why the `wasted` column is still coloured and still carries the
			// count. What ranking cost was the reader's ability to tie a row to the chart above: every
			// overflow row renders, so severity is a column they can scan, while sequence was information
			// only the order could carry and the sort was spending it.
			[...overflow]
				.sort((a, b) => a.t - b.t)
				.map((w, i) => ({
					key: `${w.t}-${i}`,
					band: 'warn' as const,
					cells: {
						at: <span className="tabular font-mono">{formatClock(w.t)}</span>,
						wasted: <b className="font-semibold text-miss">{formatInteger(w.wasted)}</b>,
					},
				})),
		[overflow],
	);

	if (curve.points.length === 0) {
		return <EmptyBar analysis={analysis} id={id} copyPrefix={copyPrefix} />;
	}

	return (
		<Section id={id} title={t(`${copyPrefix}.title`)}>
			<Prose>{t(`${copyPrefix}.intent`)}</Prose>

			<div className="mt-4.5">
				{/* Three views of one accounting, worst first. The press count and the bar's ceiling were here
				    before and are gone: the ceiling is drawn on the chart below, and how *many* presses
				    overflowed matters far less than how much chi they threw away — two presses losing one
				    each is a smaller fault than one press losing two. */}
				<StatTiles>
					{/* Waste leads, and carries the only colour on the row. `gained` excludes the overflow by
					    construction — the walk clamps each gain at the ceiling — so the share is measured
					    against everything the pull generated, overflow included, which is the denominator a
					    reader means by "how much did I throw away". */}
					<StatTile
						value={formatInteger(total)}
						label={t(`${copyPrefix}.kpi.wasted`)}
						grade={wasteTone(total, (curve.gained ?? 0) + total)}
					/>
					<StatTile value={formatInteger(curve.spent ?? 0)} label={t(`${copyPrefix}.kpi.spent`)} />
					<StatTile value={formatInteger(curve.gained ?? 0)} label={t(`${copyPrefix}.kpi.gained`)} />
				</StatTiles>
			</div>

			{/* The same component the timeline draws the bar with, at the same scale and in the same
			    colour, so the row up there and the chart down here are recognisably one bar rather than
			    two readings of it. It marks each overflow itself, which is why no band is passed — only
			    the line of the key that says what those marks are, and only when the pull has any. */}
			<div className="mt-5">
				<ResourceChart
					curve={curve}
					durationMs={analysis.durationMs}
					mode="steps"
					tone={tone}
					color={color}
					legend={t(`${copyPrefix}.key.bar`)}
					wastedLegend={t(`${copyPrefix}.key.wasted`)}
					label={t(`${copyPrefix}.chartLabel`, { max: curve.max, wasted: total })}
				/>
			</div>

			<div className="mt-5">
				{total === 0 ? (
					<Prose>{t(`${copyPrefix}.clean`)}</Prose>
				) : (
					<>
						<Prose>{t(`${copyPrefix}.summary`, { wasted: total, moments: overflow.length })}</Prose>
						<div className="mt-5">
							<DataGrid
								caption={t(`${copyPrefix}.tableCaption`)}
								minWidth="360px"
								columns={[
									{ key: 'at', label: t(`${copyPrefix}.columns.at`), width: '120px' },
									{ key: 'wasted', label: t(`${copyPrefix}.columns.wasted`), align: 'right' },
								]}
								rows={rows}
								empty={t(`${copyPrefix}.noRows`)}
							/>
						</div>
					</>
				)}
			</div>

			{/* The same caveat the pool half carries, and for the same reason: the bar is read from whatever
			    events happened to report it, so a point gained and spent between two readings is invisible
			    here. The count is a floor, not a total. */}
			<div className="mt-4">
				<Note>{t(`${copyPrefix}.resolution`)}</Note>
			</div>
		</Section>
	);
}
