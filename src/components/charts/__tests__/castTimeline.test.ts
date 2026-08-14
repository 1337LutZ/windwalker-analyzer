// `createElement` rather than JSX so this stays a `.ts` file and is picked up by the project's own
// vitest include patterns — the same reason the other render tests here are written that way.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Analysis, AuraLane, CastTimeline as Timeline } from '~/lib/types';

import { formatClock } from '~/lib/format';
import i18n, { initI18n } from '~/lib/i18n/config';

import CastLog from '../../sections/CastLog';
import CastTimeline, { collapseTargets, perTargetBlock } from '../CastTimeline';

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

/**
 * How many rows are labelled with exactly this name.
 *
 * The gutter writes a row's name into the label's own `title` as well as its text, and nothing else
 * on the chart ends a `title` there — a mark's reads `Tiger Palm · 0:05` and a bar's carries both
 * ends of its window — so this counts rows and not marks. Which is the question the merge asks: a
 * button and the aura it applies used to be two of these and are now one.
 */
const labelled = (html: string, name: string) => (html.match(new RegExp(`title="${name}">`, 'g')) ?? []).length;

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
	 *
	 * Which row a button ends up on is a separate question now that a press can be drawn on the row of
	 * the aura it applies — that is the block at the bottom of this file. What is asserted here is only
	 * that every button the pull pressed is named somewhere, which holds either way.
	 */
	it('names every ability it drew a press for', () => {
		const html = render(drawn);
		for (const name of new Set(timeline.casts.map((c) => c.name))) {
			expect(html, name).toContain(name);
		}
	});

	/**
	 * The tooltip is one shared node for the whole chart, moved to the pointer and filled from a hit
	 * test, so what a mark has to carry is its content — as attributes, which are not elements. The
	 * `title` stays beside them: it is the fallback for a reader whose pointer never fires, and it is
	 * what the styled tip is built to replace on screen rather than in the markup.
	 */
	it('carries each mark’s tooltip as attributes, and keeps the title beside it', () => {
		const html = render(drawn);
		expect(html).toContain('data-tip="Tiger Palm"');
		expect(html).toContain(`data-tip-at="${formatClock(5000)}"`);
		expect(html).toContain(`title="Tiger Palm · ${formatClock(5000)}"`);
		// A window carries both its ends, which is what the bar's own `title` has always said.
		expect(html).toContain('data-tip="Re-Origination"');
		expect(html).toContain(`data-tip-from="${formatClock(20000)}"`);
		expect(html).toContain(`data-tip-to="${formatClock(30000)}"`);
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

/**
 * An add pull, where the debuff is on several enemies at once.
 *
 * None of the committed fixtures is one — they are all single-target — so the lanes are built by hand,
 * in the shape the engine emits them: one per enemy, sharing the aura's key and differing only by
 * `target`, primary first.
 */
describe('CastTimeline, per-target debuff lanes', () => {
	const debuffLane = (id: number, name: string | null, primary: boolean, start: number) => ({
		key: 'rising-sun-kick-debuff',
		name: 'Rising Sun Kick (debuff)',
		id: 130320,
		group: 'debuff' as const,
		windows: [{ start, end: start + 10000 }],
		target: { id, name, primary },
	});

	const adds: Analysis = {
		...captured,
		timeline: {
			casts: timeline.casts,
			lanes: [
				timeline.lanes[0]!,
				debuffLane(20, 'Iron Juggernaut', true, 1000),
				debuffLane(21, 'Siege Engineer', false, 20000),
				// The enemy the report's actor list could not name.
				debuffLane(22, null, false, 40000),
			],
			hiddenTargets: 3,
		},
	};

	it('heads each enemy’s lanes with the enemy', () => {
		const html = render(adds);
		expect(html).toContain('Iron Juggernaut');
		expect(html).toContain('Siege Engineer');
	});

	/** A lane the report cannot name says so. Any name printed here would be a different enemy's. */
	it('labels an unnamed enemy by its id rather than inventing a name', () => {
		expect(render(adds)).toContain(t('castLog.target.unnamed', { id: 22 }));
	});

	/** Several lanes and one graded number: the reader has to be told which lane the number is about. */
	it('marks which enemy the graded uptime belongs to', () => {
		expect(render(adds)).toContain(t('castLog.target.primary'));
	});

	/** A chart that draws six of nine enemies and says nothing is claiming the pull had six. */
	it('says how many enemies the cap left out', () => {
		expect(render(adds)).toContain(t('castLog.hiddenTargets', { count: 3 }));
	});

	/**
	 * On a single-target pull a heading would spend a row repeating the boss's name — which the report
	 * header already says — and every reference pull is single-target, so that is the common case.
	 */
	it('draws no heading, and no note, when the debuff was on one enemy', () => {
		const one: Analysis = {
			...captured,
			timeline: { casts: timeline.casts, lanes: [timeline.lanes[0]!, debuffLane(20, 'Iron Juggernaut', true, 1000)] },
		};
		const html = render(one);
		expect(html).not.toContain('Iron Juggernaut');
		expect(html).not.toContain(t('castLog.hiddenTargets', { count: 1 }));
	});

	/**
	 * The one relationship the merge refuses, and the reason it is drawn from the lane count rather
	 * than from `appliedBy` alone: the press stream says a Rising Sun Kick went out, never which enemy
	 * it landed on. Drawn on all three rows it would claim each press hit all three, so the button
	 * keeps a lane of its own and the debuff rows stay bars.
	 */
	it('leaves the button its own lane when the debuff is on several enemies', () => {
		const html = render(adds);
		expect(labelled(html, 'Rising Sun Kick')).toBe(1);
		expect(html).not.toContain(
			t('castLog.mergedLane', { ability: 'Rising Sun Kick', aura: 'Rising Sun Kick (debuff)' }),
		);
	});
});

/**
 * One ability, one row.
 *
 * A press and the aura it puts up were two rows saying one thing, five lanes apart, and the reader
 * had to find the pair before they could read either. The pairing is not written here and is not
 * written in the chart: `Aura.appliedBy` in the game model already names the button that applies each
 * aura, so a new aura merges without either file learning a spell id — which is what these lanes
 * exercise, since not one of them is named in the component.
 */
describe('CastTimeline, presses merged into the row they open', () => {
	const auraLane = (key: string, name: string, id: number, group: 'buff' | 'proc', start: number) => ({
		key,
		name,
		id,
		group,
		windows: [{ start, end: start + 10000 }],
	});

	const merged: Analysis = {
		...captured,
		timeline: {
			casts: [
				{ t: 1000, id: 100787, name: 'Tiger Palm', onGcd: true },
				{ t: 5000, id: 1247275, name: 'Tigereye Brew', onGcd: false },
				// Applies nothing that went up on this pull, so it has no row to join.
				{ t: 9000, id: 100780, name: 'Jab', onGcd: true },
			],
			lanes: [
				auraLane('tiger-power', 'Tiger Power', 125359, 'buff', 1000),
				// Tiger Palm *consumes* this one, which is the relationship that must not merge.
				auraLane('combo-breaker-tiger-palm', 'Combo Breaker: Tiger Palm', 118864, 'proc', 4000),
				auraLane('tigereye-brew', 'Tigereye Brew', 1247275, 'buff', 5000),
			],
		},
	};

	/** The ability leads the label, because the row is a button now and the button is what is scanned for. */
	it('draws the press on the row of the aura it applies, named for the button', () => {
		const html = render(merged);
		expect(html).toContain(t('castLog.mergedLane', { ability: 'Tiger Palm', aura: 'Tiger Power' }));
		expect(labelled(html, 'Tiger Palm')).toBe(0);
	});

	/** Both brews are named for their own buff, and a row that said it twice would only be noise. */
	it('says the name once when the button and the aura share it', () => {
		expect(labelled(render(merged), 'Tigereye Brew')).toBe(1);
	});

	/**
	 * `consumedBy` is the asymmetry, and it is deliberately not read. Most Tiger Palms spend no Combo
	 * Breaker at all, so drawing every press on the proc's row would claim a consumption in every
	 * stretch where nothing was ever up — and Tiger Palm applies Tiger Power as well, so the same press
	 * would have two rows and no reason to prefer either.
	 */
	it('leaves a proc a press only consumes on its own row', () => {
		const html = render(merged);
		expect(labelled(html, 'Combo Breaker: Tiger Palm')).toBe(1);
		expect(html).not.toContain(t('castLog.mergedLane', { ability: 'Tiger Palm', aura: 'Combo Breaker: Tiger Palm' }));
	});

	/** A button whose aura never went up has no row to join, so it keeps the one it had. */
	it('keeps a press with no aura on this pull in a lane of its own', () => {
		expect(labelled(render(merged), 'Jab')).toBe(1);
	});
});

/**
 * Where the per-enemy rows sit, which is a rule and not the order the engine happened to emit them.
 *
 * The lanes below are handed over *debuff first* on purpose: the engine emits them last, so a chart
 * that merely preserved engine order would pass a test built the other way round and fail nothing the
 * day either array changed.
 */
describe('CastTimeline, the per-enemy block at the foot of the chart', () => {
	/** Where a row's own label first appears, which is the order the gutter draws them in. */
	const at = (html: string, name: string) => html.indexOf(`title="${name}"`);

	const sunk: Analysis = {
		...captured,
		timeline: {
			casts: [
				// Auto-attacks, which the aura rows sit directly under — so the Rising Sun Kick lane below
				// lands in the block of presses drawn *after* them, which is the block the enemies must clear.
				{ t: 1000, id: 1, name: 'Melee', onGcd: false },
				{ t: 2000, id: 107428, name: 'Rising Sun Kick', onGcd: true },
			],
			lanes: [
				{
					key: 'rising-sun-kick-debuff',
					name: 'Rising Sun Kick (debuff)',
					id: 130320,
					group: 'debuff',
					windows: [{ start: 1000, end: 20000 }],
					target: { id: 20, name: 'Iron Juggernaut', primary: true },
				},
				{
					key: 'rising-sun-kick-debuff',
					name: 'Rising Sun Kick (debuff)',
					id: 130320,
					group: 'debuff',
					windows: [{ start: 30000, end: 40000 }],
					target: { id: 21, name: 'Siege Engineer', primary: false },
				},
				timeline.lanes[0]!,
				timeline.lanes[1]!,
			],
		},
	};

	it('draws the debuff rows below every buff and proc row', () => {
		const html = render(sunk);
		expect(at(html, 'Rising Sun Kick (debuff)')).toBeGreaterThan(at(html, 'Re-Origination'));
		expect(at(html, 'Rising Sun Kick (debuff)')).toBeGreaterThan(at(html, 'Tigereye Brew'));
	});

	/**
	 * And below the presses too, which sorting the lanes alone could never have done: the buttons that
	 * follow melee are drawn under the aura rows, and they are the player's rows as much as the buffs
	 * are. The chart reads resources, then the player, then the enemies.
	 */
	it('draws them below the player’s own press lanes as well', () => {
		const html = render(sunk);
		expect(at(html, 'Rising Sun Kick (debuff)')).toBeGreaterThan(at(html, 'Rising Sun Kick'));
		expect(at(html, 'Iron Juggernaut')).toBeGreaterThan(at(html, 'Rising Sun Kick'));
	});

	/** The heading belongs to the block and goes down with it, not to the lane above it. */
	it('takes the target headings down with the rows', () => {
		const html = render(sunk);
		expect(at(html, 'Iron Juggernaut')).toBeGreaterThan(at(html, 'Tigereye Brew'));
		expect(at(html, 'Siege Engineer')).toBeGreaterThan(at(html, 'Iron Juggernaut'));
	});

	it('sinks a lane for carrying a target or for being the debuff, and nothing else', () => {
		const lane = (group: AuraLane['group'], target?: AuraLane['target']): AuraLane => ({
			key: 'k',
			name: 'n',
			id: 1,
			group,
			windows: [],
			target,
		});
		expect(perTargetBlock(lane('debuff'))).toBe(true);
		expect(perTargetBlock(lane('debuff', { id: 20, name: null, primary: true }))).toBe(true);
		expect(perTargetBlock(lane('buff'))).toBe(false);
		expect(perTargetBlock(lane('proc'))).toBe(false);
	});
});

/**
 * Collapsing the per-enemy rows into one.
 *
 * The override is view state with no prop behind it and a static render cannot press a button, so
 * what is exercised here is the function the button calls. The claim it makes is the thing worth
 * pinning: a union of several enemies' windows says the debuff was on *something*, which is weaker
 * than any row it replaces and is not the number `debuff.engagedUptimePct` grades.
 */
describe('CastTimeline, collapsing the per-target lanes', () => {
	const named = (aura: string) => t('castLog.target.mergedLane', { aura });
	const on = (id: number, start: number, end: number): AuraLane => ({
		key: 'rising-sun-kick-debuff',
		name: 'Rising Sun Kick (debuff)',
		id: 130320,
		group: 'debuff',
		windows: [{ start, end }],
		target: { id, name: `Add ${id}`, primary: id === 20 },
	});

	it('unions the enemies’ windows into one row', () => {
		const [row, ...rest] = collapseTargets([on(20, 0, 10000), on(21, 5000, 20000), on(22, 40000, 50000)], named);
		expect(rest).toEqual([]);
		// Two overlapping windows are one bar and the disjoint one stays its own: the row says where the
		// debuff was on at least one enemy, which is coverage and not any enemy's uptime.
		expect(row?.windows).toEqual([
			{ start: 0, end: 20000 },
			{ start: 40000, end: 50000 },
		]);
	});

	/** The row has stopped naming an enemy, and its label has to stop implying one. */
	it('renames the row so it cannot be read as one enemy’s', () => {
		expect(collapseTargets([on(20, 0, 1000), on(21, 2000, 3000)], named)[0]?.name).toBe(
			t('castLog.target.mergedLane', { aura: 'Rising Sun Kick (debuff)' }),
		);
	});

	/**
	 * A key of its own, which is what keeps the press stream off the row: which enemy a Rising Sun Kick
	 * landed on is exactly what this row has stopped saying, so every press drawn on it would be a
	 * claim it cannot support. It also keeps React from reconciling it with the rows it replaced.
	 */
	it('takes a key of its own rather than the aura’s', () => {
		const [row] = collapseTargets([on(20, 0, 1000), on(21, 2000, 3000)], named);
		expect(row?.key).not.toBe('rising-sun-kick-debuff');
		expect(row?.target).toBeUndefined();
		expect(row?.group).toBe('debuff');
	});

	/** One enemy is not a group: the row already says exactly what it means, and every fixture is this. */
	it('leaves a single enemy’s row exactly as it was', () => {
		const one = [on(20, 0, 1000)];
		expect(collapseTargets(one, named)).toEqual(one);
	});

	it('leaves the buffs and procs alone', () => {
		const buffs = [timeline.lanes[0]!, timeline.lanes[1]!];
		expect(collapseTargets(buffs, named)).toEqual(buffs);
	});
});

/**
 * The two things on the chart that are not presses and not auras.
 *
 * Both were already in the data — the intermission is the complement of `debuff.engagedSegments` and
 * the deaths are events the fetch already returned — so neither costs a request.
 */
describe('CastTimeline, intermissions and deaths', () => {
	it('shades the stretches the boss was out of reach, and says so', () => {
		// The reference pull goes untargetable twice, so the fixture's own segments are the case.
		const html = render(drawn);
		expect(html).toContain(`data-tip="${t('castLog.intermission.title')}"`);
		expect(html).toContain(t('castLog.intermission.note'));
	});

	/** Nothing to shade on a pull that never lost contact, and no sentence about shading either. */
	it('shades nothing on a pull with no intermission', () => {
		const unbroken: Analysis = {
			...drawn,
			debuff: { ...captured.debuff, engagedSegments: [[0, captured.durationMs]] },
		};
		const html = render(unbroken);
		expect(html).not.toContain(`data-tip="${t('castLog.intermission.title')}"`);
		expect(html).not.toContain(t('castLog.intermission.note'));
	});

	const died: Analysis = {
		...drawn,
		debuff: { ...captured.debuff, engagedSegments: [[0, captured.durationMs]] },
		timeline: {
			...timeline,
			deaths: [
				{ t: 61000, abilityId: 146743, ability: 'Iron Star' },
				// The log named nothing: a fall, an enrage, a wipe.
				{ t: 90000, abilityId: null, ability: null },
			],
		},
	};

	it('marks each death, and names what landed the blow', () => {
		const html = render(died);
		expect(html).toContain(`data-tip="${t('castLog.death.title')}"`);
		expect(html).toContain(`data-tip-at="${formatClock(61000)}"`);
		expect(html).toContain('data-tip-by="Iron Star"');
		expect(html).toContain(t('castLog.death.note'));
	});

	/** An id the log never gave is said in words rather than left as an empty row in the tooltip. */
	it('says so plainly when nothing named the killing blow', () => {
		expect(render(died)).toContain(`data-tip-by="${t('castLog.death.unnamed')}"`);
	});

	/** The common case: no marks, and no sentence about marks that are not there. */
	it('marks nothing on a pull nobody died on', () => {
		const html = render(drawn);
		expect(html).not.toContain(`data-tip="${t('castLog.death.title')}"`);
		expect(html).not.toContain(t('castLog.death.note'));
	});
});
