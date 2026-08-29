import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatClock } from '~/lib/format';
import type { Analysis, EarthElementalVerdict, ElementalAuditResult, JudgmentCause } from '~/lib/types';

import {
	CauseLegend,
	CauseTag,
	DataGrid,
	Note,
	Prose,
	Section,
	SpellIcon,
	StatTile,
	StatTiles,
	type GridRow,
} from '~/components/primitives';

/**
 * Earth Elemental, against the three branches its rule actually has.
 *
 * `Earth Elemental Rules` (p5, priority 21) is an **or of three**, and this section used to describe
 * the first one as though it were the whole rule. Branch A is the pull's last sixty-two seconds and is
 * the only one a log can read all the way to *true*. Branch B ends at `spellTimeToReady(114206 Skull
 * Banner)` — another player's cooldown, which no combat log carries — and branch C opens on Glyph of
 * Fire Elemental Totem, which an observed summon can refute but never confirm.
 *
 * So the table has three states rather than two, and the third one is the point: a press only B or C
 * could have justified reads **cannot say**, not "too early". A wrong fault costs a reader more than a
 * missing one, which is the same discipline the priority list runs on.
 */
/**
 * The copy key each verdict reads under, spelled out rather than derived.
 *
 * The verdicts carry the sim's own hyphenated names and the copy file is camel-cased, so one of the two
 * has to bend. A lookup that fails to compile when a verdict is added is the safer place for that than a
 * template string, which would silently ask for a key nobody wrote.
 */
const STATE_KEY: Record<EarthElementalVerdict, string> = {
	'near-end': 'nearEnd',
	'off-rule': 'offRule',
	unknown: 'unknown',
};

export default function EarthElemental({ analysis }: { analysis: Analysis }) {
	const el = analysis as Analysis & ElementalAuditResult;
	const { earthElemental } = el;
	const { t } = useReportCopy(analysis);

	const rows = useMemo<(GridRow & { cause: JudgmentCause })[]>(
		() =>
			[...earthElemental.presses]
				.sort((a, b) => a.t - b.t)
				.map((press, i) => ({
					key: `${press.t}-${i}`,
					// `unknown` is the log: the call this press might have been standing in for turns on a Skull
					// Banner cooldown the pull does not carry, so nothing here can be attributed either way. An
					// inferred pre-pull summon is the list's, since the list has no pre-pull play to break.
					cause: (press.verdict === 'unknown'
						? 'log'
						: press.verdict === 'off-rule' && !press.inferred
							? 'player'
							: 'rotation') as JudgmentCause,
					// Only a refuted press is marked. An `unknown` is not a fault and must not be coloured as
					// one, and an inferred pre-pull row is not graded at all — the list has no pre-pull play.
					band: press.verdict === 'off-rule' && !press.inferred ? ('warn' as const) : undefined,
					cells: {
						at: press.inferred ? t('earthElemental.inferred') : formatClock(press.t),
						state: (
							<span className="inline-flex items-baseline">
								<CauseTag
									cause={
										press.verdict === 'unknown'
											? 'log'
											: press.verdict === 'off-rule' && !press.inferred
												? 'player'
												: 'rotation'
									}
								/>
								<span>{t(`earthElemental.state.${STATE_KEY[press.verdict]}`)}</span>
							</span>
						),
					},
				})),
		[earthElemental.presses, t],
	);

	return (
		<Section id="earth-elemental" title={t('earthElemental.title')}>
			<Prose>
				<span className="inline-flex items-center gap-2 align-middle">
					<SpellIcon id={2062} size="sm" />
				</span>{' '}
				{t('earthElemental.intent')}
			</Prose>

			<div className="mt-4.5">
				<StatTiles>
					<StatTile value={`${earthElemental.presses.length}`} label={t('earthElemental.kpi.used')} />
					{/* The graded share, with its own denominator beside it — the `unknown` presses and any
					    inferred pre-pull use are in neither half, which is what `graded` is for. */}
					<StatTile
						value={`${earthElemental.good}`}
						suffix={`/${earthElemental.graded}`}
						label={t('earthElemental.kpi.nearEnd')}
					/>
					<StatTile
						value={`${earthElemental.presses.filter((p) => p.verdict === 'unknown').length}`}
						label={t('earthElemental.kpi.unknown')}
					/>
				</StatTiles>
			</div>

			<div className="mt-5">
				<DataGrid
					caption={t('earthElemental.caption')}
					columns={[
						{ key: 'at', label: t('earthElemental.columns.at'), width: '96px' },
						{ key: 'state', label: t('earthElemental.columns.state') },
					]}
					rows={rows}
					empty={t('earthElemental.none')}
				/>
			</div>

			<div className="mt-3.5">
				<CauseLegend causes={rows.map((row) => row.cause)} />
			</div>

			<div className="mt-5">
				<Note>{t('earthElemental.unreadable')}</Note>
			</div>
		</Section>
	);
}
