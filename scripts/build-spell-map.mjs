// Builds src/generated/spells.json: every spell id the report can draw or name, mapped to its name
// and its icon.
//
//   node scripts/build-spell-map.mjs            # resolve against the latest wowsims-mop database
//   node scripts/build-spell-map.mjs --check    # is the committed map behind upstream? (no download)
//   WOWSIMS=../wowsims-mop node scripts/build-spell-map.mjs   # use a local checkout instead
//
// The primary source is the wowsims-mop simulator's own database, the same one `build-enchant-map.mjs`
// reads. It is the project's source of truth for the game because it is maintained against 5.4 by
// people running the numbers, and it carries `spellIcons` records of exactly the shape wanted:
// `{ id, name, icon }`.
//
// It is not, however, a dictionary of every spell in the game — it holds the spells the *simulator*
// models, which is roughly 40% of what a real log throws at this report. A combat log also contains
// utility buttons nobody sims (Transcendence, Zen Meditation, Detox), boss abilities, and other
// classes' raid buffs. Wowhead's `mop-classic` tooltip endpoint answers for those, so it stays as a
// top-up for the ids the database does not model rather than as the primary source it used to be.
//
// Both are build-time. The page makes no call to either: it only loads images from `wow.zamimg.com`,
// which is the third-party exposure the project accepted. Resolving at runtime would mean a request
// per spell, per report, from every visitor's browser, and would have to survive CORS and a rate limit
// besides.
//
// WHY the output is committed rather than fetched during a build: `npm run build` must never reach the
// network. The site deploys from GitHub Actions to Cloudflare Pages, and a build that downloaded an
// 8 MB database could fail for reasons having nothing to do with the change being deployed. Committing
// the derived map also makes upstream drift *reviewable* — regenerating produces a diff, so a renamed
// spell or a dropped id shows up in a pull request instead of silently changing what the page says.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'src/generated/spells.json');
const TOOLTIP = (id) => `https://nether.wowhead.com/mop-classic/tooltip/spell/${id}?locale=0`;

const REPO = 'wowsims/mop';
const DB_PATH = 'assets/database/db.json';
const COMMIT_API = `https://api.github.com/repos/${REPO}/commits/master`;
const RAW_DB = (sha) => `https://raw.githubusercontent.com/${REPO}/${sha}/${DB_PATH}`;

// ------------------------------------------------------------------ id discovery
//
// UNCHANGED from when this script only fetched icons. Ids are discovered from the spec model and the
// captured fixtures, so adding an ability to `windwalker.ts` is enough to get it an icon and a name —
// nothing here has to be edited by hand. Several things depend on that automatic pickup.

/** Every numeric id the spec model names, however it names it. */
function idsFromSpec() {
	const ids = new Set();
	// The spec models live one directory per spec (`src/specs/<key>/lib`); every one is read, so a
	// new spec gets its icons without a hand-edited list. `readdirSync` on the spec root rather than a
	// fixed pair of files — the two current specs already drifted apart once when the monk moved out of
	// `lib/spec` and this collector kept pointing at the old path.
	for (const spec of readdirSync(resolve(ROOT, 'src/specs')).filter((d) => !d.startsWith('.'))) {
		const lib = resolve(ROOT, 'src/specs', spec, 'lib');
		let files;
		try {
			files = readdirSync(lib).filter((f) => f.endsWith('.ts'));
		} catch {
			continue;
		}
		for (const file of files) {
			const source = readFileSync(resolve(lib, file), 'utf8');
			for (const block of source.matchAll(/(?:castIds|damageIds|ids):\s*\[([^\]]*)\]/g)) {
				for (const n of block[1].matchAll(/\d+/g)) ids.add(Number(n[0]));
			}
			// `EXTRA_NAMES` is a flat id → name map of the passives and trinket procs the report lists.
			const extras = source.match(/const EXTRA_NAMES[^{]*\{([\s\S]*?)\n\};/);
			if (extras) for (const n of extras[1].matchAll(/^\s*(\d+):/gm)) ids.add(Number(n[1]));
		}
	}
	// The raid-buff roster lives outside the spec model — it is other classes' spells, not the monk's
	// — and its rows draw an icon like every other, so its provider ids have to be resolved too.
	const raidBuffs = readFileSync(resolve(ROOT, 'src/lib/analysis/raidBuffs.ts'), 'utf8');
	for (const n of raidBuffs.matchAll(/\b(?:id|iconId):\s*(\d+)/g)) ids.add(Number(n[1]));
	// The shared game objects (flasks, elixirs, racials, item-effect trinkets) also live outside the
	// spec directory, in `src/lib/game/shared.ts` — their cast/buff ids draw icons like any other.
	const shared = readFileSync(resolve(ROOT, 'src/lib/game/shared.ts'), 'utf8');
	for (const block of shared.matchAll(/(?:castIds|ids):\s*\[([^\]]*)\]/g)) {
		for (const n of block[1].matchAll(/\d+/g)) ids.add(Number(n[0]));
	}
	return ids;
}

