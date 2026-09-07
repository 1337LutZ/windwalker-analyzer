// The evidence `SIEGE_RANKING_EXCLUSIONS` decides each row on, re-measured against the logs.
//
// ## What this is for, and why it is not in `rankingExclusions.test.ts`
//
// That file tests the table as a **lookup**: the transcription against the article, the encounter key
// against Classic's three registrations, the difficulty gate, and `uncountedActorIDs` over a real enemy
// roster. Every one of those questions is answerable without opening a log.
//
// This file asks the other half, which nothing asked before it: **is what the rows say still true.**
// Each row carries an `evidence` string full of hand-measured numbers — *"not one aimed press"*, *"157
// hits on one spawn across a contiguous 39.6s, including 60 aimed presses of which 42 are melee
// auto-attacks"* — and those numbers decided the row's `reach`, which decides whether an add leaves this
// report's enemy count. They were measured by hand, once, against pulls that are now committed, and until
// `Analysis.spawns` existed there was no shape in the engine that could state them back. There is now:
// one row per enemy **body**, carrying `hits`, `aimedPresses` and a first-to-last contact span, which are
// exactly the three quantities the evidence is written in.
//
// Separate file rather than a seventh block over there for two reasons. It has a different **subject** —
// the world the table describes, not the table — so a failure here means "a measurement has gone stale"
// while a failure there means "the transcription or the keying is wrong", and a reader should not have to
// work out which from the file name. And it has different **machinery**: this one runs the whole analysis
// engine over every committed raw pull, which is 4 megabytes of fixture and a second of work that the
// lookup tests neither need nor should pay for.
//
// ## What "reachable" means, and why unreachable has to be loud
//
// A row is checkable only where a committed fixture is a pull of its encounter at a difficulty the row
// applies to. That is **one row of thirteen** today: `Living Corruption` on heroic Malkorok, via
// `uncounted.json`. The reference report the other twelve were measured against — `a:6MhZgjyAknFWrYfK`,
// fourteen kills in one night — is not in this repository, and committing thirteen more multi-megabyte
// pulls to check thirteen rows is not a trade anyone would take.
//
// So the twelve are **named** as unreachable rather than quietly skipped. A sweep that iterates a table,
// finds nothing it can assert, and reports success is the exact failure `undeclaredAuras.test.ts` carries
// its own non-vacuity test against, and this file is more exposed to it than most: the natural shape here
// is a loop over thirteen rows where twelve `continue`. The partition is pinned as a literal, so the day
// a Thok or Garrosh pull is committed the pin reddens and whoever committed it is told there is now a row
// to check.

import { describe, expect, it } from 'vitest';

import { rawFixture, rawFixtures } from '~/lib/analysis/fixtures';
import { observeSpawns, spawnRecords, type SpawnRecord } from '~/lib/analysis/targets';
import { isDamage } from '~/lib/events';
import {
	baseEncounterID,
	HEROIC_DIFFICULTY,
	SIEGE_RANKING_EXCLUSIONS,
	type RankingExclusion,
} from '~/lib/game/rankingExclusions';
import type { FightDataset } from '~/lib/types';
import { analyse as analyseElemental } from '~/specs/elemental/lib';
import { analyse, registry, WW_SPEC } from '~/specs/windwalker';

/** The window a body has to outlive to be one the rotation had time to react to. The spec's own number. */
const TARGET_WINDOW_MS = WW_SPEC.thresholds.targetWindowMs;

/**
 * The aimed set, rebuilt the way `analyseCore` builds it — the spec's declaration, plus melee.
 *
 * Rebuilt rather than imported because `analyseCore` does not export it, and rebuilt from
 * `targeting.aimed` rather than listed because a list here would be a second statement of which buttons
 * pick a target: a button gaining the flag would move the published reading and not this one, and the
 * block that uses this exists precisely to check the published reading against a narrower stream. Melee is
 * written out for the reason `analyseCore` writes it out — an auto-attack has no `Ability` behind it that
 * could carry the flag.
 */
const AIMED_DAMAGE_IDS: ReadonlySet<number> = new Set([
	1,
	...registry.abilities.filter((ability) => ability.targeting?.aimed === true).flatMap((a) => a.damageIds ?? []),
]);

