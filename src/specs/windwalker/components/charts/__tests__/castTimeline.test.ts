// `createElement` rather than JSX so this stays a `.ts` file and is picked up by the project's own
// vitest include patterns — the same reason the other render tests here are written that way.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { AuraWindow } from '~/lib/analysis/auras';
import type { Analysis, AuraLane, CastMark, CastTimeline as Timeline } from '~/lib/types';

import { formatClock, formatGap, formatStamp } from '~/lib/format';
import i18n, { initI18n } from '~/lib/i18n/config';

import CastLog from '~/components/sections/CastLog';
import CastTimeline from '~/components/charts/CastTimeline';
import { tip, type ChartTheme } from '~/components/charts/apex';
import { collapseTargets, perTargetBlock } from '~/components/charts/targetLanes';
import { HIDDEN_AURAS, HIDDEN_CASTS } from '~/components/charts/hidden';
import { spellIconUrl } from '~/components/primitives/spellIcon';
import { SpecContext } from '~/components/report/specContext';
import { getSpec } from '~/lib/spec';

// The fixtures here are Windwalker pulls, and `CastTimeline` reads its banks and its scoring off the
// spec. Named rather than left to `SpecContext`'s default, which is the build's pinned `DEFAULT_SPEC`
// — under `PUBLIC_SPEC=elemental` that drew a monk pull with the Shaman's banks.
const WINDWALKER_SPEC = getSpec('windwalker')!;
const asWindwalker = (node: ReactNode): ReactElement =>
	createElement(SpecContext.Provider, { value: WINDWALKER_SPEC }, node);

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
		readFileSync(resolve(import.meta.dirname, '../../../__fixtures__/strong.json'), 'utf8'),
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

const drawn: Analysis = {
	...captured,
	timeline: { ...timeline, hasteWindows: captured.energizing?.hasteWindows ?? [], berserkingWindows: [] },
};

const render = (analysis: Analysis, Component = CastTimeline) =>
	renderToStaticMarkup(asWindwalker(createElement(Component, { analysis })));

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
		expect(html).toContain(`data-tip-at="${formatStamp(5000)}"`);
		expect(html).toContain(`title="Tiger Palm · ${formatStamp(5000)}"`);
		// A window carries both its ends, which is what the bar's own `title` has always said.
		expect(html).toContain('data-tip="Re-Origination"');
		expect(html).toContain(`data-tip-from="${formatStamp(20000)}"`);
		expect(html).toContain(`data-tip-to="${formatStamp(30000)}"`);
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
				// The defensive, whose shield the engine now measures — so the row is the window rather
				// than the instant it was bought at.
				{ t: 20000, id: 122470, name: 'Touch of Karma', onGcd: true },
			],
			lanes: [
				auraLane('tiger-power', 'Tiger Power', 125359, 'buff', 1000),
				// Tiger Palm *consumes* this one, which is the relationship that must not merge.
				auraLane('combo-breaker-tiger-palm', 'Combo Breaker: Tiger Palm', 118864, 'proc', 4000),
				auraLane('tigereye-brew', 'Tigereye Brew', 1247275, 'buff', 5000),
				auraLane('touch-of-karma', 'Touch of Karma', 122470, 'buff', 20000),
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

	/**
	 * Touch of Karma is the case the merge was extended for: the press was on the chart and the ten
	 * seconds it bought were not, so a reader could see one went out and not what it overlapped.
	 *
	 * One row, named once — the button and the shield share a name — carrying both the bar and the
	 * mark. Both halves are asserted because either alone would pass with the other missing: a row with
	 * no bar is the press lane it already was, and a row with no mark is a bar nobody can see the cause
	 * of.
	 */
	it('draws the defensive as the window it ran for, with the press on it', () => {
		const html = render(merged);
		expect(labelled(html, 'Touch of Karma')).toBe(1);
		expect(html).toContain(`data-tip-from="${formatStamp(20000)}"`);
		expect(html).toContain(`title="Touch of Karma · ${formatStamp(20000)}"`);
	});
});

/**
 * Which press lane sits above which, inside the player's own rows.
 *
 * Press count alone is a count of keystrokes: a utility button is pressed whenever the fight asks for
 * it and a damaging global is pressed on a cooldown, so Roll, Synapse Springs and a Healthstone all
 * sorted above Fists of Fury on the reference pulls. The reader scans this chart top-down for their
 * rotation, so damage comes first, then the kit, then everything the fight asked for.
 *
 * Nothing below names a spell to the chart. Which presses did damage is read off `damage.abilities` —
 * the pull's own table, which is why the fixture is the one supplying it — and which are the kit is
 * read off `Ability.onUse` in the spec model, so an ability the report has never heard of sorts
 * correctly the first time somebody presses it and a consumable sorts correctly the day it is added.
 */
