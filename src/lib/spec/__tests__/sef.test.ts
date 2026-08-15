// Storm, Earth and Fire.
//
// Synthetic events rather than a fixture, for the reason the Rising Sun Kick lane suite gives: every
// committed fixture is a single-target pull, and this cooldown is only ever pressed on the fights
// none of them are. The three reference pulls the report was built against — Garrosh, Iron
// Juggernaut and Malkorok — contain no press of it at all.
//
// The cases that matter are the ones where the report could invent something. A spirit sharing the
// player's target is the fault this section exists to name, so the test that must not be removed is
// the one where the player stays off the spirit's enemy and the answer comes back zero — and beside
// it, the one where the spirits left no actor to follow and the answer comes back null rather than
// zero. "You never doubled up" and "this cannot be measured" are different sentences, and only one
// of them is true on a log that carried no pet.

import { describe, expect, it } from 'vitest';

import type { Actor, FightDataset, WclEvent } from '~/lib/types';

import { SEF_SECOND_TARGET_MS, analyse } from '../windwalker';

const T0 = 100_000;
const END = T0 + 120_000;
const ME = 5;
/** The spirits' actor. In a real report they are `Pet` rows owned by the monk; here, one of them. */
const SPIRIT = 6;
/** The second spirit's actor — a different pet of the same monk, out at the same time as the first. */
const SPIRIT2 = 9;
/** Xuen's actor, which must never be mistaken for a spirit — it is a pet of the monk too. */
const TIGER = 7;
const BOSS = 20;
const ADD = 21;

/** The press and the aura share this id. 138228 is the simulator's and appears in no Classic log. */
const SEF_ID = 137_639;
const SIM_SEF_ID = 138_228;
const XUEN_NUKE = 123_996;
const MELEE = 1;
const BLACKOUT_KICK = 100_784;
/** Rushing Jade Wind: an area effect, so it must not be read as evidence of where anyone stood. */
const RJW = 148_187;

const e = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: T0 + t,
	type,
	abilityGameID: id,
	sourceID: ME,
	targetID: ME,
	...extra,
});

/** A hit landing on `target`, from `source`. */
const hit = (t: number, source: number, target: number, id = MELEE): WclEvent =>
	e(t, 'damage', id, { sourceID: source, targetID: target, amount: 1000, hitType: 1 });

/** A run of hits on one enemy, one a second, which is what "the player was stood here" looks like. */
const stand = (from: number, to: number, source: number, target: number, id = MELEE): WclEvent[] =>
	Array.from({ length: Math.max(0, Math.floor((to - from) / 1000)) }, (_, i) =>
		hit(from + i * 1000, source, target, id),
	);

/** A press, and the spirit window it opens: the cast, then the aura the log carries while it is out. */
const sefWindow = (from: number, to: number, target: number): WclEvent[] => [
	e(from, 'cast', SEF_ID, { targetID: target }),
	e(from, 'applybuff', SEF_ID),
	e(to, 'removebuff', SEF_ID),
];

/**
 * A second spirit joining one already out, and coming back in again — as the log really writes it.
 *
 * There is no second `applybuff`. WarcraftLogs carries 137639 as a *counter*, so the arrival of a
 * second spirit is `applybuffstack stack: 2` and the recall of one of the two is `removebuffstack
 * stack: 1`. Reading the aura as apply→remove pairs sees neither, which is the fault the suite below
 * pins: two spirits collapse into one window, and on a pull whose first aura event is a stack change
 * the window is lost outright.
 */
const sefStack = (at: number, stack: number, target?: number): WclEvent[] => [
	...(target === undefined ? [] : [e(at, 'cast', SEF_ID, { targetID: target })]),
	e(at, stack > 1 ? 'applybuffstack' : 'removebuffstack', SEF_ID, { stack }),
];

/**
 * The log's own record of a spirit entering the world, naming the pet actor in `targetID`.
 *
 * One of three ids, one per spirit. They corroborate the placement count and supply the actor; they
 * cannot define the count, because a spirit placed before the pull emits no summon inside the fight
 * either — see the suite below.
 */
