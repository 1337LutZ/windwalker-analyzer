// The cast timeline the report draws: every press on one clock, with the aura rows underneath.
//
// Synthetic events rather than a fixture, for the reason the gear suite gives: the cases that matter
// here — one button logged under two ids, a channel's ticks, an aura that never went up — are things
// a real pull either buries among four hundred other events or does not contain at all.

import { describe, expect, it } from 'vitest';

import type { FightDataset, WclEvent } from '~/lib/types';

import { analyse } from '../windwalker';

const T0 = 100_000;
const END = T0 + 120_000;
const ME = 5;
const BOSS = 20;

const e = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: T0 + t,
	type,
	abilityGameID: id,
	sourceID: ME,
	targetID: ME,
	...extra,
});

const events: WclEvent[] = [
	// The Tigereye Brew bank, which is the only tell that this player was Windwalker at all.
	e(0, 'applybuff', 1247279),
	e(1000, 'applybuffstack', 1247279, { stack: 10 }),

	// Rising Sun Kick, applied twice with the second application starting where the first ended: the
	// debuff row must show that as one continuous bar, not two.
	e(1000, 'cast', 107428, { targetID: BOSS }),
	e(1000, 'applydebuff', 130320, { targetID: BOSS }),
	e(16000, 'removedebuff', 130320, { targetID: BOSS }),
	e(16000, 'applydebuff', 130320, { targetID: BOSS }),
	e(30000, 'removedebuff', 130320, { targetID: BOSS }),
	e(1000, 'damage', 107428, { targetID: BOSS, amount: 50_000, hitType: 2 }),

	// Jab, once under each of two weapon ids. One button, and the icon has to be Jab's.
	e(5000, 'cast', 115687, { targetID: BOSS }),
	e(6500, 'cast', 115695, { targetID: BOSS }),

	// Tiger Palm, and the buff it puts up.
	e(8000, 'cast', 100787, { targetID: BOSS }),
	e(8001, 'applybuff', 125359),
	e(28000, 'removebuff', 125359),

	// Fists of Fury: one press, four ticks that also log as casts under the tick's own id.
	e(10000, 'cast', 113656, { targetID: BOSS }),
	e(10000, 'cast', 117418, { targetID: BOSS }),
	e(11000, 'cast', 117418, { targetID: BOSS }),
	e(12000, 'cast', 117418, { targetID: BOSS }),
	e(13000, 'cast', 117418, { targetID: BOSS }),

	// A Re-Origination proc, and the off-GCD brew spent inside it.
	e(20000, 'applybuff', 139120),
	e(29999, 'removebuffstack', 1247279, { stack: 0 }),
	e(30000, 'cast', 1247275),
	e(30000, 'applybuff', 1247275),
	e(30000, 'removebuff', 139120),
	e(45000, 'removebuff', 1247275),
];

const dataset: FightDataset = {
	code: 'abc123',
	fight: {
		id: 7,
		name: 'Garrosh Hellscream',
		encounterID: 1623,
		kill: true,
		difficulty: 4,
		size: 10,
		startTime: T0,
		endTime: END,
	},
	actor: { id: ME, name: 'Bigdogmo', type: 'Player' },
	actors: [{ id: ME, name: 'Bigdogmo', type: 'Player' }],
	events,
	table: {
		fight: {
			id: 7,
			name: 'Garrosh Hellscream',
			encounterID: 1623,
			kill: true,
			difficulty: 4,
			size: 10,
			startTime: T0,
			endTime: END,
			enemyNPCs: [{ id: BOSS, gameID: 71_865 }],
		},
		damageDone: {
			entries: [
				{
					name: 'Bigdogmo',
					id: ME,
					type: 'Monk',
					itemLevel: 553,
					total: 50_000,
					activeTime: 100_000,
					abilities: [{ guid: 107428, name: 'Rising Sun Kick', total: 50_000 }],
				},
			],
		},
	},
};

const analysis = analyse(dataset);
const timeline = analysis.timeline;
const laneOf = (key: string) => timeline?.lanes.find((l) => l.key === key);

