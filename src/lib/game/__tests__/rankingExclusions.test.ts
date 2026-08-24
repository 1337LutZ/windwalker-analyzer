// The Siege parsing rules as a lookup, and the four things that can go wrong with one.
//
// The table itself is a transcription, so the first block below is the independent witness the
// `itemSources` guards use: the rules written out again, by hand, from the article rather than from
// the declaration. A typo in one and not the other is the only thing that catches a typo at all.
//
// The other three blocks are about the *keying*, which is where a table like this actually fails:
// an encounter id matched raw instead of by its base (Classic registers Siege three times), a
// heroic-only rule applied to a Normal pull, and an undecided row read as if it had been decided.
//
// Two further blocks are about the table's consumer, `uncountedActorIDs`, and they are the ones with
// something behind them. A lookup with no reader is only ever tested against itself: every assertion
// in the keying blocks would go on passing if the encounter key matched nothing a real report carries, and
// a table that silently excludes nobody is exactly the shape of bug the keying blocks are written
// against. So the sweep asserts an answer for *every* row at *every* registration on *both*
// difficulties, and then a committed pull of an encounter the ruleset actually names is run through
// the predicate at the raw id its report carries — which is the assertion that reddens if the base
// collapse is ever taken out.

import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { capturedAnalyses, rawFixtures } from '~/lib/analysis/fixtures';
import {
	baseEncounterID,
	HEROIC_DIFFICULTY,
	rankingExclusionFor,
	SIEGE_RANKING_EXCLUSIONS,
	uncountedActorIDs,
} from '~/lib/game/rankingExclusions';

/**
 * The ruleset, transcribed a second time and by hand — the pin.
 *
 * From "Siege of Orgrimmar on Warcraft Logs", published by WarcraftLogs on 3 June 2026 and served
 * identically at `articles.classic.warcraftlogs.com/news/siege-of-orgrimmar-on-warcraft-logs` and
 * `archon.gg/classic-mop/articles/news/siege-of-orgrimmar-on-warcraft-logs`. Only the sentences that
 * name an NPC are here: "Removed from ASP", the Nazgrim pull condition, the two conditions evaluated
 * over the fight ("any Paragon that heals to full", "adds that don't die") and the Amber Scorpion
 * re-attribution name no unit that a lookup can be keyed on, and the module says why it leaves them out.
 */
const TRANSCRIBED: readonly [encounter: number, npc: string, heroicOnly: boolean][] = [
	[1598, 'Despair Spawn', true],
	[1598, 'Desperation Spawn', true],
	[1606, 'Darkfang', true],
	[1606, 'Bloodclaw', true],
	[1606, 'Foul Slimes', true],
	[1595, 'Living Corruption', true],
	// No "On Heroic:" on Thok's sentence — this rule holds on every difficulty, and it is the one the
	// difficulty gate below is written against.
	[1599, "Kor'kron Jailer", false],
	[1599, 'Starved Yeti', false],
	[1593, 'Amber Parasites', true],
	[1593, 'Blood', true],
	[1623, 'Desecrated Weapon', true],
	[1623, 'Manifestation of Rage', true],
	[1623, "Minion of Y'Shaarj", true],
];