const summon = (at: number, id: number, pet: number): WclEvent => e(at, 'summon', id, { targetID: pet });
const SUMMON_STORM = 138_121;
const SUMMON_EARTH = 138_122;

const actors: Actor[] = [
	{ id: ME, name: 'Bigdogmo', type: 'Player' },
	{ id: SPIRIT, name: 'Storm Spirit', type: 'Pet', petOwner: ME },
	{ id: SPIRIT2, name: 'Fire Spirit', type: 'Pet', petOwner: ME },
	{ id: TIGER, name: 'Xuen', type: 'Pet', petOwner: ME },
	{ id: BOSS, name: 'Galakras', type: 'NPC', subType: 'Boss' },
	{ id: ADD, name: "Kor'kron Demolisher", type: 'NPC' },
];

const datasetOf = (events: WclEvent[], roster: Actor[] = actors): FightDataset => ({
	code: 'abc123',
	fight: {
		id: 7,
		name: 'Galakras',
		encounterID: 1620,
		kill: true,
		difficulty: 4,
		size: 25,
		startTime: T0,
		endTime: END,
	},
	actor: { id: ME, name: 'Bigdogmo', type: 'Player' },
	actors: roster,
	events,
	table: {
		fight: {
			id: 7,
			name: 'Galakras',
			encounterID: 1620,
			kill: true,
			difficulty: 4,
			size: 25,
			startTime: T0,
			endTime: END,
			enemyNPCs: [BOSS, ADD].map((id) => ({ id, gameID: 70_000 + id })),
		},
		damageDone: {
			entries: [
				{
					name: 'Bigdogmo',
					id: ME,
					type: 'Monk',
					itemLevel: 553,
					total: 1_000_000,
					activeTime: 110_000,
					abilities: [{ guid: MELEE, name: 'Melee', total: 1_000_000 }],
				},
			],
		},
	},
});

/** The tell that this player was Windwalker at all; without it `analyse` refuses the spec. */
const brewBank: WclEvent[] = [e(0, 'applybuff', 1_247_279), e(500, 'applybuffstack', 1_247_279, { stack: 10 })];

/**
 * The failure the section exists to name: the player leaves the boss and walks onto the add their
 * own spirit is already standing on.
 *
 * The spirit holds the add for the whole 40s window. The player spends the first twenty seconds on
 * the boss and the second twenty on the add, so exactly half of the window is doubled up.
 *
 * The Rushing Jade Wind ticks on top are not decoration. `targetCounts` — which is what decides
 * whether the press was called for — reads *every* hit the player landed, so a monk who walks from
 * one enemy to the next and single-targets each of them in turn genuinely reads as one target at a
 * time: the count only rises where two enemies fall inside the same five seconds. What puts a real
 * add pull above the line is the cleave, and this is what that looks like. The ticks say nothing
 * about the overlap below, because an area effect is not evidence of where anyone stood.
 */
const doubledUp: WclEvent[] = [
	...brewBank,
	...sefWindow(10_000, 50_000, ADD),
	...stand(12_000, 50_000, SPIRIT, ADD),
	...stand(10_000, 30_000, ME, BOSS),
	...stand(30_000, 50_000, ME, ADD),
	...stand(10_000, 50_000, ME, BOSS, RJW),
	...stand(10_000, 50_000, ME, ADD, RJW),
	// Enough contact after the window to keep the pull looking like a pull rather than 40 seconds.
	...stand(50_000, 110_000, ME, BOSS),
];

/** The same pull played correctly: the player stays on the boss the whole time the spirit is out. */
const spread: WclEvent[] = [
	...brewBank,
	...sefWindow(10_000, 50_000, ADD),
	...stand(12_000, 50_000, SPIRIT, ADD),
	...stand(10_000, 110_000, ME, BOSS),
];

