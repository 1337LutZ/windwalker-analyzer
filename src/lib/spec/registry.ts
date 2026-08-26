// The specs this app can analyse, and the two lookups the rest of the app is allowed.
//
// A `SpecDefinition` is the whole of what the UI needs to know about a spec: its own engine entry
// point (`analyse`), its branding (`displayName`, `gameData`), its refusal hook (`identify` — the
// engine's answer to "was this player actually playing this spec") and its scoring (`score`, P2-2
// moves the thresholds into the spec module). `sections`, `settings` and `apl` join the definition
// as their P2 items land.
//
// The two lookups answer the two places a spec has to be named. The URL carries the registry's own
// `key` — `/windwalker` — which is what `getSpec` reads. The WarcraftLogs API answers in its own
// spelling — `playerClass: 'Monk'`, `specs: ['Windwalker']` — which is what `findSpecForClass` is
// for: it is the only lookup that can run before any analysis exists, because `playerDetails` is
// the cheap query that decides whether the expensive one is worth fetching at all.

import type { Handles } from '~/lib/analysis/analyseCore';
import type { RaidBuffEffect } from '~/lib/analysis/raidBuffs';
import type { GameData } from '~/lib/game/model';
import type { Registry } from '~/lib/game/registry';
import type { CLASS_COLOR, SpecColors } from '~/lib/game/classes';
import type { Grade, Scorecard, ScoreView } from '~/lib/score';
import type { Analysis, FightDataset } from '~/lib/types';
import type { AnalysisSettings, SettingSchema } from '~/lib/settings';
import type { TimelineBank, TimelineCounter, TimelineNotes } from '~/lib/view/timelineBanks';
import { analyse, registry as windwalkerRegistry, WINDWALKER, WW_SETTINGS, WW_SPEC } from '~/specs/windwalker';
import { scoreAnalysis, wasteTone, weightsFor } from '~/specs/windwalker/lib/score';
import {
	SUMMARY_ROW_NAMES as summaryRowNames,
	SUMMARY_LANE_KEYS as summaryLaneKeys,
	timelineBanks,
	timelineCounters,
	timelineNotes,
	TIMELINE_ROW_ORDER as timelineRowOrder,
} from '~/specs/windwalker/lib/view/timelineBanks';
import { RAID_BUFF_EFFECTS as raidBuffEffects } from '~/specs/windwalker/lib/view/raidBuffs';
import {
	analyse as analyseElemental,
	registry as elementalRegistry,
	ELEMENTAL,
	ELEMENTAL_SETTINGS,
	ELEMENTAL_SPEC,
} from '~/specs/elemental';
import {
	scoreAnalysis as scoreElemental,
	wasteTone as wasteToneElemental,
	weightsFor as weightsForElemental,
} from '~/specs/elemental/lib/score';
import {
	timelineBanks as timelineBanksElemental,
	SUMMARY_ROW_NAMES as summaryRowNamesElemental,
	SUMMARY_LANE_KEYS as summaryLaneKeysElemental,
	timelineCounters as timelineCountersElemental,
	TIMELINE_ROW_ORDER as timelineRowOrderElemental,
	timelineNotes as timelineNotesElemental,
} from '~/specs/elemental/lib/view/timelineBanks';
import { RAID_BUFF_EFFECTS as raidBuffEffectsElemental } from '~/specs/elemental/lib/view/raidBuffs';
import {
	analyse as analyseProtection,
	registry as protectionRegistry,
	PROTECTION,
	PROTECTION_SETTINGS,
	PROTECTION_SPEC,
} from '~/specs/protection';
import {
	scoreAnalysis as scoreProtection,
	wasteTone as wasteToneProtection,
	weightsFor as weightsForProtection,
} from '~/specs/protection/lib/score';
import {
	timelineBanks as timelineBanksProtection,
	SUMMARY_ROW_NAMES as summaryRowNamesProtection,
	SUMMARY_LANE_KEYS as summaryLaneKeysProtection,
	timelineCounters as timelineCountersProtection,
	TIMELINE_ROW_ORDER as timelineRowOrderProtection,
	timelineNotes as timelineNotesProtection,
} from '~/specs/protection/lib/view/timelineBanks';
import { RAID_BUFF_EFFECTS as raidBuffEffectsProtection } from '~/specs/protection/lib/view/raidBuffs';

