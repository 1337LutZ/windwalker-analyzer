// Builds src/generated/reference.json: what a metric actually reads on each encounter, per spec.
//
//   node scripts/build-reference-tables.mjs                    # refresh every registered spec
//   node scripts/build-reference-tables.mjs --spec=elemental   # one spec
//   node scripts/build-reference-tables.mjs --check            # is the committed table stale? no fetching
//   node scripts/build-reference-tables.mjs --dry              # plan the fetch, spend nothing
//
// WHY this exists. Every grading line in this tree is two absolute numbers, and measured across 400
// heroic Siege kills those numbers grade the encounter rather than the player: the boss explains 60.0%
// of the variance in `gcdUtilisationPct` for a Windwalker against 8.5% for the player's parse band. A
// rank-95 monk on Immerseus is `bad` and a rank-27 monk on Malkorok is `good`, under the same pair of
// numbers. `src/lib/score/profile.ts` grades against an encounter's own distribution instead; this is
// where that distribution comes from.
//
// WHY the output is committed rather than fetched during a build: exactly the reason
// `build-spell-map.mjs` commits its map. `npm run build` must never reach the network — the site
// deploys from GitHub Actions, and a build that fetched a thousand combat logs could fail for reasons
// having nothing to do with the change being deployed. Committing the derived table also makes drift
// *reviewable*: a re-run produces a diff, so a reference that moved shows up in a pull request instead
// of silently re-grading every report.
//
// ------------------------------------------------------------------ this runs for specs that do not exist yet
//
// Nothing here names a spec. `SpecDefinition` already carries the two strings WarcraftLogs wants —
// `classKey` is documented as "WarcraftLogs' own class spelling, exactly as the API returns it" and
// `specName` as "WarcraftLogs' own spec spelling" — so the roster below is read out of
// `src/lib/spec/registry.ts` and a spec registered next year is swept the day it lands, with no edit
// here. That is the same automatic pickup `build-spell-map.mjs` has for new spell ids, and it is why
// neither script has a hand-maintained list to forget.
//
// ------------------------------------------------------------------ output is deliberately small
//
// This is run by agents as often as by people, so its output is a budget rather than an afterthought:
//
//   - stdout is ONE LINE PER CELL — 14 encounters × the specs asked for — whatever the sample size.
//     A full three-spec refresh prints 42 lines and a header, never a line per pull.
//   - `--check` prints only cells that drifted, and nothing at all when the table is current.
//   - per-pull detail is written to disk and the path reported once. It is never printed.
//   - datasets are cached by (report, fight, player), so a re-run costs no API points and no tokens.
//   - failures print a count and one example, not a list.
//
// `src/lib/reference/__tests__/harness.test.ts` asserts the line budget, so a future edit that starts
// printing per-pull rows fails rather than quietly costing a reader ten thousand tokens. It lives under
// `src/` because that is the only tree `vitest.config.ts` collects.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'src/generated/reference.json');
const CACHE = process.env.REFERENCE_CACHE ?? resolve(ROOT, '.reference-cache');
const DETAIL = resolve(CACHE, 'pulls.json');

const API = 'https://classic.warcraftlogs.com/api/v2/client';

/** Siege of Orgrimmar. The zone every committed fixture and every sweep so far comes from. */
export const ZONE_ID = 1054;

/**
 * How many pulls a cell wants before its p90 means anything.
 *
 * A median survives six pulls; a ninetieth percentile does not. The sweeps that produced the first
 * table left most cells at six to twelve, which is why `EncounterRef.n` travels with the numbers and is
 * printed beside every grade — see `profile.ts`. This is the number the harness *aims* for, not a floor
 * it enforces: a thin cell is published with its `n` rather than withheld, because a reader who can see
 * the sample can weigh the grade, and a missing row silently falls back to the spec-wide distribution.
 */
export const TARGET_N = 40;

