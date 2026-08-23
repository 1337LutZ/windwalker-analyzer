// The one fact a pull with no `combatantinfo` has to be able to state once.
//
// `equippedItems` and `knownTalents` are the two halves of the sim's `auraIsKnown`, and both are read off
// a single event. When that event is absent the gear half already withholds every press under a
// gear-gated rung — `aoe.apl.json` rung 1 opens on Breath of the Hydra — so the report is *already*
// printing a quarter of `addsThenBoss` as "could not be checked" with nothing on screen saying why. The
// count is in `priority.unjudged`; the cause is not anywhere. `AplAudit.characterUnread` is the cause,
// published once per walk instead of inferred from a pile of per-press `unknown`s.
//
// **This is the disposal the strict talent arm was waiting on, and the strict arm still did not land.**
// `talentGate.test.ts` holds the reason a talent row falls back to the press where a trinket cannot; the
// second measurement, taken with this field in hand, is in the last block below: at the silence the
// strict arm produces, the section's own headline turns into a 100% and a "nothing was passed over", and
// a note underneath cannot argue with the numbers above it.
//
// Every combatantinfo-less pull in this file is **synthetic** — built by filtering the event out of a
// committed fixture. All four committed pulls carry exactly one, which is asserted below rather than
// assumed, because the direction this field exists for is the one the fixture set cannot show.

import { describe, expect, it } from 'vitest';

import type { Analysis, CastMark, FightDataset, ResourceCurve } from '~/lib/types';
import { rawFixture, rawFixtures } from '~/lib/analysis/fixtures';
import { aplAudit, type AplInputs, type AplRule } from '~/lib/spec/apl';
import { analyse } from '~/specs/elemental/lib';

const LIGHTNING_BOLT = 403;
const noBar: ResourceCurve = { max: 0, points: [] };
const press = (t: number, id: number): CastMark => ({ t, id, name: `#${id}`, onGcd: true });

/** A ladder of one unconditional rung, so the flag is the only thing under test. */
const filler: AplRule = { key: 'below', id: LIGHTNING_BOLT, chiCost: 0, energyCost: 0, condition: () => true };

const walk = (over: Partial<AplInputs>) =>
	aplAudit(
		{
			casts: [press(20_000, LIGHTNING_BOLT)],
			energy: noBar,
			chi: noBar,
			regenPerSec: 0,
			gcdMs: 1500,
			pullMs: 300_000,
			auras: {},
			fofChannelSec: 0,
			targetsAt: () => 1,
			barsRequired: false,
			...over,
		},
		[filler],
	);

describe('the walk says once whether it was handed a character sheet', () => {
	it('reads the sheet as present when the spec wired either half and the log filled it', () => {
		expect(walk({ equippedItems: new Set([138_898]), knownTalents: new Set([117_013]) })?.characterUnread).toBe(false);
		// An empty set is a character with nothing in that half, which is a reading and not a silence — the
		// same distinction `AplInputs.equippedItems` draws between `null` and an empty kit.
		expect(walk({ equippedItems: new Set(), knownTalents: new Set() })?.characterUnread).toBe(false);
	});

	it('sets it on either half alone, because one missing event is what both nulls mean', () => {
		expect(walk({ equippedItems: null, knownTalents: new Set([117_013]) })?.characterUnread, 'kit').toBe(true);
		expect(walk({ equippedItems: new Set([138_898]), knownTalents: null })?.characterUnread, 'tree').toBe(true);
		expect(walk({ equippedItems: null, knownTalents: null })?.characterUnread, 'both').toBe(true);
	});

	it('leaves a ladder that asks about neither exactly where it was', () => {
		// `undefined` is the spec never having asked the question, which is not the log declining to answer
		// it. The Windwalker ladder gates no rung on the sheet, and a report of one of its pulls must not
		// start claiming the log was missing something it was never asked for.
		//
		// Asserted here rather than off a Windwalker pull, and that is a limit of the fixture set rather
		// than a choice: `dataset-ironJuggernaut` is the spec's only *raw* fixture and it carries no
		// resource readings, so `aplAudit` returns `null` for it before any of this is reached. The six
		// pulls that do have a ladder are committed as captured `Analysis` files, whose `apl` predates this
		// field — reading `undefined` off one of them would assert nothing about the engine.
		expect(walk({})?.characterUnread).toBe(false);
		expect(walk({ equippedItems: undefined, knownTalents: undefined })?.characterUnread).toBe(false);
	});

	it('does not vanish on a pull where the missing sheet happened to cost nothing', () => {
		// The tighter design — set it only where a verdict was actually withheld — is the wrong one, and this
		// is the row that pins the choice. Both single-target pulls below carry the flag with **zero**
		// unknowns, because the rungs that read the sheet are out of their band. A flag that appeared only
		// once the reader could already see the damage would be no use to the reader who cannot.
		expect(walk({ equippedItems: null })?.unknown).toBe(0);
		expect(walk({ equippedItems: null })?.characterUnread).toBe(true);
	});
});