/**
 * Whatever the captured fixtures actually contain, so real logs are covered as well as the model.
 *
 * Every `.json` in the fixture directory, read rather than a list of three names written out here.
 * The list was the three fixtures that existed when this was written, and `waves`, `cleave` and
 * `weave` were captured later without anyone thinking to extend it — so three real logs' worth of ids
 * were being discovered from nowhere, and Blood Fury and the weaved elixirs drew no icon because of
 * it. Reading the directory is what the docstring already promised, and it cannot go stale again.
 *
 * A file that is not an analysis simply contributes nothing: the `catch` skips anything unparseable
 * and the field reads below skip anything shaped differently.
 */
function idsFromFixtures() {
	const ids = new Set();
	// Fixtures live per spec now (`src/specs/<key>/__fixtures__`), not in one shared directory.
	for (const spec of readdirSync(resolve(ROOT, 'src/specs')).filter((d) => !d.startsWith('.'))) {
		const dir = resolve(ROOT, 'src/specs', spec, '__fixtures__');
		let files;
		try {
			files = readdirSync(dir)
				.filter((f) => f.endsWith('.json'))
				.sort();
		} catch {
			continue;
		}
		for (const file of files) {
			let analysis;
			try {
				analysis = JSON.parse(readFileSync(resolve(dir, file), 'utf8'));
			} catch {
				continue;
			}
			for (const row of analysis.damage?.abilities ?? []) ids.add(row.id);
			for (const row of analysis.casts ?? []) ids.add(row.id);
			// Deaths name the boss ability that landed the killing blow, and `nameOf` is what renders it.
			for (const death of analysis.timeline?.deaths ?? []) if (death.abilityId) ids.add(death.abilityId);
			// A raw capture, which is the other shape a fixture ships in. Windwalker commits analyses;
			// Protection and Elemental commit the event stream a report is built from, and none of the
			// three reads above finds anything in one — so five Protection fixtures and four Elemental
			// ones were contributing no ids at all. Divine Shield and Hand of Protection are how that
			// surfaced: pressed on every one of those pulls, and drawn at a reader as `#642` and `#1022`.
			//
			// Only the captured actor's own events, which is the same line `ELEMENTAL_LOG_IDS` was
			// measured along. A raid's whole stream carries 260 ids on these five pulls against 70 for
			// the player, and the other 190 are other people's buffs and the boss's own script — spells
			// no report of this player will ever draw an icon for, each costing a Wowhead call and a
			// permanent entry in the map.
			const actor = analysis.actor?.id;
			if (Array.isArray(analysis.events) && typeof actor === 'number') {
				for (const event of analysis.events) {
					if (event.sourceID === actor && typeof event.abilityGameID === 'number') ids.add(event.abilityGameID);
				}
			}
		}
	}
	return ids;
}

