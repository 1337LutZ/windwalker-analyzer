// The other half of `auraIsKnown`, and the seam that lets a rung ask it.
//
// `aoeFlameShockGear.test.ts` covers the gear half: `auraIsKnown(138898)` is a trinket, answered off
// `combatantinfo`'s gear array through `AplInputs.equippedItems`. This file is the talent half.
// `p5.apl.json` rung 0 and `cleave.apl.json` rung 1 open `auraIsKnown(117012)` — the Unleashed Fury row —
// and rung 17 is `Elemental Blast Talented`. One verb, two questions, two different fields of one event.
//
// **What this replaces is a proxy.** `AplRule.talent` alone gated those rungs on `seen.has(rule.id)`:
// the log showing the button *pressed*. That is sound in one direction only. A press proves the talent;
// silence proves nothing, and reading silence as "did not take it" deletes the rung from the list, so a
// shaman who took Unleashed Fury and never got round to the button is walked down a ladder that is not
// theirs — and every rung below is then graded wrongly. On a short pull or a wipe that is routine.
// `readTalents` reads the same `combatantinfo` the gear comes from, and `elemental/lib/index.ts` already
// asks it for Primal Elementalist, so the real answer was one field away.
//
// **Talent ids and not a shared "known auras" set**, the same decision `equippedItems` defends and for
// the same reason: one set holding row 117012 and item 138898 side by side would copy the sim's
// conflation into this seam rather than close it. Two fields, two questions.
//
// **And the id is the row, not the button.** Elemental Blast casts under 117014 and sits on row 117014;
// Unleash Elements casts under 73680 and is gated on row 117012. Reading the gate off `rule.id` would ask
// about a spell every shaman has. Hence `AplRule.talentId`, written out on both rungs even where it
// agrees with the cast id.
//
// **Nothing on `State`.** `equippedItems` went there because a rule *condition* reads it. No condition
// reads this: the talent gate is structural, decided by the engine alongside `bands` and `replacedBy`,
// and putting it on `State` would advertise a hook nothing needs.
//
// **And a log with no talent list is left on the press, not answered `unknown`** — the one place this
// departs from the kit, and the departure is measured rather than asserted. See the second block below,
// and `AplInputs.knownTalents` for the numbers.
//
// The four committed pulls all name **117013**, Primal Elementalist, and none carries a 73680 or a 117014
// press — so both rungs were closed under the proxy and are closed under the read, and no figure moves.
// That is recorded below rather than assumed. The direction the fixtures cannot show — a talent owned and
// never pressed — is shown against synthetic pulls, which is the whole reason this change matters.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Analysis, CastMark, FightDataset, ResourceCurve, Window } from '~/lib/types';
import { readTalents } from '~/lib/analysis/gear';
import { aplAudit, type AplInputs, type AplRule } from '~/lib/spec/apl';
import { analyse } from '~/specs/elemental/lib';
import { LADDER } from '~/specs/elemental/lib/apl';

const LIGHTNING_BOLT = 403;
const LAVA_BURST = 51_505;
const UNLEASH_ELEMENTS = 73_680;
/** The **row** Unleash Elements is gated on, which is not the number it casts under. */
const UNLEASHED_FURY = 117_012;
/** Primal Elementalist — the row all four committed pulls actually name. */
const PRIMAL_ELEMENTALIST = 117_013;
/** Elemental Blast, the one of the two rungs whose row and cast id coincide. */
const ELEMENTAL_BLAST = 117_014;

const press = (t: number, id: number): CastMark => ({ t, id, name: `#${id}`, onGcd: true });
const noBar: ResourceCurve = { max: 0, points: [] };
const whole: Window[] = [{ start: 0, end: 300_000 }];

/**
 * The Elemental ladder's inputs with **the dot up and the totem out**, which is most of what makes the
 * two talent rungs the thing left to decide the walk.
 *
 * Thirty seconds of Flame Shock declines the dot rung at every band, declines Earth Shock's `< 6s` floor
 * and — with Ascendance not up — declines the `p5` prep clause too; a Searing Totem already ticking
 * declines the totem rung. Lava Burst is the fourth, and it is closed by the clock rather than by a
 * condition: `judge` below puts a press of it one second before the judged global, inside its own eight.
 * So at band 1 a walk with both talents shut lands on `lightning-bolt`, and anything above that is the
 * gate under test having opened.
 */
const eleInputs = (over: Partial<AplInputs>): AplInputs => ({
	casts: [],
	energy: noBar,
	chi: noBar,
	regenPerSec: 0,
	gcdMs: 1500,
	pullMs: 300_000,
	auras: { 'searing-totem': whole },
	auraRemainingAt: { 'flame-shock': () => 30_000 },
	fofChannelSec: 0,
	targetsAt: () => 1,
	barsRequired: false,
	...over,
});

