import { useReportCopy } from '~/hooks/useReportCopy';
import type { VengeanceAudit } from '~/lib/analysis/vengeance';
import { formatInteger, formatPercentValue, formatSeconds } from '~/lib/format';
import type { Analysis } from '~/lib/types';

import ResourceChart from '~/components/charts/ResourceChart';
import { Note, Prose, Section, StatTile, StatTiles } from '~/components/primitives';

/**
 * The attack power a tank was paid for being hit, and how close it came to the ceiling their own
 * health puts on it.
 *
 * **The curve is read, not modelled.** Every event fetched with resources carries the player's
 * `attackPower`, about fourteen times a second on the pulls captured here, so this chart is a
 * measurement of what the player actually had. The simulator is consulted for one thing only: where
 * to draw the line above it. See `lib/analysis/vengeance`, which carries the rule and its citations.
 *
 * **Nothing on this page is graded, and the copy has to earn that.** A tank at their Vengeance cap is
 * not a tank who made a mistake — it means the raid was taking damage faster than that player's health
 * pool could convert it, which is the fight's doing and the healers'. What the reader gets is the
 * shape and the numbers under it.
 *
 * ---
 *
 * **The ceiling moves, and the chart draws it moving.** `ResourceCurve.ceiling` is a step series of
 * what the limit was at each moment, beside the scalar `max` that scales the axis — the scalar is the
 * highest the ceiling ever reached, so the curve stays inside its own axis, and the series is the
 * dashed line `ResourceTrack` draws across it. `cappedOf` reads the same series, so a reading taken
 * under a raised ceiling is measured against *that* ceiling rather than against the pull's highest.
 *
 * Two weaker answers were tried first and are worth recording, because both are what this looks like
 * from the outside. Drawing the resting ceiling alone lets the curve leave the top of its own axis
 * during a raised stretch, which reads as a broken chart. Drawing only the highest and shading the
 * raised stretches keeps the axis honest but inverts the thing the section is for: a player whose
 * ceiling rose to meet them reads as having fallen further from it.
 *
 * The shading stays alongside the line, because the two answer different questions. The line says what
 * the limit was; the shading says who raised it, and only the shading can name Rallying Cry.
 */
export default function Vengeance({ analysis }: { analysis: Analysis }) {
	// Read as optional rather than through `Analysis & ProtectionAudit`, and for the reason every other
	// audit field is read defensively: a report captured before this section existed carries no
	// `vengeance` at all, and a section that assumed one would throw on every committed fixture.
	const { vengeance } = analysis as Analysis & { vengeance?: VengeanceAudit };
	const { t } = useReportCopy(analysis);

	if (vengeance === undefined || vengeance.samples === 0) {
		return (
			<Section id="vengeance" title={t('vengeance.title')}>
				<Prose>{t('vengeance.intent')}</Prose>
				<div className="mt-5">
					<Note>{t('vengeance.noReadings')}</Note>
				</div>
			</Section>
		);
	}

	const { peak, restingCap, peakCap, capWindows, curve } = vengeance;
	const capMoved = capWindows.length > 0 && peakCap !== null && restingCap !== null && peakCap > restingCap;

	return (
		<Section id="vengeance" title={t('vengeance.title')}>
			<Prose>{t('vengeance.intent')}</Prose>

			<div className="mt-4.5">
				<StatTiles>
					<StatTile value={formatInteger(peak?.attackPower ?? 0)} label={t('vengeance.kpi.peak')} />
					{/* Uncoloured, like every tile here. How close a tank came to their ceiling is a fact about
					    how hard the fight hit them. */}
					{peak?.shareOfCap === null || peak === null ? null : (
						<StatTile value={formatPercentValue(peak.shareOfCap * 100)} label={t('vengeance.kpi.share')} />
					)}
					{restingCap === null ? null : (
						<StatTile value={formatInteger(Math.round(restingCap))} label={t('vengeance.kpi.cap')} />
					)}
					<StatTile
						value={vengeance.nearCapMs === 0 ? '—' : formatSeconds(vengeance.nearCapMs)}
						label={t('vengeance.kpi.atCap')}
					/>
				</StatTiles>
			</div>

			{/* The bar the numbers above are all read off, drawn by the same component and at the same scale
			    as every other resource on this page — a run at the ceiling is a shape long before it is a
			    figure, and a reader who cannot see it has to take the tiles on trust. */}
			<div className="mt-5">
				<ResourceChart
					curve={curve}
					durationMs={analysis.durationMs}
					mode="steps"
					// The tone alone, with no spec colour over it. Every other bar on this page is drawn in the
					// class colour because `specSections` builds those from a config that carries one; this
					// section is hand-built, and reaching back through the spec's package root for a colour is
					// a coupling no other section here has. A distinct tone is also the honest signal: holy
					// power is a bar the player spends and this is a stat they are given.
					tone="kick"
					// Steps, not a line. Vengeance holds whatever the last blow set it to until the next one
					// arrives — the buff keeps its stacks and only its remaining duration runs down
					// (`sim/core/vengeance.go:78-80`) — so a diagonal between two readings would draw a climb
					// that never happened.
					showStepLabels={false}
					legend={t('vengeance.key.bar')}
					bands={[
						...(capMoved
							? [
									{
										tone: 'brew' as const,
										windows: capWindows.map((w) => ({ start: w.start, end: w.end })),
										legend: t('vengeance.key.raised', { names: namesOf(capWindows) }),
									},
								]
							: []),
						...(vengeance.nearCap.length === 0
							? []
							: [
									{
										tone: 'miss' as const,
										windows: vengeance.nearCap.map(([start, end]) => ({ start, end })),
										legend: t('vengeance.key.atCap'),
									},
								]),
					]}
					label={t('vengeance.chartLabel', {
						peak: peak?.attackPower ?? 0,
						max: Math.round(curve.max),
						duration: analysis.durationMs,
					})}
				/>
			</div>

			<div className="mt-5 flex flex-col gap-3.5">
				<Prose>
					{t('vengeance.summary', {
						// Two arms, because the default wording is nonsense on a pull that never came near the
						// ceiling — and that is most of them. `clear` states the peak and stops.
						context: vengeance.nearCapMs === 0 ? 'clear' : undefined,
						peak: peak?.attackPower ?? 0,
						share: peak?.shareOfCap === null || peak === null ? 0 : peak.shareOfCap * 100,
						at: peak?.at ?? 0,
						held: vengeance.nearCapMs,
					})}
				</Prose>

				{capMoved && restingCap !== null && peakCap !== null ? (
					<Note>
						{t('vengeance.capMoved', {
							names: namesOf(capWindows),
							times: capWindows.length,
							resting: Math.round(restingCap),
							raised: Math.round(peakCap),
							held: vengeance.capRaisedMs,
						})}
					</Note>
				) : null}

				{/* What the chart cannot see, stated rather than implied. The readings are a sampling grid and
				    a stretch at the ceiling that opened and closed between two of them leaves no trace. */}
				<Note>
					{t('vengeance.resolution', {
						samples: vengeance.samples,
						median: vengeance.medianGapMs,
						p99: vengeance.p99GapMs,
					})}
				</Note>
			</div>
		</Section>
	);
}

/** The buffs that raised the ceiling, named once each and in the order they first did. */
function namesOf(windows: VengeanceAudit['capWindows']): string {
	return [...new Set(windows.flatMap((w) => w.names))].join(', ');
}