describe('the spell ids', () => {
	/**
	 * The whole reason this section had to be rebuilt. wowsims registers both the spell and its aura
	 * under 138228 and the Windwalker APL casts that id, so it is the obvious constant to copy — and it
	 * appears nowhere in a Mists Classic log. A pull whose every press logs under the sim's id has to
	 * come back with no presses at all, because that is what such a log would really mean.
	 */
	it('reads the press under 137639 and never under the simulator’s 138228', () => {
		const real = analyse(datasetOf(doubledUp));
		expect(real.sef?.casts).toBe(1);

		const simIds = doubledUp.map((ev) => (ev.abilityGameID === SEF_ID ? { ...ev, abilityGameID: SIM_SEF_ID } : ev));
		expect(analyse(datasetOf(simIds)).sef?.casts).toBe(0);
	});

	/** The press carries the enemy the spirit was sent to, and the report names it from the roster. */
	it('carries the enemy each press was aimed at', () => {
		const { sef } = analyse(datasetOf(doubledUp));
		expect(sef?.uses).toHaveLength(1);
		expect(sef?.uses[0]?.target).toBe(ADD);
		expect(sef?.uses[0]?.name).toBe("Kor'kron Demolisher");
	});

	/** The window is the aura's own, never a duration measured forward from the press. */
	it('takes the window from the aura rather than from the cast', () => {
		const { sef } = analyse(datasetOf(doubledUp));
		expect(sef?.windows).toEqual([{ start: 10_000, end: 50_000 }]);
		expect(sef?.uptimeMs).toBe(40_000);
	});
});

describe('the spirits', () => {
	/**
	 * The spirits arrive in the fetched stream as pets of the monk, which is the same route Xuen's
	 * damage already takes — so the tiger has to be kept out of their damage by name of the one spell
	 * only it casts, not by being a pet.
	 */
	it('counts the spirits’ damage and not the tiger’s', () => {
		const withTiger = [
			...doubledUp,
			e(60_000, 'cast', 123_904),
			hit(61_000, TIGER, BOSS, XUEN_NUKE),
			hit(62_000, TIGER, BOSS),
		];
		const { sef } = analyse(datasetOf(withTiger));
		expect(sef?.clones).toBe(1);
		// 38 swings of 1000 from the spirit, and nothing from the tiger.
		expect(sef?.cloneDamage).toBe(38_000);
	});

	/**
	 * A pull whose spirits left no actor behind cannot be asked whether the player doubled up, and the
	 * answer to that is null — not zero. Zero would read as "you never shared a target", which is a
	 * compliment the log did not pay.
	 */
	it('says it cannot tell when the spirits left no actor', () => {
		const noPet = doubledUp.filter((ev) => ev.sourceID !== SPIRIT);
		const { sef } = analyse(datasetOf(noPet));
		expect(sef?.casts).toBe(1);
		expect(sef?.clones).toBe(0);
		expect(sef?.overlapMs).toBeNull();
		expect(sef?.overlapPct).toBeNull();
	});
});

describe('the same-target overlap', () => {
	it('measures the time the player stood on an enemy their own spirit was on', () => {
		const { sef } = analyse(datasetOf(doubledUp));
		// The player's hits on the add run 30s→49s and each owns the second until the next; the last one
		// owns the rest of the window. So the doubled-up stretch is 30s to the window's close at 50s.
		expect(sef?.overlapMs).toBe(20_000);
		expect(sef?.overlaps.map((o) => o.target)).toEqual([ADD]);
		expect(sef?.overlaps[0]?.name).toBe("Kor'kron Demolisher");
	});

	/** Against the time the player was demonstrably on something with the spirits out, not the window. */
	it('takes its share against the player’s own contact time', () => {
		const { sef } = analyse(datasetOf(doubledUp));
		expect(sef?.measuredMs).toBe(40_000);
		expect(sef?.overlapPct).toBeCloseTo(50, 5);
	});

	/** Played correctly, the answer is zero — and zero is only ever printed when it was measured. */
	it('reports nothing when the player stayed off the spirit’s enemy', () => {
		const { sef } = analyse(datasetOf(spread));
		expect(sef?.overlapMs).toBe(0);
		expect(sef?.overlaps).toEqual([]);
	});

	/**
	 * The trap that would have made this metric fire on every add fight. Rushing Jade Wind hits every
	 * enemy in range, so if area damage counted as evidence of where an actor stood, a player and a
	 * spirit both spinning would share every target in the room. Only the five single-target ids count.
	 */
	it('never reads an area effect as standing on an enemy', () => {
		const spinning = [
			...spread,
			// Both of them spinning, both ticking on both enemies, right through the spirit's window.
			...stand(12_000, 50_000, ME, ADD, RJW),
			...stand(12_000, 50_000, SPIRIT, BOSS, RJW),
		];
		expect(analyse(datasetOf(spinning)).sef?.overlapMs).toBe(0);
	});

	/** A damage-over-time tick keeps landing on an enemy the actor walked away from, so it is not contact. */
	it('never reads a tick as standing on an enemy', () => {
		const ticking = [...spread, ...stand(12_000, 50_000, ME, ADD, BLACKOUT_KICK).map((ev) => ({ ...ev, tick: true }))];
		expect(analyse(datasetOf(ticking)).sef?.overlapMs).toBe(0);
	});
});