describe('the table says what the article says', () => {
	it('carries every named NPC, on the right encounter, at the right difficulty', () => {
		expect(SIEGE_RANKING_EXCLUSIONS.map((rule) => [rule.encounterID, rule.npc, rule.heroicOnly])).toEqual(
			TRANSCRIBED.map((row) => [...row]),
		);
	});

	it('gives every row a reason, and every decided row a reach the type allows', () => {
		for (const rule of SIEGE_RANKING_EXCLUSIONS) {
			expect(rule.evidence.length, rule.npc).toBeGreaterThan(40);
			expect(['damage', 'both', null], rule.npc).toContain(rule.reach);
		}
	});

	/**
	 * The rows that leave the target count, named here rather than counted.
	 *
	 * Two, and both for the same measured reason: no aimed press and no spawn held for as long as one
	 * target window. Everything else in the table either leaves the damage attribution alone — the add
	 * waves — or is `null`, which is this file refusing to guess rather than a row waiting to be filled in.
	 *
	 * `Living Corruption` was the third until a second pull of its encounter was committed, which holds
	 * four of its twenty bodies past a target window and so fails the second of the two conditions. It is
	 * `'damage'` now; `game/__tests__/exclusionEvidence.test.ts` is where that was measured, and neither of
	 * the two below has a committed pull to be re-measured against.
	 */
	it('leaves the target count on exactly two rows', () => {
		expect(SIEGE_RANKING_EXCLUSIONS.filter((rule) => rule.reach === 'both').map((rule) => rule.npc)).toEqual([
			'Blood',
			"Minion of Y'Shaarj",
		]);
		expect(SIEGE_RANKING_EXCLUSIONS.filter((rule) => rule.reach === null).map((rule) => rule.npc)).toEqual([
			'Foul Slimes',
			'Starved Yeti',
			'Amber Parasites',
			'Manifestation of Rage',
		]);
	});
});

describe('the encounter key survives every registration of the raid', () => {
	/**
	 * Classic re-registers a boss once per re-release, offset by a multiple of 50000, and Siege has
	 * three: Garrosh is `1623` on retail SoO, `51623` on Classic SoO and `101623` on the Classic
	 * re-release. The reference report is a `51xxx` one, so a table written against raw ids would look
	 * right today and answer nothing for a report from either of the other two.
	 */
	it('answers the same for 1595, 51595 and 101595', () => {
		expect([1595, 51_595, 101_595].map(baseEncounterID)).toEqual([1595, 1595, 1595]);
		for (const encounterID of [1595, 51_595, 101_595]) {
			expect(
				rankingExclusionFor(encounterID, HEROIC_DIFFICULTY, { name: 'Living Corruption', gameID: 71_644 })?.reach,
				String(encounterID),
			).toBe('damage');
		}
	});

	it('does not answer for an encounter the ruleset says nothing about', () => {
		// Iron Juggernaut — "No rules." Its Crawler Mines are handled by the immunity rule in
		// `analysis/targets`, which is a different mechanism and must not be shadowed by a phantom row.
		expect(rankingExclusionFor(51_600, HEROIC_DIFFICULTY, { name: 'Crawler Mine', gameID: 72_050 })).toBeUndefined();
		expect(rankingExclusionFor(undefined, HEROIC_DIFFICULTY, { name: 'Living Corruption' })).toBeUndefined();
	});
});

describe('difficulty is read, not assumed', () => {
	/**
	 * Five of the six encounters with an exclusion carry the article's "On Heroic:"; Thok does not.
	 * A table that ignored the qualifier would delete Malkorok's Living Corruption from a Normal pull,
	 * where WarcraftLogs counts it.
	 */
	it('applies a heroic-only rule on Heroic and not on Normal', () => {
		const npc = { name: 'Living Corruption', gameID: 71_644 };
		expect(rankingExclusionFor(51_595, HEROIC_DIFFICULTY, npc)?.npc).toBe('Living Corruption');
		expect(rankingExclusionFor(51_595, 3, npc)).toBeUndefined();
		expect(rankingExclusionFor(51_595, undefined, npc)).toBeUndefined();
	});

	it("applies Thok's unqualified rule on every difficulty", () => {
		const npc = { name: "Kor'kron Jailer", gameID: 71_658 };
		for (const difficulty of [3, HEROIC_DIFFICULTY, undefined]) {
			expect(rankingExclusionFor(51_599, difficulty, npc)?.reach, String(difficulty)).toBe('damage');
		}
	});
});

