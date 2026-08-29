// The Ascendance verdict column: every fault and every refusal, as the sentence a reader is shown.
//
// `cbc9259` graded the opener as mandatory (§80.1) and the window against the kill (§80.2), and the
// section drew neither — `sync.grade`, `sync.reason` and `wastedMs` were all published and the table had
// three columns about what a press *was*. This file is the guard on the column that says how it *read*.
//
// Eleven outcomes have copy and all eleven are rendered here, because an unrendered branch is how this
// gap happened in the first place: a key nothing asks for and a field nothing draws look identical from
// inside the audit. Two of them — `no-banner` and four of the six refusals — are unreachable on the
// committed pulls, which is exactly why they are driven synthetically rather than left to a fixture.
//
// Literals rather than a second `t()` call, for the reason the sibling copy suites give: a test whose
// two sides both come out of the locale file passes whatever the locale file happens to say.
//
// `createElement` rather than JSX so this stays a `.ts` file and is picked up by the project's own
// vitest include patterns.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { initI18n } from '~/lib/i18n/config';
import { getSpec } from '~/lib/spec';
import type { Analysis, AscendanceFault, AscendancePress, ElementalAuditResult, FightDataset } from '~/lib/types';

import { SpecContext } from '~/components/report/specContext';
import { analyse } from '~/specs/elemental/lib';
import type { AscendanceReason } from '~/specs/elemental/lib/ascendance';

import Ascendance from '../Ascendance';

const ELEMENTAL_SPEC = getSpec('elemental')!;

initI18n();

type El = Analysis & ElementalAuditResult;

const unbroken: El = analyse(
	JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../__fixtures__/unbroken.json'), 'utf8')) as FightDataset,
) as El;

/** The pull with its Ascendance table replaced, so one press at a time can be put on screen. */
const render = (presses: AscendancePress[], grade: El['ascendance']['grade'] = 'bad'): string =>
	renderToStaticMarkup(
		createElement(
			SpecContext.Provider,
			{ value: ELEMENTAL_SPEC },
			createElement(Ascendance, {
				analysis: { ...unbroken, ascendance: { ...unbroken.ascendance, presses, grade } } as Analysis,
			}),
		),
	);

/** A real press off the fixture, with the one field under test overridden. */
const base = unbroken.ascendance.presses[0]!;
const press = (fault: AscendanceFault | null, sync: Partial<AscendancePress['sync']> = {}): AscendancePress => ({
	...base,
	fault,
	sync: { ...base.sync, grade: fault === null ? base.sync.grade : 'bad', reason: null, ...sync },
});

describe('every Ascendance fault reaches the reader as a sentence', () => {
	/** Rule 1 (§80.1) — the fault that did not exist before `cbc9259` and had nowhere to appear. */
	it('says the opener was missed, and what to do instead', () => {
		expect(render([press('opener-late')])).toContain('Pressed after the opening five seconds');
	});

	/**
	 * Rule 2 (§80.2) — and the measurement goes in the sentence. `wastedMs` is the whole of what this
	 * rule has to say, and 14 286 is the number `unbroken`'s own second press carries.
	 */
	it('says how much of the window ran past the kill', () => {
		const html = render([press('window-past-the-kill', { wastedMs: 14_286, dischargeRemainingMs: null })]);
		expect(html).toContain('14.3s ran past the kill');
	});

	it('says an opener came too late into the haste', () => {
		expect(render([press('late-into-haste', { delayMs: 9000 })])).toContain('Too late into the haste to fit inside it');
	});

	it('says how little of the tier-16 proc was left', () => {
		expect(render([press('discharge-too-short', { dischargeRemainingMs: 2500 })])).toContain(
			'Only 2.5s of the T16 2P proc left',
		);
	});

	/**
	 * Rule 3, and the sentence has to match the reading. `ascendanceSync` measures the **union** of every
	 * banner the player was given, not the best single one, because `phased`'s two warriors hand off
	 * mid-window: its opener's best single banner is 8 754 ms against a 9 000 bar while Skull Banner was
	 * actually up for 14 999 of that press's 15 000. So the copy says "Skull Banner" and "the raid's
	 * banner" rather than "a warrior's banner" — a shaman must not read this as a fault for two warriors'
	 * stagger, and must not be told to chase one warrior in particular.
	 */
	it('says the window held no banner, in the union’s terms and not one warrior’s', () => {
		const html = render([press('no-banner', { bannerOverlapMs: 0 })]);
		expect(html).toContain('Barely any Skull Banner inside the window');
		expect(html).not.toContain('a warrior&#x27;s banner');
	});

	/** Every fault has copy. A missing key renders as the key itself, which this would catch. */
	it('has a sentence for all five, none of them falling through to the key', () => {
		const faults: AscendanceFault[] = [
			'opener-late',
			'window-past-the-kill',
			'late-into-haste',
			'discharge-too-short',
			'no-banner',
		];
		for (const fault of faults) {
			const html = render([press(fault, { wastedMs: 1000, dischargeRemainingMs: 1000 })]);
			expect(html, fault).not.toContain(`ascendance.read.fault.${fault}`);
		}
	});
});

