// Whether the player took Elemental Mastery, published rather than left as "cannot say".
//
// **The gate already existed and had nothing to read.** `components/sections/gates.ts` hides the section
// only on positive evidence that the talent was not taken, and read the answer off
// `elementalMastery.talented` — a field the audit did not publish, so every pull answered `null` and every
// report carried a section about a button the player may never have had. The field is the audit's to
// publish because a second `readTalents` call in the components would be a second answer to one question,
// and because an `Analysis` does not carry the events to read.
//
// **Three answers and not two.** A `combatantinfo` list that does not name 16166 is a real "not talented";
// a report with no list at all has said nothing. Inferring the talent from whether the button was ever
// cast is the reading this replaces and it cannot tell those apart — a player who took it and forgot it
// looks exactly like a player who did not take it, and the forgotten cooldown is the fault most worth
// reporting.
//
// The id itself: 16166 is tier 4 column 0 of the shaman tree (`ui/core/talents/trees/shaman.json:87-93`),
// gated at `sim/shaman/talents.go:37`. Ascendance (114049) is deliberately *not* given the same field —
// it appears in none of the tree's eighteen entries and is registered unconditionally at
// `sim/shaman/shaman.go:245`, so there is no talent to read and no section to gate.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { rawFixtures } from '~/lib/analysis/fixtures';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';
import { analyse } from '../index';

const ELEMENTAL_MASTERY = 16_166;

/**
 * Every raw Elemental pull, found rather than listed.
 *
 * **This was `['phased', 'unbroken', 'cleave']`, and the literal was the whole of the risk.** The claim
 * below is a universal over the committed set — "none of them took it" — so a fourth fixture that *had*
 * taken the talent would have walked past a hardcoded three without a word, which is the failure mode
 * `analysis/fixtures.ts`' own docblock was written about. `addsThenBoss.json` landed and is swept by this
 * automatically; so is the fifth.
 */
const FIXTURES = rawFixtures('elemental').map(({ name }) => name.replace(/\.json$/, ''));

const load = (name: string): FightDataset =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8')) as FightDataset;

const talentsOf = (dataset: FightDataset): number[] | null => {
	const info = dataset.events.find((e) => e.type === 'combatantinfo' && e.sourceID === dataset.actor.id);
	const talents = (info as { talents?: { id: number }[] } | undefined)?.talents;
	return talents === undefined ? null : talents.map((t) => t.id);
};

describe('the talent the section is gated on', () => {
	/**
	 * All **four** committed pulls carry a talent list and none of them names 16166, so all four read
	 * `false` — which makes the Elemental Mastery section vanish on every reference report. That is the
	 * visible consequence of this field and it is asserted rather than discovered: the section used to
	 * render with an empty table and a note saying the talent could not be read.
	 *
	 * `addsThenBoss` did not move it: its shaman took 108271/108273/108285/108283/108281/117013 and no
	 * fourth-tier Elemental Mastery either, so the fourth log widens the evidence without changing the
	 * conclusion. The set is now discovered rather than listed, so a fifth pull that *did* take it would
	 * fail here by name.
	 *
	 * The premise is re-derived from each fixture's own `combatantinfo` rather than written down, so a
	 * fixture recaptured from a shaman who *did* take the talent fails here instead of silently inverting
	 * the claim.
	 */
	it('reads false on every committed pull, because none of them took it', () => {
		for (const name of FIXTURES) {
			const dataset = load(name);
			const talents = talentsOf(dataset);
			// Not vacuous: the log really did carry a list, so `false` is evidence and not an absence.
			expect(talents, name).not.toBeNull();
			expect(talents, name).not.toContain(ELEMENTAL_MASTERY);

			const el = analyse(dataset) as Analysis & ElementalAuditResult;
			expect(el.elementalMastery.talented, name).toBe(false);
		}
	});

	/**
	 * A pull whose log carried no `combatantinfo` says nothing, and must not be rendered as a choice.
	 *
	 * Built by stripping the event from a real fixture rather than from a synthetic dataset, so the only
	 * difference between this reading and the one above is the evidence itself.
	 */
	it('reads null when the log carried no talent list at all', () => {
		const dataset = load('phased');
		const stripped: FightDataset = { ...dataset, events: dataset.events.filter((e) => e.type !== 'combatantinfo') };
		const el = analyse(stripped) as Analysis & ElementalAuditResult;
		expect(el.elementalMastery.talented).toBeNull();
		// The presses are untouched by the talent read — it gates a section, it does not judge a press.
		expect(el.elementalMastery.presses).toEqual(
			(analyse(dataset) as Analysis & ElementalAuditResult).elementalMastery.presses,
		);
	});
});
