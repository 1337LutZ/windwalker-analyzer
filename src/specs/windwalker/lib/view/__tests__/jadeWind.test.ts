// What holds the Rushing Jade Wind section's claims up.
//
// The section reports three distinct facts:
//
//   1. **One clock.** Uptime and press counts use the same contact segments.
//   2. **Priority opportunities.** The denominator comes from the APL audit, not the cooldown.
//   3. **A talent that was not taken is not a zero.** Three states distinguish absent evidence from
//      a button that was taken and never pressed.
//
// Read against the committed fixtures wherever a fixture can answer, because they are real pulls and
// a synthetic analysis can only ever confirm the arithmetic this file already wrote.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { unionMs } from '~/lib/analysis/intervals';
import type { AplAudit } from '~/lib/spec/apl';
import type { Analysis } from '~/lib/types';

import { readJadeWind, RJW_CAST_ID } from '../jadeWind';

function fixture(name: string): Analysis {
	return JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../__fixtures__/${name}.json`), 'utf8'));
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

	/** The specific mismatch this guards: presses outside contact do not belong to this clock. */
	it('counts only the presses made inside the clock', () => {
		const { analysis, reading } = read('waves');
		const rowCount = analysis.casts.find((c) => c.id === RJW_CAST_ID)?.count ?? 0;
		expect(rowCount).toBe(35);
		expect(reading.measured?.presses).toBe(32);
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

describe('the ladder opportunities, quoted rather than re-judged', () => {
	it('adds a missed Bloodlust/RJW window when Energizing Brew was available but unused', () => {
		const analysis = fixture('strong');
		const withMissedHaste = {
			...analysis,
			energizing: {
				...analysis.energizing!,
				rushingJadeWind: true,
				hasteWindows: [{ start: 0, end: 5000, id: 2825, variant: 'Bloodlust' }],
				uses: analysis.energizing!.uses.map((use) => ({ ...use, t: 10_000 })),
			},
		};
		const ladder = readJadeWind(withMissedHaste, withMissedHaste.apl).ladder;

		expect(ladder?.decisions.some((row) => row.kind === 'missed' && row.reason === 'haste-window-available')).toBe(
			true,
		);
	});

	it('grades unnecessary presses as bad when there were no opportunities', () => {
		const analysis = fixture('strong');
		const audit: AplAudit = {
			presses: Array.from({ length: 9 }, (_, i) => ({
				t: i * 1000,
				pressed: RJW_CAST_ID,
				wanted: null,
				verdict: 'skipped' as const,
			})),
			followed: 0,
			skipped: 9,
			unknown: 0,
			offList: 0,
			skippedBy: [],
		};
		const ladder = readJadeWind(analysis, audit).ladder;

		expect(ladder?.opportunities).toBe(0);
		expect(ladder?.choiceRate).toBe(0);
		expect(ladder?.choiceGrade).toBe('bad');
	});

	it.each(TALENTED)('takes %s verdicts from the audit it was handed', (name) => {
		const { analysis, reading } = read(name);
		const own = (analysis.apl?.presses ?? []).filter((p) => p.pressed === RJW_CAST_ID);
		expect(reading.ladder?.followed).toBe(own.filter((p) => p.verdict === 'followed').length);
		expect(reading.ladder?.skipped).toBe(own.filter((p) => p.verdict === 'skipped').length);
		expect(reading.ladder?.judged).toBe((reading.ladder?.followed ?? 0) + (reading.ladder?.skipped ?? 0));
		expect(reading.ladder?.opportunities).toBe((reading.ladder?.followed ?? 0) + (reading.ladder?.wanted ?? 0));
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
