// The elixir weave, and the one fault no committed capture contains.
//
// Three of the four raw pulls weave and none of them ever swaps *before* its brew, so the rule that
// charges for it would ship asserted by nothing. The case is built by moving one real press earlier in
// a real log rather than by inventing a dataset: everything else about the pull — the brew, the Rune
// proc, the bank — stays exactly as it was captured, so what the assertions below see move is the one
// millisecond that was changed.

import { describe, expect, it } from 'vitest';

import { rawFixture } from '~/lib/analysis/fixtures';
import { getSpec } from '~/lib/spec';
import { defaultSettings } from '~/lib/settings';
import type { FightDataset } from '~/lib/types';

import { WW_SETTINGS } from '../index';

const spec = getSpec('windwalker')!;

/** Elixir of the Rapids, the haste one, which is what all four captures weave with. */
const RAPIDS = 105684;

const weaveOf = (dataset: FightDataset) => {
	const weave = spec.analyse(dataset).weave;
	if (weave === undefined) throw new Error('the audit produced no weave summary');
	return weave;
};

describe('the weave as captured', () => {
	it('reads a pull that weaves every brew it can', () => {
		// `uncounted` is the textbook one: five weaves out of six chances, every close inside the last
		// second of its brew. If this moves, the audit moved and not the log.
		const weave = weaveOf(rawFixture('windwalker', 'uncounted.json'));
		expect(weave.runeEquipped).toBe(true);
		expect({ offered: weave.offered, taken: weave.taken, early: weave.early, lateReturn: weave.lateReturn }).toEqual({
			offered: 6,
			taken: 5,
			early: 0,
			lateReturn: 0,
		});
	});

	it('reads a pull that never presses an elixir at all', () => {
		// The prompt case. Five brews went out and no elixir followed any of them, which is a monk who
		// has not picked the technique up rather than one doing it badly — nothing is charged.
		const weave = weaveOf(rawFixture('windwalker', 'dataset-ironJuggernaut.json'));
		expect(weave.taken).toBe(0);
		expect(weave.early).toBe(0);
		expect(weave.lateReturn).toBe(0);
		expect(weave.offered).toBeGreaterThan(0);
	});

	/**
	 * A refreshed brew is two brews, and `auraWindows` hands it over as one.
	 *
	 * `dataset-ironJuggernaut` presses seven times and the aura map holds six windows, because one press
	 * landed on a running brew and merged into it — a single 26.5s window where the game had two brews of
	 * 11.5s and 15s. A reader found it on their own log first, at 27 seconds.
	 *
	 * The sim is what makes it two rather than a judgement call: `ApplyEffects` is `buffAura.Deactivate`
	 * then `buffAura.Activate` (`sim/monk/windwalker/tigereye_brew.go:94-96`), so the second press re-runs
	 * `OnGain`, re-reads mastery and eats a fresh batch of stacks. Merging them offers one chance where
	 * there were two, and puts the leeway at the end of the pair instead of at the end of each.
	 */
	it('splits a refreshed brew into the two brews it actually was', () => {
		const analysis = spec.analyse(rawFixture('windwalker', 'dataset-ironJuggernaut.json'));
		const weave = analysis.weave;
		if (weave === undefined) throw new Error('the audit produced no weave summary');
		// One row per press, which is the whole of the fix.
		expect(weave.brews.length).toBe(analysis.brew.uses);
		expect(analysis.brew.refreshUses).toBe(1);
		// And no row outlives a brew. 15s plus the log's own stamp slop is the ceiling; the merged window
		// was 26 500ms, which is what this refuses to draw again.
		const longest = Math.max(...weave.brews.map((brew) => brew.end - brew.start));
		expect(longest).toBeLessThan(15_600);
		// The pair itself: the first press is cut off by the second rather than running its full fifteen.
		const pair = weave.brews.filter((brew) => brew.start >= 130_000 && brew.end <= 158_000);
		expect(pair.map((brew) => brew.end - brew.start)).toEqual([11_495, 15_005]);
		expect(pair[0]!.end).toBe(pair[1]!.start);
	});

	it('excludes a brew the fight ended underneath', () => {
		// `uncounted` closes on a brew with under four seconds left in the pull. There was no window to
		// swap and come back inside it, so it is drawn and not counted.
		const weave = weaveOf(rawFixture('windwalker', 'uncounted.json'));
		const truncated = weave.brews.filter((brew) => brew.truncated === true);
		expect(truncated.length).toBe(1);
		expect(weave.offered).toBe(weave.brews.length - truncated.length);
	});

	it('separates a pull that closes on time from one that closes early', () => {
		// The two ends of the same technique, and the reason the close is its own count: both weave, and
		// only one of them holds the elixir for the whole brew.
		const clean = weaveOf(rawFixture('windwalker', 'uncounted.json'));
		const loose = weaveOf(rawFixture('windwalker', 'sections.json'));
		expect(clean.lateReturn).toBe(0);
		expect(loose.taken).toBeGreaterThan(0);
		expect(loose.lateReturn).toBe(loose.taken);
	});
});

