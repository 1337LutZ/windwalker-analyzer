// What holds the Blackout Kick section's two claims up.
//
// The section makes two arguments and they are structurally different, so this file is in two halves:
//
//   1. **The list wanted something else at this global.** Read out of the ladder's per-press verdicts,
//      exhaustive over the presses, and — the part that keeps being got wrong — counted *by presser*
//      rather than by rule. `skippedBy` answers "how often was Tiger Palm passed over" across every
//      button on the bar; this section asks how often it was passed over *by a Blackout Kick*, and the
//      two are different numbers on every committed fixture.
//   2. **This press cost a kick later.** Arithmetic on the reconstructed chi bar in the engine, and
//      therefore the same at every target count. That independence is asserted rather than trusted,
//      because the section prints a note promising it.
//
// Read against the committed fixtures throughout: they are real pulls, and a synthetic analysis could
// only confirm the arithmetic this file already wrote.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CHI_COST } from '~/lib/spec/apl';
import { abilityCooldownMs } from '~/lib/spec/windwalker';
import type { Analysis } from '~/lib/types';

import { readBlackoutKick, BLACKOUT_KICK_CAST_ID } from '../blackoutKick';

const FIXTURES = ['strong', 'mixed', 'poor', 'waves', 'cleave', 'weave'] as const;
const RSK_CAST_ID = 107_428;