/**
 * Ids the report draws that neither discovery function can reach.
 *
 * The rotation section draws Chi Wave's whole talent row as a fork, so it names two abilities the spec
 * model has no reason to know and no captured log ever contains. Without them listed here the two
 * branches beside Chi Wave would be the only cards on the page with no icon.
 *
 * Lifeblood (121279) and Dampen Harm (122278) are here for the opposite reason: a monk presses both,
 * the cast timeline draws both, and neither is anything the spec model has cause to carry — Lifeblood
 * is the herbalism on-use and Dampen Harm is a defensive talent, so neither is scored and neither is
 * kit the rotation arbitrates. No captured fixture holds them either, which is the whole difficulty:
 * they are ordinary buttons that simply did not happen in the six pulls that got captured. Both are
 * in the reference logs, counted from the monk's own casts and nobody else's: 34 Lifeblood and 12
 * Dampen Harm across a:LhYtyq8xFR9pG6mg, and 8 Dampen Harm across a:YBQzrcgVJnAj7NMP. So this is a
 * measurement rather than a guess about what someone might press. Listing them costs two entries and
 * stops the timeline drawing a bare tick where a real press went out.
 *
 * These are seeds, not answers: they only add the id to the work list, and the sources below resolve
 * it like any other. All four happen to be modelled in `db.spellIcons`, so the database supplies the
 * name and icon that used to be hardcoded.
 */
const SEED_IDS = [121279, 122278, 123986, 124081];

/**
 * Ids the Elemental spec sees on a real pull that its own model does not carry: other classes' raid
 * buffs and trinket procs, the player's own trinkets and tier bonuses, and the boss abilities that
 * land the killing blow. Captured from a:9XYKBd34HLVqQA8D fight 4 source 26 — the calibration pull
 * — so this is a measurement of what actually appears, not a guess. Until the Elemental spec commits
 * its own fixtures (which `idsFromFixtures` would then pick up), this list is what gives those rows a
 * name and an icon.
 */
const ELEMENTAL_LOG_IDS = [
	421, 774, 974, 21562, 30823, 31821, 44203, 47753, 48438, 52042, 52752, 54861, 73683, 73921, 76577, 77451, 79206,
	80354, 81269, 81751, 81782, 82327, 86273, 94472, 96230, 97463, 104993, 105284, 108281, 110745, 114050, 114074, 114083,
	114163, 114738, 114908, 114911, 114942, 115798, 118291, 119523, 119952, 120676, 121129, 124988, 125487, 142912,
	143023, 143198, 143423, 143424, 143493, 143559, 143564, 143962, 144176, 144397, 144876, 145000, 145002, 145110,
	146046, 146071, 146177, 146198, 148008, 148009, 148235, 148906,
];

/**
 * The shaman's own utility and healing buttons, pressed on a real pull but never modelled.
 *
 * The sim is a DPS sim: it carries no heal, no travel form, no defensive, no totem that does not
 * deal damage. They are not rotation, so the spec model has no cause to carry them — but a reader
 * who cast Chain Heal through a transition still expects the timeline to name and icon it rather
 * than print a bare `#1064`. Captured from rpM9JRABYcvPFbjL and KdCjcnAZm8wrqXGk, the two reports the
 * Elemental timeline has been read against, so this is a measurement, not a guess. The database
 * answers for the totems it does model (Astral Shift, Windwalk, Magma, Mana Tide, Earthgrab); the
 * heals, the shields, the travel form and the engineering toy fall to Wowhead.
 */
const ELEMENTAL_UTILITY_IDS = [
	1064, 2645, 5394, 8004, 8177, 8190, 16190, 51485, 52127, 61295, 73920, 77472, 108271, 108273, 108280, 108287, 126389,
	146364,
];

/**
 * Ids no source can answer correctly, with the answer to use instead.
 *
 * `1` is melee: WarcraftLogs logs every auto-attack under it, but it is not a spell anyone can look
 * up — Wowhead's spell 1 is an unrelated engineering entry, and the lookup below dutifully returned
 * its icon. An override rather than a hand-edit of the generated file, so a regeneration keeps it.
 *
 * Elemental Overload casts the same spell a second time at reduced damage, and the duplicate carries
 * its own spell id. Three of those ids (45294, 45296, 114991) Wowhead cannot answer at all, and one
 * (118523) it answers wrongly — the lookup returned Siphoning Shield, an engineering trinket, where
 * the Elemental Blast overload was asked for. The overload *is* the base spell, so it wears the base
 * spell's icon; the name here matches `EXTRA_NAMES`, which is what the report actually prints.
 */
