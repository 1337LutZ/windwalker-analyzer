// The boss's phase changes on the cast timeline, and the haste wash they are drawn beside.
//
// Both halves of this file are about the *same* pixels, which is why they are one file: the phase
// gutter exists because a hairline-and-a-name could not win a place in the paint order over the track,
// and the haste wash was dropped to a group opacity because it was winning that argument too hard and
// taking the globals with it. A change to either one is a change to how the other reads.
//
// **What is observable in a node render.** There is no jsdom here, so these render `CastTimeline` to an
// HTML string and read the attributes back out of it — the same approach `lanesTimeline.test.ts` takes.
// That is enough for every claim below, because every one of them is a claim about markup: a marker is
// a `<span>` carrying `data-tip-entered`, its moment is a `left` percentage, and the row it was
// staggered onto is a `top` in pixels.
//
// **The numbers are arithmetic, not readback.** Where an offset is asserted it is computed here from
// the fixture's own raw milliseconds, written out literally with the fixture that holds them named — so
// the two sides of the expectation come from different places. An assertion built out of the same
// `pct()` the component calls would pass whatever the component drew.
//
// `createElement` rather than JSX so this stays a `.ts` file and vitest's own include patterns collect
// it (see `vitest.config.ts`).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { initI18n } from '~/lib/i18n/config';
import { getSpec } from '~/lib/spec';
import type { Analysis, FightDataset } from '~/lib/types';
import { SpecContext } from '~/components/report/specContext';
import CastTimeline from '../CastTimeline';
import { analyse as auditWindwalker } from '~/specs/windwalker/lib';

initI18n();

const WINDWALKER = getSpec('windwalker')!;

const render = (analysis: Analysis): string =>
	renderToStaticMarkup(
		createElement(SpecContext.Provider, { value: WINDWALKER }, createElement(CastTimeline, { analysis })),
	);

/**
 * One phase marker as the reader gets it: its label, its position along the pull, and which row of the
 * gutter it was placed on.
 *
 * `data-tip-entered` is what identifies a marker and nothing else on the chart carries it — the
 * attribute exists precisely because a phase change is the one mark here nobody pressed, so keying on
 * it cannot pick up a cast, an aura or a death.
 */
interface Marker {
	label: string;
	left: string;
	top: string;
}

