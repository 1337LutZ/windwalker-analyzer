// Resolves spell ids to Wowhead icon names, once, and writes them into the repo.
//
// Run: node scripts/fetch-spell-icons.mjs
//
// Deliberately a build-time step rather than a runtime lookup. The page then makes no API call to
// Wowhead at all — it only loads images from `wow.zamimg.com`, which is the third-party exposure the
// project accepted. Doing it at runtime would add a request per spell, on every report, from every
// visitor's browser, and would have to survive CORS and a rate limit besides.
//
// The `mop-classic` tooltip path is the one that matters: the retail path answers for most of these
// ids too, but with the modern spell's icon, and several monk abilities were re-arted after 5.4.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'src/generated/spell-icons.json');
const ENDPOINT = (id) => `https://nether.wowhead.com/mop-classic/tooltip/spell/${id}?locale=0`;

/** Every numeric id the spec model names, however it names it. */
function idsFromSpec() {
	const source = readFileSync(resolve(ROOT, 'src/lib/spec/windwalker.ts'), 'utf8');
	const ids = new Set();
	for (const block of source.matchAll(/(?:castIds|damageIds|ids):\s*\[([^\]]*)\]/g)) {
		for (const n of block[1].matchAll(/\d+/g)) ids.add(Number(n[0]));
	}
	// `EXTRA_NAMES` is a flat id → name map of the passives and trinket procs the report lists.
	const extras = source.match(/const EXTRA_NAMES[^{]*\{([\s\S]*?)\n\};/);
	if (extras) for (const n of extras[1].matchAll(/^\s*(\d+):/gm)) ids.add(Number(n[1]));
	// The raid-buff roster lives outside the spec model — it is other classes' spells, not the monk's
	// — and its rows draw an icon like every other, so its provider ids have to be resolved too.
	const raidBuffs = readFileSync(resolve(ROOT, 'src/lib/analysis/raidBuffs.ts'), 'utf8');
	for (const n of raidBuffs.matchAll(/\b(?:id|iconId):\s*(\d+)/g)) ids.add(Number(n[1]));
	return ids;
}

/** Whatever the captured fixtures actually contain, so real logs are covered as well as the model. */
function idsFromFixtures() {
	const ids = new Set();
	for (const name of ['strong', 'mixed', 'poor']) {
		const path = resolve(ROOT, `src/lib/__fixtures__/${name}.json`);
		let analysis;
		try {
			analysis = JSON.parse(readFileSync(path, 'utf8'));
		} catch {
			continue;
		}
		for (const row of analysis.damage?.abilities ?? []) ids.add(row.id);
		for (const row of analysis.casts ?? []) ids.add(row.id);
	}
	return ids;
}

/**
 * Ids Wowhead cannot answer for or answers wrongly, and ids neither source above collects.
 *
 * `1` is melee: WarcraftLogs logs every auto-attack under it, but it is not a spell anyone can look
 * up — Wowhead's spell 1 is an unrelated engineering entry, and the lookup below dutifully returned
 * its icon. An override rather than a hand-edit of the generated file, so a regeneration keeps it.
 *
 * Zen Sphere and Chi Burst are the second kind. The rotation section draws Chi Wave's whole talent
 * row as a fork, so it names two abilities the spec model has no reason to know and no captured log
 * ever contains — neither `idsFromSpec` nor `idsFromFixtures` can reach them, and without a line
 * here the two branches beside Chi Wave would be the only cards on the page with no icon.
 */
const OVERRIDES = {
	1: 'inv_sword_04',
	123986: 'spell_arcane_arcanetorrent',
	124081: 'ability_monk_forcesphere',
};

const ids = [...new Set([...idsFromSpec(), ...idsFromFixtures()])].filter((id) => id > 0).sort((a, b) => a - b);
console.log(`resolving ${ids.length} spell ids`);

let known = {};
try {
	known = JSON.parse(readFileSync(OUT, 'utf8'));
} catch {
	// First run.
}

// Overrides win over anything already on disk, so correcting one means editing this file rather
// than remembering to delete a line from the output first.
const icons = { ...known, ...Object.fromEntries(Object.entries(OVERRIDES).map(([id, icon]) => [String(id), icon])) };
let fetched = 0;
let missing = 0;

for (const id of ids) {
	if (icons[String(id)]) continue;
	try {
		const response = await fetch(ENDPOINT(id), { headers: { 'User-Agent': 'windwalker-analyzer/1.0' } });
		const payload = await response.json();
		if (typeof payload?.icon === 'string' && payload.icon !== '') {
			icons[String(id)] = payload.icon;
			fetched += 1;
		} else {
			missing += 1;
			console.log(`  no icon for ${id}${payload?.error ? ` (${payload.error})` : ''}`);
		}
	} catch (cause) {
		missing += 1;
		console.log(`  failed ${id}: ${cause.message}`);
	}
	// Wowhead is doing us a favour; do not hammer it.
	await new Promise((done) => setTimeout(done, 120));
}

const sorted = Object.fromEntries(
	Object.keys(icons)
		.sort((a, b) => Number(a) - Number(b))
		.map((k) => [k, icons[k]]),
);
writeFileSync(OUT, `${JSON.stringify(sorted, null, '\t')}\n`);
console.log(
	`wrote ${Object.keys(sorted).length} icons to src/generated/spell-icons.json (${fetched} new, ${missing} unresolved)`,
);