describe('the cast timeline', () => {
	it('is emitted at all', () => {
		expect(timeline).toBeDefined();
	});

	/** A timeline is read left to right; a stream in per-ability order would draw the same marks and
	 * be useless to anything that walks it. */
	it('lists every press in time order', () => {
		const times = timeline?.casts.map((c) => c.t) ?? [];
		expect(times).toEqual([...times].sort((a, b) => a - b));
		expect(times).toEqual([1000, 5000, 6500, 8000, 10000, 30000]);
	});

	/**
	 * The whole reason a mark carries an id rather than a name: it is what resolves the icon. Jab logs
	 * a different id per weapon type and those ids carry the *weapon's* icon, so taking whichever the
	 * log used first would draw a monk's Jabs as axes or swords depending on what they equipped.
	 */
	it("draws both of Jab's weapon ids as Jab", () => {
		const jabs = timeline?.casts.filter((c) => c.name === 'Jab') ?? [];
		expect(jabs).toHaveLength(2);
		expect(jabs.map((c) => c.id)).toEqual([100780, 100780]);
	});

	/** A tick is not a press. Four of them would put three Fists of Fury on the lane that never were. */
	it('does not mistake a channel tick for a cast', () => {
		expect(timeline?.casts.filter((c) => c.id === 117418)).toEqual([]);
		expect(timeline?.casts.filter((c) => c.name === 'Fists of Fury')).toHaveLength(1);
	});

	/**
	 * An off-GCD press drawn at the weight of a global claims a global was spent. The brew is the case
	 * that matters — it goes out mid-rotation and costs nothing.
	 */
	it('says which presses cost a global', () => {
		expect(timeline?.casts.find((c) => c.name === 'Tigereye Brew')?.onGcd).toBe(false);
		expect(timeline?.casts.find((c) => c.name === 'Tiger Palm')?.onGcd).toBe(true);
	});

	/** The lane list is the report's own windows, so it cannot show a different pull to the sections. */
	it('agrees with the metrics it is drawn from', () => {
		expect(laneOf('tigereye-brew')?.windows).toEqual(analysis.brew.windows);
		expect(laneOf('re-origination')?.windows.map((w) => [w.start, w.end])).toEqual(
			analysis.procs.windows.map((w) => [w.start, w.end]),
		);
		expect(laneOf('rising-sun-kick-debuff')?.windows).toEqual(analysis.debuff.windows);
	});

	/**
	 * Rising Sun Kick is re-applied long before it falls off, so the raw apply→remove pairs would draw
	 * one continuous debuff as a row of abutting pieces — and a reader counting bars would report drops
	 * the fight never had.
	 */
	it('merges the debuff windows rather than drawing one bar per application', () => {
		expect(laneOf('rising-sun-kick-debuff')?.windows).toEqual([{ start: 1000, end: 30000 }]);
	});

	it('groups each lane so a whole category can be turned off', () => {
		expect(laneOf('re-origination')?.group).toBe('proc');
		expect(laneOf('tigereye-brew')?.group).toBe('buff');
		expect(laneOf('tiger-power')?.group).toBe('buff');
		expect(laneOf('rising-sun-kick-debuff')?.group).toBe('debuff');
	});

	/** An unlit row costs a line of height and a label, and says only that the aura exists. */
	it('drops the lanes with nothing on them', () => {
		const keys = timeline?.lanes.map((l) => l.key) ?? [];
		expect(keys).toContain('tiger-power');
		expect(keys).not.toContain('energizing-brew');
		expect(keys).not.toContain('rushing-jade-wind');
		expect(keys).not.toContain('combo-breaker-tiger-palm');
	});

	/** Every lane names itself and carries an id, because the row is drawn as an icon plus a name. */
	it('carries a name and a spell id per lane', () => {
		for (const lane of timeline?.lanes ?? []) {
			expect(lane.name.length, lane.key).toBeGreaterThan(0);
			expect(lane.id, lane.key).toBeGreaterThan(0);
		}
	});

	/**
	 * A pull with no events at all still has to produce a timeline rather than a missing field.
	 *
	 * Every list is present and empty, which is the shape the chart guards for: `hiddenLanes` and
	 * `deaths` arrive as `undefined` only on a fixture captured before they existed, never from a live
	 * analysis, and a field that is sometimes absent from a fresh run is a guard nobody would write.
	 */
	it('comes back empty rather than absent for a silent pull', () => {
		const quiet = analyse({ ...dataset, events: [] });
		expect(quiet.timeline).toEqual({ casts: [], lanes: [], hiddenTargets: 0, hiddenLanes: [], deaths: [] });
	});
});

