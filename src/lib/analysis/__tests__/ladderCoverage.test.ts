// Every rotational button a spec models has a rung in that spec's ladder, or a reason it does not.
//
// The gap this closes is the one plan step 40 found from the other side. Chain Lightning was missing
// from the Elemental *registry* and nothing said so, which `fixtureCoverage.test.ts` now catches. But a
// button can be modelled perfectly and still be absent from the priority list the audit walks, and that
// failure is worse than it sounds: **a button with no rung can never be graded as correct.** Every press
// of it is necessarily a fault whatever the player did. On `cleave` that was 70 Chain Lightning and 11
// Lava Beam presses graded `skipped` — 81 of the pull's 126 skips, so 64% of every fault the Elemental
// priority section reported on its only add fight was the ladder not knowing the button existed.
//
// Both of those gained rungs in `e2f31a2`, which is why this guard is green the day it is written. That
// is the point rather than a weakness: the two named gaps are the evidence that the class of gap is real
// and that nothing was watching for it. The rungs were authored by hand and the next one will be too.
//
// **A ledger, not a prohibition.** Off-ladder conditional buttons legitimately exist — a cooldown whose
// own section judges it with more room than a per-press verdict, a rule whose condition the event stream
// cannot answer. The same shape as `SILENT_AURAS` in `fixtureCoverage.test.ts` and `NOT_LANES` in the two
// `drawnAuras` guards: the entry records which kind it is, in prose, where the next reader will look.
//
// ## What is swept, and why the join is by cast id
//
// `onGcd: true` because the audit filters on it before judging — an off-GCD press costs none of the
// globals the ladder arbitrates, so there is nothing to give it a rung against.
//
// **And `onGcd: true` is the whole filter, because the premise that used to narrow it further was false.**
// This file swept `gate: 'conditional'` as well, on the argument that "a cooldown-gated or resource-gated
// button is judged by its clock or its bar and needs no rung to be scored fairly". The walk falsifies it.
// The audit sees a cast id and nothing else: a cooldown-gated on-GCD press costs one of the globals the
// ladder arbitrates, so it is walked down the list like any other and charged to whatever rung claims —
// *whether or not* a clock elsewhere also judges it. Measured on the Elemental, whose three delegated
// on-GCD buttons are gated `other`, `other` and `cooldown` and so were invisible to the narrower sweep:
// **9 presses across four committed fixtures, every one graded `skipped`**, and the rung named moved with
// the target band on a button no simulator list mentions at any count.
//
// So the gate says nothing about whether a button is graded fairly. Two things do, and they are the two
// answers this sweep accepts beside a rung:
//
//  - **A declaration the walk can read** — `AplInputs.unarbitrated`, published by the spec's own ladder
//    module. The press comes back `off-list` with the section that judges it named in `reason`. This is
//    what makes "judged by its own section" a fact about the audit rather than a note in a comment.
//  - **A `NOT_RUNGS` entry** — no rung and no declaration, so the walk still grades the press. That is a
//    gap, not an exemption, and each entry below says which of the two it is.
//
// The match is `ability.castIds` against `LadderEntry.id`, and the indirection is load-bearing: a rung's
// key is the *rule's* name and not the button's, and one button carries several rungs while one rung's id
// is one of several cast ids. `tiger-palm-refresh` and `combo-breaker-palm` are both 100787; Jab logs six
// ids, one per weapon type. Matching on keys would report Jab and both Tiger Palm rules as gaps.
import { describe, expect, it } from 'vitest';

import type { Ability } from '~/lib/game/model';
import type { AplInputs } from '~/lib/spec/apl';
import { ELEMENTAL_SPEC } from '~/specs/elemental';
import { LADDER_ENTRIES as ELE_LADDER, UNARBITRATED as ELE_UNARBITRATED } from '~/specs/elemental/lib/apl';
import { WW_SPEC } from '~/specs/windwalker';
import { LADDER_ENTRIES as WW_LADDER } from '~/specs/windwalker/lib/apl';

/**
 * The specs to check, with the two declarations the question compares: what the spec models, and the
 * ladder the audit walks for it.
 *
 * Named explicitly rather than mapped over `SPECS`, for the reason `fixtureCoverage.test.ts` names them:
 * `SpecDefinition` carries no ladder, and a guard about a spec's *declarations* has to reach the spec's
 * own module. `LADDER_ENTRIES` rather than `LADDER` because the projection resolves the band default and
 * carries no closures — nothing here needs a condition, and a test that could reach one would have to
 * invent a `State` to call it.
 */