/**
 * Every committed Windwalker pull, analysed once.
 *
 * Windwalker only, and that is a fact about the field rather than a shortcut. `analyseCore` publishes
 * `spawns` only for a spec that declares `targeting.aimed` on at least one button, because an empty aimed
 * set makes every body on the pull read as splash — a wrong answer shaped exactly like the finding the
 * field exists to report. The Elemental declares none, so its four fixtures carry no `spawns` at all and
 * there is nothing here to sweep. `absent for the Elemental` is asserted below rather than assumed, since
 * "the sweep found nothing" and "the sweep was handed nothing" are the two states this file must never
 * confuse.
 */
const PULLS = rawFixtures('windwalker').map(({ name, dataset }) => ({
	name,
	dataset,
	analysis: analyse(dataset),
}));

/** The two facts the header's own test reads, plus the denominators its sentences quote. */
interface Measured {
	/** Enemy **bodies**, not kinds — ten simultaneous adds under one `targetID` are ten of these. */
	bodies: number;
	/** Every damage event the player and their pets put on them: ticks, misses and immune returns. */
	hits: number;
	/** Melee, Jab, Tiger Palm, Blackout Kick, Rising Sun Kick — the presses that prove a choice. */
	aimedPresses: number;
	/** Bodies whose first-to-last contact ran longer than one target window. */
	bodiesOverWindow: number;
	/** The longest of those spans, so a row that just clears the window is distinguishable from one that buries it. */
	longestSpanMs: number;
	/** Bodies touched exactly once — the "contact span of zero" several rows quote. */
	bodiesTouchedOnce: number;
}

const measure = (rows: readonly SpawnRecord[]): Measured => ({
	bodies: rows.length,
	hits: rows.reduce((n, r) => n + r.hits, 0),
	aimedPresses: rows.reduce((n, r) => n + r.aimedPresses, 0),
	bodiesOverWindow: rows.filter((r) => r.lastMs - r.firstMs > TARGET_WINDOW_MS).length,
	longestSpanMs: rows.reduce((most, r) => Math.max(most, r.lastMs - r.firstMs), 0),
	bodiesTouchedOnce: rows.filter((r) => r.lastMs === r.firstMs).length,
});

/** Whether this pull is one the row applies to at all — the same two gates `rankingExclusionFor` uses. */
const reaches = (rule: RankingExclusion, fight: FightDataset['fight']): boolean =>
	baseEncounterID(fight.encounterID) === rule.encounterID &&
	(!rule.heroicOnly || fight.difficulty === HEROIC_DIFFICULTY);

/** The bodies of one NPC on one pull, keyed by the id the ruleset is written in. */
const bodiesOf = (rows: readonly SpawnRecord[], gameID: number | null): SpawnRecord[] =>
	gameID === null ? [] : rows.filter((r) => r.gameID === gameID);

/** Every row, with the pull that can check it — or nothing, which is the answer this file has to say out loud. */
const REACHED = SIEGE_RANKING_EXCLUSIONS.map((rule) => ({
	rule,
	on: PULLS.filter(({ dataset }) => reaches(rule, dataset.fight)),
}));