/**
 * The two buttons a Monk presses for somebody else.
 *
 * They fell through every name the engine has. The spec model has no reason to carry them — a raid
 * buff is not part of a damage rotation and nothing here scores it — and the damage table cannot
 * answer either, because it names by damage id and a buff does none. So both drew on the timeline as
 * a bare `#115921`, which is a press the reader cannot identify at all.
 *
 * The names come from the raid-buff roster, which already had to know these ids to report the rows —
 * including the one id in it that is not the cast: Legacy of the Emperor lands on the raid as 117666
 * and is pressed as 115921, and the roster carries both under one name. One source, so the timeline
 * and the buff section can never disagree about what a Monk just pressed.
 */
describe('the raid buffs a Monk casts on the raid', () => {
	const buffed = analyse({
		...dataset,
		events: [...events, e(2000, 'cast', 115921), e(3000, 'cast', 116781)],
	});
	const named = buffed.timeline?.casts.map((c) => c.name) ?? [];

	it('names them rather than drawing their spell ids', () => {
		expect(named).toContain('Legacy of the Emperor');
		expect(named).toContain('Legacy of the White Tiger');
		expect(named.filter((name) => name.startsWith('#'))).toEqual([]);
	});
});

/**
 * The rest of the gear, which the timeline used to see exactly one piece of.
 *
 * Re-Origination had a lane because the snapshot analysis needed one, and every other thing the kit
 * did — the meta gem, the legendary cloak, the tier four-piece, the trinket, the tinker, the potion —
 * happened off the chart. So a reader looking at a brew and asking "what else was up" was shown the
 * one trinket this report happens to grade and nothing else.
 *
 * Synthetic rather than a fixture for the reason at the top of this file, plus one of its own: a real
 * pull only contains the gear that player wore, and the case worth pinning is a monk whose kit is not
 * the reference monk's — which is why Ferocity is asserted *absent* below rather than left unmentioned.
 */
