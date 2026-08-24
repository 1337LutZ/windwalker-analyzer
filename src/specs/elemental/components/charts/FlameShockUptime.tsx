import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { complementOf, intersect } from '~/lib/analysis/intervals';
import type { Analysis, ElementalAuditResult } from '~/lib/types';

import { ChartFigure } from '~/components/primitives';
import ChartEmpty from '~/components/charts/ChartEmpty';
import ChartKey from '~/components/charts/ChartKey';
import { exemptRows } from '~/components/charts/exempt';
import { EXEMPT } from '~/components/charts/tones';
import type { Track } from '~/components/charts/WindowTracks';
import WindowTracks from '~/components/charts/WindowTracks';

/**
 * Flame Shock across the pull: where the dot was up, where it was not, and where there was nothing to
 * put it on.
 *
 * The same three tracks the Rising Sun Kick debuff draws. It used to draw the first two only, on the
 * grounds that the dot is on the primary target so a gap is always the player's — which is true of the
 * *target* and false of the *clock*. The section had already stopped charging for an intermission (the
 * down row below is clipped to `contactSegments`), so a submerge came out of the percentage and stayed
 * in the picture as an unexplained empty stretch: a reader looking at `phased` saw fifty seconds with
 * no band at all above a tile reading 88.67%, and no way to tell that gap from one the player caused.
 *
 * **Two exempt causes, and the second one arrived with the clock that dropped it.** `flameShock.scoredMs`
 * is `contact` less every stretch three or more enemies were up, so the tile now reads 83.90% of 178 814ms
 * on `cleave` where it used to read 72.30% of 261 572ms. Until this row landed the red row still spanned
 * those add waves — fault time the figure beside it no longer charges — which is the one thing this chart
 * may not do. So the AoE stretches leave the red row and arrive as a ground, in the same breath.
 *
 * `lightningShield.aoeWindows` is where they are read from, because it is the array the audit's own
 * `gradedSpans` is the complement of — one published set, three clocks cut with it, rather than a fourth
 * reading of "when was it AoE" taken here. That is the identity `exemptTrack.test.ts` enforces, and it is
 * checkable on this chart to the millisecond: the two exempt rows sum to `durationMs - flameShock.scoredMs`.
 *
 * **The clock split, which came first.** `flameShock.windows` is
 * the dot's whole life on the primary target and `uptimeMs` is its union — deliberately unclipped, so a
 * stretch where the boss stopped being hittable does not put a seam in the dot (see the field's own note
 * in `types.ts`). The percentage beside the chart divides something else: `contactUptimeMs / scoredMs`,
 * both halves cut to the graded clock. So the row drew 235 007ms of `cleave` above a tile taking 83.90% of
 * 178 814, and the two were not the same claim. **This predates the AoE cut and is not caused by it:** the
 * gap is 9 309ms on `phased` and 1 071ms on `unbroken`, neither of which ever leaves one enemy, so it is
 * the *contact* clock that has always been outside the row.
 *
 * The fix was to split the row rather than to clip it away. Green became the dot inside the graded clock
 * — the part the percentage is about — and the seconds the dot was genuinely up outside that clock became
 * a row of their own, in the exempt tone with a name that says it: a dot that really was on the target is
 * a fact about the pull, and `8e011ac`'s rule for exactly this shape is that an unmeasured figure is not
 * a deleted one. Hiding it would trade one disagreement for a second: the reader would see green stop and
 * have nothing saying the dot had not dropped there.
 *
 * **Five rows, because the clipped green one was still two subjects.** The clip made the row agree with
 * the tile about *time*; it could not make it agree about *which enemy*. Green was the **primary
 * target's** dot while `contactUptimeMs` is the dot on **whichever spawn was being hit**, so the clipped
 * row read 160 293ms against a 150 023ms numerator on `cleave` — a 10 270ms residual that was dot time on
 * an enemy the player had stopped hitting.
 *
 * That residual is now a row rather than a discrepancy, and the shape of the fix is a **re-partition and
 * not a substitution**. `84d41f8` published `contactWindows`, the numerator's own spans, union exactly
 * `contactUptimeMs`. Simply sourcing green from it was measured and refused: on `cleave`
 * `contactWindows` sits *wholly inside* the clipped row, so swapping the source would have deleted
 * 10 270ms of dot the player really did have on the primary target *inside the graded clock*, which is
 * where `8e011ac`'s rule — an unmeasured figure is not a deleted one — points the other way. So green becomes
 * the published numerator and the difference becomes a row of its own: `flameShock.track.elsewhere`, the
 * dot up inside the graded clock on an enemy the player had left.
 *
 * **And then the containment turned round, which is what red was left behind by.** "`contactWindows` sits
 * wholly inside the clipped row" is a fact about the three pulls then committed, and `addsThenBoss` is not
 * one of them. Its primary target is on a tower for seven minutes and cannot be dotted, so
 * `flameShock.windows` is a **single** late span of 118 198ms while the numerator is **71** spans totalling
 * 240 421ms, taken on whichever of the six other spawns the player was actually hitting. Green moved to the
 * numerator; red stayed the complement of `windows`. So **146 615ms of green was painted red underneath
 * itself** — the up and down rows overlapped by that much, the three claim rows summed to 472 922ms of a
 * 326 307ms clock, and the chart drew *under half* the uptime its own tile reported. On the three pulls that
 * do contain, red is the same array either way, which is why nothing went red until the fourth pull was
 * asked.
 *
 * **The fix is the complement of both series, and both remainders are placed.** Red is now
 * `graded − (windows ∪ contactWindows)`: the graded clock less every second either published series says the
 * dot was up. The two disagreements between the series then land in named rows rather than on top of each
 * other —
 *
 *   - the **positive** one, primary dot inside the clock that the numerator does not count, is
 *     `flameShock.track.elsewhere`: 10 270ms on `cleave`, 9 150ms on `addsThenBoss`, zero on both
 *     single-spawn pulls;
 *   - the **negative** one, numerator on spawns the primary-keyed array never sees, belongs to green and
 *     to nothing else: 146 615ms on `addsThenBoss`, zero on the other three, and sixteen times the positive
 *     one on the pull that has both. Sizing this off `cleave`'s 10 270 would have missed it entirely.
 *
 * Red falls from 223 351ms to 76 736ms on `addsThenBoss` and does not move on any other pull. **No
 * published figure moves anywhere** — `uptimePct` still reads 73.68% of 326 307ms — because this was only
 * ever which series a row was drawn from. `uptimeRow.test.ts` asserts both remainders and the closing
 * identity, and it asserts them on every pull `rawFixtures` finds rather than on a named three: the literal
 * grid is the mechanism that hid this, not an incidental.
 *
 * The other identity the split moved is the aura's own total. `up + elsewhere + uncounted` used to be
 * `uptimeMs`; it is now `windows ∪ contactWindows`, which is `uptimeMs` plus the negative remainder —
 * 264 813ms on `addsThenBoss`, unchanged on the rest.
 *
 * **It is not a ground, and that is the whole reason it needs its own tone.** The two grey causes below
 * are time the denominator *dropped*; this is time the denominator **kept**. It sits inside `scoredMs`
 * and outside `contactUptimeMs`, so it costs the percentage exactly as a dropped dot does — but the dot
 * was up, so painting it `miss` would call it a drop, and painting it `EXEMPT` would say the reader was
 * forgiven for it. `missSoft` is the tone already used for a shortfall that is not a flat fault (the tail
 * on a brew that went out just too late, in `SnapshotDepth`), and it is what the third state here is.
 *
 * **Verified as the label rather than assumed.** The residual could have been an untargetable stretch or
 * a dot outliving its target, and either would make the name a lie. Measured against the audit's own
 * walk on `cleave`: 11 spans, all 10 270ms inside `contactSegments` and inside the graded clock, and
 * every millisecond owned by a landed hit on a **non-primary** spawn — 478:1, 478:2 and five copies of
 * 483, never 470:- and never the stretch before the first hit. The player was hitting something; the
 * something did not have the dot; the boss did.
 *
 * **Zero on both single-target pulls, which is the evidence and not an absence.** `phased` and `unbroken`
 * have one spawn between them, so "the enemy being hit" and "the primary target" are the same enemy and
 * this row cannot exist. Their 9 309 / 1 071 ms sit in the *uncounted* row above instead — the clock's
 * half of the old gap — which is what separates the two causes: one is about the clock, this one is about
 * the subject.
 *
 * **The multi-dot clock gets no row here, and no chart of its own.** `flameShock.multiTargetMs` is band 2
 * *alone* — the only clock in the audit cut at both ends — so its exempt time is the add waves shaded
 * below **plus** every stretch at one enemy. Shading that floor on this chart would be a lie about this
 * chart: band 1 is fully graded for the primary dot, and the two clocks would be claiming the same grey
 * for opposite reasons. A chart of its own cannot be drawn either, because the secondary target's dot
 * windows are not published and a track chart with no `up` row is a picture of grounds. So the second
 * target's clock is stated in copy instead (`flameShock.multiDotNote`) and its arithmetic is asserted
 * without a picture, in `exemptTrack.test.ts` beside the two clocks that have one.
 */
