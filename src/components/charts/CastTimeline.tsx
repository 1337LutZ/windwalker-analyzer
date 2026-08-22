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

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { AuraWindow } from '~/lib/analysis/auras';
import { complementOf } from '~/lib/analysis/intervals';
import type {
	AbilityDamage,
	Analysis,
	AuraLane,
	CastMark,
	DeathMark,
	LaneGroup,
	LaneSpend,
	LaneStacks,
	LaneTarget,
	LaneWindow,
	ResourceBarAudit,
	Window,
} from '~/lib/types';
import { barColor, curveOfBar } from '~/lib/view/resourceBars';
import type { BankTone, TimelineBank } from '~/lib/view/timelineBanks';
import { specColorsOf } from '~/lib/view/specColors';

import { SpellIcon } from '../primitives';
import { buttonClass } from '../primitives/controls';
import { spellIconUrl } from '../primitives/spellIcon';
import { formatGap, formatStamp } from '~/lib/format';

import { fmt, n } from '../format';
import { jumpToHeading } from '../jump';
import { readTheme, tip, type ChartTheme, type TipRow } from './apex';
import ChartEmpty from './ChartEmpty';
import { GCD_ICON_PX, commitOf, packCasts } from './castRows';
import { DEFAULT_ZOOM, ZOOM_LADDER, tickStepMs, useDragScroll } from './scroll';
import ResourceTrack, { type Shade, type ShadeWindow } from './ResourceTrack';
import { cappedOf, emptiedOf } from './capped';
import { BAND } from './tones';
import { RESOURCE_TYPE } from '~/lib/game/resources';
import { HIDDEN_CASTS, drawnCastsOf, drawnLanesOf, hiddenNames } from './hidden';
import { collapseTargets, perTargetBlock } from './targetLanes';
import { useSpec } from '~/components/report/specContext';
import { led, rowRank } from './timelineOrder';
import type { Registry } from '~/lib/game/registry';

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
 * The icon a proc's payoff is marked with, deliberately smaller than a press.
 *
 * A press owns its row and fills it; a payoff shares a row with the charge that bought it, and at the
 * full 24px it covers the blocks it is supposed to be read against. This leaves the meter visible
 * underneath while staying big enough to recognise the spell by.
 */
const DISCHARGE_ICON_PX = 16;

/**
 * Vertical pitch of a stacked cast row: exactly the icon.
 *
 * No padding at all. The rule between lanes is what separates them, and any slack on top of it made
 * the icons look small in rows that were taller than they needed to be — the two complaints were the
 * same complaint.
 */
const CAST_ROW_PITCH_PX = GCD_ICON_PX;

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

/**
 * The same four categories a third time, as the CSS value a hatch is striped in — see `HATCH`.
 *
 * A third table for the reason `GROUP_TONE` is a second one and `BANK_COLOR` in `tones.ts` a fourth:
 * a `background-image` is an inline style rather than a class, so it needs the resolved token and not
 * the Tailwind spelling. `VAR` in `tones.ts` is keyed by `Tone` and has no entry for `ink2`, so it
 * cannot answer for a press row; this is keyed by the toggle, like the two tables above it.
 */
const GROUP_VAR: Record<Toggle, string> = {
	casts: 'var(--color-ink-2)',
	buff: 'var(--color-brew)',
	proc: 'var(--color-rune)',
	debuff: 'var(--color-kick)',
};

/**
 * The fill of a bar that is **entirely** an inference: stripes of the lane's own tone over the rail.
 *
 * Only a rung-3 window gets it — `preexisting` *and* `truncated`, which `auraWindows` explains is the
 * mark of a window the log never carried an event for at either end. Its evidence is the pull's
 * `combatantinfo` snapshot and nothing else, which is the weakest thing in the report, and a solid bar
 * says the same as one whose apply and removal are both in the log. A rung-2 bar keeps the solid fill:
 * its removal is a real event, so `[0, removal]` is time the aura provably held and only its left edge
 * is inferred — the tooltip's clock is the right place for that, and is where it already goes.
 *
 * **Stripes and not an alpha**, which is the rule `--color-band-*` in `styles/global.css` was written
 * to hold: a translucent fill takes its colour partly from whatever is under it, and under a lane bar
 * is the plot's surface in one place and a haste wash in another, so one alpha would draw two colours.
 * Both stops here are opaque. The gaps are `--color-track`, already documented in `tones.ts` as the one
 * tone that is not a judgement — a fainter tint of the lane's own colour would read as a weaker version
 * of the mechanic, which is a claim about the pull rather than about the evidence.
 *
 * Measured rather than eyeballed, at the current palette, per group and for both specs' primaries
 * (`kick` is derived from the spec's colour, the other two are fixed):
 *
 * | group  | tone            | stripe : gap    | stripe : surface | gap : surface |
 * | ---    | ---             | ---             | ---              | ---           |
 * | buff   | `#fbbf24`       | 7.33            | 9.59 / 10.41     | 1.31 / 1.42   |
 * | proc   | `#a78bfa`       | 4.50            | 5.88 / 6.39      | 1.31 / 1.42   |
 * | debuff | `kick`, derived | 10.06 / 4.53    | 13.16 / 6.44     | 1.31 / 1.42   |
 *
 * Two figures where they differ: Windwalker then Elemental. The load-bearing one is the first column —
 * the stripe against its own gap, worst case 4.50:1 — because that is what makes the bar read as
 * hatched rather than as a solid bar in a slightly odd colour. The third says a hatched bar is still
 * plainly a bar: the gaps sit lighter than the plot behind them, so the window's extent survives.
 *
 * 3px on 6px at 135°, which is the smallest period that still resolves two stripes inside the 2px
 * minimum width a bar can be drawn at.
 */
const HATCH_PERIOD_PX = 3;
const hatchOf = (group: Toggle): string =>
	`repeating-linear-gradient(135deg, ${GROUP_VAR[group]} 0 ${HATCH_PERIOD_PX}px, var(--color-track) ${HATCH_PERIOD_PX}px ${HATCH_PERIOD_PX * 2}px)`;

/**
 * The two literal spellings of a bank's palette token — see `BankTone`.
 *
 * A third and a fourth table for the same reason `GROUP_TONE` is a second one: a class Tailwind never
 * reads in source is a class it never generates, so `hover:decoration-${tone}` would silently draw no
 * underline at all, and the SVG stroke is a resolved value rather than a class and cannot share the
 * spelling either. The spec names the mechanic its counter belongs to; both spellings of it live here.
 */
const BANK_UNDERLINE: Record<BankTone, string> = {
	brew: 'hover:decoration-brew',
	rune: 'hover:decoration-rune',
	kick: 'hover:decoration-kick',
};

const BANK_COLOR: Record<BankTone, string> = {
	brew: 'var(--color-brew)',
	rune: 'var(--color-rune)',
	kick: 'var(--color-kick)',
};

/** How far the tip sits from the cursor: clear of the icon underneath without leaving the pointer. */
const TIP_OFFSET_PX = 14;

/**
 * One character of a label written inside a bar, in pixels — and the room left around it.
 *
 * The labels are `font-mono text-xs`, so a character is a fixed advance rather than something that
 * has to be measured per word. Measured in the browser rather than assumed: "Mastery" renders at
 * 46.19px in the stack's `ui-monospace` at 12px, which is 6.6px a character. The constant is **7**,
 * rounded up on purpose so the estimate errs towards calling a word too wide — the failure that
 * costs a reader a label they could have had, rather than the one that clips a word mid-glyph.
 * The padding is the 4px inset the label is drawn at, doubled, so a word that "fits" keeps the same
 * breath on its right as on its left instead of running flush into the end of the bar.
 *
 * Deliberately an estimate and not a measurement at render time. See `labelFits`: the report is
 * static HTML, there is no layout for the component to interrogate, and the whole point of the
 * conservative rounding is that being wrong is cheap.
 */
const LABEL_CHAR_PX = 7;
const LABEL_PAD_PX = 8;
/**
 * The gap between a bar's left edge and a label written inside it — the `pl-[4px]` this replaced.
 *
 * Named because it is now added to a variable inset rather than spelled into one Tailwind class, and a
 * bare `+ 4` beside `labelInsetPx` would read as arithmetic rather than as the edge it is.
 */
const LABEL_EDGE_PX = 4;

/** Stable identities for an absent timeline, so the memos below do not re-run on every render. */
const NO_CASTS: CastMark[] = [];
const NO_LANES: AuraLane[] = [];
const NO_DEATHS: DeathMark[] = [];
/** The same, for the haste windows, which arrive from an audit rather than from the timeline. */
const NO_HASTE: AuraWindow[] = [];

/**
 * One phase change of the boss's own script, on the fight's clock — what the marker layer draws.
 *
 * Deliberately not `FightPhase`. That type is the wire shape: its `startTime` is *report*-relative,
 * the same basis as `fight.startTime` and the odd one out on a chart where every other number is
 * measured from the bell. Converting once, into a type whose field is named `at` like every other
 * moment here, is what stops a report-relative millisecond being handed to `pct` — which would draw
 * the marker some fifty minutes past the end of the pull and look like the phase data being wrong.
 *
 * `isIntermission` is not carried, and that is a measurement rather than an oversight: it is `false`
 * on every phase in this expansion, including the Garrosh phase literally named "Intermission: Realm
 * of Y'shaarj" (see `lib/wcl/phases`). A field that is constant cannot distinguish anything, so the
 * marker does not pretend to read it.
 */
interface PhaseMark {
	/** The phase's own 1-indexed number, which repeats when a pull re-enters a phase. */
	id: number;
	/** Fight-relative ms. */
	at: number;
	name: string | null;
}
/** Stable identity for a pull WarcraftLogs reports no phases for, which is 6 of the 14 in this zone. */
const NO_PHASES: PhaseMark[] = [];

/**
 * One row of the phase gutter: 24px, the request's own number, and one row of the chart.
 *
 * One row rather than a full-height rule on purpose. A phase boundary is a fact about the boss and
 * not about any lane, so it has nothing to say all the way down the chart — and the three things that
 * *do* run full height (Bloodlust, the intermission shading, a death) each mean the stretch they
 * cover, which a boundary does not. Tied to `ROW_PX` because the point of 24px is that it is one
 * row's worth of annotation.
 *
 * **The gutter this measures is real vertical space, not an overlay.** It sits above the track and
 * pushes the whole chart down by its own height, so nothing the chart draws — a lane, a resource bar,
 * the haste wash, the intermission shading, a death band — is ever underneath a marker. That is what
 * lets the label always be drawn: it is not competing with anything for the pixels it needs.
 */
const PHASE_ROW_PX = ROW_PX;