describe('matching prefers the id that is stable', () => {
	/**
	 * `gameID` is the NPC's own id and travels between reports; the report-local actor `id` does not, and
	 * the name is what the article happens to have typed. Where a caller has a `gameID` and the row has
	 * one, that is the match — which is what keeps `Empowered Desecrated Weapon` (72198), a unit the
	 * ruleset does not name, out of `Desecrated Weapon`'s row however the two names are compared.
	 */
	it('matches on gameID when both sides have one, and ignores the name then', () => {
		expect(rankingExclusionFor(51_623, HEROIC_DIFFICULTY, { name: 'whatever', gameID: 72_154 })?.npc).toBe(
			'Desecrated Weapon',
		);
		expect(
			rankingExclusionFor(51_623, HEROIC_DIFFICULTY, { name: 'Desecrated Weapon', gameID: 72_198 }),
		).toBeUndefined();
	});

	it('falls back to the exact name when either side has no gameID', () => {
		expect(rankingExclusionFor(51_599, 4, { name: 'Starved Yeti' })?.reach).toBeNull();
		expect(rankingExclusionFor(51_595, HEROIC_DIFFICULTY, { name: 'Living Corruption' })?.reach).toBe('damage');
		// The log actor is "Foul Slime"; the article writes "Foul Slimes". A name-only match misses it, and
		// this is the assertion that says so out loud rather than a bug waiting to be found.
		expect(rankingExclusionFor(51_606, HEROIC_DIFFICULTY, { name: 'Foul Slime' })).toBeUndefined();
		expect(rankingExclusionFor(51_606, HEROIC_DIFFICULTY, { name: 'Foul Slime', gameID: 71_825 })?.npc).toBe(
			'Foul Slimes',
		);
	});
});

/**
 * Every row, put through the consumer — because `reach` is a decision nothing else in this file reads.
 *
 * The three blocks above check that the table says what the article says and that the matcher finds the
 * right row. Neither of them touches the second decision the module exists to make: **which of those
 * rows leaves the enemy count**. A row could carry any `reach` at all and every assertion above would
 * still be green.
 *
 * So this is a sweep rather than a handful of examples, and it is deliberately total: every row, at all
 * three Classic registrations, on both difficulties, asserting **both** halves at once — that the
 * matcher reaches the row, and that the count predicate agrees with the row's own `reach`. Asserting
 * only the second would pass on a row the matcher can never reach, which is the failure the header
 * calls out: a table that silently excludes nobody looks exactly like a table that decided not to.
 */
