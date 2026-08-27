// Every spec's ladder against the simulator's own priority list, so a hand-written copy cannot go stale
// in silence.
//
// Each `src/specs/<spec>/lib/apl.ts` is a ladder of rungs written by hand from a wowsims APL. That is a
// copy of somebody else's list, living in another repository on another release cycle — and when the
// original changes, nothing here breaks. The rotation still renders, every test still passes, and the
// section is simply wrong about what to press.
//
// So this pins the comparison. `src/generated/sim-apl.json` is refreshed weekly from
// `wowsims/mop@master`; when it moves, the two lists below stop agreeing and this test says exactly which
// spell appeared or vanished. **The failure is the feature.** It is meant to fire on the refresh pull
// request, where a person can decide whether the ladder needs a new rung, the prose needs a rewrite, or
// the change is a cooldown this repository deliberately does not model.
//
// It asserts nothing about *order*. The sim's list is a program with conditions, groups and strict
// sequences; the ladder is a reading order for a person. Two rungs that differ only by condition collapse
// to one spell here, so an order assertion would fail constantly and mean nothing.

import { describe, expect, it } from 'vitest';

import { simSpecFor, simSpellsFor } from '~/lib/spec/simApl';
import { LADDER_ENTRIES as ELEMENTAL } from '~/specs/elemental/lib/apl';
import { LADDER_ENTRIES as PROTECTION } from '~/specs/protection/lib/apl';
import { LADDER_ENTRIES as WINDWALKER } from '~/specs/windwalker/lib/apl';

/**
 * The ladders, listed rather than walked.
 *
 * `SpecDefinition` does not carry its spec's APL yet — `registry.ts` says `apl` joins the definition as
 * later work — so until it does, a cross-spec test has to name the three imports. When that lands this
 * becomes a walk of `SPECS` and a spec registered afterwards is covered with no edit here.
 */
const LADDERS: ReadonlyArray<readonly [string, ReadonlyArray<{ id: number; key: string }>]> = [
	['windwalker', WINDWALKER],
	['elemental', ELEMENTAL],
	['protection', PROTECTION],
];

/**
 * Where this repository and the simulator call one button by two different ids.
 *
 * **Rising Sun Kick is the whole list, and it is a real difference rather than a mistake on either side.**
 * WarcraftLogs reports the monk's press as 107428 and every event this analyser reads carries that id, so
 * that is what the ladder is keyed on. The sim's APL casts 130320. Both are "Rising Sun Kick" in the spell
 * map. Without this entry the comparison below reports the rung as missing from the sim for ever.
 */
const ALIASES: Readonly<Record<number, number>> = { 107428: 130320 };

/**
 * Ladder rungs the simulator does not cast, with the reason each one is allowed to stand.
 *
 * A rung in here is an open question rather than a settled exemption — it says somebody looked, not that
 * the difference is fine.
 */
const LADDER_ONLY: Readonly<Record<number, string>> = {
	// The paladin's AoE strike. No APL on master casts it: the three Protection lists there are
	// fight-specific (Horridon, Iron Juggernaut, Sha) and all of them cast Crusader Strike instead. The
	// sim has no `default.apl.json` for this spec at all, so there is no single-target list to check it
	// against, and the rung stays until one appears.
	53595: 'Hammer of the Righteous — no Protection default APL exists on master to confirm it against',
};

/**
 * Spells the simulator casts that no ladder models, and why each is out of scope.
 *
 * **This list is the alarm.** Everything in it was read once and classified; a spell that appears in a
 * refreshed snapshot and is not here fails the test, which is the moment somebody should look at whether
 * the rotation section needs it. Grouped by the reason, because the reasons are what a reviewer checks.
 */