describe('which rows a committed pull can actually check', () => {
	/**
	 * The partition, written out. Thirteen rows, one line each, so removing a fixture is as loud as adding one.
	 *
	 * These are not rows anybody decided to skip — they are rows of encounters this repository holds no pull
	 * of. Three of them would stay unmeasurable even with the pull committed, and say so themselves:
	 * `Starved Yeti`, `Amber Parasites` and `Manifestation of Rage` are all *"Absent from the reference
	 * pull"*, so a second pull of the same encounter is as likely to be silent about them as the first was.
	 * The other ten are rows with real hand-measured numbers behind them and nothing in this tree to check
	 * them against.
	 */
	const UNREACHABLE = [
		'Despair Spawn',
		'Desperation Spawn',
		'Darkfang',
		'Bloodclaw',
		'Foul Slimes',
		"Kor'kron Jailer",
		'Starved Yeti',
		'Amber Parasites',
		'Blood',
		'Desecrated Weapon',
		'Empowered Desecrated Weapon',
		'Manifestation of Rage',
		"Minion of Y'Shaarj",
	];

	it('names every row no committed pull reaches, rather than passing over it', () => {
		expect(REACHED.filter(({ on }) => on.length === 0).map(({ rule }) => rule.npc)).toEqual(UNREACHABLE);
	});

	/**
	 * *** The non-vacuity test. *** Thirteen of fourteen rows have nothing behind them, so this file is one
	 * committed fixture away from being a sweep that asserts nothing and reports success — which is the
	 * failure `undeclaredAuras.test.ts` already carries its own version of this against.
	 */
	it('has at least one row with a real pull behind it, and finds the NPC on it', () => {
		const checkable = REACHED.filter(({ on }) => on.length > 0);
		expect(checkable.map(({ rule }) => rule.npc)).toEqual(['Living Corruption']);
		for (const { rule, on } of checkable) {
			for (const { name, analysis } of on) {
				expect(analysis.spawns, `${name} publishes no spawns`).toBeDefined();
				expect(bodiesOf(analysis.spawns ?? [], rule.gameID).length, `${rule.npc} on ${name}`).toBeGreaterThan(0);
			}
		}
	});

	/**
	 * And the other half of "the sweep was handed something": the Elemental's four pulls carry no `spawns`.
	 *
	 * Absent, not empty. A spec that declares no aimed button gets no rows rather than a row per body reading
	 * zero presses, because zero presses on every body *is* the `reach: 'both'` signature and a spec that
	 * simply never declared its buttons would hand out a table's worth of them. So the Elemental appearing
	 * here with an empty array would be the bug, and an Elemental pull silently joining `PULLS` above would
	 * be a sweep measuring a caster's rotation against a melee's discriminator.
	 */
	it('is handed nothing at all by a spec that declares no aimed button', () => {
		for (const { name, dataset } of rawFixtures('elemental'))
			expect(Object.hasOwn(analyseElemental(dataset), 'spawns'), name).toBe(false);
	});
});

/**
 * The necessary conditions each `reach` implies, taken from the header rather than paraphrased.
 *
 * The header states one test in three sentences, and only two of the three are mechanical:
 *
 *   - *"A row is `'both'` only where **neither** fact is present"* — no aimed press, and no spawn held
 *     longer than one target window. Two necessary conditions, both checkable.
 *   - *"`'damage'` — the NPC is a real body the player was engaged with"* — so at least one of the two
 *     facts is present. One necessary condition, checkable.
 *   - *"`null` … nobody has evidence either way"*, or the two readings disagree. **No** necessary
 *     condition, and deliberately none asserted: `Foul Slimes` is `null` while matching the splash
 *     signature exactly, on an argument about twenty-two bodies and a Rushing Jade Wind that no
 *     measurement makes.
 *
 * The third sentence — *"where the two disagree … the row is left `null`"* — is **not** encoded, because
 * the table does not follow it as a rule and encoding it would make this file assert something the rows
 * it is checking never claimed. `Despair Spawn` has no aimed press and four spawns held 16–29s and is
 * `'damage'`; `Desecrated Weapon` is the same shape and says why in as many words ("Sustained contact and
 * encounter structure agree, so this is a body"). Encounter structure is a judgement, not a number, and a
 * guard that cannot see it must not pretend the numbers settle it. What the numbers *do* settle is that
 * neither of those rows is splash — which is the `'damage'` condition above, and it holds for both.
 */
const CONDITIONS = {
	both: [
		['no aimed press', (m: Measured): boolean => m.aimedPresses === 0],
		['no body held longer than one target window', (m: Measured): boolean => m.bodiesOverWindow === 0],
	],
	damage: [
		[
			'an aimed press, or a body held longer than one target window',
			(m: Measured): boolean => m.aimedPresses > 0 || m.bodiesOverWindow > 0,
		],
	],
} as const;

describe("the evidence each row's reach rests on, re-measured", () => {
	const CHECKABLE = REACHED.filter(({ on }) => on.length > 0);

	it('holds every condition the reach implies', () => {
		let asserted = 0;
		for (const { rule, on } of CHECKABLE) {
			if (rule.reach === null) continue;
			for (const { name, analysis } of on) {
				const m = measure(bodiesOf(analysis.spawns ?? [], rule.gameID));
				for (const [condition, holds] of CONDITIONS[rule.reach]) {
					expect(
						holds(m),
						`${rule.npc} on ${name}: ${rule.reach} needs ${condition} — measured ${JSON.stringify(m)}`,
					).toBe(true);
					asserted++;
				}
			}
		}
		// One row, and `'damage'` states one necessary condition: exactly one assertion is made, and a count
		// of zero would mean the loop above found nothing to say and said it confidently.
		//
		// It was one of two until the row it checks was narrowed, with the other carved out as a known
		// contradiction: `Living Corruption` read `reach: 'both'`, whose second condition is "no body held
		// longer than one target window", and the block below measures four bodies past one on the only
		// committed pull of that encounter. The carve-out is gone because the row is — it is `'damage'` now,
		// which is what the surviving half of the measurement supports.
		expect(asserted).toBe(1);
	});
});