/**
 * Siege's fourteen encounters, by **base** id.
 *
 * Written out rather than derived, because the only list in the tree is `enforced.ts`' profile array
 * and that one is deliberately partial — it holds the fights somebody has measured a mechanic on, which
 * is a different question from which fights exist. A hard-coded raid list is honest here: the zone
 * shipped in 2013 and is not going to grow an encounter.
 */
export const ENCOUNTERS = [1593, 1594, 1595, 1598, 1599, 1600, 1601, 1602, 1603, 1604, 1606, 1622, 1623, 1624];

/**
 * Siege's own id offset, and the reason every cell is keyed on the **base** id.
 *
 * WarcraftLogs numbers a Classic encounter 50 000 above its retail id — heroic Immerseus is 51 602 and
 * the base is 1 602 — and `baseEncounterID` in `lib/game/rankingExclusions.ts` is what the app reduces
 * a fight through before any lookup. A table keyed on the raw id would miss on every pull, silently,
 * and every grade would fall back to the spec-wide distribution while looking like it had a row.
 */
export const CLASSIC_OFFSET = 50_000;
export const baseEncounterID = (encounterID) => encounterID % CLASSIC_OFFSET;

/** The figure a reference row describes. One today; the shape takes more without changing. */
export const METRIC = 'gcdUtilisationPct';

/** Gates a pull must clear before it may inform a reference. Each one caught something real. */
export const GATES = {
	/**
	 * The analyser's own `identify` hook, never WarcraftLogs' spec label.
	 *
	 * Seventeen ranked players across six sweeps were a different spec than the site labelled them —
	 * Holy and Retribution paladins ranked as Protection, Restoration shamans ranked as Elemental. One
	 * of them was ranked Protection on three separate pulls while casting Divine Storm and Templar's
	 * Verdict. The label is not trustworthy enough to build a grading table on.
	 */
	requireIsSpec: true,
	/** Kills only. Rankings return kills, but a cached dataset from elsewhere might not be one. */
	requireKill: true,
	difficulty: 4,
	minRaidSize: 24,
	/** Below this a handful of presses moves the figure a full point. */
	minDurationMs: 120_000,
	/**
	 * The share of the pull the player must have been in reach for — `MIN_CONTACT_SHARE`.
	 *
	 * The contact clock counts only the stretches the player was damaging something, so a pull spent
	 * mostly dead, healing or phased out is scored over the part they were freshest for. A rank-0 kill
	 * with two deaths reads 94.52% off 32.7s of contact on a 260s fight.
	 */
	minContactShare: 0.5,
	/**
	 * Deaths are **annotated, not excluded**, and this reverses an earlier instruction on purpose.
	 *
	 * The reason given for excluding them was that the contact clock ends at death. It does not:
	 * `engagedWindows` splits on a gap longer than `ENGAGED_GAP_MS` and resumes at the next hit, so a
	 * resurrected player gets their remaining time back. Two sweeps checked every death pull between
	 * them and found the players kept pressing to the end — one measured a pull that died at 59s of 336s
	 * and still read 94.86% contact. Excluding costs twelve honest pulls to catch one, and the two
	 * sweeps' samples disagree about even the sign of the effect. The contact gate above is what
	 * actually catches the unfair pull.
	 */
	deaths: 'annotate',
};

// ------------------------------------------------------------------ the roster, read from the registry

/**
 * Every registered spec, as the three strings this script needs.
 *
 * Read out of the registry's source text rather than imported, for the reason `build-spell-map.mjs`
 * reads the spec models the same way: this is a plain `.mjs` run by `node`, and importing a TypeScript
 * module that pulls in the whole analyser to learn three strings would be a build step of its own.
 */