describe('whether the press was called for', () => {
	/**
	 * The reader's rule, as a measurement: a stretch of two or more enemies lasting longer than
	 * `SEF_SECOND_TARGET_MS`. On this pull the player is on the add for twenty seconds with the boss
	 * still inside the five-second counting window, which is comfortably over it.
	 */
	it('calls a sustained second target justification', () => {
		const { sef } = analyse(datasetOf(doubledUp));
		expect(sef?.justified).toBe(true);
		expect(sef?.longestSecondTargetMs).toBeGreaterThan(SEF_SECOND_TARGET_MS);
		expect(sef?.secondTargetMs).toBe(SEF_SECOND_TARGET_MS);
	});

	/**
	 * A momentary second target is not a second target. One stray swing at the add puts the count at
	 * two for the five seconds of the counting window and no longer, which is under the rule — so a
	 * pull that pressed the button here is told the pull did not call for it, and a pull that did not
	 * press it is told nothing at all.
	 */
	it('refuses a momentary second target', () => {
		const glance = [...brewBank, ...stand(0, 110_000, ME, BOSS), hit(40_000, ME, ADD)];
		const { sef } = analyse(datasetOf(glance));
		expect(sef?.justified).toBe(false);
		expect(sef?.longestSecondTargetMs).toBeLessThanOrEqual(SEF_SECOND_TARGET_MS);
		expect(sef?.justifiedMs).toBe(0);
	});

	/** A pull that never pressed it and never needed to is the ordinary single-target case. */
	it('says a single-target pull neither pressed it nor needed it', () => {
		const { sef } = analyse(datasetOf([...brewBank, ...stand(0, 110_000, ME, BOSS)]));
		expect(sef?.casts).toBe(0);
		expect(sef?.justified).toBe(false);
		expect(sef?.uptimeMs).toBe(0);
	});
});

/**
 * Two spirits out at once — the case the section could not see at all, and the reason it was rebuilt.
 *
 * 137639 is a counter, so the second spirit's arrival is `applybuffstack stack: 2` and carries no
 * second `applybuff`. Reading the aura as apply→remove pairs drops every stack event on the floor,
 * which cost this section two different ways on the same pull: two simultaneous spirits collapsed into
 * one window, and a pull whose *first* aura event is a stack change — a spirit placed before the pull,
 * which is ordinary play — lost its opening window entirely and with it every spirit before it.
 *
 * Measured against a:YBQzrcgVJnAj7NMP fight 15, whose numbers these mirror: two spirits from the
 * opening stack event, one after the recall, none after the removal, and one again after the last
 * press. Before the fix that pull reported 30.6% uptime and one spirit; the log's stack walk, its
 * `summon` events and its pets' own swings all three say 97.4% and two.
 */