describe('the counted series drops the rows that leave the count, and only those', () => {
	/** Retail SoO, Classic SoO, and the Classic re-release. `baseEncounterID` has to collapse all three. */
	const REGISTRATIONS = [0, 50_000, 100_000];
	/** Normal, and Heroic. Every committed fixture reports 4, and the heroic-only rows turn on the pair. */
	const DIFFICULTIES = [3, HEROIC_DIFFICULTY];

	it('answers every row at every registration, on both difficulties', () => {
		let excluded = 0;
		let kept = 0;

		for (const [index, rule] of SIEGE_RANKING_EXCLUSIONS.entries()) {
			// A report-local actor id that is nothing like a `gameID`, so an implementation returning the
			// wrong one of the two cannot pass by coincidence.
			const npc = { id: 900 + index, gameID: rule.gameID, name: rule.npc };

			for (const offset of REGISTRATIONS) {
				const encounterID = rule.encounterID + offset;
				for (const difficulty of DIFFICULTIES) {
					const where = `${rule.npc} @${String(encounterID)} d${String(difficulty)}`;
					const applies = !rule.heroicOnly || difficulty === HEROIC_DIFFICULTY;

					// Half one: the row is reachable at all. Without this the assertion below is satisfied
					// by a matcher that answers nothing, for every row, forever.
					expect(rankingExclusionFor(encounterID, difficulty, npc)?.npc, where).toBe(applies ? rule.npc : undefined);

					const leaves = applies && rule.reach === 'both';
					expect([...uncountedActorIDs(encounterID, difficulty, [npc])], where).toEqual(leaves ? [npc.id] : []);
					if (leaves) excluded += 1;
					else kept += 1;
				}
			}
		}

		// Non-vacuity, in both directions: a sweep that only ever excluded nothing would be green above.
		expect(excluded).toBeGreaterThan(0);
		expect(kept).toBeGreaterThan(0);
	});

	/**
	 * All three reaches on one encounter and in one call, because Garrosh happens to carry one of each.
	 *
	 * `Desecrated Weapon` is `'damage'` — struck from the rankings and still a body the rotation had to
	 * react to. `Manifestation of Rage` is `null` — nobody has measured it. `Minion of Y'Shaarj` is
	 * `'both'`. A predicate that read "excluded from rankings" as "excluded from the count" returns all
	 * three here, and that is the whole mistake this module was written to avoid.
	 */
	it("returns only Garrosh's `both` row from a list holding all three reaches", () => {
		const garrosh = SIEGE_RANKING_EXCLUSIONS.filter((rule) => rule.encounter === 'Garrosh Hellscream');
		expect(garrosh.map((rule) => rule.reach)).toEqual(['damage', null, 'both']);

		const enemies = garrosh.map((rule, index) => ({ id: 500 + index, gameID: rule.gameID, name: rule.npc }));
		expect([...uncountedActorIDs(51_623, HEROIC_DIFFICULTY, enemies)]).toEqual([502]);
	});

	it('answers nothing when the caller has no encounter, and nothing for an empty roster', () => {
		const npc = { id: 1, name: 'Living Corruption' };
		expect([...uncountedActorIDs(undefined, HEROIC_DIFFICULTY, [npc])]).toEqual([]);
		expect([...uncountedActorIDs(51_595, HEROIC_DIFFICULTY, undefined)]).toEqual([]);
		expect([...uncountedActorIDs(51_595, HEROIC_DIFFICULTY, [])]).toEqual([]);
	});

	/**
	 * The fallback, asked of the consumer rather than of the matcher — and the caveat that comes with it.
	 *
	 * The module's header argues that a name-only match is not safe and that `gameID` wins wherever both
	 * sides have one. Garrosh is where that argument was made, so it is where it is checked: the log's
	 * `Empowered Desecrated Weapon` must stay out of the set however its name is spelled, and a unit the
	 * caller can only name still reaches its row.
	 */
	it('prefers the gameID, falls back to an exact name, and answers nothing with neither', () => {
		// A unit whose name is a row's and whose id is not: the id decides, and the row is not reached.
		expect([
			...uncountedActorIDs(51_623, HEROIC_DIFFICULTY, [{ id: 1, gameID: 72_198, name: "Minion of Y'Shaarj" }]),
		]).toEqual([]);
		// The same row, named and unidentified — the shape a caller holding the report's `actors` has.
		expect([...uncountedActorIDs(51_623, HEROIC_DIFFICULTY, [{ id: 1, name: "Minion of Y'Shaarj" }])]).toEqual([1]);
		// And with neither key there is nothing to match on, which is an answer rather than a crash.
		expect([...uncountedActorIDs(51_623, HEROIC_DIFFICULTY, [{ id: 1 }])]).toEqual([]);
	});

	/**
	 * *** The gap the fallback leaves, pinned as a biconditional rather than described in a comment. ***
	 *
	 * `reportFights.graphql` asks an `enemyNPCs` entry for `id` and `gameID` and for no name, and
	 * `normaliseFight` drops any entry missing either — so the list `analyseCore` holds can only ever
	 * match by `gameID`, and a row whose `gameID` is `null` is unreachable from it. Three rows are in that
	 * state and all three are `reach: null`, so nothing decided is out of reach today and no behaviour is
	 * lost. This is the assertion that reddens the day a row is decided without a `gameID` — at which
	 * point the count would quietly stop excluding a unit the table says it excludes.
	 */
	it('has no decided row that a name-less enemy list could not reach', () => {
		const unreachable = SIEGE_RANKING_EXCLUSIONS.filter((rule) => rule.gameID === null);
		expect(unreachable.map((rule) => rule.npc)).toEqual(['Starved Yeti', 'Amber Parasites', 'Manifestation of Rage']);
		for (const rule of unreachable) expect(rule.reach, rule.npc).toBeNull();
	});
});

