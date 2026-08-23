// Potions used, out of the two the game allows.
//
// The thing this exists to hold down is not the count but *which slot each press filled*, because
// that is the whole of the advice and the count cannot say it.
//
// Half of it is a recovery. A combat potion logs the ordinary way and was always visible; a pre-pull
// one happened before the fight's event window opened and survives only as the bare `removebuff`
// where it expired — which the aura walk discarded, along with the whole pre-pull slot, until
// `openAtPull`. `cleave` is the fixture that was demonstrably wrong: the same pull's raid shows six
// players with that signature, and the report drew one potion.
//
// The other half is a boundary, and `poor` is the fixture for it. WarcraftLogs starts the fight when
// the boss is engaged by *anyone*, so a monk who has not joined it yet can drink inside the fight
// window — leaving the full apply + cast + remove triple a combat potion leaves, 2.29s before they
// hit anything. That press filled the pre-pull slot, and reading it as the combat one told a player
// who had missed the in-combat potion to drink the pre-pull one.
//
// Under both of them runs one line: every claim here is about Virmen's Bite and nothing else, because
// the flask and the three elixirs run an hour and are on a different timer in the simulator — see
// `POTION` in `spec/windwalker`. `weave` is the fixture that would have caught a rule applied to
// them: its monk cancels two elixirs mid-pull, each of which logs a removal with no apply in front
// of it.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { scoreAnalysis } from '~/specs/windwalker/lib/score';
import type { Analysis } from '~/lib/types';

const fixture = (name: string): Analysis =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8'));

const FIXTURES = ['strong', 'mixed', 'poor', 'waves', 'cleave', 'weave'] as const;

/**
 * What each committed pull actually did, measured off the logs and written down here so a capture
 * that drifts onto another player or another pull fails rather than quietly re-baselining.
 *
 * `drunkMs` is signed and fight-relative. Negative on the five pulls whose pre-pull potion was
 * already running at the pull, where it is the figure the report prints beside the timeline: how long
 * before the pull it went down, spread over 294ms to 1898ms — a second and a half, which is exactly
 * why the timing is reported and not graded. Positive on `poor`, where the press is in the stream and
 * the number is simply when it happened.
 */
const EXPECTED: Record<
	(typeof FIXTURES)[number],
	{
		used: number;
		prePull: { drunkMs: number; preexisting: boolean } | null;
		combat: number[];
		grade: 'good' | 'ok' | 'bad';
	}
> = {
	strong: { used: 2, prePull: { drunkMs: -1004, preexisting: true }, combat: [417489], grade: 'good' },
	mixed: { used: 2, prePull: { drunkMs: -1898, preexisting: true }, combat: [190966], grade: 'good' },
	// Both slots filled and neither of them the usual way round: nothing was running at the fight's own
	// zero, and the press at +92ms came 2.29s before this monk did any damage, so it is the pre-pull one
	// and the press at 2:34.9 is the combat one.
	poor: { used: 2, prePull: { drunkMs: 92, preexisting: false }, combat: [154887], grade: 'good' },
	// The only fixture that genuinely left one on the table: one potion in a seven-minute Galakras,
	// pressed at 6:12 — long past any reading of when this monk joined the fight.
	waves: { used: 1, prePull: null, combat: [372665], grade: 'ok' },
	cleave: { used: 2, prePull: { drunkMs: -294, preexisting: true }, combat: [60135], grade: 'good' },
	weave: { used: 2, prePull: { drunkMs: -983, preexisting: true }, combat: [90541], grade: 'good' },
};