describe('two spirits at once', () => {
	/**
	 * One spirit placed before the pull, a second sent at 10s, the second recalled at 40s, both gone at
	 * 70s. The first spirit's own window therefore runs from the pull to 70s, and the log never writes
	 * an `applybuff` for it at all — the only trace it leaves inside the fight is `stack: 2` at 10s
	 * saying one was already there.
	 */
	const both: WclEvent[] = [
		...brewBank,
		...sefStack(10_000, 2, ADD),
		...sefStack(40_000, 1),
		e(70_000, 'removebuff', SEF_ID),
		// The first spirit, out from before the pull, on the boss the whole time.
		...stand(1_000, 70_000, SPIRIT, BOSS),
		// The second, out only between the stack events, on the add it was sent to.
		...stand(11_000, 40_000, SPIRIT2, ADD),
		// The player, on neither of them.
		...stand(0, 110_000, ME, BOSS),
	];

	it('opens the window at the pull when the first aura event is a stack change', () => {
		const { sef } = analyse(datasetOf(both));
		// Not 10s. A stack event cannot fire on an aura that is not applied, so the aura was already up
		// when the fight began — and the pet swinging at 1s is the spirit it was up for.
		expect(sef?.windows).toEqual([{ start: 0, end: 70_000 }]);
		expect(sef?.uptimeMs).toBe(70_000);
	});

	it('counts both spirits rather than collapsing them into one', () => {
		const { sef } = analyse(datasetOf(both));
		// Two distinct pet actors, and the second one's damage is only reachable because the window it
		// swung inside now exists: `sefCloneActors` only looks at damage landing inside a window.
		expect(sef?.clones).toBe(2);
		expect(sef?.doubledMs).toBe(30_000);
	});

	it('draws a lane for each enemy a spirit stood on, from the spirits’ own swings', () => {
		const { sef } = analyse(datasetOf(both));
		const lanes = new Map((sef?.targets ?? []).map((target) => [target.id, target]));

		// The first spirit held the boss for the whole window; the second held the add between the two
		// stack events. Each swing owns the time until that spirit's next, and the last owns the rest of
		// the window — so the boss lane runs to the window's close at 70s.
		expect(lanes.get(BOSS)?.heldMs).toBe(69_000);
		expect(lanes.get(ADD)?.heldMs).toBe(29_000);
		expect(lanes.get(ADD)?.windows).toEqual([{ start: 11_000, end: 40_000 }]);
		expect(lanes.get(ADD)?.name).toBe("Kor'kron Demolisher");
	});

	/**
	 * The fault suspect three would have been. Every press here names the *add*, and the spirit that was
	 * already out spends the whole pull on the boss — so a chart keyed to the cast's target would draw
	 * seventy seconds of spirit time on an enemy no spirit ever swung at.
	 */
	it('reads a spirit’s enemy from where it swung, never from where the press aimed', () => {
		const { sef } = analyse(datasetOf(both));
		// The only press in this pull named the add; the pre-pull spirit spent the whole window on the
		// boss and no cast anywhere in the log says so.
		expect(sef?.uses.find((use) => use.prePull !== true)?.target).toBe(ADD);
		expect((sef?.targets ?? []).find((target) => target.id === BOSS)?.heldMs).toBeGreaterThan(0);
	});

	/** The old reading, kept as a regression: a pair model sees one window opening at 70s and nothing else. */
	it('does not lose the pull to a log that only ever stacks', () => {
		const { sef } = analyse(datasetOf(both));
		expect(sef?.windows).not.toEqual([]);
		expect(sef?.uptimeMs).toBeGreaterThan(0);
	});
});

/**
 * Counting spirits sent rather than buttons pressed.
 *
 * The second half of the same bug. Fixing the *windows* let the section see a spirit placed before the
 * pull; the *count* was still `casts.length`, so a pull with three spirits reported two — and the lane
 * chart drew a spirit arriving at 2.6s that no row on the page accounted for.
 *
 * Measured on a:YBQzrcgVJnAj7NMP fight 15: two casts of 137639, two `summon` events, one spirit
 * already out at the pull, and the stack walk's rises agreeing with the summons exactly. Three
 * placements. On a:6MhZgjyAknFWrYfK fight 16, four casts, four summons, four rises, nothing pre-placed
 * — four placements, and that pull's number does not move.
 */