export function registeredSpecs(source = readFileSync(resolve(ROOT, 'src/lib/spec/registry.ts'), 'utf8')) {
	const specs = [];
	// Each entry opens with `key:` and carries `classKey:` and `specName:` before the next `key:`.
	for (const block of source.split(/\n\t\{\n/).slice(1)) {
		const key = block.match(/^\s*key: '([^']+)'/m)?.[1];
		const classKey = block.match(/^\s*classKey: '([^']+)'/m)?.[1];
		const specName = block.match(/^\s*specName: '([^']+)'/m)?.[1];
		if (key !== undefined && classKey !== undefined && specName !== undefined) {
			specs.push({ key, classKey, specName });
		}
	}
	if (specs.length === 0) throw new Error('no specs found in registry.ts — has SPECS changed shape?');
	return specs;
}

// ------------------------------------------------------------------ the band arithmetic

/**
 * Where a rank sits on the ladder, as WarcraftLogs computes it.
 *
 * The whole reason a targeted sweep is cheap. Two sweeps established that a row's position in
 * `characterRankings` **is** its `rank` — page 2 row 1 is rank 101, page 3 row 1 is rank 201 — and that
 * the site's own `rankPercent` is this expression. So a percentile is not something to page toward and
 * hope for; one screen per encounter gives `totalParses`, and after that any band is reachable first
 * try. Measured hit rate across the two band sweeps: **143 of 143**.
 */
export const rankPercentOf = (rank, totalParses) => (totalParses <= 0 ? 0 : Math.floor(100 * (1 - rank / totalParses)));

/**
 * The list positions that land inside a percentile band, given the ladder's depth.
 *
 * **The percentage is applied before the division, and that is not style.** Written the readable way —
 * `total * (1 - lo / 100)` — the top of every band loses a row to binary floating point: `1 - 90/100` is
 * `0.09999999999999998`, so a thousand-parse ladder answers 99 where it means 100. One row per band per
 * encounter per spec is not a rounding difference, it is a systematically missing sample at the exact
 * edge the band is defined by. Kept as integer arithmetic instead, and pinned by a test.
 */
export function rowsForBand(totalParses, loPercent, hiPercent) {
	const from = Math.ceil((totalParses * (100 - hiPercent)) / 100);
	const to = Math.floor((totalParses * (100 - loPercent)) / 100);
	return { from: Math.max(1, from), to: Math.max(1, to) };
}

/**
 * The bands a reference table is drawn from, and why it is the whole ladder.
 *
 * A reference pooled only from top parses would answer "how does this compare to the best", which is a
 * ranking the report already shows. Pooled across the ladder it answers "what does this fight cost",
 * which is what a grading line needs — and the line is then anchored at the distribution's p90 rather
 * than its middle, so `good` still means good play. See `profile.ts` on why an anchor is not a curve.
 */
export const BANDS = [
	[0, 50],
	[50, 75],
	[75, 90],
	[90, 101],
];

// ------------------------------------------------------------------ statistics

export function percentile(sorted, p) {
	if (sorted.length === 0) return null;
	const k = (sorted.length - 1) * p;
	const f = Math.floor(k);
	const c = Math.min(f + 1, sorted.length - 1);
	return sorted[f] + (sorted[c] - sorted[f]) * (k - f);
}

/**
 * One cell: the distribution of a metric on one encounter for one spec.
 *
 * **The rounding here is the cell's, and it matters that the *inputs* are not rounded.** The first
 * table was pooled from per-pull figures that had already been cut to two decimals, and a rebuild from
 * full-precision `analyse()` output moves fourteen otherwise-untouched cells by ±0.01 — a pure artefact
 * of where the rounding happened, not of anything measured. It is harmless in itself; what is not
 * harmless is mistaking it for drift when reading a `--check` diff. Feed this raw values.
 */
export function cellOf(values) {
	const sorted = [...values].sort((a, b) => a - b);
	return {
		n: sorted.length,
		p50: round(percentile(sorted, 0.5)),
		p90: round(percentile(sorted, 0.9)),
	};
}

const round = (v) => (v === null ? null : Math.round(v * 100) / 100);

// ------------------------------------------------------------------ the fetch

