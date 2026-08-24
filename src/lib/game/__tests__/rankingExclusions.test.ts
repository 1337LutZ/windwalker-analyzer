// The Siege parsing rules as a lookup, and the four things that can go wrong with one.
//
// The table itself is a transcription, so the first block below is the independent witness the
// `itemSources` guards use: the rules written out again, by hand, from the article rather than from
// the declaration. A typo in one and not the other is the only thing that catches a typo at all.
//
// The other three blocks are about the *keying*, which is where a table like this actually fails:
// an encounter id matched raw instead of by its base (Classic registers Siege three times), a
// heroic-only rule applied to a Normal pull, and an undecided row read as if it had been decided.

import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
	baseEncounterID,
	HEROIC_DIFFICULTY,
	rankingExclusionFor,
	SIEGE_RANKING_EXCLUSIONS,
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
	 * Three, and all three for the same measured reason: no aimed press and no spawn held for as long as
	 * one target window. Everything else in the table either leaves the damage attribution alone — the
	 * add waves — or is `null`, which is this file refusing to guess rather than a row waiting to be
	 * filled in.
	 */
	it('leaves the target count on exactly three rows', () => {
		expect(SIEGE_RANKING_EXCLUSIONS.filter((rule) => rule.reach === 'both').map((rule) => rule.npc)).toEqual([
			'Living Corruption',
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
			).toBe('both');
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
		expect(rankingExclusionFor(51_595, HEROIC_DIFFICULTY, { name: 'Living Corruption' })?.reach).toBe('both');
		// The log actor is "Foul Slime"; the article writes "Foul Slimes". A name-only match misses it, and
		// this is the assertion that says so out loud rather than a bug waiting to be found.
		expect(rankingExclusionFor(51_606, HEROIC_DIFFICULTY, { name: 'Foul Slime' })).toBeUndefined();
		expect(rankingExclusionFor(51_606, HEROIC_DIFFICULTY, { name: 'Foul Slime', gameID: 71_825 })?.npc).toBe(
			'Foul Slimes',
		);
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
