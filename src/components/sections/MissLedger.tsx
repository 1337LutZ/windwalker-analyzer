import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatClock } from '~/lib/format';
import type { Analysis, Miss } from '~/lib/types';

import { DataGrid, Prose, Section, type GridRow } from '../primitives';
import LogLink from './LogLink';

/**
 * Every mistake the analysis found, grouped by kind, each timestamp linking into the replay.
 *
 * Only the framing is copy. A row's `kind` and the `detail` behind its links are the analysis
 * engine's own words — they name the spell, the stat and the number that tripped the check — so
 * they are rendered exactly as it wrote them rather than routed through the locale.
 */
export default function MissLedger({ analysis }: { analysis: Analysis }) {
	const { t } = useReportCopy(analysis);

	// Grouped rather than one row per miss: 21 individual rows of long deep links is a wall, and the
	// question a reader actually has is "which mistake, and how often".
	const groups = useMemo(() => {
		const byKind = new Map<string, Miss[]>();
		// The clock before the grouping, so the run of links inside a row reads left to right as the
		// fight did. The engine already hands the ledger over sorted by `at`, and that is precisely why
		// it is sorted again here: the ledger is assembled by concatenating a dozen per-fault lists, and
		// a row of timestamps is the one cell on this page where losing that order is invisible until
		// somebody reads two of them side by side.
		for (const m of [...analysis.misses].sort((a, b) => a.at - b.at)) {
			const list = byKind.get(m.kind);
			if (list) list.push(m);
			else byKind.set(m.kind, [m]);
		}
		// Most often first, with ties broken by when each kind first happened. The rows are a ranking and
		// the timestamps inside them are not, and both halves are deliberate. Without the second clause
		// two kinds that cost the same number of rows would order on whatever sequence the map happened
		// to be filled in, which is a detail of the loop above rather than a fact about the pull.
		return [...byKind.entries()].sort((a, b) => b[1].length - a[1].length || (a[1][0]?.at ?? 0) - (b[1][0]?.at ?? 0));
	}, [analysis.misses]);

	const rows = useMemo<GridRow[]>(
		() =>
			groups.map(([kind, list]) => ({
				key: kind,
				cells: {
					kind,
					count: list.length,
					when: (
						<span className="flex flex-wrap">
							{list.map((m, i) => (
								<LogLink key={`${m.at}-${i}`} href={m.link} title={m.detail}>
									{formatClock(m.at)}
								</LogLink>
							))}
						</span>
					),
				},
			})),
		[groups],
	);

	return (
		<Section id="misses" title={t('misses.title')}>
			<div className="mb-5 flex flex-col gap-3.5">
				<Prose>{t('misses.intent')}</Prose>
				{/* Counted over misses rather than rows: the grid folds them by kind, and "9 things worth
				    looking at" must not shrink to "3" because they happen to share three labels. */}
				{analysis.misses.length > 0 ? <Prose>{t('misses.summary', { count: analysis.misses.length })}</Prose> : null}
			</div>
			<DataGrid
				caption={t('misses.caption')}
				minWidth="560px"
				columns={[
					{ key: 'kind', label: t('misses.columns.kind'), width: '210px' },
					{ key: 'count', label: t('misses.columns.count'), align: 'right', width: '48px' },
					{ key: 'when', label: t('misses.columns.when'), card: 'wide' },
				]}
				rows={rows}
				empty={t('misses.none')}
			/>
		</Section>
	);
}