describe('a press the rules refused is not a fault, and does not read like one', () => {
	/**
	 * The hedges. `grade: 'none'` means the log could not answer, and the column has to say which way
	 * without implying the player got away with something — the distinction `docs/conventions.md` draws
	 * between `verdict_bad` and `verdict_none`.
	 */
	it('renders each refusal as what could not be read', () => {
		const cases: [AscendanceReason, string][] = [
			['ascendance-up-at-the-pull', 'Already running at the pull'],
			['nothing-to-hit', 'No targets nearby'],
			['no-two-piece-evidence', 'No T16 2P equipped'],
			['t16-2pc-not-in-log', 'T16 2P never procced'],
			['pull-ends-too-soon', 'Pull ended before the pairing fits'],
		];
		for (const [reason, sentence] of cases) {
			const html = render([press(null, { grade: 'none', reason })]);
			expect(html, reason).toContain(sentence);
			expect(html, reason).not.toContain(`ascendance.read.reason.${reason}`);
		}
	});

	/** And a press that passed everything says so plainly rather than saying nothing. */
	it('calls a clean press well placed', () => {
		expect(render([press(null, { grade: 'good' })])).toContain('Well placed');
	});
});

describe('an empty table', () => {
	/**
	 * **Rule 1's other half, and the only place it can appear.** A pull that never pressed Ascendance has
	 * no row to carry the verdict, so `ascendanceSync` puts the `bad` on the pull. An empty table that
	 * said only "never pressed" would be that fault rendered as a shrug.
	 */
	it('tells a pull that never pressed it that this is the fault', () => {
		const html = render([], 'bad');
		expect(html).toContain('Ascendance was never pressed. Every Elemental shaman has it');
		expect(html).toContain('the opener wants it');
	});

	/** And keeps the neutral sentence where the rules refused to judge the pull at all. */
	it('stays neutral where nothing could be judged', () => {
		const html = render([], 'none');
		expect(html).toContain('Ascendance was never pressed in this pull.');
		expect(html).not.toContain('the biggest thing to fix');
	});
});

describe('the column that carries all of it', () => {
	it('is drawn beside what the press was, not instead of it', () => {
		const html = render([press('opener-late')]);
		// Both headers, so the new column is an addition and the old one did not lose its place.
		expect(html).toContain('what it was');
		expect(html).toContain('how it read');
	});

	/** The fixture as it really is: two presses, one clean and one the rules exempted. */
	it('reads the committed pull without a synthetic press in sight', () => {
		const html = render(unbroken.ascendance.presses, unbroken.ascendance.grade);
		expect(html).toContain('Well placed');
		expect(html).toContain('Pull ended before the pairing fits');
	});
});

describe('rule 4 is shown, and never reads as a fault', () => {
	/**
	 * The hedge the user wrote — "the 2nd Ascendance should *ideally* be synced with the 2nd Skull Banner"
	 * — against rule 3's "should have at least". `secondBannerSynced` enters no grade expression, and
	 * `ascendance.test.ts` asserts a `false` there leaves the press `good`. So it is a note under the
	 * table, and the missed case has to say the pairing was worth having without charging for it.
	 */
	it('credits a second press that landed on a warrior’s second banner', () => {
		const html = render([press(null, { grade: 'good', secondBannerOverlapMs: 9500, secondBannerSynced: true })]);
		expect(html).toContain('Your second Ascendance landed on a warrior&#x27;s second Skull Banner');
		expect(html).toContain('the pairing to aim for');
	});

	it('says a missed pairing costs nothing, in as many words', () => {
		const html = render([press(null, { grade: 'good', secondBannerOverlapMs: 200, secondBannerSynced: false })]);
		expect(html).toContain('did not land on a warrior&#x27;s second Skull Banner');
		expect(html).toContain('worth having rather than owed, so nothing here counts against you');
	});

	/**
	 * Null draws nothing at all, which covers both of the ways it arrives: every press but the second, and
	 * a second press on a pull where no warrior banner'd twice. `unbroken` is the second case — two
	 * warriors, one banner each — so the committed pull renders no note.
	 */
	it('draws no note where there is nothing to compare', () => {
		const html = render(unbroken.ascendance.presses, unbroken.ascendance.grade);
		expect(unbroken.ascendance.presses.map((p) => p.sync.secondBannerSynced)).toEqual([null, null]);
		expect(html).not.toContain('second Skull Banner');
	});
});
