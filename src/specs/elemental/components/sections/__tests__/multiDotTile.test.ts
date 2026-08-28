// The second-target tile on a pull nothing measured it on.
//
// `9397af8` made `flameShock.multiTargetMs` the *graded* clock — band 2 alone, the one figure in the audit
// cut at both ends — and the section's gate in front of the tile still read it as "did this pull have a
// second target". Those are different questions from the moment the ceiling exists: a pull whose every
// two-target second fell inside an add wave has a real second enemy, a real dot on it, and a graded clock
// of zero. The gate deleted the tile on exactly the pulls the `— not measured at this many enemies`
// caption was written for, which is the shape `8e011ac` repaired for the totem and the shield.
//
// Nor is the answer a zero. `multiDotUptimePct` is `0` when its clock is empty because `0 / 0` has to be
// something, so the honest tile shows a dash: the question is visible, and it has no answer.
//
// The pull below is built rather than measured because no committed fixture is this shape — `cleave` has
// band-2 seconds outside its add waves, and `phased` and `unbroken` have no second enemy at all. It is the
// `allAoe` shape from `lib/__tests__/bandedClocks.test.ts` with a Flame Shock added to the second enemy:
// three adds hit from the first event to the last, so `>= 3` covers the pull and band 2 is empty by
// subtraction.
//
// **It has to be the whole pull and not a stretch in the middle**, which is worth writing down because the
// first attempt at this fixture was a stretch. `aoeWindows` is the `>= 3` series *trimmed of its trailing
// lag* and the `>= 2` series is not, so an add wave that opens and closes leaves a few seconds of band 2
// at its tail however tightly the two enemies are matched — a clock of 3 500ms rather than zero, and a tile
// reading 0% rather than a dash. A pull that is band 3+ from the start has no tail to leave.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { initI18n } from '~/lib/i18n/config';
import { getSpec } from '~/lib/spec';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';
import type { WclEvent } from '~/lib/events';

import { SpecContext } from '~/components/report/specContext';
import { analyse } from '~/specs/elemental/lib';
import { scoreAnalysis } from '~/specs/elemental/lib/score';

import FlameShock from '../FlameShock';

const ELEMENTAL_SPEC = getSpec('elemental')!;

initI18n();

type El = Analysis & ElementalAuditResult;

const analysed = (name: string): El =>
	analyse(
		JSON.parse(
			readFileSync(resolve(import.meta.dirname, `../../../__fixtures__/${name}.json`), 'utf8'),
		) as FightDataset,
	) as El;

const render = (analysis: Analysis) =>
	renderToStaticMarkup(
		createElement(SpecContext.Provider, { value: ELEMENTAL_SPEC }, createElement(FlameShock, { analysis })),
	);

// ------------------------------------------------- a pull whose band 2 is empty by subtraction

const T0 = 700_000;
const DURATION = 200_000;
const ME = 3;
const BOSS = 30;
const SECOND = 31;
const THIRD = 32;
const FLAME_SHOCK = 8050;

const ev = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: T0 + t,
	type,
	abilityGameID: id,
	sourceID: ME,
	targetID: ME,
	...extra,
});

/** Every two seconds, so the count series is one unbroken stretch per enemy rather than a flicker. */
const hits = (fromMs: number, toMs: number, target: number): WclEvent[] =>
	Array.from({ length: Math.floor((toMs - fromMs) / 2000) + 1 }, (_, i) =>
		ev(fromMs + i * 2000, 'damage', 403, { targetID: target, amount: 1000, hitType: 1 }),
	);

const dot = (target: number, fromMs: number, toMs: number): WclEvent[] => [
	ev(fromMs, 'applydebuff', FLAME_SHOCK, { targetID: target }),
	ev(toMs, 'removedebuff', FLAME_SHOCK, { targetID: target }),
];

/**
 * Three enemies from the pull's start to the last event, with the dot on the boss all pull and on the second enemy
 * for eighty seconds of it. So `>= 3` is the whole pull, band 2 is empty, and there is nonetheless a real
 * second target carrying a real dot — every ingredient of the tile except a clock to measure it over.
 */
const allAoe = analyse({
	code: 'md0001',
	fight: {
		id: 1,
		name: 'Dark Shaman',
		encounterID: 1623,
		kill: true,
		difficulty: 4,
		size: 25,
		startTime: T0,
		endTime: T0 + DURATION,
	},
	actor: { id: ME, name: 'Sparkstorm', type: 'Player' },
	actors: [
		{ id: ME, name: 'Sparkstorm', type: 'Player' },
		{ id: BOSS, name: 'Wavebinder Kardris', type: 'NPC', subType: 'Boss' },
		{ id: SECOND, name: 'Earthbreaker Haromm', type: 'NPC', subType: 'NPC' },
		{ id: THIRD, name: 'Foul Slime', type: 'NPC', subType: 'NPC' },
	],
	events: [
		...hits(0, 198_000, BOSS),
		...hits(0, 198_000, SECOND),
		...hits(0, 198_000, THIRD),
		...dot(BOSS, 0, 198_000),
		...dot(SECOND, 20_000, 100_000),
		// One Lava Burst, so the pull reads as an Elemental at all — see `looksElemental`.
		ev(500, 'cast', 51_505, { targetID: BOSS }),
	],
	table: {
		fight: {
			id: 1,
			name: 'Dark Shaman',
			encounterID: 1623,
			kill: true,
			difficulty: 4,
			size: 25,
			startTime: T0,
			endTime: T0 + DURATION,
			enemyNPCs: [
				{ id: BOSS, gameID: 71_454 },
				{ id: SECOND, gameID: 71_859 },
				{ id: THIRD, gameID: 71_858 },
			],
		},
		damageDone: {
			entries: [
				{
					name: 'Sparkstorm',
					id: ME,
					type: 'Shaman',
					itemLevel: 553,
					total: 300_000,
					activeTime: DURATION,
					abilities: [{ guid: 403, name: 'Lightning Bolt', total: 300_000 }],
				},
			],
		},
	},
}) as El;

