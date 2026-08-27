import { useTranslation } from 'react-i18next';

import type { Comparison, PullFraming, Side } from '~/lib/compare';
import { formatCompact, formatDecimal, formatHumanDuration, formatPercentValue } from '~/lib/format';

import { DataGrid, type GridRow } from '../primitives';

import PullKey from './PullKey';
import { pullLabels } from './pullLabels';

/** The three headline figures, and how a difference between two of them is honestly written. */
type Shape = 'relative' | 'points' | 'count';

/**
 * A difference between two percentages is in **points**, and never in per cent.
 *
 * 82.6% against 78.1% is four and a half points, not "5.8% better", and the two readings differ by
 * enough to matter. Percentages get points, an open-ended rate gets its own unit, and damage gets a
 * relative figure because that is the only one of the three a reader already thinks about in per cent.
 */
function difference(shape: Shape, a: number, b: number): { by: number; leader: Side | null; text: string } {
	const leader = a === b ? null : a > b ? 'a' : 'b';
	if (shape === 'relative') {
		const smaller = Math.min(a, b);
		const by = smaller > 0 ? (Math.abs(a - b) / smaller) * 100 : 0;
		return { by, leader, text: formatPercentValue(by) };
	}
	const by = Math.abs(a - b);
	return { by, leader, text: shape === 'points' ? `${formatDecimal(by)}pp` : formatDecimal(by) };
}

/**
 * What the two pulls were, before anything is said about how they were played.
 *
 * **Every axis the reader has to hold in their head while reading the rest of the page.** Two pulls of
 * different bosses, different lengths or different gear are still worth comparing, and the report
 * declines to hide that they differ rather than declining to compare them. The notes beneath name each
 * difference; this names the pulls.
 *
 * The three figures below are the ones that mean the same thing whatever the encounter was, which is
 * why they are here and not in a scored section: none of them is graded, and none of them belongs to
 * one spec.
 */
export default function PullHeader({ comparison }: { comparison: Comparison }) {
	const { t } = useTranslation('report');
	const { a, b } = comparison;
	const named = pullLabels(a, b);

	const line = (side: Side, pull: PullFraming) => (
		<li className="flex flex-col gap-1">
			<PullKey side={side}>
				<span className="font-mono text-base font-semibold text-ink">{side === 'a' ? named.a : named.b}</span>
			</PullKey>
			<span className="text-sm text-muted">
				{pull.encounter}
				{pull.difficultyName === null ? '' : ` · ${pull.difficultyName}`} · {formatHumanDuration(pull.durationMs)}
				{pull.itemLevel === null ? '' : ` · ${t('compare.pull.itemLevel', { level: pull.itemLevel })}`}
				{pull.rankPercent === null || pull.rankPercent === undefined
					? ''
					: ` · ${t('compare.pull.parse', { value: pull.rankPercent })}`}
			</span>
		</li>
	);

	const figure = (
		key: string,
		label: string,
		shape: Shape,
		left: number,
		right: number,
		text: (v: number) => string,
	) => {
		const gap = difference(shape, left, right);
		return {
			key,
			cells: {
				figure: label,
				a: text(left),
				b: text(right),
				difference:
					gap.leader === null ? (
						<span className="text-muted">{t('compare.diff.level')}</span>
					) : (
						<PullKey side={gap.leader}>
							<span className="tabular font-mono">{gap.text}</span>
						</PullKey>
					),
			},
		} satisfies GridRow;
	};

	const rows: GridRow[] = [
		figure('dps', t('kpi.dps'), 'relative', a.dps, b.dps, formatCompact),
		figure('cpm', t('kpi.cpm'), 'count', a.cpm, b.cpm, formatDecimal),
		figure('gcd', t('kpi.gcd'), 'points', a.gcdUtilisationPct, b.gcdUtilisationPct, formatPercentValue),
	];

	return (
		<div className="flex flex-col gap-5">
			<ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2">
				{line('a', a)}
				{line('b', b)}
			</ul>
			<DataGrid
				caption={t('compare.framing.caption')}
				columns={[
					{ key: 'figure', label: t('compare.column.figure') },
					{ key: 'a', label: named.a, align: 'right' },
					{ key: 'b', label: named.b, align: 'right' },
					{ key: 'difference', label: t('compare.column.difference'), align: 'right' },
				]}
				rows={rows}
			/>
		</div>
	);
}
