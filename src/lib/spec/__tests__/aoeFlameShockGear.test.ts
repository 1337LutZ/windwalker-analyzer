// The one rung in either ladder that is gated on owning a *thing*, and the seam that lets it ask.
//
// `aoe.apl.json` rung 1 is `auraIsKnown(138898) AND not(dotIsActive(8050))`. The first half is Breath of
// the Hydra, and `elemental/lib/apl.ts` resolved it to **owned on every pull** — a constant standing in
// for a question no input could ask, because `AplInputs` had no gear and no aura-known field of any kind.
// So a shaman without the trinket was walked down a list that never asks them for Flame Shock, and every
// press they made at three targets and up was measured against a rung the sim would not have offered.
//
// **`auraIsKnown` is one verb doing two jobs**, which is why the field added for this is item ids rather
// than "known auras": the Elemental presets test 117012 through it — the Unleashed Fury talent — and
// 138898, a trinket proc. The log answers those from two different fields of the same `combatantinfo`
// (the talent list and the gear array), and only the second is what this file is about. The talent half
// stays on `AplRule.talent`; see `FS_CLEAVE_OVERLAP_MS` in `elemental/lib/apl.ts`.
//
// And it is a **gear** question, not an uptime one. `auraIsKnown` is answered off the auras registered on
// the unit, and a trinket registers its proc when it is equipped, so a pull that wore the trinket and
// never procced it still owns it. Nothing here reads a 138898 window, and the synthetic pulls below carry
// none at all.
//
// Both directions are real for the first time in the committed set: `addsThenBoss.json`'s shaman wears
// item 96455 and the other three fixtures wear no variant of it.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Analysis, CastMark, FightDataset, ResourceCurve } from '~/lib/types';
import { aplAudit, type AplInputs, type AplRule, type State } from '~/lib/spec/apl';
import { analyse } from '~/specs/elemental/lib';
import { LADDER } from '~/specs/elemental/lib/apl';

const CHAIN_LIGHTNING = 421;
/** The heroic Throne of Thunder id `addsThenBoss.json`'s shaman actually wears. */
const HYDRA_HEROIC = 96_455;
/** The base id and the top upgrade step, so a list that carried only the fixture's id would fail. */
const HYDRA_BASE = 94_521;
const HYDRA_TOP = 96_827;
/** Kardris' Toxic Totem, which three of the four pulls do wear — a trinket that is not this one. */
const NOT_HYDRA = 104_544;

const press = (t: number, id: number): CastMark => ({ t, id, name: `#${id}`, onGcd: true });
const noBar: ResourceCurve = { max: 0, points: [] };

/**
 * The Elemental ladder's inputs with the dot **down**, which is what makes the rung under test reachable.
 *
 * `remaining = 0` satisfies every band's Flame Shock clause — `<= 3s`, `<= 2s` and `<= 0` — so the only
 * thing that can stop the rung at band 3 is the trinket half. That is the whole point of pinning it here
 * rather than at the twenty seconds `multiTargetRungs.test.ts` uses: this file needs the rung to want the
 * button, so that a refusal is provably the gear read and not the clock.
 */
const eleInputs = (over: Partial<AplInputs>): AplInputs => ({
	casts: [],
	energy: noBar,
	chi: noBar,
	regenPerSec: 0,
	gcdMs: 1500,
	pullMs: 300_000,
	auras: {},
	auraRemainingAt: { 'flame-shock': () => 0 },
	fofChannelSec: 0,
	targetsAt: () => 1,
	barsRequired: false,
	...over,
});

/** The verdict and the rung the list wanted, for a single Chain Lightning judged at one band. */
const judge = (band: 1 | 2 | 3 | 4, over: Partial<AplInputs>) => {
	const audit = aplAudit(eleInputs({ casts: [press(10_000, CHAIN_LIGHTNING)], forceBand: band, ...over }), LADDER);
	const first = audit?.presses[0];
	return { wanted: first?.wanted ?? null, verdict: first?.verdict ?? null };
};