/** One tile's value, taken from the markup the value and its label share. */
const valueOfTile = (html: string, label: string): string | undefined =>
	new RegExp(`<b[^>]*>([^<]*)</b><span[^>]*>${label}`).exec(html)?.[1];

const cleave = analysed('cleave');
const unbroken = analysed('unbroken');

describe('the second-target tile on a pull with an empty band-2 clock', () => {
	/** The premise, asserted rather than assumed: a real second enemy, a real dot, and no graded clock. */
	it('is built with a second target the rule has no clock for', () => {
		expect(allAoe.targets?.counts.max).toBe(3);
		expect(allAoe.targets?.multiTargetMs ?? 0).toBeGreaterThan(0);
		expect(allAoe.flameShock.multiTargetMs).toBe(0);
		// And the dot really was on it, so nothing below passes because there was nothing to measure.
		expect(allAoe.flameShock.windows.length).toBeGreaterThan(0);
	});

	/**
	 * **And the caption has to come from the empty clock, not from the band exemption**, or this pull would
	 * prove nothing about the change. `metricOf` sets `exempt` when the *reading* declares no band the rule
	 * covers, and `unasked` — the caption's existing source — reads that flag alone. An empty clock is the
	 * other branch (`thin`): `unmeasurable` true, no `exempt`. This pull is detected multi-target, so band 2
	 * is in view, the flag is absent, and `unasked` returns false. The caption below is the new argument's.
	 */
	it('is a pull whose metric is unmeasurable without being exempt', () => {
		expect(allAoe.targets?.detected).toBe('multi');
		const md = scoreAnalysis(allAoe).sections['flameShock']?.metrics.find((m) => m.key === 'flameShockMultiDot');
		expect(md?.unmeasurable).toBe(true);
		expect(md?.exempt).toBeUndefined();
		expect(md?.gradedMs).toBe(0);
	});

	/** The tile survives, which is the whole of this change. */
	it('keeps the tile instead of deleting it', () => {
		expect(render(allAoe)).toContain('Second target uptime');
	});

	/** With the caption, in the label, beside the figure — not in a note under the table. */
	it('says in the label that nothing measured it', () => {
		expect(render(allAoe)).toContain('Second target uptime — not measured at this many enemies');
	});

	/**
	 * And a dash rather than `0%`. `multiDotUptimePct` is a real zero here only because `0 / 0` had to be
	 * something, and a tile reading 0% accuses the reader of never dotting a target nothing looked for.
	 */
	it('shows a dash where the figure would be, not a zero', () => {
		// The tile's own value, read out of its own markup rather than looked for anywhere in the section: the
		// uptime tile above it is unmeasurable on this pull too and prints its own figure.
		expect(valueOfTile(render(allAoe), 'Second target uptime')).toBe('—');
	});

	/**
	 * The no-change guards, from both sides. `cleave` has band-2 seconds outside its add waves, so its tile
	 * reads the figure with no caption; `unbroken` never had a second enemy at all, so it has no tile — the
	 * absence is the answer there, and this gate must not have turned it into a dash.
	 */
	it('leaves a measured pull and a single-target pull exactly as they were', () => {
		const measured = render(cleave);
		expect(measured).toContain('Second target uptime'); // no-change guard
		expect(measured).not.toContain('Second target uptime — not measured'); // no-change guard
		expect(valueOfTile(measured, 'Second target uptime')).toBe('35.54%'); // no-change guard
		expect(cleave.flameShock.multiTargetMs).toBe(34_783);

		expect(unbroken.targets?.multiTargetMs ?? 0).toBe(0); // no-change guard
		expect(render(unbroken)).not.toContain('Second target uptime'); // no-change guard
	});

	/**
	 * The note that says what clock the figure is over, and why the graph above cannot show it.
	 *
	 * The second dot is the one figure in the section with no band on the chart: `multiTargetMs` is band 2
	 * *alone*, so its exempt time is the add waves the graph shades **plus** every stretch at one enemy —
	 * and neither existing chart may shade that floor, because band 1 is fully counted for the primary dot
	 * and for the totem. A reader comparing the tile against the graph sees the ceiling shaded and nothing
	 * for the floor, so the floor is stated in copy instead. This asserts it is stated wherever the tile is.
	 */
	it('says how much of the pull the second dot is measured over, wherever the tile appears', () => {
		for (const [name, analysis] of [
			['allAoe', allAoe],
			['cleave', cleave],
		] as const) {
			const html = render(analysis);
			expect(html, name).toContain('only the stretches where exactly two enemies were up');
			expect(html, name).toContain('no shaded stretch on the graph for its floor');
		}
		// And nowhere else: a pull with no second target is not owed an explanation of the second dot's clock.
		expect(render(unbroken)).not.toContain('only the stretches where exactly two enemies were up');
	});

	/**
	 * On `allAoe` the note is the *only* thing that explains the tile, which is the case the gate had to get
	 * right: it is band 3+ from the start, so the graph's grey covers the whole pull and the floor never
	 * appears — and on a pull that never exceeded two enemies there would be no grey at all. Gating this note
	 * on the add waves rather than on the tile would have lost it on exactly those pulls.
	 */
	it('is gated with the tile and not with the add waves', () => {
		expect(unbroken.lightningShield.exemptWindows).toEqual([]); // no add waves and no tile: no note
		expect(render(unbroken)).not.toContain('no shaded stretch on the graph for its floor');
	});
});
