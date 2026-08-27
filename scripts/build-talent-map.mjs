// Builds src/generated/talents.json: every class's talent tree, six rows of three, with the spell id
// and the name each choice logs under.
//
//   node scripts/build-talent-map.mjs            # resolve against the latest wowsims-mop tree
//   node scripts/build-talent-map.mjs --check    # is the committed map behind upstream? (no download)
//   WOWSIMS=../wowsims-mop node scripts/build-talent-map.mjs   # use a local checkout instead
//
// The source is `ui/core/talents/trees/<class>.json` in wowsims-mop, which is the simulator's own
// talent picker data: `{ fieldName, fancyName, location: { rowIdx, colIdx }, spellId }` per choice.
// It is the right source for the same reason `build-spell-map.mjs` reads that repo's database — it is
// maintained against 5.4 by people running the numbers — and it is a far better one than the spell map
// for this particular question, because it carries the *tree*: which choices sit on a row together,
// including the ones nobody in a given log picked.
//
// **That last part is why this file exists at all.** `generated/spells.json` is built from what the sim
// and the logs reference, so it names ten of the monk's eighteen talents and has never heard of
// Celerity, Momentum, Power Strikes, Ascension, Charging Ox Wave, Healing Elixirs, Chi Torpedo or Ring
// of Peace. A page that draws a talent *tree* needs all eighteen, and the alternative to this
// generator was writing them out from memory — the kind of unverifiable claim this repository refuses
// everywhere else.
//
// Committed rather than fetched at build time, for `build-spell-map.mjs`'s reasons: `npm run build`
// must never reach the network, and a committed map makes upstream drift reviewable — a renamed talent
// or a moved row arrives as a diff in a pull request rather than silently changing what the page says.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'src/generated/talents.json');

const REPO = 'wowsims/mop';
const TREE_DIR = 'ui/core/talents/trees';
const DB_PATH = 'assets/database/db.json';
const COMMIT_API = `https://api.github.com/repos/${REPO}/commits/master`;
const RAW = (sha, file) => `https://raw.githubusercontent.com/${REPO}/${sha}/${TREE_DIR}/${file}`;
const RAW_DB = (sha) => `https://raw.githubusercontent.com/${REPO}/${sha}/${DB_PATH}`;

/** The classes the simulator carries a tree for. Every one is emitted: eleven trees is under 10KB. */
const CLASSES = [
	'death_knight',
	'druid',
	'hunter',
	'mage',
	'monk',
	'paladin',
	'priest',
	'rogue',
	'shaman',
	'warlock',
	'warrior',
];

/** `death_knight` upstream, `deathknight` in a URL and in this app — one spelling, decided here. */
const slugOf = (file) => file.replace(/_/g, '');

/**
 * The icon each talent draws, from the same database `build-spell-map.mjs` reads.
 *
 * The tree files carry a name and a spell id and no icon, and `generated/spells.json` has never heard
 * of eight of the monk's eighteen — it is built from what the sim and the logs *reference*, and nobody
 * references a talent they did not take. The database's `spellIcons` covers all of them, so the icon
 * comes from there rather than from a second network source or from nothing at all.
 */
async function readIcons(local, sha) {
	const db =
		local !== undefined
			? JSON.parse(readFileSync(resolve(local, DB_PATH), 'utf8'))
			: await (await fetch(RAW_DB(sha))).json();
	return new Map((db.spellIcons ?? []).map((spell) => [spell.id, spell.icon]));
}

async function readTree(file, local, sha) {
	if (local !== undefined) {
		const path = resolve(local, TREE_DIR, `${file}.json`);
		if (!existsSync(path)) throw new Error(`no ${path} — is WOWSIMS pointing at a wowsims-mop checkout?`);
		return JSON.parse(readFileSync(path, 'utf8'));
	}
	const response = await fetch(RAW(sha, `${file}.json`));
	if (!response.ok) throw new Error(`${file}.json: HTTP ${response.status}`);
	return response.json();
}

/**
 * One tree, as rows of choices.
 *
 * Laid out by the `location` the source gives rather than by array order, because the array's order is
 * the picker's business and a row that quietly arrived out of order would put a talent on the wrong
 * tier with nothing to show for it. A hole is left as `null` rather than closed up: a row with two
 * entries where the game has three is a tree this file got wrong, and it should look wrong.
 */
function rowsOf(tree, file, icons) {
	const rows = [];
	for (const talent of tree.talents ?? []) {
		const { rowIdx, colIdx } = talent.location ?? {};
		if (typeof rowIdx !== 'number' || typeof colIdx !== 'number') {
			throw new Error(`${file}: a talent has no location — ${JSON.stringify(talent).slice(0, 80)}`);
		}
		rows[rowIdx] ??= [null, null, null];
		// An icon the database does not carry is left off rather than faked; the cell draws its name.
		const icon = icons.get(talent.spellId);
		rows[rowIdx][colIdx] = {
			id: talent.spellId,
			name: talent.fancyName,
			...(icon === undefined ? {} : { icon }),
		};
	}
	const holes = rows.flatMap((row, at) => (row.includes(null) ? [at] : []));
	if (holes.length > 0) throw new Error(`${file}: row(s) ${holes.join(', ')} have a gap`);
	return rows;
}

const argv = process.argv.slice(2);
const check = argv.includes('--check');
const local = process.env.WOWSIMS === undefined ? undefined : resolve(process.env.WOWSIMS);

let sha = 'local';
if (local === undefined) {
	const commit = await fetch(COMMIT_API, { headers: { accept: 'application/vnd.github+json' } });
	if (!commit.ok) throw new Error(`GitHub commit API: HTTP ${commit.status}`);
	sha = (await commit.json()).sha;
}

const talents = {};
const icons = await readIcons(local, sha);
for (const file of CLASSES) talents[slugOf(file)] = rowsOf(await readTree(file, local, sha), file, icons);

const built = {
	source: { repo: REPO, path: TREE_DIR, commit: sha },
	talents,
};

const before = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;
const same = before !== null && JSON.stringify(before.talents) === JSON.stringify(built.talents);

if (check) {
	console.log(same ? 'talents.json is up to date' : 'talents.json is BEHIND upstream — re-run without --check');
	process.exit(same ? 0 : 1);
}

writeFileSync(OUT, `${JSON.stringify(built, null, '\t')}\n`);
const rows = Object.values(talents).reduce((count, tree) => count + tree.length, 0);
console.log(`wrote ${Object.keys(talents).length} trees, ${rows} rows${same ? ' (unchanged)' : ''}`);
