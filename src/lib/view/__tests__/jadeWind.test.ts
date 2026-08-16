// What holds the Rushing Jade Wind section's three claims up.
//
// The section makes an argument rather than reporting a field, and an argument is exactly the kind of
// thing that quietly stops being true. Three claims, one group of assertions each:
//
//   1. **One clock.** The uptime's numerator and its denominator are the same set of contact
//      segments, and the press count and the press ceiling are counted over that same set. Reading a
//      numerator on one clock against a denominator on another has produced a wrong number in this
//      report repeatedly, and here it is structural rather than remembered.
//   2. **The ceiling is priced, not asserted.** The cooldown ceiling is 100% and useless; the figure
//      the section prints beside the uptime is what that ceiling would cost as a share of the pull's
//      *own measured* energy income. So it has to move with the pull's rate rather than being a
//      constant this file could have written down.
//   3. **A talent that was not taken is not a zero.** Three states, and the middle one — proven
//      absent — has to come from the same rule the reference list uses, or the two could disagree
//      about whether the button existed.
//
// Read against the committed fixtures wherever a fixture can answer, because they are real pulls and
// a synthetic analysis can only ever confirm the arithmetic this file already wrote.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { unionMs } from '~/lib/analysis/intervals';
import { RJW_COOLDOWN_MS, RJW_ENERGY_COST } from '~/lib/spec/apl';
import type { Analysis } from '~/lib/types';

import { readJadeWind, RJW_CAST_ID } from '../jadeWind';