export default function FlameShockUptime({ analysis }: { analysis: Analysis }) {
	const { t } = useTranslation('report');
	const el = analysis as Analysis & ElementalAuditResult;
	const { flameShock } = el;
	const windows = flameShock.windows;
	// The numerator's own spans, published at `84d41f8`. Read straight rather than re-derived: the green row
	// below *is* this array, so `unionMs` of it is `flameShock.contactUptimeMs` by the field's own contract.
	const contactSpans = flameShock.contactWindows;
	const aoeWindows = el.lightningShield.aoeWindows;
	const { up, elsewhere, uncounted, dropped, exempt } = useMemo(() => {
		// The dot's whole life on the primary target, before any clip below. Not a row on its own any more,
		// and no longer the whole of what the three rows it feeds cover either: `up + elsewhere + uncounted`
		// is `drawn ∪ counted`, which is this array only on a pull where the numerator never left it.
		const drawn = windows.map((w): [number, number] => [w.start, w.end]);
		// The numerator's own spans as intervals. Mapped once and used twice on purpose: green *is* this
		// array, and the red row's complement has to be taken over it as well as over `drawn`. Two mappings
		// of one published field is two chances for the row a reader sees and the row it is subtracted from
		// to stop being the same set.
		const counted = contactSpans.map((w): [number, number] => [w.start, w.end]);
		// "Down" is the dot missing while the player was in contact and a list asked for the dot — the
		// complement of **both** dot series, clipped to the same clock the percentage is taken over, so
		// neither an intermission the fight took nor an add wave the multi-target order has no Lava Burst in
		// is drawn as a dot the player dropped. The fallback (the whole pull) keeps the chart unchanged on a
		// fixture captured before the core carried the contact clock.
		const contact = analysis.timeline?.contactSegments ?? [[0, analysis.durationMs]];
		const aoe = aoeWindows.map((w): [number, number] => [w.start, w.end]);
		// `intersect(contact, complementOf(aoe))` is `fsGraded` in the audit, spelled the same way round.
		// Rebuilt here rather than published as an array because what the audit publishes is its *length*
		// (`scoredMs`), and the two are checked against each other rather than trusted: the rows below sum
		// to `durationMs - scoredMs` exactly, which is the assertion in `exemptTrack.test.ts`.
		const graded = intersect(contact, complementOf(aoe, analysis.durationMs));
		// The exempt rows are the rest of the pull — exactly the stretches the clip above threw out of the
		// denominator, split by cause. Each cause is passed as the array it *is* rather than as a share of
		// the complement, and `exemptRows` does the trimming: two derivations of one fact is how a band and
		// a percentage end up disagreeing about which seconds were forgiven.
		//
		// Precedence is argument order, strongest claim first, and the intermission outranks the add wave
		// for the reason `exemptRows` gives: "you could not act at all" beats "you were acting against a
		// different order". A reader shown AoE grey over a submerge would conclude the multi-target order
		// excused them when in fact there was nothing there to press at.
		return {
			// The four rows that partition the pull: the tile's own numerator, the rest of the dot inside the
			// clock, the clock's dotless remainder, and the clock's complement split by cause. `up + elsewhere
			// + dropped` is `graded` and adding `exempt` is the pull — the identity `uptimeRow.test.ts` asserts
			// as a partition, pair by pair, and `exemptTrack.test.ts` asserts the grounds half of.
			//
			// **Green is the published array and not an intersection of it.** `contactWindows` *is*
			// `contactUptimeMs`'s own spans (its union is that field exactly, off one merge in the audit), so
			// drawing it makes the row the tile's numerator to the millisecond rather than something that
			// happens to sum to it. Deliberately not clipped to `graded` here even though it is inside it on
			// every committed pull: a clip would silently absorb an escape, and the partition below is what has
			// to catch one. If it ever left the graded clock, `up + elsewhere + dropped` would exceed
			// `scoredMs` and green would overlap the grounds — both asserted.
			//
			// It is emphatically **not** inside `drawn`, which is the thing this row was mistakenly assumed to
			// be a subset of. See the red row.
			up: counted,
			// The other half of the old green row: the dot up on the primary target, inside the graded clock,
			// while the enemy actually being hit had no dot on it. Time the denominator kept and the numerator
			// did not, so it is a shortfall rather than a ground — see the tone argument in the docblock.
			elsewhere: intersect(intersect(drawn, graded), complementOf(counted, analysis.durationMs)),
			uncounted: intersect(drawn, complementOf(graded, analysis.durationMs)),
			// **The complement of both series and not of `drawn` alone.** Red is "the dot was on nothing", so
			// it has to be the graded clock less every second either series says the dot was up — and green is
			// the series that is *not* a subset of the other one. Taken over `drawn` alone it re-drew every
			// second of the numerator that sat on a spawn the primary-keyed array knows nothing about: on
			// `addsThenBoss` the primary is on a tower for seven minutes, `drawn` is one late 118 198ms window,
			// and 146 615ms of green was painted red underneath itself. That is the whole of the two rows'
			// overlap, and subtracting `counted` here is what removes it. Nothing moves on a pull where the
			// numerator is inside the primary's dot, which is all three of the others.
			dropped: intersect(complementOf([...drawn, ...counted], analysis.durationMs), graded),
			exempt: exemptRows(
				[
					{ label: t('flameShock.track.away'), windows: complementOf(contact, analysis.durationMs) },
					{ label: t('flameShock.track.aoe'), windows: aoe },
				],
				analysis.durationMs,
			).filter((row) => row.windows.length > 0),
		};
	}, [analysis.durationMs, windows, contactSpans, analysis.timeline?.contactSegments, aoeWindows, t]);

	/**
	 * Up and counted, up on an enemy the player had left, down, the dot the clock did not count, then the
	 * grounds all four were measured against — those last so they sit behind the claim rather than over it,
	 * and only the ones this pull actually has.
	 *
	 * Only the fault row is gated, and the up row is not. The up row is the dot's own aura windows cut to
	 * the graded clock, so a short one is very nearly always a real dot that really was on the target — a
	 * dot on an add that died, or one clipped by the pull ending. Hiding it at sub-pixel width would be the
	 * chart disagreeing with the uptime figure beside it, and that is still the worse of the two risks now
	 * the clip can also truncate a window at a clock boundary. The down row is a complement, so it
	 * fragments on every refresh the log stamped a few hundred milliseconds early, and widening that
	 * jitter would paint a fault the pull did not have. See `Track.widen`.
	 *
	 * The uncounted row takes the exempt tone and `widen: false` with the grounds, because that is what it
	 * is: not a judgement, and no tile counts its spans one by one. It carries its own length label — the
	 * dot was up for those seconds, it just was not measured — so a reader hovering it is told the fact and
	 * not merely the exemption.
	 *
	 * **The elsewhere row sits directly under green and is gated on being non-empty, both deliberately.**
	 * Under green because the two are the halves of one span — the dot inside the graded clock — and a
	 * reader comparing the chart against the tile is reading exactly that split. Gated because it is empty
	 * on every single-target pull, where there is no other enemy for the dot to be on: an empty row there
	 * would read as a rendering fault rather than as the finding, which is the argument
	 * `exemptTrack.test.ts` already makes for the AoE row, and it is what keeps `phased`'s pinned row list
	 * unchanged. `widen: false` for the reason the down row has it — it fragments, 11 spans on `cleave`,
	 * and it is a shortfall, so overstating it paints time the reader did not lose.
	 *
	 * **The exempt rows are `widen: false` and carry no length floor either, which is the report's one
	 * answer to "which slivers count".** They are grounds rather than marks, so a sliver of one is the
	 * sampling either side of a `contactSegments` boundary rather than a phase — widened to the floor it
	 * would claim a break in the fight that never happened. Left at true width it is a fraction of a
	 * pixel, which is what a rounding artefact deserves, and the row still adds up to the seconds the
	 * denominator dropped. Discarding it instead would buy no legibility, because nothing it removes was
	 * ever visible, and would cost the total its identity with the tile: on `cleave` the two rows here sum
	 * to 84 419ms, which is `durationMs - flameShock.scoredMs` to the millisecond, and a 100ms floor would
	 * make that 84 319 against a denominator that dropped 84 419. `DebuffTimeline` and `CastTimeline` both
	 * had a floor and both lost it for this reason.
	 */
	const rows = useMemo(
		(): Track[] => [
			{ label: t('flameShock.track.up'), tone: 'kick', windows: up, lengthLabel: 'held for' },
			...(elsewhere.length > 0
				? [
						{
							label: t('flameShock.track.elsewhere'),
							tone: 'missSoft',
							windows: elsewhere,
							lengthLabel: 'up elsewhere for',
							widen: false,
						} satisfies Track,
					]
				: []),
			{
				label: t('flameShock.track.dropped'),
				tone: 'miss',
				windows: dropped,
				lengthLabel: 'without it for',
				widen: false,
			},
			...(uncounted.length > 0
				? [
						{
							label: t('flameShock.track.uncounted'),
							tone: EXEMPT,
							windows: uncounted,
							lengthLabel: 'up but unmeasured for',
							widen: false,
						} satisfies Track,
					]
				: []),
			...exempt.map((row): Track => ({
				label: row.label,
				tone: EXEMPT,
				windows: row.windows,
				lengthLabel: 'for',
				widen: false,
			})),
		],
		[t, up, elsewhere, uncounted, dropped, exempt],
	);

	// `uncounted` is in the guard because the up row is clipped now: a pull whose every dot window fell
	// outside the graded clock has an empty green row and an empty red one, and printing "Flame Shock was
	// never pressed in this pull" over it would be false about a pull that pressed it throughout.
	// `elsewhere` is in it for the same reason one step in: green is the numerator now, so a pull whose dot
	// was up inside the clock but never on the enemy being hit has an empty green row and a full one here.
	if (up.length === 0 && elsewhere.length === 0 && dropped.length === 0 && uncounted.length === 0) {
		return <ChartEmpty>{t('flameShock.none')}</ChartEmpty>;
	}

	return (
		<ChartFigure
			gap="wide"
			caption={
				<>
					<ChartKey tone="kick">{t('flameShock.track.up')}</ChartKey>
					{elsewhere.length > 0 ? <ChartKey tone="missSoft">{t('flameShock.track.elsewhere')}</ChartKey> : null}
					<ChartKey tone="miss">{t('flameShock.track.dropped')}</ChartKey>
					{uncounted.length > 0 ? <ChartKey tone={EXEMPT}>{t('flameShock.track.uncounted')}</ChartKey> : null}
					{exempt.map((row) => (
						<ChartKey key={row.label} tone={EXEMPT}>
							{row.label}
						</ChartKey>
					))}
				</>
			}
		>
			<WindowTracks
				tracks={rows}
				chartId="ele-flame-shock-uptime"
				durationMs={analysis.durationMs}
				label={t('flameShock.chart.uptimeLabel')}
			/>
		</ChartFigure>
	);
}
