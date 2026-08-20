// Every press in a committed pull is either modelled or knowingly named — checked per spec, per
// fixture, against `analyse` output.
//
// This is the guard that was missing. Chain Lightning was not in the Elemental registry, and nothing
// anywhere said so: `castSeries` files an unmodelled id under `#<id>` and counts it, `buildCastTable`
// labels it off-GCD because that is the safe default for a trinket, and the core's GCD walk skips it
// entirely. So 70 presses of a filler were priced at zero occupied time, `gcdUtilisationPct` read
// 56.02% on a pull that filled 90.81% of its globals, `totalCpm` read 28.21 against a true on-GCD
// rate of 46.79, and 15.7% of the damage was reported as though no cast had produced it. Fifty-three
// Elemental tests were green throughout, because both committed fixtures were single-target Iron
// Juggernaut and neither contained one Chain Lightning.
//
// The failure was not that the default is wrong — it is right, and it stays. The failure was that a
// spec could lose a rotational button in silence. So the shared layer now insists that every id a
// committed pull actually presses has been *looked at* by the spec that owns it: modelled as an
// `Ability`, or listed in that spec's `extraNames` (or the shared raid-buff roster) as a press it
// knowingly does not price. There is no third state, and "nobody noticed" is no longer one.
//
// Deliberately driven from `analyse(dataset).casts` rather than from a hand-built id list. A guard
// that supplies its own input tests the assertion and not the engine: it would stay green while the
// path a real pull takes through the engine broke, which is exactly how a revert-check elsewhere in
// this branch came back green against a value nothing observed.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Analysis, FightDataset } from '~/lib/types';
import { unmodelledPresses } from '~/lib/analysis/casts';
import { RAID_BUFF_NAMES } from '~/lib/analysis/raidBuffs';
import { analyse as analyseElemental, ELEMENTAL_SPEC } from '~/specs/elemental';
import { analyse as analyseWindwalker, WW_SPEC } from '~/specs/windwalker';

/**
 * The specs to check, with the three things the question needs: what models an id, what names one it
 * does not model, and how to turn a dataset into an analysis.
 *
 * Named explicitly rather than mapped over `SPECS`, for the same reason `registry.test.ts` names them:
 * `SpecDefinition` carries no `extraNames`, and a guard about a spec's *declarations* has to read the
 * spec's own config. A third spec is one entry here, and the fixture discovery below needs no change.
 */
const SPECS = [
	{ dir: 'elemental', config: ELEMENTAL_SPEC, analyse: analyseElemental },
	{ dir: 'windwalker', config: WW_SPEC, analyse: analyseWindwalker },
] as const;

/**
 * The raw `FightDataset` fixtures under a spec, found rather than listed.
 *
 * Found on purpose: a listed set would need editing by whoever adds the next fixture, which is the
 * same person who would forget. Both `__fixtures__` directories also hold pre-analysed `Analysis`
 * objects, which carry no `events` and cannot answer this question — `events` is what tells them
 * apart, and it is the field this guard needs anyway.
 */
function rawFixtures(dir: string): Array<{ name: string; dataset: FightDataset }> {
	const root = resolve(import.meta.dirname, `../../../specs/${dir}/__fixtures__`);
	return readdirSync(root)
		.filter((file) => file.endsWith('.json'))
		.sort()
		.map((file) => ({ name: file, parsed: JSON.parse(readFileSync(resolve(root, file), 'utf8')) as unknown }))
		.filter((entry): entry is { name: string; parsed: FightDataset } => {
			const candidate = entry.parsed as Partial<FightDataset>;
			return Array.isArray(candidate.events) && candidate.actor !== undefined;
		})
		.map((entry) => ({ name: entry.name, dataset: entry.parsed }));
}

describe('every cast id a committed fixture presses is modelled or declared', () => {
	for (const spec of SPECS) {
		const fixtures = rawFixtures(spec.dir);

		// A spec whose fixtures all silently stopped being raw datasets would make every assertion below
		// vacuous, and vacuous is the failure mode this whole file exists to rule out.
		it(`${spec.dir} has raw fixtures to check`, () => {
			expect(fixtures.length).toBeGreaterThan(0);
		});

		for (const { name, dataset } of fixtures) {
			it(`${spec.dir}/${name}`, () => {
				const analysis = spec.analyse(dataset) as Analysis;
				const unmodelled = unmodelledPresses(analysis.casts, spec.config.registry);

				// The report has to be able to *name* what it will not price. An id that reaches here
				// having fallen through to the generated spell map — or worse, to a bare `#id` — is one
				// nobody decided about, which is the state Chain Lightning was in.
				const undeclared = unmodelled.filter(
					(row) => spec.config.extraNames[row.id] === undefined && !RAID_BUFF_NAMES.has(row.id),
				);
				expect(
					undeclared.map((row) => `${row.id} ${row.name} x${row.count}`),
					`${spec.dir}/${name} presses ${undeclared.length} cast id(s) that are neither a modelled Ability nor on this spec's extraNames list. Decide each one: model it if the rotation presses it, name it in extraNames if it is knowingly unpriced.`,
				).toEqual([]);

				// No second assertion that these rows read off-GCD, though the temptation is strong: it
				// cannot fail. `unmodelledPresses` selects on `abilityByCastId(id) === undefined` and
				// `buildCastTable` writes `c.ability?.onGcd ?? false` from that same lookup, so the term
				// under test cancels and the check would be green by construction — decoration that reads
				// like a guard. What these rows cost is a *number*, and numbers are pinned where they can
				// move: `gcdUtilisationPct` and the unmodelled press count, per pull, in `pulls.test.ts`.
			});
		}
	}
});