describe('the item procs a Windwalker carries', () => {
	const geared = analyse({
		...dataset,
		events: [
			...events,
			// The meta gem's charge counter, in the exact shape both reference reports record it: the
			// `applybuff` is charge 1, the stack events run 2 → 3 → 4, and the *fifth* charge is the
			// removal rather than a `stack: 5` — the buff has spent itself by the time it exists. The
			// discharge follows a fraction of a second later as Lightning Strike damage, which is the
			// only place the payoff appears at all. Written out because this test used to assert a
			// `stack: 5` no client has ever emitted.
			e(2000, 'applybuff', 137596),
			e(2200, 'refreshbuff', 137596),
			e(2200, 'applybuffstack', 137596, { stack: 2 }),
			e(2300, 'applybuffstack', 137596, { stack: 3 }),
			e(2400, 'applybuffstack', 137596, { stack: 4 }),
			e(2500, 'removebuff', 137596),
			e(2760, 'damage', 137597, { targetID: BOSS, amount: 276_205, hitType: 2 }),
			// The legendary cloak, three seconds of it.
			e(4000, 'applybuff', 146194),
			e(7000, 'removebuff', 146194),
			// Haromm's Talisman.
			e(9000, 'applybuff', 148903),
			e(19000, 'removebuff', 148903),
			// The tier four-piece, which is bought with brew stacks rather than rolled for.
			e(31000, 'applybuff', 145024),
			e(41000, 'removebuff', 145024),
			// The kit, pressed: the tinker's button and the buff it puts up are two different ids.
			e(12000, 'cast', 126734),
			e(12001, 'applybuff', 96228),
			e(22000, 'removebuff', 96228),
			// And one with no buff behind it at all, which is why it has no aura in the model.
			e(50000, 'cast', 6262),
		].sort((a, b) => a.timestamp - b.timestamp),
	});
	const lane = (key: string) => geared.timeline?.lanes.find((l) => l.key === key);
	const at = (key: string) => lane(key)?.windows.map((w) => [w.start, w.end]);

	it('draws what the gear fired as its own row', () => {
		expect(at('capacitance')).toEqual([[2000, 2500]]);
		expect(at('flurry-of-xuen')).toEqual([[4000, 7000]]);
		expect(at('vicious')).toEqual([[9000, 19000]]);
		expect(at('focus-of-xuen')).toEqual([[31000, 41000]]);
	});

	/** One toggle has to be able to turn the whole readout of gear off, and leave the kit you pressed. */
	it('groups the gear as procs and the buttons you pressed as buffs', () => {
		expect(lane('capacitance')?.group).toBe('proc');
		expect(lane('vicious')?.group).toBe('proc');
		expect(lane('synapse-springs')?.group).toBe('buff');
	});

	/** A monk who wore a different trinket must not pay a row to be told the one he lacks never fired. */
	it('draws no row for gear this pull never had', () => {
		expect(lane('ferocity')).toBeUndefined();
	});

	/**
	 * The meta gem's row is the one place a window is not the whole story.
	 *
	 * Capacitance is up for most of a pull, so a bar saying "up" is a bar saying nothing; what separates
	 * a fast pull from a slow one is how often the counter filled. The counter therefore rides on the
	 * lane, and the steps are the levels the log actually stamped — 1 from the application, then 2, 3
	 * and 4 — never a 5, because the client does not emit one.
	 */
	it('carries the meta gem counter on its lane, at the levels the log stamped', () => {
		const stacks = lane('capacitance')?.stacks;
		expect(stacks?.points).toEqual([
			[2000, 1],
			[2200, 1],
			[2200, 2],
			[2300, 3],
			[2400, 4],
			[2500, 0],
		]);
		// The ceiling is the model's five and not this pull's peak of four: a counter scaled to what a
		// log can show would draw a meter that fills on every cycle, which is the opposite of the truth.
		expect(stacks?.max).toBe(5);
	});

	/**
	 * The discharge is placed on the damage it dealt, not on the counter emptying.
	 *
	 * Those are two different instants — on the reference reports the hit lands a median of ~260ms after
	 * the removal, tailing to 2.8s. Both are kept: `t` is where the log put the strike and `from` is
	 * where the log put the emptying, so the chart can draw the wait between them without either end
	 * being nudged to meet the other.
	 */
	it('marks the discharge from Lightning Strike itself, with what it hit and the fill it spent', () => {
		expect(lane('capacitance')?.stacks?.discharges).toEqual([{ t: 2760, amount: 276_205, from: 2500 }]);
		expect(lane('capacitance')?.stacks?.payoff).toBe('Lightning Strike');
		// Carried so the chart can draw the icon without ever learning a spell id of its own.
		expect(lane('capacitance')?.stacks?.payoffId).toBe(137597);
	});

	/**
	 * A fill that discharged into nothing keeps its silence.
	 *
	 * Six cycles in one reference report and seven in the other emptied with no hit behind them, the
	 * proc having found nobody to strike. That is an outcome rather than a hole, so nothing is drawn and
	 * — this is the part worth pinning — no *later* strike is dragged backwards to claim the fill.
	 */
	it('attributes a strike to the fill it actually spent, and leaves an unspent one alone', () => {
		const twice = analyse({
			...dataset,
			events: [
				...events,
				// A first cycle that empties with no strike after it at all.
				e(60000, 'applybuff', 137596),
				e(60400, 'removebuff', 137596),
				// A second, a full ten seconds later, which does discharge.
				e(70000, 'applybuff', 137596),
				e(70400, 'removebuff', 137596),
				e(70700, 'damage', 137597, { targetID: BOSS, amount: 100_000, hitType: 1 }),
			].sort((a, b) => a.timestamp - b.timestamp),
		});
		const discharges = twice.timeline?.lanes.find((l) => l.key === 'capacitance')?.stacks?.discharges;
		// One strike, paired with the *second* emptying and not the first — order alone decides it.
		expect(discharges).toEqual([{ t: 70700, amount: 100_000, from: 70400 }]);
	});

	/** Every other proc is on-or-off, and a counter attached to one would be a meter that never moves. */
	it('leaves the procs that do not stack without a counter', () => {
		expect(lane('flurry-of-xuen')?.stacks).toBeUndefined();
		expect(lane('vicious')?.stacks).toBeUndefined();
	});

	/**
	 * The kit is modelled so the timeline can *sort* it, so the presses have to arrive named — a
	 * `#126734` sorts into the right tier and still tells the reader nothing.
	 */
	it('names the consumables it now carries rather than drawing their spell ids', () => {
		const named = geared.timeline?.casts.map((c) => c.name) ?? [];
		expect(named).toContain('Synapse Springs');
		expect(named).toContain('Healthstone');
		expect(named.filter((name) => name.startsWith('#'))).toEqual([]);
	});
});

/**
 * Focus of Xuen, which is the one aura on this chart that is *spent* rather than waited out.
 *
 * The tier-16 four-piece hands it over for every ten Tigereye Brew stacks spent and the next Blackout
 * Kick, Fists of Fury or Rising Sun Kick cashes it in — so a window that was pressed away and a window
 * that ran out draw the identical bar, and the press that took it is the only thing separating them.
 *
 * The tolerance below is a measurement rather than a convention. Across 276 windows on every
 * Windwalker boss pull in both anonymous reports, 270 removals carry a chi spender within four
 * milliseconds and the next-nearest spender is never closer than 981ms, so the pairing is not close to
 * ambiguous — which is exactly why the cases worth pinning here are the six that are not the modal
 * one. Synthetic for that reason: a real pull is 97% the easy case.
 */