const markersOf = (html: string): Marker[] =>
	[...html.matchAll(/<span([^>]*data-tip-entered[^>]*)>([^<]*)<\/span>/g)].map(([, attrs, label]) => ({
		label: label ?? '',
		left: /left:([^;"]+)/.exec(attrs ?? '')?.[1] ?? '',
		top: /top:([^;"]+)/.exec(attrs ?? '')?.[1] ?? '',
	}));

/** A percentage attribute back as a number, so an offset can be compared to arithmetic. */
const asPct = (value: string): number => Number.parseFloat(value);

/**
 * The height the gutter claimed, on each of the two columns that have to agree about it.
 *
 * Both, deliberately. The columns line up because they draw the same rows at the same heights and
 * nothing measures anything, so a band that claims space on the track and not in the label column
 * would put every name below it beside the wrong row — and a test that read only one side would not
 * see it. `[track, labels]`, and `null` where that side drew no gutter at all.
 *
 * Matched narrowly on purpose: 24px is one row of this chart and a great many boxes in the markup are
 * one row tall, so `toContain('height:24px')` would pass on somebody else's row. The track's gutter is
 * the one box carrying a `width` *and* a height, and the label column's is the one row aligned to its
 * top rather than centred.
 */
const gutterHeights = (html: string): [number | null, number | null] => [
	Number.parseInt(/style="width:[\d.]+px;height:(\d+)px"/.exec(html)?.[1] ?? '', 10) || null,
	Number.parseInt(/items-start[^"]*"\s*style="height:(\d+)px"/.exec(html)?.[1] ?? '', 10) || null,
];

/**
 * `a:6MhZgjyAknFWrYfK` #12 — Iron Juggernaut 25H, the one committed Windwalker fixture that is a raw
 * `FightDataset`, so `analyse` really runs and the phase data really travels the whole way from the
 * wire shape to the markup. It is also the pull `lib/wcl/phases` cites for the two things that make
 * this hard: its transition ids are `1, 2, 1`, so a phase is re-entered and the same name is drawn
 * twice, and the array's position is not the phase number.
 */
const IRON_JUGGERNAUT = auditWindwalker(
	JSON.parse(
		readFileSync(
			resolve(import.meta.dirname, '../../../specs/windwalker/__fixtures__/dataset-ironJuggernaut.json'),
			'utf8',
		),
	) as FightDataset,
) as Analysis;

/**
 * The fixture's own numbers, read off `dataset-ironJuggernaut.json` and written here so the offsets
 * below are arithmetic anybody can check by hand: the fight starts at 3 171 410 report-relative ms and
 * runs 190 309ms, and its three transitions land at 3 171 410, 3 294 896 and 3 354 895.
 */
const IJ_DURATION_MS = 190_309;
const IJ_SIEGE_MODE_MS = 3_294_896 - 3_171_410;
const IJ_BACK_TO_ASSAULT_MS = 3_354_895 - 3_171_410;

/**
 * `cleave.json` — Kor'kron Dark Shaman, one of the 6 of this zone's 14 encounters WarcraftLogs answers
 * `phaseTransitions` with `null` for. That is the ordinary case and not the edge, and it reads as an
 * **empty** `timeline.phases` rather than as a missing key: `resolveFightPhases` always returns an
 * array. The three shapes and what each one means are pinned in
 * `analysis/__tests__/phasesPassthrough.test.ts`, which is the authority.
 *
 * **`poor.json` stood here, and the reason given for it was wrong.** It was described as a pull
 * WarcraftLogs reported no phases for. It was nothing of the kind — it is a Malkorok pull with three
 * transitions, and it reached this file with no `phases` key because every capture then committed
 * predated the field. All six did. The 2026-08-24 re-capture is what exposed the mistake, by giving
 * `poor` the transitions the stated reason said it could not have.
 *
 * So the two states need two fixtures now: a fetched pull that came back with none, which is this one,
 * and a never-fetched dataset, which only a hand-built pull can still be.
 */
const NO_PHASE_DATA = JSON.parse(
	readFileSync(resolve(import.meta.dirname, '../../../specs/windwalker/__fixtures__/cleave.json'), 'utf8'),
) as Analysis;

/** `ROW_PX`, restated from `CastTimeline` — the 24px the request asked the marker to be. */
const ROW_PX = 24;

/**
 * The least a pull can carry and still be drawn: one aura lane, so the chart does not take its
 * `ChartEmpty` exit, and nothing else. Used where the claim is about the marker layer's own rules
 * rather than about a real pull, because those rules are about spacing and a hand-built pair of
 * transitions can be placed exactly where the rule turns over.
 */
const pullWith = (over: Partial<NonNullable<Analysis['timeline']>>, durationMs = 200_000): Analysis =>
	({
		durationMs,
		fightStartMs: 1_000_000,
		damage: { abilities: [] },
		timeline: {
			casts: [],
			deaths: [],
			cancels: [],
			hasteWindows: [],
			berserkingWindows: [],
			contactSegments: [[0, durationMs]],
			lanes: [
				{
					key: 'tigereye-brew',
					name: 'Tigereye Brew',
					id: 116740,
					group: 'buff',
					windows: [{ start: 0, end: 30_000 }],
				},
			],
			...over,
		},
	}) as unknown as Analysis;

describe('the boss’s phase changes, marked above the cast timeline', () => {
	const markers = markersOf(render(IRON_JUGGERNAUT));

	/**
	 * The transition into phase one is the pull. Every fight has one, it lands on `fight.startTime`
	 * exactly, and a marker there says nothing — so three transitions draw two markers.
	 */
	it('marks every transition except the pull into the first phase', () => {
		expect(IRON_JUGGERNAUT.timeline?.phases).toHaveLength(3);
		expect(markers.map((m) => m.label)).toEqual(['Stage Two: Siege Mode', 'Stage One: Assault Mode']);
		expect(markers.map((m) => asPct(m.left))).not.toContain(0);
	});

	/**
	 * Each marker sits over its own moment, as a share of the pull. Both numbers are computed from the
	 * fixture's raw timestamps above rather than read back off anything the component produced.
	 */
	it('puts each marker over the moment the phase began', () => {
		expect(asPct(markers[0]?.left ?? '')).toBeCloseTo((IJ_SIEGE_MODE_MS / IJ_DURATION_MS) * 100, 6);
		expect(asPct(markers[1]?.left ?? '')).toBeCloseTo((IJ_BACK_TO_ASSAULT_MS / IJ_DURATION_MS) * 100, 6);
	});

	/**
	 * A pull that comes back round to a phase it has already been in draws the marker again, and that is
	 * correct rather than a duplicate: `phaseTransitions` is a transition log, so two entries share an id
	 * and a name and differ only in when they happened. Iron Juggernaut's own ids are `1, 2, 1` — the
	 * second entry into phase one is the marker at the far right above — and this shows a re-entry drawn
	 * where *neither* occurrence is the pull, which the fixture cannot show on its own.
	 */
	it('draws a re-entered phase again rather than deduplicating it', () => {
		expect(IRON_JUGGERNAUT.timeline?.phases?.map((p) => p.id)).toEqual([1, 2, 1]);
		const twice = markersOf(
			render(
				pullWith({
					phases: [
						{ id: 1, startTime: 1_000_000, name: 'Stage One: Assault Mode', isIntermission: false },
						{ id: 2, startTime: 1_050_000, name: 'Stage Two: Siege Mode', isIntermission: false },
						{ id: 1, startTime: 1_100_000, name: 'Stage One: Assault Mode', isIntermission: false },
						{ id: 2, startTime: 1_150_000, name: 'Stage Two: Siege Mode', isIntermission: false },
					],
				}),
			),
		);
		expect(twice.map((m) => m.label)).toEqual([
			'Stage Two: Siege Mode',
			'Stage One: Assault Mode',
			'Stage Two: Siege Mode',
		]);
	});

	/**
	 * White through the `ink` token and semi-transparent, which is the whole colour decision: a phase
	 * boundary is the boss's script and not a judgement about the player, so it is none of the graded
	 * tones. This asserts the absence as well as the presence — a marker painted in `miss` would pass a
	 * test that only looked for the rule.
	 */
	it('draws the rule and the name in semi-transparent white, not in a graded tone', () => {
		const marker = /<span[^>]*data-tip-entered[^>]*>/.exec(render(IRON_JUGGERNAUT))?.[0] ?? '';
		expect(marker).toContain('border-l border-ink/40');
		expect(marker).toContain('text-ink/70');
		expect(marker).not.toMatch(/band-(miss|brew|rune|lust)|text-(miss|brew|rune|kick|lust)|bg-track/);
	});

	/** One row of the gutter is one row of the chart: the 24px line the request asked for. */
	it('reserves exactly one 24px row when nothing collides', () => {
		expect(gutterHeights(render(IRON_JUGGERNAUT))).toEqual([ROW_PX, ROW_PX]);
		expect(markers.map((m) => m.top)).toEqual(['0', '0']);
	});

	/**
	 * The collision rule, stated: **stagger, never clip.** Two changes closer together than the first
	 * one's label is wide put the second on the next row of the gutter, at the cost of a few pixels of
	 * downward shift and no characters at all. Siege of Orgrimmar's phase names share their prefixes —
	 * "Stage One: Assault Mode" against "Stage Two: Siege Mode" — so clipping to fit would yield two
	 * stubs that differ nowhere the reader can see.
	 *
	 * Two seconds apart at the default 24px/s, against a label some 155px wide, is well inside the
	 * overlap.
	 */
	it('staggers a colliding label onto a second row rather than clipping it', () => {
		const html = render(
			pullWith({
				phases: [
					{ id: 1, startTime: 1_000_000, name: 'Stage One: Assault Mode', isIntermission: false },
					{ id: 2, startTime: 1_050_000, name: 'Stage Two: Siege Mode', isIntermission: false },
					{ id: 3, startTime: 1_052_000, name: 'Stage Three: Something Else', isIntermission: false },
				],
			}),
		);
		const crowded = markersOf(html);
		expect(crowded.map((m) => m.top)).toEqual(['0', `${ROW_PX}px`]);
		// Every character of both, which is the half of the rule a stagger buys.
		expect(crowded.map((m) => m.label)).toEqual(['Stage Two: Siege Mode', 'Stage Three: Something Else']);
		for (const { label } of crowded) expect(label).not.toContain('…');
		// And the gutter grew to hold the second row, on the track and in the label column alike.
		expect(gutterHeights(html)).toEqual([ROW_PX * 2, ROW_PX * 2]);
	});

	/**
	 * A pull WarcraftLogs reports no phases for draws nothing and says nothing — no gutter, no marker,
	 * no note under the chart explaining marks that are not there.
	 */
	it('draws nothing at all, and claims nothing, when the pull has no phase data', () => {
		expect(NO_PHASE_DATA.timeline?.phases).toEqual([]);
		const html = render(NO_PHASE_DATA);
		expect(markersOf(html)).toEqual([]);
		expect(html).not.toContain('data-tip-entered');
		expect(html).not.toContain('phase changes');
		expect(gutterHeights(html)).toEqual([null, null]);
	});

	/** And the other shape that draws nothing: the key absent, meaning never fetched. Hand-built, because
	 *  no capture taken today can be in that shape — see `phasesPassthrough.test.ts`. The chart is what
	 *  is under test here; that the two shapes reach it at all is that file's claim. */
	it('draws nothing when the pull predates the phases key', () => {
		const legacy = pullWith({});
		expect(legacy.timeline?.phases).toBeUndefined();
		const html = render(legacy);
		expect(markersOf(html)).toEqual([]);
		expect(html).not.toContain('phase changes');
		expect(gutterHeights(html)).toEqual([null, null]);
	});

	/** And the same pull, given phases, does say so — otherwise the assertion above proves only that
	 *  the note is missing everywhere. */
	it('explains the marks when there are marks to explain', () => {
		expect(render(IRON_JUGGERNAUT)).toContain('phase changes');
	});
});

/**
 * The washed layer both haste fills are drawn inside, matched as a whole class rather than by the
 * `opacity-30` in it: the lane bars wash at the same strength, so counting the bare utility would be
 * counting somebody else's rows and would answer differently on a pull with casts in it.
 */
const WASH_LAYER = 'class="pointer-events-none absolute inset-0 opacity-30"';

describe('the haste wash, and the globals underneath it', () => {
	/**
	 * The reported bug: the Bloodlust background sat over the GCD rules so they could not be read
	 * through it. The fill is now a wash at the strength the lane bars already use.
	 */
	it('washes the haste fill rather than laying it on opaque', () => {
		const html = render(pullWith({ hasteWindows: [{ start: 10_000, end: 50_000, id: 32182, variant: 'Heroism' }] }));
		expect(html).toContain(WASH_LAYER);
		// Every lust fill is inside the washed layer and none of them is drawn bare.
		const fills = [...html.matchAll(/<span[^>]*color-band-lust[^>]*>/g)];
		expect(fills.length).toBeGreaterThan(0);
		const washStart = html.indexOf(WASH_LAYER);
		for (const [fill] of fills) expect(html.indexOf(fill)).toBeGreaterThan(washStart);
	});

	/**
	 * **One layer for both fills, and that is the other half of the fix.** Bloodlust and Berserking
	 * overlap constantly — the racial is pressed inside the raid cooldown — and two translucent washes
	 * stacked composite to 1-(1-a)², so two 30% bands would read as 51% exactly where they meet and take
	 * the globals back with them. A group opacity blends once, so an overlap is the same wash as a
	 * single window.
	 */
	it('draws overlapping Bloodlust and Berserking through a single opacity, not two stacked ones', () => {
		const html = render(
			pullWith({
				hasteWindows: [{ start: 10_000, end: 50_000, id: 32182, variant: 'Heroism' }],
				berserkingWindows: [{ start: 30_000, end: 40_000, id: 26_297, variant: 'Berserking' }],
			}),
		);
		// Both windows are drawn…
		expect([...html.matchAll(/color-band-lust/g)]).toHaveLength(2);
		// …through exactly one opacity, and neither fill carries one of its own.
		expect(html.split(WASH_LAYER)).toHaveLength(2);
		for (const [fill] of html.matchAll(/<span[^>]*color-band-lust[^>]*>/g)) expect(fill).not.toContain('opacity');
	});

	/**
	 * The edges and the name stay at full strength, outside the washed layer. Now that the fill is this
	 * faint they are the whole of what makes a window findable, and they are also the hit box the
	 * tooltip hangs off.
	 */
	it('keeps the window’s edges and its name out of the wash', () => {
		const html = render(pullWith({ hasteWindows: [{ start: 10_000, end: 50_000, id: 32182, variant: 'Heroism' }] }));
		const edge = /<span[^>]*border-x-2 border-lust[^>]*>/.exec(html)?.[0] ?? '';
		expect(edge).not.toBe('');
		expect(edge).not.toContain('opacity');
		expect(edge).toContain('pointer-events-auto');
		expect(html).toContain('Heroism');
	});
});