/**
 * *** Living Corruption, measured on a pull its row was never measured against. ***
 *
 * The row reads, in full: *"28 hits across 11 spawns spread over the whole 201s pull. Not one aimed press
 * — no melee, no Tiger Palm, no Blackout Kick, no Rising Sun Kick, not even Spinning Crane Kick or Rushing
 * Jade Wind; every hit is Chi Wave or proc damage arriving on its own. Eight of the eleven spawns were
 * touched once, for a contact span of zero."* That was measured on `a:6MhZgjyAknFWrYfK`, the reference
 * clear, which is not committed. `uncounted.json` is a **different** heroic Malkorok kill — `a:XkDQJHaztfnCd9Yj`
 * fight 29 — so the arithmetic cannot be expected to repeat and is not asserted. The **claim** can, and is:
 * a judgement about an NPC that only holds on the pull it was taken from is not a judgement about the NPC.
 *
 * ## What survived
 *
 * *"Not one aimed press"* — **yes, and decisively.** Zero of 115 hits across 20 bodies, and zero of the 63
 * the monk landed with their own hands. The eight ability ids that ever touch a Living Corruption on this
 * pull are Crackling Tiger Lightning (46), Flurry of Xuen (41), Multistrike (10), Chi Wave (8), Stormlash
 * (6), Flying Serpent Kick (2) and two Fists of Fury ids (1 each) — Xuen, procs, a dash and a channel.
 * Not one is melee, and not one is a button a monk has to be facing a unit to press. The row's own enumeration is
 * narrower than the truth (it names Spinning Crane Kick and Rushing Jade Wind, neither of which this pull
 * has at all) but the claim it draws is the wider one, and the wider one holds.
 *
 * ## What did not
 *
 * *"Eight of the eleven spawns were touched once, for a contact span of zero"* — **two of twenty**, and
 * four of twenty were in contact for longer than one 5 000ms target window: 7 646ms, 6 998ms, 6 220ms and
 * 5 153ms. That is the second of the header's two facts, and the header is explicit that a row is `'both'`
 * *"only where **neither** fact is present"* and that a spawn held longer than one window *"is a body the
 * rotation had time to react to"*. On this pull, four were.
 *
 * **And it is not an artefact of the pet.** `Analysis.spawns` folds Xuen's damage in, deliberately —
 * `SpawnRecordInputs` argues that the widest evidence is the honest answer to "can anything this player
 * does land on that unit" — and a tiger that picks its own targets can stretch a span the monk never held.
 * So the same walk is run below over the monk's own damage alone: 14 bodies, 63 hits, still zero aimed
 * presses, and **still one body held past a window** at 5 153ms. Marginal — 153ms over — but the marginal
 * case is the one a rule this sharp has to survive, and the row's stated shape (touched once, span zero) is
 * not what either reading finds.
 *
 * ## What was done about it
 *
 * The row is `reach: 'damage'`. Not `null`: the two facts do not both fail here, one of them does, and the
 * one that survives — a body held past a window, on a unit the player never aimed at — is exactly what
 * `'damage'` states. So this is not "the evidence ran out", it is "the evidence says something narrower
 * than the row claimed", and the table now says the narrower thing with both pulls quoted in its
 * `evidence`.
 *
 * What it costs, and the reason it took a second pull to earn: `'both'` is the only reach
 * `uncountedActorIDs` reads, so these twenty bodies were leaving the counted enemy series entirely and this
 * 211s pull published a peak enemy count of **one**. They are in it now, and the block below is where that
 * consequence is asserted rather than described.
 */
