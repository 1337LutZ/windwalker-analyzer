// A brew spent under a full ten, and the two reasons the priority list has for spending one.
//
// `brewStacks` grades the mean stacks a brew was spent at and nothing beside it bounded the worst
// brew, so the section could call a pull `good` over a brew that spent seven. Two of the committed
// fixtures show that directly — `poor` reads a mean of exactly 9.5 over a use list containing a
// seven, `mixed` a mean of 9.71 over one containing an eight — and both are asserted below against
// the real captures rather than against events built here.
//
// What no committed pull contains is the extreme the mean is *most* blind to: one brew spent at a
// single stack among eighteen full ones, which averages 9.53 and clears the 9.5 line. That one is
// built here, in the style `brewTrade.test.ts` uses and for the same stated reason — a fixture cannot
// test a case it does not contain.
//
// The stack gains below are set as absolute bank levels rather than climbing one chi rotation at a
// time. That is deliberate and does not weaken anything: what is being pinned is which brews the
// metric counts and which leave its sample, and neither depends on how the bank got to where it was.

import { describe, expect, it } from 'vitest';

import type { WclEvent } from '~/lib/events';
import type { Analysis, FightDataset } from '~/lib/types';
import { scoreAnalysis } from '~/specs/windwalker/lib/score';

import { analyse } from '../index';

import cleaveFixture from '~/specs/windwalker/__fixtures__/cleave.json';
import mixedFixture from '~/specs/windwalker/__fixtures__/mixed.json';
import poorFixture from '~/specs/windwalker/__fixtures__/poor.json';
import strongFixture from '~/specs/windwalker/__fixtures__/strong.json';
import wavesFixture from '~/specs/windwalker/__fixtures__/waves.json';
import weaveFixture from '~/specs/windwalker/__fixtures__/weave.json';

const T0 = 100000;
const DURATION = 400000;
const ME = 5;
const BOSS = 20;

/** The Rune of Re-Origination's Mastery conversion — one of the three ids the proc arrives under. */
const RE_ORIGINATION_MASTERY = 139120;
const BANK = 1247279;
const BREW = 1247275;

const e = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: T0 + t,
	type,
	abilityGameID: id,
	sourceID: ME,
	targetID: ME,
	...extra,
});

/** One hit on the boss, so the pull has a primary target to measure concentration against. */
const hit = e(500, 'damage', 1, { targetID: BOSS, amount: 10000, hitType: 1 });

/** A ten-second Re-Origination proc. */
const proc = (t: number): WclEvent[] => [
	e(t, 'applybuff', RE_ORIGINATION_MASTERY),
	e(t + 10000, 'removebuff', RE_ORIGINATION_MASTERY),
];

/** The bank set to an absolute level. */
const bankAt = (t: number, stacks: number): WclEvent => e(t, 'applybuffstack', BANK, { stack: stacks });

/**
 * One brew: the bank drain that pays for it, and the fifteen-second buff it opens.
 *
 * The drain is stamped a millisecond before the buff, which is what a real log does and what the
 * drain-to-window pairing is built around.
 */
const brew = (t: number, leaving: number): WclEvent[] => [
	e(t, 'removebuffstack', BANK, { stack: leaving }),
	e(t + 1, 'applybuff', BREW),
	e(t + 15000, 'removebuff', BREW),
];

/** The bank filled to `stacks` and immediately drained to nothing. */
const spend = (t: number, stacks: number): WclEvent[] => [bankAt(t - 1000, stacks), ...brew(t, 0)];

const dataset = (events: WclEvent[], durationMs = DURATION): FightDataset => ({
	code: 'abc123',
	fight: {
		id: 7,
		name: 'Garrosh Hellscream',
		encounterID: 1623,
		kill: true,
		difficulty: 4,
		size: 10,
		startTime: T0,
		endTime: T0 + durationMs,
	},
	actor: { id: ME, name: 'Bigdogmo', type: 'Player' },
	actors: [{ id: ME, name: 'Bigdogmo', type: 'Player' }],
	events: [
		hit,
		{
			timestamp: T0,
			type: 'combatantinfo',
			sourceID: ME,
			gear: [],
		} as unknown as WclEvent,
		...events,
	],
	table: {
		fight: {
			id: 7,
			name: 'Garrosh Hellscream',
			encounterID: 1623,
			kill: true,
			difficulty: 4,
			size: 10,
			startTime: T0,
			endTime: T0 + durationMs,
			enemyNPCs: [{ id: BOSS, gameID: 71865 }],
		},
		damageDone: {
			entries: [{ name: 'Bigdogmo', id: ME, type: 'Monk', total: 10000, activeTime: durationMs }],
		},
	},
});

const brewSection = (a: Analysis) => scoreAnalysis(a).sections['brew'];
const metricOn = (a: Analysis, key: string) => brewSection(a)?.metrics.find((m) => m.key === key);