const SIM_ONLY: Readonly<Record<string, readonly number[]>> = {
	// Cooldowns each judged by a section of their own. `apl.ts` gives this reason itself: they are
	// decisions about a cooldown rather than about which filler global to press, and grading them inside
	// a filler ladder would double-count them.
	cooldowns: [
		115080, 115399, 115288, 1247275, 138228, 2894, 2062, 114049, 16166, 30823, 51490, 31884, 498, 86659, 31850, 53600,
		105809, 114916, 114158, 114852,
	],
	// Raid buffs and externals. Cast by somebody else, or on somebody else, and never a rung.
	raid: [120668, 114206, 2825, 114030, 97462, 33206],
	// Racials and profession or trinket actives, which the sim models and this repository does not grade.
	racials: [33697, 26297, 129597, 126734, 121279, 126456, 121283, 138310],
	// Stances, and the healing talents a Windwalker may take instead of Chi Wave. Real presses, but not
	// part of any ladder here — Chi Wave is the one the ladder models and the other two are its siblings.
	talentsAndStances: [103985, 124081, 123986],
	// The paladin's self-heal talent row, and Sacred Shield. Judged elsewhere or not at all.
	paladinUpkeep: [20925, 114163],
};

const ALL_SIM_ONLY = new Set(Object.values(SIM_ONLY).flat());

describe.each(LADDERS)('%s against the simulator', (specKey, ladder) => {
	const sim = new Set(simSpellsFor(specKey));
	const ladderIds = [...new Set(ladder.map((entry) => ALIASES[entry.id] ?? entry.id))];

	/** A snapshot with no APLs for this spec would make every assertion below pass vacuously. */
	it('has a snapshot to compare against', () => {
		const spec = simSpecFor(specKey);
		expect(spec, `no sim-apl.json entry for ${specKey}`).not.toBeNull();
		expect(Object.keys(spec?.files ?? {}).length, spec?.note ?? 'no APL files').toBeGreaterThan(0);
	});

	/**
	 * A rung the sim stopped casting is the drift that matters most: the section tells a reader to press
	 * something the current model does not.
	 */
	it('presses every button the ladder does', () => {
		const missing = ladderIds.filter((id) => !sim.has(id) && LADDER_ONLY[id] === undefined);
		expect(missing, `ladder rungs the sim never casts: ${missing.join(', ')}`).toEqual([]);
	});

	/**
	 * And the other direction: a spell the sim added that nothing here has classified. Failing is correct —
	 * somebody has to decide whether it is a new rung or another cooldown.
	 */
	it('casts nothing unclassified', () => {
		const unknown = [...sim].filter((id) => !ladderIds.includes(id) && !ALL_SIM_ONLY.has(id));
		expect(unknown, `sim casts these and no ladder or exemption covers them: ${unknown.join(', ')}`).toEqual([]);
	});
});

describe('the exemption lists', () => {
	/**
	 * A ladder exemption stops being true the moment the sim starts casting the rung.
	 *
	 * **This is how the Protection paladin's open question closes itself.** `53595` is exempt because no
	 * APL on master casts it — there is no Protection `default.apl.json` to check it against. When one
	 * appears and casts Hammer of the Righteous, this fails and says to delete the entry, rather than
	 * leaving a stale "somebody looked once" note in front of the next reader.
	 */
	it('exempts only rungs the sim still does not cast', () => {
		const settled = Object.entries(LADDER_ONLY)
			.filter(([id]) => LADDERS.some(([key]) => simSpellsFor(key).includes(Number(id))))
			.map(([id, reason]) => `${id} (${reason})`);
		expect(settled, `the sim now casts these, so the exemption can go: ${settled.join('; ')}`).toEqual([]);
	});

	/** An exemption for a spell the sim no longer casts is dead weight that hides the next real change. */
	it('names only spells some spec still casts', () => {
		const everywhere = new Set(LADDERS.flatMap(([key]) => simSpellsFor(key)));
		const dead = [...ALL_SIM_ONLY].filter((id) => !everywhere.has(id));
		expect(dead, `exempted but no longer in any APL: ${dead.join(', ')}`).toEqual([]);
	});

	/** The same id classified twice would make the reason ambiguous. */
	it('classifies each spell once', () => {
		const flat = Object.values(SIM_ONLY).flat();
		expect(flat).toHaveLength(new Set(flat).size);
	});
});
