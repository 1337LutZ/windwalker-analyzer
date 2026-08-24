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
import { LADDER_ENTRIES as WW_LADDER, UNARBITRATED as WW_UNARBITRATED } from '~/specs/windwalker/lib/apl';
import { SPEC_SECTIONS } from '~/components/report/specSections';

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
	// **The Windwalker declares two of its six, and the four it does not are the point of the split.** Its
	// ladder can reach the engine's fall-through — it is written in units of energy and chi, so a rung it
	// cannot pay for declines — and its captured pulls carried a non-zero `offList` before any declaration
	// existed, which is why the two arms of that verdict have to be read apart. What the declaration moved,
	// measured off those pulls: 16 presses on `waves`, 6 on `cleave`, 3 each on `mixed` and `poor`, 2 on
	// `strong`, 1 on `weave` — and `followed` untouched on all six. What it left alone is the ledger below.
	{ dir: 'windwalker', config: WW_SPEC, ladder: WW_LADDER, unarbitrated: WW_UNARBITRATED },
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
 * **The Elemental has three entries, and the three that used to be *missing* are the reason the premise
 * had to change rather than the exclusion list.** Fifteen of its abilities are on the GCD; ten carry a
 * rung — the last two, Chain Lightning and Lava Beam, since `e2f31a2` — three are declared unarbitrated in
 * `elemental/lib/apl.ts` (Stormlash Totem, Fire Elemental, Earth Elemental), and the remaining two are
 * below beside Magma Totem: Frost Shock and Earthquake, declared as abilities so their presses stop being
 * priced at zero and given no rung because no committed pull presses either. The narrower sweep saw eight
 * of the thirteen this spec then had and so could not see the three delegated ones; widening it is what
 * makes this file cover the class it claims to.
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
 * **The Windwalker went from six entries to four, and the two that left are the shape of the answer this
 * ledger is for.** All six were on-GCD buttons with no rung, all six were being charged to one, and the
 * fix was not the same for all six: Storm, Earth and Fire and Touch of Karma each have a section in this
 * report that judges the press — `sef` and `karma` — so they moved into `windwalker/lib/apl.ts`'
 * `UNARBITRATED` and the walk now answers `off-list` naming it. The four below have no section, no clock
 * and no rule in the sim's list to transcribe, so a declaration would name nowhere; they stay charged.
 * `specs/windwalker/lib/__tests__/unarbitrated.test.ts` asserts both halves per press, because this file
 * reads declarations and never verdicts.
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
		// **The two buttons the model had no entry for at all, and the entry that matters is Earthquake.**
		// Both were declared in `elemental/lib/index.ts` for one reason, which is not a rotation claim: an
		// undeclared cast id never reaches `onGcdStarts` (`analyseCore.ts:629-630` asks `abilityByCastId` and
		// `continue`s), so every press occupies **zero** milliseconds and `gcdUtilisationPct` — a graded
		// metric — reads low for the player who presses it. Earthquake is the expensive one because it is
		// the only unmodelled press in this spec that carries a cast bar: `sim/shaman/elemental/
		// earthquake.go:36` is `CastTime: 2500 * time.Millisecond`, and `analyseCore.ts:673` prices a press
		// at `max(effectiveGcd, measured cast)` — 1.2–1.5s on the committed pulls against an effective
		// global of 1.04–1.14s — so each press was losing a cast bar rather than a global.
		//
		// **Neither gets a rung, and that is the same distinction Magma Totem's entry draws above.** Whether
		// a rotation *should* press either one is a claim about the rotation, and the evidence for it is not
		// here: 61882, 77478 and 8056 appear **zero** times across all four committed fixtures, so there is
		// no pull on which a rung could be checked and nothing measured moves either way. Nor do they belong
		// in `UNARBITRATED`: nothing judges them — no section, no clock — so `off-list` would be an amnesty
		// rather than a pointer at a verdict that exists. A press is charged to whatever rung the list
		// wanted for that global, which is the simulator's own answer to what the global should have been,
		// and a better answer than silence.
		//
		// The two differ in *why* there is no rule to transcribe, which is why they are two entries and not
		// one. Frost Shock is a shaman button the Elemental lists simply never ask for; Earthquake is the
		// spec's own AoE spell, so its absence from the lists is a statement about those lists.
		'frost-shock':
			'the third shock, in none of the five simulator lists — no rule to transcribe and no section to delegate to',
		earthquake:
			'in none of the five simulator lists and pressed on no committed pull — a rung would be a rotation claim with no evidence behind it',
	},
	// **Four of the six, and the two that left are why the remaining four are not a to-do list.** Storm,
	// Earth and Fire and Touch of Karma were here, arguing that a per-press verdict would be unfair to
	// them, and both now carry a declaration in `windwalker/lib/apl.ts` naming the section that judges the
	// press instead — `sef` and `karma`, sections this report really has, both rendering per-press rows and
	// the second of them *grading* what it finds. The four below have no such section anywhere in the
	// report, which is exactly the test: `off-list` says the list has no opinion, and a button nothing else
	// has an opinion about either would leave the report silent on a global that was really spent. Charging
	// it to the rung the list would have spent that global on is the simulator's own answer to what it
	// should have been, and a worse answer than that is silence rather than a fault.
	windwalker: {
		// **The one entry here that is a gap in the ladder rather than a button off it, and so the one that
		// must not be declared.** What this button wants is a rung: it is priority 3 of the sim's own list,
		// which is a stronger claim on a rung than anything the ladder already carries. `off-list` would
		// answer the opposite — "not a rotational button" — about the list's top press. Pressed in none of
		// the six captured pulls (0 cast rows across all six), so nothing measured moves on it either way,
		// and the entry is here to keep the gap named rather than to account for a figure.
		//
		// This reason used to read "the condition is target health, which this event stream does not carry",
		// and both halves of that were wrong. **Target health is not what the sim tests.** Priority 3's
		// `spellCanCast(115080)` resolves to `sim/monk/touch_of_death.go:40-42` —
		// `(hasGlyph || GetChi() >= 3) && GetRemainingDuration() <= 1s` — which is chi and how much of the
		// pull is left, and the ladder already reads both (`state.chi`, and `state.pullMs - state.t`, the
		// same `pullMs` the short-pull rung reads). The rung is expressible; it was never the arithmetic.
		//
		// What blocks it is that `GetRemainingDuration` is the sim's stand-in for execute range, because a
		// wowsims boss has no health pool to test. On a kill the stand-in holds; on a **wipe** `pullMs` is
		// when the raid died and the boss was nowhere near executable, so the rung would tell every wiping
		// raid to press a button that was not castable. `fight.kill` is fetched and reaches the analysis
		// (`analyseCore.ts:1357`) but not `AplInputs`, and that missing predicate is the whole of it.
		// `windwalker/lib/apl.ts` carries the argument and the measured cost of landing it anyway.
		'touch-of-death':
			'a rung it cannot have yet — the condition is chi and remaining fight duration, and the walk cannot tell a kill from a wipe',
		// The three the widened sweep found, and the Magma Totem case in the Elemental ledger above: in no
		// part of the sim's Windwalker list, so no rule to transcribe, and no section and no clock anywhere
		// in this report, so nothing to delegate to. Unlike Magma Totem all three are *pressed* on real
		// pulls — 5 Expel Harms on `mixed`, 2 Leg Sweeps and 2 Flying Serpent Kicks on `waves` — so each is
		// a press charged to a rung today, and each is charged deliberately.
		'expel-harm': 'off the sim list, and played for the heal — no rule to transcribe and no section to delegate to',
		'flying-serpent-kick': 'a movement press off the sim list — no rule to transcribe and no section to delegate to',
		'leg-sweep': 'a stun off the sim list — no rule to transcribe and no section to delegate to',
	},
};

