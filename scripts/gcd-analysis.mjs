// The whole GCD analysis for any spec, out of a pull set somebody already fetched.
//
//   node scripts/gcd-analysis.mjs                          # every spec in the cache
//   node scripts/gcd-analysis.mjs --spec=elemental
//   node scripts/gcd-analysis.mjs --from=/path/pulls.json   # a set from somewhere else
//   node scripts/gcd-analysis.mjs --json                    # the whole thing, machine-readable
//
// WHY this is separate from `build-reference-tables.mjs`. That one answers a *product* question — what
// two numbers should this metric be graded against on this encounter — and its output is committed and
// read by the app. This answers a *research* question: is the metric measuring the player at all, and
// how much of it is the fight. Nothing here ships; it exists so the next person does not rebuild the
// same five statistics by hand, and so a claim made about one spec can be re-run against another.
//
// It reads what the reference harness already fetched. Point it at a `pulls.json` and it will not touch
// the network.
//
// ------------------------------------------------------------------ what it computes, and why each one
//
// Five readings, and they answer different objections. Between them they are the argument this project
// spent six sweeps building, so they are worth having in one command rather than five notebooks:
//
//   1. **The distribution.** min / p25 / median / p75 / p90 / max per spec. The first thing anyone asks.
//   2. **By parse band.** The same, split grey / blue / purple / orange / pink. If a rank-60 pull and a
//      rank-99 pull read the same, the metric is not measuring the player — and on two of three specs
//      here they very nearly do.
//   3. **Variance: encounter against player.** Fitted only on the pulls where one player covers many
//      encounters — see `MIN_ENCOUNTERS_PER_PLAYER`, which is the guard that stops this reading being
//      arithmetic. This is the finding that reframed everything: the boss explains most of a Windwalker's
//      figure and the parse band almost none of it. Expect the exact figure to move with the pool; what
//      has held across every pool run so far is the ordering, encounter >> band.
//   4. **Against the simulator's ceiling.** A spec's figure means nothing across specs without it — the
//      three ceilings differ by 7.79 points before a human is involved, so the same number on two specs
//      is measuring two different things.
//   5. **The fairness check.** How many rank-95-and-above pulls a given pair of lines grades `bad`, and
//      which encounters they cluster on. This is the one that matters most and the one nobody runs.
//
// ------------------------------------------------------------------ output is a budget, like its sibling
//
// stdout is a fixed block per spec — about fifteen lines — whatever the sample size. Per-pull detail
// goes to `--json` or nowhere. `src/lib/reference/__tests__/analysis.test.ts` asserts the line budget,
// because this is read by agents as often as by people.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CACHE, GATES, cellOf, gateOf, percentile, registeredSpecs } from './build-reference-tables.mjs';
import { measuredPulls, readLedger } from './reference-ledger.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The parse bands, as WarcraftLogs colours them.
 *
 * Half-open and tiling 0–100, so every pull lands in exactly one. The names are the ones a raider says
 * out loud — a report that talks about "the 75th to 90th percentile" and a raider who says "purple" are
 * discussing the same pulls, and only one of them is going to be understood.
 */
export const PARSE_BANDS = [
	{ key: 'grey', label: '0-49', lo: 0, hi: 50 },
	{ key: 'blue', label: '50-74', lo: 50, hi: 75 },
	{ key: 'purple', label: '75-89', lo: 75, hi: 90 },
	{ key: 'orange', label: '90-94', lo: 90, hi: 95 },
	{ key: 'pink', label: '95-100', lo: 95, hi: 101 },
];

/**
 * Below this a cell is reported but not concluded from.
 *
 * Four is not a sample; it is an anecdote with quartiles. The reference table publishes thin cells with
 * their `n` because a grade still has to come from somewhere, but a *finding* drawn from four pulls is
 * how a sweep talks itself into a conclusion the data never had.
 */
export const MIN_CELL = 4;

/** Perfect play on a dummy, per spec — a bound, never a target. See `lib/reference/specProfile.ts`. */
export const CEILINGS = { windwalker: 91.56, protection: 96.3, elemental: 99.35 };

const round = (v) => (v === null || v === undefined ? null : Math.round(v * 100) / 100);