describe('Living Corruption on the one committed pull of its encounter', () => {
	const CORRUPTION = 71_644;
	const dataset = rawFixture('windwalker', 'uncounted.json');
	const published = (analyse(dataset).spawns ?? []).filter((r) => r.gameID === CORRUPTION);

	it('is the encounter and the difficulty the row is written for', () => {
		expect(dataset.fight.name).toBe('Malkorok');
		expect(baseEncounterID(dataset.fight.encounterID)).toBe(1595);
		expect(dataset.fight.difficulty).toBe(HEROIC_DIFFICULTY);
		// The row is heroic-only, so a Normal pull of the same boss would reach nothing — see the gate in
		// `rankingExclusionFor`, which `reaches` above mirrors.
		expect(SIEGE_RANKING_EXCLUSIONS.find((rule) => rule.gameID === CORRUPTION)?.heroicOnly).toBe(true);
	});

	it('lands not one aimed press on any of its twenty bodies', () => {
		expect(measure(published)).toEqual({
			bodies: 20,
			hits: 115,
			aimedPresses: 0,
			bodiesOverWindow: 4,
			longestSpanMs: 7646,
			bodiesTouchedOnce: 2,
		});
		// Named and identified, which is what makes the join to the ruleset a `gameID` join rather than a
		// name match — see the header of `rankingExclusions.ts` for why that distinction is load-bearing.
		expect([...new Set(published.map((r) => r.name))]).toEqual(['Living Corruption']);
	});

	/**
	 * The monk's own hands, without the tiger — the same walk over a narrower stream.
	 *
	 * A second call to `spawnRecords` rather than a hand-rolled loop, so the two readings cannot come to
	 * disagree about when a body was first touched; that is the drift `observeSpawns` exists as one
	 * accumulator to prevent, and re-using the function is how this block inherits the guarantee instead of
	 * re-earning it. The aimed set is the analyser's own, lifted off the spec's declaration by the same
	 * sweep `analyseCore` runs, so a button gaining or losing `targeting.aimed` moves both readings together.
	 *
	 * These are also the numbers `capture.test.ts` quotes for this fixture — *"63 of the monk's hits on 14
	 * separate Living Corruption spawns across 194s"* — which is worth stating because they are **not** the
	 * published ones. That comment is a player-only measurement and `Analysis.spawns` folds the pet in, so a
	 * reader comparing 63/14 with the 115/20 above would otherwise conclude one of them is wrong. Both are
	 * right; they are different questions, and both are asserted here so neither can drift.
	 */
	it('still holds one body past a target window with the pet taken out', () => {
		const t0 = dataset.fight.startTime;
		const own = dataset.events.filter(isDamage).filter((e) => e.sourceID === dataset.actor.id);
		const rows = spawnRecords(observeSpawns(own, t0, AIMED_DAMAGE_IDS), {
			t0,
			endMs: dataset.fight.endTime - t0,
			windowMs: TARGET_WINDOW_MS,
			excluded: new Set<number>(),
			npcs: dataset.table.fight.enemyNPCs ?? [],
		}).filter((r) => r.gameID === CORRUPTION);

		expect(measure(rows)).toEqual({
			bodies: 14,
			hits: 63,
			aimedPresses: 0,
			bodiesOverWindow: 1,
			longestSpanMs: 5153,
			bodiesTouchedOnce: 4,
		});
		// 194s, as `capture.test.ts` says — the span of the monk's own contact with the add, end to end.
		expect(Math.max(...rows.map((r) => r.lastMs)) - Math.min(...rows.map((r) => r.firstMs))).toBe(193_841);
	});

	/**
	 * *** The clearest demonstration of what the analysis mode changes, on a real committed pull. ***
	 *
	 * Twenty judgeable, non-immune Living Corruption bodies were up for most of a 211s Malkorok kill. In
	 * `parsing` WarcraftLogs strikes every one of them, so the pull publishes a peak enemy count of
	 * **one**, 0% multi-target and a single-target reading — which is the honest answer to "what does the
	 * ladder see", because none of that damage counts toward a parse. In `progression` the same pull reads
	 * **3**, **35.37%** and multi-target, which is the honest answer to "what did this player fight".
	 *
	 * Neither number is wrong and the report says which one it is showing. What would be wrong is a single
	 * answer presented as though the question had only one.
	 */
	it('reads single-target in parsing and multi-target in progression, on the same pull', () => {
		const parsing = analyse(dataset, undefined, 'parsing');
		const progression = analyse(dataset, undefined, 'progression');

		// Every one of the twenty leaves the counted series under the ruleset, and none of them under the
		// fight-as-fought reading. Nothing about the bodies changed — only which question is being asked.
		expect((parsing.spawns ?? []).filter((r) => r.excluded).length).toBe(20);
		expect((progression.spawns ?? []).filter((r) => r.excluded).length).toBe(0);
		expect(published.every((r) => r.judgeable && !r.immune)).toBe(true);

		expect(parsing.targets?.counts.max).toBe(1);
		expect(parsing.targets?.multiTargetPct).toBeCloseTo(0, 2);
		expect(parsing.targets?.detected).toBe('single');

		expect(progression.targets?.counts.max).toBe(3);
		expect(progression.targets?.multiTargetPct).toBeCloseTo(35.37, 2);
		expect(progression.targets?.detected).toBe('multi');
	});

	/**
	 * *** And the damage moves with it, which for a long time it did not. ***
	 *
	 * The block above was the demonstration of what the mode changes, and it demonstrated the enemy
	 * count and nothing else, because the damage table did not consult the ruleset at all. `eventTotal`
	 * and every ability's total were accumulated outside `aggregateDamage`'s own guard, so a struck
	 * body's damage counted towards the player under both readings. A control that says it changes what
	 * was measured has to change it: a pull reading single-target with 0% multi-target while still
	 * carrying every point of damage dealt to the twenty bodies it just struck is two answers to one
	 * question.
	 *
	 * 4,871,094 of this pull's damage was dealt to Living Corruptions, **4.0% of it**, and that is the
	 * whole of the difference here. The parsing figure is the one a ranking would see.
	 *
	 * The shares move with the totals rather than being renormalised separately, which is the property
	 * worth pinning: `share` is computed against the same `eventTotal` the rows were summed into, so the
	 * table adds to a hundred under either reading.
	 */
	it('takes a struck body’s damage out of the table under parsing, and leaves it under progression', () => {
		const parsing = analyse(dataset, undefined, 'parsing');
		const progression = analyse(dataset, undefined, 'progression');

		expect(parsing.damage.eventTotal).toBe(116_647_203);
		expect(progression.damage.eventTotal).toBe(121_518_297);
		expect(progression.damage.eventTotal - parsing.damage.eventTotal).toBe(4_871_094);

		// Non-vacuity: the numbers above are a difference only because the ruleset struck something here.
		// On a pull with no exclusion row the two readings must still agree to the unit.
		const plain = rawFixture('windwalker', 'dataset-ironJuggernaut.json');
		expect(analyse(plain, undefined, 'parsing').damage.eventTotal).toBe(
			analyse(plain, undefined, 'progression').damage.eventTotal,
		);

		// Each reading's table is internally whole: the rows sum to the total they were divided by.
		for (const card of [parsing, progression]) {
			const rows = card.damage.abilities.reduce((sum, a) => sum + a.total, 0);
			expect(rows).toBe(card.damage.eventTotal);
			expect(card.damage.abilities.reduce((sum, a) => sum + a.share, 0)).toBeCloseTo(100, 6);
		}
	});

	/**
	 * And the headline moves with them, which for a long time it did not.
	 *
	 * `dps` was WarcraftLogs' own table total over the pull's length, so a control that restruck four
	 * point nine million of this pull's damage left the number above the chart exactly where it was.
	 * Worse, the site's total is not what the ability rows sum to, so the report could print a damage
	 * figure and a rate that could not both be true of one pull.
	 *
	 * Both are one property now: the headline is this reading's own damage over its own clock, so it
	 * follows the mode and the table adds up to it.
	 */
	it('moves the headline rate with the reading, and keeps the table adding up to it', () => {
		const parsing = analyse(dataset, undefined, 'parsing');
		const progression = analyse(dataset, undefined, 'progression');

		expect(progression.damage.dps).toBeGreaterThan(parsing.damage.dps);
		// The whole of the difference is the struck damage over the pull's own length.
		expect(progression.damage.dps - parsing.damage.dps).toBeCloseTo(4_871_094 / (parsing.durationMs / 1000), 6);

		for (const card of [parsing, progression]) {
			expect(card.damage.abilities.reduce((sum, a) => sum + a.total, 0)).toBe(card.damage.eventTotal);
			expect(card.damage.dps).toBeCloseTo(card.damage.eventTotal / (card.durationMs / 1000), 6);
		}
		// The site's own total is still published, and is still not what the headline is taken over.
		expect(parsing.damage.wclTotal).not.toBeNull();
		expect(parsing.damage.wclTotal).not.toBe(parsing.damage.eventTotal);
	});

	/**
	 * And the per-second series is the same reading of the same walk, under either mode.
	 *
	 * This is the identity the curve on the compare page rests on. The series exists so that damage can
	 * be drawn against a clock, and the one thing that would make it a lie is disagreeing with the total
	 * printed beside it, which is exactly what a second walk over the events would eventually do, since
	 * nothing would force it to apply the struck filter the same way. Asserting the sum is what makes
	 * "off the same walk" a fact rather than a comment.
	 */
	it('publishes a per-second series that adds up to the total it was taken from', () => {
		for (const mode of ['parsing', 'progression'] as const) {
			const card = analyse(dataset, undefined, mode);
			const series = card.damage.perSecond ?? [];
			expect(series.length, mode).toBeGreaterThan(0);
			expect(
				series.reduce((sum, n) => sum + n, 0),
				mode,
			).toBe(card.damage.eventTotal);
			// One slot per whole second of the pull, plus the partial one at the end.
			expect(series.length, mode).toBe(Math.ceil(card.durationMs / 1000) + 1);
			expect(
				series.every((n) => n >= 0),
				mode,
			).toBe(true);
		}
		// The two curves differ by exactly the damage the ruleset struck, second for second.
		const struckOff =
			(analyse(dataset, undefined, 'progression').damage.perSecond ?? []).reduce((sum, n) => sum + n, 0) -
			(analyse(dataset, undefined, 'parsing').damage.perSecond ?? []).reduce((sum, n) => sum + n, 0);
		expect(struckOff).toBe(4_871_094);
	});
});

