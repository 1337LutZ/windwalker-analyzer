// Clearcasting inside the Flame Shock snapshot delta — plan §87, and the fault is in a number the
// report already showed rather than in one it was about to.
//
// `FS_SNAPSHOT_GAIN` credits an early refresh when the new application is more than 10% stronger per
// millisecond of dot. Elemental Focus (16246) is a flat **+20%** on the school, the dot freezes it at
// application, and it is up for 52-72% of these pulls — so one stack on one side of the comparison and
// not the other clears that bar on its own, with no trinket and no spellpower involved. Two of the three
// presses this repository credits were made under it. The verdicts were right; the *reason the section's
// copy implied* was not.
//
// What this file establishes, in the order the decision was made:
//
//   1. **The proc state is read off the log correctly**, per press, against an independent walk of the
//      raw stream — including the five presses that land on the closing millisecond of a window, where a
//      half-open reading calls a dot proc-free that carries +20% for thirty seconds.
//   2. **Dividing the proc back out changes no verdict on any committed press.** That is the measurement
//      that decided against controlling for it and against moving the threshold: the three credited
//      presses clear ten per cent by 18.7, 30.1 and 59.2 points with the +20% removed, and one of them
//      is *stronger* without it, having given the proc up to be made.
//   3. **Nothing graded moves**, which is asserted as a deliberate no-change guard rather than assumed.
//
// The `dotPercentIncrease` citation that makes measuring the total the right choice is in
// `FS_SNAPSHOT_GAIN`'s own doc: the sim's numerator is `CalcPeriodicDamage` against the spell's *current*
// multiplier, so the list this report grades against refreshes early under Clearcasting because of
// Clearcasting. Netting it out of the grade would put the report at odds with the rotation it cites.

import { describe, expect, it } from 'vitest';

import { rawFixtures } from '~/lib/analysis/fixtures';
import type { Analysis, ElementalAuditResult, FightDataset, FlameShockPress } from '~/lib/types';

import { analyse } from '../index';

/**
 * Every raw Elemental pull, found rather than listed.
 *
 * The literal was `['unbroken', 'phased', 'cleave']` and every claim in this file is "every press on
 * every pull" — the independent walk, the closing-millisecond set, the bit-for-bit equality, the graded
 * seven. `addsThenBoss.json` carries 31 more Flame Shock presses and 612 more Clearcasting events than
 * anything else in the directory, and none of them were ever put to any of it. The counts below moved
 * accordingly; they are the coverage, so they are restated rather than loosened.
 */
type Fixture = string;
const FIXTURES: Fixture[] = rawFixtures('elemental').map(({ name }) => name.replace(/\.json$/, ''));

/** The sim's own +20%, restated here so a change to the constant has to change this file too. */
const CLEARCASTING_MULT = 1.2;
/** The sim's `dotPercentIncrease(8050) > 10%`, likewise restated rather than imported. */
const BAR = 0.1;

/**
 * The datasets and their analyses, memoised — `addsThenBoss.json` is 4.4 MB and both the raw walk and the
 * audit are wanted several times over per pull.
 */
const datasets = new Map<string, FightDataset>();
const load = (name: Fixture): FightDataset => {
	const hit = datasets.get(name);
	if (hit !== undefined) return hit;
	const found = rawFixtures('elemental').find((fixture) => fixture.name === `${name}.json`);
	if (found === undefined) throw new Error(`no raw Elemental fixture ${name}`);
	datasets.set(name, found.dataset);
	return found.dataset;
};

const analyses = new Map<string, Analysis & ElementalAuditResult>();
const el = (name: Fixture): Analysis & ElementalAuditResult => {
	const hit = analyses.get(name);
	if (hit !== undefined) return hit;
	const analysis = analyse(load(name)) as Analysis & ElementalAuditResult;
	analyses.set(name, analysis);
	return analysis;
};