const OVERRIDES = {
	1: { name: 'Melee', icon: 'inv_sword_04' },
	45284: { name: 'Elemental Overload (Lightning Bolt)', icon: 'spell_nature_lightning' },
	45294: { name: 'Elemental Overload (Flame Shock)', icon: 'spell_fire_flameshock' },
	45296: { name: 'Elemental Overload (Earth Shock)', icon: 'spell_nature_earthshock' },
	45297: { name: 'Elemental Overload (Chain Lightning)', icon: 'spell_nature_chainlightning' },
	114991: { name: 'Elemental Overload (Lava Beam)', icon: 'spell_fire_soulburn' },
	118523: { name: 'Elemental Overload (Elemental Blast)', icon: 'shaman_talent_elementalblast' },
};

// ------------------------------------------------------------------ the simulator database

async function fetchJson(url) {
	const response = await fetch(url, { headers: { 'User-Agent': 'windwalker-analyzer/1.0' } });
	if (!response.ok) throw new Error(`${url} answered ${response.status}`);
	return response.json();
}

/**
 * The database, and the exact upstream commit it came from.
 *
 * Resolving `master` to a concrete sha before downloading is what makes a run reproducible after the
 * fact: the sha goes into the output, so "which database said this?" is answerable from the committed
 * file alone, without re-running anything.
 */
