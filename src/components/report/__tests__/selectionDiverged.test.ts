// Swapping the pull has to take the previous pull's report with it.
//
// The analysis is rendered from a request triple, and nothing but a new request ever replaced it — so
// every change of selection that did not go through the report field left the old report standing:
// pick a different encounter and the last fight's numbers stayed on screen under the new fight's
// name, until the button was pressed again. `ReportInput` had the answer for the code half all along
// (it keeps what the results below belong to and fires `onDiverge` when the field stops matching);
// this is that same question asked of all three parts of the triple.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { AnalysisRequest } from '~/hooks/useFightAnalysis';

import { selectionDiverged } from '../selectionDiverged';

/** What was analysed, and — until a picker moves — what is selected. */
const ANALYSED: AnalysisRequest = { code: 'ExampleCode12345', fightID: 30, playerName: 'Thunderfist' };
const SELECTED = { code: ANALYSED.code, fightID: ANALYSED.fightID, playerName: ANALYSED.playerName };

describe('whether the report on screen is still the one selected', () => {
	it('holds while the selection is the one that was analysed', () => {
		expect(selectionDiverged(ANALYSED, SELECTED)).toBe(false);
	});

	/** The reported bug: same report, same player, a different boss. */
	it('diverges when another encounter is picked', () => {
		expect(selectionDiverged(ANALYSED, { ...SELECTED, fightID: 32 })).toBe(true);
	});

	it('diverges when another player is picked, who has their own pull inside the same fight', () => {
		expect(selectionDiverged(ANALYSED, { ...SELECTED, playerName: 'Sparkstorm' })).toBe(true);
	});

	/** The half `ReportInput` already covers from its own side, pinned here so the rule is one rule. */
	it('diverges when the report code changes', () => {
		expect(selectionDiverged(ANALYSED, { ...SELECTED, code: 'OtherCode12345678' })).toBe(true);
	});

	/**
	 * A pull whose roster has not arrived yet resolves no player, and that is not the selection the
	 * report came from either. Counting it as divergence is what stops a report from standing through
	 * the round trip between choosing a fight and learning who was in it.
	 */
	it('diverges while a picker has not resolved', () => {
		expect(selectionDiverged(ANALYSED, { ...SELECTED, playerName: null })).toBe(true);
		expect(selectionDiverged(ANALYSED, { code: null, fightID: null, playerName: null })).toBe(true);
	});

	/** Nothing has been analysed, so there is nothing on screen for the pickers to contradict. */
	it('answers false with no request, rather than clearing what is already empty', () => {
		expect(selectionDiverged(null, SELECTED)).toBe(false);
		expect(selectionDiverged(null, { code: null, fightID: null, playerName: null })).toBe(false);
	});
});

describe('the slot consults it', () => {
	/**
	 * The predicate is only half the fix, and the half a passing suite cannot see: whatever holds a
	 * pull has to ask it and drop the request. A textual check the way `useNarrow.test.ts` sweeps for
	 * `matchMedia`, because the wiring is an effect over React state and the suite runs in the node
	 * environment on purpose — there is no DOM here to click a second fight in.
	 *
	 * **It reads `useReportSlot`, which is where this moved when the compare page needed two pulls.**
	 * It used to read `ReportFlow`, and pointing it at the new home rather than deleting it is the
	 * whole value of the guard: a second copy of the selection logic is exactly the thing that would
	 * have carried the code and left this behaviour behind.
	 */
	it('drops the request when the selection has moved off it', () => {
		const slot = readFileSync(resolve(import.meta.dirname, '..', '..', '..', 'hooks', 'useReportSlot.ts'), 'utf8');
		expect(slot).toContain('selectionDiverged(request, { code, fightID, playerName })');
		expect(slot).toContain('requestPull(null)');
	});

	/**
	 * And the flow no longer does it itself, so the two cannot both try.
	 *
	 * Two passes that must agree are a bug, and two `requestPull(null)` calls racing one selection
	 * change is the shape that bug would take here.
	 */
	it('is asked in one place, not two', () => {
		const flow = readFileSync(resolve(import.meta.dirname, '..', 'ReportFlow.tsx'), 'utf8');
		expect(flow).not.toContain('selectionDiverged(');
	});
});