/**
 * Every section this report can actually render for a spec, so a declaration cannot point at nowhere.
 *
 * The whole of what keeps `unarbitrated` from being an amnesty is that its value names *where the press
 * is judged instead*, and a string is free to name a section that was renamed, moved or never existed —
 * at which point the press has been excused and the pointer goes nowhere, which is worse than the fault
 * it replaced because it reads as an answer. `SPEC_SECTIONS` is the list the page and the contents list
 * are both built from, so it is the only definition of "a section this report has" that cannot drift.
 */
const sectionIds = (dir: string): Set<string> => new Set((SPEC_SECTIONS[dir] ?? []).map((section) => section.id));

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
		//
		// **That grid cannot hold the Windwalker's half**, which is worth stating here because it is the
		// reason the two specs are guarded differently. It re-analyses raw `FightDataset`s, and this spec's
		// only raw fixture carries no `classResources` — so its audit is `null` by the bars gate and its row
		// is `null` too. The six pulls under `windwalker/__fixtures__` are captured `Analysis` output, whose
		// `apl` block is frozen at whatever the engine said when they were written. So the wiring is held
		// per press on a synthetic pull instead: `specs/windwalker/lib/__tests__/unarbitrated.test.ts`.
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
			// And a value naming a section that does not exist is the same amnesty with a plausible excuse
			// attached. Checked against `SPEC_SECTIONS` — the list the page itself is built from — so a
			// section renamed or removed takes the declaration that pointed at it down with it rather than
			// leaving a press excused and a reader following a name to nothing. See `sectionIds`.
			const rendered = sectionIds(spec.dir);
			expect(rendered.size, `${spec.dir} renders no sections — SPEC_SECTIONS is keyed some other way`).toBeGreaterThan(
				0,
			);
			expect(
				Object.entries(spec.unarbitrated)
					.filter(([, section]) => !rendered.has(section ?? ''))
					.map(([id, section]) => `${id} -> ${String(section)}`)
					.sort(),
				`${spec.dir}: unarbitrated values that name no section this report renders`,
			).toEqual([]);
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
