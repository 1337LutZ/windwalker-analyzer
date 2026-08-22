import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatClock, formatSeconds } from '~/lib/format';
import type { Analysis, ElementalAuditResult } from '~/lib/types';

import { DataGrid, Note, Prose, Section, SpellIcon, StatTile, StatTiles, type GridRow } from '~/components/primitives';

/**
 * Ascendance, on its own, and shown on every pull because it is on every bar.
 *
 * **Not a talent.** It is absent from the sim's shaman talent tree
 * (`ui/core/talents/trees/shaman.json`, eighteen entries and none of them 114049) and registered
 * unconditionally in `sim/shaman/shaman.go:245` — `shaman.registerAscendanceSpell()` inside
 * `Initialize()`, with no talent check. So this section takes no gate: a shaman who never pressed it
 * had it available, and the empty table is a finding rather than a maybe. Getting that backwards
 * would hide the pull's biggest cooldown behind a talent nobody has to take.
 *
 * It used to share one heading with Elemental Mastery and the held-cooldown ledger, which put a table
 * for a talent the player had not taken directly under this one — see `ElementalMastery`.
 */
export default function Ascendance({ analysis }: { analysis: Analysis }) {
	const el = analysis as Analysis & ElementalAuditResult;
	const { ascendance } = el;
	const { t } = useReportCopy(analysis);

	/**
	 * How one press read, which is a different question from what it was.
	 *
	 * Three outcomes and they are not a scale: a fault names the demand the press failed, a refusal names
	 * what the log could not tell, and neither is "slightly worse than well placed". `fault` and
	 * `sync.reason` are both published by the audit — the decomposition of `grade: 'bad'` into a named
	 * fault lives in `elemental/lib/index.ts`, deliberately not here, so this component holds no rule and
	 * cannot drift from the one that graded the press.
	 *
	 * The numbers go into the sentences rather than into columns of their own. "Threw away 14.3s" is the
	 * whole of what rule 2 has to say, and a `wasted` column would be empty on every press that did not.
	 */
	const rows = useMemo<GridRow[]>(() => {
		const readOf = (press: (typeof ascendance.presses)[number]): string => {
			if (press.fault !== null)
				return t(`ascendance.read.fault.${press.fault}`, {
					wasted: press.sync.wastedMs ?? 0,
					discharge: press.sync.dischargeRemainingMs ?? 0,
				});
			if (press.sync.reason !== null) return t(`ascendance.read.reason.${press.sync.reason}`);
			return t('ascendance.read.good');
		};
		return [...ascendance.presses]
			.sort((a, b) => a.t - b.t)
			.map((press, i) => ({
				key: `${press.t}-${i}`,
				cells: {
					at: formatClock(press.t),
					dotLeft: press.fsRemainingMs === null ? '—' : formatSeconds(press.fsRemainingMs),
					state: press.opener
						? t('ascendance.state.opener')
						: press.twoPiece
							? t('ascendance.state.twoPiece')
							: t('ascendance.state.plain'),
					read: readOf(press),
				},
			}));
	}, [ascendance.presses, t]);

	/**
	 * Rule 4 (§80.4) — **shown, never a fault**, which is why it is a note under the table and not a cell
	 * in the verdict column.
	 *
	 * The user hedged this one: "the 2nd Ascendance should *ideally* be synced with the 2nd Skull Banner",
	 * against rule 3's "should have *at least*". `secondBannerSynced` enters no grade expression in
	 * `ascendanceSync` and a test there asserts a `false` leaves the press `good`, so drawing it beside
	 * the faults would contradict the module. Null on every press but the second, and on a second press
	 * with no warrior's second banner to compare against — both are "nothing to say" and draw nothing.
	 */
	const secondBannerSynced = ascendance.presses.find((p) => p.sync.secondBannerSynced !== null)?.sync
		.secondBannerSynced;

	return (
		<Section id="ascendance" title={t('ascendance.title')}>
			<Prose>
				<span className="inline-flex items-center gap-2 align-middle">
					<SpellIcon id={114049} size="sm" />
				</span>{' '}
				{t('ascendance.intent')}
			</Prose>

			<div className="mt-4.5">
				<StatTiles>
					<StatTile value={`${ascendance.presses.length}`} label={t('ascendance.kpi.presses')} />
				</StatTiles>
			</div>

			<div className="mt-5">
				<DataGrid
					caption={t('ascendance.caption')}
					columns={[
						{ key: 'at', label: t('ascendance.columns.at'), width: '96px' },
						{ key: 'dotLeft', label: t('ascendance.columns.dotLeft'), align: 'right', width: '110px' },
						{ key: 'state', label: t('ascendance.columns.state') },
						{ key: 'read', label: t('ascendance.columns.read') },
					]}
					rows={rows}
					// Two different empty tables. A pull that never pressed Ascendance and was graded `bad`
					// for it has failed rule 1 — the opener press is not optional — and an empty table that
					// said only "never pressed" would be the one place that fault could appear, silently.
					// `none` keeps the neutral sentence for a pull the rules refused to judge at all.
					empty={ascendance.grade === 'bad' ? t('ascendance.noneMissed') : t('ascendance.none')}
				/>
			</div>
			{secondBannerSynced !== undefined && (
				<div className="mt-5">
					<Note>
						{t(secondBannerSynced ? 'ascendance.read.secondBanner.synced' : 'ascendance.read.secondBanner.missed')}
					</Note>
				</div>
			)}
		</Section>
	);
}