async function loadDatabase() {
	const local = process.env.WOWSIMS;
	if (local !== undefined) {
		const path = resolve(local, DB_PATH);
		// A checkout is a developer's convenience and a developer's path — fine to read from, but its
		// sha has to be recorded the same way so the output does not claim more provenance than it has.
		let sha = 'local';
		let committed = null;
		try {
			sha = execFileSync('git', ['-C', local, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
			committed = execFileSync('git', ['-C', local, 'log', '-1', '--format=%cI'], { encoding: 'utf8' }).trim();
		} catch {
			// Not a git checkout. The database still reads; the provenance is just weaker.
		}
		console.log(`reading ${path} (${sha.slice(0, 12)})`);
		return { db: JSON.parse(readFileSync(path, 'utf8')), sha, committed };
	}

	console.log(`resolving ${REPO}@master`);
	const head = await fetchJson(COMMIT_API);
	const sha = head.sha;
	const committed = head.commit?.committer?.date ?? null;
	console.log(`downloading ${DB_PATH} at ${sha.slice(0, 12)} (~8 MB)`);
	const response = await fetch(RAW_DB(sha));
	if (!response.ok) throw new Error(`${RAW_DB(sha)} answered ${response.status}`);
	return { db: JSON.parse(await response.text()), sha, committed };
}

/**
 * The commit date as a canonical UTC instant.
 *
 * Both sources report the same moment in different notations — the GitHub API in UTC, `git log %cI` in
 * the committer's local offset — and left alone that made the output depend on *how* the database was
 * read rather than on what it said. Normalising keeps the file byte-identical whichever path produced
 * it, which is the property that makes a regeneration diff mean something.
 */
function asUtc(value) {
	if (typeof value !== 'string' || value === '') return null;
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function readExisting() {
	try {
		return JSON.parse(readFileSync(OUT, 'utf8'));
	} catch {
		return { source: {}, spells: {} };
	}
}

// ------------------------------------------------------------------ staleness
//
// Reported, never applied. A script that silently re-resolved during a build would let the report's
// spell names change with no commit behind them, and the first anyone knew of it would be a reader
// seeing a different name. One API call, no download.

if (process.argv.includes('--check')) {
	const existing = readExisting();
	const pinned = existing.source?.commit;
	const head = await fetchJson(COMMIT_API);
	if (pinned === head.sha) {
		console.log(`up to date with ${REPO}@${head.sha.slice(0, 12)}`);
		process.exit(0);
	}

	// How far behind is a nicety; that the shas differ is the finding. The comparison 404s whenever the
	// recorded commit is not reachable from upstream — a map built from a local checkout records
	// `local`, and a force-push orphans a real sha — and a staleness check that crashes is worse than
	// one that reports the two shas and lets a human judge.
	let distance = null;
	try {
		distance = (await fetchJson(`https://api.github.com/repos/${REPO}/compare/${pinned}...${head.sha}`)).ahead_by;
	} catch {
		// Left null; the shas below still say everything that matters.
	}
	console.log(distance === null ? 'out of date' : `behind by ${distance} commits`);
	console.log(`  committed map: ${pinned ?? '(none)'}`);
	console.log(`  upstream head: ${head.sha}`);
	console.log('run `node scripts/build-spell-map.mjs` to refresh, and review the diff');
	process.exit(0);
}

// ------------------------------------------------------------------ build

const ids = [
	...new Set([
		...idsFromSpec(),
		...idsFromFixtures(),
		...SEED_IDS,
		...ELEMENTAL_LOG_IDS,
		...ELEMENTAL_UTILITY_IDS,
		...Object.keys(OVERRIDES).map(Number),
	]),
]
	.filter((id) => id > 0)
	.sort((a, b) => a - b);
console.log(`resolving ${ids.length} spell ids`);

const { db, sha, committed } = await loadDatabase();

// Only `spellIcons` is read. The database also links items to the buffs they proc, via
// `items[].itemEffects[].buffId`, and that was tried: it names four more ids, but its icon is the
// *item's* — a trinket's picture, not the proc's — and all four are already named in `EXTRA_NAMES`.
// It resolved nothing this report was missing, so it is not worth the ambiguity of two icon kinds in
// one map.
const database = new Map((db.spellIcons ?? []).map((s) => [s.id, s]));

const existing = readExisting();
const spells = {};
let fromDatabase = 0;
let fromWowhead = 0;
let reused = 0;
let unresolved = 0;

for (const id of ids) {
	const override = OVERRIDES[id];
	if (override !== undefined) {
		spells[id] = override;
		continue;
	}

	// The database wins where it answers. It is the declared source of truth, and it is versioned —
	// an entry sourced here improves when upstream does, which is the whole point of the connection.
	const known = database.get(id);
	if (known !== undefined && known.icon) {
		spells[id] = { name: known.name ?? '', icon: known.icon };
		fromDatabase += 1;
		continue;
	}

	// Already resolved on a previous run. Kept rather than re-fetched so a regeneration is cheap and
	// so Wowhead is asked for each id exactly once, ever.
	const cached = existing.spells?.[id];
	if (cached !== undefined && cached.icon) {
		spells[id] = cached;
		reused += 1;
		continue;
	}

	try {
		const payload = await fetchJson(TOOLTIP(id));
		if (typeof payload?.icon === 'string' && payload.icon !== '') {
			// The name comes from the same payload the icon does. It always did — this script used to
			// throw it away, which is why the report rendered `#101643` for spells Wowhead could name.
			spells[id] = { name: typeof payload.name === 'string' ? payload.name : '', icon: payload.icon };
			fromWowhead += 1;
		} else {
			unresolved += 1;
			console.log(`  no icon for ${id}${payload?.error ? ` (${payload.error})` : ''}`);
		}
	} catch (cause) {
		unresolved += 1;
		console.log(`  failed ${id}: ${cause.message}`);
	}
	// Wowhead is doing us a favour; do not hammer it.
	await new Promise((done) => setTimeout(done, 120));
}

const sorted = Object.fromEntries(
	Object.keys(spells)
		.sort((a, b) => Number(a) - Number(b))
		.map((k) => [k, spells[k]]),
);

// No generation timestamp, deliberately: re-running against an unchanged upstream produces a
// byte-identical file, so `git diff` after a regeneration shows game data that moved and nothing else.
const output = {
	source: { repo: REPO, commit: sha, committed: asUtc(committed), fromDatabase, fromWowhead: fromWowhead + reused },
	spells: sorted,
};
writeFileSync(OUT, `${JSON.stringify(output, null, '\t')}\n`);

console.log(
	`wrote ${Object.keys(sorted).length} spells to src/generated/spells.json ` +
		`(${fromDatabase} from the database, ${fromWowhead} newly from Wowhead, ${reused} reused, ${unresolved} unresolved)`,
);