/** The verdict and the rung the list wanted, for a single Lightning Bolt judged at one band. */
const judge = (band: 1 | 2 | 3 | 4, over: Partial<AplInputs>) => {
	// The Lava Burst press is the rung-closer described above, not a subject: it is one second old at the
	// judged global and its rung is `bands: [1, 2]`, so it shuts a rung that would otherwise stand between
	// the two talent rows and answer for every one of them.
	const casts = [...(over.casts ?? []), press(19_000, LAVA_BURST), press(20_000, LIGHTNING_BOLT)];
	const audit = aplAudit(eleInputs({ ...over, casts, forceBand: band }), LADDER);
	const last = audit?.presses.at(-1);
	return { wanted: last?.wanted ?? null, verdict: last?.verdict ?? null };
};

describe('a talent row is answered from the talent list, not from whether the button was pressed', () => {
	it('offers the rung to a shaman who took the talent and never pressed it', () => {
		// **The assertion the proxy could not make.** No 73680 anywhere in the pull, so `seen.has(73680)` is
		// false and the old gate deleted rung 0 from the list — this column read `lightning-bolt` /
		// `followed`, a shaman told they played the global correctly against a ladder missing its top rung.
		// The talent list says otherwise, and it is the same `combatantinfo` the gear read already uses.
		expect(judge(1, { knownTalents: new Set([UNLEASHED_FURY]) })).toEqual({
			wanted: 'unleash-elements',
			verdict: 'skipped',
		});
		// Rung 17, the other one, reached once rung 0 is out of the way. `cleave.apl.json` rung 1 wants
		// Unleash Elements only inside a Lava Surge window, which band 1 is not, so this is a clean band-1
		// read of Elemental Blast alone.
		expect(judge(1, { knownTalents: new Set([ELEMENTAL_BLAST]) })).toEqual({
			wanted: 'elemental-blast',
			verdict: 'skipped',
		});
	});

	it('keeps the rung shut for a shaman whose list names a different row of the same tier', () => {
		// The control for the row above, and the case every committed pull is in: 117013 is the third
		// level-90 choice, so neither rung is theirs. Shut under the proxy too — this passes before and
		// after, and is here because a gate that opened for everyone would satisfy the row above alone.
		expect(judge(1, { knownTalents: new Set([PRIMAL_ELEMENTALIST]) })).toEqual({
			wanted: 'lightning-bolt',
			verdict: 'followed',
		});
	});

	it('asks about the row and not about the button, which are the same number only sometimes', () => {
		// A talent list carrying 73680 is not a shaman with Unleashed Fury — 73680 is a baseline spell and
		// never appears in a talent list at all. An implementation reading the gate off `rule.id` would open
		// here and stay shut for 117012 above, which is why the pair is asserted rather than either alone.
		expect(judge(1, { knownTalents: new Set([UNLEASH_ELEMENTS]) }).wanted).toBe('lightning-bolt');
	});

	it('leaves a pull with no talent list on the press, which is the only evidence such a log has', () => {
		// `null` is "the log carried no `combatantinfo`". The kit answers `'unknown'` there and this does
		// not, which is the one asymmetry in the pair and is argued at `AplInputs.knownTalents` — a trinket
		// that never procs leaves no trace in an event stream, a talent's own button does. So both arms of
		// the proxy still run, and this is two assertions rather than one.
		expect(judge(1, { knownTalents: null })).toEqual({ wanted: 'lightning-bolt', verdict: 'followed' });
		// The press is at t=0 and the judged global at t=20 000, past the rung's own 15s cooldown, so what
		// opens the rung is the evidence and not the clock.
		expect(judge(1, { knownTalents: null, casts: [press(0, UNLEASH_ELEMENTS)] })).toEqual({
			wanted: 'unleash-elements',
			verdict: 'skipped',
		});
	});

	it('leaves a ladder that wired no talent list at all exactly where it was', () => {
		// Absent reads the same way as null, and covers every ladder that has not wired the field — the
		// Windwalker's three talent rungs included. Both arms again, so a change that broke the proxy while
		// leaving the reading intact could not pass here.
		expect(judge(1, {})).toEqual({ wanted: 'lightning-bolt', verdict: 'followed' });
		expect(judge(1, { casts: [press(0, UNLEASH_ELEMENTS)] })).toEqual({
			wanted: 'unleash-elements',
			verdict: 'skipped',
		});
	});
});