/** The five-number summary plus the two tails, for one set of values. */
export function distributionOf(values) {
	const sorted = [...values].sort((a, b) => a - b);
	if (sorted.length === 0) return null;
	return {
		n: sorted.length,
		min: round(sorted[0]),
		p25: round(percentile(sorted, 0.25)),
		p50: round(percentile(sorted, 0.5)),
		p75: round(percentile(sorted, 0.75)),
		p90: round(percentile(sorted, 0.9)),
		max: round(sorted[sorted.length - 1]),
	};
}

/**
 * How many encounters a player must cover before their pulls can separate boss from player.
 *
 * Five, and the number is the whole guard. In a pool where nearly every player appears once — 96
 * players across 139 Windwalker pulls in the set this was written against — *player* has almost as many
 * levels as there are observations, so fitting it explains most of the variance by arithmetic rather
 * than by signal. Run naively on that pool the term reads 79.5%, which is not a finding, it is a
 * degrees-of-freedom artefact.
 *
 * The published split (encounter 60.0%, band 8.5% for a Windwalker) came from a *crossed* arm: a handful
 * of players, each covering the whole raid in one night. This restricts to that shape rather than
 * quietly averaging over a pool that cannot answer the question.
 *
 * **It will not reproduce that number exactly and is not meant to.** Five is a looser bar than the full
 * clears the published sweep used, and the crossed subset a given pool yields depends entirely on who
 * happens to be in it — the 355-pull cache this was written against gives 41 Windwalker pulls from 3
 * players and reads 56.9 / 4.8. Same ordering, same conclusion, different pool. Treat a run of this as
 * evidence about the pool you fed it.
 */
export const MIN_ENCOUNTERS_PER_PLAYER = 5;

/**
 * How much of the figure's spread the encounter explains, and how much the player.
 *
 * An additive least-squares fit of `value ~ encounter + player`, on the crossed subset only — see
 * `MIN_ENCOUNTERS_PER_PLAYER` for why the whole pool cannot answer this and what it says if you let it.
 * Reported both orders because the design is unbalanced and sequential sums of squares depend on which
 * term enters first; quoting one order is how a 57% becomes a 60% depending on who ran it.
 *
 * **`byBand` is the second reading and it is the safer one.** Parse band has five levels whatever the
 * sample size, so it carries none of the degrees-of-freedom risk that `player` does, and it answers the
 * question a raid lead actually asks: does this number track how well the pull was parsed. It is
 * computed on the same subset so the two are comparable.
 *
 * Returns `usable: false` when no subset qualifies, which is a real answer rather than an error: a pool
 * of one-off pulls contains no information about this and should say so. Elemental does exactly that on
 * the cache this was written against — one player covers five encounters — and the honest report is that
 * the split is unmeasured there, not that it is zero.
 */
export function varianceSplit(pulls) {
	const rows = pulls.filter((p) => p.encounterID !== undefined && p.player !== undefined);
	const covered = new Map();
	for (const row of rows) {
		if (!covered.has(row.player)) covered.set(row.player, new Set());
		covered.get(row.player).add(row.encounterID);
	}
	const crossedPlayers = [...covered].filter(([, set]) => set.size >= MIN_ENCOUNTERS_PER_PLAYER).map(([p]) => p);
	const subset = rows.filter((r) => crossedPlayers.includes(r.player));
	if (crossedPlayers.length < 2 || subset.length < 20) {
		return { crossed: crossedPlayers.length, subset: subset.length, usable: false };
	}

	const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
	const grand = mean(subset.map((r) => r.value));
	const total = subset.reduce((s, r) => s + (r.value - grand) ** 2, 0);
	if (total === 0) return { crossed: crossedPlayers.length, subset: subset.length, usable: false };

	const bandOf = (rp) => PARSE_BANDS.find((b) => (rp ?? -1) >= b.lo && (rp ?? -1) < b.hi)?.key ?? 'unranked';
	const withBand = subset.map((r) => ({ ...r, band: bandOf(r.rankPercent) }));

	// Sequential sums of squares: fit one factor, then the other on what it leaves behind.
	const share = (rowsIn, first, second) => {
		const meansBy = (key, source) => {
			const by = new Map();
			for (const row of source) {
				if (!by.has(row[key])) by.set(row[key], []);
				by.get(row[key]).push(row.value);
			}
			return new Map([...by].map(([k, v]) => [k, mean(v)]));
		};
		const firstMeans = meansBy(first, rowsIn);
		const ssFirst = rowsIn.reduce((s, r) => s + (firstMeans.get(r[first]) - grand) ** 2, 0);
		const residual = rowsIn.map((r) => ({ ...r, value: r.value - firstMeans.get(r[first]) + grand }));
		const secondMeans = meansBy(second, residual);
		const ssSecond = residual.reduce((s, r) => s + (secondMeans.get(r[second]) - grand) ** 2, 0);
		return { first: round((ssFirst / total) * 100), second: round((ssSecond / total) * 100) };
	};

	const byPlayer = share(withBand, 'encounterID', 'player');
	const playerFirst = share(withBand, 'player', 'encounterID');
	const byBand = share(withBand, 'encounterID', 'band');
	return {
		usable: true,
		crossed: crossedPlayers.length,
		subset: subset.length,
		encounters: new Set(subset.map((r) => r.encounterID)).size,
		byPlayer: { encounter: byPlayer.first, player: byPlayer.second },
		playerFirst: { player: playerFirst.first, encounter: playerFirst.second },
		byBand: { encounter: byBand.first, band: byBand.second },
	};
}