export interface SpecDefinition {
	/** The registry's own key — what the URL carries and `getSpec` reads. */
	key: string;
	/** WarcraftLogs' own class spelling, exactly as the API returns it. */
	classKey: string;
	/**
	 * The class's own slug: the class half of the per-spec route (`/monk/windwalker`), and the key the
	 * spec's colour is already read by.
	 *
	 * Declared rather than derived from `classKey`, because lowercasing that only works by luck on the
	 * two classes shipped so far. MoP's own spelling includes `Death Knight`, and `'Death Knight'
	 * .toLowerCase()` is a path segment with a space in it — a URL nobody can type and no router can
	 * match on. The luck runs out at the first class whose name is two words.
	 *
	 * Typed as a `CLASS_COLOR` key because that table is the de-facto slug list already: every spec
	 * reads its primary through it (`colors: { primary: CLASS_COLOR.monk }`), so the lowercase class
	 * names exist and are spelled once. Nothing made a spec's slug and the key it reads its colour by
	 * agree until now, which is the coincidence `registry.test.ts` turns into an invariant.
	 */
	classSlug: keyof typeof CLASS_COLOR;
	/** WarcraftLogs' own spec spelling, exactly as `playerDetails` returns it. */
	/**
	 * The spell whose icon stands for this spec, by id.
	 *
	 * An id and not an icon name, so the picture is looked up in the same spell map every other icon on
	 * the page comes from — `spellIconName` answers `null` for an id nothing knows, which is a test
	 * failure rather than a broken image at a reader. A filename written here would be a second source
	 * for a thing this repo already has one source for, and the way to find out it was wrong would be to
	 * look at the page.
	 *
	 * The signature ability rather than the class crest: a reader picking between two specs of the same
	 * class needs the half that differs, and `restoration` under a shaman crest beside `elemental` under
	 * the same crest tells them nothing.
	 */
	iconSpellId: number;
	specName: string;
	/** What the page calls it. */
	displayName: string;
	/** The spec's report palette, from the engine config so the two cannot disagree. */
	colors: SpecColors;
	/** The spec's game model, for anything that wants the buttons rather than the analysis. */
	gameData: GameData;
	registry: Registry;
	analyse(dataset: FightDataset, settings?: AnalysisSettings): Analysis;
	/** One global's length, from the engine config so the two cannot disagree. */
	gcdMs: number;
	/** Whether a pull's events are actually this spec — the refusal hook. */
	identify(h: Handles): boolean;
	/**
	 * Turns one analysis into a scorecard, read at the target counts the pull was fought at.
	 *
	 * `ScoreView` and not a `TargetMode`, because a mode is one word for a whole pull and the pull the
	 * report gets this wrong on took several: add waves and then a boss is one pull whose dot clocks run
	 * through stretches no priority list asked a dot of. A mode cannot say that — whichever of its words
	 * wins, one of those stretches is graded against a list that never applied to it — so the seam
	 * carries the *bands*, which can. `~/lib/view/targetMode.resolveBands` is what builds one.
	 *
	 * Widening the mode from two words to four sharpened that arm without closing it: a `cleave` now
	 * arrives at band 2 rather than band 3, so it is read against the list it belongs to. What no single
	 * word can still say is that a pull was several of them at different minutes.
	 *
	 * `TargetMode` stays in the union rather than being replaced, and only for sequencing: every caller
	 * today hands over a mode, both engines take one, and the conversion is one caller at a time. It is
	 * the lossy arm of the union and `viewBands` says exactly how it loses.
	 */
	score(analysis: Analysis, view?: ScoreView): Scorecard;
	/**
	 * How much each metric moves the summary, for the reading's own ranking. Typed loose on purpose:
	 * the keys are this spec's `MetricKey`s, and a generic consumer only ever looks them up by string.
	 *
	 * Takes the same `ScoreView` as `score` and for the same reason — a weight that changes with the
	 * target count is answering the banded question, and the two must not be able to disagree about
	 * what the pull was.
	 */
	weightsFor(view: ScoreView): Record<string, number>;
	/**
	 * How a share of wasted resource reads as a colour — the spec's own reading aid, and not a grade.
	 *
	 * On the definition rather than imported by the section that draws it, because the resource
	 * section is generic and the bands are not: how much overflow is worth a colour is a claim about
	 * one spec's economy. `lib/score` deliberately grades no resource metric — neither the sim nor the
	 * priority list says how many seconds at the cap are acceptable — so nothing this returns reaches
	 * a scorecard or the headline. It is a hint at the size of a number a reader cannot calibrate.
	 *
	 * Null means there is no share to take: a pull that generated nothing has not wasted a share of
	 * anything, and a tile with no denominator shows its figure uncoloured.
	 */
	wasteTone(wasted: number, generated: number): Grade | null;
	/**
	 * The counters this spec draws above the rows of the cast log, in the order it wants them.
	 *
	 * On the definition rather than read off the analysis by the chart, because the chart is shared and
	 * a counter is not: the Windwalker banks Tigereye Brew stacks and the Elemental charges Lightning
	 * Shield, and each is scaled against a ceiling only its own spec knows. `CastTimeline` used to reach
	 * both through a cast to a shape with optional audit fields on it, and imported one spec's cap to
	 * scale one of the two rows — a shared chart compiled against one spec while reading as though it
	 * took any pull. Empty is the honest answer for a spec with no counter, and for a pull whose report
	 * predates the field the counter is read from.
	 */
	timelineBanks(analysis: Analysis): TimelineBank[];
	/**
	 * The figure each window of a lane is worth labelling with, by lane key — see `TimelineNotes`.
	 *
	 * Beside `timelineBanks` and not folded into it: a bank is a row of its own above the lanes, while
	 * these are numbers written *into* another row's bars, and the chart asks for them at a different
	 * point. Same reason for the seam, though — the shared chart used to test a lane against one spec's
	 * own aura key to decide whether to label it.
	 */
	timelineNotes(analysis: Analysis): TimelineNotes;
	/**
	 * The counters this spec draws as rows *among* the lanes of the summary timeline, one bar per load.
	 *
	 * The third of this family and the same reason as the other two: the summary timeline is shared, and
	 * a counter is not. It used to reach the Elemental's Lightning Shield by casting the analysis to a
	 * shape with an optional `lightningShield` field on it, and then wrote that spell's name and id into
	 * the shared chart as literals — a cast the convention grep cannot see, because it is not an import.
	 *
	 * Empty is the honest answer for a spec that draws no counter row, and the answer the chart is built
	 * around: it asks every spec and draws what comes back, so nothing here is optional and there is
	 * nothing for a caller to test for. See `TimelineCounter` on why the brew is not one of these.
	 */
	timelineCounters(analysis: Analysis): TimelineCounter[];
	/**
	 * The order this spec's timeline rows are lifted into, by ability name.
	 *
	 * Read by both the cast log and the summary timeline, so the two cannot disagree about where a row
	 * sits. A spec declaring an empty order keeps whatever order the engine produced.
	 *
	 * Here rather than in `components/charts/timelineOrder.ts`, where it used to live in a table keyed by
	 * `spec.key`: thirty-three ability names from two specs, inside shared chart code, with no cast and no
	 * import for the convention grep to catch. A third spec had to edit a shared file to be drawn at all.
	 */
	timelineRowOrder: readonly string[];
	/**
	 * The lanes the summary timeline shows, or `null` to show everything.
	 *
	 * `null` is not "not configured yet" — it is the honest reading for a spec that has not decided what
	 * its own "at a glance" is, and it is what the old table said by having no entry.
	 */
	summaryLaneKeys: readonly string[] | null;
	/**
	 * The rows the summary timeline draws and the order it draws them in, by the name on each row — or
	 * `null` for a spec that draws every row it has.
	 *
	 * The counterpart of `summaryLaneKeys` and deliberately not a second spelling of it: that one is an
	 * allowlist over **lane keys** and switching it on also drops every press row, which is the right cut
	 * for a spec whose "at a glance" is a handful of auras. This one is over **row names**, so it can
	 * keep a chart that is half buttons — names rather than keys because a row can be a press stream, and
	 * a `CastMark` carries no ability key.
	 *
	 * It replaced a denylist of the same currency, and the direction is what changed: a row nobody named
	 * is not drawn, so declaring an aura no longer silently adds one to a curated chart. Supplying it also
	 * supplies the order, which `timelineRowOrder` otherwise gives — that one still ranks the cast log,
	 * where every row is drawn.
	 *
	 * `null` for both of the first two specs.
	 */
	summaryRowNames: readonly string[] | null;
	/**
	 * The raid-buff effects this spec's damage rests on, in the order its report draws them.
	 *
	 * The fourth of the view properties above and the same reason as the other three: the section is
	 * shared and the list is not. It used to be a six-entry table inside `lib/analysis/raidBuffs`, chosen
	 * for a Monk down to the icons — and that section reports *gaps*, so an effect a spec cannot use
	 * became a fault its reader could not fix. An Elemental Shaman was being shown a missing multiplier
	 * on attack power, and no row at all for the +10% spell power that is the largest single multiplier
	 * on their damage.
	 *
	 * Which spells supply an effect stays shared, because that is a fact about the game rather than about
	 * a spec. Only three answers per row are the spec's: whether to draw it, which icon stands for it, and
	 * whether the spec supplies it itself — the last being the one that reads as an accusation when wrong.
	 */
	raidBuffEffects: readonly RaidBuffEffect[];
	/** The thresholds a reader may disagree with, for the settings panel to render. */
	settings: SettingSchema[];
}