describe('CastTimeline, damaging presses above the rest', () => {
	/** Where a row's own label first appears, which is the order the gutter draws them in. */
	const at = (html: string, name: string) => html.indexOf(`title="${name}"`);

	const scan: Analysis = {
		...captured,
		timeline: {
			casts: [
				// The metronome the aura rows are drawn directly under.
				{ t: 1000, id: 1, name: 'Melee', onGcd: false },
				// Pressed six times, and not one of them did anything to anybody.
				...[2000, 3000, 4000, 5000, 6000, 7000].map((t) => ({ t, id: 109132, name: 'Roll', onGcd: false })),
				// Pressed once, and worth four seconds of the pull's damage.
				{ t: 20000, id: 113656, name: 'Fists of Fury', onGcd: true },
				// In the damage table and still not a rotation press: the model marks it `utility`, which is
				// the distinction being read here rather than one this test re-decides.
				{ t: 30000, id: 101545, name: 'Flying Serpent Kick', onGcd: true },
				// The kit. Pressed once, does no damage at all, and the model marks it `onUse` — which is
				// the whole difference between it and the Roll above. The Healthstone is the one consumable
				// with no aura to be merged onto, so it is the one that stays a press lane whatever else the
				// pull put up, which is what makes it the honest fixture for a tier about press lanes.
				{ t: 8000, id: 6262, name: 'Healthstone', onGcd: false },
				// The two merged rows, one on each side of the split. Tiger Palm is in the damage table and
				// puts up an aura nobody ranked; Tigereye Brew does no damage at all and puts up one that is
				// first but for Re-Origination. Between them they are the whole question of what a row that
				// is both a press and an aura sorts on.
				{ t: 12000, id: 100787, name: 'Tiger Palm', onGcd: true },
				{ t: 14000, id: 1247275, name: 'Tigereye Brew', onGcd: false },
			],
			lanes: [
				// Ranked, so pinned under melee — the row every assertion about the top of the chart is
				// written against.
				timeline.lanes[0]!,
				{
					key: 'tigereye-brew',
					name: 'Tigereye Brew',
					id: 1247275,
					group: 'buff' as const,
					windows: [{ start: 14000, end: 29000 }],
				},
				// Unranked auras, and both kinds of it: one with a press merged onto it and one with nothing
				// but bars. Neither aura's own name is in `ROW_ORDER` — Tiger Power's row is found there by
				// the button on it, and Tiger Strikes is not found there at all.
				{
					key: 'tiger-power',
					name: 'Tiger Power',
					id: 125359,
					group: 'buff' as const,
					windows: [{ start: 12000, end: 32000 }],
				},
				{
					key: 'tiger-strikes',
					name: 'Tiger Strikes',
					id: 120273,
					group: 'buff' as const,
					windows: [{ start: 40000, end: 48000 }],
				},
			],
		},
	};

	it('draws a damaging press above one that was pressed six times as often', () => {
		const html = render(scan);
		expect(at(html, 'Fists of Fury')).toBeLessThan(at(html, 'Roll'));
	});

	/** The one case a damage total gets wrong, and the model already answers it. */
	it('sinks a movement button that happens to hit', () => {
		const html = render(scan);
		expect(at(html, 'Flying Serpent Kick')).toBeGreaterThan(at(html, 'Fists of Fury'));
		// And below Roll, because press count still orders the lanes inside one tier — both of these are
		// in the last one, and Roll was pressed six times to the kick's once.
		expect(at(html, 'Flying Serpent Kick')).toBeGreaterThan(at(html, 'Roll'));
	});

	/**
	 * The middle tier, which is the whole reason the sort is a rank rather than a boolean.
	 *
	 * Both halves are asserted because either alone would pass with the tier missing: a Healthstone
	 * that did no damage already sinks below Fists of Fury without it, and one pressed more often than
	 * Roll would already sit above Roll. It is the pair — below the rotation *and* above the fight's
	 * own buttons, while being pressed a sixth as often as one of them — that only three tiers give.
	 */
	it('lands the kit between the rotation and the buttons the fight asked for', () => {
		const html = render(scan);
		expect(at(html, 'Healthstone')).toBeGreaterThan(at(html, 'Fists of Fury'));
		expect(at(html, 'Healthstone')).toBeLessThan(at(html, 'Roll'));
	});

	/**
	 * Auto-attacks were the judgement call: not a press, but damage, and the table says so. Counting
	 * them as damaging is what keeps the aura rows where they are drawn on purpose — directly under
	 * melee, so a buff window is read against a continuous line rather than against a lane with holes.
	 *
	 * Melee is the first entry of `ROW_ORDER` rather than wherever press count happened to put it, and
	 * the rows the order names follow it. That is the half of the arrangement that was measured, and
	 * the half this asserts.
	 */
	it('keeps melee at the top, with the named aura rows still directly under it', () => {
		const html = render(scan);
		expect(at(html, 'Melee')).toBeLessThan(at(html, 'Fists of Fury'));
		expect(at(html, 'Re-Origination')).toBeGreaterThan(at(html, 'Melee'));
		expect(at(html, 'Re-Origination')).toBeLessThan(at(html, 'Fists of Fury'));
	});

	/**
	 * The rows nobody ranked, which is every item proc a character happens to be wearing.
	 *
	 * Being an aura is not by itself a claim on the top of the chart. `ROW_ORDER` is a sequence
	 * somebody decided — what the pull is worth, the brew that snapshots it, the procs that free a
	 * button — and melee is the ruler that sequence is read against; a trinket proc makes no such
	 * claim, so it is drawn where the ask puts it instead: below every damaging press and above
	 * everything that is not one.
	 *
	 * Both halves again, and for the same reason the kit needed both: below the damage alone would
	 * pass with the row simply sunk to the foot of the chart, and above the kit alone would pass with
	 * it left where it used to be, three rows from the top.
	 */
	it('lands an aura nobody ranked below the damage and above the kit', () => {
		const html = render(scan);
		expect(at(html, 'Tiger Strikes')).toBeGreaterThan(at(html, 'Fists of Fury'));
		expect(at(html, 'Tiger Strikes')).toBeLessThan(at(html, 'Healthstone'));
		expect(at(html, 'Tiger Strikes')).toBeLessThan(at(html, 'Roll'));
	});

	/**
	 * And the runs in one line, which is the interleaving the whole arrangement is about: the rows the
	 * order names, then the rest of the damage, then the auras nobody named. Neither block can drift
	 * past the presses between them without this failing.
	 */
	it('threads the unnamed damaging presses between the two aura blocks', () => {
		const html = render(scan);
		expect(at(html, 'Re-Origination')).toBeLessThan(at(html, 'Fists of Fury'));
		expect(at(html, 'Fists of Fury')).toBeLessThan(at(html, 'Tiger Strikes'));
	});

	/**
	 * A merged row answers to the declared order by *either* of its names, and these two are the pair
	 * that pins it — each of them sorted the wrong way by the tier its press sits in.
	 *
	 * Tiger Palm is in this pull's damage table and puts up a Tiger Power the order does not name, so
	 * the row is found by the button; the tier would merely have left it somewhere in the rotation,
	 * while the order puts it in one place. Tigereye Brew is the mirror: pressed off the global, no
	 * damage at all, and a tier sort would drop it past the kit and the interrupts — away from the
	 * Re-Origination row the whole snapshot argument is read against — while the order names it third.
	 */
	it('finds a merged row by either of its two names', () => {
		const html = render(scan);
		const tigerPower = t('castLog.mergedLane', { ability: 'Tiger Palm', aura: 'Tiger Power' });
		// Named eighth, which is above Fists of Fury at thirteenth — and a tier sort could not have
		// produced that, because both presses are in the same tier and Fists of Fury was pressed once.
		expect(at(html, tigerPower)).toBeGreaterThan(at(html, 'Re-Origination'));
		expect(at(html, tigerPower)).toBeLessThan(at(html, 'Fists of Fury'));
		// The brew's row is named once, because the button and the buff share a name.
		expect(at(html, 'Tigereye Brew')).toBeGreaterThan(at(html, 'Melee'));
		expect(at(html, 'Tigereye Brew')).toBeLessThan(at(html, tigerPower));
	});

	/**
	 * And the row nobody named still sorts with the auras rather than with its press's tier, which is
	 * the rule the declared order leaves untouched.
	 *
	 * Tiger Strikes is a plain proc and is covered above; this is the harder half — a *merged* row whose
	 * button is the kit. Sorting it by the press would put it among the Healthstones at the foot of the
	 * chart; sorting it as the aura row it also is keeps it at the tier boundary, above them.
	 */
	it('leaves a merged row nobody named at the tier boundary, not at its press’s tier', () => {
		const springs: Analysis = {
			...scan,
			timeline: {
				...scan.timeline!,
				casts: [...scan.timeline!.casts, { t: 16000, id: 126734, name: 'Synapse Springs', onGcd: false }],
				lanes: [
					...scan.timeline!.lanes,
					{
						key: 'synapse-springs',
						name: 'Synapse Springs',
						id: 126734,
						group: 'buff' as const,
						windows: [{ start: 16000, end: 26000 }],
					},
				],
			},
		};
		const html = render(springs);
		expect(at(html, 'Synapse Springs')).toBeGreaterThan(at(html, 'Fists of Fury'));
		expect(at(html, 'Synapse Springs')).toBeLessThan(at(html, 'Healthstone'));
	});
});