/**
 * How a pair of lines treats pulls that are already excellent.
 *
 * **The check nobody runs, and the one that changed the most minds here.** A threshold pair can look
 * healthy on a whole-population split and still fail a third of the best parses in the game, because
 * the population and the top of it are not the same shape. Under Elemental's old 95/90, 31 of 83
 * rank-95-and-above pulls graded `bad`.
 *
 * `clusters` is the half that turns the number into an argument: if the failures pile onto three
 * encounters, the lines are reading the boss.
 */
export function fairnessOf(pulls, { good, ok }, higherIsBetter = true) {
	const elite = pulls.filter((p) => (p.rankPercent ?? 0) >= 95);
	if (elite.length === 0) return null;
	const bad = elite.filter((p) => (higherIsBetter ? p.value < ok : p.value > ok));
	const clusters = new Map();
	for (const p of bad) {
		const key = p.encounterName ?? String(p.encounterID);
		clusters.set(key, (clusters.get(key) ?? 0) + 1);
	}
	return {
		elite: elite.length,
		bad: bad.length,
		share: round((bad.length / elite.length) * 100),
		good,
		ok,
		clusters: [...clusters].sort((a, b) => b[1] - a[1]).slice(0, 5),
	};
}

/** Everything, for one spec. */
export function analyseSpec(pulls, specKey, lines) {
	const mine = pulls.filter((p) => p.spec === specKey && gateOf(p) === null);
	if (mine.length === 0) return null;
	const values = mine.map((p) => p.value);

	const bands = PARSE_BANDS.map((band) => {
		const inBand = mine.filter((p) => (p.rankPercent ?? -1) >= band.lo && (p.rankPercent ?? -1) < band.hi);
		return { ...band, thin: inBand.length < MIN_CELL, ...(distributionOf(inBand.map((p) => p.value)) ?? { n: 0 }) };
	});

	const byEncounter = [...new Set(mine.map((p) => p.encounterID))]
		.map((encounterID) => {
			const here = mine.filter((p) => p.encounterID === encounterID);
			return {
				encounterID,
				name: here[0]?.encounterName ?? String(encounterID),
				...cellOf(here.map((p) => p.value)),
			};
		})
		.sort((a, b) => a.p50 - b.p50);

	const ceiling = CEILINGS[specKey];
	return {
		spec: specKey,
		overall: distributionOf(values),
		bands,
		byEncounter,
		swing: byEncounter.length < 2 ? null : round(byEncounter[byEncounter.length - 1].p50 - byEncounter[0].p50),
		variance: varianceSplit(mine),
		ceiling:
			ceiling === undefined
				? null
				: {
						value: ceiling,
						gapFromMedian: round(
							ceiling -
								percentile(
									[...values].sort((a, b) => a - b),
									0.5,
								),
						),
					},
		fairness: lines === undefined ? null : fairnessOf(mine, lines),
	};
}

// ------------------------------------------------------------------ reporting

const pad = (s, n) => String(s).padEnd(n);

