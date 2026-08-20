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
import type { GameData } from '~/lib/game/model';
import type { Registry } from '~/lib/game/registry';
import type { SpecColors } from '~/lib/game/classes';
import type { Grade, Scorecard } from '~/lib/score';
import type { Analysis, FightDataset, TargetMode } from '~/lib/types';
import type { AnalysisSettings, SettingSchema } from '~/lib/settings';
import type { TimelineBank, TimelineNotes } from '~/lib/view/timelineBanks';
import { analyse, registry as windwalkerRegistry, WINDWALKER, WW_SETTINGS, WW_SPEC } from '~/specs/windwalker';
import { scoreAnalysis, wasteTone, weightsFor } from '~/specs/windwalker/lib/score';
import { timelineBanks, timelineNotes } from '~/specs/windwalker/lib/view/timelineBanks';
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
	timelineNotes as timelineNotesElemental,
} from '~/specs/elemental/lib/view/timelineBanks';

export interface SpecDefinition {
	/** The registry's own key — what the URL carries and `getSpec` reads. */
	key: string;
	/** WarcraftLogs' own class spelling, exactly as the API returns it. */
	classKey: string;
	/** WarcraftLogs' own spec spelling, exactly as `playerDetails` returns it. */
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
	/** Turns one analysis into a scorecard. */
	score(analysis: Analysis, mode?: TargetMode | null): Scorecard;
	/**
	 * How much each metric moves the summary, for the reading's own ranking. Typed loose on purpose:
	 * the keys are this spec's `MetricKey`s, and a generic consumer only ever looks them up by string.
	 */
	weightsFor(mode: TargetMode | null): Record<string, number>;
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
	/** The thresholds a reader may disagree with, for the settings panel to render. */
	settings: SettingSchema[];
}

export const SPECS: SpecDefinition[] = [
	{
		key: 'windwalker',
		classKey: 'Monk',
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
		settings: WW_SETTINGS,
	},
	{
		key: 'elemental',
		classKey: 'Shaman',
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
		settings: ELEMENTAL_SETTINGS,
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