async function gql(token, query, variables) {
	const res = await fetch(API, {
		method: 'POST',
		headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
		body: JSON.stringify({ query, variables }),
	});
	if (!res.ok) throw new Error(`WarcraftLogs answered ${res.status}`);
	const body = await res.json();
	if (body.errors) throw new Error(body.errors[0]?.message ?? 'query failed');
	return body.data;
}

const RANKINGS = `
query Rankings($encounterID: Int!, $className: String!, $specName: String!, $page: Int!) {
  worldData {
    encounter(id: $encounterID) {
      characterRankings(className: $className, specName: $specName, difficulty: 4, metric: dps, page: $page)
    }
  }
}`;

/**
 * Candidate pulls for one (spec, encounter), spread across the ladder.
 *
 * Returns rows carrying enough to fetch and to gate: report code, fight id, player, and the
 * `rankPercent` the arithmetic above predicts. The prediction is checked against the dataset's own
 * figure after the fetch — the two agreed to ±1 on all 59 pulls of the sweep that established it, but a
 * predicted band that nothing verifies is a band nobody has measured.
 */
export async function candidatesFor(token, spec, encounterID, perBand) {
	const first = await gql(token, RANKINGS, {
		encounterID,
		className: spec.classKey,
		specName: spec.specName,
		page: 1,
	});
	const payload = first.worldData?.encounter?.characterRankings;
	const total = payload?.count ?? payload?.rankings?.length ?? 0;
	if (total === 0) return [];

	const wanted = new Map();
	for (const [lo, hi] of BANDS) {
		const { from, to } = rowsForBand(total, lo, hi);
		for (let i = 0; i < perBand && from + i <= to; i += 1) {
			// Spread inside the band rather than taking its first rows, so a cell is not one guild.
			const row = from + Math.floor((i * (to - from)) / Math.max(1, perBand - 1));
			wanted.set(row, rankPercentOf(row, total));
		}
	}

	const byPage = new Map();
	for (const row of wanted.keys()) {
		const page = Math.floor((row - 1) / 100) + 1;
		if (!byPage.has(page)) byPage.set(page, []);
		byPage.get(page).push(row);
	}

	const out = [];
	for (const [page, rows] of byPage) {
		const data =
			page === 1
				? payload
				: (
						await gql(token, RANKINGS, {
							encounterID,
							className: spec.classKey,
							specName: spec.specName,
							page,
						})
					).worldData?.encounter?.characterRankings;
		for (const row of rows) {
			const entry = data?.rankings?.[row - 1 - (page - 1) * 100];
			if (entry?.report?.code === undefined) continue;
			if ((entry.size ?? 0) < GATES.minRaidSize) continue;
			out.push({
				encounterID,
				code: entry.report.code,
				fightID: entry.report.fightID,
				player: entry.name,
				predictedRankPercent: wanted.get(row),
				rank: row,
				totalParses: total,
			});
		}
	}
	return out;
}

// ------------------------------------------------------------------ the run

function readCache() {
	if (!existsSync(DETAIL)) return [];
	try {
		return JSON.parse(readFileSync(DETAIL, 'utf8'));
	} catch {
		return [];
	}
}

/** Keeps a pull only if it clears every gate, and says which gate rejected it. */
export function gateOf(pull) {
	if (GATES.requireIsSpec && pull.isSpec !== true) return 'off-spec';
	if (GATES.requireKill && pull.kill === false) return 'not a kill';
	if (pull.difficulty !== undefined && pull.difficulty !== GATES.difficulty) return 'wrong difficulty';
	if ((pull.durationMs ?? 0) < GATES.minDurationMs) return 'too short';
	if ((pull.contactShare ?? 0) < GATES.minContactShare) return 'barely present';
	return null;
}

