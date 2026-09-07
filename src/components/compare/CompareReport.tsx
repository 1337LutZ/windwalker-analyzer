import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { compare, identityFrom, type Comparison, type Pull } from '~/lib/compare';
import { byCastOrder } from '~/lib/view/castOrder';

/** What a cast list needs to be ordered: the spec's declared leaders, and the table the tiers read. */
type CastOrdering = Parameters<typeof byCastOrder>[1];
import { formatDecimal, formatInteger, formatPercentValue } from '~/lib/format';

import { Note, Prose, Section, StatTile, StatTiles } from '../primitives';
import SectionNav, { type ReportSection } from '../report/SectionNav';
import { useSpec } from '../report/specContext';

import ComparabilityNotes from './ComparabilityNotes';
import DpsOverlay from './DpsOverlay';
import { rollingDps, type DpsSeries } from '../charts/dpsCurve';
import { segmentSpans } from '../sections/SegmentStrip';
import PullHeader from './PullHeader';
import TalentGaps from './TalentGaps';
import { pullLabels } from './pullLabels';
import RateGaps, { ABSENCE, type RateRow } from './RateGaps';
import SectionGaps from './SectionGaps';

/**
 * Damage rows worth drawing: the buttons, ranked by how far apart the two pulls are.
 *
 * Passives and utility damage are held back the way `DamageByAbility` holds them back, and for its
 * reason: neither is produced by a damage decision, so a difference in one is a difference in gear or
 * in movement rather than in how the rotation was played.
 */
function damageRows(
	comparison: Comparison,
	keyOf: (id: number) => string | null,
	spec: CastOrdering,
): { rows: RateRow[]; max: number } {
	const rows = comparison.abilities
		.filter((ability) => !ability.passive && !ability.utility)
		.map((ability) => ({
			id: ability.id,
			name: ability.name,
			a: ability.a?.share ?? null,
			b: ability.b?.share ?? null,
			absent: ABSENCE[ability.absent?.why ?? 'notPressed'],
		}))
		// The same order the cast list below it uses, and the same the report's own damage chart uses.
		// A reader moving between the three should not have to find each button three times.
		.sort(byCastOrder((row) => keyOf(row.id), spec));
	const max = Math.max(0, ...rows.flatMap((row) => [row.a ?? 0, row.b ?? 0]));
	return { rows, max };
}

/**
 * Press rates worth drawing.
 *
 * Melee is dropped, and it is the only exclusion. It is not a button anybody presses — its rate is the
 * swing timer and the haste on it — so a row for it would be the largest number in the list and would
 * say nothing about a decision either player made.
 */
const AUTO_ATTACK_ID = 1;

function castRows(
	comparison: Comparison,
	keyOf: (id: number) => string | null,
	spec: CastOrdering,
): { rows: RateRow[]; max: number } {
	const rows = comparison.casts
		.filter((row) => row.id !== AUTO_ATTACK_ID)
		.map((row) => ({
			id: row.id,
			name: row.name,
			a: row.a?.cpm ?? null,
			b: row.b?.cpm ?? null,
			absent: ABSENCE[row.absent?.why ?? 'notPressed'],
		}))
		// The rotation's own shape, the same order the report's own cast table uses. Sorting this list
		// by the size of the gap put the racials and the flasks wherever the two logs happened to differ
		// most, which is the middle of the rotation.
		.sort(byCastOrder((row) => keyOf(row.id), spec));
	const max = Math.max(0, ...rows.flatMap((row) => [row.a ?? 0, row.b ?? 0]));
	return { rows, max };
}

/**
 * The contents list, in the order the page argues.
 *
 * A fixed array rather than the report's derived one, because this page has fixed sections: every
 * comparison draws all five, and a block with nothing in it says so in a `Note` rather than declining
 * to render. So there is no `when` to filter on and no way for a link here to point at a heading that
 * is not there: the guard the report's `useMemo` exists to provide is structural here.
 *
 * **Every entry takes `group: null`**, which lists them flat above the groups. The report groups
 * because it runs to a dozen-odd sections; five is a list a reader takes in at a glance, and a
 * disclosure over it would be a control whose two positions are "five links" and "a heading".
 *
 * The ids are the `Section id` each block below is rendered with and the keys are the titles those
 * blocks are given, so the nav and the heading cannot come to disagree about either.
 */