describe('the placement count', () => {
	/** One out before the pull, one sent at 10s. Two spirits, one press, and a summon for the press. */
	const prePulled: WclEvent[] = [
		...brewBank,
		...sefStack(10_000, 2, ADD),
		summon(10_000, SUMMON_STORM, SPIRIT2),
		...sefStack(40_000, 1),
		e(70_000, 'removebuff', SEF_ID),
		...stand(1_000, 70_000, SPIRIT, BOSS),
		...stand(11_000, 40_000, SPIRIT2, ADD),
		...stand(0, 110_000, ME, BOSS),
	];

	it('counts the spirit placed before the pull', () => {
		const { sef } = analyse(datasetOf(prePulled));
		// Two spirits went out; only one button was pressed inside the pull.
		expect(sef?.casts).toBe(2);
		expect(sef?.pressed).toBe(1);
		expect(sef?.prePlaced).toBe(1);
	});

	/**
	 * The pre-pull placement is a row, and its clock is 0 because that is where the evidence begins —
	 * `prePull` is what stops the section printing that as a global spent at the pull.
	 */
	it('lists it as a placement with no time of its own', () => {
		const { sef } = analyse(datasetOf(prePulled));
		const first = sef?.uses[0];
		expect(first?.prePull).toBe(true);
		expect(first?.t).toBe(0);
	});

	/**
	 * Its enemy is recoverable after all, and that was worth correcting. The *cast* is outside the fight
	 * window, but the spirit is in the log from the first second and the report already reads every
	 * other spirit's enemy off its own swings. Here the pre-pull spirit swings at the boss from 1s.
	 *
	 * `deduced` keeps it visibly a weaker claim than a press: a swing proves where a spirit *stood*,
	 * which is not the same statement as where it was *sent*.
	 */
	it('reads the pre-pull spirit’s enemy from its own first swings', () => {
		const { sef } = analyse(datasetOf(prePulled));
		const first = sef?.uses[0];
		expect(first?.target).toBe(BOSS);
		expect(first?.name).toBe('Galakras');
		expect(first?.deduced).toBe(true);
		// The press-aimed placement is not marked: its target came from the cast, which is the stronger
		// evidence, and conflating the two would be the whole point of the flag lost.
		expect(sef?.uses[1]?.deduced).toBeUndefined();
	});

	/**
	 * And it stops at the edge of the evidence. A spirit that never swung — its enemy died before it
	 * connected, or it was recalled first — leaves nothing to read, so the target stays null rather
	 * than borrowing the nearest enemy. "Cannot say" is still an answer.
	 */
	it('says nothing about a pre-pull spirit that never swung', () => {
		const silent = prePulled.filter((ev) => ev.sourceID !== SPIRIT);
		const { sef } = analyse(datasetOf(silent));
		const first = sef?.uses[0];
		expect(first?.prePull).toBe(true);
		expect(first?.target).toBeNull();
		expect(first?.deduced).toBeUndefined();
	});

	/** The summon names the pet; the placement it could not witness carries null rather than a guess. */
	it('takes the actor from the summon, and null where there was none', () => {
		const { sef } = analyse(datasetOf(prePulled));
		expect(sef?.uses[0]?.actorID).toBeNull();
		expect(sef?.uses[1]?.actorID).toBe(SPIRIT2);
	});

	/**
	 * A log with no summon events at all still counts correctly. This is why the stack walk is primary
	 * rather than the summons: the count comes off the same array the windows do, so the number and the
	 * bar drawn beside it cannot disagree, and a summon only ever adds the actor.
	 */
	it('counts from the aura even when the log carries no summons', () => {
		const noSummons = prePulled.filter((ev) => ev.type !== 'summon');
		const { sef } = analyse(datasetOf(noSummons));
		expect(sef?.casts).toBe(2);
		expect(sef?.prePlaced).toBe(1);
		expect(sef?.uses[1]?.actorID).toBeNull();
	});

	/** An ordinary pull loses nothing: no stacks, nothing pre-placed, and the count is still the presses. */
	it('leaves a pull with nothing placed before it alone', () => {
		const { sef } = analyse(datasetOf(doubledUp));
		expect(sef?.casts).toBe(1);
		expect(sef?.pressed).toBe(1);
		expect(sef?.prePlaced).toBe(0);
		expect(sef?.uses[0]?.prePull).toBe(false);
	});

	/**
	 * The mirror case, and it must not inflate the count. A press that lands on an enemy that already
	 * has a spirit recalls it instead of sending a second, so the level never rises and no placement is
	 * recorded — two presses, one spirit. The level walk is what makes that automatic: a placement is a
	 * *rise*, and a recall-and-replace that never returns to zero produces none.
	 */
	it('does not count a press that never raised the spirit count', () => {
		const recall: WclEvent[] = [
			...brewBank,
			...sefWindow(10_000, 60_000, ADD),
			// A second press inside the running window that moves no stack — the log records the cast and
			// the aura level stays where it was.
			e(30_000, 'cast', SEF_ID, { targetID: BOSS }),
			...stand(12_000, 60_000, SPIRIT, ADD),
			...stand(0, 110_000, ME, BOSS),
		];
		const { sef } = analyse(datasetOf(recall));
		expect(sef?.pressed).toBe(2);
		expect(sef?.casts).toBe(1);
	});

	/**
	 * Separate presses, each with its own apply→remove pair — the ordinary shape, and the one the first
	 * cut of this counter got wrong. `auraLevels` never emits a level of zero, so the gap *between* two
	 * stretches is the aura at nothing and not a row in the array; a counter comparing each stretch's
	 * level against the last one's saw 1 against 1 and recorded no rise. Four presses on
	 * a:6MhZgjyAknFWrYfK fight 16 counted as one until the walk reset across the gap.
	 */
	it('counts every separate placement, not just the first', () => {
		const again: WclEvent[] = [
			...brewBank,
			...sefWindow(10_000, 40_000, ADD),
			summon(10_000, SUMMON_STORM, SPIRIT),
			...sefWindow(60_000, 90_000, BOSS),
			// A different spirit's summon id, and the same pet actor as the first — which is what a real
			// log does, so neither the id nor the actor can stand in for a placement on its own.
			summon(60_000, SUMMON_EARTH, SPIRIT),
			...stand(12_000, 40_000, SPIRIT, ADD),
			...stand(62_000, 90_000, SPIRIT, BOSS),
			...stand(0, 110_000, ME, BOSS),
		];
		const { sef } = analyse(datasetOf(again));
		expect(sef?.casts).toBe(2);
		expect(sef?.pressed).toBe(2);
		expect(sef?.uses.map((use) => use.target)).toEqual([ADD, BOSS]);
		expect(sef?.uses.map((use) => use.actorID)).toEqual([SPIRIT, SPIRIT]);
	});

	/** A spirit still out when the pull ends is one placement, not one per stretch it survived. */
	it('counts a spirit that outlives the pull once', () => {
		const held: WclEvent[] = [
			...brewBank,
			e(10_000, 'cast', SEF_ID, { targetID: ADD }),
			e(10_000, 'applybuff', SEF_ID),
			...stand(12_000, 110_000, SPIRIT, ADD),
			...stand(0, 110_000, ME, BOSS),
		];
		const { sef } = analyse(datasetOf(held));
		expect(sef?.casts).toBe(1);
		expect(sef?.windows[0]?.truncated).toBe(true);
	});
});