/**
 * The aimed set reached the logs — the guard under every assertion above.
 *
 * `observeSpawns`' `aimedDamageIds` warns that an empty aimed set "makes every body read as splash, which
 * is not a neutral answer: it is a wrong answer shaped precisely like the finding `aimedPresses` exists to
 * report". Every `reach: 'both'` verdict in this file's sweep rests on `aimedPresses === 0`, so a set that
 * quietly shrank — a spec dropping `targeting.aimed`, the melee id going missing from the union — would
 * turn this file from a guard into a rubber stamp, silently and in the passing direction.
 *
 * So the presses are pinned per pull. These are not figures anything publishes; they are the reading's own
 * pulse, and the numbers move only when the spec's declaration does.
 *
 * The `excluded` column reads zero on all four now that no `reach: 'both'` row meets a committed pull. It
 * is kept for that reason rather than in spite of it: a column pinned at zero across the tree is what turns
 * red the day a `'both'` row does meet one, and nothing else in the suite would notice.
 */
describe('the aimed set the sweep is measured with', () => {
	it('finds presses on every committed pull, in the pinned quantities', () => {
		const grid = Object.fromEntries(
			PULLS.map(({ name, analysis }) => {
				const rows = analysis.spawns ?? [];
				return [
					name,
					{
						bodies: rows.length,
						bodiesAimedAt: rows.filter((r) => r.aimedPresses > 0).length,
						aimedPresses: rows.reduce((n, r) => n + r.aimedPresses, 0),
						excluded: rows.filter((r) => r.excluded).length,
					},
				];
			}),
		);
		expect(grid).toEqual({
			// One body aimed at, which is right: the other nine are Crawler Mines, wholly immune, swept by
			// area damage and chosen by nobody. The pull `targets.ts` established `IMMUNE_HIT_TYPE` on.
			'dataset-ironJuggernaut.json': { bodies: 10, bodiesAimedAt: 1, aimedPresses: 346, excluded: 0 },
			// Immerseus: the boss plus ten Sha Puddles the monk went and hit, and thirteen bodies the fight
			// list never named. The ruleset says nothing about this encounter — it is an ASP removal, which
			// the table's header explains cannot be a row at all.
			'idle.json': { bodies: 24, bodiesAimedAt: 11, aimedPresses: 198, excluded: 0 },
			// Galakras, seventeen of forty-one bodies deliberately fought. Not an encounter the ruleset names;
			// Garrosh is 1623 and this is 1622, which is the near-miss worth having a pull of.
			'sections.json': { bodies: 41, bodiesAimedAt: 17, aimedPresses: 595, excluded: 0 },
			// Malkorok: the boss and twenty Living Corruptions, one body aimed at. The twenty are struck here
			// because this grid is built in the default mode, which is `parsing` — the block above reads the
			// same pull both ways and is where that number is argued. The other three rows are encounters
			// the ruleset says nothing about, so no mode moves them.
			'uncounted.json': { bodies: 21, bodiesAimedAt: 1, aimedPresses: 400, excluded: 20 },
		});
	});
});