export function printSpec(report) {
	const d = report.overall;
	console.log(`\n${report.spec}  n=${d.n}`);
	console.log(`  spread      min ${d.min}  p25 ${d.p25}  med ${d.p50}  p75 ${d.p75}  p90 ${d.p90}  max ${d.max}`);
	for (const band of report.bands) {
		const body = band.n === 0 ? 'no pulls' : `n=${pad(band.n, 4)} med ${pad(band.p50, 7)}${band.thin ? ' thin' : ''}`;
		console.log(`  ${pad(`${band.key} ${band.label}`, 16)}${body}`);
	}
	if (report.swing !== null) {
		const lo = report.byEncounter[0];
		const hi = report.byEncounter[report.byEncounter.length - 1];
		console.log(`  encounters  ${lo.name} ${lo.p50} .. ${hi.name} ${hi.p50}  swing ${report.swing}`);
	}
	if (report.variance !== null) {
		const v = report.variance;
		if (!v.usable) {
			console.log(
				`  variance    not measurable — ${v.crossed} player(s) cover ${MIN_ENCOUNTERS_PER_PLAYER}+ encounters`,
			);
		} else {
			console.log(
				`  variance    encounter ${v.byPlayer.encounter}% / player ${v.byPlayer.player}%` +
					`  · vs parse band ${v.byBand.band}%  (n=${v.subset}, ${v.crossed} crossed players)`,
			);
		}
	}
	if (report.ceiling !== null) {
		console.log(`  ceiling     ${report.ceiling.value}  median sits ${report.ceiling.gapFromMedian} below`);
	}
	if (report.fairness !== null) {
		const f = report.fairness;
		const where = f.clusters.map(([name, n]) => `${name} ${n}`).join(', ');
		console.log(
			`  fairness    ${f.bad}/${f.elite} rank-95+ graded bad under ${f.good}/${f.ok}${where ? ` — ${where}` : ''}`,
		);
	}
}

/**
 * The pulls to analyse: the committed ledger by default, a file when `--from` names one.
 *
 * **The ledger rather than the cache**, because the cache is one run's scratch and is absent in a fresh
 * checkout — an analysis that read it would work on the machine that last swept and report an empty pool
 * everywhere else. The ledger is committed, so this command answers the same way for everybody.
 *
 * Ledger rows carry `playerKey` where a raw sweep carries `player`; the variance split only ever compares
 * identities for equality, so the hash serves and no name is needed.
 */
function readPulls(from) {
	if (from !== undefined) {
		if (!existsSync(from)) throw new Error(`no pull set at ${from}`);
		return JSON.parse(readFileSync(from, 'utf8'));
	}
	const cached = resolve(CACHE, 'pulls.json');
	if (existsSync(cached)) return JSON.parse(readFileSync(cached, 'utf8'));
	const rows = measuredPulls(readLedger());
	if (rows.length === 0) {
		throw new Error('no pulls on hand — run scripts/build-reference-tables.mjs first, or pass --from');
	}
	return rows.map((row) => ({ ...row, player: row.player ?? row.playerKey }));
}

async function main() {
	const args = process.argv.slice(2);
	const only = args.find((a) => a.startsWith('--spec='))?.slice('--spec='.length);
	const from = args.find((a) => a.startsWith('--from='))?.slice('--from='.length);
	// A candidate pair to try, as `--lines=85/75`. Without it the fairness row is silent, because there is
	// no such thing as a default pair to test — the whole point is asking what a *proposed* line would do.
	const pair = args.find((a) => a.startsWith('--lines='))?.slice('--lines='.length);
	const lines = pair === undefined ? undefined : { good: Number(pair.split('/')[0]), ok: Number(pair.split('/')[1]) };
	if (lines !== undefined && (Number.isNaN(lines.good) || Number.isNaN(lines.ok))) {
		throw new Error(`--lines wants good/ok, as in --lines=85/75, not ${pair}`);
	}

	const pulls = readPulls(from);
	const specs = registeredSpecs().filter((s) => only === undefined || s.key === only);
	if (specs.length === 0) throw new Error(`no registered spec named ${only}`);

	const reports = specs.map((spec) => analyseSpec(pulls, spec.key, lines)).filter(Boolean);
	if (reports.length === 0) throw new Error('no gated pulls for any requested spec');

	if (args.includes('--json')) {
		console.log(JSON.stringify(reports, null, '\t'));
		return;
	}
	console.log(`${pulls.length} pulls on hand, gates: contact >= ${GATES.minContactShare}, deaths ${GATES.deaths}`);
	for (const report of reports) printSpec(report);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await main().catch((error) => {
		console.error(String(error.message ?? error));
		process.exitCode = 1;
	});
}

export { ROOT };
