// The one view in this report that is not an ApexCharts chart, and deliberately so.
//
// ApexCharts is the house library and everything else here is built on it. It cannot draw this. The
// mark for a cast is the ability's *icon*, and ApexCharts renders into SVG — an icon there is an
// `<image>` node the library positions, not an `<img>` CSS positions — while its data labels are
// dropped whenever they are wider than the mark beneath them (the hard-won note in `FightTimeline`
// says so), and an icon is always wider than an instant. A rangeBar would have to invent a duration
// for a press that has none. On top of that, every toggle and every zoom step would mean rebuilding
// the whole chart through `build`, because that is the only way options reach it.
//
// Built as DOM instead, on one rule: **every position is a percentage of the pull**. Zoom then
// changes exactly one number — the track's width — and the browser re-lays-out several hundred marks
// with React re-rendering none of them, because the elements are memoised and identical. Turning a
// category off unmounts its nodes rather than hiding them, so the cost of a row the reader does not
// want is zero rather than merely invisible. The grid is a repeating gradient on the track, which is
// a whole axis for no nodes at all.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { complementOf } from '~/lib/analysis/intervals';
import type {
	AbilityDamage,
	Analysis,
	AuraLane,
	CastMark,
	DeathMark,
	LaneGroup,
	LaneStacks,
	LaneTarget,
	ResourceCurve,
	Window,
} from '~/lib/types';
import { TEB_CAP, registry } from '~/lib/spec/windwalker';

import { SpellIcon } from '../primitives';
import { buttonClass } from '../primitives/controls';
import { spellIconUrl } from '../primitives/spellIcon';
import { formatGap } from '~/lib/format';

import { fmt, n } from '../format';
import { jumpToHeading } from '../jump';
import { readTheme, tip, type ChartTheme } from './apex';
import ChartEmpty from './ChartEmpty';
import { DEFAULT_ZOOM, ZOOM_LADDER, tickStepMs, useDragScroll } from './scroll';
import ResourceTrack, { type ShadeWindow } from './ResourceTrack';
import { cappedOf } from './capped';
import { HIDDEN_CASTS, drawnCastsOf, drawnLanesOf, hiddenNames } from './hidden';
import { collapseTargets, perTargetBlock } from './targetLanes';

/**
 * One lane's height, and the label gutter uses the same number — which is what lines the two columns
 * up without either of them measuring anything.
 *
 * Tight to the icon rather than padded. The rows used to breathe on 8px of slack apiece, which over
 * twenty-odd lanes pushed the pull's later abilities off the screen and made two lanes harder to
 * compare, not easier. A hairline between rows separates them for a fraction of the height.
 */
const ROW_PX = 24;
/** The axis strip under the last lane. */
const AXIS_PX = 24;
/**
 * The icon box for a press. One size for every mark, deliberately.
 *
 * Off-GCD presses used to be drawn smaller, so that a brew or a trinket could not be mistaken for a
 * global that was spent. That distinction was carrying real weight while every press shared one row
 * — and none once the presses were grouped into a lane per ability, because the lane's own label
 * already says which button it is. All it did then was make some rows shorter than others and leave
 * auto-attacks looking like a rendering fault.
 */
const GCD_ICON_PX = 24;

/** Clear air between two icons on the same row, so neighbours read as two marks rather than one. */
const ICON_GUTTER_PX = 3;

/**
 * The icon a proc's payoff is marked with, deliberately smaller than a press.
 *
 * A press owns its row and fills it; a payoff shares a row with the charge that bought it, and at the
 * full 24px it covers the blocks it is supposed to be read against. This leaves the meter visible
 * underneath while staying big enough to recognise the spell by.
 */
const DISCHARGE_ICON_PX = 16;

/**
 * How much two icons may overlap before they are considered to collide.
 *
 * An icon is exactly one global wide at the default zoom, and consecutive presses land 990–1000ms
 * apart — so two ordinary Blackout Kicks overlapped by a quarter of a pixel and the packer opened a
 * second row for the whole lane. A lane drawn two rows tall reads as two different things happening,
 * which is a much bigger lie than a hairline of overlap.
 */
const OVERLAP_TOLERANCE_PX = 4;

/**
 * Vertical pitch of a stacked cast row: exactly the icon.
 *
 * No padding at all. The rule between lanes is what separates them, and any slack on top of it made
 * the icons look small in rows that were taller than they needed to be — the two complaints were the
 * same complaint.
 */
const CAST_ROW_PITCH_PX = GCD_ICON_PX;

/**
 * How many rows the cast lane may grow to before it stops stacking.
 *
 * A press is an instant, so two of them at the same moment have nowhere to go but upwards, and at
 * the wide end of the zoom ladder a whole pull's worth of presses lands within an icon's width of a
 * neighbour. Stacking without a ceiling would make the lane taller than the viewport at 3px/s.
 * Beyond this the least-crowded row takes the mark and the two overlap, which is the honest failure:
 * the reader can see it is crowded and zoom in, which is what the ladder is for.
 */
const MAX_CAST_ROWS = 5;

/**
 * Marks are drawn at the moment they were logged, and deliberately not snapped to that grid.
 *
 * Rounding presses onto the gridlines was tried, measured and rejected. Three findings, all from the
 * reference pulls:
 *
 * - A global is not 1000ms in practice. The median gap between on-GCD presses is 1004–1008ms, so a
 *   fixed grid drifts out of phase within a minute however it is anchored — from the pull's start or
 *   from the first press.
 * - Rebuilding the grid at the *observed* median does not help either: only about a quarter of
 *   presses land within 150ms of any line. Presses are not a metronome — weaving, waiting and
 *   channelling reset the phase constantly.
 * - Snapping only the presses that were already close introduced 33 order inversions on one pull. An
 *   off-GCD press cannot be snapped (it occupies no global), so a nudged on-GCD press could be drawn
 *   *before* an off-GCD one it actually followed — and since each ability has its own lane now, that
 *   reads as a brew going out before the Jab that preceded it.
 *
 * So the gridlines are a ruler, not a claim about which global a press occupied. A mark sits where
 * the log says it went out.
 */

/** The pull's own clock is what everything is measured against; a zero-length one would divide by it. */
const spanOf = (durationMs: number): number => Math.max(1, durationMs);

const pct = (value: number, span: number): string => `${(value / span) * 100}%`;

/** Which rows the reader can turn off. `casts` is the icon lane; the rest are the aura lanes' groups. */
type Toggle = 'casts' | LaneGroup;

const TOGGLES: readonly Toggle[] = ['casts', 'buff', 'proc', 'debuff'];

/**
 * Colour marks the *category* here, not the mechanic — which is the opposite of `FightTimeline`,
 * where colour is the verdict on a span.
 *
 * Nothing on this timeline is graded: it shows what was pressed and what was up, and leaves the
 * judgement to the sections that own it. So the useful thing for colour to say is which toggle a row
 * belongs to, and that makes the toggle its own legend — the swatch on the button is the swatch on
 * the bars. The three mechanic tokens keep the meanings they already have where they can: buffs take
 * Tigereye Brew's amber, procs the Rune's violet, the debuff Rising Sun Kick's teal.
 */
const GROUP_SWATCH: Record<Toggle, string> = {
	casts: 'bg-ink-2',
	buff: 'bg-brew',
	proc: 'bg-rune',
	debuff: 'bg-kick',
};

/**
 * The same four categories again, as the token `tip()` tints a tooltip's title line with.
 *
 * A second table rather than a parse of the first: the swatches are Tailwind classes and the tooltip
 * is built as an HTML string from resolved values, so the two cannot share a spelling. Kept beside
 * each other so the pairing is visible — a tip raised off a proc bar is titled in the proc's violet,
 * which is the swatch on the button that shows it.
 */
const GROUP_TONE: Record<Toggle, keyof ChartTheme> = {
	casts: 'ink2',
	buff: 'brew',
	proc: 'rune',
	debuff: 'kick',
};

/** How far the tip sits from the cursor: clear of the icon underneath without leaving the pointer. */
const TIP_OFFSET_PX = 14;

/** Stable identities for an absent timeline, so the memos below do not re-run on every render. */
const NO_CASTS: CastMark[] = [];
const NO_LANES: AuraLane[] = [];
const NO_DEATHS: DeathMark[] = [];

/**
 * How the reader has overridden the per-enemy grouping, if at all.
 *
 * `auto` is the chart's own judgement — a heading only where there is more than one enemy to tell
 * apart — and the other two are the reader disagreeing with it in either direction: `on` names the
 * enemy even on a single-target pull, `off` collapses the per-enemy rows into one.
 */
type Grouping = 'auto' | 'on' | 'off';

const GROUPINGS: readonly Grouping[] = ['auto', 'on', 'off'];

/**
 * How many enemies may hold a lane at once, however the reader picks them.
 *
 * The engine's `RSK_TARGET_LANES` decides the *default* set and is untouched by any of this; this is
 * the ceiling on what the reader may add to it. Twelve rows at 24px apiece is already the tallest
 * block on the chart, and past that the presses the block exists to be read against are off the top
 * of the screen — which is the failure the engine's cap prevents, reintroduced by hand. So the picker
 * refuses rather than drawing a lane per add.
 */
const MAX_TARGET_LANES = 12;

/**
 * The shortest stretch out of contact worth shading.
 *
 * `engagedSegments` is measured from damage, so a segment ends wherever the last hit landed and a
 * sliver either side of that boundary is the sampling rather than a phase — `DebuffTimeline` draws
 * the same complement and discards the same slivers. It is also about the narrowest band that still
 * reads as a band instead of as a gridline nobody drew.
 */
const MIN_INTERMISSION_MS = 1000;

/**
 * The presses, as one absolutely positioned node each.
 *
 * One node, not a wrapper around a node: at three hundred casts the difference is three hundred
 * elements. That is also why a mark carries its tooltip as `data-*` attributes rather than as
 * markup — an attribute is not an element — and why the tooltip they feed is a single shared node
 * rather than one per mark. The `title` stays as well, unrendered and free, for the reader whose
 * pointer never fires.
 */
/**
 * The order the aura lanes are drawn in, by key — and, since it is a list of the keys somebody chose
 * deliberately, which of them are pinned under melee at all.
 *
 * Not the order the engine happens to build them in: the lanes are read against each other, and the
 * comparison a Windwalker actually makes runs Re-Origination first (what the pull is worth), then
 * the brew that snapshots it, then the procs that decide which button is free, then the resource
 * cooldown. That is the priority sequence, and it is the reason those five rows sit directly under
 * the melee lane: melee is the pull's metronome, and these are the windows worth reading against a
 * continuous line.
 *
 * Being listed here is therefore load-bearing twice over, which is what `meleeBlock` reads. An
 * unlisted key — an item proc, a raid buff, anything the spec grows later — makes no such claim on
 * melee, so it is not dragged up the chart to sit beside it: it keeps its engine order, as it always
 * did, but as part of a second block drawn at the tier boundary instead, below every damaging press
 * and above the kit. Both blocks are still inside the player's own rows, which `perTargetBlock`
 * settles before either of these is consulted.
 */