describe('the gate closes a rung and never silences a press', () => {
	it('never withholds a verdict, at any of the four shapes the input arrives in', () => {
		// **The property that made the third answer unaffordable, pinned so it cannot come back by
		// accident.** A closed talent rung is *absent* from the list — the walk carries on to whatever the
		// list does want — where an unreadable one stops the walk and returns `unknown` for the press. The
		// Elemental's top rung is a talent-gated 15s cooldown, an un-pressed cooldown reads as permanently
		// ready, and its band-1 condition holds whenever Ascendance is down; so an `unknown` there is not
		// one press, it is very nearly all of them. Measured on the four committed pulls with their
		// `combatantinfo` stripped: `unbroken`'s 97/43/0 followed/skipped/unknown became **15/0/125**.
		for (const talents of [new Set([UNLEASHED_FURY]), new Set([PRIMAL_ELEMENTALIST]), null, undefined])
			expect(judge(1, { knownTalents: talents }).verdict, String(talents && [...talents])).not.toBe('unknown');
	});

	it('passes a rung whose own condition refused it, whatever the talent list says', () => {
		// Ascendance up makes rung 0's band-1 condition false outright, so the walk has no business
		// stopping there and lands on the rung the list does want. Same property as the row above, at the
		// one rung where a third answer would have been most tempting to give.
		expect(judge(1, { knownTalents: null, auras: { 'searing-totem': whole, ascendance: whole } })).toEqual({
			wanted: 'lava-burst',
			verdict: 'skipped',
		});
	});

	it('never reaches the gate at a band the rung does not live in', () => {
		// Both talent rungs are `bands: [1, 2]`. A band gate is absence rather than unavailability, so at
		// three and four they are not in the list at all — a talent list that says nothing must cost those
		// bands nothing. `chain-lightning` is what the aoe list presses with the dot up, and the pressed
		// button was a Lightning Bolt, so `skipped` is the honest verdict.
		expect(judge(3, { knownTalents: null })).toEqual({ wanted: 'chain-lightning', verdict: 'skipped' });
		expect(judge(4, { knownTalents: null })).toEqual({ wanted: 'chain-lightning', verdict: 'skipped' });
	});

	it('opens at band 2 as well, where the rung reads a different list', () => {
		// `cleave.apl.json` rung 1 is the talent *and* a Lava Surge window, so band 2 needs the proc up
		// before the gate is the thing deciding. With it up and the row named, the rung is offered; with the
		// row absent the walk falls past it to Lava Burst, which the same proc makes ready.
		const lavaSurge = { 'searing-totem': whole, 'lava-surge': whole };
		expect(judge(2, { auras: lavaSurge, knownTalents: new Set([UNLEASHED_FURY]) }).wanted).toBe('unleash-elements');
		expect(judge(2, { auras: lavaSurge, knownTalents: new Set([PRIMAL_ELEMENTALIST]) }).wanted).toBe('lava-burst');
	});
});

describe('the seam that carries it, independent of any spec', () => {
	// A two-rung ladder standing in for the shape every talent gate has: a gated rung, and something below
	// it that catches the global when the gate shuts. Which rung the walk lands on is the gate's answer
	// read back out, and nothing about the Elemental's own conditions is in the way of it.
	const gated: AplRule = {
		key: 'gated',
		id: UNLEASH_ELEMENTS,
		chiCost: 0,
		energyCost: 0,
		talent: true,
		talentId: UNLEASHED_FURY,
		condition: () => true,
	};
	const below: AplRule = {
		key: 'below',
		id: LIGHTNING_BOLT,
		chiCost: 0,
		energyCost: 0,
		condition: () => true,
	};
	const spy = (over: Partial<AplInputs>) => {
		const casts = [...(over.casts ?? []), press(20_000, LIGHTNING_BOLT)];
		const audit = aplAudit(eleInputs({ ...over, casts }), [gated, below]);
		const last = audit?.presses.at(-1);
		return { wanted: last?.wanted ?? null, verdict: last?.verdict ?? null };
	};

	it('answers the gate four ways, one per shape the input can arrive in', () => {
		expect(spy({ knownTalents: new Set([UNLEASHED_FURY]) }).wanted, 'row named').toBe('gated');
		expect(spy({ knownTalents: new Set([PRIMAL_ELEMENTALIST]) }).wanted, 'row absent').toBe('below');
		// The two fallback shapes, and the press is what decides them — shut with no 73680 in the pull,
		// open with one.
		expect(spy({ knownTalents: null }).wanted, 'no talent list').toBe('below');
		expect(spy({ knownTalents: null, casts: [press(0, UNLEASH_ELEMENTS)] }).wanted, 'no list, pressed').toBe('gated');
		expect(spy({}).wanted, 'field never wired').toBe('below');
	});

	it('does not gate a rung that never declared itself a talent row', () => {
		// A rung with no `talent: true` is demanded of everyone, which is the ladder's default and the
		// reason baseline buttons are not inferred the same way. Same ladder, same talent list naming a
		// different row, and the only difference is the declaration — so an engine that consulted
		// `knownTalents` for every rung carrying a `talentId` would fail here while every row above passed.
		const plain: AplRule = { ...gated, key: 'plain', talent: undefined };
		const talents = { knownTalents: new Set([PRIMAL_ELEMENTALIST]) };
		expect(spy(talents).wanted, 'sanity: declared, so shut').toBe('below');
		const audit = aplAudit(eleInputs({ casts: [press(20_000, LIGHTNING_BOLT)], ...talents }), [plain, below]);
		expect(audit?.presses.at(-1)?.wanted).toBe('plain');
	});
});