/** The committed table, built from whatever pulls are on hand. */
export function tableFrom(pulls, specs, metric = 'gcdUtilisationPct') {
	const out = { metric, builtAt: null, specs: {} };
	for (const spec of specs) {
		const mine = pulls.filter((p) => p.spec === spec.key && gateOf(p) === null);
		const encounters = {};
		for (const encounterID of [...new Set(mine.map((p) => baseEncounterID(p.encounterID)))].sort((a, b) => a - b)) {
			const here = mine.filter((p) => baseEncounterID(p.encounterID) === encounterID);
			if (here.length === 0) continue;
			// The encounter's name rides in the cell rather than being looked up. `enforced.ts` is the
			// only other list of Siege names in the tree and it is deliberately partial — it holds the
			// fights somebody has measured a mechanic on, which is a different question from what a
			// fight is called, and it is missing three of the fourteen. WarcraftLogs hands the name back
			// with every ranking, so the table carries what it was told rather than a second list to
			// maintain.
			encounters[encounterID] = { ...cellOf(here.map((p) => p.value)), name: here[0].boss ?? String(encounterID) };
		}
		out.specs[spec.key] = {
			encounters,
			fallback: mine.length > 0 ? cellOf(mine.map((p) => p.value)) : null,
			sourcePulls: mine.length,
		};
	}
	return out;
}

// ------------------------------------------------------------------ reporting, one line per cell

const pad = (s, n) => String(s).padEnd(n);

function printTable(table, specs) {
	console.log(`spec         encounter        n    p50     p90`);
	for (const spec of specs) {
		const rows = table.specs[spec.key]?.encounters ?? {};
		for (const [encounterID, cell] of Object.entries(rows)) {
			const thin = cell.n < TARGET_N ? ' thin' : '';
			console.log(
				`${pad(spec.key, 12)} ${pad(encounterID, 14)} ${pad(cell.n, 4)} ${pad(cell.p50?.toFixed(2), 7)} ${pad(cell.p90?.toFixed(2), 7)}${thin}`,
			);
		}
	}
}

/** What changed against the committed table. Prints nothing when nothing moved. */
export function driftOf(committed, fresh) {
	const drifted = [];
	for (const [specKey, spec] of Object.entries(fresh.specs)) {
		const before = committed.specs?.[specKey]?.encounters ?? {};
		for (const [encounterID, cell] of Object.entries(spec.encounters)) {
			const was = before[encounterID];
			if (was === undefined) {
				drifted.push(`${specKey} ${encounterID} new n=${cell.n}`);
			} else if (was.p50 !== cell.p50 || was.p90 !== cell.p90) {
				drifted.push(`${specKey} ${encounterID} p50 ${was.p50}->${cell.p50} p90 ${was.p90}->${cell.p90}`);
			}
		}
	}
	return drifted;
}

/**
 * Fold a partial refresh into the committed table, keeping every spec the run did not sweep.
 *
 * ***A `--spec=` refresh used to delete the other specs, and the diff looked like a success.*** The run
 * built its table from the *filtered* roster and wrote the whole file, so
 * `--spec=elemental` shipped a `reference.json` containing elemental and nothing else — and because the
 * runner had already replaced `pulls.json` with that one spec's pulls, `--check` agreed with it. Two
 * specs' worth of grading lines would have silently fallen back to their spec-wide distribution, on
 * every report, until somebody opened the file.
 *
 * A one-spec refresh is the *common* case — it is what you run when a spec is added, or when one spec's
 * ladder has moved — so the partial path has to be the safe one rather than the sharp one.
 */
export function mergeTable(committed, fresh) {
	return {
		...committed,
		...fresh,
		specs: { ...committed.specs, ...fresh.specs },
	};
}