describe('what spent each Focus of Xuen', () => {
	const FOCUS = 145_024;
	const BLACKOUT_KICK = 100_784;
	const spends = (extra: WclEvent[]) =>
		analyse({
			...dataset,
			events: [...events, ...extra].sort((a, b) => a.timestamp - b.timestamp),
		}).timeline?.lanes.find((l) => l.key === 'focus-of-xuen')?.spent;

	/** The modal case: the press and the removal share a millisecond, because they are one event. */
	it('names the press stamped on the removal', () => {
		expect(
			spends([
				e(60_000, 'applybuff', FOCUS),
				e(61_500, 'cast', BLACKOUT_KICK, { targetID: BOSS }),
				e(61_500, 'removebuff', FOCUS),
			]),
		).toEqual([{ start: 60_000, id: BLACKOUT_KICK, name: 'Blackout Kick' }]);
	});

	/**
	 * And the other half of that population: the press lands a millisecond *before* the removal. Both
	 * orderings occur — 131 of the 270 on the same stamp, 137 one before — so a rule that demanded
	 * simultaneity would have missed half of them.
	 */
	it('names a press stamped a millisecond before the removal', () => {
		expect(
			spends([
				e(65_000, 'applybuff', FOCUS),
				e(66_999, 'cast', 107_428, { targetID: BOSS }),
				e(67_000, 'removebuff', FOCUS),
			]),
		).toEqual([{ start: 65_000, id: 107_428, name: 'Rising Sun Kick' }]);
	});

	/**
	 * The outcome the whole thing exists to keep honest. Ten seconds is easily missed, and both windows
	 * that ran out on the reference pulls have a Rising Sun Kick a little over a second *after* the
	 * removal — the press that would have spent it, had it come in time. A symmetric window would have
	 * named that press as the consumer of a buff it never got.
	 */
	it('says a window ran out rather than naming the press that came too late', () => {
		expect(
			spends([
				e(70_000, 'applybuff', FOCUS),
				e(80_000, 'removebuff', FOCUS),
				e(81_200, 'cast', BLACKOUT_KICK, { targetID: BOSS }),
			]),
		).toEqual([{ start: 70_000, id: null, name: null, fate: 'expired' }]);
	});

	/**
	 * A window that came off early with no press behind it, which is the third answer and not the
	 * second. On the reference pulls it is the player dying and every buff leaving at once — the clock
	 * had not run out, so calling it an expiry would be inventing one.
	 */
	it('claims nothing for a window that came off early with no press near it', () => {
		expect(
			spends([
				e(85_000, 'applybuff', FOCUS),
				e(86_000, 'cast', BLACKOUT_KICK, { targetID: BOSS }),
				e(87_800, 'removebuff', FOCUS),
			]),
		).toEqual([{ start: 85_000, id: null, name: null }]);
	});

	/** Still up when the last event landed: the pull ended first, which is not a window anyone wasted. */
	it('says the pull ended first for a window that never closed', () => {
		expect(spends([e(115_000, 'applybuff', FOCUS)])).toEqual([
			{ start: 115_000, id: null, name: null, fate: 'truncated' },
		]);
	});

	/** A button that cannot spend it never claims it, however close to the removal it lands. */
	it('ignores a press that is not one of the three that spend it', () => {
		expect(
			spends([
				e(90_000, 'applybuff', FOCUS),
				e(91_000, 'cast', 100_787, { targetID: BOSS }),
				e(91_000, 'removebuff', FOCUS),
			]),
		).toEqual([{ start: 90_000, id: null, name: null }]);
	});

	/** Every other lane is a window and nothing more, and carries no verdict to be read off it. */
	it('leaves the auras nothing spends without a verdict', () => {
		const other = analyse({
			...dataset,
			events: [...events, e(9000, 'applybuff', 148_903), e(19_000, 'removebuff', 148_903)].sort(
				(a, b) => a.timestamp - b.timestamp,
			),
		}).timeline?.lanes;
		expect(other?.find((l) => l.key === 'vicious')?.windows).toHaveLength(1);
		expect(other?.find((l) => l.key === 'vicious')?.spent).toBeUndefined();
	});
});