/**
 * The per-enemy doubled-up column, which replaced the enemy's engaged span on the grid.
 *
 * It is the pull-wide overlap kept per enemy rather than summed, so two things have to hold and both
 * are asserted rather than assumed: the rows add up to the total, and no row can exceed either of the
 * two stretches it is the intersection of. A slip in the segment bounds would show up here first, as a
 * figure a reader has no way to challenge.
 */
describe('the per-enemy doubled-up time', () => {
	it('names the enemy the doubling happened on', () => {
		const { sef } = analyse(datasetOf(doubledUp));
		const add = (sef?.targets ?? []).find((target) => target.id === ADD);
		expect(add?.overlapMs).toBe(20_000);
		expect((sef?.targets ?? []).find((target) => target.id === BOSS)?.overlapMs).toBe(0);
	});

	it('adds up to the pull-wide figure', () => {
		const { sef } = analyse(datasetOf(doubledUp));
		const summed = (sef?.targets ?? []).reduce((total, target) => total + (target.overlapMs ?? 0), 0);
		expect(summed).toBe(sef?.overlapMs);
	});

	/** The invariant. An intersection cannot be larger than either stretch it intersects. */
	it('never exceeds the spirit’s time on the enemy or the player’s', () => {
		for (const events of [doubledUp, spread]) {
			for (const target of analyse(datasetOf(events)).sef?.targets ?? []) {
				expect(target.overlapMs ?? 0).toBeLessThanOrEqual(target.heldMs);
				expect(target.overlapMs ?? 0).toBeLessThanOrEqual(target.engagedMs);
			}
		}
	});
});