describe('a swap that beats its own brew', () => {
	/**
	 * The same pull with one press moved earlier, which is the whole of the change.
	 *
	 * Tigereye Brew reads mastery in `OnGain` and never again, so an elixir that lands first has already
	 * taken 750 mastery off the sheet by the time the brew freezes it. That is a dilution rather than a
	 * weave, and it has to leave `taken` as well as landing in `early` — counting it as both would say
	 * the monk did the thing and did it wrong, when what they did was the opposite thing.
	 */
	const earlyByMs = (ms: number): FightDataset => {
		const dataset = structuredClone(rawFixture('windwalker', 'uncounted.json'));
		const mine = dataset.actor?.id;
		// The *cast*, specifically. Each elixir logs `applybuff` a millisecond ahead of its `cast`, and
		// `battleElixirs` is built from cast times — moving the buff would leave the press where it was
		// and the test would assert nothing.
		const first = dataset.events.find(
			(event) => event.sourceID === mine && event.abilityGameID === RAPIDS && event.type === 'cast',
		);
		if (first === undefined) throw new Error('no Elixir of the Rapids press in the fixture');
		first.timestamp -= ms;
		return dataset;
	};

	it('is charged as a dilution and not credited as a weave', () => {
		const before = weaveOf(rawFixture('windwalker', 'uncounted.json'));
		const after = weaveOf(earlyByMs(500));
		expect(after.early).toBe(1);
		// One weave fewer, and the chance itself does not vanish: the brew was still a brew the monk held
		// a mastery elixir into, so the denominator is untouched and the miss is visible.
		expect(after.taken).toBe(before.taken - 1);
		expect(after.offered).toBe(before.offered);
	});

	it('leaves the ordering slack alone, because a composite press is logged a millisecond apart', () => {
		// The captures land the swap 0-1ms after the brew across every weave in the set, which is the log
		// stamping one action rather than the player reacting. Inside that spread nothing is charged.
		expect(weaveOf(earlyByMs(1)).early).toBe(0);
		expect(weaveOf(earlyByMs(0)).early).toBe(0);
	});
});

describe('the reader’s own leeway', () => {
	it('decides how many closes count as played out in full', () => {
		// `idle` is the pull that straddles the line: two of its four weaves close 654ms and 832ms before
		// the brew, one closes ten seconds early and one never closes at all. So the two in the middle
		// change hands as the reader moves the number and the other two never do, which is what makes
		// this a test of the setting rather than of the fixture.
		const dataset = rawFixture('windwalker', 'idle.json');
		const at = (ms: number) =>
			spec.analyse(dataset, { ...defaultSettings(WW_SETTINGS), weaveReturnLeewayMs: ms }).weave!;
		const strict = at(250);
		const wide = at(1000);
		expect(strict.taken).toBe(wide.taken);
		expect(strict.lateReturn).toBe(4);
		expect(wide.lateReturn).toBe(2);
	});

	it('is clamped to the range the panel offers', () => {
		// Asked for more than `WW_SETTINGS` allows, the audit reports the number it actually used. A
		// summary that echoed the request would have the chart draw one window and the count mean another.
		const asked = spec.analyse(rawFixture('windwalker', 'idle.json'), {
			...defaultSettings(WW_SETTINGS),
			weaveReturnLeewayMs: 11_000,
		}).weave!;
		expect(asked.returnLeewayMs).toBe(5000);
	});
});