describe('the aoe list asks for Flame Shock only from a shaman who owns the trinket', () => {
	it('wants the dot at three targets when the kit carries Breath of the Hydra', () => {
		expect(judge(3, { equippedItems: new Set([NOT_HYDRA, HYDRA_HEROIC]) })).toEqual({
			wanted: 'flame-shock',
			verdict: 'skipped',
		});
	});

	it('does not want it at three targets from a kit without the trinket, and falls to the button that list presses', () => {
		// **This is the assertion the constant used to hide.** With `auraIsKnown(138898)` resolved to owned,
		// this column read `flame-shock` / `skipped` — the shaman was charged for passing over a rung
		// `aoe.apl.json` would not have offered them. Chain Lightning is what that list actually presses here,
		// and the press was a Chain Lightning, so the verdict is `followed`.
		expect(judge(3, { equippedItems: new Set([NOT_HYDRA]) })).toEqual({
			wanted: 'chain-lightning',
			verdict: 'followed',
		});
	});

	it('answers `unknown` for a pull that carried no gear at all, rather than reading silence as unequipped', () => {
		// A log with no `combatantinfo` has said nothing about the kit. `'unknown'` is the same three-valued
		// discipline the nullable bars keep, and the walk's own answer for a rung it cannot read: the press is
		// not graded, rather than graded against a trinket nobody looked at.
		expect(judge(3, { equippedItems: null })).toEqual({ wanted: null, verdict: 'unknown' });
		// Absent is the same fact as null — a spec that never wired the field has not made a claim either.
		expect(judge(3, {})).toEqual({ wanted: null, verdict: 'unknown' });
	});

	it('accepts every upgrade step of the trinket, not only the id the fixture happens to wear', () => {
		// A list carrying 96455 alone would pass the fixture rows below and be wrong for every player on a
		// normal-mode or fully upgraded one.
		for (const id of [HYDRA_BASE, HYDRA_TOP]) {
			expect(judge(3, { equippedItems: new Set([id]) }).wanted, `item ${id}`).toBe('flame-shock');
		}
	});

	it('leaves bands 1 and 2 alone, where the rung is not the aoe list at all', () => {
		// p5 rung 7/12 and `cleave.apl.json` rung 9 carry no `auraIsKnown` term, so an empty kit must not
		// touch them. Same empty kit, same pull, and both bands still want the dot.
		const bare = { equippedItems: new Set([NOT_HYDRA]) };
		expect(judge(1, bare).wanted).toBe('flame-shock');
		expect(judge(2, bare).wanted).toBe('flame-shock');
	});
});

describe('the seam that carries it, independent of any spec', () => {
	// A ladder of one rung whose condition reports what it was handed. This is the plumbing test: the field
	// is on `AplInputs`, the rule reads it off `State`, and nothing in between is allowed to invent a value.
	const seen: Array<ReadonlySet<number> | null> = [];
	const spy: AplRule = {
		key: 'spy',
		id: CHAIN_LIGHTNING,
		chiCost: 0,
		energyCost: 0,
		condition: (state: State) => {
			seen.push(state.equippedItems);
			return true;
		},
	};

	it('hands the rule the set the spec supplied, and null when the spec supplied none', () => {
		seen.length = 0;
		const kit = new Set([HYDRA_HEROIC]);
		aplAudit(eleInputs({ casts: [press(0, CHAIN_LIGHTNING)], equippedItems: kit }), [spy]);
		aplAudit(eleInputs({ casts: [press(0, CHAIN_LIGHTNING)] }), [spy]);
		expect(seen).toEqual([kit, null]);
		// The same set, not a copy of it: a rung asking `kit.has(id)` must be asking about the kit the audit
		// was given.
		expect(seen[0]).toBe(kit);
	});
});

const load = (name: string): Analysis =>
	analyse(
		JSON.parse(
			readFileSync(resolve(import.meta.dirname, `../../../specs/elemental/__fixtures__/${name}.json`), 'utf8'),
		) as FightDataset,
	) as Analysis;

const cleave = load('cleave');
const phased = load('phased');
const unbroken = load('unbroken');
const addsThenBoss = load('addsThenBoss');

