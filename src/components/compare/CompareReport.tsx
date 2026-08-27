import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { compare, type Comparison, type Pull } from '~/lib/compare';
import { formatDecimal, formatInteger, formatPercentValue } from '~/lib/format';
import i18n from '~/lib/i18n/config';

import { Note, Prose, Section, StatTile, StatTiles } from '../primitives';

import ComparabilityNotes from './ComparabilityNotes';
import MetricRow from './MetricRow';
import PullHeader from './PullHeader';
import { pullLabels } from './pullLabels';
import RateGaps, { type RateRow } from './RateGaps';
import SectionGaps from './SectionGaps';
import { sectionAnchor } from './sectionAnchor';

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

function castRows(comparison: Comparison): { rows: RateRow[]; max: number } {
	const rows = comparison.casts
		.filter((row) => row.id !== AUTO_ATTACK_ID)
		.map((row) => ({
			id: row.id,
			name: row.name,
			a: row.a?.cpm ?? null,
			b: row.b?.cpm ?? null,
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
	const comparison = useMemo(() => compare(a, b), [a, b]);
	const damage = useMemo(() => damageRows(comparison), [comparison]);
	const casts = useMemo(() => castRows(comparison), [comparison]);

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

			<Section id="compare-metrics" title={t('compare.metrics.title')}>
				<Prose>{t('compare.metrics.intent')}</Prose>
				<div className="mt-5 flex flex-col gap-7">
					{comparison.sections.map((group) => {
						// Held in a variable spelled `section`, which is the same shape `Scorecard` uses to
						// title a card and is skipped by the key guard for the declared reason: the prefix is
						// a section name arriving at runtime rather than a family of keys to enumerate.
						const section = group.key;
						return (
							<div key={section} className="flex flex-col gap-1">
								<h3 id={sectionAnchor(section)} className="m-0 scroll-mt-14 font-mono text-base font-semibold text-ink">
									{i18n.exists(`${section}.title`) ? t(`${section}.title`) : section}
								</h3>
								<ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
									{group.metrics.map((gap) => (
										<MetricRow key={gap.key} gap={gap} players={players} />
									))}
								</ul>
							</div>
						);
					})}
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