const stripped = (dataset: FightDataset): FightDataset => ({
	...dataset,
	events: dataset.events.filter((event) => (event as { type?: string }).type !== 'combatantinfo'),
});

const ele = (name: string, transform: (d: FightDataset) => FightDataset = (d) => d): Analysis =>
	analyse(transform(rawFixture('elemental', `${name}.json`))) as Analysis;

const NAMES = ['unbroken', 'phased', 'cleave', 'addsThenBoss'] as const;

describe('the four committed pulls, and the same four with the event taken out', () => {
	it('finds a `combatantinfo` on every raw fixture both specs have committed', () => {
		// The claim behind the word *synthetic* at the top of this file, made over discovery rather than over
		// four names, so a fixture added without one fails here instead of quietly widening the sweep.
		for (const { name, dataset } of [...rawFixtures('elemental'), ...rawFixtures('windwalker')]) {
			const count = dataset.events.filter((event) => (event as { type?: string }).type === 'combatantinfo').length;
			expect(count, `${name} carries a combatantinfo`).toBe(1);
		}
	});

	it('reads the sheet on all four, at the natural walk and at every forced band', () => {
		for (const name of NAMES) {
			const analysis = ele(name);
			expect(analysis.apl?.characterUnread, `${name} natural`).toBe(false);
			for (const band of [1, 2, 3, 4] as const)
				expect(analysis.aplForced?.[band]?.characterUnread, `${name} band ${band}`).toBe(false);
		}
	});

	it('leaves every committed figure exactly where it was, with the controls beside them', () => {
		// **The controls are on the line beside their figures.** `phased` and `unbroken` never exceed one
		// enemy; `cleave` peaks at 13 and `addsThenBoss` at 9. Publishing a fact about the inputs must not
		// touch a verdict, and this is the row that would catch it if it did.
		const unbroken = ele('unbroken');
		expect(unbroken.targets?.counts.max).toBe(1);
		expect([unbroken.apl?.followed, unbroken.apl?.skipped, unbroken.apl?.unknown]).toEqual([97, 43, 0]);

		const phased = ele('phased');
		expect(phased.targets?.counts.max).toBe(1);
		expect([phased.apl?.followed, phased.apl?.skipped, phased.apl?.unknown]).toEqual([107, 50, 0]);

		const cleave = ele('cleave');
		expect(cleave.targets?.counts.max).toBe(13);
		expect([cleave.apl?.followed, cleave.apl?.skipped, cleave.apl?.unknown]).toEqual([131, 72, 0]);

		const addsThenBoss = ele('addsThenBoss');
		expect(addsThenBoss.targets?.counts.max).toBe(9);
		expect([addsThenBoss.apl?.followed, addsThenBoss.apl?.skipped, addsThenBoss.apl?.unknown]).toEqual([140, 264, 0]);
	});

	it('sets the flag on all four once the event is taken out, and names what it is already costing', () => {
		// **The measurement this field is justified by, and it is today's behaviour rather than a projection.**
		// Nothing about the talent gate is strict; these unknowns are the *gear* half alone, `aoe.apl.json`
		// rung 1 opening on a trinket that a log with no gear array cannot report. `unbroken` and `phased`
		// never leave band 1, where that rung is not in the list, so the sheet costs them nothing and they
		// still carry the flag. `cleave` and `addsThenBoss` reach it, and lose a quarter of the pull to it.
		const unknowns: Record<string, number> = { unbroken: 0, phased: 0, cleave: 40, addsThenBoss: 112 };
		for (const name of NAMES) {
			const analysis = ele(name, stripped);
			expect(analysis.apl?.characterUnread, `${name} natural`).toBe(true);
			for (const band of [1, 2, 3, 4] as const)
				expect(analysis.aplForced?.[band]?.characterUnread, `${name} band ${band}`).toBe(true);
			expect(analysis.apl?.unknown, `${name} unknowns the missing sheet already costs`).toBe(unknowns[name]);
		}
	});
});