describe('a brew spent under ten with nothing asking for it', () => {
	/**
	 * The case the mean is blind to, and the reason this metric exists.
	 *
	 * Eighteen brews at ten and one at a single stack: 181 stacks over 19 brews is a mean of 9.526,
	 * which clears `brewStacks`' 9.5 line and grades `good`. No proc runs anywhere in this pull and
	 * every brew has more than its own fifteen seconds of fight left after it, so the list would have
	 * required ten of all nineteen.
	 */
	it('counts a brew spent at one stack among eighteen full ones', () => {
		const events: WclEvent[] = [];
		for (let i = 0; i < 19; i++) events.push(...spend(5000 + i * 20000, i === 9 ? 1 : 10));
		const a = analyse(dataset(events));

		expect(a.brew.uses).toBe(19);
		expect(+a.brew.avgConsumed.toFixed(3)).toBe(9.526);
		// The mean still clears its own line. That reading does not move — only what sits beside it.
		expect(metricOn(a, 'brewStacks')?.grade).toBe('good');

		const short = metricOn(a, 'brewShortUses');
		expect(short?.value).toBe(1);
		expect(short?.sampleSize).toBe(19);
		expect(short?.grade).toBe('ok');
		// And the section no longer calls the pull good over it.
		expect(brewSection(a)?.grade).toBe('ok');
	});

	/** One is a lapse, two is the habit — which is where the `bad` line sits. */
	it('grades two of them bad', () => {
		const events: WclEvent[] = [];
		for (let i = 0; i < 19; i++) events.push(...spend(5000 + i * 20000, i === 9 || i === 14 ? 1 : 10));
		const a = analyse(dataset(events));

		expect(metricOn(a, 'brewShortUses')?.value).toBe(2);
		expect(metricOn(a, 'brewShortUses')?.grade).toBe('bad');
		expect(brewSection(a)?.grade).toBe('bad');
	});
});

describe('the two presses the priority list makes under ten', () => {
	/**
	 * A proc in its final global, which the list presses at whatever the bank holds.
	 *
	 * `RoRo: TEB - Actions` gates the snapshot press on the proc's remaining time against one global
	 * and on nothing else — no stack floor — so a brew at seven stacks there is the play rather than a
	 * miss. Three full brews beside it keep the sample at the floor `MIN_GRADED_SAMPLE` asks for.
	 */
	it('leaves a seven-stack brew taken in a proc last global out of the count', () => {
		const a = analyse(
			dataset([
				...proc(60000),
				bankAt(59000, 7),
				...brew(69800, 0),
				...spend(120000, 10),
				...spend(160000, 10),
				...spend(200000, 10),
			]),
		);

		expect(a.procs.windows[0]?.grade).toBe('last-gcd');
		expect(a.procs.windows[0]?.snapshotStacks).toBe(7);
		const short = metricOn(a, 'brewShortUses');
		expect(short?.value).toBe(0);
		// Out of the sample as well as out of the count: the list never asked ten of it.
		expect(short?.sampleSize).toBe(3);
		expect(short?.grade).toBe('good');
	});

	/**
	 * The same brew moved earlier in the same proc is counted, because the list would not have pressed
	 * it there — it wants the proc's last global, and this report already measures how late each brew
	 * landed as its own number.
	 */
	it('counts the same brew taken early in the proc', () => {
		const a = analyse(
			dataset([
				...proc(60000),
				bankAt(59000, 7),
				...brew(62000, 0),
				...spend(120000, 10),
				...spend(160000, 10),
				...spend(200000, 10),
			]),
		);

		expect(a.procs.windows[0]?.grade).toBe('early');
		expect(metricOn(a, 'brewShortUses')?.value).toBe(1);
		expect(metricOn(a, 'brewShortUses')?.sampleSize).toBe(4);
	});

	/**
	 * The end-of-fight dump, which the list makes with no stack floor either: stacks that outlive the
	 * boss were never worth anything. The window is the brew's own fifteen seconds, which is the
	 * list's `Time: TEB seconds`.
	 */
	it('leaves a five-stack brew inside the last fifteen seconds out of the count', () => {
		const a = analyse(
			dataset(
				[...spend(20000, 10), ...spend(50000, 10), ...spend(80000, 10), bankAt(107000, 5), ...brew(108000, 0)],
				120000,
			),
		);

		expect(a.brew.uses).toBe(4);
		const short = metricOn(a, 'brewShortUses');
		expect(short?.value).toBe(0);
		expect(short?.sampleSize).toBe(3);
		expect(short?.grade).toBe('good');
	});

	/** A second earlier and the fight has more left than the brew lasts, so the list wanted ten. */
	it('counts the same brew a second before that window opens', () => {
		const a = analyse(
			dataset(
				[...spend(20000, 10), ...spend(50000, 10), ...spend(80000, 10), bankAt(103000, 5), ...brew(104000, 0)],
				120000,
			),
		);

		expect(metricOn(a, 'brewShortUses')?.value).toBe(1);
		expect(metricOn(a, 'brewShortUses')?.sampleSize).toBe(4);
	});

	/**
	 * Nothing left in the sample is not a clean sheet.
	 *
	 * Two brews, both taken in a proc's final global. The count is zero because there was nothing it
	 * could have faulted, and a zero read on its own is the free pass `Metric.gradedMs` exists to
	 * refuse — so it says "cannot say" instead.
	 */
	it('refuses to grade a pull whose every brew the list excused', () => {
		const a = analyse(
			dataset([
				...proc(60000),
				bankAt(59000, 7),
				...brew(69800, 0),
				...proc(120000),
				bankAt(119000, 6),
				...brew(129800, 0),
			]),
		);

		const short = metricOn(a, 'brewShortUses');
		expect(short?.sampleSize).toBe(0);
		expect(short?.unmeasurable).toBe(true);
		expect(short?.grade).toBe('ok');
	});
});

