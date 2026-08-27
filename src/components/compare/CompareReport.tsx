import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { compare, identityFrom, type Comparison, type Pull } from '~/lib/compare';
import { byCastOrder } from '~/lib/view/castOrder';
import { formatDecimal, formatInteger, formatPercentValue } from '~/lib/format';

import { Note, Prose, Section, StatTile, StatTiles } from '../primitives';
import { useSpec } from '../report/specContext';

import ComparabilityNotes from './ComparabilityNotes';
import PullHeader from './PullHeader';
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
function damageRows(comparison: Comparison): { rows: RateRow[]; max: number } {
	const rows = comparison.abilities
		.filter((ability) => !ability.passive && !ability.utility)
		.map((ability) => ({
			id: ability.id,
			name: ability.name,
			a: ability.a?.share ?? null,
			b: ability.b?.share ?? null,
			absent: ABSENCE[ability.absent?.why ?? 'notPressed'],
		}));
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
	order: readonly string[],
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
		.sort(byCastOrder((row) => keyOf(row.id), order));
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
	const damage = useMemo(() => damageRows(comparison), [comparison]);
	const identity = useMemo(() => identityFrom(spec.registry), [spec]);
	const casts = useMemo(() => castRows(comparison, identity.cast, spec.castOrder), [comparison, identity, spec]);

	// Not the bare names: two anonymous reports can both hold a `Player (10)`. See `pullLabels`.
	const players = pullLabels(comparison.a, comparison.b);
	const { tally } = comparison;

	return (
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
	);
}
