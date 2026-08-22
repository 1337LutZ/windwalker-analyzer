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
 *
 * **The item sweep (plan §51a) grew both lists, and what it took *off* them is the finding.** One entry
 * left the lists and one was re-keyed on them, and neither because anything was deleted:
 *
 *   `synapse-springs [96228]` is gone from the Elemental list because the tinker's buff logs a different
 *   id per stat granted and only the agility one was declared. All three Elemental pulls press 126734 and
 *   all three write **96230** (intellect), so the press had a lane and the buff window it opened had
 *   none. It fires now.
 *
 *   `wushoolays-lightning [138786]` is the same id under a corrected key — the rename landed in
 *   `7319f15`, one of five wrong declarations the sweep caught. It read `unerring-vision-stacks`, and
 *   138786 was never Unerring Vision's: it is Wushoolay's Final Choice's proc window, non-stacking and
 *   ten seconds long, whose ten-stack counter is the separate `wushoolays-lightning-stacks [138788]` on
 *   the next line. Unerring Vision has no counter in either source, so there was no aura for the old key
 *   to be named after.
 *
 *   The finding behind that one is about the two sources rather than about the key. The sim's rule looks
 *   coherent because its *hand-written* Wushoolay's override inverts the pair — it puts the stacks on the
 *   window's id and the payload on the tracker's — so a faithful transcription of it asks a non-stacking
 *   id for ten stacks. And where the sim and `db.json` disagreed about which id is the payload and which
 *   the tracker, **`db.json` was right five times out of five**. `lib/game/shared.ts` carries the whole
 *   of it.
 *
 * `jade-spirit`, `lightweave`, `essence-of-yulon` and `toxic-power` never reach this list on the
 * Elemental side, and `dancing-steel` never reaches it on the Windwalker side: all five fire on a
 * committed pull and none of them was declared before the sweep.
 */
const SILENT_AURAS: Record<string, string[]> = {
	elemental: [
		'blades-of-renataki [138756]',
		'blades-of-renataki-stacks [138737]',
		'blood-fury [33697]',
		'breath-of-hydra [138898]',
		'capacitance [137596]',
		'chayes [139133]',
		'cloudburst [138856]',
		'cruelty [146285]',
		'cruelty-stacks [146293]',
		'dancing-steel [120032]',
		'dextrous [146308]',
		'elemental-mastery [16166]',
		'eye-of-brutality [139170]',
		'feathers-of-fury [138759]',
		'feathers-of-fury-stacks [138760]',
		'ferocity [148896]',
		'flurry-of-xuen [146194]',
		'fortitude [137593]',
		'juju-madness [138938]',
		'lord-blastingtons [109085]',
		'primal-elementalist [117013]',
		'rampage [138870]',
		're-origination [139117, 139120, 139121]',
		'restless-agility [146310]',
		'rivers-song [116660]',
		'spirit-of-chi-ji [146200]',
		'swordguard-embroidery [125489]',
		't15-4pc [138144]',
		'tenacious [148899]',
		'titanic-restoration [146314]',
		'unerring-vision [138963]',
		'unleashed-fury [117012]',
		'vicious [148903]',
		'windsong [104423, 104509, 104510]',
		'wrath-of-darkspear [146184]',
		'wrath-of-darkspear-stacks [146202]',
		'wushoolays-lightning [138786]',
		'wushoolays-lightning-stacks [138788]',
	],
	windwalker: [
		'berserking [26297]',
		'blades-of-renataki [138756]',
		'blades-of-renataki-stacks [138737]',
		'blood-fury [33697]',
		'breath-of-hydra [138898]',
		'chayes [139133]',
		'cloudburst [138856]',
		'cruelty [146285]',
		'cruelty-stacks [146293]',
		'dampen-harm [122278]',
		'dextrous [146308]',
		'essence-of-yulon [146198]',
		'expanded-mind [146046]',
		'eye-of-brutality [139170]',
		'feathers-of-fury [138759]',
		'feathers-of-fury-stacks [138760]',
		'ferocity [148896]',
		'fortifying-brew [120954]',
		'fortitude [137593]',
		'jade-spirit [104993]',
		'juju-madness [138938]',
		'lightweave [125487]',
		'lord-blastingtons [109085]',
		'rampage [138870]',
		'restless-agility [146310]',
		'rivers-song [116660]',
		'rushing-jade-wind [116847]',
		'spirit-of-chi-ji [146200]',
		'storm-earth-and-fire [137639]',
		'swordguard-embroidery [125489]',
		'tempus-repit [137590]',
		'tenacious [148899]',
		'titanic-restoration [146314]',
		'toxic-power [148906]',
		'unerring-vision [138963]',
		'windsong [104423, 104509, 104510]',
		'wrath-of-darkspear [146184]',
		'wrath-of-darkspear-stacks [146202]',
		'wushoolays-lightning [138786]',
		'wushoolays-lightning-stacks [138788]',
	],
};