function fixture(name: string): Analysis {
	return JSON.parse(readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8'));
}

/** The three committed pulls that took the talent, and the three that did not. */
const TALENTED = ['strong', 'waves', 'cleave'] as const;
const UNTALENTED = ['mixed', 'poor', 'weave'] as const;

/** The reading at the pull's own live band, which is what the section shows on `auto`. */
function read(name: string) {
	const analysis = fixture(name);
	return { analysis, reading: readJadeWind(analysis, analysis.apl) };
}

describe('one clock', () => {
	it.each(TALENTED)('measures %s against the union of its contact segments', (name) => {
		const { analysis, reading } = read(name);
		const measured = reading.measured;
		expect(measured).not.toBeNull();
		if (measured === null) return;

		// The denominator *is* the segment set, not a scalar carried beside it — so the two cannot drift.
		expect(measured.measuredMs).toBe(unionMs(analysis.debuff.contactSegments ?? []));
		// And it is the clock the rest of the report grades choices against, not the pull.
		expect(measured.measuredMs).toBe(analysis.debuff.contactMs);
		expect(measured.measuredMs).toBeLessThan(analysis.durationMs);
	});

	it.each(TALENTED)('never counts %s uptime outside the clock it divides by', (name) => {
		const measured = read(name).reading.measured;
		expect(measured?.uptimeMs).toBeLessThanOrEqual(measured?.measuredMs ?? 0);
		expect(measured?.uptimePct).toBeLessThanOrEqual(100);
	});

	/**
	 * The specific mismatch this guards. `waves` presses the wind 35 times and three of those land
	 * between add packs, outside contact — so a press count taken off the cast row would be measured on
	 * the pull's clock while the ceiling beside it was measured on the contact clock.
	 */
	it('counts only the presses made inside the clock', () => {
		const { analysis, reading } = read('waves');
		const rowCount = analysis.casts.find((c) => c.id === RJW_CAST_ID)?.count ?? 0;
		expect(rowCount).toBe(35);
		expect(reading.measured?.presses).toBe(32);
	});

	it.each(TALENTED)('floors %s press ceiling to the cooldowns that clock had room for', (name) => {
		const measured = read(name).reading.measured;
		expect(measured?.possiblePresses).toBe(Math.floor((measured?.measuredMs ?? 0) / RJW_COOLDOWN_MS));
	});

	/** An analysis from before contact segments existed falls back to the pull for *both* halves. */
	it('falls back to the whole pull rather than to a mixed pair', () => {
		const analysis = fixture('cleave');
		const legacy: Analysis = { ...analysis, debuff: { ...analysis.debuff } };
		delete legacy.debuff.contactSegments;
		const measured = readJadeWind(legacy, legacy.apl).measured;
		expect(measured?.measuredMs).toBe(legacy.durationMs);
		expect(measured?.uptimePct).toBeLessThanOrEqual(100);
	});
});

describe('the ceiling, priced rather than asserted', () => {
	/**
	 * The claim the section is built on: covering a pull end to end takes about half of everything the
	 * bar earns. 40 energy every six seconds is 6.67 a second against a measured 12–13, and these are
	 * the three real pulls that answer it.
	 */
	it.each(TALENTED)('prices full coverage on %s at about half the pull income', (name) => {
		const share = read(name).reading.measured?.ceilingSharePct ?? 0;
		expect(share).toBeGreaterThan(45);
		expect(share).toBeLessThan(60);
	});

	it.each(TALENTED)('derives %s share from that pull own measured regen', (name) => {
		const { analysis, reading } = read(name);
		const measured = reading.measured;
		const regen = analysis.energy?.regenPerSec ?? 0;
		expect(regen).toBeGreaterThan(0);
		// Stated as the identity rather than as a number, so a changed rate has to move the share.
		expect(measured?.incomeEnergy).toBeCloseTo((regen * (measured?.measuredMs ?? 0)) / 1000, 6);
		expect(measured?.ceilingEnergy).toBe((measured?.possiblePresses ?? 0) * RJW_ENERGY_COST);
		expect(measured?.spentEnergy).toBe((measured?.presses ?? 0) * RJW_ENERGY_COST);
	});

	/** Not a constant: halve the pull's measured regen and the price of the same ceiling doubles. */
	it('moves with the rate rather than being written down here', () => {
		const analysis = fixture('cleave');
		const regen = analysis.energy?.regenPerSec ?? 0;
		const halved: Analysis = { ...analysis, energy: { ...analysis.energy!, regenPerSec: regen / 2 } };
		const base = readJadeWind(analysis, analysis.apl).measured?.ceilingSharePct ?? 0;
		const slower = readJadeWind(halved, halved.apl).measured?.ceilingSharePct ?? 0;
		expect(slower).toBeCloseTo(base * 2, 6);
	});

	/** An unmeasured price is not a free one: nulls, never zeroes, so the section can print a dash. */
	it('refuses to price a pull that measured no regen', () => {
		const analysis = fixture('cleave');
		const unmeasured: Analysis = { ...analysis, energy: { ...analysis.energy!, regenPerSec: null } };
		const measured = readJadeWind(unmeasured, unmeasured.apl).measured;
		expect(measured?.incomeEnergy).toBeNull();
		expect(measured?.spentSharePct).toBeNull();
		expect(measured?.ceilingSharePct).toBeNull();
		// The rest of the measurement still stands; only the price is withheld.
		expect(measured?.uptimePct).toBeGreaterThan(0);
	});
});

describe('the ladder, quoted rather than re-judged', () => {
	it.each(TALENTED)('takes %s verdicts from the audit it was handed', (name) => {
		const { analysis, reading } = read(name);
		const own = (analysis.apl?.presses ?? []).filter((p) => p.pressed === RJW_CAST_ID);
		expect(reading.ladder?.followed).toBe(own.filter((p) => p.verdict === 'followed').length);
		expect(reading.ladder?.skipped).toBe(own.filter((p) => p.verdict === 'skipped').length);
		expect(reading.ladder?.judged).toBe((reading.ladder?.followed ?? 0) + (reading.ladder?.skipped ?? 0));
	});

	/**
	 * The list carries the wind twice — promoted above Rising Sun Kick from two enemies up, and
	 * unconditional near the bottom — so the count of globals it wanted the button at has to be both
	 * rungs and not whichever one the reader's band happened to reach.
	 */
	it('adds both of the list two entries for the same button', () => {
		const analysis = fixture('strong');
		const rows = (analysis.apl?.skippedBy ?? []).filter((s) => s.id === RJW_CAST_ID);
		expect(rows.map((r) => r.key).sort()).toEqual(['rushing-jade-wind', 'rushing-jade-wind-open']);
		expect(readJadeWind(analysis, analysis.apl).ladder?.wanted).toBe(rows.reduce((sum, r) => sum + r.count, 0));
	});

	/** The reader's override picks a different walk, and this section has to follow it, not the pull. */
	it('answers the band it is handed', () => {
		const analysis = fixture('strong');
		const live = readJadeWind(analysis, analysis.apl).ladder;
		const single = readJadeWind(analysis, analysis.aplForced?.[1]).ladder;
		const multi = readJadeWind(analysis, analysis.aplForced?.[3]).ladder;
		expect(single?.followed).toBe(1);
		expect(multi?.followed).toBe(9);
		expect(live?.followed).toBe(4);
	});

	/** No walk is not an empty walk: a log with no resource readings has to say nothing, not "zero". */
	it('reports no ladder rather than an empty one', () => {
		const analysis = fixture('strong');
		expect(readJadeWind(analysis, null).ladder).toBeNull();
		expect(readJadeWind(analysis, undefined).ladder).toBeNull();
	});
});

describe('the talent, which is the one thing that must not become a zero', () => {
	it.each(TALENTED)('reads %s as talented', (name) => {
		expect(read(name).reading.talent).toEqual({ state: 'taken' });
	});

	/**
	 * All three untalented fixtures prove it the same way — they cast Invoke Xuen, the other half of
	 * the level-90 row — and none of them may be measured. A 0% here would be an accusation about a
	 * button that was never on the bar.
	 */
	it.each(UNTALENTED)('reads %s as proven absent and measures nothing', (name) => {
		const { reading } = read(name);
		expect(reading.talent).toEqual({ state: 'not-taken', instead: 'invokeXuen' });
		expect(reading.measured).toBeNull();
	});

	/** The other proof: taking the wind removes Spinning Crane Kick, so pressing one settles the row. */
	it('reads a Spinning Crane Kick as proof the wind was not taken', () => {
		const analysis = fixture('mixed');
		const crane: Analysis = {
			...analysis,
			casts: analysis.casts
				.filter((c) => c.id !== 123_904)
				.concat([{ ...analysis.casts[0]!, id: 101_546, name: 'Spinning Crane Kick', count: 4 }]),
		};
		expect(readJadeWind(crane, crane.apl).talent).toEqual({ state: 'not-taken', instead: 'spinningCraneKick' });
	});

	/**
	 * The third state, and the reason there are three. A pull that shows neither sibling cannot say
	 * whether the talent was taken — that is indistinguishable from a monk who took it and never
	 * pressed the button — so it says so instead of reporting a shortfall.
	 */
	it('says it cannot tell when the log carries no evidence either way', () => {
		const analysis = fixture('mixed');
		const silent: Analysis = { ...analysis, casts: analysis.casts.filter((c) => c.id !== 123_904) };
		const reading = readJadeWind(silent, silent.apl);
		expect(reading.talent).toEqual({ state: 'unknown' });
		expect(reading.measured).toBeNull();
	});
});