export const SPECS: SpecDefinition[] = [
	{
		key: 'windwalker',
		classKey: 'Monk',
		classSlug: 'monk',
		// Rising Sun Kick: the Windwalker's own button, and not one a Brewmaster or a Mistweaver presses.
		iconSpellId: 107_428,
		specName: 'Windwalker',
		displayName: 'Windwalker Monk',
		colors: WW_SPEC.colors,
		gameData: WINDWALKER,
		registry: windwalkerRegistry,
		analyse,
		gcdMs: WW_SPEC.gcdMs,
		identify: WW_SPEC.identify,
		score: scoreAnalysis,
		weightsFor,
		wasteTone,
		timelineBanks,
		timelineNotes,
		timelineCounters,
		timelineRowOrder,
		summaryLaneKeys,
		summaryRowNames,
		raidBuffEffects,
		settings: WW_SETTINGS,
	},
	{
		key: 'elemental',
		classKey: 'Shaman',
		classSlug: 'shaman',
		// Lava Burst: Elemental's, where Flame Shock and Earth Shock are every shaman's.
		iconSpellId: 51_505,
		specName: 'Elemental',
		displayName: 'Elemental Shaman',
		colors: ELEMENTAL_SPEC.colors,
		gameData: ELEMENTAL,
		registry: elementalRegistry,
		analyse: analyseElemental,
		gcdMs: ELEMENTAL_SPEC.gcdMs,
		identify: ELEMENTAL_SPEC.identify,
		score: scoreElemental,
		weightsFor: weightsForElemental,
		wasteTone: wasteToneElemental,
		timelineBanks: timelineBanksElemental,
		timelineNotes: timelineNotesElemental,
		timelineCounters: timelineCountersElemental,
		timelineRowOrder: timelineRowOrderElemental,
		summaryLaneKeys: summaryLaneKeysElemental,
		summaryRowNames: summaryRowNamesElemental,
		raidBuffEffects: raidBuffEffectsElemental,
		settings: ELEMENTAL_SETTINGS,
	},
	{
		key: 'protection',
		classKey: 'Paladin',
		classSlug: 'paladin',
		// Shield of the Righteous: the Protection spender, and not a button a Holy or a Retribution
		// paladin has. The same rule `identify` uses, so the icon and the refusal name one thing.
		iconSpellId: 53_600,
		specName: 'Protection',
		displayName: 'Protection Paladin',
		colors: PROTECTION_SPEC.colors,
		gameData: PROTECTION,
		registry: protectionRegistry,
		analyse: analyseProtection,
		gcdMs: PROTECTION_SPEC.gcdMs,
		identify: PROTECTION_SPEC.identify,
		score: scoreProtection,
		weightsFor: weightsForProtection,
		wasteTone: wasteToneProtection,
		timelineBanks: timelineBanksProtection,
		timelineNotes: timelineNotesProtection,
		timelineCounters: timelineCountersProtection,
		timelineRowOrder: timelineRowOrderProtection,
		summaryLaneKeys: summaryLaneKeysProtection,
		summaryRowNames: summaryRowNamesProtection,
		raidBuffEffects: raidBuffEffectsProtection,
		settings: PROTECTION_SETTINGS,
	},
];

/**
 * The pull's default when nothing names a spec.
 *
 * The build's `PUBLIC_SPEC` env key pins the deployment to one spec: a Worker serving only one spec
 * sets it and every default in the page follows it — the settings schema, the sections, the branding.
 * The URL's own `?spec=` still wins over it in `ReportFlow`, which is what lets a multi-spec build
 * (or a dev server) route by the address bar. Unset, it is the first entry, by the same rule
 * defaults are.
 */
export const DEFAULT_SPEC: SpecDefinition = getSpec(import.meta.env.PUBLIC_SPEC ?? '') ?? SPECS[0]!;

export function getSpec(key: string): SpecDefinition | undefined {
	return SPECS.find((spec) => spec.key === key);
}

/** The one lookup that can run before any analysis exists — see the module doc. */
export function findSpecForClass(classKey: string, specName: string): SpecDefinition | undefined {
	return SPECS.find((spec) => spec.classKey === classKey && spec.specName === specName);
}