describe('the per-enemy lanes', () => {
	/**
	 * The reader's rule, and the honest name for what it measures. Enemy deaths are not in the fetched
	 * stream at all — a `sourceID` filter returns a death only when the *player* is the victim, verified
	 * across both anonymous Dark Shaman pulls — so the span between an enemy's first and last damage
	 * from the player's side is what stands in for "how long it was there". An add hit for four seconds
	 * is dropped; nothing claims it died.
	 */
	it('drops an enemy the player’s side was only briefly on, and says how many', () => {
		const brief = [
			...brewBank,
			...sefWindow(10_000, 50_000, ADD),
			...stand(12_000, 50_000, SPIRIT, ADD),
			...stand(0, 110_000, ME, BOSS),
			// Four seconds of contact with a third enemy, well inside the ten-second rule.
			...stand(20_000, 24_000, ME, 22),
		];
		const roster: Actor[] = [...actors, { id: 22, name: 'Kor’kron Grunt', type: 'NPC' }];
		const { sef } = analyse(datasetOf(brief, roster));

		expect((sef?.targets ?? []).map((target) => target.id)).not.toContain(22);
		expect(sef?.shortLivedTargets).toBe(1);
	});

	/**
	 * An enemy that was never on the end of a spirit still gets its row, and that is the opposite of the
	 * rule the debuff lanes follow. There an empty row said only that an add existed; here it answers
	 * the question outright — the boss was up the whole pull and no spirit was ever sent to it.
	 */
	it('keeps a lane for an enemy no spirit was ever sent to', () => {
		const { sef } = analyse(datasetOf(spread));
		const boss = (sef?.targets ?? []).find((target) => target.id === BOSS);
		expect(boss).toBeDefined();
		expect(boss?.windows).toEqual([]);
		expect(boss?.heldMs).toBe(0);
		// And it is still measurably an enemy the player was on, which is what earned it the row.
		expect(boss?.engagedMs).toBeGreaterThan(SEF_SECOND_TARGET_MS);
	});

	/**
	 * A pull whose spirits left no actor cannot be asked where they stood, and the section has to be
	 * able to tell that apart from "no spirit went anywhere" — the same distinction `overlapMs` carries.
	 */
	it('says it cannot place the spirits when they left no actor', () => {
		const noPet = doubledUp.filter((ev) => ev.sourceID !== SPIRIT);
		const { sef } = analyse(datasetOf(noPet));
		expect(sef?.targetsResolved).toBe(false);
		expect((sef?.targets ?? []).every((target) => target.windows.length === 0)).toBe(true);
	});

	/** Ordered with the enemies a spirit actually held first — this chart's own currency, not damage. */
	it('puts the enemies a spirit held before the ones it never did', () => {
		const { sef } = analyse(datasetOf(doubledUp));
		expect(sef?.targets?.[0]?.id).toBe(ADD);
		expect((sef?.targets?.[0]?.heldMs ?? 0) > 0).toBe(true);
	});
});
