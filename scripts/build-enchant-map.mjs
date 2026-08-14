// Builds src/generated/enchants.json: the enchant id a combat log reports, mapped to the icon,
// name and spell id needed to draw it and link it.
//
// WarcraftLogs gives `permanentEnchant` as an *effect* id — 4419 — and nothing else. That is enough
// to know a slot is enchanted and nothing more: no name, no icon, no page to link to. The mapping
// from effect id to those three things is what this script bakes in.
//
// The source is the wowsims-mop simulator's own database, which is this project's source of truth
// for everything else about the game as well. It is read from a local checkout rather than the
// network because there is no published endpoint for it, so regenerating needs one:
//
//   WOWSIMS=../wowsims-mop node scripts/build-enchant-map.mjs
//
// The output is committed. A build must not need a wowsims checkout, and 255 enchants is a few
// kilobytes — the same trade the spell icon map makes.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sim = process.env.WOWSIMS ?? resolve(here, '../../wowsims-mop');
const source = resolve(sim, 'assets/database/db.json');

let db;
try {
	db = JSON.parse(readFileSync(source, 'utf8'));
} catch (cause) {
	console.error(`Could not read the simulator database at ${source}.`);
	console.error(
		'Point WOWSIMS at a wowsims-mop checkout, e.g. WOWSIMS=../wowsims-mop node scripts/build-enchant-map.mjs',
	);
	throw cause;
}

const out = {};
for (const enchant of db.enchants ?? []) {
	const effectId = Number(enchant.effectId ?? 0);
	// Without an effect id there is nothing to look up by: the log only ever reports that number.
	if (effectId === 0) continue;
	out[effectId] = {
		name: enchant.name ?? '',
		// The db stores icon names without the extension, matching what the icon CDN wants.
		icon: enchant.icon ?? '',
		// Wowhead has a page per enchanting *spell*; the effect id is not addressable there.
		spellId: Number(enchant.spellId ?? 0),
	};
}

const target = resolve(here, '../src/generated/enchants.json');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify(out, null, '\t')}\n`);

const linkable = Object.values(out).filter((e) => e.spellId > 0).length;
console.log(`Wrote ${Object.keys(out).length} enchants to ${target} (${linkable} with a Wowhead spell page).`);
