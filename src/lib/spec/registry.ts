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
import type { Scorecard } from '~/lib/score';
import type { Analysis, FightDataset, TargetMode } from '~/lib/types';
import type { AnalysisSettings, SettingSchema } from '~/lib/settings';
import { analyse, registry as windwalkerRegistry, WINDWALKER, WW_SETTINGS, WW_SPEC } from '~/specs/windwalker';
import { scoreAnalysis } from '~/specs/windwalker/lib/score';

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
		settings: WW_SETTINGS,
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