/** The raw shape, because every claim about the proc has to be made against the event stream itself. */
type Raw = {
	fight: { startTime: number; endTime: number };
	actor: { id: number };
	events: { timestamp: number; type: string; sourceID?: number; targetID?: number; abilityGameID?: number }[];
};

const raw = (name: Fixture) => load(name) as unknown as Raw;

/**
 * Clearcasting's up-stretches, walked here rather than taken from the analysis.
 *
 * The same walk `clearcasting.test.ts` uses, and deliberately a second copy of it: a test whose expected
 * side comes out of the code under test proves only that the code agrees with itself.
 */
const ccWindows = (name: Fixture): [number, number][] => {
	const r = raw(name);
	const out: [number, number][] = [];
	let on: number | null = null;
	for (const e of r.events.filter((e) => e.abilityGameID === 16_246 && e.targetID === r.actor.id)) {
		if (e.type === 'applybuff') on = e.timestamp - r.fight.startTime;
		else if (e.type === 'removebuff' && on !== null) {
			out.push([on, e.timestamp - r.fight.startTime]);
			on = null;
		}
	}
	if (on !== null) out.push([on, r.fight.endTime - r.fight.startTime]);
	return out;
};

const pressAt = (name: Fixture, t: number): FlameShockPress => {
	const press = el(name).flameShock.presses.find((p) => p.t === t);
	if (press === undefined) throw new Error(`no Flame Shock press at ${t} on ${name}`);
	return press;
};

/** Every press the snapshot rule can grade: an early refresh, credited or faulted. */
const graded = (): FlameShockPress[] =>
	FIXTURES.flatMap((name) => el(name).flameShock.presses.filter((p) => p.kind === 'early' || p.kind === 'snapshot'));

/**
 * The waste share, **off the audit rather than off the scorecard**.
 *
 * This used to read `metric.value`, and that was a join this file had no business having. What it asserts
 * is the audit's *attribution* — which press the walk called windowed, which it called a snapshot gain —
 * and routing that through the grading surface made it depend on whether the scorecard chose to grade the
 * metric at all. It does not, on `cleave`: one judged refresh is under `MIN_GRADED_SAMPLE`, so `metricOf`
 * refuses and zeroes the value, and this file would have read `0` for an attribution that had not changed.
 *
 * **Pull-wide, and no longer what `score.ts` hands `shareOf`.** That expression is now this one less the
 * audit's two `unjudged` terms — the band-1 subset — because a press made at four enemies is graded against
 * no rule this metric holds. This helper deliberately keeps every refresh in, because what it asserts is the
 * *attribution*: which press the walk called windowed, which it called a snapshot gain. An attribution
 * test must not go quiet because a band left the sample. It was checked against the presses rather than
 * assumed — `refreshes` equals the count of presses with a live dot under them, and the subtraction equals
 * a direct count of the refreshes carrying none of the three excuses, on all three fixtures — so this stays
 * the number the section's tile shows, which is also pull-wide, and the two agree with the graded share on
 * every pull that never leaves one enemy.
 */
const wasteOf = (name: Fixture): number => {
	const fs = el(name).flameShock;
	return ((fs.refreshes - fs.windowed - fs.ascPrep - fs.snapshotGain) / fs.refreshes) * 100;
};