/**
 * The six committed captures, which are what says this separates on real pulls rather than only on
 * events written to make it.
 *
 * Every figure here is read off a pre-analysed capture — none of these fixtures is re-analysed, so
 * the numbers are the ones those pulls were captured with and the metric is computed in `score.ts`
 * from `brew.useList`, `procs.windows` and `durationMs`, all of which the captures already carry.
 */
describe('the committed pulls', () => {
	const cases: Array<[string, Analysis, number | null, string, string]> = [
		// `strong` is the longest pull in the set and has the most brews; three of the nine the list
		// would have required ten of went out short, one of them at five stacks with no proc running at
		// all. Its section moves from `ok` to `bad`; its overall verdict does not move.
		['strong', strongFixture as unknown as Analysis, 3, 'bad', 'bad'],
		// The pull the copy called "near the cap every time": mean 9.71, `good`, over an eight.
		['mixed', mixedFixture as unknown as Analysis, 1, 'ok', 'ok'],
		// The committed proof of the defect: mean exactly 9.5, `good`, over a seven.
		['poor', poorFixture as unknown as Analysis, 1, 'ok', 'bad'],
		// The inversion, and the reason the excuses are not decoration: `cleave` has the *worst* mean in
		// the set at 8.5 and all three of its short brews are presses the list makes — two proc last
		// globals and one tail dump. Its worst brew reading is clean.
		['cleave', cleaveFixture as unknown as Analysis, 0, 'good', 'ok'],
		// Two of five brews were last-global presses and one was a tail dump, so two remain and the
		// metric declines rather than crediting a clean sheet off them.
		// `good` at 9 lifts weave's brew section: its mean is 9.2, which read `ok` against the old 9.5.
		['weave', weaveFixture as unknown as Analysis, null, 'ok', 'good'],
		['waves', wavesFixture as unknown as Analysis, 2, 'bad', 'bad'],
	];

	for (const [name, analysis, value, grade, sectionGrade] of cases) {
		it(`reads ${name} as ${value === null ? 'cannot say' : value} short brews`, () => {
			const m = metricOn(analysis, 'brewShortUses');
			expect(m?.unmeasurable).toBe(value === null);
			if (value !== null) expect(m?.value).toBe(value);
			expect(m?.grade).toBe(grade);
			expect(brewSection(analysis)?.grade).toBe(sectionGrade);
		});
	}

	/**
	 * Every sample size, published, because the count means nothing without the denominator it was
	 * drawn from — and because these six are what the `MIN_GRADED_SAMPLE` refusal above rests on.
	 */
	it('publishes the brews the list required ten of', () => {
		const samples = cases.map(([name, analysis]) => [name, metricOn(analysis, 'brewShortUses')?.sampleSize]);
		expect(samples).toEqual([
			['strong', 9],
			['mixed', 5],
			['poor', 5],
			['cleave', 3],
			['weave', 2],
			['waves', 7],
		]);
	});

	/**
	 * No committed pull's headline verdict moves. A deliberate no-change guard: it passes against the
	 * old behaviour too, which is the point — it is the assertion that adding a graded metric to the
	 * section did not quietly re-letter six real pulls.
	 *
	 * **`cleave` reads `good` here and read `ok` before 2026-08-24, and neither this metric nor this
	 * file moved it.** The re-capture added `targets.aplCounts`, which took that pull's Tiger Palm sample
	 * from two in-band presses to four and so past `MIN_GRADED_SAMPLE`; the three points it had been
	 * forfeiting came back and carried the headline. The guard's own claim is untouched — `brewShortUses`
	 * still re-letters nobody — but the baseline it is written against moved under it, so this entry is a
	 * new reading of an unchanged rule rather than a rule that changed.
	 *
	 * **And note which reading this is.** `scoreAnalysis` is called bare, so the bands fall back to the
	 * scorer's own default rather than being resolved through `resolveBands`, which is what the reader
	 * actually gets. The two disagree on exactly this pull: under `auto` — the reader's default —
	 * `cleave` was `good` before the re-capture and is `good` after, so nothing a reader sees moved at
	 * all. What moved is this call's unbanded baseline. Kept bare because the claim being guarded is
	 * about the metric and not about the ladder; `windwalker/__fixtures__/bands.test.ts` is where the
	 * reader's reading is pinned.
	 */
	it('moves no overall verdict', () => {
		// no-change guard
		expect(cases.map(([name, analysis]) => [name, scoreAnalysis(analysis).overall])).toEqual([
			['strong', 'good'],
			['mixed', 'ok'],
			['poor', 'bad'],
			['cleave', 'good'],
			['weave', 'good'],
			['waves', 'ok'],
		]);
	});
});
