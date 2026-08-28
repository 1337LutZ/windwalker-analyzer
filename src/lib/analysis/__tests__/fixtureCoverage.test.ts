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
import { describe, expect, it } from 'vitest';

import type { Analysis, FightDataset } from '~/lib/types';
import { unmodelledPresses } from '~/lib/analysis/casts';
import { capturedAnalyses, rawFixtures } from '~/lib/analysis/fixtures';
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
 * What each spec has committed, by shape — the assertion that keeps the shared discovery honest.
 *
 * `rawFixtures` used to live in this file and was the only one of the three aura guards that found its
 * own input; the other two carried literal name lists, so a newly committed fixture was swept here
 * automatically and by them never. The reading now lives in `~/lib/analysis/fixtures`, which argues its
 * own location, and all three call it.
 *
 * **This grid is what stops that sharing from going quiet.** The discovery classifies each `.json` as a
 * raw `FightDataset` or a captured `Analysis`, and the guards need different halves — the drawn-aura
 * sweep wants an `Analysis`, this file and `undeclaredAuras.test.ts` want raw events. A classifier that
 * put a pull in the wrong half would leave a guard sweeping *nothing*, which passes. So both halves are
 * named per spec, from the literal side, against a list read off the directory. Adding a fixture fails
 * here by name, which is one line to acknowledge and the moment to say which shape it is; every sweep
 * below then picks it up with no further wiring.
 */
const FIXTURE_CENSUS: Record<string, { raw: string[]; captured: string[] }> = {
	// Four raw pulls and no captures. `addsThenBoss.json` is the fourth and it is the only one whose
	// multi-target regime *ends*: Galakras runs tower adds for the first seven minutes and then stands
	// alone for the last fifty-seven seconds, where `cleave` interleaves adds to its last hit and
	// `phased` and `unbroken` never leave one enemy. Measured in `__fixtures__/addsThenBoss.test.ts`.
	elemental: { raw: ['addsThenBoss.json', 'cleave.json', 'phased.json', 'unbroken.json'], captured: [] },
	// Four raw pulls and six captures. The captures are written by `__fixtures__/capture.test.ts` —
	// `analyse()`'s output rather than its input, which is why they carry no `events` and cannot answer
	// half of these questions.
	//
	// **Three of the four raw pulls arrived together, and the reason to know their names is that each
	// answers a question `dataset-ironJuggernaut.json` could not.** That pull is one enemy for its whole
	// length, from a monk who talented none of the three optional buttons, on a log fetched before
	// `includeResources: true`. So `sections.json` (heroic Galakras) is the target-mode pull — seventeen
	// segments across all five modes, and the first committed pull to press Rushing Jade Wind at all, 33
	// times, 27 of them into three enemies or more. `idle.json` (heroic Immerseus) is the downtime pull —
	// four `idle` segments totalling 75s of a 255s fight, which is where `activePct` reads 51.08% against
	// the other three pulls' 83–99.7%. `uncounted.json` (heroic Malkorok) is the first committed pull from
	// an encounter WarcraftLogs' own Siege ranking rules name, and it brings 14 separate `Living
	// Corruption` spawns for the add-handling code to be wrong about.
	windwalker: {
		raw: ['dataset-ironJuggernaut.json', 'idle.json', 'sections.json', 'uncounted.json'],
		captured: ['cleave.json', 'mixed.json', 'poor.json', 'strong.json', 'waves.json', 'weave.json'],
	},
};