async function main() {
	const args = process.argv.slice(2);
	const only = args.find((a) => a.startsWith('--spec='))?.slice('--spec='.length);
	const specs = registeredSpecs().filter((s) => only === undefined || s.key === only);
	if (specs.length === 0) throw new Error(`no registered spec named ${only}`);

	if (args.includes('--check')) {
		const committed = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { specs: {} };
		const fresh = tableFrom(readCache(), specs, committed.metric);
		const drifted = driftOf(committed, fresh);
		if (drifted.length === 0) return;
		console.log(`${drifted.length} cell(s) differ from the committed table:`);
		for (const line of drifted) console.log(`  ${line}`);
		process.exitCode = 1;
		return;
	}

	if (args.includes('--dry')) {
		console.log(`would sweep ${specs.length} spec(s) across 14 encounters, ${TARGET_N} pulls a cell`);
		console.log(`cache ${CACHE}`);
		return;
	}

	const token = process.env.WCL_TOKEN;
	if (token === undefined || token === '') {
		throw new Error('WCL_TOKEN is not set — load it with: set -a; . ./.env; set +a');
	}

	// ---------------------------------------------------------------- pick the pulls
	//
	// Candidate selection is this script's because it is pure GraphQL against the rankings list — no
	// analyser, no TypeScript, and the band arithmetic that makes it cheap already lives here. What the
	// runner gets is a flat job list; turning a job into a measured pull is the only thing it owns.
	const perBand = Math.max(1, Math.round(TARGET_N / BANDS.length));
	const jobs = [];
	const failures = [];
	for (const spec of specs) {
		for (const encounterID of ENCOUNTERS) {
			try {
				const found = await candidatesFor(token, spec, encounterID, perBand);
				for (const row of found) jobs.push({ spec: spec.key, ...row });
			} catch (error) {
				failures.push(`${spec.key} ${encounterID}: ${error.message ?? error}`);
			}
		}
	}
	if (jobs.length === 0)
		throw new Error(`no candidates found${failures[0] === undefined ? '' : ` — e.g. ${failures[0]}`}`);
	writeFileSync(resolve(CACHE, 'jobs.json'), JSON.stringify({ metric: METRIC, specs, jobs }));

	// **The fetch runs under vitest, and that is a constraint rather than a preference.** It needs
	// `analyse()` from the spec modules — TypeScript, importing through the `~/` alias and pulling
	// `?raw` GraphQL documents — and `vitest.config.ts` is the only place in this repo where both
	// already resolve. Every sweep that produced the current table ran its fetch the same way.
	//
	// The runner is committed rather than written and deleted, because `include` is `src/**` and a
	// temporary file under it is a file the next `npm test` might collect mid-write. It skips itself
	// unless `REFERENCE_SWEEP` is set, so it costs the ordinary suite one skipped test and no network.
	const { status } = spawnSync('npx', ['vitest', 'run', 'src/lib/reference/__tests__/sweep.run.ts', '--silent'], {
		cwd: ROOT,
		stdio: ['ignore', 'ignore', 'inherit'],
		env: {
			...process.env,
			REFERENCE_SWEEP: '1',
			REFERENCE_CACHE: CACHE,
			REFERENCE_SPECS: specs.map((s) => s.key).join(','),
			REFERENCE_TARGET_N: String(TARGET_N),
		},
	});
	if (status !== 0) throw new Error('the sweep did not finish — its own output is above');

	const pulls = readCache();
	const committed = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { specs: {} };
	const table = mergeTable(committed, tableFrom(pulls, specs));
	table.builtAt = new Date().toISOString().slice(0, 10);
	writeFileSync(OUT, `${JSON.stringify(table, null, '\t')}\n`);

	printTable(table, specs);
	const rejected = pulls.filter((pull) => gateOf(pull) !== null);
	if (rejected.length > 0) {
		const example = rejected[0];
		console.log(`${rejected.length} pull(s) gated out, e.g. ${example.code}#${example.fightID} ${gateOf(example)}`);
	}
	console.log(`${pulls.length} pulls on hand · detail ${DETAIL} · table ${OUT}`);
}

mkdirSync(CACHE, { recursive: true });

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await main().catch((error) => {
		console.error(String(error.message ?? error));
		process.exitCode = 1;
	});
}

export { CACHE, DETAIL, OUT, printTable, readCache };