/**
 * What the priority ladder returns on every committed pull, as a grid.
 *
 * Plan §47 asked for exactly this before and after the commit-instant change, and only "1-2 presses
 * reorder per pull" was ever written down — so the counts themselves went unpinned for two waves.
 * `specs/elemental/lib/__tests__/multiTargetRungs.test.ts` holds `phased` and `unbroken` from one
 * direction, because it needs them fixed to prove the multi-target rungs do not leak into a one-target
 * pull. Nothing held `cleave`, which is the pull those rungs were built for and the only one that can
 * move when they change, and nothing anywhere held `unknown`.
 *
 * `unknown` is the column to read. It is zero on all three, which is the property
 * `spec/__tests__/aplFixtures.test.ts` asserts only loosely (under 10%) and only on the Windwalker's
 * pre-analysed pulls: a ladder that answers "cannot say" is as useless as one that cries wolf, and a
 * rung quietly losing its inputs surfaces as verdicts moving into that column rather than as anything
 * failing.
 *
 * **`dataset-ironJuggernaut` is `null`, and not for the reason two lane briefs gave.** It is not that
 * the pull carries no `classResources`. `phased` and `unbroken` carry none either — the counts below
 * are 0 of 3454 and 0 of 2848, against `cleave`'s 3237 of 4642 — and both audit fine. What separates
 * them is a per-spec setting: the Elemental ladder passes `barsRequired: false`
 * (`specs/elemental/lib/index.ts:2619`), which lifts the `null` gate at `spec/apl.ts:686-687`, and the
 * Windwalker's ladder does not — so on that spec no `classResources` means no `energy.points` and the
 * whole audit bails. The resource counts are pinned below precisely so the wrong explanation cannot be
 * reached from them a third time.
 */
const APL_VERDICTS: Record<string, { presses: number; followed: number; skipped: number } | null> = {
	'elemental/cleave.json': { presses: 204, followed: 81, skipped: 123 },
	'elemental/phased.json': { presses: 159, followed: 107, skipped: 52 },
	'elemental/unbroken.json': { presses: 142, followed: 97, skipped: 45 },
	'windwalker/dataset-ironJuggernaut.json': null,
};

/** `[events carrying `classResources`, events in the pull]`, straight off the raw fixture. */
const RESOURCE_EVENTS: Record<string, [number, number]> = {
	'elemental/cleave.json': [3237, 4642],
	'elemental/phased.json': [0, 3454],
	'elemental/unbroken.json': [0, 2848],
	'windwalker/dataset-ironJuggernaut.json': [0, 3181],
};

describe('the priority ladder grades every committed pull the same way it did', () => {
	for (const spec of SPECS) {
		for (const { name, dataset } of rawFixtures(spec.dir)) {
			const key = `${spec.dir}/${name}`;
			it(key, () => {
				const apl = (spec.analyse(dataset) as Analysis).apl ?? null;
				const expected = APL_VERDICTS[key];
				expect(
					expected,
					`${key} is not on the grid above — add it, with the reason if it audits to null`,
				).not.toBeUndefined();
				if (expected === null) {
					expect(apl).toBeNull();
					return;
				}
				expect(apl).not.toBeNull();
				if (apl === null) return;
				expect({
					presses: apl.presses.length,
					followed: apl.followed,
					skipped: apl.skipped,
				}).toEqual(expected);
				// Every press is judged or declined, and none is declined. Asserted as the sum rather than
				// as three numbers so a verdict moving *between* columns cannot cancel out.
				expect(apl.unknown, `${key} unknown`).toBe(0);
				expect(apl.offList, `${key} offList`).toBe(0);
				expect(apl.followed + apl.skipped).toBe(apl.presses.length);
			});
		}
	}

	/**
	 * The measurement that refutes the resource-count explanation above, read off the raw events rather
	 * than off the analysis — so it is a fact about the fixtures and not a restatement of the grid.
	 */
	it('carries no resource readings on two pulls that audit fine', () => {
		const counts: Record<string, [number, number]> = {};
		for (const spec of SPECS) {
			for (const { name, dataset } of rawFixtures(spec.dir)) {
				const withResources = dataset.events.filter(
					(event) => (event as { classResources?: unknown }).classResources !== undefined,
				).length;
				counts[`${spec.dir}/${name}`] = [withResources, dataset.events.length];
			}
		}
		expect(counts).toEqual(RESOURCE_EVENTS);
		// The whole of the point: three pulls with zero readings, and only one of them audits to null.
		for (const key of ['elemental/phased.json', 'elemental/unbroken.json', 'windwalker/dataset-ironJuggernaut.json'])
			expect(RESOURCE_EVENTS[key]?.[0], key).toBe(0);
		expect(APL_VERDICTS['elemental/phased.json']).not.toBeNull();
		expect(APL_VERDICTS['windwalker/dataset-ironJuggernaut.json']).toBeNull();
	});
});