describe('the proc state each Flame Shock press froze', () => {
	/**
	 * Every press on every pull, against a walk of the raw 16246 stream. If this ever disagrees, one of the
	 * two walks has changed and the attribution printed beside a credited refresh is describing the wrong
	 * dot.
	 *
	 * **25 of these 56 presses were being checked.** The other 31 are `addsThenBoss`', on the pull that
	 * carries more Clearcasting events than the other three put together — the single densest piece of
	 * evidence the directory holds for this file's subject, and the grid was three names long. It agrees.
	 */
	it('agrees with an independent walk of the raw stream on every press', () => {
		let total = 0;
		let under = 0;
		for (const name of FIXTURES) {
			const windows = ccWindows(name);
			const upAt = (t: number) => windows.some(([start, end]) => t >= start && t <= end);
			for (const press of el(name).flameShock.presses) {
				expect(press.snapshotClearcasting, `${name} @ ${press.t}`).toBe(upAt(press.t));
				total++;
				if (press.snapshotClearcasting) under++;
			}
		}
		expect(total).toBe(56);
		expect(under).toBe(31);
		// Per pull as well as in total, so the fourth pull cannot carry the sample on its own and a pull that
		// stopped contributing any press under the proc would say so here.
		expect(Object.fromEntries(FIXTURES.map((name) => [name, el(name).flameShock.presses.length]))).toEqual({
			addsThenBoss: 31,
			cleave: 10,
			phased: 8,
			unbroken: 7,
		});
	});

	/**
	 * **The five presses that decide whether the containment test may be half-open, and it may not.**
	 *
	 * Flame Shock is on the sim's `canConsumeSpells` mask and `applyEffects` runs *before*
	 * `OnCastComplete` (`sim/core/cast.go:329-332`), so a press that spends the last stack is applied
	 * with the multiplier still attached — and the log stamps that `removebuff` in the very millisecond
	 * of the cast. **Ten** presses across the committed pulls are exactly that — five of them
	 * `addsThenBoss`', which the three-name grid never looked at — and `unbroken`'s at 83 852 is one of the
	 * five the report credits: read half-open, its row would drop the proc from its wording and quote
	 * +56.2% as though the player's timing had bought all of it.
	 *
	 * The set is computed from the raw stream and then stated, so a fixture that stopped containing this
	 * case would fail here rather than quietly stop testing anything.
	 */
	it('counts the proc up on every press that lands on a window’s closing millisecond', () => {
		const onTheEdge = FIXTURES.flatMap((name) => {
			const ends = new Set(ccWindows(name).map(([, end]) => end));
			return el(name)
				.flameShock.presses.filter((p) => ends.has(p.t))
				.map((p) => [name, p.t] as const);
		});
		expect(onTheEdge).toEqual([
			['addsThenBoss', 147_244],
			['addsThenBoss', 179_024],
			['addsThenBoss', 223_193],
			['addsThenBoss', 299_996],
			['addsThenBoss', 328_555],
			['cleave', 29_777],
			['cleave', 120_415],
			['cleave', 259_722],
			['phased', 121_512],
			['unbroken', 83_852],
		]);
		for (const [name, t] of onTheEdge) expect(pressAt(name, t).snapshotClearcasting, `${name} @ ${t}`).toBe(true);
		// And the one of them the snapshot rule actually credits, named on its own.
		expect(pressAt('unbroken', 83_852).kind).toBe('snapshot');
	});
});