const NAV: readonly ReportSection[] = [
	{ id: 'compare-framing', titleKey: 'compare.title', group: null },
	{ id: 'compare-dps', titleKey: 'compare.dps.title', group: null },
	{ id: 'compare-gaps', titleKey: 'compare.gaps.title', group: null },
	{ id: 'compare-damage', titleKey: 'compare.damage.title', group: null },
	{ id: 'compare-procs', titleKey: 'compare.procs.title', group: null },
	{ id: 'compare-casts', titleKey: 'compare.casts.title', group: null },
];

/**
 * The proc rows, and the one absence key they need.
 *
 * A single reason rather than `ABSENCE`'s four, because there is only one thing an absent proc can
 * mean and the report cannot narrow it: a log with no row for a trinket either was not wearing it or
 * was wearing it and never rolled it. Separating those needs a map from item ids to the auras they
 * put up, and none is shipped. The gear list carries item ids and the auras carry spell ids; the note
 * under the block says so, and this string says only what is true.
 *
 * Quoted at the call for the reason `ABSENCE` is quoted in `RateGaps`: `i18n/__tests__/keys.test.ts`
 * finds a key by reading the source for quoted key paths, and a key reached through a variable is a
 * key it reports as copy nothing asks for.
 */
function procRows(comparison: Comparison): { rows: RateRow[]; max: number } {
	const rows = comparison.procs.map((proc) => ({
		id: proc.id,
		name: proc.name,
		a: proc.a,
		b: proc.b,
		absent: 'compare.procs.absent',
	}));
	const max = Math.max(0, ...rows.flatMap((row) => [row.a ?? 0, row.b ?? 0]));
	return { rows, max };
}

/**
 * Two pulls, differenced and drawn.
 *
 * **Read top down, the page answers three questions in order**: what were these two pulls and what
 * makes them hard to compare, which part of the rotation they differ on, and by how much on each rule.
 * The ranked chart is the index into the third; the sections below it keep the report's own editorial
 * order, because that is the order a reader who came for one of them expects to find it in.
 *
 * **What is deliberately not here: the timelines, the cast log, the lanes and the miss ledger.** Two
 * pulls of different length share no clock, so an elementwise comparison of a bank timeline or a run
 * of cast marks would be a picture of nothing at all. For those the honest answer is still two tabs,
 * and the page says so rather than drawing something that looks like an answer.
 */