const LANE_ORDER = [
	're-origination',
	'tigereye-brew',
	'combo-breaker-tiger-palm',
	'combo-breaker-blackout-kick',
	'energizing-brew',
];

/**
 * The rule that divides one lane from the next.
 *
 * On both columns, because the gutter and the track are separate elements and a line on only one of
 * them stops halfway across the chart. Faint enough to read as a ruling rather than as data — the
 * bars in the lanes are the data, and they are drawn in the mechanic colours.
 */
const LANE_RULE = 'border-b border-line/40';

/**
 * The two bars, in the order they are spent: energy buys chi, chi buys the abilities that matter.
 *
 * Colours are the mechanics' own tokens rather than new ones — energy takes the teal every
 * "this went well" figure uses and chi the brew's amber — so the timeline introduces no palette of
 * its own.
 */
const RESOURCE_LANES = [
	{
		key: 'energy' as const,
		stroke: 'var(--color-kick)',
		fill: 'color-mix(in oklch, var(--color-kick) 18%, transparent)',
		mode: 'line' as const,
		// The section that argues about this bar, so its label can jump there. Null while no such
		// section exists; a link to nowhere is worse than none.
		section: 'energy' as string | null,
	},
	{
		key: 'chi' as const,
		stroke: 'var(--color-brew)',
		fill: 'color-mix(in oklch, var(--color-brew) 18%, transparent)',
		mode: 'steps' as const,
		section: 'chi' as string | null,
	},
];

/** Auto-attacks, which WarcraftLogs logs under this id for every class. */
const MELEE_ID = 1;

/**
 * A resource lane, which needs more height than a row of icons to have a shape at all.
 *
 * Energy swings a hundred points several times a minute; drawn at 24px that is a jagged line with no
 * readable peaks. Three rows' worth is enough to see the bar fill, sit at the top, and drop.
 */
const RESOURCE_ROW_PX = 72;

/**
 * What each stretch at the ceiling cost, written on the band.
 *
 * Energy is measurable: the bar refills at a rate this pull can be measured at, so a stretch spent
 * full threw away that rate times its length. The number is deliberately approximate — the readings
 * are ~3/s and the regen figure is itself measured — so it is shown rounded and prefixed.
 *
 * Chi is not, and is labelled with its duration instead. Chi arrives in whole points from Jab and
 * the other generators rather than ticking up, so what a capped stretch cost depends on which
 * buttons were pressed inside it — and this chart cannot see a generator that was skipped *because*
 * the bar was full. Printing an invented chi figure beside a measured energy one would make the two
 * look equally solid.
 */
function lostIn(windows: readonly Window[], key: 'energy' | 'chi', regenPerSec: number | null): ShadeWindow[] {
	return windows.map((w) => {
		// Chi bands are drawn but never labelled: what a capped stretch cost is counted per press on the
		// curve itself, because chi arrives in whole points rather than accruing against a clock.
		if (key === 'chi' || regenPerSec === null) return { ...w };
		return { ...w, text: `~${Math.round(((w.end - w.start) / 1000) * regenPerSec)}` };
	});
}

/**
 * A vertical rule at every global the player actually spent, drawn as one SVG path.
 *
 * This replaced a gridline every 1000ms, which was a ruler pretending to be the rotation: a global is
 * 1004–1008ms in practice and the phase resets whenever the player waits or channels, so a fixed grid
 * lines up with nothing. These lines *are* the data — one per on-GCD press — so there is nothing to
 * round and nothing to misrepresent, and reading straight up a line answers the question the chart is
 * for: this press, and what was up when it went out.
 *
 * Off-GCD presses are left out. They occupy no global, so a line at one would claim a slot that was
 * never spent.
 *
 * One `<path>` rather than one element per press, which at four hundred globals is the difference
 * between a node each and a node total. `viewBox` plus `preserveAspectRatio="none"` is what lets the
 * x coordinates stay proportions of the pull: the path stretches with the track at every zoom step
 * without being rebuilt, exactly as the background gradient did. `vector-effect` keeps the strokes a
 * hairline while that stretch happens — without it the lines would fatten with the zoom.
 */
function gcdRulesPath(casts: readonly CastMark[], span: number): string {
	let d = '';
	for (const c of casts) {
		if (!c.onGcd) continue;
		// Per-mille of the pull, which is finer than any screen this is drawn on.
		const x = ((c.t / span) * 1000).toFixed(3);
		d += `M${x} 0V1`;
	}
	return d;
}

const laneRank = (key: string): number => {
	const at = LANE_ORDER.indexOf(key);
	return at === -1 ? LANE_ORDER.length : at;
};

/**
 * Whether an aura row is one of the ones pinned directly under the melee lane.
 *
 * Read off `LANE_ORDER` rather than written as a second list, because the two questions have one
 * answer: a key is listed there precisely because somebody decided where it sits in the sequence a
 * Windwalker reads, and that sequence is the thing melee is the ruler for. So promoting a lane is
 * one edit — add its key to `LANE_ORDER` — and there is no way to be in the priority order without
 * being in the block, or the reverse.
 *
 * Everything else is drawn at the tier boundary instead. That is not a demotion of the item procs:
 * an unlisted lane has no stated position at all, and the honest place for a row nobody has ranked
 * is beside the presses it is actually about — under the damage, above the kit — rather than three
 * rows from the top because it happens to be an aura.
 *
 * Expressed against `laneRank` rather than `LANE_ORDER.includes` so the rank and the block cannot
 * drift: an unlisted key is exactly the one `laneRank` gives the fallback to.
 */
const meleeBlock = (lane: AuraLane): boolean => laneRank(lane.key) < LANE_ORDER.length;

/**
 * Which row each press sits on, so that no two icons overlap.
 *
 * Marks are placed as percentages of the pull, but whether two of them *collide* is a question about
 * pixels: the same two casts 400ms apart are clear of each other at 48px/s and on top of each other
 * at 3px/s. So the packing is recomputed per zoom, converting each icon's half-width back into the
 * milliseconds it covers at the current scale.
 *
 * Greedy, in time order, first row that has room — which gives simultaneous presses their own rows
 * (the case that is not a matter of degree: two casts on the same timestamp can never share a row)
 * while keeping a quiet stretch of the pull on a single line.
 */

function packCasts(casts: readonly CastMark[], pxPerSec: number): { rows: number; rowOf: Map<CastMark, number> } {
	const msPerPx = 1000 / pxPerSec;
	const rowOf = new Map<CastMark, number>();
	// The moment each row is free again, in fight time.
	const freeAt: number[] = [];

	// An icon starts at its moment and runs rightwards, so it occupies `[t, t + its own width]`, less
	// the slack that keeps a hairline of overlap from splitting a lane in two.
	const widthMs = Math.max(0, GCD_ICON_PX + ICON_GUTTER_PX - OVERLAP_TOLERANCE_PX) * msPerPx;
	const gutterMs = 0;

	for (const c of [...casts].sort((a, b) => a.t - b.t)) {
		let row = freeAt.findIndex((free) => c.t >= free);
		if (row === -1) {
			if (freeAt.length < MAX_CAST_ROWS) {
				row = freeAt.length;
			} else {
				// Every row is busy. The one that has been busy longest is the least bad place to overlap.
				row = freeAt.reduce((best, free, i) => (free < (freeAt[best] ?? Infinity) ? i : best), 0);
			}
		}
		freeAt[row] = c.t + widthMs + gutterMs;
		rowOf.set(c, row);
	}

	return { rows: Math.max(1, freeAt.length), rowOf };
}

/**
 * Which press lanes did damage on this pull, by the name their lane is keyed on.
 *
 * Derived, and it must never become a list of spell names written here. The damage table is the
 * pull's own answer to "did pressing this hurt anything", so a button added to the spec — or one this
 * report has never heard of, a trinket or a racial — sorts correctly the first time somebody presses
 * it, with nothing to keep in step. `Ability.damageIds` was the alternative and answers worse: it is
 * declared only where a button's damage lands under an id that is *not* its cast, so Touch of Death
 * carries none and would sink — while the damage table has a row for it either way, because it
 * resolves an id through `abilityByDamageId` **or** `abilityByCastId`.
 *
 * What the table cannot see is a cooldown whose damage arrives under somebody else's name: Invoke
 * Xuen lands as the pet's Crackling Tiger Lightning and Storm, Earth and Fire lands as the clones'
 * copies of the buttons being mirrored, so both sort as if they did nothing. Answering that needs
 * something the model does not carry — the pet ids a press is responsible for — and inventing it here
 * would be exactly the hardcoded list this avoids. They cost one row each near the foot of the block.
 *
 * Keyed by name rather than by id because a button and its damage are usually two different ids —
 * Rushing Jade Wind is cast as 116847 and lands as 148187 — while both sides resolve the *name*
 * through the same registry, and the lanes above are grouped by name for the same reason.
 *
 * `utility` is the model's own answer to the one case a total gets wrong. Flying Serpent Kick is a
 * movement button that happens to hit, and `Ability.utility` marks it as not-pressed-for-damage,
 * which is precisely the question being asked here — so it is read rather than re-decided, exactly as
 * the damage table's own comparison reads it.
 *
 * Auto-attacks stay on the damaging side, and it is a judgement rather than an oversight. They are
 * not a press, but they are damage — usually the second largest row in the table — and excluding them
 * would need the one hardcoded exception this is written to avoid. It would also move the whole chart:
 * the aura lanes are drawn directly under melee on purpose, because melee is the pull's metronome and
 * a buff window is read against a continuous line, so sinking melee among the potions would drag every
 * aura row down with it.
 */
const damagingNames = (abilities: readonly AbilityDamage[]): Set<string> =>
	new Set(abilities.filter((a) => a.total > 0 && !a.utility).map((a) => a.name));

/**
 * Which press lanes come off an item rather than out of the spellbook, by the name their lane is
 * keyed on: a potion, a flask, a healthstone, an on-use trinket, a glove tinker.
 *
 * Read out of the game model exactly as `APPLIED_BY_CAST` is, and for the same reason — `Ability.onUse`
 * is the simulator's own division between the kit and the rotation, and the field's own doc says which
 * sim files draw the line and why `utility` structurally cannot. So a consumable added to the spec
 * sorts correctly the first time somebody presses it, with nothing in this file to keep in step.
 *
 * A module constant rather than a memo. The registry is one too, so this set is the same for every
 * pull ever rendered — unlike `damagingNames`, which is a reading of *this* pull's damage table.
 */
const ON_USE_NAMES: ReadonlySet<string> = new Set(
	registry.abilities.filter((a) => a.onUse === true).map((a) => a.name),
);

/**
 * Which of the three tiers a press lane sits in — lower is higher up the chart.
 *
 * The middle tier is the reason this is a rank and not a boolean. Damage and everything-else was the
 * first cut and it left a potion, a Synapse Springs and a Healthstone interleaved with the interrupts,
 * the Rolls and the defensives, which is three unrelated readings in one block: the rotation, the
 * consumables you remembered to press, and the buttons the fight asked you for. Splitting the kit out
 * puts each of them where the reader can scan it as one thing.
 *
 * A cooldown whose damage lands under somebody else's name still sorts into the last tier, and that
 * limitation is unchanged and deliberate — see `damagingNames` for why answering it needs something
 * the model does not carry.
 */
