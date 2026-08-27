// A window says an aura was up; it does not say how many presses kept it there.
//
// `auraWindows` opens on an apply and closes on a remove, and a refresh landing on a live aura is
// discarded outright — deliberately, because the window is a coverage claim and counting refreshes would
// break it. The cost is that an aura held across a phase draws as one unbroken bar. Elemental Discharge
// is the case that asked for `AuraLane.applications`: on `XJ83wN9h1GQqP4tY` fight 16 this player's debuff
// draws 38.9 seconds of bar over three applications, and nothing on the page told them apart.
//
// This asserts the data path only — that the timestamps reach the lane, sourced to this player and scoped
// to the enemy the lane draws. Where `LanesTimeline` puts the icon is ApexCharts' own placement and is not
// something a unit test can stand behind.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';
import { rawFixtures } from '~/lib/analysis/fixtures';

import { analyse } from '../index';

const fx = (name: string): Analysis & ElementalAuditResult =>
	analyse(
		JSON.parse(readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8')) as FightDataset,
	) as Analysis & ElementalAuditResult;

const laneOf = (el: Analysis & ElementalAuditResult, key: string) =>
	el.timeline?.lanes?.find((lane) => lane.key === key);

describe('a lane carries the presses that paid for its windows', () => {
	/**
	 * The premise and the point in one pull: more applications than windows.
	 *
	 * `unbroken` holds this debuff over five drawn windows, and the player bought it thirteen times. If
	 * the two counts were equal the field would be telling a reader nothing they could not already see.
	 */
	it('records more Elemental Discharge applications than the debuff has windows', () => {
		const lane = laneOf(fx('unbroken'), 't16-2pc-debuff');
		expect(lane?.windows).toHaveLength(5);
		expect((lane?.applications ?? []).length).toBeGreaterThan(lane?.windows.length ?? 0);
	});

	/** Sorted, unique, and inside the pull — the three things a chart may assume of them. */
	it('hands the chart clean timestamps on every committed pull', () => {
		for (const { name: file } of rawFixtures('elemental')) {
			const el = fx(file.replace(/\.json$/, ''));
			for (const lane of el.timeline?.lanes ?? []) {
				const applications = lane.applications;
				if (applications === undefined) continue;
				const label = `${file} ${lane.key}`;
				expect(
					[...applications].sort((a, b) => a - b),
					label,
				).toEqual(applications);
				expect(new Set(applications).size, label).toBe(applications.length);
				for (const t of applications) {
					expect(t, label).toBeGreaterThanOrEqual(0);
					expect(t, label).toBeLessThanOrEqual(el.durationMs);
				}
			}
		}
	});

	/**
	 * Every application sits inside a window of its own lane.
	 *
	 * The guard against the walk drifting from the one that draws the bars — a mark outside every bar is a
	 * mark a reader cannot attach to anything. A refresh opens no window, so the reverse does not hold and
	 * is not asserted: that asymmetry is the whole reason the field exists.
	 */
	it('puts every mark inside a window the same lane drew', () => {
		for (const { name: file } of rawFixtures('elemental')) {
			const el = fx(file.replace(/\.json$/, ''));
			for (const lane of el.timeline?.lanes ?? []) {
				for (const t of lane.applications ?? []) {
					const inside = lane.windows.some((w) => t >= w.start && t <= w.end);
					expect(inside, `${file} ${lane.key} @ ${t}`).toBe(true);
				}
			}
		}
	});
});