export default function CompareReport({ a, b }: { a: Pull; b: Pull }) {
	const { t } = useTranslation('report');
	// The spec's own ability table, which is what says two spell ids are one button.
	const spec = useSpec();
	const comparison = useMemo(() => compare(a, b, identityFrom(spec.registry)), [a, b, spec]);
	const identity = useMemo(() => identityFrom(spec.registry), [spec]);
	const damage = useMemo(() => damageRows(comparison, identity.damage, spec), [comparison, identity, spec]);
	const casts = useMemo(() => castRows(comparison, identity.cast, spec), [comparison, identity, spec]);
	const procs = useMemo(() => procRows(comparison), [comparison]);
	// The curve is built here rather than inside the chart so a pull captured before the series existed
	// resolves to null once, and the chart's empty state is reached rather than an empty plot.
	const series = (pull: Pull): DpsSeries | null => {
		const perSecond = pull.analysis.damage.perSecond;
		return perSecond === undefined || perSecond.length === 0 ? null : rollingDps(perSecond, pull.analysis.durationMs);
	};
	const dps = useMemo(() => ({ a: series(a), b: series(b) }), [a, b]);
	const segsA = useMemo(() => segmentSpans(a.analysis.segments?.segments, t), [a, t]);
	const segsB = useMemo(() => segmentSpans(b.analysis.segments?.segments, t), [b, t]);

	// Not the bare names: two anonymous reports can both hold a `Player (10)`. See `pullLabels`.
	const players = pullLabels(comparison.a, comparison.b);
	const { tally } = comparison;

	return (
		// The report page's own two-column shell, verbatim, so the rail sits where a reader who has
		// come from a report or from the segment tool already expects it. Below `lg` the grid does not
		// apply and `SectionNav` renders nothing at all, so a phone gets the page it had.
		<div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8">
			<SectionNav sections={NAV} />
			<div className="flex flex-col gap-10 md:gap-12">
				<Section id="compare-framing" title={t('compare.title')}>
					<Prose>{t('compare.intent')}</Prose>
					<div className="mt-5 flex flex-col gap-5">
						<PullHeader comparison={comparison} />
						<ComparabilityNotes notes={comparison.notes} />
						{/* Four buckets that add up to every metric offered. The last is its own figure and is never
					    folded into the third: two pulls neither of which could answer a question have not tied
					    on it, and a summary that says they did is the one claim this page must not make. */}
						<StatTiles>
							<StatTile value={formatInteger(tally.a)} label={t('compare.tally.ahead', { player: players.a })} />
							<StatTile value={formatInteger(tally.b)} label={t('compare.tally.ahead', { player: players.b })} />
							<StatTile value={formatInteger(tally.level)} label={t('compare.tally.level')} />
							<StatTile value={formatInteger(tally.incomparable)} label={t('compare.tally.notComparable')} />
						</StatTiles>
						{/* After the tally rather than before it. The tally is the headline — how many figures each
					    of you leads — and the talents are what a reader turns to next to explain it: a build that
					    took Invoke Xuen is behind on Rushing Jade Wind by choice, not by play. */}
						<TalentGaps gap={comparison.talents} players={players} />
					</div>
				</Section>

				{/* Between the framing and the ranked gaps, which is where a reader meets it: they have just read
			    two DPS numbers and have not yet been told which part of the rotation differs. The curve is the
			    shape behind those two numbers, and the segment lanes under it are why it has the shape it has
			    A trough is usually a phase that took the boss away rather than a player who stopped. */}
				<Section id="compare-dps" title={t('compare.dps.title')}>
					<Prose>{t('compare.dps.intent')}</Prose>
					<div className="mt-5">
						<DpsOverlay
							a={{ series: dps.a, spans: segsA, name: players.a }}
							b={{ series: dps.b, spans: segsB, name: players.b }}
						/>
					</div>
				</Section>

				<Section id="compare-gaps" title={t('compare.gaps.title')}>
					<Prose>{t('compare.gaps.intent')}</Prose>
					<div className="mt-5">
						<SectionGaps sections={comparison.sections} players={players} />
					</div>
				</Section>

				<Section id="compare-damage" title={t('compare.damage.title')}>
					<Prose>{t('compare.damage.intent')}</Prose>
					<div className="mt-5">
						{damage.rows.length === 0 ? (
							<Note>{t('compare.damage.none')}</Note>
						) : (
							<RateGaps rows={damage.rows} max={damage.max} format={formatPercentValue} players={players} />
						)}
					</div>
				</Section>

				{/* After the damage block and before the presses, which is where a reader meets the question.
			    They have just seen one player ahead on a damage row, and the next thing worth knowing is how
			    much of that the gear handed over, before they go looking through the rotation for a mistake
			    that may not be there. Drawn in the same shape as the two lists around it, and deliberately
			    absent from the tally above them: see `ProcGap`. */}
				<Section id="compare-procs" title={t('compare.procs.title')}>
					<Prose>{t('compare.procs.intent')}</Prose>
					<div className="mt-5">
						{procs.rows.length === 0 ? (
							<Note>{t('compare.procs.none')}</Note>
						) : (
							// The unit rides on every reading: a bare `2.1` is the number a reader takes for a
							// proc count, and a trinket does not fire 2.1 times.
							<RateGaps
								rows={procs.rows}
								max={procs.max}
								format={(value) => t('compare.procs.perMinute', { value: formatDecimal(value) })}
								players={players}
							/>
						)}
					</div>
					{procs.rows.length === 0 ? null : (
						<div className="mt-5">
							<Note>{t('compare.procs.caveat')}</Note>
						</div>
					)}
				</Section>

				<Section id="compare-casts" title={t('compare.casts.title')}>
					<Prose>{t('compare.casts.intent')}</Prose>
					<div className="mt-5">
						{casts.rows.length === 0 ? (
							<Note>{t('compare.casts.none')}</Note>
						) : (
							<RateGaps rows={casts.rows} max={casts.max} format={formatDecimal} players={players} />
						)}
					</div>
				</Section>

				<Note>{t('compare.elsewhere')}</Note>
			</div>
		</div>
	);
}