describe('the potion count', () => {
	it.each(FIXTURES)('reads %s the way the log does', (name) => {
		const potions = fixture(name).potions;
		const expected = EXPECTED[name];
		expect(potions).toBeDefined();
		expect(potions?.used).toBe(expected.used);
		expect(potions?.slots).toBe(2);
		expect(potions?.combat).toEqual(expected.combat);
		expect(
			potions?.prePull == null ? null : { drunkMs: potions.prePull.drunkMs, preexisting: potions.prePull.preexisting },
		).toEqual(expected.prePull);
		// Every fixture runs 2:09 or longer, so all six are past both of the audit's own guards.
		expect(potions?.measurable).toBe(true);
	});

	it.each(FIXTURES)('grades %s against the ceiling rather than against the other pulls', (name) => {
		const card = scoreAnalysis(fixture(name));
		const metric = card.sections['potions']?.metrics[0];
		expect(metric?.key).toBe('potionsUsed');
		expect(metric?.unmeasurable).toBe(false);
		expect(metric?.grade).toBe(EXPECTED[name].grade);
	});

	/**
	 * The regression itself. Before `openAtPull` this lane carried one window — the in-fight potion at
	 * 60.1s — and the pre-pull one was dropped for having nothing to pair with.
	 */
	it('draws the pre-pull potion on the timeline, starting at the pull', () => {
		const lane = fixture('cleave').timeline?.lanes.find((l) => l.key === 'virmens-bite');
		expect(lane?.windows).toEqual([
			{ start: 0, end: 24706, preexisting: true, id: 105697 },
			{ start: 60134, end: 85140, id: 105697 },
		]);
	});

	/**
	 * And a pull whose pre-pull potion went down *inside* the fight draws no such bar.
	 *
	 * This is the half of the fix the chart has to get right. `poor` fills the pre-pull slot, but with a
	 * press the stream witnessed — so its first window opens at the `applybuff` rather than at the pull,
	 * carries no `preexisting`, and has the press icon above it that the caption about a bar with
	 * nothing to point at would deny.
	 */
	it('draws a slot-filling press as an ordinary window with its own press above it', () => {
		const poor = fixture('poor');
		const lane = poor.timeline?.lanes.find((l) => l.key === 'virmens-bite');
		expect(lane?.windows.some((w) => w.preexisting === true)).toBe(false);
		expect(lane?.windows[0]?.start).toBe(88);
		// The press the caption would otherwise claim does not exist.
		expect(poor.casts.find((c) => c.id === 105697)?.times).toEqual([92, 154887]);
	});

	/**
	 * Which consumables the rule reaches, on the fixture that can test it.
	 *
	 * `weave` swaps elixirs three times, and each swap logs the outgoing elixir's `removebuff` with no
	 * apply in front of it — the identical signature the potion rule fires on. Applying it to an
	 * hour-long consumable would date the first of them 59.8 minutes before the pull. Nothing in the
	 * analysis may carry a window for them at all: they are not in the model's aura list, so the only
	 * way one could appear is somebody widening the rule past the potion.
	 */
	it('says nothing about the flask or the elixirs', () => {
		const weave = fixture('weave');
		const laneKeys = (weave.timeline?.lanes ?? []).map((l) => l.key);
		for (const key of ['flask-of-spring-blossoms', 'elixir-of-the-rapids', 'mad-hozen-elixir', 'monks-elixir']) {
			expect(laneKeys).not.toContain(key);
		}
		// The count is about the potion and names it, so a reader is never told a flask was a potion.
		expect(weave.potions?.name).toBe("Virmen's Bite");
		expect(weave.potions?.id).toBe(105697);
	});

	/**
	 * "Cannot say" is not "drank neither", which is the one way this metric could invent a fault.
	 *
	 * Both guards, taken one at a time off a real pull. A fight shorter than the potion's own 25s hides
	 * a pre-pull one completely — it would still have been up at the last event — and one that ended
	 * inside the minute a pre-pull press locks the category for never offered the second slot.
	 */
	describe('a pull too short to ask', () => {
		const shorten = (name: string, durationMs: number): Analysis => {
			const base = fixture(name);
			return { ...base, durationMs };
		};

		it('cannot see a pre-pull potion on a pull shorter than the potion', () => {
			// `analyse` is what sets `measurable`, so this asserts through the audit the engine wrote
			// rather than re-deriving it: what is checked is that the scorecard refuses a fabricated one.
			const parked: Analysis = { ...fixture('waves'), potions: { ...fixture('waves').potions!, measurable: false } };
			const metric = scoreAnalysis(parked).sections['potions']?.metrics[0];
			expect(metric?.unmeasurable).toBe(true);
			// Parked at `ok`, so it neither flatters the pull nor punishes it — and never `bad`, which is
			// the reading that would call a wipe a missed potion.
			expect(metric?.grade).toBe('ok');
			expect(metric?.grade).not.toBe('bad');
		});

		it('still grades a pull that is long enough', () => {
			expect(scoreAnalysis(shorten('waves', 434_192)).sections['potions']?.metrics[0]?.unmeasurable).toBe(false);
		});

		it('says nothing at all when the analysis predates the audit', () => {
			// Every fixture captured before the field existed arrives with it `undefined`, and reading that
			// as none drunk would score six real pulls as having brought nothing.
			const old: Analysis = { ...fixture('cleave') };
			delete old.potions;
			const metric = scoreAnalysis(old).sections['potions']?.metrics[0];
			expect(metric?.unmeasurable).toBe(true);
		});
	});

	/**
	 * Which slot went unfilled, for the summary card that has to name it.
	 *
	 * The value cannot say on its own — one of two is one of two either way — so the metric carries a
	 * context and the copy has a variant per slot. `waves` skipped the pre-pull one.
	 */
	it('names the slot that went unused when exactly one did', () => {
		expect(scoreAnalysis(fixture('waves')).sections['potions']?.metrics[0]?.context).toBe('prepull');
		// Two of two needs no advice at all, so it carries no variant.
		expect(scoreAnalysis(fixture('cleave')).sections['potions']?.metrics[0]?.context).toBeUndefined();
	});

	/**
	 * The second route into the pre-pull slot: a press the log witnessed, taken before the player
	 * joined a fight that had already started without them.
	 *
	 * `poor` is that pull, and its own numbers are the argument. WarcraftLogs started the clock when
	 * somebody else engaged Malkorok; this monk drank at 92ms, cast Chi Wave at 1.357s and landed their
	 * first damage at 2.382s. Every one of them is after the potion, which is why the boundary can be
	 * read four different ways — first damaging cast, first damage, first damage including the pet's —
	 * and file the press identically.
	 */
	describe('a potion drunk before the player joined the fight', () => {
		it('fills the pre-pull slot rather than the combat one', () => {
			const potions = fixture('poor').potions;
			expect(potions?.prePull).toEqual({ drunkMs: 92, expiredMs: 25094, preexisting: false });
			expect(potions?.combat).toEqual([154887]);
			// The count is the one thing that must not move: two potions were drunk either way.
			expect(potions?.used).toBe(2);
		});

		it('is a press this pull really did take before doing anything', () => {
			const poor = fixture('poor');
			const at = (id: number): number | undefined => poor.casts.find((c) => c.id === id)?.times[0];
			// The potion, then the first damaging cast, then the first swing that landed — 2.29s later.
			expect(at(105697)).toBe(92);
			expect(at(115098)).toBe(1357);
			expect(at(1)).toBe(2382);
		});

		/**
		 * The fault this was written for. A player who drank only the early potion has missed the
		 * *in-combat* one, and the card used to tell them to drink the pre-pull one they had already had.
		 *
		 * Built by taking that press away from `poor` rather than off a seventh fixture, because the
		 * mapping under test is the scorecard's and the audit it reads is the one the engine wrote.
		 */
		it('points the advice at the slot that actually went unfilled', () => {
			const poor = fixture('poor');
			const onlyEarly: Analysis = { ...poor, potions: { ...poor.potions!, used: 1, combat: [] } };
			expect(scoreAnalysis(onlyEarly).sections['potions']?.metrics[0]?.context).toBe('combat');
			// And the reading it replaces, which is the same pull with the press filed as a combat one.
			const asCombat: Analysis = { ...poor, potions: { ...poor.potions!, used: 1, prePull: null, combat: [92] } };
			expect(scoreAnalysis(asCombat).sections['potions']?.metrics[0]?.context).toBe('prepull');
		});
	});
});