/**
 * *** And the same predicate against a committed pull, at the id a real report carries. ***
 *
 * Everything above supplies its own encounter id, so everything above would pass against a table keyed
 * on numbers no log has ever contained. This block does not: the ids and the actors come out of the
 * fixture directory.
 *
 * **The trap it is written for.** `IGNORED_MULTI_TARGET_ACTORS` in the Windwalker spec keys Siegecrafter
 * Blackfuse as `51601` — the raw id — while this table keys Paragons as `1593`, the base. Both name the
 * same bosses; only one of the two keyings survives a report from a different registration. The committed
 * raw fixtures settle which reading a real log needs, and they are unanimous: every one of them carries
 * `base + 50000`, so a matcher comparing a row's `1595` against a report's `51595` finds nothing at all
 * and excludes nobody, silently, on every fight.
 *
 * **What it costs to check, and the limit worth saying out loud.** No committed *raw* fixture is from an
 * encounter the ruleset names — they are Iron Juggernaut, Siegecrafter Blackfuse and Galakras, three of
 * the five "no rules" or ASP-only fights — so the production-shaped list (`id` + `gameID`, no names)
 * cannot be exercised positively against anything in this tree. The captured Windwalker analyses can:
 * `poor.json` is a Heroic Malkorok kill, and it records the report's own actor ids and names for both the
 * boss and its Living Corruption. That is a real enemy roster off a real pull of an encounter with a
 * `reach: 'both'` row, which is what this needs.
 */
describe('and it answers a committed pull, at the id that pull was logged under', () => {
	const RAW = [...rawFixtures('windwalker'), ...rawFixtures('elemental')];

	it('finds every committed pull registered at base + 50000', () => {
		expect(RAW.length).toBeGreaterThan(0);
		for (const { name, dataset } of RAW) {
			const raw = dataset.fight.encounterID;
			expect(raw - baseEncounterID(raw), `${name} ${String(raw)}`).toBe(50_000);
			// And the base is the space the table is written in, so the two are comparable at all.
			expect(baseEncounterID(raw), name).toBeLessThan(50_000);
		}
	});

	it('excludes nobody from a real enemy roster on a pull the ruleset says nothing about', () => {
		const blackfuse = RAW.find(({ dataset }) => dataset.fight.name === 'Siegecrafter Blackfuse');
		if (blackfuse === undefined)
			throw new Error(`no Siegecrafter Blackfuse fixture — the raw pulls are ${RAW.map((f) => f.name).join(', ')}`);

		const { fight, table } = blackfuse.dataset;
		// The production shape: ten NPCs, each with an id and a gameID and no name between them.
		expect(table.fight.enemyNPCs?.length).toBeGreaterThan(5);
		expect(table.fight.enemyNPCs?.every((npc) => typeof npc.gameID === 'number')).toBe(true);
		expect([...uncountedActorIDs(fight.encounterID, fight.difficulty, table.fight.enemyNPCs)]).toEqual([]);
	});

	/**
	 * The one positive assertion in this file that nothing in this file supplied the inputs for.
	 *
	 * The encounter id is not written here: it is the table's own row for the encounter the fixture names,
	 * lifted to the registration the fixture directory proves a real report uses. So this fails if the base
	 * collapse is removed.
	 *
	 * **The consumer's answer here is now the empty set, and that is the assertion rather than a hole in
	 * it.** `Living Corruption` read `reach: 'both'` and this block asserted its actor id came back; the row
	 * is `'damage'` since a second pull of the encounter was measured against it, and `uncountedActorIDs`
	 * reads no other reach. An empty set is what a matcher that answers *nothing* would also
	 * return, so the two halves are separated: the matcher is asserted to answer the row positively, and
	 * the consumer is asserted to return a body for a roster whose row is still `'both'`.
	 */
	it("matches Malkorok's Living Corruption at the id the pull was logged under, and leaves it in the count", () => {
		const captured = capturedAnalyses('windwalker').find(({ analysis }) => analysis.encounter === 'Malkorok');
		if (captured === undefined) throw new Error('no captured Malkorok analysis under specs/windwalker/__fixtures__');

		const { analysis } = captured;
		// `sef.targets` is the enemy roster this capture kept — report-local actor ids with the names the
		// report's `actors` list gave them. A captured `Analysis` carries no `enemyNPCs`, and this is the
		// nearest real thing to one: two enemies, the boss and the add the ruleset names.
		const enemies = analysis.sef?.targets ?? [];
		expect(enemies.map((target) => target.name)).toEqual(['Malkorok', 'Living Corruption']);

		const corruption = enemies.find((target) => target.name === 'Living Corruption');
		const row = SIEGE_RANKING_EXCLUSIONS.find(
			(rule) => rule.encounter === analysis.encounter && rule.npc === 'Living Corruption',
		);
		if (corruption === undefined || row === undefined) throw new Error('the fixture and the table stopped agreeing');

		const logged = row.encounterID + 50_000;
		// *** The discrepancy this block exists for, stated as an assertion. *** The id in the table is not
		// the id in the log, and nothing but `baseEncounterID` closes the gap.
		expect(SIEGE_RANKING_EXCLUSIONS.some((rule) => rule.encounterID === logged)).toBe(false);

		expect(analysis.difficulty).toBe(HEROIC_DIFFICULTY);
		// The positive half: the matcher answers this row for an id no row in the table is written under,
		// which is the base collapse doing its work and nothing else.
		expect(rankingExclusionFor(logged, analysis.difficulty, corruption)?.npc).toBe('Living Corruption');
		expect(rankingExclusionFor(logged, analysis.difficulty, corruption)?.reach).toBe('damage');
		// Report-local ids, not gameIDs: the row's `gameID` is 71644 and the actor here is a three-digit
		// report number, so the two cannot be confused for one another.
		expect(corruption.id).not.toBe(row.gameID);

		// And so the consumer leaves the body in the counted series, `'both'` being the only reach it reads.
		expect([...uncountedActorIDs(logged, analysis.difficulty, enemies)]).toEqual([]);
		// *** Which is not the empty set a matcher that answers nothing would return. *** The same consumer
		// over a roster whose row is still `'both'` hands the body back, and hands nothing back on Normal,
		// that row being heroic-only.
		const blood = [{ id: 501, gameID: 71_542, name: 'Blood' }];
		expect([...uncountedActorIDs(51_593, HEROIC_DIFFICULTY, blood)]).toEqual([501]);
		expect([...uncountedActorIDs(51_593, 3, blood)]).toEqual([]);
	});
});