/**
 * The phase marker's line and its label, in semi-transparent white.
 *
 * **Not one of the tones in `charts/tones.ts`, and that is the whole colour decision.** Every one of
 * those means something — `miss` is a fault, `brew`/`rune`/`kick` are mechanics, `lust` is the raid's
 * haste — and a phase boundary is not a judgement about the player at all. It is the boss's script.
 * The same argument put the exempt band on `track` rather than on a graded tone.
 *
 * **White through `ink` rather than through Tailwind's own `white`.** `--color-ink` *is* pure
 * `#ffffff` — `styles/global.css` says so in as many words — so these are the requested colour to the
 * bit, while staying inside the token layer the palette was validated in. Nothing in `src/components`
 * names a colour Tailwind's default theme supplies, and this is not the place to be first: the note on
 * the palette is that an addition judged by eye silently breaks the separation it was checked for.
 *
 * `track`, which the exempt band uses, is not available here for the reason `tones.ts` gives for
 * preferring it *there*: it is a ground, dark enough to sit *behind* rows. Nothing is behind these —
 * the gutter is empty space of its own — so what this needs is a mark and a reading colour, which is
 * what the text tokens are. The objection that retired `muted` was about painting a wide band in a
 * reading colour, not about a hairline and ten pixels of type.
 *
 * Semi-transparent rather than flat `ink` because the gutter is context and the pull is the subject.
 * `ink` is the strength body copy is set in; a rule and a name per phase at that weight would be the
 * loudest thing on a chart whose argument is entirely below them.
 *
 * **One element, and its own width.** The marker used to carry a fixed 8px hit box, because the label
 * was the thing that disappeared under crowding and a box sized by its contents would have lost the
 * name exactly when the tooltip became the only way to get it. The gutter retires that argument
 * outright — the label is always drawn now — so the box shrink-wraps the line and the text it
 * actually draws, which is the honest hit area for an annotation: what you can see is what you can
 * hover. `leading-6` is `PHASE_ROW_PX`, which is what centres the text in its own row while the box
 * itself runs on down to the chart.
 */
const PHASE_MARKER_CLASS =
	'pointer-events-auto absolute bottom-0 border-l border-ink/40 pl-1 font-mono text-[10px] leading-6 whitespace-nowrap text-ink/70';

/**
 * The vertical name written inside a haste band, so a wash alone does not have to name itself.
 *
 * Rotated about its top-left and set just inside the band's left rule, so it reads top-to-bottom
 * beside the rule rather than across it. Shared by the Bloodlust group and Berserking, which differ
 * only in the text colour.
 */
const HASTE_LABEL_CLASS =
	'pointer-events-none absolute top-3 left-3 origin-top-left rotate-90 font-mono text-[10px] leading-none whitespace-nowrap';

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
 * `contactSegments` is measured from direct damage, so a segment ends wherever the last hit landed
 * and a sliver either side of that boundary is the sampling rather than a phase — `DebuffTimeline`
 * draws the same complement and discards the same slivers. Three seconds rather than one: the pull
 * itself opens with a run-up before the first cast lands, and a sub-second lead-in is a player
 * pressing on the bell, not a phase worth a band across the whole chart.
 */
const MIN_INTERMISSION_MS = 3000;

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
 * The rows this chart leads with, top to bottom. One declared list, and the only place the order of
 * the leading rows is decided.
 *
 * **Why these, in this order.** It is the sequence a Windwalker reads a pull in, and it groups by the
 * question being asked rather than by what kind of row happens to answer it:
 *
 * - **Melee** first, because it is the pull's metronome. It swings throughout, whatever else is
 *   happening, so every window below it is read against a continuous line rather than against a lane
 *   with holes in it.
 * - **Re-Origination** next — what the pull was worth — then the four cooldowns that are pressed
 *   against it: the brew that snapshots it, the energy cooldown, the chi cooldown, and the cloak proc
 *   that pays for a spender. **Jab** sits inside that run, between the chi cooldown and the cloak
 *   proc, rather than down in the tail with the rest of the damage.
 * - Then **the rotation in priority order**: the kick and its debuff, then each generator beside the
 *   proc it hands out, then the two spenders, then the defensive that is also damage, then the talent
 *   row and the filler. A press and the proc it frees are adjacent on purpose — Tiger Palm above
 *   Combo Breaker: Tiger Palm — because that pairing is the one a reader checks press by press.
 *
 * **How a row answers to a name here.** By the label the gutter writes on it: the aura's own name, or
 * the name of the button drawn on it once a press has merged in. That is why "Rising Sun Kick" finds
 * the merged debuff row on a single-target pull and the bare press lane on an add pull, and why
 * "Tiger Palm" finds the row its Tiger Power draws — the reader is naming what they can see, and one
 * entry covers both shapes of the row rather than needing a spelling for each. Names rather than keys
 * for the same reason `damagingNames` and `ON_USE_NAMES` are keyed on names: the button is the thing,
 * and both of those tables already resolve it through the registry that supplies these strings.
 *
 * **It is a priority and not an enumeration.** An entry the pull has no row for contributes nothing —
 * which is how one talent-row-three slot serves all three of Chi Wave, Zen Sphere and Chi Burst
 * without the chart ever asking which was taken — and a row nobody named here keeps exactly the order
 * it already had, drawn after all of these: the rest of the damage, then the auras nobody ranked, then
 * the kit and the buttons the fight asked for. `tierOf` still owns that tail; this list only owns its
 * own head.
 */

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
 * The stroke and fill are deliberately not listed here but resolved where the track draws, from the
 * sim's own resource palette — a report's bars are the sim's colours, energy gold and chi green —
 * so this table carries only what is intrinsic to the bar: which key to read, how to draw it, and
 * which section argues about it.
 */
/**
 * The sections that argue about each bar, keyed by the bar's own key. A bar with no section gets no
 * jump link — the mana bar on an Elemental report has nothing to argue it, so its label is a span.
 */
const RESOURCE_SECTION: Readonly<Record<string, string>> = { energy: 'energy', chi: 'chi' };

/**
 * The resource lanes this pull actually carries, derived from the audited bars rather than hardcoded:
 * a pool (energy, mana) draws as a line, a points bar (chi) as steps.
 */