describe('every cast id a committed fixture presses is modelled or declared', () => {
	for (const spec of SPECS) {
		const fixtures = rawFixtures(spec.dir);

		// A spec whose fixtures all silently stopped being raw datasets would make every assertion below
		// vacuous, and vacuous is the failure mode this whole file exists to rule out.
		it(`${spec.dir} discovers both shapes of fixture it has committed`, () => {
			expect({
				raw: fixtures.map((fixture) => fixture.name),
				captured: capturedAnalyses(spec.dir).map((fixture) => fixture.name),
			}).toEqual(FIXTURE_CENSUS[spec.dir]);
			// Stated separately, and not derivable from the line above: the grid could be "corrected" to two
			// empty lists and would then agree with a discovery that had stopped finding anything.
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

				/*
				 * The second half of the same question, and the one a name could never answer: what did the
				 * press *cost*.
				 *
				 * A name settles that the id was looked at. It settles nothing about the global, and the
				 * engine's answer in the absence of one was **zero occupied milliseconds** — so a monk who
				 * spent fourteen half-globals on Healing Sphere and two whole ones on Tiger's Lust read as
				 * one who had pressed nothing, and a shaman's Purge, Ghost Wolf and Healing Tide Totem were
				 * free. Same failure as Chain Lightning's, one layer in: not a button nobody named, a button
				 * nobody priced.
				 *
				 * **Off the global is right for most of what lands here and is exactly the bug for a real
				 * button**, which is why it cannot stay a *default*. `0` has to be typed out by the spec
				 * that owns the id, next to the `StartRecoveryTime` it was read from — Roll, Provoke, Zen
				 * Meditation, Shamanistic Rage and the melee swing all say it, and all five say it on
				 * evidence. Absent and zero are different states and only one of them is a decision.
				 *
				 * Asked of `unmodelled` rather than of the spec's table, so it is scoped to ids a committed
				 * pull actually presses. The passive half of `extraNames` — mastery overloads, weapon procs,
				 * pet spells, a meta gem, twenty-odd ids per spec — never appears as a `cast` and is never
				 * asked for a global it does not have. A spec may declare a price ahead of the fixture that
				 * needs it and this stays green; it goes red the moment a *press* arrives without one, which
				 * is the moment there is something to decide.
				 */
				const unpriced = unmodelled.filter((row) => spec.config.extraGlobals[row.id] === undefined);
				expect(
					unpriced.map((row) => `${row.id} ${row.name} x${row.count}`),
					`${spec.dir}/${name} presses ${unpriced.length} named cast id(s) with no entry in this spec's extraGlobals, so each occupies zero time in gcdUtilisationPct. Read StartRecoveryTime for the id out of SpellCooldowns (joined on SpellID, in wowsims.db) and declare it as a fraction of this spec's own base global — 0 if it is genuinely off the GCD.`,
				).toEqual([]);
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
 * **This is a census and not an allowlist, so an entry cannot arrive before its declaration.** The
 * assertion above is `expect(silent.sort()).toEqual(SILENT_AURAS[spec.dir])` — an exact match against the
 * declared auras that fire nowhere — so a line here naming an aura no registry declares fails
 * *immediately*, in the direction nobody expects: the computed list is short by one and the diff reads
 * `- 'the-key [id]'`. It was asked of Magma Totem (`2b41adb` declared 8190 as an ability with no aura,
 * and a lane wanted the ledger side landed ahead of the aura so the aura could follow without a red).
 * Measured, not reasoned: adding `'magma-totem [8190]'` here turns `elemental` red with
 * `expected [ Array(38) ] to deeply equal [ Array(39) ]`. So the entry belongs in the **same commit** as
 * the aura, in `specs/elemental/lib/index.ts`, and nowhere earlier — which is the same rule
 * `staleExcuses` and `declaredLedgerIds` enforce from the other end, one commit ahead of time instead of
 * one behind.
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
 * **The Windwalker list used to be short on core abilities, and three of them have now fired.** It
 * carried `rushing-jade-wind`, `storm-earth-and-fire`, `fortifying-brew` and `dampen-harm`, entirely
 * because that spec had exactly one raw-event fixture and its monk talented none of them — a statement
 * about the fixture set rather than about the model, and the docblock said so and called for a second
 * dataset. Three landed, and the argument was right:
 *
 *   `rushing-jade-wind [116847]` is the one that mattered and the reason `sections.json` was fetched.
 *   The wind is the only ability in this spec's `aplTargetCountExclude`, so every claim resting on that
 *   exclusion — `targetSeries.aplBands.test.ts`' whole invariant, `bandsInPull`, `tigerPalmShare` — was
 *   being asserted against pulls on which the two target series were the *same array*. That pull presses
 *   it **33** times, 27 of them into three enemies or more, and `idle.json` presses it a further 9. The
 *   exclusion finally has something to remove on a raw fixture, and the two series part company on both.
 *
 *   `fortifying-brew [120954]` is the entry that was one id away from being the 144998 mistake, and the
 *   fixtures now settle it in the right direction. The aura's own declaration argues at length that the
 *   number a Classic log carries is 120954 and not 115203 or the sim's 126456, verified on one anonymous
 *   fight; `idle.json` is the first *committed* pull to write it, and writes it exactly once.
 *
 *   `blood-fury [33697]` is the plain kind: a racial, on the two of the four monks who are orcs — two
 *   presses each on `idle.json` and `uncounted.json`, four aura events apiece.
 *
 * `dampen-harm`, `storm-earth-and-fire` and `berserking` stay on the list: four monks in, nobody has
 * talented the first two or been a troll.
 *
 * **The item sweep (plan §51a) grew both lists, and what it took *off* them is the finding.** One entry
 * left the lists and one was re-keyed on them, and neither because anything was deleted:
 *
 *   `synapse-springs [96228]` is gone from the Elemental list because the tinker's buff logs a different
 *   id per stat granted and only the agility one was declared. All three Elemental pulls press 126734 and
 *   all three write **96230** (intellect), so the press had a lane and the buff window it opened had
 *   none. It fires now.
 *
 *   `wushoolays-lightning [138786]` was here under a corrected key — the rename landed in `7319f15`,
 *   one of five wrong declarations the sweep caught. It read `unerring-vision-stacks`, and 138786 was
 *   never Unerring Vision's: it is Wushoolay's Final Choice's proc window, non-stacking and ten seconds
 *   long, whose ten-stack counter is the separate `wushoolays-lightning-stacks [138788]`. Unerring Vision
 *   has no counter in either source, so there was no aura for the old key to be named after.
 *
 *   **All three of those left the Elemental list when `addsThenBoss.json` landed**, and this is the
 *   entry to read if the question is what a fixture is for. That pull's shaman wears Wushoolay's Final
 *   Choice (96413) *and* Breath of the Hydra (96455) — Throne of Thunder trinkets, where all three
 *   pulls before it wore the same two Siege ones (104426, 104544) — so `wushoolays-lightning [138786]`,
 *   `wushoolays-lightning-stacks [138788]` and `breath-of-hydra [138898]` fire on a committed pull for
 *   the first time. The last of those is the one that mattered: `specs/elemental/lib/apl.ts` reads
 *   `auraIsKnown(138898)` as **owned** at three targets and up because nothing could show otherwise, and
 *   this is the pull that can. Its own measurement is in `__fixtures__/addsThenBoss.test.ts`.
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
	],
	windwalker: [
		'berserking [26297]',
		'blades-of-renataki [138756]',
		'blades-of-renataki-stacks [138737]',
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
		'fortitude [137593]',
		'jade-spirit [104993]',
		'juju-madness [138938]',
		'lightweave [125487]',
		'lord-blastingtons [109085]',
		'rampage [138870]',
		'restless-agility [146310]',
		'rivers-song [116660]',
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
 * `unknown` is the column to read. It is the property `spec/__tests__/aplFixtures.test.ts` asserts only
 * loosely (under 10%) and only on the Windwalker's pre-analysed pulls: a ladder that answers "cannot
 * say" is as useless as one that cries wolf, and a rung quietly losing its inputs surfaces as verdicts
 * moving into that column rather than as anything failing.
 *
 * **It was asserted `0` on every row here, and it is on the grid now — the same correction `offList`
 * got two paragraphs down, for the same reason and with a real reading behind it this time.** Three
 * Windwalker pulls arrived carrying `classResources`, and two of them read `unknown: 1`:
 * `sections.json` and `uncounted.json`. In both cases it is the pull's **first graded press**, and in
 * both cases the cause is the same and is not a defect. `affordable` answers `'unknown'` when a rung
 * charges a resource the log has not yet reported, and a Windwalker log reports chi only on an event
 * that moves it. `idle.json`'s first press is a Blackout Kick at 540ms carrying `chi = 2`, so chi is
 * known from the first global and the pull reads `0`. `sections.json` opens with an Expel Harm at 934ms
 * and does not report chi until a Tiger Palm at **6322ms**; `uncounted.json` opens with Invoke Xuen at
 * 392ms and does not report chi until a Rising Sun Kick at **3177ms**. One press each falls in that
 * gap, and `judge` stops the walk and says so rather than grading a press against a bar it cannot read.
 *
 * That is the column doing its job, which is precisely why pinning it at zero was the wrong shape: the
 * assertion would have to be relaxed or deleted the first time a pull legitimately produced one, and a
 * deleted assertion is how the *illegitimate* ones get in afterwards. Pinned per pull, a rung losing
 * its inputs still shows up here as a number that moved.
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
const APL_VERDICTS: Record<
	string,
	{ presses: number; followed: number; skipped: number; offList: number; unknown: number } | null
> = {
	// 81/123 until the Flame Shock rung learned that `cleave.apl.json` and `aoe.apl.json` ask a
	// different question than `p5.apl.json` does — see `FS_CLEAVE_OVERLAP_MS` in `elemental/lib/apl.ts`
	// — then 83/121, and 99/105 since the five rungs `aoe.apl.json` has no counterpart for were banded to
	// `[1, 2]`. That last move is the largest of the three and it is all one mechanism: Earth Shock, Lava
	// Burst and Searing Totem stood *above* Lava Beam and Chain Lightning at bands 3 and 4, so at three
	// targets and up one of them claimed nearly every global and the two rungs the aoe list actually has
	// were almost unreachable — 11 Lava Beams and not one graded `followed`. The 16 presses that changed
	// are Chain Lightnings and beams the sim's own list wanted. See `multiTargetRungs.test.ts`.
	// **69/339 when this pull was committed, and the 271 presses in between were a defect rather than a
	// player.** That first reading was a 16.9% follow rate against `cleave`'s 48.5%, and
	// `addsThenBossLadder.test.ts` pinned its decomposition rather than smoothing it: 91.4% of the faults
	// were one rung, because `fsRemainingAt` answered the ladder's `dotRemainingTime` out of a map keyed
	// only by the *primary's* spawns. On a nine-enemy pull the spawn the player was hitting was usually an
	// add, the lookup missed, and the miss returned a fabricated 0 — indistinguishable from "this add had
	// no dot". Pointing it at `fsDotAnywhere`, the every-spawn map declared sixty lines above it and
	// already used by the graded uptime numerator for exactly this reason, moves 166 verdicts here and 1 on
	// `cleave`, and moves nothing at all on the two single-target pulls. The pull now reads 34.3% against
	// `cleave`'s 49.0%, and its Flame Shock share of faults is 56.7% against `cleave`'s 55.8%. What is left
	// is the player: see that file for the add-phase/tail split and for the Searing Totem this pull never
	// laid.
	// 140/264/4 since the ladder gained a declaration for the three on-GCD buttons it does not arbitrate —
	// `UNARBITRATED` in `elemental/lib/apl.ts`. The four presses that moved are two Stormlash Totems and
	// two Fire Elementals, and they moved out of `skipped` and into `offList` without touching `followed`,
	// which is the whole of what that declaration can do.
	'elemental/addsThenBoss.json': { presses: 408, followed: 140, skipped: 264, offList: 4, unknown: 0 },
	// 81/123 until the Flame Shock rung learned that `cleave.apl.json` and `aoe.apl.json` ask a
	// different question than `p5.apl.json` does — see `FS_CLEAVE_OVERLAP_MS` in `elemental/lib/apl.ts`
	// — then 83/121, and 99/105 since the five rungs `aoe.apl.json` has no counterpart for were banded to
	// `[1, 2]`. That last move is the largest of the three and it is all one mechanism: Earth Shock, Lava
	// Burst and Searing Totem stood *above* Lava Beam and Chain Lightning at bands 3 and 4, so at three
	// targets and up one of them claimed nearly every global and the two rungs the aoe list actually has
	// were almost unreachable — 11 Lava Beams and not one graded `followed`. The 16 presses that changed
	// are Chain Lightnings and beams the sim's own list wanted. See `multiTargetRungs.test.ts`.
	// 100/104 since `fsRemainingAt` stopped reading the primary-scoped dot map — one press, which is the
	// scale of the same defect on a pull with 8 dot applications instead of 24. See the entry above.
	// 131/72 since the band-3 Flame Shock rung stopped assuming the trinket. `aoe.apl.json` rung 1 is
	// `auraIsKnown(138898) AND not(dotIsActive(8050))` and the first half is Breath of the Hydra, which
	// this shaman does not own — read off the `combatantinfo` gear array, not off a proc window. So 40 of
	// the 58 Flame Shock skips were charged against a rung that list never offered them, and the presses
	// they were charged from are Chain Lightnings and beams the aoe list does ask for. **Only this pull
	// moves**: `phased` and `unbroken` never exceed one enemy, so a band-3 rung is not in their list at
	// any press, and `addsThenBoss` wears the trinket. See `lib/spec/__tests__/aoeFlameShockGear.test.ts`.
	'elemental/cleave.json': { presses: 204, followed: 131, skipped: 72, offList: 1, unknown: 0 },
	'elemental/phased.json': { presses: 159, followed: 107, skipped: 50, offList: 2, unknown: 0 },
	'elemental/unbroken.json': { presses: 142, followed: 97, skipped: 43, offList: 2, unknown: 0 },
	'windwalker/dataset-ironJuggernaut.json': null,
	// **The three rows that show the `null` above is the setting and not the encounter.** All three carry
	// `classResources` — 1476, 4503 and 2141 events of them below — so `energy.points` is populated, the
	// `barsRequired` gate at `spec/apl.ts:686-687` never fires, and the Windwalker ladder audits on a raw
	// pull for the first time. Nothing about the spec changed to make that happen; the fetch did.
	//
	// The follow rates are worth reading against each other rather than one at a time, because the three
	// pulls differ in the thing this ladder is worst at. `uncounted` is the most nearly continuous
	// of them — 99.7% of the pull in contact — and reads **55.2%** followed. `sections` is seventeen
	// segments across all five modes and reads **44.2%**. `idle` is 75s of
	// downtime in a 255s pull and reads **44.3%**, against a denominator that is all 106 of its presses:
	// a ladder walked through a phase with nothing to hit is being asked what the list wanted at a global
	// where the list wanted a target. `analysis/segments.ts` is what a rule that cares would read, and no
	// rule reads it yet — so the two lower numbers are the size of that gap at least as much as they are
	// three players.
	//
	// **46 and 128 until the chi walk stopped counting Rushing Jade Wind's refund twice**, which moved one
	// press on each of the two pulls that press the wind and none on `uncounted`, which does not press it.
	// Both are Jabs the ladder had been charging as skips — `idle` t=76 449ms against Rising Sun Kick,
	// `sections` t=350 102ms against Fists of Fury — and both are the same mechanism: the walk believed
	// the player was holding chi they had never been given, so it read a spender as affordable and charged
	// the player with passing it over. A third press on `sections`, t=318 759ms, keeps its skip and changes
	// only what the list wanted, Rising Sun Kick to Chi Wave. See `ResourceConfig.gains.reportedAs`. The
	// sibling fix in the same branch — the refund's target gate reading a series the wind's own hits are in
	// — moves **no** verdict on any committed pull, because the log reports the refund on all three and the
	// declared gain is switched off wherever it does.
	'windwalker/idle.json': { presses: 106, followed: 47, skipped: 56, offList: 3, unknown: 0 },
	'windwalker/sections.json': { presses: 292, followed: 129, skipped: 153, offList: 9, unknown: 1 },
	// **This row is mode-dependent, and the numbers here are `parsing` — the default.** WarcraftLogs
	// strikes the twenty Living Corruptions on this pull, so under the ruleset it reads single-target and
	// the ladder grades every press that way. Under `progression` the same pull reads a peak of 3 enemies
	// and 35.4% multi-target, and five presses move out of `followed` to 100/77. Neither is a regression;
	// they are two questions. `game/__tests__/exclusionEvidence.test.ts` reads this same pull both ways.
	'windwalker/uncounted.json': { presses: 181, followed: 105, skipped: 72, offList: 3, unknown: 1 },
};

/** `[events carrying `classResources`, events in the pull]`, straight off the raw fixture. */
const RESOURCE_EVENTS: Record<string, [number, number]> = {
	// The second pull to carry any, and the one that shows the ratio is a property of the *capture* and
	// not of the encounter: 6614 of 9363, where `cleave` reads 3237 of 4642 — both a shade over 70%.
	// `phased` and `unbroken` read zero because they were fetched before `includeResources: true`.
	'elemental/addsThenBoss.json': [6614, 9363],
	'elemental/cleave.json': [3237, 4642],
	'elemental/phased.json': [0, 3454],
	'elemental/unbroken.json': [0, 2848],
	'windwalker/dataset-ironJuggernaut.json': [0, 3181],
	// The three Windwalker pulls fetched with `includeResources: true`. The share is 58.5%, 66.8% and
	// 59.5%, against the two Elemental pulls' 70.6% and 69.7% — the same order of magnitude across two
	// specs and six encounters, which is the point: it is a property of the *capture*, as
	// `addsThenBoss`'s entry already argued, and not of the boss. What is missing a bar on all five is
	// overwhelmingly aura traffic rather than presses — applications, removals, refreshes and stack
	// changes, none of which moves a bar and none of which the ladder reads a press from — so a low
	// share here says the player had a lot of buffs moving, not that the ladder is short of readings.
	// Measured: aura events are 66.8% to 86.9% of the barless remainder on all five.
	'windwalker/idle.json': [1476, 2524],
	'windwalker/sections.json': [4503, 6738],
	'windwalker/uncounted.json': [2141, 3599],
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
					offList: apl.offList,
					unknown: apl.unknown,
				}).toEqual(expected);
				// **`offList` is on the grid rather than pinned at zero, and that is the correction rather
				// than a loosened assertion.** It used to be asserted `0` on every row, which was true and
				// was not a property: the Elemental ladder's bottom rung is unconditional, so nothing could
				// reach the engine's fall-through, and the three on-GCD buttons that ladder delegates
				// elsewhere were being charged to a filler rung instead. A column pinned at zero is exactly
				// where that hid.
				//
				// **`unknown` joined it, and it took a real reading to get there rather than an argument.**
				// It was `expect(apl.unknown).toBe(0)` on the reasoning that an unreadable rule is a thing no
				// committed pull produces, and two of the three Windwalker pulls fetched with resources
				// produce exactly one each — the pull's first press, decided before the log's first chi
				// reading. That is the column answering honestly, so it belongs on the grid where a number
				// that moves is visible, and not behind an assertion that has to be relaxed the first time it
				// is right. The reading is on `APL_VERDICTS` above.
				//
				// Every press lands in exactly one column. Asserted as the sum rather than as four numbers
				// so a verdict moving *between* columns cannot cancel out.
				expect(apl.followed + apl.skipped + apl.unknown + apl.offList).toBe(apl.presses.length);
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