describe('what is left of the gain once the proc is divided back out', () => {
	/**
	 * The credited presses, both readings side by side — and this is the measurement that decided §87
	 * against controlling for the proc and against raising the threshold.
	 *
	 * Every one of them still clears ten per cent with the +20% removed. So the copy was wrong about
	 * *why* and the number was right about *whether*, which is a copy fix and not a re-grade.
	 *
	 * **There are five, not three.** `addsThenBoss` credits two more, at 200 291 and 532 772, and neither
	 * had ever been put to the "still over the bar with the proc divided out" question — the question this
	 * whole test exists to answer. They clear it. `unbroken`'s three keep their pinned pairs because they
	 * are the measurement §87 was decided on; the loop at the bottom is what covers all five.
	 */
	it('leaves every credited refresh over the bar without the proc', () => {
		const credited = graded().filter((p) => p.kind === 'snapshot');
		expect(credited.map((p) => p.t)).toEqual([200_291, 532_772, 28_628, 83_852, 140_025]);

		expect(pressAt('unbroken', 28_628).snapshotDeltaPct).toBeCloseTo(0.4244, 3);
		expect(pressAt('unbroken', 28_628).snapshotDeltaWithoutClearcastingPct).toBeCloseTo(0.187, 3);
		expect(pressAt('unbroken', 83_852).snapshotDeltaPct).toBeCloseTo(0.5615, 3);
		expect(pressAt('unbroken', 83_852).snapshotDeltaWithoutClearcastingPct).toBeCloseTo(0.3013, 3);
		expect(pressAt('unbroken', 140_025).snapshotDeltaPct).toBeCloseTo(0.3267, 3);
		expect(pressAt('unbroken', 140_025).snapshotDeltaWithoutClearcastingPct).toBeCloseTo(0.5921, 3);

		for (const press of credited)
			expect(press.snapshotDeltaWithoutClearcastingPct ?? 0, `credited @ ${press.t}`).toBeGreaterThan(BAR);
	});

	/**
	 * **The press that is stronger with the proc taken out, because it gave the proc up to be made.**
	 *
	 * `unbroken`'s refresh at 140 025 replaced an application made under Clearcasting with one made
	 * without it, and is still +32.7% per millisecond of dot — so on everything except the proc it is
	 * +59.2%. It is the single clearest evidence in the repository that this figure is not an artefact of
	 * the proc, and it is the reason the row's wording has a second form rather than one.
	 */
	it('has one credited refresh that gained while losing the proc', () => {
		const press = pressAt('unbroken', 140_025);
		const previous = pressAt('unbroken', 112_878);
		expect(previous.snapshotClearcasting).toBe(true);
		expect(press.snapshotClearcasting).toBe(false);
		expect(press.snapshotDeltaWithoutClearcastingPct ?? 0).toBeGreaterThan(press.snapshotDeltaPct ?? 0);
		// The +20% recovered exactly, which is what makes the second figure the proc's own size and not an
		// estimate of it: the two sides here are a measured ratio and a sim constant.
		expect((1 + (press.snapshotDeltaPct ?? 0)) * CLEARCASTING_MULT - 1).toBeCloseTo(
			press.snapshotDeltaWithoutClearcastingPct ?? 0,
			9,
		);
	});

	/**
	 * The invariant the section's wording is chosen on: where the proc is not a term at all — both
	 * applications froze it, or neither did — the two figures are the **same value**, not two values a
	 * hair apart. A component deciding "is the proc worth naming here" by comparing them would otherwise
	 * name it on every row.
	 *
	 * 47 of the 56 presses are in that state, so the check is not vacuous.
	 */
	it('holds the two figures bit-for-bit equal where the proc is not a term', () => {
		let same = 0;
		for (const name of FIXTURES)
			for (const press of el(name).flameShock.presses) {
				if (press.snapshotDeltaWithoutClearcastingPct !== press.snapshotDeltaPct) continue;
				same++;
				expect(Object.is(press.snapshotDeltaWithoutClearcastingPct, press.snapshotDeltaPct)).toBe(true);
			}
		expect(same).toBe(47);
		// And the field is null in exactly the cases the delta is, never in others.
		for (const name of FIXTURES)
			for (const press of el(name).flameShock.presses)
				expect(press.snapshotDeltaWithoutClearcastingPct === null, `${name} @ ${press.t}`).toBe(
					press.snapshotDeltaPct === null,
				);
	});

	/**
	 * **The whole of the case for leaving the threshold where it is**, stated as the one assertion that
	 * could overturn it.
	 *
	 * Controlling for the proc — comparing like for like on its state instead of measuring the total —
	 * would change **not one** graded press. The two readings differ on several of them and still fall on
	 * the same side of ten per cent every time. A control that changes no outcome while looking like one
	 * is plan §90's finding verbatim, so it is not added; the proc is named in the copy instead.
	 *
	 * **Seven of these nineteen were being checked, and the premise the other twelve broke is stated here
	 * rather than patched over.** The loop asserted `snapshotDeltaPct` was non-null on *every* graded
	 * press. That was a property of the three pulls it ran on, not of the field: `FlameShockPress`'
	 * contract says null means "the log could not say" — fewer than three ticks on the application the
	 * press created, or no previous application to compare against — and `addsThenBoss` has one, an early
	 * refresh at 159 410 whose new dot never got three ticks. Written as it was, the assertion would have
	 * called a correctly-published `null` a failure. So the presses are partitioned by whether the log
	 * could read them: the ones it could must not change side, and the one it could not is named, counted,
	 * and required to be null in *both* readings — which is the contract
	 * `snapshotDeltaWithoutClearcastingPct` states ("null exactly when `snapshotDeltaPct` is null"), now
	 * exercised by a press that actually is.
	 */
	it('would put every readable graded press on the same side of the bar either way', () => {
		const seven = graded();
		expect(seven).toHaveLength(19);

		// The presses the log could not read: null in both readings, so they have no side to change.
		const unread = seven.filter((p) => p.snapshotDeltaPct === null);
		expect(unread.map((p) => p.t)).toEqual([159_410]);
		for (const press of unread) expect(press.snapshotDeltaWithoutClearcastingPct, `@ ${press.t}`).toBeNull();

		const readable = seven.filter((p) => p.snapshotDeltaPct !== null);
		expect(readable).toHaveLength(18); // non-vacuous, and the bulk of the sample
		let differing = 0;
		for (const press of readable) {
			const total = press.snapshotDeltaPct;
			const own = press.snapshotDeltaWithoutClearcastingPct;
			expect(own, `@ ${press.t}`).not.toBeNull();
			expect((own ?? 0) > BAR, `@ ${press.t}`).toBe((total ?? 0) > BAR);
			if (own !== total) differing++;
		}
		expect(differing).toBe(8);
		// The largest single disagreement between the two readings, measured rather than described.
		const gaps = readable.map((p) =>
			Math.abs((p.snapshotDeltaWithoutClearcastingPct ?? 0) - (p.snapshotDeltaPct ?? 0)),
		);
		expect(Math.max(...gaps)).toBeCloseTo(0.4387, 3);
	});
});