function resourceLanesOf(
	resources: Record<string, ResourceBarAudit> | undefined,
): Array<{ key: string; mode: 'line' | 'steps'; section: string | null }> {
	if (resources === undefined) return [];
	return Object.keys(resources).map((key) => {
		const bar = resources[key];
		return {
			key,
			mode: bar?.kind === 'pool' ? 'line' : 'steps',
			section: RESOURCE_SECTION[key] ?? null,
		};
	});
}

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
function lostIn(windows: readonly Window[], regenPerSec: number | null): ShadeWindow[] {
	return windows.map((w) => {
		// A points bar (chi) is never labelled: what a capped stretch cost is counted per press on the
		// curve itself, because chi arrives in whole points rather than accruing against a clock. A pool
		// bar (energy, mana) refills on a clock, so the stretch cost is its regen rate times its length.
		if (regenPerSec === null) return { ...w };
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
 * **At the commit, which is what "went out" means.** A rule used to be drawn at `c.t`, the landing,
 * while the icon it belongs to has always been drawn at the commit — so a two-second Lightning Bolt
 * put its own global two seconds to the right of its own icon, and reading straight up the line
 * answered a question nobody asked. `commitOf` is the shared answer; a fourth reader of this instant
 * should call it rather than write the arithmetic again.
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
		const x = ((commitOf(c) / span) * 1000).toFixed(3);
		d += `M${x} 0V1`;
	}
	return d;
}

/** A phase marker with its copy resolved and the row of the gutter its label was placed on. */
interface PlacedPhase {
	mark: PhaseMark;
	label: string;
	row: number;
}

/**
 * Which row of the phase gutter each label sits on, so that no two labels overprint.
 *
 * **Stagger rather than truncate, and the constraint that decided it the other way is gone.** While
 * the markers were an overlay, a second row of labels meant a second row of text over the resource
 * bar, so the rule was to drop the label and keep the line. The gutter owns its vertical space now:
 * another row costs the chart a few pixels of downward shift and costs the reader nothing, so the
 * question is only stagger versus clip.
 *
 * Truncating is the worse of the two *on this data specifically*, which is why this is not a matter of
 * taste. Siege of Orgrimmar names its phases "Stage One: Assault Mode" and "Stage Two: Siege Mode",
 * and Garrosh's are "Intermission: Realm of Y'shaarj" and "P2: Power of Y'shaarj" — pairs that share
 * a prefix and differ at the end. Clipping them to the room available yields "Stage O…" against
 * "Stage T…", which is the case `labelFits` already refuses for an aura's variant: a stub that has
 * thrown away the only distinguishing part is worse than no label, because it reads as information.
 * Staggering keeps every character of both.
 *
 * Greedy, in time order, first row whose last label has finished — the same shape as `packCasts`, and
 * deliberately not that function: it packs one fixed icon width and has a ceiling and an
 * overlap-of-last-resort because a pull holds hundreds of presses, whereas a label's width is its own
 * and an encounter in this zone reports at most six transitions. That bound is why there is no `MAX`
 * here: the row count cannot exceed the number of markers, which is single digits, and a cap would
 * only reintroduce overprinting for nothing.
 *
 * Width is estimated from the character count exactly as `labelFits` estimates it, and re-derived per
 * zoom for the reason `packCasts` gives: whether two labels collide is a question about pixels, and
 * the same two transitions clear each other at 48px/s and sit on top of each other at 3px/s.
 *
 * `labelled` must be in time order, which `resolveFightPhases` guarantees — a greedy fit only holds
 * if the items arrive in non-decreasing order of the key it compares.
 */
function placePhaseLabels(
	labelled: readonly { mark: PhaseMark; label: string }[],
	pxPerSec: number,
): { rows: number; placed: PlacedPhase[] } {
	const msPerPx = 1000 / pxPerSec;
	// The moment each row's last label finishes, in fight time.
	const freeAt: number[] = [];
	const placed = labelled.map(({ mark, label }) => {
		const widthMs = (label.length * LABEL_CHAR_PX + LABEL_PAD_PX) * msPerPx;
		const found = freeAt.findIndex((free) => mark.at >= free);
		const row = found === -1 ? freeAt.length : found;
		freeAt[row] = mark.at + widthMs;
		return { mark, label, row };
	});
	return { rows: Math.max(1, freeAt.length), placed };
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
const onUseNamesOf = (registry: Registry): ReadonlySet<string> =>
	new Set(registry.abilities.filter((a) => a.onUse === true).map((a) => a.name));

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
const tierOf = (name: string, damaging: ReadonlySet<string>, onUseNames: ReadonlySet<string>): number =>
	damaging.has(name) ? 0 : onUseNames.has(name) ? 1 : 2;

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
export interface CastLane {
	id: number;
	name: string;
	casts: CastMark[];
	rows: number;
	rowOf: Map<CastMark, number>;
}

function castLanesOf(
	casts: readonly CastMark[],
	pxPerSec: number,
	damaging: ReadonlySet<string>,
	onUseNames: ReadonlySet<string>,
): CastLane[] {
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
				tierOf(a.name, damaging, onUseNames) - tierOf(b.name, damaging, onUseNames) ||
				b.casts.length - a.casts.length ||
				(a.casts[0]?.t ?? 0) - (b.casts[0]?.t ?? 0),
		);
}

/**
 * `sentTo` turns a press's target into the sentence the tooltip shows, or into nothing.
 *
 * A function rather than a string on the mark because the wording is copy and this file is not where
 * copy lives — the component owns the `t` and hands the formatting down, exactly as the death marks
 * resolve their killer's name before it reaches an attribute.
 */
function castNodesOf(
	casts: readonly CastMark[],
	span: number,
	rowOf: Map<CastMark, number>,
	sentTo: (c: CastMark) => string | undefined,
) {
	return casts.flatMap((c) => {
		const url = spellIconUrl(c.id);
		const size = GCD_ICON_PX;
		// The enemy a press aimed at, where the press is one that aims. On the `title` as well as in the
		// tooltip: the attribute is the fallback for a reader whose pointer never fires, and a press whose
		// whole point is *which* enemy would otherwise say less to them than it does to everyone else.
		const target = sentTo(c);
		// The cast time rides on the `title` too — it is the one fact a cast-time press has that an
		// instant press does not, and a reader whose pointer never fires still deserves to see it.
		const castTime = c.castTimeMs === undefined || c.castTimeMs <= 0 ? undefined : formatGap(c.castTimeMs);
		const title = `${c.name} · ${formatStamp(c.t)}${castTime === undefined ? '' : ` · ${castTime}`}${target === undefined ? '' : ` · ${target}`}`;
		const key = `${c.t}-${c.id}`;
		// The icon's *left* edge is its moment, not its centre.
		//
		// A press occupies the global that begins when it goes out, so the icon should start on that
		// gridline and run into the global it spent — centred, every mark straddled its own line and two
		// lanes could not be read against each other, which is the whole point of drawing the grid. A
		// cast-time spell is the exception: its moment is the *start* of the cast, and the bar that
		// follows it is the cast itself, ending where the spell launches.
		const left = pct(c.t, span);
		// The icon's left edge, which is the moment the press *began* for a cast-time spell — a cancel
		// is already at its begincast, so its `t` is left as it is. Through `commitOf`, which is the same
		// instant `packCasts` reserves track from: the packer and the drawing have to agree or a lane
		// splits over marks that are nowhere near each other.
		const iconLeft = pct(commitOf(c), span);
		// Rows run downwards from the top of the lane, each one an icon box tall. `top` is the row's
		// centre and the mark is translated up by half itself, so it sits centred in its row rather
		// than hanging from the top of it.
		const top = (rowOf.get(c) ?? 0) * CAST_ROW_PITCH_PX + CAST_ROW_PITCH_PX / 2;

		// Nothing in the icon map answers for this id — a rare trinket, a racial. Drawn as a tick rather
		// than dropped: a hole in the lane would read as a global nobody spent, which is a claim about
		// the rotation that the log did not make. Shared by a completed cast and a cancel, so the button
		// reads as pressed either way.
		const icon =
			url === null ? (
				<span
					key={key}
					title={title}
					data-tip={c.name}
					data-tip-tone={GROUP_TONE.casts}
					data-tip-at={formatStamp(c.t)}
					data-tip-auto={c.id === MELEE_ID ? '' : undefined}
					data-tip-target={target}
					data-tip-cast={castTime}
					style={{ left: iconLeft, top, height: size }}
					className="absolute w-[3px] -translate-y-1/2 rounded-[1px] bg-muted"
				/>
			) : (
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
					data-tip-at={formatStamp(c.t)}
					// Auto-attacks are not pressed, so the tooltip must not say they were. Marked on the mark
					// rather than decided in the tooltip, which has no business knowing which id is melee.
					data-tip-auto={c.id === MELEE_ID ? '' : undefined}
					// Which enemy this press aimed at, on the one button whose whole point is the answer.
					data-tip-target={target}
					data-tip-cast={castTime}
					width={size}
					height={size}
					loading="lazy"
					decoding="async"
					style={{ left: iconLeft, top, width: size, height: size }}
					className="absolute -translate-y-1/2 rounded-[3px] border border-line/60"
				/>
			);

		// A cancelled cast: the icon still shows, with a red bar running *forward* from it at the length
		// the cast would have needed — the press happened, and bought nothing.
		if (c.cancelled === true) {
			const castTimeMs = Math.max(c.castTimeMs ?? 0, 0);
			return [
				<span
					key={`${key}-cancel`}
					title={`${title} · ${formatGap(castTimeMs)}`}
					data-tip={c.name}
					data-tip-tone="miss"
					data-tip-at={formatStamp(c.t)}
					data-tip-cancelled=""
					data-tip-cast={formatGap(castTimeMs)}
					style={{ left, top, width: pct(castTimeMs, span), height: size }}
					className="absolute -translate-y-1/2 min-w-[2px] rounded-[2px] bg-miss/50"
				/>,
				icon,
			];
		}

		// The cast bar behind the icon, from the `begincast` to the `cast`. Only a cast-time spell has
		// one — an instant press draws the icon alone. The bar's left edge is the moment the cast began,
		// so a Lightning Bolt reads as an icon at the start, followed by the bar running to the launch.
		const bar =
			c.castTimeMs === undefined || c.castTimeMs <= 0 ? null : (
				<span
					key={`${key}-bar`}
					title={title}
					data-tip={c.name}
					data-tip-tone={GROUP_TONE.casts}
					data-tip-at={formatStamp(c.t)}
					data-tip-cast={formatGap(c.castTimeMs)}
					style={{ left: iconLeft, top, width: pct(c.castTimeMs, span), height: size }}
					className="absolute -translate-y-1/2 min-w-[2px] rounded-[2px] bg-ink-2/40"
				/>
			);

		return bar === null ? [icon] : [bar, icon];
	});
}

/** A cast lane and its marks, which travel together whether the lane keeps its row or joins an aura's. */
export interface CastRow {
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
const appliedByCastOf = (registry: Registry): Map<number, string> => {
	const by = new Map<number, string>();
	for (const aura of registry.auras) {
		if (aura.appliedBy === undefined) continue;
		// First claim wins, so an ability that applies two auras lands on one row rather than being
		// silently redrawn on whichever the spec happened to declare last.
		for (const id of registry.ability(aura.appliedBy).castIds) if (!by.has(id)) by.set(id, aura.key);
	}
	return by;
};

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
 * A merged row is one row and never two, which is the whole of what this settles. Where it then sits
 * is `ROW_ORDER`'s answer where the order names it — by the aura's name or by the button's, so either
 * spelling finds it — and the aura block's answer where it does not: it has a foot in both systems, it
 * is a cast lane and an aura lane at once, and the tiebreak goes to the aura for a reason about what
 * the row *shows*. What is drawn across its whole width is a window, and a window is only worth
 * anything read against the other windows, so sorting an unnamed one by its button's tier would
 * scatter the aura rows by something the reader cannot see on them.
 *
 * Both directions of that are visible on the reference pulls and both are wanted. Tigereye Brew and
 * Energizing Brew are pressed off the global and do no damage at all, so a tier sort would sink them
 * to the foot of the chart, away from the Re-Origination row the whole snapshot argument is read
 * against; the order names them instead. Synapse Springs is the opposite — a kit press whose buff
 * nobody named — and its row stays with the aura block at the tier boundary rather than sinking to
 * the consumables. That is one row's worth of movement for the button and it buys the aura rows
 * staying one list.
 */
export function mergeRows(pressed: readonly CastRow[], lanes: readonly AuraLane[], appliedByCast: Map<number, string>) {
	const lanesPerKey = new Map<string, number>();
	for (const lane of lanes) lanesPerKey.set(lane.key, (lanesPerKey.get(lane.key) ?? 0) + 1);

	/**
	 * The lane a press shares a *name* with, for an aura no single button owns.
	 *
	 * `appliedBy` cannot answer for Bloodlust, and that is deliberate rather than an omission: the aura
	 * is declared across five ids because the rotation only cares that raid haste is up, not which class
	 * brought it (`shared.ts`, the `bloodlust` block). No one button applies it, so the model has nothing
	 * to point `appliedBy` at — and the press and the window were drawn as two rows with one name.
	 *
	 * Matching on the name is what the summary timeline already does for every row it builds
	 * (`LanesTimeline`'s `buildRows` keys its map by `lane.name`), so this makes the two charts agree
	 * rather than inventing a rule. `null` marks a name two different keys claim, which must not merge —
	 * the same caution `lanesPerKey` applies in the other direction.
	 */
	const keyByName = new Map<string, string | null>();
	for (const lane of lanes) {
		const seen = keyByName.get(lane.name);
		if (seen === undefined) keyByName.set(lane.name, lane.key);
		else if (seen !== lane.key) keyByName.set(lane.name, null);
	}

	const into = new Map<string, CastRow>();
	const loose: CastRow[] = [];
	for (const press of pressed) {
		// The model's answer first, the name only when it has none: an `appliedBy` that disagrees with a
		// shared name is the model being explicit, and it wins.
		const key = appliedByCast.get(press.lane.id) ?? keyByName.get(press.lane.name) ?? undefined;
		// `into.has` guards a loss rather than an impossibility: two cast lanes claiming one aura would
		// overwrite each other, and the marks of whichever lost would leave the chart without a trace.
		if (key !== undefined && lanesPerKey.get(key) === 1 && !into.has(key)) into.set(key, press);
		else loose.push(press);
	}
	// `lanesPerKey` travels out with the split rather than being counted again beside it. "Exactly one
	// lane carries this key" is the question the merge turns on, and it is the same question the
	// single-target debuff row turns on below — two counts of it would be two answers free to disagree.
	return { into, loose, lanesPerKey };
}

/**
 * Whether a word written inside a bar will fit inside that bar, at this zoom.
 *
 * The bars are drawn as percentages of a track whose width is `max(320, span/1000 * pxPerSec)`, so a
 * window's width in *pixels* is its length in seconds times the zoom — independent of the viewport,
 * because the track scrolls rather than shrinking. That is what makes this answerable at render time
 * on a page with no layout to measure: the report is static HTML, and there is no pass in which the
 * component could ask the DOM how wide anything came out.
 *
 * The 320px floor is ignored on purpose. It only binds on a pull shorter than `320 / pxPerSec`
 * seconds — under two minutes at the widest zoom, which no boss pull is — and when it does bind the
 * real bar is *wider* than this reckons, so the error is a label withheld rather than one that
 * spills.
 *
 * **Nothing is abbreviated when it does not fit.** A stat name cut to "Mas" or "H" is a mark a reader
 * has to decode, and the three answers here — Crit, Haste, Mastery — are close enough in kind that a
 * stub reads as a guess. The window keeps its `title` and its tooltip row either way, so the fact is
 * never lost; it moves from the bar to the pointer. Re-Origination runs ten seconds, which clears
 * even the longest of the three at every zoom step but the widest.
 */
function labelFits(label: string, ms: number, pxPerSec: number, insetPx = 0): boolean {
	return (ms / 1000) * pxPerSec >= label.length * LABEL_CHAR_PX + LABEL_PAD_PX + insetPx;
}

/**
 * One lane's windows, as bars. Width is a percentage too, so zoom never touches them.
 *
 * `notes` labels a bar with a number when the lane has one worth carrying — the spec supplies them
 * per lane (`SpecDefinition.timelineNotes`), and the Windwalker's Tigereye Brew is the one lane with
 * any today: the stacks a brew spent are what separate a brew worth pressing from one that was not,
 * and they are invisible from the bar's length alone.
 *
 * `spentAs` does the same job for a lane the engine handed a verdict per window: an aura that is
 * cashed in rather than waited out draws the same bar whether a press took it or the clock did, and
 * naming the press is the only thing that separates the two. It formats rather than decides — the
 * pairing is the engine's, and this turns its answer into the copy for it — and it answers
 * `undefined` for every lane and every window that has none, which is all of them but one.
 *
 * `pxPerSec` is the current zoom, and it is here for one reason: a window that carries a `variant`
 * gets that variant written inside its bar, and whether the word fits is a question about pixels
 * that only the zoom can answer. See `labelFits`.
 *
 * `preexisting` is the one window flag that changes what a bar *says* rather than only how long it
 * is. It means the aura was already running when the pull started, so the bar's left edge is the
 * fight's zero and not an event — a pre-pull potion is the case, and there is no press icon above it
 * because the press happened before this fight's event stream begins. Left as an ordinary bar in
 * every other respect: colour on this chart marks the category and a fourth treatment here would be
 * a new visual grammar for one row. The correction is made where the bar makes its claim, which is
 * the clock in the tooltip, and the missing icon is explained once in the caption.
 *
 * **`preexisting` *with* `truncated` is the one bar that is drawn differently**, and that pair is not
 * a longer version of the paragraph above: `auraWindows` records that no event-derived window can
 * carry both, so it identifies a window the log holds no event for at either end. Its whole evidence
 * is the pull's `combatantinfo` snapshot — the weakest thing in the report — and the argument above,
 * that the tooltip is where a wrong-looking left edge gets corrected, does not survive a bar whose
 * *right* edge is inferred too. So it is hatched (`hatchOf`) and it says which rung it is in words
 * (`inferredLabel`), because a bar that merely looks different tells a reader that something is
 * different without telling them what.
 */
function barNodesOf(
	lane: AuraLane,
	span: number,
	notes: ReadonlyMap<number, number> | undefined,
	spentAs: (spend: LaneSpend) => { text: string; icon: string | null },
	pxPerSec: number,
	prePullLabel: string,
	inferredLabel: string,
	/**
	 * How far in from the bar's left edge a written label has to start.
	 *
	 * Non-zero on a row that also draws press icons, because those are painted **after** the bars — on
	 * purpose, so an icon sits on top of the bar it opened rather than under it — and a label at the
	 * bar's own left edge then ends up behind the icon of the very press that opened the window. Synapse
	 * Springs is the case that showed it: it gained `variants`, so it started writing a stat name into a
	 * bar whose first 24 pixels were already spoken for.
	 *
	 * Fed to `labelFits` as well as to the padding, or the estimate would keep saying a word fits in room
	 * the icon has taken.
	 */
	labelInsetPx = 0,
) {
	// Keyed on the window's own start, which is what the engine identified each verdict by — the same
	// key `notes` above is keyed on, and sound for the same reason: two windows of one aura cannot open
	// on the same millisecond unless the aura logs under several ids, and this one logs under one.
	const spent = new Map((lane.spent ?? []).map((s) => [s.start, spentAs(s)]));
	return lane.windows.map((w: LaneWindow) => {
		const fate = spent.get(w.start);
		// Written inside the bar when there is room for it, and never truncated to a stub — see
		// `labelFits` for why a clipped stat name is worse than none.
		const label =
			w.variant !== undefined && labelFits(w.variant, w.end - w.start, pxPerSec, labelInsetPx) ? w.variant : null;
		// What the bar's left edge means. `0:00.000` is the one stamp on this chart that can be a lie:
		// on a window the aura brought into the fight it is where the drawing had to start, not where
		// anything happened, and the words say so instead.
		const from = w.preexisting === true ? prePullLabel : formatStamp(w.start);
		// The rung-3 test, and it is the pair rather than either flag — see the note above the function.
		const inferred = w.preexisting === true && w.truncated === true;
		return (
			<span
				// Both ends, not just the start: an aura logged under several ids — Re-Origination is one —
				// can open two windows on the same millisecond, and React would then see a duplicate key.
				key={`${w.start}-${w.end}`}
				// The verdict rides on the `title` as well, so the reader whose pointer never fires is told
				// what spent the window rather than only when it opened and closed. The variant rides on it
				// for the same reason and one more: it is the only thing the reader gets when the bar was too
				// narrow to write it in, and that is the common case at the wide end of the zoom ladder.
				title={`${lane.name}${w.variant === undefined ? '' : ` · ${w.variant}`} · ${from} → ${formatStamp(w.end)}${inferred ? ` · ${inferredLabel}` : ''}${fate === undefined ? '' : ` · ${fate.text}`}`}
				// The aura's own name, which is the half of a merged row's label that the gutter may have
				// truncated — and on a row named after the button, the only place the aura is named at all.
				data-tip={lane.name}
				data-tip-tone={GROUP_TONE[lane.group]}
				// Which of the aura's ids opened this window, in words — the stat a Re-Origination proc
				// converted into. A row of its own rather than part of the title, because the title is the
				// aura and this is a fact about the one window under the cursor. Absent on every window that
				// has no variant, which React handles by omitting the attribute entirely.
				data-tip-stat={w.variant}
				data-tip-from={from}
				data-tip-to={formatStamp(w.end)}
				// What became of this window. Two attributes rather than one, because the icon is markup and
				// the text is not: the shared tooltip assembles them, and a mark that carried the markup would
				// be carrying an element again — which is the objection the whole `data-*` design answers.
				data-tip-spent={fate?.text}
				data-tip-spent-icon={fate?.icon ?? undefined}
				// Where this window came from, in words, and only on the one rung that needs saying: a bar with
				// no logged endpoint at either end. Already worded, like `sentTo` and `spentAs` — the reading of
				// the flags belongs here, beside the drawing they change, and not in the tooltip that shows it.
				data-tip-evidence={inferred ? inferredLabel : undefined}
				style={{
					left: pct(w.start, span),
					width: pct(Math.max(w.end - w.start, 0), span),
					// Painted over the group's solid fill rather than instead of it, so a browser that draws no
					// gradient falls back to today's bar rather than to a lane of bare rail.
					...(inferred ? { backgroundImage: hatchOf(lane.group) } : {}),
				}}
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
				{label === null ? null : (
					// The stat the window converted into, written on the window itself.
					//
					// Same treatment as the brew's stack count above and for the same argument: three
					// Re-Origination procs draw three identical bars, and which stat came back is the entire
					// reason the buff is worth looking at. `text-bg` on the lane's own fill rather than a new
					// colour — the proc violet is `#a78bfa` against a `#0d1311` ground, which is 6.9:1, and a
					// fourth accent would be a colour claiming a meaning the palette has not got.
					//
					// `inset-0` with `overflow-hidden` is the guarantee rather than the layout: `labelFits`
					// has already decided the word belongs here, and this is what makes a wrong estimate clip
					// at the bar's edge instead of spilling across the lane onto its neighbours.
					<span
						className="pointer-events-none absolute inset-0 flex items-center overflow-hidden font-mono text-xs leading-none font-semibold text-bg"
						style={{ paddingLeft: labelInsetPx + LABEL_EDGE_PX }}
					>
						{label}
					</span>
				)}
			</span>
		);
	});
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
				title={`${lane.name} · ${formatStamp(step.start)} → ${formatStamp(step.end)}`}
				data-tip={lane.name}
				data-tip-tone={GROUP_TONE[lane.group]}
				data-tip-charges={`${step.stacks}/${stacks.max}`}
				data-tip-from={formatStamp(step.start)}
				data-tip-to={formatStamp(step.end)}
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
					title={`${stacks.payoff} · ${formatStamp(hit.from)} → ${formatStamp(hit.t)}`}
					data-tip={stacks.payoff}
					// The aura's own tone, not the mark's: this is the charge still being spent, and colour
					// here says which category a row belongs to rather than what kind of mark it is.
					data-tip-tone={GROUP_TONE[lane.group]}
					data-tip-landed={formatStamp(hit.t)}
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
				title: `${stacks.payoff} · ${formatStamp(hit.t)} · ${n(hit.amount)}`,
				'data-tip': stacks.payoff,
				// `landed` and not `at`: `at` is labelled "Pressed", and nobody pressed this — it is what
				// the gem did on its own once the counter filled.
				'data-tip-landed': formatStamp(hit.t),
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
 * What a bank shades behind its curve — the two ways a fault can reach the drawing, in the order they
 * are painted.
 *
 * The ceiling first, where the bank says sitting at it is a loss, then whatever windows the spec worked
 * out for itself. Two shades and not one merged list: they are different claims and they are keyed
 * separately, so a bank that draws both has one rect per fault rather than a collision on the key.
 *
 * `undefined` for a bank with neither, rather than an empty array, so the track's own default applies
 * and a spec with nothing to say cannot be told apart from one that said nothing.
 */
function bankShadesOf(bank: TimelineBank): Shade[] | undefined {
	const shades: Shade[] = [];
	if (bank.ceilingIsWaste) shades.push({ windows: cappedOf(bank.curve), className: 'fill-miss/25', label: 'capped' });
	const faults = bank.faultWindows ?? [];
	// The same band tone the section that argues this bank paints its faults in, rather than the wash
	// above: the reader compares the two charts, and one claim drawn in two reds reads as two claims.
	if (faults.length > 0) {
		// `textClassName` and not the track's muted default: a fault's note is part of the fault, and the
		// section that argues this bank writes the same number in the same red.
		shades.push({ windows: faults, className: BAND.miss.fill, textClassName: BAND.miss.text, label: 'fault' });
	}
	return shades.length === 0 ? undefined : shades;
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
	// The spec's own game model, for the tier sort and the aura-merge table. A Windwalker and an
	// Elemental pull name different buttons, and both read through their own registry.
	const spec = useSpec();
	const registry = spec.registry;
	const rowOrder = spec.timelineRowOrder;
	const onUseNames = useMemo(() => onUseNamesOf(registry), [registry]);
	const appliedByCast = useMemo(() => appliedByCastOf(registry), [registry]);
	/**
	 * The spec-audited half of an `Analysis`, read as the optional thing it is at runtime.
	 *
	 * No cast, and that is the point: `Analysis` is `AnalysisCore & SpecAuditResult`, `SpecAuditResult`
	 * happens to be the *Windwalker's* shape, and an Elemental pull is the same type carrying none of
	 * it — so TypeScript promises `debuff` is there and the runtime does not. `Partial` is the honest
	 * reading of that and it is a plain assignment, where this used to be an `as unknown as` through a
	 * hand-written shape. One field is left: a fallback for reports captured before the core carried a
	 * contact clock of its own. Everything else this chart read out of one spec's audit now arrives
	 * through that spec's definition, below.
	 */
	const specAudit: Partial<Pick<Analysis, 'debuff'>> = analysis;
	const resources = analysis.resources;
	/**
	 * The counters drawn above the rows, from the spec's own definition.
	 *
	 * A bank is not something this chart can derive: the Windwalker banks Tigereye Brew stacks and the
	 * Elemental charges Lightning Shield, each against a ceiling that comes out of its own game model,
	 * and how a full one reads is a claim about that spec's economy. So the chart takes a list and draws it — one row in the
	 * gutter and one track for each, in the order it was handed them — and a spec with no counter hands
	 * back nothing rather than being special-cased here.
	 */
	const banks = useMemo<TimelineBank[]>(() => spec.timelineBanks(analysis), [spec, analysis]);

	/**
	 * The figures written into another lane's bars, keyed by lane — the stacks each Tigereye Brew spent.
	 *
	 * From the definition for the same reason the banks are: this used to be one spec's audit read
	 * through a cast and handed to whichever lane matched that spec's own aura key, in a chart both
	 * specs draw. A spec with no such figure answers with an empty map, and `barNodesOf` labels nothing.
	 */
	const laneNotes = useMemo(() => spec.timelineNotes(analysis), [spec, analysis]);
	// The resource lanes this pull carries, derived from the audited bars — a pool draws as a line, a
	// points bar as steps, and each bar's regen is read off its own audit below.
	const resourceLanes = useMemo(() => resourceLanesOf(resources), [resources]);
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
	// Casts the player started and never finished, folded into the same lanes as the casts they were
	// — a cancelled Lightning Bolt belongs in the Lightning Bolt row, drawn as a red bar there.
	const cancels = analysis.timeline?.cancels ?? NO_CASTS;
	const castMarks = useMemo(() => (cancels.length === 0 ? casts : [...casts, ...cancels]), [casts, cancels]);
	const drawnLanes = useMemo(() => drawnLanesOf(allDrawnLanes), [allDrawnLanes]);
	const spareLanes = useMemo(() => drawnLanesOf(allSpareLanes), [allSpareLanes]);
	const hidden = useMemo(() => hiddenNames([...allDrawnLanes, ...allSpareLanes]), [allDrawnLanes, allSpareLanes]);
	const deaths = analysis.timeline?.deaths ?? NO_DEATHS;
	/**
	 * The raid's haste cooldown, detected by the core rather than by any one spec's audit — so an
	 * Elemental pull shades it exactly as a Windwalker's does. Truthiness rather than a null check, for
	 * the reason every optional field on an analysis carries: on a fixture captured before the core
	 * detected it, it arrives as `undefined`.
	 */
	const haste = analysis.timeline?.hasteWindows ?? NO_HASTE;
	/** The Troll racial's own haste burst, drawn as a second, lighter band beside Bloodlust. */
	const berserking = analysis.timeline?.berserkingWindows ?? NO_HASTE;
	/**
	 * Which of the five a window actually was.
	 *
	 * The spec models one aura across five ids on purpose — the rotation's condition is "any of them",
	 * so a raid with a mage instead of a shaman must not read as having no haste cooldown — and
	 * `variants` is the half of that which remembers the difference. Read per window rather than once
	 * for the pull, so a night that took Drums after a Time Warp names each band for itself.
	 *
	 * The fallback is a word rather than a guess: an id the model does not name is still a haste
	 * cooldown, and calling it Bloodlust because that is the commonest of the five would be the chart
	 * inventing which class was in the raid.
	 */
	const lustName = (w: AuraWindow): string => w.variant ?? t('castLog.lust.unnamed');
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
			// Contact with *anything*, from the core's own clock — falling back to the Windwalker's graded
			// segments only on an analysis captured before the core carried it. The two are not
			// interchangeable: `engagedSegments` is scoped to the primary target so Rising Sun Kick's
			// uptime means something, and its complement therefore reads "you were not on the boss". On
			// Galakras that flagged 85% of the pull as intermission — the player was fighting adds for
			// most of it. Against every target the same pull gives six segments and 27%, which is the add
			// waves the reader actually watched.
			complementOf(
				analysis.timeline?.contactSegments ??
					specAudit.debuff?.contactSegments ??
					specAudit.debuff?.engagedSegments ??
					[],
				analysis.durationMs,
			).filter(([start, end]) => end - start >= MIN_INTERMISSION_MS),
		[
			analysis.timeline?.contactSegments,
			specAudit.debuff?.contactSegments,
			specAudit.debuff?.engagedSegments,
			analysis.durationMs,
		],
	);

	/**
	 * The boss's phase changes, on the fight's own clock and with the pull's own transition dropped.
	 *
	 * Three things this does that a straight `map` would get wrong, all of them measured on real Siege
	 * of Orgrimmar data rather than guessed at:
	 *
	 * - **The clock.** `FightPhase.startTime` is report-relative — the same basis as `fight.startTime`
	 *   and nothing else on this chart — so every entry is rebased through `fightStartMs`. Without that
	 *   basis there is no honest conversion available, so an analysis captured before the core carried
	 *   one draws no markers rather than markers in the wrong place.
	 * - **The pull.** The transition into the fight's first phase lands on `fight.startTime` exactly, so
	 *   it rebases to zero. Every fight has it and a rule on the bell says nothing, so it goes. Dropped
	 *   by its *time* and not by its position or its id: this is a transition log rather than a phase
	 *   list, and a pull that comes back round to phase one — Iron Juggernaut does, seven seconds from
	 *   the kill — has a second entry with `id: 1` that is a real boundary and must be drawn.
	 * - **The order.** Kept as `resolveFightPhases` sorted it, by time, because the label rule below
	 *   reads each marker's room off the next one and that is only the next marker if the list is in
	 *   time order.
	 */
	const phases = useMemo<PhaseMark[]>(() => {
		const transitions = analysis.timeline?.phases;
		const fightStart = analysis.fightStartMs;
		if (transitions === undefined || fightStart === undefined) return NO_PHASES;
		return transitions.flatMap((phase) => {
			const at = phase.startTime - fightStart;
			// Outside the pull as well as on the bell: a transition at or past the end has nowhere to be
			// drawn, and `pct` would put it off the right edge of the track.
			return at <= 0 || at >= span ? [] : [{ id: phase.id, at, name: phase.name }];
		});
	}, [analysis.timeline?.phases, analysis.fightStartMs, span]);

	const drag = useDragScroll();
	const pxPerSec = ZOOM_LADDER[zoom] ?? ZOOM_LADDER[DEFAULT_ZOOM] ?? 24;
	/**
	 * The markers with their copy resolved, then laid out into rows of the gutter.
	 *
	 * Two steps rather than one because only the first needs the copy file: a phase the report has no
	 * metadata for is still a boundary that happened, so it is named by its number rather than dropped,
	 * and the number is the API's `id` — which the schema guarantees is the phase, unlike this array's
	 * index, which is the transition and counts re-entries. The packing below then works on strings and
	 * pixels and knows nothing about phases.
	 */
	const phaseLabels = useMemo(
		() => phases.map((mark) => ({ mark, label: mark.name ?? t('castLog.phase.unnamed', { id: mark.id }) })),
		[phases, t],
	);
	const { rows: phaseRows, placed: placedPhases } = useMemo(
		() => placePhaseLabels(phaseLabels, pxPerSec),
		[phaseLabels, pxPerSec],
	);
	/**
	 * The gutter's height, and zero when the pull has no phases at all.
	 *
	 * Zero rather than one empty row, and this is the one number in the feature that had to be
	 * conditional. WarcraftLogs reports no transitions for 6 of the 14 encounters in this zone —
	 * Siegecrafter Blackfuse among them — and six of the ten committed fixtures predate the fetch
	 * entirely, so "no phases" is the common case and not the edge. A band reserved for markers that do
	 * not exist would push every one of those reports down by a row to say nothing.
	 */
	const phaseGutterPx = phases.length === 0 ? 0 : phaseRows * PHASE_ROW_PX;
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
	const castLanes = useMemo(
		() => castLanesOf(castMarks, pxPerSec, damaging, onUseNames),
		[castMarks, pxPerSec, damaging, onUseNames],
	);
	/**
	 * The enemy a press aimed at, in words — the Storm, Earth and Fire section's own words.
	 *
	 * Three answers and they are not interchangeable, which is the whole reason this is a ternary and
	 * not a name. A target read from where a spirit *swung* is evidence of where it stood rather than
	 * of where it was sent, so it says which one it is; an enemy the report's actor list cannot name is
	 * still an enemy that was hit, and is labelled as one; a press that named nobody at all can only be
	 * answered with "cannot say", which this report prefers to a plausible guess. The strings are the
	 * ones the section beside the chart already prints, so the two never drift into two wordings.
	 */
	const sentTo = useCallback(
		(c: CastMark): string | undefined =>
			c.target === undefined
				? undefined
				: c.target.deduced === true
					? t('sef.prePull.deduced', { target: c.target.name ?? t('sef.unnamedTarget') })
					: c.target.id === null
						? t('sef.prePull.unknown')
						: (c.target.name ?? t('sef.unnamedTarget')),
		[t],
	);
	const castNodes = useMemo(
		() => castLanes.map((lane): CastRow => ({ lane, nodes: castNodesOf(lane.casts, span, lane.rowOf, sentTo) })),
		[castLanes, span, sentTo],
	);
	/**
	 * What became of one window of a spendable aura, as the row the tooltip draws.
	 *
	 * The press that took it comes with its icon, for the reason every mark on this chart is one: a
	 * reader recognises a spell by its art. The three ways a window can end with nothing spending it
	 * are three different sentences, because they are three different things — the clock ran out, the
	 * pull ended first, or it came off early with no press behind it, which on a real log is the player
	 * dying and every buff leaving at once. Naming a spell for any of them would be inventing one.
	 */
	const spentAs = useCallback(
		(spend: LaneSpend): { text: string; icon: string | null } =>
			spend.name === null || spend.id === null
				? {
						text: t(
							spend.fate === 'expired'
								? 'castLog.tip.spentExpired'
								: spend.fate === 'truncated'
									? 'castLog.tip.spentOpen'
									: 'castLog.tip.spentNone',
						),
						icon: null,
					}
				: { text: spend.name, icon: spellIconUrl(spend.id) },
		[t],
	);
	// Which of those rows an aura has claimed. Split rather than rebuilt, so the marks a merged row
	// draws are the very element objects the memo above made and React skips them all the same.
	const pressed = useMemo(() => mergeRows(castNodes, lanes, appliedByCast), [castNodes, lanes, appliedByCast]);
	const laneRows = useMemo(
		() =>
			lanes.map((lane) => ({
				lane,
				// A lane the engine handed a counter is drawn as that counter instead of as a window. The
				// choice is the engine's, not this component's: a lane has a counter when the log actually
				// counted one, which is a question about events and not about how a row should look.
				bars:
					lane.stacks === undefined
						? barNodesOf(
								lane,
								span,
								// Whether this lane carries a figure in its bars is the spec's answer, not a name
								// this chart knows: it looks the lane up and labels nothing when there is no entry.
								laneNotes.get(lane.key),
								spentAs,
								pxPerSec,
								t('castLog.tip.prePull'),
								t('castLog.tip.inferredFromPull'),
								// One icon's width when this row also draws press marks, and nothing when it does not.
								// The marks are painted after the bars so an icon sits on top of the bar it opened, so
								// a label starting at the bar's own edge starts underneath that icon.
								pressed.into.has(lane.key) ? GCD_ICON_PX : 0,
							)
						: chargeNodesOf(lane, lane.stacks, span),
			})),
		// Zoom is a dependency now, as it already is for the press lanes above: whether a window is wide
		// enough to carry its variant is a question about pixels, so a zoom step has to rebuild these.
		[lanes, span, laneNotes, spentAs, pxPerSec, t, pressed],
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
				const rows: TipRow[] = [];
				const at = mark.getAttribute('data-tip-at');
				const from = mark.getAttribute('data-tip-from');
				const to = mark.getAttribute('data-tip-to');
				// The enemy a press was aimed at, and what became of a window that a press could spend. Both
				// arrive already worded, because the wording is a reading of the engine's answer rather than
				// a reading of the mark — see `sentTo` and `spentAs`.
				const target = mark.getAttribute('data-tip-target');
				// Which of the aura's ids this window was — the stat a Re-Origination proc converted into.
				// It is on the mark for every such window, including the many the bar was too narrow to write
				// it inside, which is what makes the tooltip the fact's home rather than its overflow.
				const stat = mark.getAttribute('data-tip-stat');
				const spent = mark.getAttribute('data-tip-spent');
				// Which rung of `auraWindows` drew this bar, on the one rung that is entirely an inference.
				// Absent on every other mark on the chart, which is the point: a row that appeared on every
				// window would stop being the thing that separates this one.
				const evidence = mark.getAttribute('data-tip-evidence');
				// The consuming spell's art, resolved on the mark and carried as a URL: the tooltip is built
				// as a string, so an icon in it is markup rather than an element, and this is the one row on
				// the chart whose value is a spell the reader would rather recognise than read.
				const spentIcon = mark.getAttribute('data-tip-spent-icon');
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
				// How long a cast-time press took, and whether it never completed — a bar carries one, a
				// cancelled bar carries both.
				const cast = mark.getAttribute('data-tip-cast');
				const cancelled = mark.hasAttribute('data-tip-cancelled');
				// When a phase began. Its own attribute rather than `at`, for the reason `landed` has one:
				// `at` is labelled "Pressed", and the boss changing phase is not something anybody pressed.
				const entered = mark.getAttribute('data-tip-entered');
				if (at !== null)
					rows.push([
						t(
							cancelled
								? 'castLog.tip.cancelledAt'
								: mark.hasAttribute('data-tip-auto')
									? 'castLog.tip.swing'
									: 'castLog.tip.at',
						),
						at,
					]);
				if (entered !== null) rows.push([t('castLog.tip.entered'), entered]);
				if (cast !== null) rows.push([t('castLog.tip.cast'), cast]);
				// Directly under the moment, because it is the other half of the same sentence: this press,
				// at this time, at that enemy.
				if (target !== null) rows.push([t('castLog.tip.sentTo'), target]);
				if (landed !== null) rows.push([t('castLog.tip.landed'), landed]);
				if (charges !== null) rows.push([t('castLog.tip.charges'), charges]);
				// Above both ends of the window rather than below them, because it is what the window *was*
				// and the clocks are when it ran — a reader hunting the stat should not have to read past
				// two timestamps to reach it.
				if (stat !== null) rows.push([t('castLog.tip.stat'), stat]);
				if (from !== null) rows.push([t('castLog.tip.from'), from]);
				if (to !== null) rows.push([t('castLog.tip.to'), to]);
				// Under both clocks, because it is what those two clocks are worth: on a rung-3 bar neither of
				// them is an event.
				if (evidence !== null) rows.push([t('castLog.tip.evidence'), evidence]);
				// After both ends of the window, because it is what the second of them was.
				if (spent !== null) rows.push([t('castLog.tip.spent'), spent, spentIcon ?? undefined]);
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
	// One key, and it is the per-enemy block sinking by rule — see `perTargetBlock`. Everything else
	// keeps engine order, which a stable sort is what guarantees: `ROW_ORDER` lifts the rows it names
	// out of this list by walking its own sequence, so nothing here has to rank them, and the rows it
	// does not name are exactly the ones whose order was never anybody's decision to make.
	const rows = laneRows
		.filter(({ lane }) => shownRow(lane))
		.sort((a, b) => Number(perTargetBlock(a.lane)) - Number(perTargetBlock(b.lane)));

	// The one row drawn as a meter rather than as a bar, when the pull had one. Found by asking which
	// lane carries a counter rather than by naming the gem: the model decides which auras stack, and
	// nothing in this file has ever known a spell id.
	const charged = rows.find(({ lane }) => lane.stacks !== undefined)?.lane;

	// The row, if there is one, that brought an aura into the fight with it. Found the same way
	// `charged` is — by asking the drawn windows, never by naming a spell — so it describes whatever the
	// engine recovered rather than the one consumable that motivated it. `rows` is the drawn set, so a
	// caption never explains a bar the reader has toggled off.
	const prePull = rows
		.flatMap(({ lane }) => lane.windows.map((w) => ({ lane, window: w })))
		.find(({ window }) => window.preexisting === true);

	// The same slot filled the other way round: a potion the chart *does* draw a press for, taken
	// before the player joined a fight that had already started without them. It needs the opposite
	// sentence to `prePull` above — that one explains a bar with no icon over it, this one explains an
	// icon a reader would otherwise count as the in-combat potion. Keyed off the audit because there is
	// nothing about the window to key off, and still guarded on the lane being drawn, so a caption
	// never explains a row the reader has toggled away.
	const earlyPotion = ((): { aura: string; drunkMs: number } | null => {
		const audit = analysis.potions;
		if (audit?.prePull == null || audit.prePull.preexisting) return null;
		return rows.some(({ lane }) => lane.id === audit.id) ? { aura: audit.name, drunkMs: audit.prePull.drunkMs } : null;
	})();

	/**
	 * The blocks of rows, in the order the chart reads: the player's own, then the enemies'.
	 *
	 * Split rather than merely sorted, because the cast lanes are drawn *between* them — in several
	 * runs, since the declared order interleaves press rows and aura rows and each seam between them is
	 * a place presses are threaded through. Sorting alone could never produce that: the loose presses
	 * below the aura rows are the player's rows as much as the buffs are, and a single sort would have
	 * left the per-enemy block above them, which is exactly the interleaving the rule exists to stop.
	 *
	 * A heading goes above each enemy's rows: the label in the gutter and the same row spent on nothing
	 * in the track, because the two columns are separate elements that line up only by agreeing on a
	 * height per row. A press keeps its own kind of block so that the two columns can draw the identical
	 * sequence from one list — the declared order puts presses among the aura rows, and a second list
	 * for them is how a gutter and a track stop agreeing about which row is which.
	 */
	type Block =
		| { key: string; head: LaneTarget; row?: never; press?: never }
		| { key: string; head?: never; row: (typeof rows)[number]; press?: never }
		| { key: string; head?: never; row?: never; press: CastRow };

	/**
	 * The debuff row that is not really a per-enemy row, because the pull had one enemy.
	 *
	 * `perTargetBlock` sinks the debuff by rule and that rule stands: on an add pull those rows are the
	 * only ones on the chart whose meaning depends on *which* enemy, and a reader scanning their own
	 * rotation should meet the per-enemy accounting once, at the end. With one enemy there is no such
	 * accounting to reach — there is one row, the press stream has already merged onto it because there
	 * is no doubt which enemy a kick landed on, and it is Rising Sun Kick's row rather than an enemy's.
	 * So it is drawn where the declared order puts the kick, near the top, and nothing about the add
	 * pull changes.
	 *
	 * "One lane carries this key" is the whole test, and it is the merge's own test rather than a second
	 * reading of the target count. The two have to agree: a row the press merged into is labelled for
	 * the button, and a row labelled for a button that sat in the enemies' block would be the one place
	 * on this chart where the label and the position disagree about what the row is.
	 *
	 * Not while the reader has asked for the enemy grouping outright. `on` means "name the enemy even on
	 * a single-target pull", and a hoisted row has no enemy block left to be named under — so that one
	 * override keeps the row where the heading can go above it. `off` has already given the collapsed
	 * row a key and a name of its own, which the declared order does not name and therefore does not
	 * lift.
	 */
	const soleDebuffRow = (lane: AuraLane): boolean =>
		perTargetBlock(lane) && grouping !== 'on' && pressed.lanesPerKey.get(lane.key) === 1;
	const auraRows = rows.filter(({ lane }) => !perTargetBlock(lane) || soleDebuffRow(lane));
	const targetRows = rows.filter(({ lane }) => perTargetBlock(lane) && !soleDebuffRow(lane));

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
	 * What a row is called for the purposes of the declared order: the aura's own name, and the name of
	 * the button that merged onto it.
	 *
	 * Both, because a merged row is two things at once and the reader may be scanning for either. The
	 * gutter already labels it with both — `rowLabel` writes "Tiger Palm · Tiger Power" — so answering to
	 * both is answering to what is on the screen, and it is what lets one entry cover a row whether or
	 * not the pull happened to put the aura up.
	 */
	const namesOf = (row: (typeof rows)[number]): string[] => {
		const press = pressed.into.get(row.lane.key);
		return press === undefined ? [row.lane.name] : [row.lane.name, press.lane.name];
	};

	/**
	 * A row's React key, which is the aura's key except where several rows share one.
	 *
	 * The per-enemy block has always composed its keys from the lane and the enemy (`${key}@${target.id}`
	 * below) because a bare key reconciles two enemies' rows into each other. A raid buff drawn per caster
	 * is the same situation one field along, and worse: two totems from *one* shaman share the key and the
	 * caster both, so the instance itself has to be in the key. Its window's start is what identifies it —
	 * one lane carries one instance — and it is stable across renders, which a list index is not.
	 */
	const blockKey = (lane: AuraLane): string =>
		lane.source === undefined ? lane.key : `${lane.key}^${lane.source.id}@${lane.windows[0]?.start ?? 0}`;

	/**
	 * The rows the declared order names, in that order — press rows and aura rows in one sequence.
	 *
	 * Ranked and sorted rather than assembled by walking `ROW_ORDER`, so a row can be in the list at
	 * most once however many names it answers to, and both columns draw one array rather than two that
	 * have to agree. The rank is the row's own, so nothing here re-decides it.
	 *
	 * The presses are gated on `showCasts` here rather than at the point they are drawn, because they
	 * are interleaved with aura rows now: a run of blocks that had to be skipped in the middle would be
	 * a second rule for the gutter and the track to keep in step over.
	 */
	const lead: Block[] = [
		...auraRows.map((row) => ({
			rank: rowRank(namesOf(row), rowOrder),
			block: { key: blockKey(row.lane), row } as Block,
		})),
		...(showCasts ? pressed.loose : []).map((press) => ({
			rank: rowRank([press.lane.name], rowOrder),
			block: { key: press.lane.name, press } as Block,
		})),
	]
		.filter(({ rank }) => rank < rowOrder.length)
		.sort((a, b) => a.rank - b.rank)
		.map(({ block }) => block);

	/**
	 * The aura rows nobody named, which is every item proc a character happens to be wearing.
	 *
	 * Being an aura is not by itself a claim on the top of the chart. `ROW_ORDER` is a sequence somebody
	 * decided; a trinket proc makes no such claim, so it is drawn at the tier boundary instead — below
	 * every damaging press and above the kit — which is far enough down to be out of the rotation's way
	 * and close enough to the damage to still be read against it. A filter over the already-sorted list
	 * rather than a second sort, so the block keeps engine order exactly as it had it.
	 */
	const restBlocks: Block[] = auraRows
		.filter((row) => !led(namesOf(row), rowOrder))
		.map((row) => ({ key: blockKey(row.lane), row }));
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
		// Only the *enemy* lanes count against `hiddenTargets`, which is a count of enemies and feeds a
		// sentence that says so. `hiddenLanes` now also carries the raid-buff instances past their own cap,
		// and counting those here would silently cancel out the recovery term for an old analysis.
		Math.max(0, hiddenCount - spareLanes.filter((lane) => lane.target !== undefined).length);
	// Whether the collapse actually merged anything, which is when its caption has something to explain.
	const collapsed = grouping === 'off' && targetLanes.filter(({ target }) => shownTargets.has(target.id)).length > 1;

	// One definition per column, used by every block that draws a press — the two columns have to be
	// identical or a lane would change height depending on where it sat.
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
	/*
	 * ...and who cast it, on a raid buff drawn per caster.
	 *
	 * Without the name the rows are indistinguishable: four bars labelled "Stormlash Totem" is exactly the
	 * merged row this replaced, spread over four lines. The buff leads and the caster follows it, so the
	 * four rows still read as one group when the eye runs down the gutter.
	 *
	 * A caster the actor list could not name gets the buff's name alone rather than an invented label — the
	 * same rule `LaneSource.name` states. **The separator is composed here rather than translated**, and it
	 * is the one place in this file that happens: `castLog.mergedLane` is `{{ability}} · {{aura}}` and
	 * neither half is what this is. A `castLog.source.lane` string of its own belongs in `report.json`,
	 * which is not this lane's file, so it is reported rather than taken — the middot is the same
	 * convention the merged label already sets, and both halves are proper nouns the log wrote.
	 */
	const rowLabel = (lane: AuraLane, press: CastRow | undefined): string => {
		const aura =
			press === undefined || press.lane.name === lane.name
				? lane.name
				: t('castLog.mergedLane', { ability: press.lane.name, aura: lane.name });
		return lane.source?.name == null ? aura : t('castLog.sourceLane', { aura, caster: lane.source.name });
	};

	// One renderer per column, called for every block. Written out once because the leading rows, the
	// rows nobody ranked and the per-enemy block have to be identical in every respect but where they
	// sit — two copies of this is how the gutter and the track stop agreeing about a row's height.
	//
	// A press block is handed straight to the two functions that already draw a press lane, because a
	// press in the declared order is the same row it was when it followed melee — only its position has
	// changed, and a second way to draw it would be a second row height to keep in step.
	const laneLabel = (block: Block) => {
		if (block.press !== undefined) return castLabel(block.press.lane);
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
		if (block.press !== undefined) return castTrack(block.press);
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
		// The three shadings in the order they are painted, bottom first, which is also the order a
		// reader meets them: the blue behind the whole chart, the grey over it, the red rules on top.
		//
		// Named rather than described, because "a haste cooldown" is not what the reader saw cast: the
		// windows carry which of the five it was and the sentence says so. Deduplicated in the lanes'
		// own order — two Drums on one pull is one name — and the count is of windows rather than of
		// names, so a pull with two of the same still reads as two stretches.
		haste.length === 0
			? null
			: // Per spec, because the claim is not the same claim: haste shortens a Windwalker's globals *and*
				// speeds their energy regen, while a caster's mana does not work that way at all — for them it
				// shortens the casts themselves and quickens their dot ticks. A bare `note` stays as the honest
				// fallback for a spec with no sentence of its own, saying only the part that is true of every
				// spec, rather than inheriting another's resource.
				t('castLog.lust.note', {
					count: haste.length,
					context: spec.key,
					names: [...new Set(haste.map(lustName))].join(', '),
				}),
		intermissions.length > 0 ? t('castLog.intermission.note') : null,
		deaths.length > 0 ? t('castLog.death.note') : null,
		// The white rules above the track, which are the one annotation on this chart that comes from the
		// encounter rather than from the player's own log — so nothing about them can be inferred from
		// the marks around them. Two things the picture cannot say for itself: the pull's own transition
		// into phase one is deliberately not drawn, and the same name can appear twice because a boss can
		// re-enter a phase it has already been in.
		phases.length === 0 ? null : t('castLog.phase.note'),
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
		// A bar with no icon over it. Every other window on this chart can be traced up to the press that
		// opened it, and a reader who cannot find that press has no way to tell a pre-pull buff from a
		// press the chart failed to draw — so the one case where there is genuinely nothing to point at
		// is said out loud.
		//
		// The timing rides on the same sentence through i18next's context rather than as a second line,
		// and only when the analysis can supply it: how early the potion went down is the difference
		// between a press that overlapped the pull and one that spent seconds of its own duration
		// waiting for it. Matched by the lane's id against the audit's, so the number is never attached
		// to some other aura that happened to be running at the bell.
		prePull === undefined
			? null
			: t('castLog.prePull.note', {
					aura: prePull.lane.name,
					...(analysis.potions?.prePull != null && analysis.potions.id === prePull.lane.id
						? { context: 'timed', drunk: formatGap(Math.abs(analysis.potions.prePull.drunkMs)) }
						: {}),
				}),
		// And the press that filled the same slot from inside the fight, which is the one thing on this
		// chart whose meaning is not in the picture: the icon is drawn where it happened, and only the
		// clock the player's own opener keeps says it was drunk out of combat.
		earlyPotion === null
			? null
			: t('castLog.prePull.note', {
					context: 'early',
					aura: earlyPotion.aura,
					drunk: formatGap(earlyPotion.drunkMs),
				}),
		// What the ignore table took out, named. A chart that silently drops a row is a chart claiming
		// the pull contained less than it did — the same fault the per-enemy cap is careful about, and
		// answered the same way: said in the caption rather than left for the reader to notice.
		hidden.length === 0 ? null : t('castLog.hiddenRows', { count: hidden.length, rows: hidden.join(', ') }),
	].filter((note): note is string => note !== null);

	/**
	 * The press lanes the declared order did not name, cut at the tier boundary.
	 *
	 * Only the lanes that kept a row of their own — the rest are drawn on the aura they apply, and
	 * whichever of those the order named have already been lifted into `lead`.
	 *
	 * `pressed.loose` arrives in one order and it is not re-sorted here: `castLanesOf` already sorted it
	 * by tier and then by press count, so both runs below are subsequences of that one list and a lane
	 * cannot change its neighbours by landing in a different run. The one cut is the tier boundary — the
	 * last damaging lane and the first of the kit — which is where the auras nobody ranked go.
	 *
	 * `filter` on the tier rather than an index, because reading the tier back off each lane says what
	 * is meant without depending on the sort having held. It is a lookup in a `Set` per lane and there
	 * are twenty.
	 */
	const restPresses = pressed.loose.filter(({ lane }) => !led([lane.name], rowOrder));
	const castsMid = restPresses.filter(({ lane }) => tierOf(lane.name, damaging, onUseNames) === 0);
	const castsBelow = restPresses.filter(({ lane }) => tierOf(lane.name, damaging, onUseNames) !== 0);
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
					{/* The phase gutter's row in this column, and first in the sequence exactly as it is first
					    on the track.

					    **Not a spacer — a row, named.** The two columns line up because they draw the same rows
					    in the same order at the same heights and nothing measures anything, so a band that
					    claims space on one side has to claim it on the other or every label below it names the
					    row above the one it belongs to. It carries `phaseGutterPx`, which is the same number
					    the track's band is given: when a crowded pull staggers its labels onto a second row
					    that number grows, and it grows on both sides at once because there is only one of it.

					    Named for the same reason every other row here is: a reader should not have to infer
					    what a mark is from the mark. `castLog.phase.title` rather than a second string that
					    means the same thing — it is the word the marker's own tooltip is titled with, and the
					    two cannot drift apart if there is only one of them.

					    Top-aligned rather than centred, so on a staggered gutter the word sits beside the
					    first row of labels instead of between the two. No hairline, unlike every row below:
					    the rule under a lane separates it from the next lane, and what is under this is the
					    chart. */}
					{phaseGutterPx === 0 ? null : (
						<div className="flex items-start gap-2 pr-2" style={{ height: phaseGutterPx }}>
							<span className="truncate font-mono text-sm leading-6 text-ink-2">{t('castLog.phase.title')}</span>
						</div>
					)}
					{/* One label per ability, matching the aura lanes below it: the same icon-and-name shape,
					    so the two halves of the chart read as one list rather than as two conventions. */}
					{resources === undefined
						? null
						: resourceLanes.map(({ key, section }) => (
								<div
									key={key}
									className={`flex items-center gap-2 pr-2 ${LANE_RULE}`}
									style={{ height: RESOURCE_ROW_PX }}
								>
									{/* A real anchor when the bar has a section arguing about it, so it middle-clicks
									    and keyboards like every other link on the page. `scroll-mt` on the headings
									    already keeps the landing clear of the sticky bar. */}
									{section == null ? (
										<span className="truncate font-mono text-sm text-ink-2">{t(`castLog.resource.${key}`)}</span>
									) : (
										<a
											href={`#${section}-heading`}
											onClick={(event) => jumpToHeading(`${section}-heading`, event)}
											className="truncate rounded-sm font-mono text-sm text-ink-2 underline decoration-line underline-offset-4 transition-colors hover:decoration-kick hover:text-ink"
										>
											{t(`castLog.resource.${key}`)}
										</a>
									)}
									<span className="tabular font-mono text-xs text-muted">{curveOfBar(resources[key])?.max}</span>
								</div>
							))}
					{/* The spec's counters, in its own order. Always a real anchor: a bank exists because a
					    section argues about it, which is not true of every audited bar above. */}
					{banks.map((bank) => (
						<div
							key={bank.key}
							className={`flex items-center gap-2 pr-2 ${LANE_RULE}`}
							style={{ height: RESOURCE_ROW_PX }}
						>
							<a
								href={`#${bank.section}-heading`}
								onClick={(event) => jumpToHeading(`${bank.section}-heading`, event)}
								className={`truncate rounded-sm font-mono text-sm text-ink-2 underline decoration-line underline-offset-4 transition-colors ${BANK_UNDERLINE[bank.underline]} hover:text-ink`}
							>
								{t(`castLog.resource.${bank.key}`)}
							</a>
							<span className="tabular font-mono text-xs text-muted">{bank.curve.max}</span>
						</div>
					))}
					{/* The player's own rows, in the four runs they are cut into: the rows the declared order
					    names, then the rest of the damage, then the auras nobody ranked, then the kit and
					    everything the fight asked for. The same four in the same order on the track below —
					    the columns line up by drawing the identical sequence and by nothing else. */}
					{lead.map(laneLabel)}
					{showCasts ? castsMid.map(({ lane }) => castLabel(lane)) : null}
					{restBlocks.map(laneLabel)}
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
					{/* The boss's phase changes, in a band of their own above the track.

					    **Real vertical space rather than an overlay, and that is the whole of this design.**
					    Every other annotation on this chart competes for the same pixels as the marks it
					    annotates, and each one had to argue its way through the paint order to get them — the
					    haste wash down to 30% so the globals stay findable, the intermission over it, a death
					    band over that. A phase boundary loses that argument whichever way it is settled: it is
					    a hairline and a name, so being underneath makes it invisible rather than quieter, and
					    being on top puts text across the resource bar. Given a row of its own it wins without
					    anything else losing, and the label never has to be dropped to make room.

					    Inside the scroller and the same `trackPx` wide, which is what keeps a marker over its
					    own moment: the percentages resolve against this box and against the track's box, and
					    the two are the same width and scroll as one. It is also what puts the markers inside
					    the pointer listener that fills the shared tooltip.

					    Nothing at all when the pull has no phases — see `phaseGutterPx`. The label column opens
					    with the matching row, named, at the same height and read off the same number, which is
					    what keeps the two columns agreeing about which row is which. */}
					{phaseGutterPx === 0 ? null : (
						<div className="relative" style={{ width: trackPx, height: phaseGutterPx }}>
							{placedPhases.map(({ mark, label, row }) => (
								<span
									// Both, because the id repeats within a pull and only the pair is unique.
									key={`${mark.id}-${mark.at}`}
									title={`${t('castLog.phase.title')} · ${label} · ${formatStamp(mark.at)}`}
									data-tip={label}
									// `ink` rather than any of the coloured tones, for the reason the rule is white.
									data-tip-tone="ink"
									// The moment, which the label does not carry. Its own attribute rather than `at`,
									// which the tooltip labels "Pressed" — nobody pressed a phase change.
									data-tip-entered={formatStamp(mark.at)}
									// Down to the bottom of the gutter rather than one row tall, so every rule ends flush
									// against the chart it annotates and a staggered label is still joined to its own
									// moment. On a single-row gutter — every real encounter at the default zoom — that is
									// exactly the 24px line asked for.
									style={{ left: pct(mark.at, span), top: row * PHASE_ROW_PX }}
									className={PHASE_MARKER_CLASS}
								>
									{label}
								</span>
							))}
						</div>
					)}
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
						{/* Bloodlust — or Heroism, or Time Warp — under everything, and first in the source for
						    that reason.

						    Full height and not a row, because it is not a row's worth of claim: the haste is on
						    every lane at once, so what it wants to be is the ground the stretch was played on
						    rather than a bar the reader has to hold against twenty others. The same argument the
						    intermission shading makes, with the opposite sign — one is the fight taking the
						    pull away and this is the raid handing it over — and drawn as the same shape for it.

						    **Bottom of the stack, and that is the whole of the paint order decision.** Three
						    things now compete for this background and they rank by how much they cost a reader
						    to lose: a death band is the loudest explanation on the chart and stays on top of
						    everything, the intermission says the marks inside it cannot be read normally and
						    keeps its place over this, and Bloodlust is the widest and least urgent of the three
						    — a condition rather than an event.

						    **Being underneath was not enough to keep the globals readable, which is why the fill
						    is a wash and a layer of its own.** The rules are already drawn over this, so nothing
						    was covering them — what hid them was contrast. `--color-band-lust` is an opaque mix
						    that lands *lighter* than `surface`, so a `--color-line` hairline that reads 1.45:1
						    against the bare track reads 1.12:1 against the band, and 1.01:1 on the Elemental
						    palette, where line and band land on the same luminance and the grid disappears
						    outright for the length of the window. At `opacity-30` — the strength the lane bars
						    already wash at — they come back to 1.35:1 and 1.19:1, within a few percent of how
						    they read outside the band, which is the target: a global spent inside Bloodlust
						    should be no harder to find than one spent outside it.

						    **One layer for both fills, and that is not tidiness.** Bloodlust and Berserking
						    overlap constantly — the racial is pressed inside the raid cooldown — and two
						    translucent washes stacked composite to 1-(1-a)², so a 30% band would read as 51%
						    exactly where the two meet and take the globals back with it: the same bug, wearing
						    the overlap as a disguise. Group opacity composites the children against each other
						    first — opaque over opaque, so identically — and blends the result once, which makes
						    an overlap the same wash as a single window. One band per stretch, which is also what
						    the reader is being told: haste was up.

						    The edges and the names stay out of this layer, at full strength. They are the few
						    pixels that carry a moment, and now that the fill is this faint they are the whole of
						    what makes a window findable.

						    Order is the hit test as well as the paint, since `elementsFromPoint` answers
						    topmost-first — so where a lust window and an intermission overlap, the tooltip is the
						    intermission's, which is the one with something to warn about. This layer is inert for
						    that reason: it is the paint, and the spans below carry the tooltips. */}
						{haste.length === 0 && berserking.length === 0 ? null : (
							<div className="pointer-events-none absolute inset-0 opacity-30">
								{haste.map((w) => (
									<span
										key={`lust-${w.start}-${w.end}`}
										style={{ left: pct(w.start, span), width: pct(Math.max(w.end - w.start, 0), span) }}
										className="absolute inset-y-0 bg-[var(--color-band-lust)]"
									/>
								))}
								{berserking.map((w) => (
									<span
										key={`berserking-${w.start}-${w.end}`}
										style={{ left: pct(w.start, span), width: pct(Math.max(w.end - w.start, 0), span) }}
										className="absolute inset-y-0 bg-[var(--color-band-lust)]"
									/>
								))}
							</div>
						)}
						{haste.length === 0 ? null : (
							<div className="pointer-events-none absolute inset-0">
								{haste.map((w) => (
									<span
										// Both ends, as the bars are keyed: the group logs under five ids and two of
										// them could in principle open on the same millisecond.
										key={`${w.start}-${w.end}`}
										title={`${lustName(w)} · ${formatStamp(w.start)} → ${formatStamp(w.end)}`}
										data-tip={lustName(w)}
										data-tip-tone="lust"
										data-tip-from={formatStamp(w.start)}
										data-tip-to={formatStamp(w.end)}
										style={{ left: pct(w.start, span), width: pct(Math.max(w.end - w.start, 0), span) }}
										// No fill: that is the washed layer above, drawn once for both bands. What is left
										// here is the edges and the hit box — two full-strength rules where the buff went up
										// and came off, which is the strength this needs spent on the few pixels that carry a
										// moment rather than on the many that carry a condition. A transparent box still
										// answers `elementsFromPoint`, so the tooltip is unchanged.
										className="pointer-events-auto absolute inset-y-0 border-x-2 border-lust"
									>
										{/* The spell's own name at the start, so a band is a band and not a puzzle:
										    the wash alone cannot tell Bloodlust from Berserking when they overlap. */}
										<span className={`${HASTE_LABEL_CLASS} text-lust`}>{lustName(w)}</span>
									</span>
								))}
							</div>
						)}
						{berserking.length === 0 ? null : (
							<div className="pointer-events-none absolute inset-0">
								{berserking.map((w) => (
									<span
										key={`berserking-${w.start}-${w.end}`}
										title={`Berserking · ${formatStamp(w.start)} → ${formatStamp(w.end)}`}
										data-tip="Berserking"
										data-tip-tone="lust"
										data-tip-from={formatStamp(w.start)}
										data-tip-to={formatStamp(w.end)}
										style={{ left: pct(w.start, span), width: pct(Math.max(w.end - w.start, 0), span) }}
										// The same wash as Bloodlust and now literally the same layer, so two haste bursts
										// stacked read as one stretch rather than as a darker one; a dashed rule is what
										// tells it apart when it stands alone.
										className="pointer-events-auto absolute inset-y-0 border-x-2 border-dashed border-lust/60"
									>
										<span className={`${HASTE_LABEL_CLASS} text-lust/70`}>Berserking</span>
									</span>
								))}
							</div>
						)}
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
										title={`${t('castLog.intermission.title')} · ${formatStamp(start)} → ${formatStamp(end)}`}
										data-tip={t('castLog.intermission.title')}
										data-tip-tone="muted"
										data-tip-from={formatStamp(start)}
										data-tip-to={formatStamp(end)}
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
							: resourceLanes.map(({ key, mode }) => {
									const bar = resources[key];
									const curve = curveOfBar(bar);
									// A bar with no readings yet draws no row at all — an empty track would claim a
									// shape the pull never produced. The gutter above still lists the bar, so the
									// missing row reads as absence rather than as a lane that vanished.
									if (curve === undefined || curve.points.length === 0) return null;
									// The bar's own colour from the sim's palette; the spec's primary only for a
									// bar the sim has not coloured (or a fixture that predates the audits).
									const laneColor = barColor(bar, specColorsOf(analysis.specName).primary);
									// The regen that prices a capped stretch, read off the bar's own pool audit.
									const regen = bar?.kind === 'pool' ? bar.regenPerSec : null;
									// Mana is the one pool whose being full is not a fault — it sits at the ceiling
									// until cast, and a full bar is exactly where it should be. Its fault is the
									// floor: running out, which no other bar can do. So the mana row carries the
									// empty shade instead of the capped one.
									const shades =
										bar?.type === RESOURCE_TYPE.mana
											? [
													{
														windows: emptiedOf(curve),
														className: 'fill-miss/25',
														textClassName: 'text-miss',
														label: 'empty',
													},
												]
											: [
													{
														windows: lostIn(cappedOf(curve), regen),
														className: 'fill-miss/25',
														textClassName: 'text-miss',
														label: 'capped',
													},
												];
									return (
										<div key={key} className={`relative ${LANE_RULE}`} style={{ height: RESOURCE_ROW_PX }}>
											<ResourceTrack
												curve={curve}
												durationMs={span}
												stroke={laneColor}
												fill={`color-mix(in oklch, ${laneColor} 18%, transparent)`}
												mode={mode}
												minLabelGapMs={labelGapMs}
												// The stretches at the ceiling, in the colour every other section uses for a
												// loss. A full bar is not a fault by itself — it is one while there was
												// something to spend it on — so the shading says "here", and the Energy
												// section beside it is where the engaged-versus-downtime split is argued.
												// Mana is the exception, handled in `shades` above: its ceiling is no fault,
												// its floor is.
												shades={shades}
												label={t(`castLog.resourceAria.${key}`, { max: curve.max })}
											/>
										</div>
									);
								})}
						{banks.map((bank) => (
							<div key={bank.key} className={`relative ${LANE_RULE}`} style={{ height: RESOURCE_ROW_PX }}>
								<ResourceTrack
									curve={bank.curve}
									durationMs={span}
									stroke={BANK_COLOR[bank.tone]}
									fill={`color-mix(in oklch, ${BANK_COLOR[bank.tone]} 18%, transparent)`}
									// Stepped like chi, and every bank is: a bank holds whole units, and a slope
									// between two readings would draw a fraction of one that nobody ever held.
									mode="steps"
									// Only the drops, where the gains are noise — a counter that ticks up on every
									// filler would otherwise carry a number per cast around the one worth reading.
									labelDecreases={bank.labelSpendsOnly}
									minLabelGapMs={labelGapMs}
									// Two ways a bank's faults reach the drawing, and a bank uses whichever fits it.
									//
									// The ceiling is shaded only where sitting at it is a loss, and whether it is belongs
									// to the bank: a full brew bank is a proc that had nowhere to go, while a counter the
									// rotation is trying to keep full is doing its job at seven.
									//
									// A bank whose faults carry judgement hands the windows over instead — Lightning
									// Shield's overcap is time at the ceiling past the reader's own leeway, which nothing
									// walking the curve here could work out. Drawn in the band tone the Lightning Shield
									// section paints its own faults in, because it is the same claim about the same pull
									// and the reader is looking at the two charts one after the other.
									//
									// Both, when a bank declares both. Neither is a special case of the other and a bank
									// with nothing to say gets no shade at all rather than an empty one.
									shades={bankShadesOf(bank)}
									label={t(`castLog.resourceAria.${bank.key}`, { max: bank.curve.max })}
								/>
							</div>
						))}
						{/* The same four runs the gutter draws, in the same order. */}
						{lead.map(laneTrack)}
						{showCasts ? castsMid.map(castTrack) : null}
						{restBlocks.map(laneTrack)}
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
									title={`${t('castLog.death.title')} · ${formatStamp(death.t)} · ${by}`}
									data-tip={t('castLog.death.title')}
									data-tip-tone="miss"
									data-tip-at={formatStamp(death.t)}
									data-tip-to={death.resurrected ? formatStamp(death.until) : t('castLog.death.noRes')}
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
			    source of it.

			    `w-max` is what stops the tip's width depending on where the tip is. A positioned box with
			    `width:auto` is shrink-to-fit against *the viewport minus its own `left`*, and `left` is
			    computed from the width the previous mark's content had — so the pair chase each other, the
			    tip ends up pinned against the right edge, and a value one character too long for whatever
			    room was left over wraps mid-phrase. Measured at 390px: "Spent by · nothing — it came off
			    unspent" was squeezed to 238px and broken across two lines with 362px of screen going spare.
			    At its natural width the measurement is stable, so the placement below is right first time.

			    `max-w` is the other half: growing is the right answer until the value is wider than the
			    screen, and then wrapping is — never truncation, because a reader who cannot finish reading
			    an ability's name has lost the row. 28px is the two `TIP_OFFSET_PX` gutters the placement
			    keeps. */}
			<div
				ref={tipRef}
				aria-hidden="true"
				className="pointer-events-none fixed top-0 left-0 z-50 w-max max-w-[calc(100vw-28px)]"
			/>
		</figure>
	);
}