const SPECS: ReadonlyArray<{
	dir: string;
	config: typeof ELEMENTAL_SPEC | typeof WW_SPEC;
	ladder: typeof ELE_LADDER | typeof WW_LADDER;
	/** What the spec hands the walk as `AplInputs.unarbitrated`, or `{}` for a spec that declares none. */
	unarbitrated: NonNullable<AplInputs['unarbitrated']>;
}> = [
	{ dir: 'elemental', config: ELEMENTAL_SPEC, ladder: ELE_LADDER, unarbitrated: ELE_UNARBITRATED },
	// **The Windwalker declares none, and that is a measured gap rather than a spec that needs none.** Its
	// ladder can reach the engine's fall-through — it is written in units of energy and chi, so a rung it
	// cannot pay for declines — and its captured pulls carry a non-zero `offList` for that reason. But the
	// six on-GCD buttons below with no rung are still walked down the list: `waves.json` charges 19 such
	// presses to a rung and `cleave.json` 8, mostly Storm, Earth and Fire and Touch of Karma against Tiger
	// Palm and Jab. Wiring the declaration for this spec is `specs/windwalker/lib/index.ts` work and is not
	// this file's to do; what this file can do is stop the ledger below reading as though the gap were shut.
	{ dir: 'windwalker', config: WW_SPEC, ladder: WW_LADDER, unarbitrated: {} },
];

/**
 * On-GCD buttons that are neither a rung nor declared unarbitrated — so the walk still grades them.
 *
 * Read the note at the top of this file before editing. **This is no longer a list of buttons that need
 * no rung**; that premise was false and the header says why. Every entry here is a press the ladder is
 * still judging against a rung it was never meant to be judged against, so each one is one of two things
 * and has to say which: an argument that the *fault* is acceptable (the button belongs to no simulator
 * list at any count, so there is no rule to transcribe and nothing better to charge it to), or an open gap
 * awaiting the spec's own `unarbitrated` declaration. Neither answer to a new entry appearing here is
 * "add it to the list": a button the rotation presses belongs on the ladder, one the ladder delegates
 * belongs in that spec's declaration, and only what is genuinely neither belongs here.
 *
 * **The Elemental still has exactly one entry, and the three that used to be missing are the reason the
 * premise had to change rather than the exclusion list.** Thirteen of its abilities are on the GCD; ten
 * carry a rung — the last two, Chain Lightning and Lava Beam, since `e2f31a2` — three are declared
 * unarbitrated in `elemental/lib/apl.ts` (Stormlash Totem, Fire Elemental, Earth Elemental) and the
 * thirteenth is Magma Totem, which no Elemental list in the simulator presses at all. The narrower sweep
 * saw eight of the thirteen and so could not see the three; widening it is what makes this file cover the
 * class it claims to.
 *
 * So the remaining half of plan §41 was *bands*, not rungs, and that half has since been done: the ladder
 * declared `bands` on two entries and on no other, which is why all four forced walks used to collapse to
 * the same verdicts. They no longer do. Flame Shock became a per-band rule in `bf3e594`, and the five
 * rungs `aoe.apl.json` has no counterpart for are banded `[1, 2]`, so the forced walks read `phased`
 * 107/50 · 56/101 · 4/153 · 4/153, `unbroken` 97/43 · 50/90 · 0/140 · 0/140 and `cleave` 78/125 ·
 * 59/144 · 52/151 · 52/151 — each pull's `skipped` column two, two and one lower than it read before the
 * declaration, and its `followed` column untouched. The two single-target pulls collapsing to almost
 * nothing at bands 3 and 4 is the counterfactual being honest rather than a defect: they are Lightning
 * Bolt and Lava Burst pulls, and `aoe.apl.json` asks for neither.
 *
 * The first three Windwalker entries are the ones the ladder's own module doc argues, and that citation
 * used to be partial: `windwalker/lib/apl.ts` named Touch of Death outright and left Storm, Earth and Fire
 * and Touch of Karma covered by the cooldown-decisions bullet's *category* while its list enumerated
 * only Chi Brew, Tigereye Brew, Energizing Brew and Xuen. Both are named there now, so each reason
 * below is a one-line pointer at the argument rather than a second copy of it.
 */
