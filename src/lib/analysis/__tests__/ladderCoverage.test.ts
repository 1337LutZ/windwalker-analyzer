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
// globals the ladder arbitrates, so there is nothing to give it a rung against. `gate: 'conditional'`
// because that is the registry's own word for "only correct in specific situations, judged against those
// conditions" (`game/model.ts`), which is a description of a ladder rung. A cooldown-gated or
// resource-gated button is judged by its clock or its bar and needs no rung to be scored fairly.
//
// The match is `ability.castIds` against `LadderEntry.id`, and the indirection is load-bearing: a rung's
// key is the *rule's* name and not the button's, and one button carries several rungs while one rung's id
// is one of several cast ids. `tiger-palm-refresh` and `combo-breaker-palm` are both 100787; Jab logs six
// ids, one per weapon type. Matching on keys would report Jab and both Tiger Palm rules as gaps.
import { describe, expect, it } from 'vitest';

import type { Ability } from '~/lib/game/model';
import { ELEMENTAL_SPEC } from '~/specs/elemental';
import { LADDER_ENTRIES as ELE_LADDER } from '~/specs/elemental/lib/apl';
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
const SPECS = [
	{ dir: 'elemental', config: ELEMENTAL_SPEC, ladder: ELE_LADDER },
	{ dir: 'windwalker', config: WW_SPEC, ladder: WW_LADDER },
] as const;

/**
 * On-GCD conditional buttons that are deliberately not rungs, each with the reason.
 *
 * Read the note at the top of this file before editing. Neither answer to a new entry appearing here is
 * "add it to the list": a button the rotation presses belongs on the ladder, and one the ladder cannot
 * fairly judge belongs here with the argument written out.
 *
 * **The Elemental's list is empty, and that is a measurement.** All seven of its on-GCD conditional
 * abilities have a rung — the last two, Chain Lightning and Lava Beam, since `e2f31a2`. So the remaining
 * half of plan §41 is *bands*, not rungs: that ladder declares `bands` on those two entries and on no
 * other, which is why all four forced walks collapse to the same verdicts (`phased` 107/52 then 53/106
 * ×3, `unbroken` 97/45 then 46/96 ×3, `cleave` 78/126 then 58/146 ×3).
 *
 * The three Windwalker entries are the ones the ladder's own module doc argues, and the citation is
 * partial in a way worth knowing: `windwalker/lib/apl.ts:16-19` names Touch of Death outright, and
 * `:20-23` gives the cooldown-decisions argument the other two rest on while enumerating only Chi Brew,
 * Tigereye Brew, Energizing Brew and Xuen. Storm, Earth and Fire and Touch of Karma are covered by that
 * bullet's category and not by its list, so the reasons are restated here rather than pointed at.
 */
const NOT_RUNGS: Record<string, Record<string, string>> = {
	elemental: {},
	windwalker: {
		// `windwalker/lib/apl.ts:16-19`. Priority 3 tests `spellCanCast`, which in 5.4 means the target is
		// under 10% health. Health is not in the event stream this report fetches, so the condition is
		// undecidable — and `judge` stops at the first unreadable rule, so an undecidable rung at the top of
		// a ladder poisons every press below it into "cannot say". One press a pull, excluded rather than
		// guessed at.
		'touch-of-death': 'condition undecidable — target health is not in the event stream',
		// A cooldown decision rather than a filler decision, and the sharper half of that argument is what
		// its own section asks: `SEF_SECOND_TARGET_MS` (`windwalker/lib/index.ts:356`) tests whether the
		// second target lives long enough to repay the spirit. That is a duration, and no band can express a
		// duration — so a rung here could not restate the question, only a worse version of it. Judged by
		// `analysis.sef`; grading it twice would double-count one mistake.
		'storm-earth-and-fire': 'cooldown judged by its own section, on a duration no band can express',
		// The same double-counting argument, on a mitigation question the ladder has no shape for at all.
		// `analysis.karma` scores it on what it reflected and absorbed against the cap the log reveals — a
		// press is right or wrong by the damage that was incoming, which is not a rotational condition and
		// not a thing a filler rung can read.
		'touch-of-karma': 'defensive judged by its own section, on absorbed damage rather than a rotation',
	},
};

/** The registry's own words for a rotational button: it costs a global, and it is judged on conditions. */
const rotationalButtons = (abilities: readonly Ability[]): Ability[] =>
	abilities.filter((ability) => ability.onGcd && ability.gate === 'conditional');

const name = (ability: Ability): string => `${ability.key} [${ability.castIds.join(', ')}]`;

describe('every rotational button either has a rung or a stated reason it does not', () => {
	for (const spec of SPECS) {
		const ledger = NOT_RUNGS[spec.dir] ?? {};
		const rungIds = new Set(spec.ladder.map((entry) => entry.id));
		const buttons = rotationalButtons(spec.config.registry.abilities);
		const hasRung = (ability: Ability): boolean => ability.castIds.some((id) => rungIds.has(id));

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
			const uncovered = buttons.filter((ability) => !hasRung(ability) && ledger[ability.key] === undefined);
			expect(
				uncovered.map(name).sort(),
				`${spec.dir} models ${uncovered.length} on-GCD conditional button(s) with no rung in its ladder and no entry on this file's ledger. Decide each one: give it a rung if the rotation presses it, or add it to NOT_RUNGS with the reason a per-press verdict would be unfair.`,
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
			// is still an on-GCD conditional ability so it is not stale either.
			expect(
				buttons
					.filter((ability) => ledger[ability.key] !== undefined && hasRung(ability))
					.map(name)
					.sort(),
				`${spec.dir}: ledger entries for buttons that now have a rung`,
			).toEqual([]);

			// A ledger whose entries carry no argument is a filter with extra steps.
			for (const [key, reason] of Object.entries(ledger)) {
				expect(reason.trim().length, `${spec.dir}/${key} needs a reason`).toBeGreaterThan(0);
			}
		});
	}
});
