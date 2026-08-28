import { useMemo } from 'react';
import { Dialog } from '@base-ui/react/dialog';

import { useReportCopy } from '~/hooks/useReportCopy';
import type { Analysis } from '~/lib/types';
import { referenceFor, referenceTable, rowsFor } from '~/lib/reference/table';

import { useSpec } from '~/components/report/specContext';

import { DataGrid, DialogShell, Note } from '../primitives';
import type { GridColumn, GridRow } from '../primitives';
import { secondaryButtonClass } from '../primitives/controls';

/**
 * What the grading lines were measured against, and how firmly.
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
 * ***And now how firm each figure is.*** An encounter's `good` is the ninetieth percentile of a few
 * dozen kills, which looks exact and is not: on present sample sizes it would move two to five points on
 * a different draw of the same ladder. A reader comparing their own figure against it — or one encounter
 * against another — deserves that before concluding anything from a one-point difference. It is computed
 * where the evidence lives and shipped with the table; `scripts/bootstrap.mjs` says why it is not
 * recomputed in the browser.
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

	// The typical give-or-take across this spec's encounters. Median rather than mean, so one very thin
	// encounter does not describe the rest.
	const widths = rows.map(({ cell }) => cell.ci).filter((ci): ci is number => typeof ci === 'number');
	const typical = widths.length === 0 ? null : [...widths].sort((a, b) => a - b)[Math.floor(widths.length / 2)]!;

	// `secondaryButtonClass`, the same one "Open in Warcraft Logs" wears. Two buttons a reader meets in one
	// report should not be two different inventions, and the first draft of this was a third.
	//
	// It is a sibling of the note rather than a child of it: `Note` is a paragraph, so a button inside it
	// can only ever be inline — which is how this first read, wrapping into the middle of the last
	// sentence — and a block-level wrapper inside a `<p>` is invalid markup rather than a fix.
	return (
		<>
			<Note>
				{t('method.reference.summary', {
					pulls: mine.sourcePulls,
					encounters: rows.length,
					count: rows.length,
					builtAt: table.builtAt ?? '—',
					lowest: spread.lowest,
					highest: spread.highest,
					swing: spread.highest - spread.lowest,
				})}
			</Note>
			<DialogShell
				width="table"
				// `self-start` because the Method section is a flex column, whose default `stretch` pulls an
				// `inline-flex` child the full width of the page — which is not what the same class does in
				// `ReportHeader`, where the parent is an ordinary block.
				trigger={
					<Dialog.Trigger className={`${secondaryButtonClass} mt-3 self-start`}>
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
				{typical === null ? null : (
					<p className="mb-3 text-sm text-ink-2">{t('method.reference.firmness', { typical })}</p>
				)}
				<ReferenceTable rows={rows} t={t} />
			</DialogShell>
		</>
	);
}

/**
 * Every encounter's reference, as a range from its median kill to its ninetieth percentile.
 *
 * **The two boundaries are the two lines.** `p50` is where `ok` begins and `p90` is where `good` does, so
 * the bar is the whole 50-to-100 axis painted by what each stretch of it would grade as — and the width of
 * the middle colour is how much room a fight leaves between the two. It uses the scorecard's own three
 * grade colours — see `GRADE_ZONE` for why at a heavier weight than the scorecard paints them.
 *
 * Positioned `div`s rather than the app's chart library, and rather than SVG. Fourteen static rows on one
 * shared percentage axis is exactly what a flex row and a `left`/`width` pair already express, and the
 * percentages need no scale conversion because the axis *is* percent. A charting runtime inside a dialog
 * would be a great deal of machinery for a picture that never changes and never animates.
 *
 * It sits in a `DataGrid` rather than hand-rolled rows so that it folds into cards on a narrow screen
 * like every other table in the report, and so the columns are announced rather than merely aligned.
 */
type Copy = ReturnType<typeof useReportCopy>['t'];

/**
 * The scorecard's three grade colours, at the weight this bar needs.
 *
 * `ZONE` in `score/bandScale` is the same three hues mixed 26% into the surface, and it is right there:
 * those zones sit *behind* a mark, so they have to stay recessive or they compete with the thing a reader
 * is meant to look at. Here the painted stretch is the content — there is no mark on top of it — and at
 * 26% the three read as one faint smear.
 *
 * Same tokens, so a reader who has learnt the colours upstairs reads these without being taught again.
 */
const GRADE_ZONE = {
	bad: 'bg-[color-mix(in_oklch,var(--color-miss)_62%,var(--color-surface))]',
	ok: 'bg-[color-mix(in_oklch,var(--color-brew)_62%,var(--color-surface))]',
	good: 'bg-[color-mix(in_oklch,var(--color-good)_62%,var(--color-surface))]',
};

function ReferenceTable({ rows, t }: { rows: ReturnType<typeof rowsFor>; t: Copy }) {
	const lo = 50;
	const hi = 100;
	const x = (value: number) => ((value - lo) / (hi - lo)) * 100;

	const columns: GridColumn[] = [
		{ key: 'name', label: t('method.reference.colEncounter') },
		{ key: 'range', label: t('method.reference.colRange'), hideLabel: true, width: '30%' },
		{ key: 'ok', label: t('method.reference.colOk'), align: 'right' },
		{ key: 'good', label: t('method.reference.colGood'), align: 'right' },
		{ key: 'ci', label: t('method.reference.colGiveOrTake'), align: 'right' },
		{ key: 'n', label: t('method.reference.colKills'), align: 'right' },
	];

	const gridRows: GridRow[] = rows.map(({ encounterID, cell }) => ({
		key: String(encounterID),
		cells: {
			name: cell.name,
			range: (
				<div className="flex h-[10px] w-full overflow-hidden rounded-sm" aria-hidden="true">
					<div className={GRADE_ZONE.bad} style={{ width: `${x(cell.p50)}%` }} />
					<div className={GRADE_ZONE.ok} style={{ width: `${Math.max(x(cell.p90) - x(cell.p50), 1)}%` }} />
					<div className={GRADE_ZONE.good} style={{ width: `${Math.max(100 - x(cell.p90), 1)}%` }} />
				</div>
			),
			ok: cell.p50.toFixed(1),
			good: cell.p90.toFixed(1),
			// An em dash rather than a zero: a cell too thin to resample has no interval, and printing
			// nought would read as a figure known to be exact — the opposite of what it means.
			ci: typeof cell.ci === 'number' ? cell.ci.toFixed(1) : '—',
			n: String(cell.n),
		},
	}));

	// Below the shell's own width, so the grid never grows a scrollbar inside a dialog sized for it.
	return <DataGrid caption={t('method.reference.tableCaption')} columns={columns} rows={gridRows} minWidth="38rem" />;
}
