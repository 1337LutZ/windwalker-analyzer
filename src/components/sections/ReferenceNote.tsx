import { useMemo } from 'react';
import { Dialog } from '@base-ui/react/dialog';

import { useReportCopy } from '~/hooks/useReportCopy';
import type { Analysis } from '~/lib/types';
import { referenceFor, referenceTable, rowsFor } from '~/lib/reference/table';

import { useSpec } from '~/components/report/specContext';

import { DialogShell, Note } from '../primitives';

/**
 * What the grading lines were measured against, and when.
 *
 * **A grade drawn from a distribution has to say whose distribution.** The lines this report grades
 * global-fill against are no longer two numbers somebody chose — they are read off real kills, per
 * encounter, because the encounter explains far more of that figure than the player does. A reader
 * who is told "78.4%, ok" and nothing else cannot tell a fair line from an arbitrary one, and the
 * whole reason this dataset exists is that the arbitrary ones were unfair in a way nobody could see.
 *
 * So the Method section carries the provenance: how many kills, how many encounters, and **the day the
 * sweep ran**. The last of those is the one that rots — a reference built against one raid's metagame
 * is a different claim a year later — so it is printed rather than implied.
 *
 * **Generic by construction.** Nothing here names a spec: the table is keyed by the registry's own spec
 * key and the copy is one string with a `count` for the plural. A spec registered next year gets this
 * block the day its first sweep lands, and shows the "not yet measured" line until then — which is the
 * honest state rather than an empty chart.
 */
export default function ReferenceNote({ analysis }: { analysis: Analysis }) {
	const { t } = useReportCopy(analysis);
	const spec = useSpec();

	const rows = useMemo(() => rowsFor(spec.key), [spec.key]);
	const mine = referenceFor(spec.key);
	const table = referenceTable();

	// No sweep has covered this spec yet. Said plainly rather than drawn as an empty chart, because a
	// chart of nothing invites a reader to conclude the fights are all identical.
	if (mine === null || rows.length === 0) return <Note>{t('method.reference.none')}</Note>;

	const spread = rows.reduce(
		(acc, { cell }) => ({ lowest: Math.min(acc.lowest, cell.p50), highest: Math.max(acc.highest, cell.p50) }),
		{ lowest: Infinity, highest: -Infinity },
	);
	const thinnest = rows.reduce((worst, row) => (row.cell.n < worst.cell.n ? row : worst), rows[0]!);

	return (
		<Note>
			{t('method.reference.summary', {
				pulls: mine.sourcePulls,
				encounters: rows.length,
				count: rows.length,
				builtAt: table.builtAt ?? '—',
				lowest: spread.lowest,
				highest: spread.highest,
				swing: spread.highest - spread.lowest,
			})}{' '}
			<DialogShell
				trigger={
					<Dialog.Trigger className="cursor-pointer border-0 bg-transparent p-0 font-inherit text-accent underline decoration-dotted underline-offset-2">
						{t('method.reference.open')}
					</Dialog.Trigger>
				}
				title={t('method.reference.dialogTitle')}
				description={t('method.reference.dialogIntent', {
					pulls: mine.sourcePulls,
					builtAt: table.builtAt ?? '—',
					thinnest: thinnest.cell.n,
				})}
			>
				<ReferenceChart rows={rows} />
			</DialogShell>
		</Note>
	);
}

/**
 * Every encounter's reference, as a range from its median to its ninetieth percentile.
 *
 * Positioned `div`s rather than the app's chart library, and rather than SVG. Fourteen static rows on
 * one shared percentage axis is exactly what a flex row and a `left`/`width` pair already express, and
 * the percentages need no scale conversion because the axis *is* percent. A charting runtime inside a
 * dialog would be a great deal of machinery for a picture that never changes and never animates.
 *
 * **The two marks are the two lines.** `p50` is where `ok` sits and `p90` is where `good` does, so the
 * bar between them is literally the middle grade's width on that fight — which is the thing a reader
 * opening this dialog wants to see. A fight where the bar is narrow is one where the grade is decided
 * by very little.
 */
function ReferenceChart({ rows }: { rows: ReturnType<typeof rowsFor> }) {
	const lo = 50;
	const hi = 100;
	const x = (value: number) => ((value - lo) / (hi - lo)) * 100;

	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex justify-between font-mono text-[10px] text-muted">
				{[50, 60, 70, 80, 90, 100].map((tick) => (
					<span key={tick}>{tick}%</span>
				))}
			</div>
			{rows.map(({ encounterID, cell }) => (
				<div key={encounterID} className="flex items-center gap-2">
					<span className="w-[38%] shrink-0 truncate text-xs text-ink-2" title={cell.name}>
						{cell.name}
					</span>
					<div className="relative h-[10px] grow rounded-sm bg-track" aria-hidden="true">
						<div
							className="absolute h-[10px] rounded-sm bg-kick/70"
							style={{ left: `${x(cell.p50)}%`, width: `${Math.max(x(cell.p90) - x(cell.p50), 1.5)}%` }}
						/>
					</div>
					<span className="w-[92px] shrink-0 text-right font-mono text-[11px] tabular-nums text-ink-2">
						{cell.p50.toFixed(1)}–{cell.p90.toFixed(1)}
					</span>
					<span className="w-[34px] shrink-0 text-right font-mono text-[10px] tabular-nums text-muted">n{cell.n}</span>
				</div>
			))}
		</div>
	);
}