function fixture(name: string): Analysis {
	return JSON.parse(readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8'));
}

/** The reading at the pull's own live band, which is what the section shows on `auto`. */
function read(name: string) {
	const analysis = fixture(name);
	return { analysis, reading: readBlackoutKick(analysis, analysis.apl) };
}

describe('what the list wanted instead', () => {
	/**
	 * Exhaustive by construction: every press the ladder called a skip lands in exactly one row, so the
	 * table can never quietly drop a fault by not having a column for it.
	 */
	it.each(FIXTURES)('files every skipped %s press under exactly one button', (name) => {
		const ladder = read(name).reading.ladder;
		expect(ladder).not.toBeNull();
		const total = (ladder?.wantedInstead ?? []).reduce((sum, row) => sum + row.count, 0);
		expect(total).toBe(ladder?.skipped);
	});

	/**
	 * The distinction the section exists to draw, and the one a reader would take at face value.
	 * `skippedBy` counts a button passed over by *anything*; these rows count it passed over by this
	 * button. Every row must be no larger than the ladder's own total for that rule, and on a real pull
	 * at least one has to be strictly smaller — otherwise the two questions are the same question and
	 * the walk was pointless.
	 */
	it.each(FIXTURES)('counts %s by presser rather than by rule', (name) => {
		const { analysis, reading } = read(name);
		const byRule = new Map((analysis.apl?.skippedBy ?? []).map((s) => [s.key, s.count]));
		const rows = reading.ladder?.wantedInstead ?? [];
		expect(rows.length).toBeGreaterThan(0);
		for (const row of rows) expect(row.count).toBeLessThanOrEqual(byRule.get(row.key) ?? 0);
		expect(rows.some((row) => row.count < (byRule.get(row.key) ?? 0))).toBe(true);
	});

	/**
	 * The free kick can never be the button a Blackout Kick passed over, and the reason is the ladder's
	 * shape rather than a filter here: `judge` stops at the first rule that wants the global, and a rule
	 * the press itself satisfies comes back `followed`. So "the list wanted a free kick and you paid for
	 * one" is recorded as a press that followed the list, never as a fault against another button — and
	 * lumping it in with Tiger Palm would blur which of the two mistakes a reader had made.
	 */
	it.each(FIXTURES)('never files a %s press under the free kick it might have been', (name) => {
		const analysis = fixture(name);
		for (const band of [1, 2, 3, 4] as const) {
			const rows = readBlackoutKick(analysis, analysis.aplForced?.[band]).ladder?.wantedInstead ?? [];
			expect(rows.map((row) => row.key)).not.toContain('combo-breaker-kick');
		}
	});

	/**
	 * Which rung a press followed is a real distinction and is read off the audit rather than guessed:
	 * a Combo Breaker proc costs nothing and is never the wrong press, while a dump is a judgement about
	 * the bar. The two have to add up to the presses the ladder approved of.
	 */
	it.each(FIXTURES)('splits %s approved presses into the free one and the dump', (name) => {
		const { analysis, reading } = read(name);
		const ladder = reading.ladder;
		const approved = (analysis.apl?.presses ?? []).filter(
			(p) => p.pressed === BLACKOUT_KICK_CAST_ID && p.verdict === 'followed',
		);
		expect((ladder?.free ?? 0) + (ladder?.dump ?? 0)).toBe(approved.length);
		expect(ladder?.judged).toBe(approved.length + (ladder?.skipped ?? 0));
	});

	/** The reader's override picks a different walk, and this half has to follow it rather than the pull. */
	it('answers the band it is handed', () => {
		const analysis = fixture('strong');
		expect(readBlackoutKick(analysis, analysis.aplForced?.[1]).ladder?.judged).toBe(109);
		expect(readBlackoutKick(analysis, analysis.aplForced?.[3]).ladder?.judged).toBe(73);
		// At three targets the list wants Rushing Jade Wind in these globals, and says so in the table.
		expect(readBlackoutKick(analysis, analysis.aplForced?.[3]).ladder?.wantedInstead[0]?.key).toBe(
			'rushing-jade-wind-open',
		);
	});

	/** No walk is not an empty walk: a log with no resource readings says nothing rather than "zero". */
	it('reports no ladder rather than an empty one', () => {
		const analysis = fixture('strong');
		expect(readBlackoutKick(analysis, null).ladder).toBeNull();
		expect(readBlackoutKick(analysis, undefined).ladder).toBeNull();
	});
});

describe('the kicks this button starved', () => {
	/**
	 * One clock, and it is the lost-cast row's. The seconds charged here are a subset of the seconds
	 * that row already prints for Rising Sun Kick, so a reader who adds the two sections together
	 * cannot arrive at more drift than the pull had.
	 */
	it.each(FIXTURES)('measures %s against the drift the lost-cast row reports', (name) => {
		const { analysis, reading } = read(name);
		const row = analysis.lostCasts.find((r) => r.id === RSK_CAST_ID);
		const starve = reading.starve;
		expect(starve).not.toBeNull();
		expect((starve?.driftMs ?? 0) / 1000).toBeCloseTo(row?.driftSec ?? 0, 1);
		expect(starve?.chargedMs).toBeLessThanOrEqual(starve?.starvedMs ?? 0);
		expect(starve?.starvedMs).toBeLessThanOrEqual(starve?.driftMs ?? 0);
		expect(starve?.charged.length).toBeLessThanOrEqual(starve?.starvedWaits ?? 0);
	});

	/**
	 * The claim the section's note makes out loud: this half is about the chi bar, so it must not move
	 * when the reader changes how many enemies they are reading the pull as. Only `followedList` may
	 * move, because that one asks the ladder a question.
	 */
	it.each(FIXTURES)('reads %s the same at every target count', (name) => {
		const analysis = fixture(name);
		const readings = [1, 2, 3, 4].map((band) => readBlackoutKick(analysis, analysis.aplForced?.[band as 1]).starve);
		for (const starve of readings) {
			expect(starve?.chargedMs).toBe(readings[0]?.chargedMs);
			expect(starve?.starvedMs).toBe(readings[0]?.starvedMs);
			expect(starve?.charged.length).toBe(readings[0]?.charged.length);
			expect(starve?.debuffDrops).toBe(readings[0]?.debuffDrops);
		}
	});

	/**
	 * Every charged wait has to carry the evidence it rests on: a bar below the kick's cost when the
	 * kick came up, and a press that came before it. Without both, the row is an accusation rather than
	 * a measurement — and the bar reading is also what the tier-bonus caveat turns on.
	 */
	it.each(FIXTURES)('carries the bar and the press behind every %s row', (name) => {
		for (const row of read(name).reading.starve?.charged ?? []) {
			expect(row.chi).toBeLessThan(CHI_COST.risingSunKick);
			expect(row.chi).toBeGreaterThanOrEqual(0);
			// Pressed while the kick was on its way back, never after it had already come up.
			expect(row.pressAt).toBeLessThanOrEqual(row.at);
			expect(row.pressAt).toBeGreaterThan(row.at - abilityCooldownMs('rising-sun-kick'));
			expect(row.ms).toBeGreaterThan(0);
		}
	});

	/** Floored to whole cooldowns, which is the unit the rest of the report loses casts in. */
	it.each(FIXTURES)('converts %s charged time to whole kicks', (name) => {
		const starve = read(name).reading.starve;
		expect(starve?.chargedKicks).toBe(Math.floor((starve?.chargedMs ?? 0) / abilityCooldownMs('rising-sun-kick')));
	});

	/**
	 * The finding that stops the section reading as "you broke the list". The sim's dump rule guards
	 * with an energy reserve and the failure is a chi one, so presses that satisfied it starve the kick
	 * anyway — 43 of 175 across the three anonymous reports when that sweep was run against the old
	 * one-global cooldown window, and two of `strong`'s twelve here.
	 */
	it('counts the charged presses the list itself wanted', () => {
		const analysis = fixture('strong');
		const starve = readBlackoutKick(analysis, analysis.apl).starve;
		expect(starve?.charged.length).toBe(12);
		expect(starve?.followedList).toBe(2);
		expect(starve?.followedList).toBeLessThan(starve?.charged.length ?? 0);
	});

	/**
	 * An analysis captured before the audit existed says nothing rather than reporting a clean pull —
	 * "no kick was starved" and "nobody looked" are opposite facts about the same button.
	 */
	it('reports no audit rather than a clean one', () => {
		const analysis = fixture('strong');
		const legacy: Analysis = { ...analysis };
		delete legacy.blackoutKick;
		expect(readBlackoutKick(legacy, legacy.apl).starve).toBeNull();
		// The casts still come off the table, so the section keeps a count to print.
		expect(readBlackoutKick(legacy, legacy.apl).casts).toBe(114);
	});

	/** The walk scores itself, so the section can state its accuracy instead of quoting a range at it. */
	it.each(FIXTURES)('carries %s own reconstruction accuracy', (name) => {
		const accuracy = read(name).reading.starve?.chiAccuracyPct ?? 0;
		expect(accuracy).toBeGreaterThan(50);
		expect(accuracy).toBeLessThanOrEqual(100);
	});
});
