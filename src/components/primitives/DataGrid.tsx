import type { CSSProperties, ReactNode } from 'react';

export interface GridColumn {
	key: string;
	label: string;
	align?: 'left' | 'right';
	width?: string;
	/** Bar and link columns have no useful visible heading, but still need one announced. */
	hideLabel?: boolean;
	/**
	 * Give this column a row of its own once the grid folds into cards, for values too long to sit
	 * opposite a label — a verdict sentence, or a run of timestamp links.
	 */
	card?: 'wide';
}

export interface GridRow {
	key: string;
	/** Keyed by column key; the first column is the row's heading. */
	cells: Record<string, ReactNode>;
	/** Faint band grouping paired rows, or marking a faulted one. */
	band?: 'warn' | 'ok';
}

const BAND = { warn: 'bg-band-warn', ok: 'bg-band-ok' } as const;

const cellBase = 'border-t border-line py-2 align-middle';

/**
 * Padding on the row's outer edges, so a banded row is a band *behind* its content rather than a
 * block ending at it.
 *
 * The tint is painted per cell, and the cells carry only the gutter between columns — `pr-3` on the
 * heading, `pl-3` on the rest. That leaves nothing at either end of the row, so the colour began
 * flush against the first icon and stopped flush against the last value, which reads as a fill that
 * ran out of room rather than as a highlight.
 *
 * Applied to the header cells as well, and that is not decoration: the two are separate elements
 * lined up only by agreeing on their padding, so adding it to one alone shifts every column heading
 * out of line with the values beneath it.
 */
const EDGE_START = 'pl-3';
const EDGE_END = 'pr-3';

/**
 * The same rows twice: a real `<table>` from `md` up, stacked cards below it.
 *
 * Shrinking a six-column grid to 390px collides the labels, and a horizontal scroller hides half the
 * numbers behind a gesture nobody performs. Only one of the two is ever in the layout — the other is
 * `display: none`, so it is out of the accessibility tree too and nothing is announced twice.
 *
 * The breakpoint is CSS and not a media-query hook on purpose. This island is prerendered, so a
 * hook would serve markup with neither shape in it and swap one in after hydration, which is a
 * layout jump on every report and an empty page for anything that does not run scripts.
 *
 * There is no Base UI primitive under this one: a table is semantic markup, not a widget — no focus
 * to manage, no keyboard model to get wrong, and `<table>`/`<th scope>` already carry the ARIA.
 */
export default function DataGrid({
	caption,
	columns,
	rows,
	minWidth = '640px',
	empty,
}: {
	caption: string;
	columns: GridColumn[];
	rows: GridRow[];
	minWidth?: string;
	empty?: ReactNode;
}) {
	const head = columns[0];
	if (!head) return null;
	const rest = columns.slice(1);

	if (rows.length === 0) {
		return <p className="m-0 text-base text-muted">{empty ?? 'Nothing to show for this pull.'}</p>;
	}

	return (
		<>
			<ul aria-label={caption} className="m-0 flex list-none flex-col gap-2 p-0 md:hidden">
				{rows.map((row) => (
					<li key={row.key} className={`rounded-sm border border-line p-3 ${row.band ? BAND[row.band] : 'bg-surface'}`}>
						<div className="font-mono text-sm font-semibold text-ink">{row.cells[head.key]}</div>
						<div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2">
							{rest.map((column) =>
								column.hideLabel ? (
									<div key={column.key} className="col-span-2">
										{row.cells[column.key]}
									</div>
								) : column.card === 'wide' ? (
									<div key={column.key} className="col-span-2 flex flex-col gap-1 border-t border-line pt-2">
										<span className="font-mono text-sm font-medium tracking-[0.1em] uppercase text-muted">
											{column.label}
										</span>
										<span className="text-sm text-ink-2">{row.cells[column.key]}</span>
									</div>
								) : (
									<div key={column.key} className="flex items-baseline justify-between gap-2 border-t border-line pt-2">
										<span className="font-mono text-sm font-medium tracking-[0.1em] uppercase text-muted">
											{column.label}
										</span>
										<span className="tabular font-mono text-sm text-ink-2">{row.cells[column.key]}</span>
									</div>
								),
							)}
						</div>
					</li>
				))}
			</ul>

			<div className="hidden overflow-x-auto md:block">
				<table className="w-full border-collapse" style={{ minWidth }}>
					<caption className="sr-only">{caption}</caption>
					<thead>
						<tr>
							{columns.map((column, i) => (
								<th
									key={column.key}
									scope="col"
									style={
										column.width
											? ({
													width: column.width,
												} as CSSProperties)
											: undefined
									}
									className={`pb-2 font-mono text-sm font-medium tracking-[0.1em] whitespace-nowrap uppercase text-muted ${
										i === 0 ? `${EDGE_START} pr-3` : 'pl-3'
									} ${i === columns.length - 1 ? EDGE_END : ''} ${
										column.align === 'right' ? 'text-right' : 'text-left'
									}`}
								>
									{column.hideLabel ? <span className="sr-only">{column.label}</span> : column.label}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => {
							const band = row.band ? BAND[row.band] : '';
							return (
								<tr key={row.key}>
									<th
										scope="row"
										className={`${cellBase} ${band} ${EDGE_START} pr-3 text-left text-sm font-medium text-ink-2`}
									>
										{row.cells[head.key]}
									</th>
									{rest.map((column, i) => (
										<td
											key={column.key}
											className={`${cellBase} ${band} pl-3 ${i === rest.length - 1 ? EDGE_END : ''} ${
												column.align === 'right'
													? 'tabular text-right font-mono text-sm text-muted'
													: 'text-left text-sm text-ink-2'
											}`}
										>
											{row.cells[column.key]}
										</td>
									))}
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</>
	);
}
