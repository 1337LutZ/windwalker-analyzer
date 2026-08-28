// The two Siege rules that had to be read off a pull, measured against the pulls they were written for.
//
// A table of names can be checked by transcribing it twice. These two cannot — they are walks, and a walk
// is only as good as what it finds in a real log. So every number below was measured first and pinned
// second, and each block says what would have to change in the game for it to move.

import { describe, expect, it } from 'vitest';

import { instanceKey } from '~/lib/events';
import { rawFixture } from '~/lib/analysis/fixtures';
import { conditionalExclusions, isStruckHit } from '~/lib/game/conditionalExclusions';

/** The report's own words for "enemy" and "boss", which is what both rules split on. */
function predicates(dataset: ReturnType<typeof rawFixture>) {
	const actors = dataset.actors ?? [];
	const enemies = new Set(actors.filter((a) => a.type === 'NPC').map((a) => a.id));
	const bosses = new Set(actors.filter((a) => a.type === 'NPC' && a.subType === 'Boss').map((a) => a.id));
	return { isEnemy: (id: number) => enemies.has(id), isBoss: (id: number) => bosses.has(id) };
}

function runOn(spec: string, name: string) {
	const dataset = rawFixture(spec, name);
	return {
		dataset,
		struck: conditionalExclusions({
			encounterID: dataset.fight.encounterID,
			difficulty: dataset.fight.difficulty,
			events: dataset.events,
			enemyDeaths: dataset.enemyDeaths,
			...predicates(dataset),
		}),
	};
}

describe('Paragons — "damage done to any Paragon that heals to full is excluded"', () => {
	it('finds the regens, and only on Paragons', () => {
		const { dataset, struck } = runOn('protection', 'paragons.json');
		expect(dataset.fight.encounterID).toBe(51_593);
		expect(dataset.fight.difficulty).toBe(4);
		// Six of the nine Paragons top off at least once on this kill.
		expect(struck.size).toBe(6);
		expect([...struck.values()].every((row) => row.rule === 'healsToFull')).toBe(true);
		// `Blood` (actor 477) climbs back to full too and is deliberately *not* here: it is a
		// `subType: 'NPC'` rather than a Boss, so it is not a Paragon and this rule is not about it. The
		// ruleset already strikes it by name, with `reach: 'both'`. Counting it was the first wrong answer
		// this test caught — the walk is only right because `subType` is doing the work, not the encounter.
		expect([...struck.keys()].some((key) => key.startsWith('477:'))).toBe(false);
	});

	it('strikes the attempts that were undone and keeps the one that landed', () => {
		const { dataset, struck } = runOn('protection', 'paragons.json');
		let strickenAmount = 0;
		let totalAmount = 0;
		for (const event of dataset.events) {
			if (event.type !== 'damage') continue;
			const amount = typeof event.amount === 'number' ? event.amount : 0;
			totalAmount += amount;
			if (isStruckHit(struck, event.targetID, event.targetInstance, event.timestamp)) strickenAmount += amount;
		}
		// 17.75% of the pull's damage went into Paragons that were then healed back to full. That is the
		// padding the rule exists to remove, and it is a sixth of the log — on a kill, by a tank, against a
		// boss nobody would call a padding fight. It is the single largest exclusion this codebase applies.
		expect((strickenAmount / totalAmount) * 100).toBeCloseTo(17.75, 1);
		// And the rest survives: every Paragon here was eventually killed, so the damage after each one's
		// last top-off is damage that finished it. A rule that struck whole lives would take 100% of these
		// seven units instead.
		expect(strickenAmount).toBeLessThan(totalAmount);
	});
});

describe('Garrosh — "damage done to adds that don\'t die is removed"', () => {
	it('finds the one add left standing, which is the one the name table could not name', () => {
		const { dataset, struck } = runOn('protection', 'garrosh.json');
		expect(dataset.fight.encounterID).toBe(51_623);
		expect(struck.size).toBe(1);
		const row = [...struck.values()][0];
		expect(row?.rule).toBe('neverDies');
		expect(row?.throughMs).toBe(Number.POSITIVE_INFINITY);
		// Actor 515, instance 2 — gameID 72198, `Empowered Desecrated Weapon`. It is the empowered form of
		// the weapon the ruleset names, so it carries a static row of its own; this rule is the other
		// mechanism and reaches it on a different ground entirely — the add was still standing at the end,
		// which is a property of the pull rather than of the article.
		expect(struck.has(instanceKey(515, 2))).toBe(true);
		expect((dataset.table.fight.enemyNPCs ?? []).find((n) => n.id === 515)?.gameID).toBe(72_198);
	});

	it('refuses to answer at all when the dataset carries no deaths', () => {
		const dataset = rawFixture('protection', 'garrosh.json');
		const struck = conditionalExclusions({
			encounterID: dataset.fight.encounterID,
			difficulty: dataset.fight.difficulty,
			events: dataset.events,
			enemyDeaths: undefined,
			...predicates(dataset),
		});
		// Not "nothing survived" — *nothing was asked*. Without deaths every add on the pull reads as a
		// survivor, which is the widest possible strike rather than the safest one.
		expect(struck.size).toBe(0);
	});
});

describe('the gates', () => {
	it('does not fire on a Normal pull', () => {
		const dataset = rawFixture('protection', 'paragons.json');
		const struck = conditionalExclusions({
			encounterID: dataset.fight.encounterID,
			difficulty: 3,
			events: dataset.events,
			enemyDeaths: dataset.enemyDeaths,
			...predicates(dataset),
		});
		expect(struck.size).toBe(0);
	});

	it('does not fire on an encounter neither rule names', () => {
		const { struck } = runOn('protection', 'galakras.json');
		expect(struck.size).toBe(0);
	});

	it('matches the encounter by its base id, at every registration', () => {
		const dataset = rawFixture('protection', 'paragons.json');
		for (const encounterID of [1593, 51_593, 101_593]) {
			const struck = conditionalExclusions({
				encounterID,
				difficulty: 4,
				events: dataset.events,
				enemyDeaths: dataset.enemyDeaths,
				...predicates(dataset),
			});
			expect(struck.size).toBe(6);
		}
	});
});