/**
 * How deep a lane is allowed to get, which is a claim about what a second row would *mean*.
 *
 * An icon is drawn one global wide, so the packer charges every mark a global's worth of track — and
 * on the committed pulls the melee lane arrives every ~800ms against an icon covering ~960ms at the
 * default zoom. Every consecutive pair therefore collided and the greedy fit opened a row for each:
 * four rows on `weave`, three on `mixed` and `waves`, five at the two widest rungs of the ladder on
 * all six. A monk carries one two-hander or two one-handers, so four melee rows is not a thing that
 * can happen, and a lane drawn four rows deep says four separate things were going on.
 *
 * The rule is about globals rather than about auto-attacks: a press occupies the global it starts, so
 * an icon's width is a claim it can make; a swing occupies nothing, and neither does a brew. Overlap
 * is the honest failure — the marks are closer together than this zoom can draw, which is exactly what
 * happened and is what the zoom ladder is for.
 */
describe('CastTimeline, a lane of presses that cost no global', () => {
	const fixture = (name: string): Analysis =>
		JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../__fixtures__/${name}.json`), 'utf8'));

	/**
	 * The height the gutter gave a row, in pixels — which is what a stacked lane shows up as.
	 *
	 * Read out of the gutter rather than the track, because the gutter carries exactly one element per
	 * row: the nearest `height` before the row's own label is that row's. A number of sub-rows is not
	 * otherwise observable from a static render, and the height is the thing the reader actually sees.
	 */
	const rowHeight = (html: string, name: string): number => {
		const gutter = html.slice(html.indexOf('w-28 shrink-0'), html.indexOf('overflow-x-auto'));
		const at = gutter.indexOf(`title="${name}">`);
		expect(at, name).toBeGreaterThan(-1);
		return Number([...gutter.slice(0, at).matchAll(/style="height:(\d+)px"/g)].at(-1)?.[1] ?? 0);
	};

	for (const name of ['strong', 'mixed', 'poor', 'waves', 'cleave', 'weave']) {
		it(`draws every one of ${name}'s swings, on a single row`, () => {
			const analysis = fixture(name);
			const html = render(analysis);
			// Every swing the engine measured still has a mark. Counted off the fixture rather than
			// written here, so this cannot be satisfied by dropping swings and lowering the number.
			const swings = (analysis.timeline?.casts ?? []).filter((c) => c.name === 'Melee').length;
			expect(swings, name).toBeGreaterThan(100);
			expect((html.match(/data-tip="Melee"/g) ?? []).length, name).toBe(swings);
			// And the lane is exactly as tall as a lane that never collides with itself. Touch of Karma is
			// the reference because a ninety-second cooldown cannot overlap its own icon at any zoom.
			expect(rowHeight(html, 'Melee'), name).toBe(rowHeight(html, 'Touch of Karma'));
		});
	}

	/** The rule itself, with nothing to read off a pull: two marks on one millisecond, twice over. */
	it('stacks two presses on the same instant, and two swings not at all', () => {
		const twice = (id: number, label: string, onGcd: boolean): Analysis => ({
			...captured,
			timeline: {
				casts: [
					{ t: 1000, id, name: label, onGcd },
					{ t: 1000, id, name: label, onGcd },
				],
				lanes: [],
			},
		});
		// A press occupies the global it starts, so two of them at one instant have nowhere to go but up:
		// exactly two rows, and a row is one icon tall.
		const pressed = render(twice(100787, 'Tiger Palm', true));
		const swung = render(twice(1, 'Melee', false));
		expect(rowHeight(pressed, 'Tiger Palm')).toBe(2 * rowHeight(swung, 'Melee'));
		// Both marks are drawn either way — the swings overlap rather than one of them being dropped.
		expect((swung.match(/data-tip="Melee"/g) ?? []).length).toBe(2);
	});
});

/**
 * The same ordering, read off all six committed pulls rather than off a fixture built to show it.
 *
 * A hand-built analysis proves the rule fires; it cannot prove the rule is the one a real pull wants,
 * because the tiers are read from the pull's own damage table and the aura lanes from what the log
 * actually put up. So this renders the captured reports and reads the order out of the gutter — which
 * is the column that carries exactly one label per row, and therefore *is* the order — rather than
 * reasoning about the sort.
 *
 * All six, and the three that were added for it are the ones that make the claim worth anything: the
 * declared order names three talent buttons for one slot and two shapes of the Rising Sun Kick row,
 * and `strong`, `mixed` and `poor` between them exercise neither. `waves` is the only pull that took
 * Chi Burst, `cleave` the only one that never pressed Fists of Fury, and `mixed` and `weave` are the
 * two single-target pulls — which is the case the kick's debuff row is hoisted on.
 *
 * Nothing here is regenerated and nothing is written: the six files are captured `analyse()` output
 * and this only reads them.
 */