const NOT_RUNGS: Record<string, Record<string, string>> = {
	elemental: {
		// **8190 is in none of the five Elemental presets** — `aoe`, `cleave`, `default`, `p4`, `p5` — so
		// there is no rule to transcribe. The sim's own AoE list is Flame Shock, potion, Lava Beam, Chain
		// Lightning, and a press of Magma Totem is measured against Chain Lightning because that is what
		// the list we transcribe says, not because we overlooked a rung. §91 took five rungs *out* of bands
		// 3 and 4 for having no counterpart in `aoe.apl.json`; inventing one for a button no list contains
		// would be that mistake in reverse.
		//
		// Declared as an ability regardless, and the argument for that is on the entry in
		// `elemental/lib/index.ts`: an undeclared cast id is skipped by the core's GCD walk, so every press
		// is priced at zero occupied time and `gcdUtilisationPct` — a graded metric — reads low. It appears
		// in no committed fixture (0 events against 4, 4 and 6 casts of Searing Totem), so nothing measured
		// can move on it either way.
		//
		// **It stays here rather than moving into `UNARBITRATED`, and the distinction is the point.** Nothing
		// judges Magma Totem: there is no section for it and no clock. So `off-list` would be an amnesty
		// here in a way it is not for the three delegated buttons, whose declaration points at a verdict
		// that exists. Charging a five-target Magma Totem against Chain Lightning is the sim's own answer to
		// "what should that global have been", and it is a better answer than silence.
		'magma-totem': 'in none of the five simulator lists — no rule to transcribe and no section to delegate to',
	},
	// **All six are open gaps, not exemptions.** This spec declares no `unarbitrated`, so every one of
	// these presses is walked down the ladder and charged to a rung — measured above on the captured pulls.
	// The three that were already here kept their arguments for *why a per-press verdict would be unfair*,
	// and those arguments still stand; what has changed is that the unfair verdict is being issued anyway,
	// so the reason is no longer also an account of what the report does. The three below them were
	// invisible to this file until the sweep stopped narrowing on `gate`.
	windwalker: {
		// `windwalker/lib/apl.ts:16-19`. Priority 3 tests `spellCanCast`, which in 5.4 means the target is
		// under 10% health. Health is not in the event stream this report fetches, so the condition is
		// undecidable — and `judge` stops at the first unreadable rule, so an undecidable rung at the top of
		// a ladder poisons every press below it into "cannot say". One press a pull, excluded rather than
		// guessed at.
		'touch-of-death': 'condition undecidable — target health is not in the event stream',
		// `windwalker/lib/apl.ts`, the Storm, Earth and Fire paragraph. The sim's own condition is a target
		// count and a rung could hold it; `SEF_SECOND_TARGET_MS` asks whether the second target lived long
		// enough to repay the spirit, and no band expresses a duration. Judged by `analysis.sef`.
		'storm-earth-and-fire': 'cooldown judged by its own section, on a duration no band can express',
		// `windwalker/lib/apl.ts`, the Touch of Karma paragraph — and `122470` is in no part of the sim's
		// Windwalker list at all. Judged by `analysis.karma`, on absorbed damage rather than a rotation.
		'touch-of-karma': 'defensive judged by its own section, on absorbed damage rather than a rotation',
		// The three the widened sweep found. None is in any part of the sim's Windwalker list, so none has a
		// rule to transcribe — but unlike Magma Totem all three are *pressed* in the captured pulls and so
		// are being charged to a rung today. `waves.json` charges two Leg Sweeps to Jab; `cleave.json`
		// charges Expel Harm to the Rushing Jade Wind opener and Flying Serpent Kick to Blackout Kick.
		'expel-harm': 'off the sim list entirely — an open gap: 1-5 presses a pull are charged to a rung',
		'flying-serpent-kick': 'a movement press off the sim list — an open gap, charged to a rung today',
		'leg-sweep': 'a stun off the sim list — an open gap, charged to a rung today',
	},
};

/**
 * Every button that costs one of the globals the ladder arbitrates — which is the only test that matters.
 *
 * `gate` is deliberately not read. See the header: a cooldown-gated on-GCD press is graded by the list
 * exactly as a conditional one is, and narrowing on `gate` hid the nine presses that proved it.
 */
const rotationalButtons = (abilities: readonly Ability[]): Ability[] => abilities.filter((ability) => ability.onGcd);

const name = (ability: Ability): string => `${ability.key} [${ability.castIds.join(', ')}]`;