const load = (name: string) => {
	const dataset = JSON.parse(
		readFileSync(resolve(import.meta.dirname, `../../../specs/elemental/__fixtures__/${name}.json`), 'utf8'),
	) as FightDataset;
	// The audit's own reader, over the audit's own actor — not a second walk of the `combatantinfo` event
	// written for this file, which could disagree with the one the ladder is fed.
	return { analysis: analyse(dataset) as Analysis, talents: readTalents(dataset.events, dataset.actor.id) };
};

const cleave = load('cleave');
const phased = load('phased');
const unbroken = load('unbroken');
const addsThenBoss = load('addsThenBoss');
const fixtures = [
	['cleave', cleave],
	['phased', phased],
	['unbroken', unbroken],
	['addsThenBoss', addsThenBoss],
] as const;

/** Skips charged to one rung on a walk, or 0 where the rung charged none. */
const skips = (audit: Analysis['apl'], key: string): number => audit?.skippedBy.find((s) => s.key === key)?.count ?? 0;
const walkAt = (analysis: Analysis, band: 1 | 2 | 3 | 4): Analysis['apl'] => analysis.aplForced?.[band] ?? null;

describe('the four committed pulls, read off their own `combatantinfo`', () => {
	it('finds the same third row on all four, which is why neither rung is theirs', () => {
		// Every one of them took Primal Elementalist, and every one of them *has* a talent list — so `null`
		// is not what is being read here. The two rows this change asks about are absent from all four, so
		// the fixtures can only exercise the shut direction; the open one is the synthetic block above, and
		// saying so is the point of this row.
		for (const [name, f] of fixtures) {
			expect(f.talents?.has(PRIMAL_ELEMENTALIST), `${name} took Primal Elementalist`).toBe(true);
			expect(f.talents?.has(UNLEASHED_FURY), `${name} took Unleashed Fury`).toBe(false);
			expect(f.talents?.has(ELEMENTAL_BLAST), `${name} took Elemental Blast`).toBe(false);
		}
	});

	it('charges no skip to either talent rung, at any band, on any of the four', () => {
		// The direct claim, and the one that would break first if the gate started opening for everyone.
		// Forced walks because those are the ones that name a band outright, and both rungs are `bands:
		// [1, 2]` so bands 3 and 4 are absence rather than a shut gate.
		for (const [name, f] of fixtures)
			for (const band of [1, 2, 3, 4] as const) {
				expect(skips(walkAt(f.analysis, band), 'unleash-elements'), `${name} band ${band}`).toBe(0);
				expect(skips(walkAt(f.analysis, band), 'elemental-blast'), `${name} band ${band}`).toBe(0);
			}
	});

	it('moves no figure on any of the four, because the proxy and the read agree on all of them', () => {
		// **The controls are on the line beside the figures.** `phased` and `unbroken` never exceed one
		// enemy; `cleave` peaks at 13 and `addsThenBoss` at 9. None of the four carries a 73680 or a 117014
		// press, so `seen` said shut, and none names 117012 or 117014, so the list says shut too — the two
		// answers coincide here and the totals are unchanged from `021ff53`. This is the row that would
		// catch a reorder in the walk quietly re-grading a press the talent gate never touched.
		expect(cleave.analysis.targets?.counts.max).toBe(13);
		expect(cleave.analysis.apl?.followed).toBe(131);
		expect(cleave.analysis.apl?.skipped).toBe(72);

		expect(addsThenBoss.analysis.targets?.counts.max).toBe(9);
		expect(addsThenBoss.analysis.apl?.followed).toBe(140);
		expect(addsThenBoss.analysis.apl?.skipped).toBe(264);

		expect(phased.analysis.targets?.counts.max).toBe(1);
		expect(phased.analysis.apl?.followed).toBe(107);
		expect(phased.analysis.apl?.skipped).toBe(50);

		expect(unbroken.analysis.targets?.counts.max).toBe(1);
		expect(unbroken.analysis.apl?.followed).toBe(97);
		expect(unbroken.analysis.apl?.skipped).toBe(43);
	});
});