describe('CastTimeline, the lane order on the committed pulls', () => {
	const fixture = (name: string): Analysis =>
		JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../__fixtures__/${name}.json`), 'utf8'));

	/**
	 * The rows the chart drew, in order, by the name in each one's label.
	 *
	 * The gutter runs from its own width class to the start of the scroller beside it, and a label's
	 * `title` is the last attribute on its element — so `">` is what separates a row's name from a
	 * mark's, whose `title` carries a clock after it, and from a bar's, which carries two.
	 */
	const gutterRows = (html: string): string[] => {
		const gutter = html.slice(html.indexOf('w-28 shrink-0'), html.indexOf('overflow-x-auto'));
		return [...gutter.matchAll(/title="([^"]*)">/g)].map((m) => m[1] ?? '');
	};

	/**
	 * `ROW_ORDER`, transcribed — deliberately a second copy rather than an import.
	 *
	 * The chart's list is the thing under test, so reading it back would let a reordering pass by
	 * agreeing with itself. This is the order as it was asked for, and the two have to be edited
	 * together on purpose.
	 */
	const DECLARED = [
		'Melee',
		'Re-Origination',
		'Tigereye Brew',
		'Energizing Brew',
		'Chi Brew',
		'Jab',
		'Focus of Xuen',
		'Rising Sun Kick',
		'Combo Breaker: Tiger Palm',
		'Tiger Palm',
		'Combo Breaker: Blackout Kick',
		'Blackout Kick',
		'Rushing Jade Wind',
		'Fists of Fury',
		'Touch of Karma',
		'Chi Wave',
		'Zen Sphere',
		'Chi Burst',
		'Expel Harm',
	];

	/**
	 * Which entry a drawn row answers to, or −1 for a row nobody named.
	 *
	 * A merged row carries both its names, joined by the copy file's own string — so it is taken apart
	 * with that string rather than with a separator written here, and "Rising Sun Kick (debuff)" on an
	 * add pull stays one name and matches nothing.
	 */
	const joiner = t('castLog.mergedLane', { ability: '', aura: '' });
	const declaredAt = (label: string): number => DECLARED.findIndex((entry) => label.split(joiner).includes(entry));

	for (const name of ['strong', 'mixed', 'poor', 'waves', 'cleave', 'weave']) {
		it(`leads ${name} with the declared rows, in the declared order`, () => {
			const rows = gutterRows(render(fixture(name)));
			// The head runs to the first row the order does not name, which is the claim: these rows come
			// first and nothing is interleaved with them.
			const headLength = rows.findIndex((label) => declaredAt(label) === -1);
			const head = rows.slice(0, headLength).map(declaredAt);

			// In the declared order, with no repeats — a sorted run of distinct indices is exactly that.
			expect(head, `${name}: ${rows.slice(0, headLength).join(' | ')}`).toEqual(
				[...new Set(head)].sort((a, b) => a - b),
			);
			// And nothing the order names is drawn below the head, which is what would happen if a row
			// stopped answering to its name — the failure a subsequence check on its own would miss.
			expect(
				rows.slice(headLength).filter((label) => declaredAt(label) !== -1),
				name,
			).toEqual([]);
			// Melee is always drawn and always first: every pull has auto-attacks, and it is the ruler the
			// rows under it are read against.
			expect(rows[0], name).toBe('Melee');
			// The head is a real head rather than a lucky prefix of one row.
			expect(headLength, name).toBeGreaterThan(10);
		});

		it(`draws ${name}'s unnamed rows after the head, auras then kit`, () => {
			const rows = gutterRows(render(fixture(name)));
			const row = (label: string): number => {
				const at = rows.indexOf(label);
				expect(at, `${name}: ${label}`).toBeGreaterThan(-1);
				return at;
			};
			// The last row the order names, which is what "after the head" is measured from rather than
			// from any one entry: the six pulls did not all take the same talent, so the row that ends the
			// head is a different one on each of them.
			//
			// There is no damage tier left to check between the head and the auras. Jab was the stand-in
			// for it — the biggest rotational lane the order did not name — and the order names it now, so
			// on all six of these pulls every press that generates or spends chi is in the head and the
			// first unnamed row below it is an aura.
			const headEnd = Math.max(...rows.map((label, i) => (declaredAt(label) === -1 ? -1 : i)));
			// The auras nobody named, below the head and above the kit. Tiger Strikes is a plain proc and
			// Synapse Springs is the harder case — a merged row whose button is the kit, which sorts here
			// as the aura it also is rather than at its press's tier.
			for (const aura of ['Tiger Strikes', 'Synapse Springs']) {
				expect(row(aura), `${name}: ${aura}`).toBeGreaterThan(headEnd);
			}
			// And the kit below them. Named per pull rather than once, because the six did not press the
			// same consumables — what matters is that whichever one they did press sits under the auras.
			const kit = ['Healthstone', 'Roll'].find((label) => rows.includes(label));
			expect(kit, name).toBeDefined();
			expect(row('Synapse Springs'), name).toBeLessThan(row(kit ?? ''));
		});
	}

	/**
	 * The Rising Sun Kick row in both target modes, which is the one row the declared order draws in
	 * two different places.
	 */
	for (const name of ['mixed', 'weave']) {
		it(`merges the kick and its debuff into one row near the top of ${name}`, () => {
			const rows = gutterRows(render(fixture(name)));
			const merged = t('castLog.mergedLane', { ability: 'Rising Sun Kick', aura: 'Rising Sun Kick (debuff)' });
			expect(rows.indexOf(merged), name).toBe(DECLARED.indexOf('Rising Sun Kick'));
			// And nothing is left at the foot of the chart for it, because there is no enemy block.
			expect(
				rows.filter((label) => label === 'Rising Sun Kick (debuff)'),
				name,
			).toEqual([]);
		});
	}

	for (const name of ['strong', 'poor', 'waves', 'cleave']) {
		it(`keeps ${name}'s per-enemy debuff rows grouped at the foot of the chart`, () => {
			const rows = gutterRows(render(fixture(name)));
			// The press keeps its declared place; the debuff keeps its own block, which is the rule the
			// per-enemy accounting depends on.
			expect(rows.indexOf('Rising Sun Kick'), name).toBeGreaterThan(-1);
			expect(rows[rows.length - 1], name).toBe('Rising Sun Kick (debuff)');
			expect(rows.lastIndexOf('Rising Sun Kick (debuff)'), name).toBeGreaterThan(rows.indexOf('Jab'));
		});
	}
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
		// Both segment lists, because the chart reads the wider one. `engagedSegments` is scoped to the
		// primary target and its complement is "you were not on the boss" — which on an add fight is
		// most of the pull and is not downtime, so the shading follows `contactSegments` instead.
		const unbroken: Analysis = {
			...drawn,
			debuff: {
				...captured.debuff,
				engagedSegments: [[0, captured.durationMs]],
				contactSegments: [[0, captured.durationMs]],
			},
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
				// Picked back up eleven seconds later, so the band closes.
				{ t: 61000, abilityId: 146743, ability: 'Iron Star', until: 72000, resurrected: true },
				// The log named nothing — a fall, an enrage, a wipe — and nobody came, so the band runs to
				// the end of the pull.
				{ t: 90000, abilityId: null, ability: null, until: captured.durationMs, resurrected: false },
			],
		},
	};

	it('marks each death, and names what landed the blow', () => {
		const html = render(died);
		expect(html).toContain(`data-tip="${t('castLog.death.title')}"`);
		expect(html).toContain(`data-tip-at="${formatStamp(61000)}"`);
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

/**
 * The third thing on the chart that is not a press and not an aura: the raid's haste cooldown, shaded
 * across the full height.
 *
 * Read off the Energizing Brew audit, which already measures it for its own Bloodlust clause — so
 * like the two above it costs no request, and unlike them it is one effect logged under five ids. The
 * claim these pin is that a band names the spell that was actually cast rather than the group.
 */
describe('CastTimeline, the haste cooldown behind the chart', () => {
	const haste = (windows: AuraWindow[]): Analysis => ({
		...drawn,
		timeline: { ...timeline, hasteWindows: windows },
	});

	it('shades the stretch it was up, and names which of the five it was', () => {
		// The reference pull took a shaman's Heroism, which is exactly the case the group exists for: a
		// band titled "Bloodlust" would be naming a spell nobody in that raid cast.
		const html = render(drawn);
		expect(html).toContain('data-tip="Heroism"');
		expect(html).toContain(`data-tip-from="${formatStamp(429424)}"`);
		expect(html).toContain(t('castLog.lust.note', { count: 1, names: 'Heroism' }));
	});

	/** Two of them in one pull is two bands, each named for itself, and one sentence listing both. */
	it('names each window separately when the raid brought more than one', () => {
		const html = render(
			haste([
				{ start: 10000, end: 50000, id: 2825, variant: 'Bloodlust' },
				{ start: 200000, end: 240000, id: 80353, variant: 'Time Warp' },
			]),
		);
		expect(html).toContain('data-tip="Bloodlust"');
		expect(html).toContain('data-tip="Time Warp"');
		expect(html).toContain(t('castLog.lust.note', { count: 2, names: 'Bloodlust, Time Warp' }));
	});

	/**
	 * An id the model does not name is still a haste cooldown. Said in words rather than guessed at,
	 * exactly as an unnamed killing blow is — calling it Bloodlust because that is the commonest of the
	 * five would be the chart inventing which class was in the raid.
	 */
	it('says so plainly when the window carries no variant', () => {
		const html = render(haste([{ start: 10000, end: 50000, id: 2825 }]));
		expect(html).toContain(`data-tip="${t('castLog.lust.unnamed')}"`);
	});

	/** Nothing to shade on a pull that never got one, and no sentence about shading either. */
	it('shades nothing on a pull with no haste cooldown', () => {
		const html = render(haste([]));
		expect(html).not.toContain('data-tip="Heroism"');
		expect(html).not.toContain(t('castLog.lust.note', { count: 1, names: 'Heroism' }));
	});
});

/**
 * The band as a wash, and why the wash is one layer rather than one per band.
 *
 * The reported bug was that the globals could not be read through Bloodlust, and the cause was not the
 * paint order — the rules were already drawn over the band. It was contrast: `--color-band-lust` is an
 * opaque mix lighter than `surface`, and a `--color-line` hairline reading 1.45:1 against the bare
 * track reads 1.12:1 against the band, 1.01:1 on the Elemental palette. So the fill is washed.
 *
 * The half worth a test is the *layer*. Bloodlust and Berserking overlap — the racial is pressed
 * inside the raid cooldown — and two translucent fills stacked composite to 1-(1-a)², which would hand
 * the globals straight back wherever the two meet. Group opacity is what makes an overlap the same
 * wash as a single window, and that is a claim about the markup: one washed layer, every fill inside
 * it, and none on the spans that carry the edges and the tooltips.
 */
describe('CastTimeline, the haste band drawn as a wash', () => {
	/** Berserking inside Bloodlust, which is where a troll actually presses it. */
	const overlapping: Analysis = {
		...drawn,
		timeline: {
			...timeline,
			hasteWindows: [{ start: 10000, end: 50000, id: 2825, variant: 'Bloodlust' }],
			berserkingWindows: [{ start: 20000, end: 30000, id: 26297 }],
		},
	};

	const WASH = 'class="pointer-events-none absolute inset-0 opacity-30"';
	const FILL = 'class="absolute inset-y-0 bg-[var(--color-band-lust)]"';
	const count = (html: string, needle: string) => html.split(needle).length - 1;

	/** `opacity-30` and not a fresh number: it is the strength the lane bars already wash at. */
	it('washes both overlapping bands inside a single layer', () => {
		const html = renderToStaticMarkup(asWindwalker(createElement(CastTimeline, { analysis: overlapping })));
		expect(count(html, WASH)).toBe(1);
		expect(count(html, FILL)).toBe(2);
	});

	/**
	 * The edges keep their full strength and lose their fill. A transparent box still answers
	 * `elementsFromPoint`, so the tooltips are unaffected by moving the paint off these spans.
	 */
	it('paints no fill on the spans that carry the edges', () => {
		const html = renderToStaticMarkup(asWindwalker(createElement(CastTimeline, { analysis: overlapping })));
		expect(count(html, 'bg-[var(--color-band-lust)]')).toBe(count(html, FILL));
		expect(html).toContain('class="pointer-events-auto absolute inset-y-0 border-x-2 border-lust"');
		expect(html).toContain('class="pointer-events-auto absolute inset-y-0 border-x-2 border-dashed border-lust/60"');
	});

	/** No layer at all on a pull that got neither, rather than an empty one. */
	it('draws no wash layer on a pull with no haste at all', () => {
		const html = render({ ...drawn, timeline: { ...timeline, hasteWindows: [], berserkingWindows: [] } });
		expect(html).not.toContain(WASH);
	});
});

/**
 * A stacking aura's row, drawn as a meter rather than as a bar.
 *
 * A stacking aura's *window* is the least interesting thing about it: Capacitance is up for most of a
 * pull, so a solid bar saying "up" says nothing, while the height of the charge says how fast the pull
 * was going. These pin the three claims the drawing makes — a block's height is the level the log
 * stamped, the icon after it is the payoff that emptied it, and the fade between them is the wait —
 * plus the sentence that has to accompany a meter which, on this aura, can never fill.
 *
 * Keyed to an aura the ignore table does not name, and paid out by a spell it does not name either.
 * Both halves of the gem are hidden (see `hidden.ts`), so exercising the drawing under its own key and
 * id would test nothing at all; under a key and an id the table leaves alone, this *is* the chart a
 * reader gets the moment those entries are removed. The counter is the real gem's, one cycle of it,
 * with the payoff swapped for another spell — the drawing does not care which spell it is, only that
 * it has an icon. The suite below covers the hiding.
 */
describe('CastTimeline, a stacking lane drawn as its charge', () => {
	const VISIBLE = 'capacitance-not-hidden';
	const PAYOFF_ID = 123996;
	const stacks = {
		// One cycle in the shape a real client records: charge 1 is the application, then 2, 3 and 4,
		// and the fifth charge is the removal rather than a level of its own.
		points: [
			[2000, 1],
			[2200, 2],
			[2300, 3],
			[2400, 4],
			[2500, 0],
		] as Array<[number, number]>,
		max: 5,
		payoff: 'Crackling Tiger Lightning',
		payoffId: PAYOFF_ID,
		// 260ms after the counter emptied, which is the median wait measured on the reference reports.
		discharges: [{ t: 2760, amount: 276205, from: 2500 }],
	};
	const charged: Analysis = {
		...drawn,
		timeline: {
			...timeline,
			lanes: [
				...timeline.lanes,
				{ key: VISIBLE, name: 'Capacitance', id: 137596, group: 'proc', windows: [{ start: 2000, end: 2500 }], stacks },
			],
		},
	};

	/** The premise of every case below: without it they would all pass against a row nobody drew. */
	it('is testing a key and an id the ignore table leaves alone', () => {
		expect(HIDDEN_AURAS.has(VISIBLE)).toBe(false);
		expect(HIDDEN_CASTS.has(PAYOFF_ID)).toBe(false);
	});

	it('draws a block per level, at the height of the charge the log stamped', () => {
		const html = render(charged);
		// Four levels against a ceiling of five: 20/40/60/80%, and never 100 — which is the finding, not
		// a rounding artefact. The empty stretch after the discharge draws nothing at all.
		expect(html).toContain('height:20%');
		expect(html).toContain('height:40%');
		expect(html).toContain('height:60%');
		expect(html).toContain('height:80%');
		expect(html).not.toContain('height:100%');
		expect(html).toContain('data-tip-charges="4/5"');
	});

	it('marks the discharge with the payoff’s own icon, named in the tooltip', () => {
		const html = render(charged);
		expect(html).toContain('data-tip="Crackling Tiger Lightning"');
		expect(html).toContain(`data-tip-landed="${formatStamp(2760)}"`);
		expect(html).toContain('data-tip-hit="276,205"');
		// The icon, and specifically the payoff's own — a tick would leave the reader asking what it is.
		expect(html).toContain(spellIconUrl(PAYOFF_ID));
	});

	/**
	 * The wait, which is what stops the meter looking like it quits early.
	 *
	 * Both ends stay where the log put them — the fade starts at the emptying and ends at the strike —
	 * and its height is the charge that bought it, so it reads as the same event continuing.
	 */
	it('draws the wait between the charge emptying and the strike landing', () => {
		const html = render(charged);
		expect(html).toContain(`data-tip-wait="${formatGap(260)}"`);
		expect(html).toContain('opacity-30');
	});

	/** A meter that cannot fill is a chart owing the reader an explanation, so it gives one. */
	it('explains the meter, and only when the row is on the screen', () => {
		const note = t('castLog.charge.note', { aura: 'Capacitance', max: 5, payoff: 'Crackling Tiger Lightning' });
		expect(render(charged)).toContain(note);
		expect(render(drawn)).not.toContain(note);
	});

	/** A proc that found nobody to hit gets no icon, and no wait either. Not a hole — an outcome. */
	it('draws no payoff for a charge that discharged into nothing', () => {
		const missed: Analysis = {
			...charged,
			timeline: {
				...charged.timeline!,
				lanes: charged.timeline!.lanes.map((lane) =>
					lane.key === VISIBLE ? { ...lane, stacks: { ...stacks, discharges: [] } } : lane,
				),
			},
		};
		const html = render(missed);
		expect(html).toContain('data-tip-charges="4/5"');
		expect(html).not.toContain('data-tip="Crackling Tiger Lightning"');
		expect(html).not.toContain('data-tip-wait=');
	});

	/** Every other lane keeps the bar it always had; the counter is not a new convention for all of them. */
	it('leaves the lanes with no counter as full-height bars', () => {
		const html = render(charged);
		expect(html).toContain('data-tip="Re-Origination"');
		// Four blocks and no more: exactly the levels of the one lane that carries a counter. The three
		// lanes without one are still bars, which is what a lane whose aura does not stack should be.
		expect((html.match(/data-tip-charges=/g) ?? []).length).toBe(4);
	});
});

/**
 * The rows this report deliberately does not draw.
 *
 * Hiding a row is a claim about what is worth a reader's attention, and a chart that makes it silently
 * is a chart understating what the pull contained — the same fault the per-enemy cap is careful about.
 * So these check both halves: that the row goes, and that the caption says it went.
 */
describe('CastTimeline, the ignore table', () => {
	const gem: Analysis = {
		...drawn,
		timeline: {
			...timeline,
			casts: [...timeline.casts, { t: 2760, id: 137597, name: 'Lightning Strike', onGcd: false }],
			lanes: [
				...timeline.lanes,
				{
					key: 'capacitance',
					name: 'Capacitance',
					id: 137596,
					group: 'proc',
					windows: [{ start: 2000, end: 2500 }],
					stacks: {
						points: [
							[2000, 1],
							[2500, 0],
						] as Array<[number, number]>,
						max: 5,
						payoff: 'Lightning Strike',
						payoffId: 137597,
						discharges: [{ t: 2760, amount: 276205, from: 2500 }],
					},
				},
			],
		},
	};

	it('draws no row for a hidden aura, and no mark for a hidden spell', () => {
		const html = render(gem);
		expect(html).not.toContain('data-tip="Capacitance"');
		expect(html).not.toContain('data-tip="Lightning Strike"');
		expect(html).not.toContain('data-tip-charges=');
	});

	/** Named, so a reader knows the pull had something the chart chose not to show them. */
	it('says in the caption what it left out', () => {
		expect(render(gem)).toContain(t('castLog.hiddenRows', { count: 1, rows: 'Capacitance' }));
	});

	/** A pull with none of it says nothing, rather than explaining an absence nobody would notice. */
	it('says nothing on a pull that had none of it', () => {
		expect(render(drawn)).not.toContain(t('castLog.hiddenRows', { count: 1, rows: 'Capacitance' }));
	});
});

/**
 * The two tooltip rows that name something rather than restating a clock.
 *
 * A press mark that says *which enemy* and a buff window that says *which press spent it* are both
 * cases of the same thing: the chart drawing a fact the bar itself cannot carry. Both travel as
 * `data-*` attributes on the mark and are assembled by the one shared node, which is what this
 * asserts — the marks are rendered here, the tooltip's own assembly is `tip` below.
 */
describe('what a mark says beyond its clock', () => {
	const FOCUS_LANE: AuraLane = {
		key: 'focus-of-xuen',
		name: 'Focus of Xuen',
		id: 145024,
		group: 'proc',
		windows: [
			{ start: 10000, end: 12000 },
			{ start: 20000, end: 30000 },
			{ start: 40000, end: 41000 },
		],
		spent: [
			{ start: 10000, id: 100784, name: 'Blackout Kick' },
			{ start: 20000, id: null, name: null, fate: 'expired' },
			{ start: 40000, id: null, name: null },
		],
	};
	const spendable: Analysis = { ...drawn, timeline: { ...timeline, lanes: [...timeline.lanes, FOCUS_LANE] } };

	/** The press, by name and by its art — which is how a reader recognises a spell on this chart. */
	it('names the press that spent a window, with its icon', () => {
		const html = render(spendable);
		expect(html).toContain('data-tip-spent="Blackout Kick"');
		expect(html).toContain(`data-tip-spent-icon="${spellIconUrl(100784)}"`);
	});

	/**
	 * The two outcomes that are not a press, kept apart. A window that ran its full length and one
	 * that came off early with nothing near it are different facts, and neither may borrow a spell.
	 */
	it('separates a window that ran out from one that simply came off', () => {
		const html = render(spendable);
		expect(html).toContain(`data-tip-spent="${t('castLog.tip.spentExpired')}"`);
		expect(html).toContain(`data-tip-spent="${t('castLog.tip.spentNone')}"`);
		// Neither carries an icon: there is no spell to draw, and drawing one would be the invention.
		expect((html.match(/data-tip-spent-icon=/g) ?? []).length).toBe(1);
	});

	/** An analysis captured before the field existed draws the same bars and claims nothing about them. */
	it('says nothing about a lane the engine handed no verdict', () => {
		const html = render(drawn);
		expect(html).not.toContain('data-tip-spent=');
	});

	/**
	 * The press that aims. Three answers, in the Storm, Earth and Fire section's own words, because a
	 * target read off a spirit's swings and a target named by a press are different qualities of
	 * evidence and the tooltip may not present the second as the first.
	 */
	it('names the enemy a spirit was sent to, and says how it knows', () => {
		const aimed = (target: NonNullable<CastMark['target']>) =>
			render({
				...drawn,
				timeline: {
					...timeline,
					casts: [...timeline.casts, { t: 70000, id: 137639, name: 'Storm, Earth and Fire', onGcd: true, target }],
				},
			});
		expect(aimed({ id: 21, name: "Kor'kron Demolisher" })).toContain('data-tip-target="Kor&#x27;kron Demolisher"');
		expect(aimed({ id: 21, name: null })).toContain(`data-tip-target="${t('sef.unnamedTarget')}"`);
		expect(aimed({ id: null, name: null })).toContain(`data-tip-target="${t('sef.prePull.unknown')}"`);
		expect(aimed({ id: 21, name: 'Galakras', deduced: true })).toContain(
			`data-tip-target="${t('sef.prePull.deduced', { target: 'Galakras' })}"`,
		);
	});

	/** Every other press aims at nothing worth saying, and the row is absent rather than empty. */
	it('leaves every other press without the row', () => {
		expect(render(drawn)).not.toContain('data-tip-target=');
	});
});

/**
 * Which stat a Re-Origination proc handed back, written on the window that handed it back.
 *
 * The Rune converts a wearer's two lowest secondary stats into their highest, and logs a *different
 * spell id per stat* — 139117 crit, 139120 mastery, 139121 haste, all three named plainly
 * "Re-Origination" by WarcraftLogs, so the id is the only thing that separates them. The engine
 * already resolves that to `variant` on each window; these are about the chart finally printing it,
 * since three procs that returned three different stats were drawing three identical bars.
 *
 * The renders below are all at the default zoom, which is 24px per second — so a window's width in
 * pixels is its length in seconds times 24, and the thresholds the assertions lean on are real
 * pixels rather than a convention.
 */
describe('the stat a proc converted into', () => {
	/** A proc lane at some length, carrying the id and the word the engine resolved it to. */
	const procLane = (variant: string, id: number, ms: number): AuraLane => ({
		key: 're-origination',
		name: 'Re-Origination',
		id: 139120,
		group: 'proc',
		windows: [{ start: 20000, end: 20000 + ms, id, variant }],
	});
	const withLane = (lane: AuraLane): Analysis => ({
		...drawn,
		timeline: { ...timeline, lanes: [lane, ...timeline.lanes.slice(1)] },
	});

	/** The whole point: the word is inside the bar, not only in a tooltip nobody hovers. */
	it('writes the stat inside a bar with room for it', () => {
		// Ten seconds is what the Rune actually runs, and 240px at this zoom.
		const html = render(withLane(procLane('Mastery', 139120, 10000)));
		expect(html).toContain('>Mastery</span>');
		expect(html).toContain('data-tip-stat="Mastery"');
	});

	/** All three, because a chart that could only name the common one is the bug this replaces. */
	it('names whichever of the three the proc landed on', () => {
		for (const [variant, id] of [
			['Crit', 139117],
			['Mastery', 139120],
			['Haste', 139121],
		] as const) {
			const html = render(withLane(procLane(variant, id, 10000)));
			expect(html, variant).toContain(`>${variant}</span>`);
			expect(html, variant).toContain(`data-tip-stat="${variant}"`);
		}
	});

	/**
	 * The narrow case, which is the one that decides whether this feature is safe to ship.
	 *
	 * A one-second window is 24px at this zoom and "Mastery" needs 57, so the label is *dropped* — not
	 * clipped to a stub, not spilled across the neighbouring lanes. The fact does not disappear with
	 * it: the mark still carries the attribute the tooltip reads and the `title` a pointerless reader
	 * gets, which is what makes this a move rather than a loss.
	 */
	it('drops the label to the tooltip when the bar is too narrow to hold it', () => {
		const html = render(withLane(procLane('Mastery', 139120, 1000)));
		expect(html).not.toContain('>Mastery</span>');
		expect(html).toContain('data-tip-stat="Mastery"');
		expect(html).toContain('title="Re-Origination · Mastery ·');
	});

	/**
	 * The threshold is the word's own length rather than one width for every stat, so the shortest of
	 * the three survives a bar the longest cannot. Two seconds is 48px: enough for "Crit" at 36 and
	 * for "Haste" at 43, not for "Mastery" at 57.
	 */
	it('measures each stat name rather than assuming one width', () => {
		expect(render(withLane(procLane('Crit', 139117, 2000)))).toContain('>Crit</span>');
		expect(render(withLane(procLane('Haste', 139121, 2000)))).toContain('>Haste</span>');
		expect(render(withLane(procLane('Mastery', 139120, 2000)))).not.toContain('>Mastery</span>');
	});

	/**
	 * The guarantee that does not depend on the estimate being right. Whatever the font turns out to
	 * be, the label is clipped at the bar's own edge rather than drawn across the lane beside it.
	 */
	it('clips the label to the bar rather than letting it spill', () => {
		const html = render(withLane(procLane('Mastery', 139120, 10000)));
		const label = html.match(/<span class="([^"]*)">Mastery<\/span>/);
		expect(label?.[1]).toContain('overflow-hidden');
		expect(label?.[1]).toContain('absolute inset-0');
	});

	/** An aura with no variants, and an analysis captured before the walk recorded them: both silent. */
	it('claims nothing about a window that carries no variant', () => {
		const html = render(drawn);
		expect(html).not.toContain('data-tip-stat=');
		expect(html).toContain('title="Re-Origination · ');
	});

	/** The tooltip's own label, so a missing key fails here rather than rendering raw beside the value. */
	it('has a word for the row', () => {
		expect(t('castLog.tip.stat')).not.toBe('castLog.tip.stat');
	});

	/**
	 * The same thing on a real pull rather than a hand-built lane: `weave` is fight 11 of an anonymous
	 * report, and its five Re-Origination windows are four Mastery and one Haste. That mix is the
	 * evidence that the log really does distinguish the stats — a single-id aura could not produce it.
	 */
	it('reads both stats off a captured pull', () => {
		const weave: Analysis = JSON.parse(
			readFileSync(resolve(import.meta.dirname, '../../../__fixtures__/weave.json'), 'utf8'),
		);
		const lane = weave.timeline?.lanes.find((l) => l.key === 're-origination');
		expect(lane?.windows.map((w) => w.variant)).toEqual(['Mastery', 'Mastery', 'Mastery', 'Haste', 'Mastery']);
		const html = render(weave);
		expect(html).toContain('data-tip-stat="Haste"');
		expect(html).toContain('data-tip-stat="Mastery"');
	});
});

/**
 * The shared node's own assembly, which is the half the server render cannot reach: the tooltip is
 * written by a pointer handler, and effects do not run under `renderToStaticMarkup`.
 */
describe('the tooltip markup', () => {
	// Written out rather than derived, because `readTheme` reads computed styles off a document and the
	// suite runs in node — and because a theme spelled in full is what makes the assertions below say
	// which token they expected rather than which index of a list.
	const theme: ChartTheme = {
		bg: 'bg',
		surface: 'surface',
		raised: 'raised',
		line: 'line',
		ink: 'ink',
		ink2: 'ink2',
		muted: 'muted',
		brew: 'brew',
		rune: 'rune',
		kick: 'kick',
		miss: 'miss',
		missSoft: 'missSoft',
		lust: 'lust',
		track: 'track',
		mono: 'mono',
		sans: 'sans',
	};

	/** A row whose value is a spell draws that spell, inside the one node rather than as a new element. */
	it('draws the icon a row carries', () => {
		const html = tip(theme, {
			title: 'Focus of Xuen',
			tone: 'rune',
			rows: [['Spent by', 'Blackout Kick', 'https://x/i.jpg']],
		});
		expect(html).toContain('<img src="https://x/i.jpg"');
		expect(html).toContain('Blackout Kick');
	});

	/** And a row without one is exactly what it was before, which is every row on every other chart. */
	it('draws no icon for a row that carries none', () => {
		expect(tip(theme, { title: 'Up', tone: 'kick', rows: [['Up', '0:10']] })).not.toContain('<img');
	});
});
