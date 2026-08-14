// `createElement` rather than JSX so this stays a `.ts` file and is picked up by the project's own
// vitest include patterns — the same reason the other render tests here are written that way.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Analysis, CastTimeline as Timeline } from '~/lib/types';

import { formatClock } from '~/lib/format';
import i18n, { initI18n } from '~/lib/i18n/config';

import CastLog from '../../sections/CastLog';
import CastTimeline from '../CastTimeline';

initI18n();
const t = i18n.getFixedT('en', 'report');

/**
 * A report from before the timeline existed, built by stripping the field rather than by relying on
 * a fixture that happens to predate it.
 *
 * The fixture was that report until it was re-captured, at which point the test asserting the field
 * was absent started failing — it had been pinning the age of a file rather than the behaviour. The
 * behaviour is the thing worth keeping: a reader holding an older analysis must still get an empty
 * state instead of a crash. `delete` reproduces exactly what `JSON.parse` yields for a missing key,
 * which is `undefined` and not `null` — the distinction this codebase has been bitten by twice.
 */
const captured: Analysis = (() => {
	const parsed: Analysis = JSON.parse(
		readFileSync(resolve(import.meta.dirname, '../../../lib/__fixtures__/strong.json'), 'utf8'),
	);
	const older: Partial<Analysis> = { ...parsed };
	delete older.timeline;
	return older as Analysis;
})();

const timeline: Timeline = {
	casts: [
		{ t: 1000, id: 107428, name: 'Rising Sun Kick', onGcd: true },
		{ t: 5000, id: 100787, name: 'Tiger Palm', onGcd: true },
		// Off-GCD, and drawn smaller for it.
		{ t: 30000, id: 1247275, name: 'Tigereye Brew', onGcd: false },
		// Nothing in the generated icon map answers for this one.
		{ t: 60000, id: 999999, name: 'Something unmapped', onGcd: false },
	],
	lanes: [
		{
			key: 're-origination',
			name: 'Re-Origination',
			id: 139120,
			group: 'proc',
			windows: [{ start: 20000, end: 30000 }],
		},
		{
			key: 'tigereye-brew',
			name: 'Tigereye Brew',
			id: 1247275,
			group: 'buff',
			windows: [{ start: 30000, end: 45000 }],
		},
		{
			key: 'rising-sun-kick-debuff',
			name: 'Rising Sun Kick (debuff)',
			id: 130320,
			group: 'debuff',
			windows: [{ start: 1000, end: 120000 }],
		},
	],
};

const drawn: Analysis = { ...captured, timeline };

const render = (analysis: Analysis, Component = CastTimeline) =>
	renderToStaticMarkup(createElement(Component, { analysis }));

describe('CastTimeline', () => {
	it('draws one icon per press, at its own point on the clock', () => {
		const html = render(drawn);
		// Tiger Palm's icon, from the generated map — not a placeholder and not the spell id.
		expect(html).toContain('ability_monk_tigerpalm');
		expect(html).toContain('ability_monk_risingsunkick');
		// A percentage of the pull, which is what lets a zoom step move every mark by changing one
		// number on the track rather than several hundred inline styles.
		expect(html).toContain(`left:${(5000 / captured.durationMs) * 100}%`);
	});

	/** An id with no icon still has to occupy its moment: a hole reads as a global nobody spent. */
	it('draws a press it has no icon for rather than dropping it', () => {
		const html = render(drawn);
		// The tick is the assertion. A count of `<img>` was the original test and it was brittle for the
		// wrong reason: the presses are now grouped into a lane per ability, so every lane carries a
		// label icon too, and the total moves whenever the layout does without the behaviour changing.
		expect(html.match(/w-\[3px\]/g) ?? []).toHaveLength(1);
		// The three the map does answer for are still drawn, each by its own icon rather than a tick.
		for (const icon of ['ability_monk_risingsunkick', 'ability_monk_tigerpalm']) {
			expect(html).toContain(icon);
		}
	});

	/**
	 * Grouping by ability is what makes vertical position mean something: one row is one button, so a
	 * gap in a row is that button not being pressed. Packed rows alone put the same spell on whichever
	 * line happened to be free, which read as noise.
	 */
	it('gives each ability its own labelled row', () => {
		const html = render(drawn);
		for (const name of new Set(timeline.casts.map((c) => c.name))) {
			expect(html, name).toContain(name);
		}
	});

	it('names every lane beside its row', () => {
		const html = render(drawn);
		for (const lane of timeline.lanes) expect(html, lane.key).toContain(lane.name);
	});

	/** The toggles are real buttons with a pressed state, not styled divs. */
	it('offers a toggle per category the pull actually has', () => {
		const html = render(drawn);
		for (const key of ['casts', 'buffs', 'procs', 'debuffs']) {
			expect(html, key).toContain(t(`castLog.groups.${key}`));
		}
		expect(html.match(/aria-pressed="true"/g) ?? []).toHaveLength(4);
	});

	/** The text alternative, which is the only thing a screen reader gets from a wall of icons. */
	it('summarises itself for a reader who cannot see it', () => {
		const summary = t('castLog.aria', {
			duration: formatClock(captured.durationMs),
			casts: timeline.casts.length,
			abilities: timeline.casts.length,
			lanes: timeline.lanes.length,
		});
		expect(summary).not.toContain('castLog');
		expect(render(drawn)).toContain(`role="img" aria-label="${summary}"`);
	});

	/**
	 * The bug this codebase has already been bitten by: a fixture is `JSON.parse(...) as Analysis`, so
	 * a field added after it was captured arrives as `undefined` rather than as an empty value.
	 */
	it('shows an empty state for a report captured before the field existed', () => {
		expect(captured.timeline).toBeUndefined();
		// The fixture it is derived from does carry one, so this is testing the guard and not the file.
		expect(() => render(captured)).not.toThrow();
		expect(render(captured)).toContain(t('castLog.empty'));
	});
});

describe('CastLog', () => {
	it('offers a real button to open the timeline full width', () => {
		const html = render(drawn, CastLog);
		expect(html).toContain(t('castLog.title'));
		expect(html).toContain(t('castLog.expand'));
		// A `<button>`, so it is focusable and operable without anything being re-implemented here.
		expect(html).toMatch(/<button[^>]*>[^<]*Open full width/);
	});

	/** The dialog's copy of the timeline is not in the document until it is opened. */
	it('does not mount a second timeline while the dialog is closed', () => {
		expect((render(drawn, CastLog).match(/aria-pressed="true"/g) ?? []).length).toBe(4);
	});

	it('renders without a trigger, and without throwing, when there is no timeline', () => {
		const html = render(captured, CastLog);
		expect(html).toContain(t('castLog.empty'));
		expect(html).not.toContain(t('castLog.expand'));
	});
});
