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

/**
 * The same question asked of auras, which is where it was asked too late.
 *
 * The T16 two-piece proc was declared as id 144998. That number is real, but it is the *simulator's*
 * `ExposeToAPL` handle — WarcraftLogs never writes it. So `twoPieceWindows` was permanently empty, and
 * with it a chart lane and an APL gate, on pulls where the player demonstrably had the set: the id the
 * log actually carries is 144999, which appears twenty times on one committed fixture and eighteen on
 * another. Nothing failed. Nothing could.
 *
 * A declared aura that never fires cannot simply be an error, though, and that is what makes this
 * harder than the cast-id guard above: most of these are trinkets and set bonuses that nobody in four
 * pulls happened to wear, and absence is not evidence against them. So the guard is a **ledger** rather
 * than a prohibition. The list below is every declared aura id that appears in no committed fixture,
 * recorded as fact. Adding an aura that never fires grows the list and fails this test, which is the
 * moment to ask which kind it is — an item these pulls do not cover, or a number the game does not use.
 *
 * Neither answer is "delete the entry". An id nobody wore belongs on the list; an id the game never
 * writes belongs nowhere.
 */
function auraIdsIn(dataset: FightDataset): Set<number> {
	const seen = new Set<number>();
	for (const event of dataset.events) {
		const id = (event as { abilityGameID?: number }).abilityGameID;
		if (typeof id === 'number') seen.add(id);
	}
	return seen;
}

describe('every aura a spec declares either fires in a committed fixture or is on the ledger', () => {
	for (const spec of SPECS) {
		it(`${spec.dir}`, () => {
			const fixtures = rawFixtures(spec.dir);
			expect(fixtures.length).toBeGreaterThan(0);

			const fired = new Set<number>();
			for (const { dataset } of fixtures) for (const id of auraIdsIn(dataset)) fired.add(id);

			const silent: string[] = [];
			for (const aura of spec.config.registry.auras) {
				if (aura.ids.some((id) => fired.has(id))) continue;
				silent.push(`${aura.key} [${aura.ids.join(', ')}]`);
			}
			expect(silent.sort()).toEqual(SILENT_AURAS[spec.dir]);
		});
	}
});

/**
 * Declared, and absent from every committed pull. Read the note above before editing this.
 *
 * Most of these are the honest kind: trinkets, racials and set bonuses that none of the four players in
 * the raw fixtures happened to be wearing. `re-origination` is a Windwalker trinket and is silent on the
 * Elemental side for the obvious reason.
 *
 * Two entries are worth knowing about rather than scrolling past:
 *
 *   `t16-2pc-proc [144998]` was here, and is gone: it was the simulator's `ExposeToAPL` handle rather
 *   than a number the game writes, so it was retired and its five readers consolidated onto
 *   `t16-2pc-debuff` (144999), which fires on all three Elemental pulls. That is the shape of the right
 *   answer to an entry appearing here — establish which kind it is, and if the game never writes it, it
 *   belongs nowhere rather than on this list.
 *
 *   `capacitance [137596]` is the legendary meta gem. It is also referenced by bare key in shared chart
 *   code, which `docs/conventions.md` would rather it were not.
 *
 * The Windwalker list is short on core abilities — `rushing-jade-wind`, `storm-earth-and-fire`,
 * `fortifying-brew`, `dampen-harm` — because that spec has exactly one raw-event fixture and its monk
 * talented none of them. That is a statement about the fixture set, not about the model, and it is a
 * decent argument for a second Windwalker dataset.
 */
const SILENT_AURAS: Record<string, string[]> = {
	elemental: [
		'blood-fury [33697]',
		'breath-of-hydra [138898]',
		'capacitance [137596]',
		'chayes [139133]',
		'elemental-mastery [16166]',
		'ferocity [148896]',
		'flurry-of-xuen [146194]',
		'primal-elementalist [117013]',
		're-origination [139117, 139120, 139121]',
		'synapse-springs [96228]',
		't15-4pc [138144]',
		'unerring-vision [138963]',
		'unerring-vision-stacks [138786]',
		'unleashed-fury [117012]',
		'vicious [148903]',
		'wrath-of-darkspear [146184]',
	],
	windwalker: [
		'berserking [26297]',
		'blood-fury [33697]',
		'breath-of-hydra [138898]',
		'chayes [139133]',
		'dampen-harm [122278]',
		'ferocity [148896]',
		'fortifying-brew [120954]',
		'rushing-jade-wind [116847]',
		'storm-earth-and-fire [137639]',
		'tempus-repit [137590]',
		'unerring-vision [138963]',
		'unerring-vision-stacks [138786]',
		'wrath-of-darkspear [146184]',
	],
};