const tierOf = (name: string, damaging: ReadonlySet<string>): number =>
	damaging.has(name) ? 0 : ON_USE_NAMES.has(name) ? 1 : 2;

/**
 * The presses grouped into one lane per ability, in the order the lanes are drawn.
 *
 * Packing alone put whichever press came next on whichever row happened to be free, so the same
 * button appeared on a different line every time it was pressed and the lane read as noise. A lane
 * per ability makes the vertical position mean something: one row is one button, and a gap in a row
 * is that button not being pressed.
 *
 * Three tiers, and then by how often the button was pressed. Press count alone is a count of
 * keystrokes and not of the rotation: it put Roll, Synapse Springs and a Healthstone above Fists of
 * Fury on every reference pull, because a global spent on damage is pressed rarely and a utility
 * button is pressed whenever the fight asks for it. The reader scans this chart top-down looking for
 * their rotation, so the buttons that did something to the boss come first, the kit — potions, flasks,
 * on-use trinkets — comes next, and the interrupts, the Rolls and the defensives sink to the foot of
 * the block. All of it inside the player's own rows, which the per-enemy sort has already settled.
 * `tierOf` owns which tier a lane is in; press count only ever orders the lanes inside one. Ties break
 * on the first press, which keeps the order stable between two pulls that used the same kit.
 *
 * Each lane is still packed internally: two presses of the *same* ability can land close enough to
 * overlap at the wide end of the zoom ladder, and a lane that needs two sub-rows gets two.
 */
interface CastLane {
	id: number;
	name: string;
	casts: CastMark[];
	rows: number;
	rowOf: Map<CastMark, number>;
}

function castLanesOf(casts: readonly CastMark[], pxPerSec: number, damaging: ReadonlySet<string>): CastLane[] {
	// Keyed by name, not by id. One spell can log under several ids — measured on a real pull, Spear
	// Hand Strike arrives under two and drew two identical rows — and a reader grouping "by spell"
	// means the button, not the id behind it. The first id seen carries the icon, which is safe
	// because the variants of one spell share their art.
	const byName = new Map<string, CastMark[]>();
	for (const c of casts) {
		const bucket = byName.get(c.name);
		if (bucket === undefined) byName.set(c.name, [c]);
		else bucket.push(c);
	}

	return [...byName.values()]
		.map((list) => {
			const packed = packCasts(list, pxPerSec);
			const first = list[0];
			return {
				id: first?.id ?? 0,
				name: first?.name ?? '',
				casts: list,
				rows: packed.rows,
				rowOf: packed.rowOf,
			};
		})
		.sort(
			(a, b) =>
				tierOf(a.name, damaging) - tierOf(b.name, damaging) ||
				b.casts.length - a.casts.length ||
				(a.casts[0]?.t ?? 0) - (b.casts[0]?.t ?? 0),
		);
}

function castNodesOf(casts: readonly CastMark[], span: number, rowOf: Map<CastMark, number>) {
	return casts.map((c) => {
		const url = spellIconUrl(c.id);
		const size = GCD_ICON_PX;
		const title = `${c.name} · ${fmt(c.t)}`;
		const key = `${c.t}-${c.id}`;
		// The icon's *left* edge is its moment, not its centre.
		//
		// A press occupies the global that begins when it goes out, so the icon should start on that
		// gridline and run into the global it spent — centred, every mark straddled its own line and two
		// lanes could not be read against each other, which is the whole point of drawing the grid.
		const left = pct(c.t, span);
		// Rows run downwards from the top of the lane, each one an icon box tall. `top` is the row's
		// centre and the mark is translated up by half itself, so it sits centred in its row rather
		// than hanging from the top of it.
		const top = (rowOf.get(c) ?? 0) * CAST_ROW_PITCH_PX + CAST_ROW_PITCH_PX / 2;

		// Nothing in the icon map answers for this id — a rare trinket, a racial. Drawn as a tick rather
		// than dropped: a hole in the lane would read as a global nobody spent, which is a claim about
		// the rotation that the log did not make.
		if (url === null) {
			return (
				<span
					key={key}
					title={title}
					data-tip={c.name}
					data-tip-tone={GROUP_TONE.casts}
					data-tip-at={fmt(c.t)}
					data-tip-auto={c.id === MELEE_ID ? '' : undefined}
					style={{ left, top, height: size }}
					className="absolute w-[3px] -translate-y-1/2 rounded-[1px] bg-muted"
				/>
			);
		}

		return (
			<img
				key={key}
				src={url}
				// Decorative: the plot as a whole carries the text alternative, and announcing three hundred
				// icons one at a time is not a description of anything.
				alt=""
				title={title}
				// What the shared tooltip reads off the mark under the cursor. Attributes rather than a
				// rendered tooltip: they cost no node at all, which is what the objection above was about.
				data-tip={c.name}
				data-tip-tone={GROUP_TONE.casts}
				data-tip-at={fmt(c.t)}
				// Auto-attacks are not pressed, so the tooltip must not say they were. Marked on the mark
				// rather than decided in the tooltip, which has no business knowing which id is melee.
				data-tip-auto={c.id === MELEE_ID ? '' : undefined}
				width={size}
				height={size}
				loading="lazy"
				decoding="async"
				style={{ left, top, width: size, height: size }}
				className="absolute -translate-y-1/2 rounded-[3px] border border-line/60"
			/>
		);
	});
}

/** A cast lane and its marks, which travel together whether the lane keeps its row or joins an aura's. */
interface CastRow {
	lane: CastLane;
	nodes: ReactNode;
}

/**
 * Which aura a press puts up, by the press's cast id.
 *
 * Read out of the game model rather than written here. `Aura.appliedBy` already names the button that
 * applies each aura, so an aura added to the spec merges itself and nothing in this file ever learns
 * a spell id. Inverted to id-first because that is the direction a cast lane has to ask in, and built
 * once because the registry is a module constant.
 *
 * Every cast id, not only the canonical one the engine stamps on a mark: a lane built from an id the
 * model splits — Jab has one per weapon type — would otherwise lose its aura for the sake of a lookup.
 *
 * `consumedBy` is deliberately not read. A press that *spends* a proc is not the press that put it
 * up: most Tiger Palms consume no Combo Breaker at all, so drawing every one of them on the proc's
 * row would claim a consumption in every stretch where nothing was ever up — and Tiger Palm applies
 * Tiger Power as well, so the same press would have two rows to sit on and no reason to prefer
 * either. Which presses actually spent a proc is a judgement, and the Combo Breaker section owns it.
 */
const APPLIED_BY_CAST = ((): Map<number, string> => {
	const by = new Map<number, string>();
	for (const aura of registry.auras) {
		if (aura.appliedBy === undefined) continue;
		// First claim wins, so an ability that applies two auras lands on one row rather than being
		// silently redrawn on whichever the spec happened to declare last.
		for (const id of registry.ability(aura.appliedBy).castIds) if (!by.has(id)) by.set(id, aura.key);
	}
	return by;
})();

/**
 * The presses that belong on an aura's row, and the ones that keep a row of their own.
 *
 * A button and the buff it puts up were two rows saying one thing — Energizing Brew's press sat five
 * lanes above Energizing Brew's window, and the reader had to find the pair before they could read
 * it. Merged, the mark sits on the bar it opened and one ability is one row.
 *
 * Only when exactly one lane carries the aura's key. A per-target debuff draws a lane per enemy and
 * the press stream cannot say which enemy a given Rising Sun Kick landed on, so putting every press
 * on all six rows would claim each one hit every add; on an add pull the button keeps its own lane
 * and the debuff rows stay bars. On a single-target pull there is one lane and no doubt about it.
 *
 * A merged row then answers to the aura's ordering and never to the press's tier, which is the one
 * rule that keeps it from having two places to be. It has a foot in both systems — it is a cast lane
 * and an aura lane at once — and the tiebreak goes to the aura for a reason that is about what the
 * row *shows*: what is drawn across its whole width is a window, and a window is only worth anything
 * read against the other windows. Sorting it by the button instead would scatter the aura rows by
 * something the reader cannot see on them, and would break `LANE_ORDER`'s sequence the moment a
 * listed aura's button turned out not to be damaging — which is both brews.
 *
 * Both directions of that are visible on the reference pulls and both are wanted. Tigereye Brew and
 * Energizing Brew are pressed off the global and do no damage at all, so a tier sort would sink them
 * to the foot of the chart, away from the Re-Origination row the whole snapshot argument is read
 * against; they stay pinned under melee because their keys are listed. Tiger Palm is the opposite —
 * a damaging press whose Tiger Power is unlisted — and its row travels down to the tier boundary
 * with the block it belongs to, landing directly under the damaging lanes rather than among them.
 * That is one row's worth of movement for the button and it buys the aura rows staying one list.
 */
function mergeRows(pressed: readonly CastRow[], lanes: readonly AuraLane[]) {
	const lanesPerKey = new Map<string, number>();
	for (const lane of lanes) lanesPerKey.set(lane.key, (lanesPerKey.get(lane.key) ?? 0) + 1);

	const into = new Map<string, CastRow>();
	const loose: CastRow[] = [];
	for (const press of pressed) {
		const key = APPLIED_BY_CAST.get(press.lane.id);
		// `into.has` guards a loss rather than an impossibility: two cast lanes claiming one aura would
		// overwrite each other, and the marks of whichever lost would leave the chart without a trace.
		if (key !== undefined && lanesPerKey.get(key) === 1 && !into.has(key)) into.set(key, press);
		else loose.push(press);
	}
	return { into, loose };
}

/**
 * One lane's windows, as bars. Width is a percentage too, so zoom never touches them.
 *
 * `notes` labels a bar with a number when the lane has one worth carrying — the stacks a Tigereye
 * Brew spent, which is what separates a brew worth pressing from one that was not, and is invisible
 * from the bar's length alone.
 */
function barNodesOf(lane: AuraLane, span: number, notes: Map<number, number> | null) {
	return lane.windows.map((w: Window) => (
		<span
			// Both ends, not just the start: an aura logged under several ids — Re-Origination is one —
			// can open two windows on the same millisecond, and React would then see a duplicate key.
			key={`${w.start}-${w.end}`}
			title={`${lane.name} · ${fmt(w.start)} → ${fmt(w.end)}`}
			// The aura's own name, which is the half of a merged row's label that the gutter may have
			// truncated — and on a row named after the button, the only place the aura is named at all.
			data-tip={lane.name}
			data-tip-tone={GROUP_TONE[lane.group]}
			data-tip-from={fmt(w.start)}
			data-tip-to={fmt(w.end)}
			style={{ left: pct(w.start, span), width: pct(Math.max(w.end - w.start, 0), span) }}
			// A floor of two pixels, because a window can be shorter than the screen can draw and a bar
			// nobody can see is indistinguishable from an aura that never went up.
			// The full row, top to bottom. A bar floating inside its lane reads as a smaller thing than
			// the lane it belongs to, and the rule underneath is what separates one lane from the next —
			// so the bar does not need to leave room for a separation that is already drawn.
			// The 2px radius every other chart's bars carry — ApexCharts draws its rangeBars with
			// `borderRadius: 2`, so matching it keeps the two kinds of timeline looking like one report.
			className={`absolute inset-y-0 min-w-[2px] rounded-[2px] ${GROUP_SWATCH[lane.group]}`}
		>
			{notes?.get(w.start) === undefined ? null : (
				// Larger than the chart's other incidental figures, and deliberately: this one is a verdict in
				// miniature — a brew on ten stacks and one on five draw the same bar, and the number is the
				// only thing separating them.
				<span className="pointer-events-none absolute inset-y-0 left-[4px] flex items-center font-mono text-xs leading-none font-semibold text-bg">
					{notes.get(w.start)}
				</span>
			)}
		</span>
	));
}

