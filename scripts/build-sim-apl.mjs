// The sim's priority lists, pinned and committed, so a hand-written rotation cannot drift in silence.
//
//   node scripts/build-sim-apl.mjs            # refresh from wowsims/mop@master
//   node scripts/build-sim-apl.mjs --check    # is the committed snapshot stale? exit 1 if so
//   node scripts/build-sim-apl.mjs --spec=elemental
//
// Every rotation section in this repository is drawn from a ladder in `src/specs/<spec>/lib/apl.ts`, and
// every one of those ladders was written by hand from a wowsims APL. That is a copy of somebody else's
// list living in a different repository on a different release cycle, which is a thing that goes stale
// without anybody noticing — the rotation still renders, the tests still pass, and it is simply wrong.
//
// This is the alarm. It flattens each spec's APLs to the sequence of casts they attempt, commits that
// beside the spell map, and a scheduled job opens a pull request when it moves. What lands in the diff is
// *the sim's* list; updating the ladder and its prose stays a person's job, because the reason a rung
// exists is not in the JSON.
//
// ------------------------------------------------------------------ it mirrors build-spell-map.mjs
//
// Same repository, same pinning: resolve `master` to a sha, fetch raw at that sha, record it. Two derived
// files from one upstream should not disagree about which commit they came from, and pinning is what makes
// a refresh reproducible rather than "whatever master was that afternoon".
//
// The one difference is that `--check` here has to reach the network. The reference table's `--check`
// compares a committed table against local evidence; this compares a committed snapshot against a remote
// branch, and there is no local copy of that to consult.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { registeredSpecs } from './build-reference-tables.mjs';
import { aplDirFor, driftOf, normaliseApl, spellsOf } from './sim-apl.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'src/generated/sim-apl.json');
const SPELLS = resolve(ROOT, 'src/generated/spells.json');

const REPO = 'wowsims/mop';
const BRANCH = 'master';
const COMMIT_API = `https://api.github.com/repos/${REPO}/commits/${BRANCH}`;
const CONTENTS_API = (dir, sha) => `https://api.github.com/repos/${REPO}/contents/${dir}?ref=${sha}`;
const RAW = (sha, path) => `https://raw.githubusercontent.com/${REPO}/${sha}/${path}`;

/**
 * `GITHUB_TOKEN` when there is one, and nothing when there is not.
 *
 * Unauthenticated the API allows 60 requests an hour, which is enough for the dozen or so this makes but
 * is shared with everything else on the runner's IP. In Actions the token lifts it to 1,000 and costs
 * nothing. It is a header rather than a URL parameter, so it never lands in a log line.
 */
function headers() {
	const token = process.env.GITHUB_TOKEN;
	return {
		'User-Agent': 'windwalker-analyzer/1.0',
		Accept: 'application/vnd.github+json',
		...(token === undefined || token === '' ? {} : { Authorization: `Bearer ${token}` }),
	};
}

async function fetchJson(url) {
	const response = await fetch(url, { headers: headers() });
	if (!response.ok) throw new Error(`${response.status} from ${url.replace(/\?.*$/, '')}`);
	return response.json();
}

/** Spell names, for a snapshot a person can read in a diff. Absent is fine; ids still compare. */
function spellNames() {
	if (!existsSync(SPELLS)) return {};
	return JSON.parse(readFileSync(SPELLS, 'utf8')).spells ?? {};
}

/**
 * Every APL a spec has on the branch, flattened.
 *
 * **The directory is listed rather than assumed.** Guessing `default.apl.json` would have been wrong on
 * the first spec it was tried against: `wowsims/mop@master` carries no default for the Protection paladin,
 * only `horridon`, `iron_juggernaut` and `sha`. A spec with no APLs at all returns an empty set and says
 * so, which is a fact about the sim rather than a failure here.
 */
async function filesFor(spec, sha) {
	const dir = aplDirFor(spec);
	let listing;
	try {
		listing = await fetchJson(CONTENTS_API(dir, sha));
	} catch (error) {
		return { dir, files: {}, note: `no APL directory at ${dir} (${error.message})` };
	}
	const names = listing.filter((entry) => entry.name.endsWith('.apl.json')).map((entry) => entry.name);
	const files = {};
	for (const name of names.sort()) {
		const response = await fetch(RAW(sha, `${dir}/${name}`), { headers: headers() });
		if (!response.ok) throw new Error(`${response.status} fetching ${dir}/${name}`);
		files[name] = normaliseApl(await response.json());
	}
	return { dir, files };
}

async function snapshot(specs) {
	const head = await fetchJson(COMMIT_API);
	const sha = head.sha;
	const out = {
		source: { repo: REPO, branch: BRANCH, commit: sha, committed: head.commit?.committer?.date ?? null },
		specs: {},
	};
	for (const spec of specs) {
		out.specs[spec.key] = await filesFor(spec, sha);
	}
	return out;
}

/**
 * One line per spec, and nothing per cast.
 *
 * Same budget as the reference harness and for the same reason: this is read by agents as often as by
 * people, and an APL flattens to dozens of rows that nobody needs printed to know whether it moved.
 */
function printSnapshot(snap) {
	const names = spellNames();
	for (const [key, spec] of Object.entries(snap.specs)) {
		const files = Object.keys(spec.files);
		if (files.length === 0) {
			console.log(`${key} none — ${spec.note ?? `nothing under ${spec.dir}`}`);
			continue;
		}
		const spells = new Set(files.flatMap((name) => spellsOf(spec.files[name])));
		const sample = [...spells]
			.slice(0, 3)
			.map((id) => names[String(id)]?.name ?? id)
			.join(', ');
		console.log(`${key} ${files.length} file(s): ${files.join(' ')} · ${spells.size} spell(s) e.g. ${sample}`);
	}
}

async function main() {
	const args = process.argv.slice(2);
	const only = args.find((a) => a.startsWith('--spec='))?.slice('--spec='.length);
	const specs = registeredSpecs().filter((s) => only === undefined || s.key === only);
	if (specs.length === 0) throw new Error(`no registered spec named ${only}`);

	const committed = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { specs: {} };
	const fresh = await snapshot(specs);

	if (args.includes('--check')) {
		const drifted = driftOf(committed, fresh);
		console.log(`${REPO}@${BRANCH} is ${fresh.source.commit.slice(0, 12)}`);
		if (drifted.length === 0) return;
		console.log(`${drifted.length} change(s) since the committed snapshot:`);
		for (const line of drifted) console.log(`  ${line}`);
		process.exitCode = 1;
		return;
	}

	// A one-spec refresh keeps every spec it did not look at, the same way the reference table does — and
	// for the same reason, which is that the sharp version of this deleted two specs' rows once already.
	const merged = { ...fresh, specs: { ...committed.specs, ...fresh.specs } };
	writeFileSync(OUT, `${JSON.stringify(merged, null, '\t')}\n`);
	printSnapshot(merged);
	console.log(`${REPO}@${fresh.source.commit.slice(0, 12)} · ${OUT}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await main().catch((error) => {
		console.error(String(error.message ?? error));
		process.exitCode = 1;
	});
}

export { OUT, REPO, BRANCH };