describe('nothing graded moves, and that is the point', () => {
	/**
	 * **A deliberate no-change guard.** The press kinds per pull, and `flameShockWaste` after them.
	 *
	 * §87 is an attribution fix: the total stays the graded figure, so if any of these move, the change
	 * did more than it claimed to. The counts are the ones measured at `6a83708` before the change.
	 */
	it('leaves every press kind and every waste figure where it was — no-change guard', () => {
		const kinds = (name: Fixture) => {
			const out: Record<string, number> = {};
			for (const press of el(name).flameShock.presses) out[press.kind] = (out[press.kind] ?? 0) + 1;
			return out;
		};
		expect(kinds('unbroken')).toEqual({ apply: 1, snapshot: 3, early: 2, windowed: 1 });
		expect(kinds('phased')).toEqual({ apply: 1, windowed: 3, early: 1, reapply: 3 });
		expect(kinds('cleave')).toEqual({ apply: 2, windowed: 1, early: 1, late: 4, reapply: 2 });

		expect(wasteOf('unbroken')).toBeCloseTo(33.33, 2);
		expect(wasteOf('phased')).toBeCloseTo(25, 2);
		expect(wasteOf('cleave')).toBeCloseTo(50, 2);
	});

	/**
	 * And the proc still grades nothing, which is the promise `clearcasting.test.ts` made when it was
	 * declared. What this change adds is an attribution of a figure the report already showed; no press
	 * is better or worse for having been made under the proc.
	 */
	it('publishes no Clearcasting figure of its own', () => {
		for (const name of FIXTURES) {
			expect(Object.keys(el(name)), name).not.toContain('clearcasting');
			const audit = el(name).flameShock as unknown as Record<string, unknown>;
			expect(
				Object.keys(audit).filter((k) => k.toLowerCase().includes('clearcasting')),
				name,
			).toEqual([]);
		}
	});
});