/** One stretch the counter held a level, which is the shape a step series has to be drawn as. */
interface ChargeStep {
	start: number;
	end: number;
	stacks: number;
}

/**
 * A counter's readings turned into the stretches it actually held.
 *
 * Emitted on *change* rather than one per reading, which is not a saving but a correctness rule: the
 * client stamps a `refreshbuff` beside every stack event, so the readings arrive in pairs holding the
 * same number and a block per reading would draw a hairline seam through every charge. A level is one
 * block from the moment it was reached to the moment something else was.
 *
 * A level of zero draws nothing. That is the counter being empty, and an empty counter is the absence
 * of a block rather than a block of no height — which is also what keeps the stretch between one
 * cycle's discharge and the next application honestly blank.
 */
function stepsOf(points: readonly (readonly [number, number])[], span: number): ChargeStep[] {
	const out: ChargeStep[] = [];
	let start: number | null = null;
	let level = 0;
	for (const [at, stacks] of points) {
		if (stacks === level) continue;
		if (level > 0 && start !== null && at > start) out.push({ start, end: at, stacks: level });
		start = at;
		level = stacks;
	}
	// A counter still holding something when the pull ended runs to the end of it. The log stops; the
	// charge did not, and truncating it at the last event would draw a discharge nobody got.
	if (level > 0 && start !== null && span > start) out.push({ start, end: span, stacks: level });
	return out;
}

/**
 * A stacking lane, drawn as its charge — and the discharges that emptied it, marked.
 *
 * This replaces the plain bars rather than sitting on top of them, because the plain bar was the
 * problem: Capacitance is up for most of a pull and a solid row saying so is a row that says nothing.
 * The window is still there — a block's left edge is the application and its right edge the removal —
 * and the height is what the bar was throwing away.
 *
 * Height, and not colour, and not a printed number. Colour on this chart means which category a row
 * belongs to and nothing else, so five shades of the proc violet would be five claims the palette is
 * not making. A number per block was the brew bar's answer and is wrong here for a different reason:
 * a brew is one number per window and a charge is four inside one, so the digits would collide at
 * every zoom step below the widest. A meter fills, which is what a charge does.
 *
 * The discharge is the payoff's **own icon**, for the reason every press on this chart is one: a
 * reader recognises a spell by its icon, and it is the only mark here that needs no colour to be told
 * from the blocks around it. A neutral tick was tried first and is what a reader has to ask about.
 * Smaller than a press, because a press owns its row and this one shares a row with the charge under
 * it — and the icon falls back to that tick when the generated map answers for no such id, exactly as
 * `castNodesOf` does, so a payoff without an icon is still a mark rather than a hole.
 *
 * Between the two goes the **wait**, drawn as the last charge block continuing in a fainter tone. The
 * strike lands a fraction of a second *after* the counter empties — median ~260ms, tail to 2.8s — and
 * as two separate marks that read as a counter quitting early beside a strike arriving from nowhere.
 * The fade is a drawing and not a reading: both ends are the log's own timestamps, and neither is
 * moved to meet the other.
 *
 * A discharge with no `from` gets no fade, and a fill with no discharge gets no icon. The second is a
 * real outcome — a proc that found nobody to hit — and drawing anything for it would invent a strike
 * the log does not have.
 */
function chargeNodesOf(lane: AuraLane, stacks: LaneStacks, span: number) {
	const max = Math.max(1, stacks.max);
	const steps = stepsOf(stacks.points, span);
	const url = spellIconUrl(stacks.payoffId);
	// The payoff is a spell like any other, so the ignore table gets a say over it here as well as over
	// the press lanes. Dropping the marks and keeping the meter is a real combination — it is what an
	// entry for the payoff alone means — so the two are checked independently rather than together.
	const discharges = HIDDEN_CASTS.has(stacks.payoffId) ? [] : stacks.discharges;
	/**
	 * The level each fill reached before it emptied, so the wait is drawn at the height of the charge
	 * that bought it rather than at one picked here.
	 *
	 * Keyed on the exact timestamp and matched exactly, which is sound rather than lucky: `from` *is*
	 * the reading that took the counter to zero, and that same reading is what closed the block before
	 * it. A miss therefore means the two disagree, and the fade is dropped rather than guessed at.
	 */
	const heldAt = new Map(steps.map((step) => [step.end, step.stacks]));

	return [
		...steps.map((step) => (
			<span
				key={`c${step.start}`}
				title={`${lane.name} · ${fmt(step.start)} → ${fmt(step.end)}`}
				data-tip={lane.name}
				data-tip-tone={GROUP_TONE[lane.group]}
				data-tip-charges={`${step.stacks}/${stacks.max}`}
				data-tip-from={fmt(step.start)}
				data-tip-to={fmt(step.end)}
				style={{
					left: pct(step.start, span),
					width: pct(Math.max(step.end - step.start, 0), span),
					height: `${(step.stacks / max) * 100}%`,
				}}
				// Anchored to the bottom of the row so the blocks grow upwards: a meter read against the
				// rule under the lane, which is the line every other bar on this chart sits on.
				className={`absolute bottom-0 min-w-[2px] rounded-t-[2px] ${GROUP_SWATCH[lane.group]}`}
			/>
		)),
		// The waits, before the icons in source order so an icon sits on top of the fade that leads to it
		// rather than under it — the same rule the cast marks follow against the bars they open.
		...discharges.flatMap((hit) => {
			const held = hit.from === null ? undefined : heldAt.get(hit.from);
			if (hit.from === null || held === undefined) return [];
			return [
				<span
					key={`w${hit.t}`}
					title={`${stacks.payoff} · ${fmt(hit.from)} → ${fmt(hit.t)}`}
					data-tip={stacks.payoff}
					// The aura's own tone, not the mark's: this is the charge still being spent, and colour
					// here says which category a row belongs to rather than what kind of mark it is.
					data-tip-tone={GROUP_TONE[lane.group]}
					data-tip-landed={fmt(hit.t)}
					data-tip-wait={formatGap(hit.t - hit.from)}
					data-tip-hit={n(hit.amount)}
					style={{
						left: pct(hit.from, span),
						width: pct(Math.max(hit.t - hit.from, 0), span),
						height: `${(held / max) * 100}%`,
					}}
					className={`absolute bottom-0 min-w-[1px] rounded-t-[2px] opacity-30 ${GROUP_SWATCH[lane.group]}`}
				/>,
			];
		}),
		...discharges.map((hit) => {
			// Both marks say the same three things, so a reader learns nothing new by moving the pointer
			// from the fade onto the icon — which is the point of drawing them as one event.
			const wait = hit.from === null ? undefined : formatGap(hit.t - hit.from);
			const shared = {
				title: `${stacks.payoff} · ${fmt(hit.t)} · ${n(hit.amount)}`,
				'data-tip': stacks.payoff,
				// `landed` and not `at`: `at` is labelled "Pressed", and nobody pressed this — it is what
				// the gem did on its own once the counter filled.
				'data-tip-landed': fmt(hit.t),
				'data-tip-wait': wait,
				'data-tip-hit': n(hit.amount),
			};
			// The icon's left edge is its moment, as every other icon on this chart has it, so the fade
			// runs into the mark it explains instead of under it.
			const left = pct(hit.t, span);
			return url === null ? (
				<span
					key={`d${hit.t}`}
					{...shared}
					data-tip-tone="ink"
					style={{ left }}
					className="absolute inset-y-0 w-[2px] rounded-[1px] bg-ink"
				/>
			) : (
				<img
					key={`d${hit.t}`}
					src={url}
					// Decorative: the plot as a whole carries the text alternative, and the tooltip names it.
					alt=""
					{...shared}
					data-tip-tone="ink"
					width={DISCHARGE_ICON_PX}
					height={DISCHARGE_ICON_PX}
					loading="lazy"
					decoding="async"
					style={{ left, top: '50%', width: DISCHARGE_ICON_PX, height: DISCHARGE_ICON_PX }}
					className="absolute -translate-y-1/2 rounded-[3px] border border-line/60"
				/>
			);
		}),
	];
}

/**
 * Every cast on a clock, with the buffs, procs and the debuff drawn as bars underneath.
 *
 * Reads `analysis.timeline`, which is absent on any fixture captured before it existed — hence the
 * truthiness guard rather than a null check, and an empty state rather than a crash.
 */
