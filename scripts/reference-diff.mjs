// What merging a refresh would actually change, as a table a reviewer can read.
//
//   node scripts/reference-diff.mjs before.json after.json
//
// The refresh pull request used to carry the *new* table and nothing to compare it against, which asks a
// reviewer to decide whether 68.10 is a reasonable `ok` for Immerseus with no idea it used to be 66.26.
// Every cell here is a grading line: `p50` is where `ok` sits and `p90` is where `good` does, so a moved
// cell re-grades every report on that encounter.
//
// **Against main rather than against the previous run.** The branch accumulates across runs while its
// pull request sits open, so a diff against its own last commit would show one evening's handful of
// pulls. What a reviewer is deciding is whether to merge, and merging replaces main's table with this
// one — so main is the baseline.
//
// Only changed cells are printed. A full refresh that moves three of forty-two should be three rows, not
// forty-two, and the counts above the table say how many stayed put.

import { existsSync, readFileSync } from 'node:fs';

import { cellKeyOf } from './reference-ledger.mjs';

const round = (v) => Math.round(v * 100) / 100;

/**
 * How wide the uncertainty on a cell's `good` line is, by bootstrap.
 *
 * **A moved line and a moved *estimate* are different events, and the table could not tell them apart.**
 * `good` is the 90th percentile of a few dozen pulls; resampling those pulls with replacement and taking
 * the 90th percentile each time says how much the figure would wobble on a different draw of the same
 * ladder. A cell that moved 0.4 with a ±1.5 interval did not move.
 *
 * It is also what makes "the buckets narrow the measurement" checkable rather than asserted: as capacity
 * grows the interval shrinks, and the summary line prints the median width so successive pull requests
 * can be compared.
 *
 * Seeded per cell rather than randomly, so the same ledger renders the same body twice — a pull request
 * whose numbers shifted because it was regenerated would be worse than no interval at all.
 */
const RESAMPLES = 400;