describe('every rotational button either has a rung or a stated reason it does not', () => {
	for (const spec of SPECS) {
		const ledger = NOT_RUNGS[spec.dir] ?? {};
		const rungIds = new Set(spec.ladder.map((entry) => entry.id));
		const buttons = rotationalButtons(spec.config.registry.abilities);
		const hasRung = (ability: Ability): boolean => ability.castIds.some((id) => rungIds.has(id));
		/** Declared off the ladder's business, so the walk returns `off-list` and names where it is judged. */
		const declared = (ability: Ability): boolean => ability.castIds.some((id) => spec.unarbitrated[id] !== undefined);

		// The whole file is a sweep over two declarations, so a sweep that matched nothing would pass every
		// assertion below without reading a thing. The third expectation is the one that catches a broken
		// *join* rather than a broken filter: if `castIds` and `LadderEntry.id` ever stopped meeting, every
		// button would read as off-ladder and the failure would arrive as an unreadable list of gaps.
		it(`${spec.dir} has buttons and rungs to compare`, () => {
			expect(buttons.length).toBeGreaterThan(0);
			expect(rungIds.size).toBeGreaterThan(0);
			expect(buttons.filter(hasRung).length).toBeGreaterThan(0);
		});

		it(`${spec.dir} leaves no rotational button ungraded`, () => {
			const uncovered = buttons.filter(
				(ability) => !hasRung(ability) && !declared(ability) && ledger[ability.key] === undefined,
			);
			expect(
				uncovered.map(name).sort(),
				`${spec.dir} models ${uncovered.length} on-GCD button(s) with no rung in its ladder, no entry in its ladder's UNARBITRATED declaration, and no entry on this file's ledger. Decide each one: give it a rung if the rotation presses it, declare it unarbitrated if another section judges it, or add it to NOT_RUNGS with the argument for leaving the press charged to a rung.`,
			).toEqual([]);
		});

		/**
		 * The declaration is a claim about buttons this sweep sees, and one it must not make twice.
		 *
		 * Both directions matter and they fail differently. An id declared unarbitrated that this sweep
		 * cannot see is a declaration nothing will ever exercise — the walk only offers a verdict on an
		 * on-GCD press, so a stale or off-GCD id there is dead weight the next reader will trust. And a
		 * button that is *both* a rung and declared is a contradiction the engine resolves silently in
		 * favour of the declaration, because `judge` reads it before the walk: the rung would still be in
		 * the reference list, still be shown to the reader, and never once be reachable.
		 */
		// **This file checks the declaration exists; what checks that it is *wired* is elsewhere, on purpose.**
		// `AplInputs.unarbitrated` is read from the spec's ladder module here, and a spec could publish it and
		// forget to pass it — the walk would go on faulting the press while this sweep read green, which is
		// the exact failure mode the widened premise exists to catch. `fixtureCoverage.test.ts` holds the
		// other half: it carries a per-fixture `offList` column off the real `analyse` path, so unwiring the
		// declaration turns all four Elemental rows red. `addsThenBossLadder.test.ts` holds it per press.
		it(`${spec.dir} declares nothing this sweep cannot see, and nothing that has a rung`, () => {
			const swept = new Set(buttons.flatMap((ability) => ability.castIds));
			expect(
				Object.keys(spec.unarbitrated)
					.map(Number)
					.filter((id) => !swept.has(id)),
				`${spec.dir}: unarbitrated ids that are not on-GCD buttons of this spec`,
			).toEqual([]);
			expect(
				buttons
					.filter((ability) => declared(ability) && hasRung(ability))
					.map(name)
					.sort(),
				`${spec.dir}: buttons that are both a rung and declared unarbitrated`,
			).toEqual([]);
			// A declaration whose value is empty names no section, which is the whole of what stops it being
			// an amnesty — the press has to say where it *is* judged.
			for (const [id, section] of Object.entries(spec.unarbitrated)) {
				expect((section ?? '').trim().length, `${spec.dir}/${id} needs a section`).toBeGreaterThan(0);
			}
		});

		it(`${spec.dir} keeps the ledger honest — nothing excused that is gone, nothing excused that has a rung`, () => {
			// Stale: an excuse for a button this sweep no longer sees, because the ability was removed or
			// because it stopped being an on-GCD conditional press. Either way the reason is one nobody will
			// ever check again, and it reads to the next person as though a gap is still open.
			const swept = new Set(buttons.map((ability) => ability.key));
			expect(
				Object.keys(ledger)
					.filter((key) => !swept.has(key))
					.sort(),
				`${spec.dir}: ledger entries for buttons this sweep does not see`,
			).toEqual([]);

			// Redundant, and this is the direction that bites during concurrent work: plan §41 step 2 is
			// authoring rungs, and an entry that survives the rung it was excusing tells the next reader not
			// to look. Nothing else here notices — a button with a rung satisfies the assertion above, and it
			// is still an on-GCD ability so it is not stale either. A *declaration* retires an entry the same
			// way a rung does, and for the stronger reason: once the walk answers `off-list` the press is no
			// longer charged to anything, so the gap the entry was recording is shut.
			expect(
				buttons
					.filter((ability) => ledger[ability.key] !== undefined && (hasRung(ability) || declared(ability)))
					.map(name)
					.sort(),
				`${spec.dir}: ledger entries for buttons that now have a rung or a declaration`,
			).toEqual([]);

			// A ledger whose entries carry no argument is a filter with extra steps.
			for (const [key, reason] of Object.entries(ledger)) {
				expect(reason.trim().length, `${spec.dir}/${key} needs a reason`).toBeGreaterThan(0);
			}
		});
	}
});