export default function CastTimeline({ analysis }: { analysis: Analysis }) {
	// `useTranslation`, not `useReportCopy`: this draws what it is handed and holds no verdict.
	const { t } = useTranslation('report');
	const resources = analysis.resources;
	/**
	 * The Tigereye Brew bank, as a third resource lane.
	 *
	 * It behaves like one and is spent like one — it fills from procs, holds twenty, and a brew empties
	 * ten of it — so it is read the same way and drawn the same way. The engine already tracks it for
	 * the bank chart, so this is the same numbers on a different clock rather than a second count.
	 *
	 * `TEB_CAP` rather than the pull's observed peak: a bank that never reached twenty still had twenty
	 * to reach, and scaling to the peak would draw a half-full bank as a full one.
	 */
	const brewBank = useMemo<ResourceCurve | null>(
		() =>
			analysis.brew.bankTimeline.length === 0
				? null
				: { max: TEB_CAP, points: analysis.brew.bankTimeline.map(([t, n]): [number, number] => [t, n]) },
		[analysis.brew.bankTimeline],
	);

	/**
	 * What each brew window spent, keyed by when it opened.
	 *
	 * The lane draws the window; this is what makes it worth looking at. A brew that went out on eight
	 * stacks and one that went out on ten are the same bar otherwise, and the difference is the whole
	 * argument of the Tigereye Brew section.
	 */
	const brewSpend = useMemo(() => {
		const by = new Map<number, number>();
		for (const use of analysis.brew.useList) {
			if (use.window === null) continue;
			by.set(use.window.start, (by.get(use.window.start) ?? 0) + use.consumed);
		}
		return by;
	}, [analysis.brew.useList]);
	// Measured from this pull's own readings, so a hasted monk is not charged at a stranger's rate.
	const energyRegen = analysis.energy?.regenPerSec ?? null;
	// Everything the engine measured, before the ignore table has had its say. Kept under its own name
	// because the caption has to be able to say what went, and it can only name what it was handed.
	const allCasts = analysis.timeline?.casts ?? NO_CASTS;
	// The set the engine drew by default, and the enemies it kept back behind the cap. Both truthiness
	// guards rather than null checks: on a fixture captured before either field existed they arrive as
	// `undefined`, which is the distinction this codebase has been bitten by twice.
	const allDrawnLanes = analysis.timeline?.lanes ?? NO_LANES;
	const allSpareLanes = analysis.timeline?.hiddenLanes ?? NO_LANES;
	// Minus the rows this report deliberately does not draw — `hidden.ts` holds which and why. Memoised
	// on the arrays they filter rather than computed inline: these identities are what every expensive
	// list below is keyed on, and a fresh array each render would rebuild several hundred marks on every
	// pointer move. The picker's set is filtered too, so a hidden lane cannot be offered back either.
	const casts = useMemo(() => drawnCastsOf(allCasts), [allCasts]);
	const drawnLanes = useMemo(() => drawnLanesOf(allDrawnLanes), [allDrawnLanes]);
	const spareLanes = useMemo(() => drawnLanesOf(allSpareLanes), [allSpareLanes]);
	const hidden = useMemo(() => hiddenNames([...allDrawnLanes, ...allSpareLanes]), [allDrawnLanes, allSpareLanes]);
	const deaths = analysis.timeline?.deaths ?? NO_DEATHS;
	const span = spanOf(analysis.durationMs);

	// All four are view state and none is persisted: which rows a reader is looking at right now is not
	// a preference about how the report should be scored, which is what `lib/settings` is for — that
	// module holds thresholds the analysis is *measured* with, and nothing here reaches a number.
	const [zoom, setZoom] = useState(DEFAULT_ZOOM);
	const [shown, setShown] = useState<Record<Toggle, boolean>>({ casts: true, buff: true, proc: true, debuff: true });
	const [grouping, setGrouping] = useState<Grouping>('auto');
	// Null is not "none picked": it is "not picked at all", which is what keeps the engine's own default
	// set the default. A `Set` of ids would have to be rebuilt — and kept in step — the moment the
	// analysis changed, and an empty one would draw no enemies at all.
	const [picked, setPicked] = useState<ReadonlySet<number> | null>(null);

	/**
	 * Every enemy the engine measured, drawn or not, in one list.
	 *
	 * `lanes` ++ `hiddenLanes` is the full per-target set in the engine's own order — the primary
	 * first, then by the damage each enemy took — because the cap cut that order in two and these are
	 * the two halves. Nothing here re-sorts it: the order is the debuff section's answer to "which
	 * enemy was this pull about", and a second opinion about that belongs in neither file.
	 */
	const targetLanes = useMemo(
		() =>
			[...drawnLanes, ...spareLanes].filter(
				(lane): lane is AuraLane & { target: LaneTarget } => lane.target !== undefined,
			),
		[drawnLanes, spareLanes],
	);
	const defaultTargets = useMemo(
		() => new Set(drawnLanes.flatMap((lane) => (lane.target === undefined ? [] : [lane.target.id]))),
		[drawnLanes],
	);
	const shownTargets = picked ?? defaultTargets;

	/**
	 * The lanes as this reader has asked for them: their pick of the enemies, collapsed if they said so.
	 *
	 * Everything downstream — the merge into press rows, the bars, the toggles, the tooltip — reads
	 * this rather than the engine's array, so an override is one list rebuilt and not a second code
	 * path through the chart.
	 */
	const lanes = useMemo(() => {
		const kept = [...drawnLanes, ...spareLanes].filter(
			(lane) => lane.target === undefined || shownTargets.has(lane.target.id),
		);
		return grouping === 'off' ? collapseTargets(kept, (aura) => t('castLog.target.mergedLane', { aura })) : kept;
	}, [drawnLanes, spareLanes, shownTargets, grouping, t]);

	/**
	 * The stretches the boss was out of reach, as the complement of engaged time.
	 *
	 * Not a row of its own: an intermission is not something the player did, and a lane for it would
	 * sit among twenty lanes that are. Shaded behind everything instead, which is what says "this is
	 * the fight's doing" without saying it in a colour that grades anything.
	 */
	const intermissions = useMemo(
		() =>
			// Contact with *anything*, falling back to the graded windows only on an analysis captured
			// before the wider measure existed. The two are not interchangeable: `engagedSegments` is
			// scoped to the primary target so Rising Sun Kick's uptime means something, and its complement
			// therefore reads "you were not on the boss". On Galakras that flagged 85% of the pull as
			// intermission — the player was fighting adds for most of it. Against every target the same
			// pull gives six segments and 27%, which is the add waves the reader actually watched.
			complementOf(
				analysis.debuff.contactSegments ?? analysis.debuff.engagedSegments ?? [],
				analysis.durationMs,
			).filter(([start, end]) => end - start >= MIN_INTERMISSION_MS),
		[analysis.debuff.contactSegments, analysis.debuff.engagedSegments, analysis.durationMs],
	);

	const drag = useDragScroll();
	const pxPerSec = ZOOM_LADDER[zoom] ?? ZOOM_LADDER[DEFAULT_ZOOM] ?? 24;
	const stepMs = tickStepMs(pxPerSec);
	// Room for two digits and a breath, converted from pixels into fight time at the current zoom —
	// which is the only place that conversion can be made, since the tracks are drawn proportionally.
	const labelGapMs = (18 / pxPerSec) * 1000;

	// The two expensive lists, built once per pull. A zoom step or a toggle re-renders this component
	// and hands React the very same element objects, so it skips them instead of reconciling hundreds
	// of nodes — which is the whole reason the geometry is percentages rather than pixels.
	// Lanes depend on zoom, because whether a lane needs a second sub-row is a question about pixels.
	// Still cheap beside rebuilding the marks: one pass over the presses, no elements created.
	//
	// The damaging set is built once per pull rather than per lane, so what the sort does is a lookup
	// and not a scan of the damage table for every button the player owns.
	const damaging = useMemo(() => damagingNames(analysis.damage.abilities), [analysis.damage.abilities]);
	const castLanes = useMemo(() => castLanesOf(casts, pxPerSec, damaging), [casts, pxPerSec, damaging]);
	const castNodes = useMemo(
		() => castLanes.map((lane): CastRow => ({ lane, nodes: castNodesOf(lane.casts, span, lane.rowOf) })),
		[castLanes, span],
	);
	// Which of those rows an aura has claimed. Split rather than rebuilt, so the marks a merged row
	// draws are the very element objects the memo above made and React skips them all the same.
	const pressed = useMemo(() => mergeRows(castNodes, lanes), [castNodes, lanes]);
	const laneRows = useMemo(
		() =>
			lanes.map((lane) => ({
				lane,
				// A lane the engine handed a counter is drawn as that counter instead of as a window. The
				// choice is the engine's, not this component's: a lane has a counter when the log actually
				// counted one, which is a question about events and not about how a row should look.
				bars:
					lane.stacks === undefined
						? barNodesOf(lane, span, lane.key === 'tigereye-brew' ? brewSpend : null)
						: chargeNodesOf(lane, lane.stacks, span),
			})),
		[lanes, span, brewSpend],
	);
	// Independent of zoom: the path is proportional, so a zoom step stretches it rather than rebuilding.
	const gcdRules = useMemo(() => gcdRulesPath(casts, span), [casts, span]);

	// The axis does depend on zoom — a tick every five seconds at the far end of the ladder — but it is
	// a couple of dozen nodes rather than a couple of hundred.
	const ticks = useMemo(() => {
		const out = [];
		for (let at = 0; at < span; at += stepMs) {
			out.push(
				<span
					key={at}
					style={{ left: pct(at, span) }}
					className="tabular absolute top-1 pl-1 font-mono text-sm text-muted"
				>
					{fmt(at)}
				</span>,
			);
		}
		return out;
	}, [span, stepMs]);

	/**
	 * One tooltip for the whole chart, moved to the pointer and filled from a hit test.
	 *
	 * The native `title` was here because a rendered tooltip is another element per mark and there are
	 * several hundred marks. That objection is about *per-mark* nodes and it is answered by having
	 * exactly one: every mark carries its content in `data-*` attributes, which are not elements, and
	 * `elementsFromPoint` at the cursor says which mark to read — the same technique `trackCursor` in
	 * `apex.ts` uses to work around ApexCharts' own hover resolution. The markup comes from `tip()`, so
	 * this is the tooltip the four ApexCharts charts already draw rather than a second design of one.
	 *
	 * Imperative, and outside React's render, for the same reason the marks are memoised: a pointer
	 * move is not a state change worth reconciling twenty rows for, and the content is only rebuilt
	 * when the mark under the cursor actually changes.
	 *
	 * The hovered mark's `title` is lifted off it while the styled tip covers it and put straight back
	 * on the way out. The attribute is the fallback for a reader whose pointer never fires — but left
	 * in place the browser raises its own tooltip on top of this one, which is the two-tooltip problem
	 * this replaces.
	 */
	const tipRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const scroller = drag.ref.current;
		const node = tipRef.current;
		if (scroller === null || node === null) return;
		// Resolved once: ApexCharts' markup writes colours as literal values, and the palette is a
		// stylesheet constant on a page that has no theme to switch to.
		const theme = readTheme();
		let over: { mark: Element; title: string } | null = null;

		const hide = () => {
			node.style.display = 'none';
			if (over !== null) over.mark.setAttribute('title', over.title);
			over = null;
		};

		const move = (event: PointerEvent) => {
			// The whole stack at that pixel rather than the topmost element, for the reason `trackCursor`
			// gives: a mark can be covered — here by the stack count printed inside a brew's bar — and a
			// single-element test would report nothing under a cursor that is plainly over something.
			const mark = document
				.elementsFromPoint(event.clientX, event.clientY)
				.map((el) => el.closest('[data-tip]'))
				.find((el): el is Element => el !== null);
			if (mark === undefined) {
				hide();
				return;
			}
			if (over?.mark !== mark) {
				hide();
				// Values on the mark, labels from the copy file: a press carries the moment it went out and
				// a window the two ends of it, which is exactly what the `title` used to say in one line.
				const rows: Array<[string, string]> = [];
				const at = mark.getAttribute('data-tip-at');
				const from = mark.getAttribute('data-tip-from');
				const to = mark.getAttribute('data-tip-to');
				// A death has a fourth thing to say — what landed the blow — and it is the one mark on the
				// chart that names another actor's spell rather than one of the player's own.
				const by = mark.getAttribute('data-tip-by');
				// A counter's block says how full it was; the discharge that emptied it says when it landed
				// and what it hit for. `landed` rather than `at`, because `at` is labelled "Pressed" and a
				// gem firing on its own is the one mark here nobody pressed.
				const charges = mark.getAttribute('data-tip-charges');
				const landed = mark.getAttribute('data-tip-landed');
				// How long the payoff took to arrive after the counter emptied, which is a fact about the
				// gem rather than about the chart — and the answer to "why does the meter stop early".
				const wait = mark.getAttribute('data-tip-wait');
				const hit = mark.getAttribute('data-tip-hit');
				if (at !== null)
					rows.push([t(mark.hasAttribute('data-tip-auto') ? 'castLog.tip.swing' : 'castLog.tip.at'), at]);
				if (landed !== null) rows.push([t('castLog.tip.landed'), landed]);
				if (charges !== null) rows.push([t('castLog.tip.charges'), charges]);
				if (from !== null) rows.push([t('castLog.tip.from'), from]);
				if (to !== null) rows.push([t('castLog.tip.to'), to]);
				if (by !== null) rows.push([t('castLog.tip.by'), by]);
				if (wait !== null) rows.push([t('castLog.tip.wait'), wait]);
				if (hit !== null) rows.push([t('castLog.tip.hit'), hit]);
				node.innerHTML = tip(theme, {
					title: mark.getAttribute('data-tip') ?? '',
					tone: (mark.getAttribute('data-tip-tone') ?? GROUP_TONE.casts) as keyof ChartTheme,
					rows,
				});
				over = { mark, title: mark.getAttribute('title') ?? '' };
				mark.removeAttribute('title');
				node.style.display = 'block';
			}
			// Below and right of the cursor, folded back inside the viewport at either edge. Measured
			// after the content is written, so this is the size the tip will actually have rather than
			// the one it had for the previous mark.
			const x = Math.min(event.clientX + TIP_OFFSET_PX, window.innerWidth - node.offsetWidth - TIP_OFFSET_PX);
			const y = Math.min(event.clientY + TIP_OFFSET_PX, window.innerHeight - node.offsetHeight - TIP_OFFSET_PX);
			node.style.left = `${Math.max(TIP_OFFSET_PX, x)}px`;
			node.style.top = `${Math.max(TIP_OFFSET_PX, y)}px`;
		};

		hide();
		scroller.addEventListener('pointermove', move);
		scroller.addEventListener('pointerleave', hide);
		return () => {
			scroller.removeEventListener('pointermove', move);
			scroller.removeEventListener('pointerleave', hide);
			hide();
		};
	}, [drag.ref, t, casts, lanes]);

	if (casts.length === 0 && lanes.length === 0) return <ChartEmpty>{t('castLog.empty')}</ChartEmpty>;

	// A toggle for a category the pull has nothing in would be a control that does nothing.
	const available: Record<Toggle, boolean> = {
		casts: casts.length > 0,
		buff: lanes.some((lane) => lane.group === 'buff'),
		proc: lanes.some((lane) => lane.group === 'proc'),
		debuff: lanes.some((lane) => lane.group === 'debuff'),
	};
	const label: Record<Toggle, string> = {
		casts: t('castLog.groups.casts'),
		buff: t('castLog.groups.buffs'),
		proc: t('castLog.groups.procs'),
		debuff: t('castLog.groups.debuffs'),
	};

	const showCasts = shown.casts && available.casts;
	/**
	 * How a merged row answers to two toggles at once.
	 *
	 * It is filed under both categories and drawn while *either* is on, because both halves are things
	 * the reader asked for by name. Its bars belong to the aura and go when the aura's toggle goes; its
	 * marks are the row itself — the label names the button, and a row named after a press with no
	 * press on it is a row about nothing — so they are drawn wherever the row is.
	 *
	 * That leaves both toggles honest and neither idle. Turning `casts` off still unmounts every button
	 * that puts nothing up, which on a real pull is most of the chart, and it no longer quietly empties
	 * a buff row the reader kept. Turning `buff` off takes the bars away and leaves the press lane
	 * exactly as it was before the merge.
	 */
	const shownRow = (lane: AuraLane): boolean => shown[lane.group] || (showCasts && pressed.into.has(lane.key));
	// Sorted here rather than in the engine: the order is a reading decision about this chart, and the
	// same lanes are consumed elsewhere by components that want them grouped their own way.
	//
	// The per-enemy block sinks first and by rule — see `perTargetBlock` — and `laneRank` orders what
	// is left inside each block. A stable sort, which is load-bearing now that several lanes share one
	// key: the engine emits the debuff's lanes primary-first by damage taken, and equal ranks have to
	// keep that order.
	const rows = laneRows
		.filter(({ lane }) => shownRow(lane))
		.sort(
			(a, b) =>
				Number(perTargetBlock(a.lane)) - Number(perTargetBlock(b.lane)) || laneRank(a.lane.key) - laneRank(b.lane.key),
		);

	// The one row drawn as a meter rather than as a bar, when the pull had one. Found by asking which
	// lane carries a counter rather than by naming the gem: the model decides which auras stack, and
	// nothing in this file has ever known a spell id.
	const charged = rows.find(({ lane }) => lane.stacks !== undefined)?.lane;

	/**
	 * The blocks of rows, in the order the chart reads: the player's own, then the enemies'.
	 *
	 * Split rather than merely sorted, because the cast lanes are drawn *between* them — in three runs
	 * now, since the aura rows land in two places rather than one and each of them is a seam the
	 * presses are threaded through. Sorting alone could never produce that: the loose presses below the
	 * aura rows are the player's rows as much as the buffs are, and a single sort would have left the
	 * per-enemy block above them, which is exactly the interleaving the rule exists to stop.
	 *
	 * A heading goes above each enemy's rows: the label in the gutter and the same row spent on nothing
	 * in the track, because the two columns are separate elements that line up only by agreeing on a
	 * height per row.
	 */
	type Block =
		| { key: string; head: LaneTarget; row?: never }
		| { key: string; head?: never; row: (typeof rows)[number] };
	const auraRows = rows.filter(({ lane }) => !perTargetBlock(lane));
	const targetRows = rows.filter(({ lane }) => perTargetBlock(lane));

	/**
	 * When an enemy is named above its rows.
	 *
	 * `auto` is the chart's own judgement and the default: only when the pull actually has more than
	 * one target, because on a single-target pull the heading spends a row of height repeating the
	 * boss's name that the report's header already says — and every reference pull is that case. The
	 * reader can overrule it in either direction, which is what `on` and `off` are; `off` has already
	 * collapsed the rows by the time this is read, so there is nothing left to head.
	 */
	const targetIDs = new Set(targetRows.flatMap(({ lane }) => (lane.target === undefined ? [] : [lane.target.id])));
	const headTargets = grouping === 'auto' ? targetIDs.size > 1 : grouping === 'on';
	const targetLabel = (target: LaneTarget): string => target.name ?? t('castLog.target.unnamed', { id: target.id });

	/**
	 * The aura rows, as the two blocks they are drawn in — `meleeBlock` is the whole of the division.
	 *
	 * Two filters over one already-sorted list rather than two sorts, so both blocks keep the order
	 * `laneRank` gave them and neither can disagree with it. The pinned block is a prefix of that list
	 * by construction, because a listed key outranks every unlisted one; the split is therefore a cut
	 * and not a reshuffle, and a lane cannot change its neighbours by changing its block.
	 */
	const pinnedBlocks: Block[] = auraRows
		.filter(({ lane }) => meleeBlock(lane))
		.map((row) => ({ key: row.lane.key, row }));
	const looseBlocks: Block[] = auraRows
		.filter(({ lane }) => !meleeBlock(lane))
		.map((row) => ({ key: row.lane.key, row }));
	const targetBlocks: Block[] = [];
	let heading: number | null = null;
	for (const row of targetRows) {
		const target = row.lane.target;
		if (target === undefined) heading = null;
		else if (headTargets && target.id !== heading) {
			targetBlocks.push({ key: `target-${target.id}`, head: target });
			heading = target.id;
		}
		// Several lanes share one aura key and differ only by the enemy they were measured on, so the
		// React key has to carry both — with the key alone React reconciles two enemies' rows into one.
		targetBlocks.push({ key: target === undefined ? row.lane.key : `${row.lane.key}@${target.id}`, row });
	}

	/**
	 * How many enemies carried the debuff and have no row on the screen.
	 *
	 * Two sources, because there are two ways to end up without a row. The reader may have unticked an
	 * enemy in the picker — that is the first term — and an analysis captured before the engine carried
	 * the lanes past its cap has a count with nothing behind it, which the second term recovers. On a
	 * current analysis the count and the carried lanes agree and the second term is zero.
	 */
	const hiddenCount = analysis.timeline?.hiddenTargets ?? 0;
	const undrawnTargets =
		targetLanes.filter(({ target }) => !shownTargets.has(target.id)).length +
		Math.max(0, hiddenCount - spareLanes.length);
	// Whether the collapse actually merged anything, which is when its caption has something to explain.
	const collapsed = grouping === 'off' && targetLanes.filter(({ target }) => shownTargets.has(target.id)).length > 1;

	/**
	 * The priority auras go directly under the melee lane, not after every ability, and melee itself
	 * does not move to accommodate them.
	 *
	 * Melee is the pull's metronome — it swings throughout, whatever else is happening — so a buff
	 * window read against it is read against a continuous line rather than against a lane with holes
	 * in it. Putting those auras below twenty ability lanes instead left the two things being compared
	 * a screen apart.
	 *
	 * It buys that adjacency for five rows and it is only worth the price for five. The claim is about
	 * *these* windows — the sequence `LANE_ORDER` names — and the price is that everything drawn
	 * between melee and them is pushed down a screen; paying it again for every item proc a character
	 * happens to be wearing would put a stack of trinket bars above the rotation the reader came to
	 * read. So the unlisted rows are drawn at the tier boundary instead, which is far enough down to
	 * be out of the rotation's way and close enough to the damage to still be read against it.
	 */
	// One definition per column, used by the block above the auras and the block below it — the two
	// have to be identical or a lane would change height depending on where it sat.
	const laneHeight = (lane: CastLane) => Math.max(ROW_PX, lane.rows * CAST_ROW_PITCH_PX);
	const castLabel = (lane: CastLane) => (
		<div key={lane.name} className={`flex items-center gap-2 pr-2 ${LANE_RULE}`} style={{ height: laneHeight(lane) }}>
			<SpellIcon id={lane.id} size="sm" />
			<span className="truncate font-mono text-sm text-ink-2" title={lane.name}>
				{lane.name}
			</span>
		</div>
	);
	const castTrack = ({ lane, nodes }: CastRow) => (
		<div key={lane.name} className={`relative ${LANE_RULE}`} style={{ height: laneHeight(lane) }}>
			{nodes}
		</div>
	);
	// A merged row is as tall as its presses need, which is the height the button had when it was a
	// lane of its own: two Tiger Palms inside an icon's width of each other still stack at the wide end
	// of the ladder, and a row that stopped stacking on merging would have lost the marks it packed.
	const rowHeight = (press: CastRow | undefined) => (press === undefined ? ROW_PX : laneHeight(press.lane));
	/**
	 * What a merged row is called.
	 *
	 * The ability first, because the row is a button now and the button is what the reader is scanning
	 * for. The aura keeps its name after it when the two differ — Tiger Palm puts up Tiger Power, and a
	 * row labelled only "Tiger Palm" leaves the bars under it unexplained. When the names agree, as
	 * they do for both brews, saying it twice is noise.
	 */
	const rowLabel = (lane: AuraLane, press: CastRow | undefined): string =>
		press === undefined || press.lane.name === lane.name
			? lane.name
			: t('castLog.mergedLane', { ability: press.lane.name, aura: lane.name });

	// One renderer per column, called for both blocks. Written out once because the aura block and the
	// per-enemy block below the casts have to be identical in every respect but where they sit — two
	// copies of this is how the gutter and the track stop agreeing about a row's height.
	const laneLabel = (block: Block) => {
		// The press that opens this row's windows, when one merged into it. Looked up in both columns
		// rather than carried on the block, because the two have to agree on the height and a row taking
		// its height from anywhere else is how the gutter drifts off the track.
		const press = block.head === undefined ? pressed.into.get(block.row.lane.key) : undefined;
		return block.head === undefined ? (
			<div
				key={block.key}
				// Indented under its heading when it has one, so the block reads as belonging to the
				// enemy named above it rather than as another aura in the same flat list.
				className={`flex items-center gap-2 pr-2 ${LANE_RULE} ${block.row.lane.target !== undefined && headTargets ? 'pl-3' : ''}`}
				style={{ height: rowHeight(press) }}
			>
				{/* The button's icon on a merged row, because the label leads with the button. */}
				<SpellIcon id={press?.lane.id ?? block.row.lane.id} size="sm" />
				<span className="truncate font-mono text-sm text-ink-2" title={rowLabel(block.row.lane, press)}>
					{rowLabel(block.row.lane, press)}
				</span>
			</div>
		) : (
			<div key={block.key} className={`flex items-baseline gap-2 pr-2 ${LANE_RULE}`} style={{ height: ROW_PX }}>
				<span className="truncate font-mono text-sm text-ink" title={targetLabel(block.head)}>
					{targetLabel(block.head)}
				</span>
				{/* Which of the enemies the graded uptime is about. Without it the reader has several
				    lanes and no way to tell which one the number beside the chart was measured on. */}
				{block.head.primary ? (
					<span className="shrink-0 font-mono text-xs text-muted" title={t('castLog.target.primaryTitle')}>
						{t('castLog.target.primary')}
					</span>
				) : null}
			</div>
		);
	};
	const laneTrack = (block: Block) => {
		const press = block.head === undefined ? pressed.into.get(block.row.lane.key) : undefined;
		return block.head === undefined ? (
			<div key={block.key} className={`relative ${LANE_RULE}`} style={{ height: rowHeight(press) }}>
				{/* The bars are the aura's half of the row and answer to the aura's toggle; the marks
				    are the row itself and are drawn wherever it is. Marks second, so an icon sits on
				    top of the bar it opened rather than under it. */}
				{shown[block.row.lane.group] ? block.row.bars : null}
				{press?.nodes}
			</div>
		) : (
			// The heading spends a row in the gutter, so the track spends the same row on nothing:
			// the two columns line up by agreeing on a height per row and by nothing else.
			<div key={block.key} className={LANE_RULE} style={{ height: ROW_PX }} />
		);
	};

	/**
	 * Ticking an enemy on or off.
	 *
	 * The first tick materialises the engine's default set, so the reader starts from what they were
	 * looking at rather than from an empty chart. Taken from the updater's argument rather than from
	 * `shownTargets` above it, which is what keeps two clicks in one frame from losing the first.
	 */
	const toggleTarget = (id: number) =>
		setPicked((current) => {
			const next = new Set(current ?? defaultTargets);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});

	/**
	 * The lines under the chart, as one caption.
	 *
	 * A `<figure>` may carry exactly one `<figcaption>`, so these are lines inside it rather than four
	 * of them. Each says something the reader can see on the chart and could not be expected to infer:
	 * what a collapsed row is claiming, which enemies are not drawn, what the shading is, and what the
	 * red rules are.
	 */
	const notes = [
		collapsed && shown.debuff ? t('castLog.target.mergedNote') : null,
		undrawnTargets > 0 && shown.debuff ? t('castLog.hiddenTargets', { count: undrawnTargets }) : null,
		intermissions.length > 0 ? t('castLog.intermission.note') : null,
		deaths.length > 0 ? t('castLog.death.note') : null,
		// A row drawn as a meter instead of as a bar is a different convention from every other row, and
		// one whose meter never fills needs saying out loud — otherwise the missing fifth charge reads as
		// a gap in the chart rather than as the discharge it actually is. `rows` is already the drawn
		// set, so a pull with the procs turned off does not describe a row that is not on the screen.
		charged?.stacks === undefined
			? null
			: t('castLog.charge.note', {
					aura: charged.name,
					max: charged.stacks.max,
					payoff: charged.stacks.payoff,
				}),
		// What the ignore table took out, named. A chart that silently drops a row is a chart claiming
		// the pull contained less than it did — the same fault the per-enemy cap is careful about, and
		// answered the same way: said in the caption rather than left for the reader to notice.
		hidden.length === 0 ? null : t('castLog.hiddenRows', { count: hidden.length, rows: hidden.join(', ') }),
	].filter((note): note is string => note !== null);

	/**
	 * The press lanes cut into the three runs the two aura blocks leave between them.
	 *
	 * Only the lanes that kept a row of their own — the rest are drawn on the aura they apply, in
	 * whichever block that aura sits in.
	 *
	 * `pressed.loose` arrives in one order and it is not re-sorted here: `castLanesOf` already sorted
	 * it by tier and then by press count, so both cuts below are slices of that one list and a lane
	 * cannot change its neighbours by landing in a different run. The first cut is melee, wherever
	 * press count put it — it keeps its place in the damaging tier and the pinned auras come to it,
	 * not the other way round. The second is the tier boundary: the last damaging lane and the first
	 * of the kit, which is where the ask puts the rest of the auras.
	 *
	 * `filter` on the tier rather than a second index, because the run after melee is only a prefix of
	 * tier 0 followed by the rest if the sort holds, and reading the tier back off each lane says what
	 * is meant without depending on that. It is a lookup in a `Set` per lane and there are twenty.
	 *
	 * With no melee lane at all — a hand-built fixture, a log with no swings — `slice(0, 0)` leaves
	 * the first run empty and every press falls into the two below, which is the honest answer: there
	 * is no metronome to pin anything under. Where the pinned block goes then is settled below.
	 */
	const meleeAt = pressed.loose.findIndex(({ lane }) => lane.id === MELEE_ID);
	const afterMelee = pressed.loose.slice(meleeAt + 1);
	const castsAbove = pressed.loose.slice(0, meleeAt + 1);
	const castsMid = afterMelee.filter(({ lane }) => tierOf(lane.name, damaging) === 0);
	const castsBelow = afterMelee.filter(({ lane }) => tierOf(lane.name, damaging) !== 0);
	/**
	 * Where the pinned block actually lands, and what happens when there is nothing to pin it to.
	 *
	 * Sitting under melee is the entire claim those five rows make, so on a pull with no melee lane
	 * the claim has no referent and the block falls to the tier boundary beside the rest rather than
	 * to the top of a chart it was never promised. Two blocks drawn in one place are one block, and
	 * `laneRank` has already ordered it end to end — so that case renders exactly the single aura
	 * block this chart drew before the split, which is what makes it a fallback and not a third
	 * layout to keep in step.
	 */
	const underMelee = meleeAt === -1 ? [] : pinnedBlocks;
	const atBoundary = meleeAt === -1 ? [...pinnedBlocks, ...looseBlocks] : looseBlocks;
	const trackPx = Math.max(320, (span / 1000) * pxPerSec);

	return (
		<figure className="m-0 flex flex-col gap-3.5">
			<div className="flex flex-wrap items-center gap-2">
				{TOGGLES.filter((key) => available[key]).map((key) => (
					<button
						key={key}
						type="button"
						aria-pressed={shown[key]}
						onClick={() => setShown((current) => ({ ...current, [key]: !current[key] }))}
						className={`${buttonClass} px-3 ${shown[key] ? 'border-kick text-ink' : 'text-muted'}`}
					>
						<i
							aria-hidden="true"
							className={`inline-block h-2.5 w-2.5 shrink-0 rounded-[2px] ${GROUP_SWATCH[key]} ${shown[key] ? '' : 'opacity-40'}`}
						/>
						{label[key]}
					</button>
				))}
				<span className="ml-auto flex items-center gap-2">
					<button
						type="button"
						className={`${buttonClass} px-3`}
						disabled={zoom === 0}
						aria-label={t('castLog.zoomOut')}
						title={t('castLog.zoomOut')}
						onClick={() => setZoom((z) => Math.max(0, z - 1))}
					>
						<span aria-hidden="true">&minus;</span>
					</button>
					<button
						type="button"
						className={`${buttonClass} px-3`}
						disabled={zoom === ZOOM_LADDER.length - 1}
						aria-label={t('castLog.zoomIn')}
						title={t('castLog.zoomIn')}
						onClick={() => setZoom((z) => Math.min(ZOOM_LADDER.length - 1, z + 1))}
					>
						<span aria-hidden="true">+</span>
					</button>
				</span>
			</div>

			{/* The two overrides on the per-enemy rows, and nothing at all on a pull that has none. Kept
			    off the row above so the categories and the zoom stay where a reader who never opens this
			    already knows to find them. */}
			{targetLanes.length === 0 ? null : (
				<div className="flex flex-wrap items-center gap-2">
					<span className="font-mono text-xs tracking-[0.1em] text-muted uppercase">
						{t('castLog.target.grouping')}
					</span>
					{GROUPINGS.map((mode) => (
						<button
							key={mode}
							type="button"
							aria-pressed={grouping === mode}
							title={t(`castLog.target.${mode}Title`)}
							onClick={() => setGrouping(mode)}
							className={`${buttonClass} px-3 ${grouping === mode ? 'border-kick text-ink' : 'text-muted'}`}
						>
							{t(`castLog.target.${mode}`)}
						</button>
					))}
				</div>
			)}

			{/* Which enemies get a lane. Only worth a control when there is a choice to make: one enemy is
			    the reference case and a picker over a list of one is a control that cannot change
			    anything. Closed by default — a thirty-add pull has thirty rows of chips, and the chart is
			    what the reader came for. */}
			{targetLanes.length < 2 ? null : (
				<details className="rounded-sm border border-line bg-surface px-3 py-2">
					<summary className="cursor-pointer font-mono text-sm text-ink-2">
						{t('castLog.target.pick', { drawn: shownTargets.size, total: targetLanes.length })}
					</summary>
					<p className="mt-2 mb-0 font-mono text-xs text-muted">
						{t('castLog.target.pickHint', { max: MAX_TARGET_LANES })}
					</p>
					<div className="mt-2 flex flex-wrap gap-2">
						{targetLanes.map(({ target }) => {
							const on = shownTargets.has(target.id);
							return (
								<button
									key={target.id}
									type="button"
									aria-pressed={on}
									// At the ceiling the unticked enemies stop being tickable rather than silently
									// replacing one of the drawn ones, which would be the chart choosing for the reader.
									disabled={!on && shownTargets.size >= MAX_TARGET_LANES}
									onClick={() => toggleTarget(target.id)}
									className={`${buttonClass} max-w-56 px-3 ${on ? 'border-kick text-ink' : 'text-muted'}`}
								>
									<span className="truncate">{targetLabel(target)}</span>
								</button>
							);
						})}
					</div>
				</details>
			)}

			<div className="flex gap-2">
				{/* The gutter sits outside the scroller so the names stay put while the clock moves. Row
				    heights are the same constant on both sides, which is what lines them up without anything
				    having to measure anything. */}
				<div className="w-28 shrink-0 sm:w-44">
					{/* One label per ability, matching the aura lanes below it: the same icon-and-name shape,
					    so the two halves of the chart read as one list rather than as two conventions. */}
					{resources === undefined
						? null
						: RESOURCE_LANES.map(({ key }) => (
								<div
									key={key}
									className={`flex items-center gap-2 pr-2 ${LANE_RULE}`}
									style={{ height: RESOURCE_ROW_PX }}
								>
									{/* A real anchor when the bar has a section arguing about it, so it middle-clicks
									    and keyboards like every other link on the page. `scroll-mt` on the headings
									    already keeps the landing clear of the sticky bar. */}
									{RESOURCE_LANES.find((l) => l.key === key)?.section == null ? (
										<span className="truncate font-mono text-sm text-ink-2">{t(`castLog.resource.${key}`)}</span>
									) : (
										<a
											href={`#${RESOURCE_LANES.find((l) => l.key === key)?.section}-heading`}
											onClick={(event) =>
												jumpToHeading(`${RESOURCE_LANES.find((l) => l.key === key)?.section}-heading`, event)
											}
											className="truncate rounded-sm font-mono text-sm text-ink-2 underline decoration-line underline-offset-4 transition-colors hover:decoration-kick hover:text-ink"
										>
											{t(`castLog.resource.${key}`)}
										</a>
									)}
									<span className="font-mono text-xs text-muted tabular-nums">{resources[key].max}</span>
								</div>
							))}
					{brewBank === null ? null : (
						<div className={`flex items-center gap-2 pr-2 ${LANE_RULE}`} style={{ height: RESOURCE_ROW_PX }}>
							<a
								href="#bank-heading"
								onClick={(event) => jumpToHeading('bank-heading', event)}
								className="truncate rounded-sm font-mono text-sm text-ink-2 underline decoration-line underline-offset-4 transition-colors hover:decoration-brew hover:text-ink"
							>
								{t('castLog.resource.brew')}
							</a>
							<span className="font-mono text-xs text-muted tabular-nums">{brewBank.max}</span>
						</div>
					)}
					{/* The player's own rows, in the five runs the two seams cut them into: the damage down to
					    melee, the auras pinned under it, the rest of the damage, the auras nobody pinned, and
					    then the kit and everything the fight asked for. The same five in the same order on the
					    track below — the columns line up by drawing the identical sequence and by nothing
					    else. */}
					{showCasts ? castsAbove.map(({ lane }) => castLabel(lane)) : null}
					{underMelee.map(laneLabel)}
					{showCasts ? castsMid.map(({ lane }) => castLabel(lane)) : null}
					{atBoundary.map(laneLabel)}
					{showCasts ? castsBelow.map(({ lane }) => castLabel(lane)) : null}
					{/* Last, and by rule rather than by accident — see `perTargetBlock`. Below the player's own
					    rows on both columns, so the two keep agreeing about which row is which. */}
					{targetBlocks.map(laneLabel)}
				</div>

				{/* `tabIndex` so the pull can be scrolled from the keyboard, and `role="img"` with a summary
				    for a reader who cannot see it — the same contract `ApexChart` gives its canvas. */}
				{/* The padding is on the scroller rather than on the track, and load-bearing: a mark starts
				    at its moment and runs rightwards, so a press in the last global of the pull would hang
				    past the end of the track and be sliced by the edge. Padding the track instead would move
				    the percentages the marks, the gridlines and the axis labels are all resolved against, and
				    they would stop agreeing. */}
				<div
					ref={drag.ref}
					onPointerDown={drag.onPointerDown}
					onPointerMove={drag.onPointerMove}
					onPointerUp={drag.onPointerUp}
					onPointerCancel={drag.onPointerUp}
					// `select-none` only while dragging: a drag across icons would otherwise select the text
					// in the lane labels, and the browser's own drag-select fights the pan.
					className={`min-w-0 flex-1 overflow-x-auto rounded-sm border border-line bg-surface px-3 ${
						drag.dragging ? 'cursor-grabbing select-none' : 'cursor-grab'
					}`}
					tabIndex={0}
					role="img"
					aria-label={t('castLog.aria', {
						duration: fmt(analysis.durationMs),
						casts: casts.length,
						abilities: new Set(casts.map((c) => c.id)).size,
						lanes: lanes.length,
					})}
				>
					<div
						className="relative"
						style={{
							width: trackPx,
							// No background grid.
							//
							// A rule every five, ten or fifteen seconds sits among marks that *are* events, so it
							// reads as one — a press with no icon, or an aura window too short to draw. The axis keeps
							// its labels below, and the only lines crossing the lanes are the globals actually spent,
							// which cannot be mistaken for anything else because that is exactly what they are.
						}}
					>
						{/* Behind every lane and across all of them, which is the point: a rule runs the full
						    height so a press can be read against every buff and proc row at once. `inset-0`
						    rather than a height, so it grows with the lanes as categories are toggled. */}
						<svg
							className="pointer-events-none absolute inset-0 h-full w-full"
							viewBox="0 0 1000 1"
							preserveAspectRatio="none"
							aria-hidden="true"
						>
							<path
								d={gcdRules}
								stroke="var(--color-line)"
								strokeWidth={1}
								vectorEffect="non-scaling-stroke"
								fill="none"
							/>
						</svg>
						{/* The intermissions, shaded behind every lane.

						    Behind, and in `muted` rather than in `miss`: the boss going out of reach is the
						    fight's script and never the player's doing, so it has to read as the ground the
						    pull was played on rather than as a stretch anyone is being charged for. A row of
						    its own would have made it one more thing that happened, in a column of rows that
						    are all things the player did.

						    The layer is inert and each band is not, so the hit test finds a band under an
						    empty stretch of track and finds the mark first everywhere else. */}
						{intermissions.length === 0 ? null : (
							<div className="pointer-events-none absolute inset-0">
								{intermissions.map(([start, end]) => (
									<span
										key={start}
										title={`${t('castLog.intermission.title')} · ${fmt(start)} → ${fmt(end)}`}
										data-tip={t('castLog.intermission.title')}
										data-tip-tone="muted"
										data-tip-from={fmt(start)}
										data-tip-to={fmt(end)}
										style={{ left: pct(start, span), width: pct(end - start, span) }}
										className="pointer-events-auto absolute inset-y-0 border-x border-line bg-muted/10"
									/>
								))}
							</div>
						)}
						{/* Above everything. The bars are the constraint the whole rotation is played against, so
						    they are what a reader scans first and what every lane below is measured against —
						    and being tallest, they anchor the eye rather than interrupting the lanes. Same clock
						    and same proportional geometry, so a peak lines up with the press that caused it. */}
						{resources === undefined
							? null
							: RESOURCE_LANES.map(({ key, stroke, fill, mode }) => (
									<div key={key} className={`relative ${LANE_RULE}`} style={{ height: RESOURCE_ROW_PX }}>
										<ResourceTrack
											curve={resources[key]}
											durationMs={span}
											stroke={stroke}
											fill={fill}
											mode={mode}
											minLabelGapMs={labelGapMs}
											// The stretches at the ceiling, in the colour every other section uses for a
											// loss. A full bar is not a fault by itself — it is one while there was
											// something to spend it on — so the shading says "here", and the Energy
											// section beside it is where the engaged-versus-downtime split is argued.
											shades={[
												{
													windows: lostIn(cappedOf(resources[key]), key, energyRegen),
													className: 'fill-miss/25',
													textClassName: 'text-miss',
													label: 'capped',
												},
											]}
											label={t(`castLog.resourceAria.${key}`, { max: resources[key].max })}
										/>
									</div>
								))}
						{brewBank === null ? null : (
							<div className={`relative ${LANE_RULE}`} style={{ height: RESOURCE_ROW_PX }}>
								<ResourceTrack
									curve={brewBank}
									durationMs={span}
									stroke="var(--color-rune)"
									fill="color-mix(in oklch, var(--color-rune) 18%, transparent)"
									// Stepped like chi, for the same reason: the bank holds whole stacks, and a slope
									// between two readings would draw a fraction of a stack nobody ever had.
									mode="steps"
									minLabelGapMs={labelGapMs}
									shades={[{ windows: cappedOf(brewBank), className: 'fill-miss/25', label: 'capped' }]}
									label={t('castLog.resourceAria.brew', { max: brewBank.max })}
								/>
							</div>
						)}
						{/* The same five runs the gutter draws, in the same order. */}
						{showCasts ? castsAbove.map(castTrack) : null}
						{underMelee.map(laneTrack)}
						{showCasts ? castsMid.map(castTrack) : null}
						{atBoundary.map(laneTrack)}
						{showCasts ? castsBelow.map(castTrack) : null}
						{targetBlocks.map(laneTrack)}
						<div className="relative" style={{ height: AXIS_PX }}>
							{ticks}
						</div>
						{/* The deaths, on top of everything and last in the source for that reason.

						    A rule across every lane rather than a mark in a row of its own, because a death is
						    not a thing that happened *on* one of these rows — it is the moment the rest of them
						    stop meaning anything. In `miss`, which is the one place on this chart colour says
						    more than which category a row belongs to, and it is not a verdict on the player:
						    nothing in this report grades a death. It is the loudest available explanation for a
						    lane that simply ends.

						    Named through the tooltip like every other mark, which is where `killingAbilityGameID`
						    arrives resolved. */}
						{deaths.map((death) => {
							const by = death.ability ?? t('castLog.death.unnamed');
							// A band, not a line. The death is an instant but what it costs is the stretch after
							// it, and a two-pixel rule drew a nine-minute corpse and a battle-res two seconds
							// later identically. It runs to the resurrection, or to the end of the pull when
							// none came — which is why the mark can be wider than everything else on the chart.
							const width = Math.max(0, death.until - death.t);
							return (
								<span
									key={death.t}
									title={`${t('castLog.death.title')} · ${fmt(death.t)} · ${by}`}
									data-tip={t('castLog.death.title')}
									data-tip-tone="miss"
									data-tip-at={fmt(death.t)}
									data-tip-to={death.resurrected ? fmt(death.until) : t('castLog.death.noRes')}
									data-tip-by={by}
									style={{ left: pct(death.t, span), width: pct(width, span) }}
									className="absolute inset-y-0 border-l-2 border-miss bg-[var(--color-band-miss)]"
								/>
							);
						})}
					</div>
				</div>
			</div>

			{/* What the chart is not showing, and what it is showing that is not a press — said out loud.
			    A chart that draws six of thirty enemies and says nothing is claiming the pull had six, and
			    a merged row nobody explains is a row that will be read as uptime. The two lines about the
			    debuff rows are conditional on those rows being on: with them hidden the sentences describe
			    rows that are not on the screen. */}
			{notes.length === 0 ? null : (
				<figcaption className="flex flex-col gap-1 font-mono text-xs text-muted">
					{notes.map((note) => (
						<span key={note}>{note}</span>
					))}
				</figcaption>
			)}

			{/* The chart's one tooltip, filled and moved by the effect above. `fixed` so the scroller's
			    own overflow cannot clip it, and `aria-hidden` because every mark still carries the same
			    sentence as a `title` — this is the pointer's copy of what is already there, not a second
			    source of it. */}
			<div ref={tipRef} aria-hidden="true" className="pointer-events-none fixed top-0 left-0 z-50" />
		</figure>
	);
}