/** Skips charged to one rung on a walk, or 0 where the rung charged none. */
const skips = (audit: Analysis['apl'], key: string): number => audit?.skippedBy.find((s) => s.key === key)?.count ?? 0;
const forced = (analysis: Analysis, band: 3 | 4): Analysis['apl'] => analysis.aplForced?.[band] ?? null;
const wears = (analysis: Analysis, id: number): boolean => analysis.gear.slots.some((slot) => slot.id === id);

describe('the four committed pulls, read off their own `combatantinfo`', () => {
	it('finds the trinket on exactly one of them, which is what makes this measurable in both directions', () => {
		// Read off the gear array rather than off the 138898 windows, and the two are different claims: this
		// one holds on a pull that wore the trinket and never procced it.
		expect(wears(addsThenBoss, HYDRA_HEROIC)).toBe(true);
		for (const [name, a] of [
			['cleave', cleave],
			['phased', phased],
			['unbroken', unbroken],
		] as const) {
			expect(
				[HYDRA_BASE, 95_711, 96_083, HYDRA_HEROIC, HYDRA_TOP].some((id) => wears(a, id)),
				name,
			).toBe(false);
		}
	});

	it('demands the aoe dot of the pull that owns it and of no other, at the bands where that rung lives', () => {
		// The biconditional, on the forced walks because those are the ones that name a band outright. Before
		// the gear read these were 53, 3 and 1 flame-shock skips against three shamans who did not own the
		// trinket, and 144 against the one who did.
		for (const band of [3, 4] as const) {
			expect(skips(forced(cleave, band), 'flame-shock'), `cleave band ${band}`).toBe(0);
			expect(skips(forced(phased, band), 'flame-shock'), `phased band ${band}`).toBe(0);
			expect(skips(forced(unbroken, band), 'flame-shock'), `unbroken band ${band}`).toBe(0);
			expect(skips(forced(addsThenBoss, band), 'flame-shock'), `addsThenBoss band ${band}`).toBe(144);
		}
	});

	it('drops 40 of `cleave`’s Flame Shock skips, being the only pull that reaches band 3 without the trinket', () => {
		// `cleave` is the control that can move: 13 enemies at its peak, no Breath of the Hydra. 58 skips
		// before, 18 after — every one of the 40 was a band-3-or-4 press charged against a rung that list
		// never offers. The pull's own totals move with them.
		expect(cleave.targets?.counts.max).toBe(13);
		expect(skips(cleave.apl, 'flame-shock')).toBe(18);
		expect(cleave.apl?.followed).toBe(131);
		expect(cleave.apl?.skipped).toBe(72);
	});

	it('leaves the pull that owns the trinket untouched, figure for figure', () => {
		// Nothing about `addsThenBoss` may move: it owns the trinket, so every rung it was walked down before
		// is a rung it is still walked down. This is the half that would catch a gate that simply closed.
		expect(addsThenBoss.targets?.counts.max).toBe(9);
		expect(skips(addsThenBoss.apl, 'flame-shock')).toBe(150);
		expect(addsThenBoss.apl?.followed).toBe(140);
		expect(addsThenBoss.apl?.skipped).toBe(264);
	});

	it('cannot reach the two single-target pulls on their own walks, and does not', () => {
		// `counts.max === 1` on the line beside the figures, because that is the reason the figures cannot
		// move: a band-3 rung is not in the list at any press of either pull. Their *forced* band-3 walks do
		// move — a forced band is the reader's override rather than a count read off the log, and the gear
		// answer is real at whatever band the reader asks for — which is the row above.
		expect(phased.targets?.counts.max).toBe(1);
		expect(skips(phased.apl, 'flame-shock')).toBe(11);
		expect(phased.apl?.followed).toBe(107);
		expect(phased.apl?.skipped).toBe(50);

		expect(unbroken.targets?.counts.max).toBe(1);
		expect(skips(unbroken.apl, 'flame-shock')).toBe(2);
		expect(unbroken.apl?.followed).toBe(97);
		expect(unbroken.apl?.skipped).toBe(43);
	});
});