function mulberry32(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const seedOf = (text) => {
	let h = 2166136261;
	for (let i = 0; i < text.length; i += 1) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
};

const quantile = (sorted, q) => {
	if (sorted.length === 0) return null;
	const at = (sorted.length - 1) * q;
	const lo = Math.floor(at);
	const hi = Math.ceil(at);
	return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
};

/** Half the 90% bootstrap interval on this cell's p90, or null when there is too little to resample. */
export function intervalOf(values, key) {
	if (values.length < 4) return null;
	const rand = mulberry32(seedOf(key));
	const draws = [];
	for (let i = 0; i < RESAMPLES; i += 1) {
		const sample = Array.from({ length: values.length }, () => values[Math.floor(rand() * values.length)]);
		sample.sort((a, b) => a - b);
		draws.push(quantile(sample, 0.9));
	}
	draws.sort((a, b) => a - b);
	const lo = quantile(draws, 0.05);
	const hi = quantile(draws, 0.95);
	return (hi - lo) / 2;
}

/** The measured values behind each cell, keyed `spec:cell`, read straight from the ledger. */
export function valuesFrom(ledger) {
	const out = new Map();
	for (const row of ledger.pulls ?? []) {
		if (row.outcome !== 'measured') continue;
		const key = `${row.spec}:${cellKeyOf(row.encounterID)}`;
		if (!out.has(key)) out.set(key, []);
		out.get(key).push(row.value);
	}
	return out;
}

/**
 * Every cell that moved, with what it moved from.
 *
 * A cell that is new, or that disappeared, is reported as such rather than as a change from zero — a
 * table gaining its first Galakras row is a different event from Galakras getting harder, and rendering
 * both as `0.00 -> 74.90` would hide the first inside the second.
 */
export function diffCells(before, after) {
	const rows = [];
	const specs = [...new Set([...Object.keys(before.specs ?? {}), ...Object.keys(after.specs ?? {})])].sort();
	for (const spec of specs) {
		const was = before.specs?.[spec]?.encounters ?? {};
		const now = after.specs?.[spec]?.encounters ?? {};
		for (const id of [...new Set([...Object.keys(was), ...Object.keys(now)])].sort()) {
			const a = was[id];
			const b = now[id];
			if (a === undefined && b === undefined) continue;
			if (a === undefined) {
				rows.push({ spec, id, name: b.name, kind: 'added', after: b });
				continue;
			}
			if (b === undefined) {
				rows.push({ spec, id, name: a.name, kind: 'removed', before: a });
				continue;
			}
			if (a.n === b.n && round(a.p50) === round(b.p50) && round(a.p90) === round(b.p90)) continue;
			rows.push({ spec, id, name: b.name ?? a.name, kind: 'changed', before: a, after: b });
		}
	}
	return rows;
}

/** How much evidence each spec gained, which is the other half of whether a move is trustworthy. */
export function evidenceOf(before, after) {
	const specs = [...new Set([...Object.keys(before.specs ?? {}), ...Object.keys(after.specs ?? {})])].sort();
	return specs.map((spec) => ({
		spec,
		before: before.specs?.[spec]?.sourcePulls ?? 0,
		after: after.specs?.[spec]?.sourcePulls ?? 0,
	}));
}

const move = (from, to) => {
	const a = round(from);
	const b = round(to);
	if (a === b) return a.toFixed(2);
	const arrow = b > a ? '↑' : '↓';
	return `${a.toFixed(2)} → **${b.toFixed(2)}** ${arrow}`;
};

export function markdownFor(before, after, ledger = { pulls: [] }) {
	const values = valuesFrom(ledger);
	const widthOf = (spec, id) => intervalOf(values.get(`${spec}:${id}`) ?? [], `${spec}:${id}`);
	const rows = diffCells(before, after);
	const out = [];

	const evidence = evidenceOf(before, after);
	out.push(
		`**Evidence behind the table:** ${evidence
			.map(({ spec, before: was, after: now }) => `${spec} ${was} → ${now}`)
			.join(' · ')}`,
	);
	// **A spec losing evidence looks like data loss and is not.** Values measured by an older analyser
	// are excluded rather than averaged in — see `ANALYSER_REV` — so a rev bump drops the count until a
	// sweep re-measures those pulls. Said here because the number is alarming without it.
	const shrank = evidence.filter(({ before: was, after: now }) => now < was);
	if (shrank.length > 0) {
		out.push('');
		out.push(
			`> ${shrank.map((e) => e.spec).join(', ')} shows fewer pulls than main. Those are rows measured by an` +
				' older analyser, held out of the table until a sweep re-measures them rather than averaged in with' +
				' readings of a different quantity. Cells they backed keep their committed values meanwhile.',
		);
	}
	out.push('');

	if (rows.length === 0) {
		out.push('No grading line moved. The table gained evidence without changing what it asks for.');
		return out.join('\n');
	}

	const total = Object.values(after.specs ?? {}).reduce(
		(sum, spec) => sum + Object.keys(spec.encounters ?? {}).length,
		0,
	);
	out.push(`**${rows.length} of ${total} cells moved.** \`ok\` is the encounter's p50, \`good\` its p90 —`);
	out.push('so every row below re-grades reports on that encounter. ↑ means the line got harder to clear.');
	out.push('');
	// The median interval across *every* cell, not just the moved ones — the point of the figure is that
	// it shrinks from one refresh to the next, which only reads as progress if the population is fixed.
	const widths = [];
	for (const [spec, entry] of Object.entries(after.specs ?? {})) {
		for (const id of Object.keys(entry.encounters ?? {})) {
			const w = widthOf(spec, Number(id));
			if (w !== null) widths.push(w);
		}
	}
	if (widths.length > 0) {
		widths.sort((a, b) => a - b);
		out.push(
			`**Median uncertainty on \`good\`: ±${round(quantile(widths, 0.5)).toFixed(2)}** across ${widths.length} cells.` +
				' It shrinks as the buckets widen — compare it against the last refresh.',
		);
		out.push('');
	}
	out.push('| spec | encounter | pulls | ok (p50) | good (p90) |');
	out.push('| --- | --- | --- | --- | --- |');
	for (const row of rows) {
		if (row.kind === 'added') {
			out.push(
				`| ${row.spec} | ${row.name} | — → ${row.after.n} | new **${round(row.after.p50).toFixed(2)}** | new **${round(row.after.p90).toFixed(2)}** |`,
			);
			continue;
		}
		if (row.kind === 'removed') {
			out.push(`| ${row.spec} | ${row.name} | ${row.before.n} → — | **removed** | **removed** |`);
			continue;
		}
		const n = row.before.n === row.after.n ? String(row.after.n) : `${row.before.n} → ${row.after.n}`;
		const width = widthOf(row.spec, Number(row.id));
		// A move smaller than the interval is noise, and saying so is more useful than an arrow.
		const moved = Math.abs(round(row.after.p90) - round(row.before.p90));
		const band =
			width === null ? '' : ` ±${round(width).toFixed(2)}${moved > 0 && moved < width ? ' *(within noise)*' : ''}`;
		out.push(
			`| ${row.spec} | ${row.name} | ${n} | ${move(row.before.p50, row.after.p50)} | ${move(row.before.p90, row.after.p90)}${band} |`,
		);
	}
	return out.join('\n');
}

function main() {
	const [beforePath, afterPath, ledgerPath] = process.argv.slice(2);
	if (beforePath === undefined || afterPath === undefined) {
		throw new Error('usage: node scripts/reference-diff.mjs before.json after.json');
	}
	// A missing baseline is the first-ever refresh, not a failure: everything is new, and saying so is
	// more useful to a reviewer than an error that stops the pull request being described at all.
	const before = existsSync(beforePath) ? JSON.parse(readFileSync(beforePath, 'utf8')) : { specs: {} };
	const after = JSON.parse(readFileSync(afterPath, 'utf8'));
	// Optional: without it the table still renders, just with no interval column.
	const ledger =
		ledgerPath !== undefined && existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8')) : { pulls: [] };
	console.log(markdownFor(before, after, ledger));
}

if (process.argv[1]?.endsWith('reference-diff.mjs')) {
	try {
		main();
	} catch (error) {
		console.error(String(error.message ?? error));
		process.exitCode = 1;
	}
}
