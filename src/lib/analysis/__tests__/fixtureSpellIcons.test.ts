// Every spell a committed fixture would draw at a reader has a name and an icon in the generated map.
//
// **The same drift `raidBuffIcons.test.ts` was written for, on the other side of the map.** That one
// guards a hand-written declaration against the generated file; this guards the *fixtures* against it,
// and the two fail for opposite reasons. There the declaration moved. Here the discovery in
// `scripts/build-spell-map.mjs` could not read the fixture at all.
//
// A fixture ships in one of two shapes. Windwalker commits finished analyses, which the generator reads
// through `damage.abilities` and `casts`. Protection and Elemental commit the raw event stream a report
// is built from, and none of those fields exists in one — so five Protection fixtures and four Elemental
// ones were discovered as contributing nothing, and every button in them that the spec model does not
// carry was drawn as a bare number. Divine Shield and Hand of Protection went out on all five Protection
// pulls and reached the page as `#642` and `#1022`.
//
// Nothing failed, because nothing was checking. The report renders a number in place of an icon quite
// happily, and the two shapes had drifted for as long as Protection has had fixtures.

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { spellIconName, spellName } from '~/components/primitives/spellIcon';

const SPECS = resolve(process.cwd(), 'src/specs');

/**
 * The ids a fixture would put on screen, read the way the generator reads them.
 *
 * Deliberately a second implementation rather than an import: the script is a top-level-await module
 * with side effects and cannot be imported, and a guard that shared its discovery would agree with it
 * about a fixture neither of them can read. Two readings that must reach the same answer is the point.
 *
 * Only the captured actor's own events, matching the generator. A raid's whole stream carries every
 * other player's buffs and the boss's own script, none of which this player's report draws.
 */
function drawnIds(analysis: Record<string, unknown>): Set<number> {
	const ids = new Set<number>();
	const add = (id: unknown) => {
		if (typeof id === 'number' && id > 0) ids.add(id);
	};

	const damage = (analysis.damage as { abilities?: { id: number }[] } | undefined)?.abilities ?? [];
	for (const row of damage) add(row.id);
	for (const row of (analysis.casts as { id: number }[] | undefined) ?? []) add(row.id);
	const deaths = (analysis.timeline as { deaths?: { abilityId?: number }[] } | undefined)?.deaths ?? [];
	for (const death of deaths) add(death.abilityId);

	const actor = (analysis.actor as { id?: number } | undefined)?.id;
	const events = analysis.events as { sourceID?: number; abilityGameID?: number }[] | undefined;
	if (Array.isArray(events) && typeof actor === 'number') {
		for (const event of events) if (event.sourceID === actor) add(event.abilityGameID);
	}
	return ids;
}

function fixtures(): { spec: string; file: string; ids: Set<number> }[] {
	const found: { spec: string; file: string; ids: Set<number> }[] = [];
	for (const spec of readdirSync(SPECS).filter((entry) => !entry.startsWith('.'))) {
		const dir = resolve(SPECS, spec, '__fixtures__');
		let files: string[];
		try {
			files = readdirSync(dir).filter((file) => file.endsWith('.json'));
		} catch {
			continue;
		}
		for (const file of files) {
			found.push({ spec, file, ids: drawnIds(JSON.parse(readFileSync(resolve(dir, file), 'utf8'))) });
		}
	}
	return found;
}

const FIXTURES = fixtures();

describe('fixture spell icons', () => {
	it('reads ids out of both fixture shapes', () => {
		// Not vacuous, and the halves are asserted apart. One number over every fixture would stay green
		// with the raw ones contributing nothing, which is the exact state this was written to end.
		const empty = FIXTURES.filter((fixture) => fixture.ids.size === 0);
		expect(empty.map((fixture) => `${fixture.spec}/${fixture.file}`)).toEqual([]);
		expect(FIXTURES.length).toBeGreaterThan(10);
	});

	it('names and icons every spell a fixture would draw', () => {
		const missing = FIXTURES.flatMap((fixture) =>
			[...fixture.ids]
				.filter((id) => spellIconName(id) === null || spellName(id) === null)
				.map((id) => `${fixture.spec}/${fixture.file}: ${id}`),
		);
		// Named individually rather than counted, so a failure says which fixture and which id, and
		// `node scripts/build-spell-map.mjs` is the whole fix.
		expect(missing).toEqual([]);
	});

	it('holds the two ids that went out as bare numbers', () => {
		// Divine Shield and Hand of Protection, pressed on every Protection pull. The general case above
		// covers them; naming them keeps the reason this file exists legible after it goes green.
		expect(spellName(642)).toBe('Divine Shield');
		expect(spellName(1022)).toBe('Hand of Protection');
	});
});