/**
 * *** And the guard that stops a second copy of this table being written. ***
 *
 * The same failure `itemSources.test.ts` records for the Rune of Re-Origination: two readers each need
 * "which NPC is excluded here", each writes the ids out, and the copies drift. There is one home for
 * these ids and this is the check that keeps it one. Comments are stripped first, because prose is
 * allowed to name a number.
 */
describe('and nothing outside `rankingExclusions.ts` writes these ids', () => {
	const SRC = resolve(import.meta.dirname, '../../..');

	const sources = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
		.filter((f) => /\.tsx?$/.test(f) && !f.includes('__tests__') && !/\.test\.tsx?$/.test(f))
		.map((f) => resolve(SRC, f));

	const code = (file: string): string =>
		readFileSync(file, 'utf8')
			.replaceAll(/\/\*[\s\S]*?\*\//g, ' ')
			.replaceAll(/(^|[^:])\/\/.*$/gm, '$1');

	/** `71644` and `71_644` are one literal to the compiler, so a scan has to accept both spellings. */
	const grouped = (id: number): string => String(id).replace(/\B(?=(\d{3})+$)/g, '_');

	it('finds each excluded NPC id in the declaration and in no other module', () => {
		expect(sources.length).toBeGreaterThan(100);
		expect(sources).toContain(resolve(SRC, 'lib/game/rankingExclusions.ts'));

		for (const rule of SIEGE_RANKING_EXCLUSIONS) {
			if (rule.gameID === null) continue;
			const literal = new RegExp(String.raw`(?<!\w)(?:${String(rule.gameID)}|${grouped(rule.gameID)})(?!\w)`);
			const writers = sources.filter((file) => literal.test(code(file))).map((file) => relative(SRC, file));
			expect(writers, `${rule.npc} ${String(rule.gameID)}`).toEqual(['lib/game/rankingExclusions.ts']);
		}
	});
});
