// The Elemental's own counter on its timelines — the Lightning Shield charge, drawn as a curve on the
// cast log and as one bar per load on the summary timeline.
//
// A view module, as the Windwalker's counterpart is: arithmetic over what `elementalAudit` already
// published, so neither drawing can disagree with the Lightning Shield section about the pull.
//
// It lives here because the charts no longer do. Both are shared by the two specs, and until this
// module existed each reached the charge by casting an `Analysis` to a shape with an optional
// `lightningShield` on it — this spec's audit read out of charts that read as though they take any pull.

import type { Analysis, ElementalAuditResult } from '~/lib/types';
import type { TimelineBank, TimelineCounter, TimelineNotes } from '~/lib/view/timelineBanks';
import { counterLoads } from '~/lib/view/timelineBanks';
import { registry } from '~/specs/elemental/lib';

/**
 * The Elemental audit's fields, named for the type that holds them.
 *
 * `analyseCore` merges the audit's fields over `AnalysisCore` but types the result `Analysis` — the
 * Windwalker's shape — so this module casts at its own boundary. The same bounded, stated cast
 * `lib/score.ts` next door makes, and for the same reason: the fields below were produced by
 * `elementalAudit`, which is the only place an Elemental analysis can come from.
 */
type ElementalAnalysis = Analysis & ElementalAuditResult;

/** No lane on this spec's timeline carries a number in its bars. */
const NO_NOTES: TimelineNotes = new Map();

/**
 * The counter itself, out of this spec's own game model rather than written down here.
 *
 * The name and the icon id used to be literals inside the shared summary chart — `'Lightning Shield'`
 * and `324` — which is a spell id in code that reads as though it takes any pull, and a second place
 * for the name to drift from. The model is the source of truth for both, and it is the registry that
 * refuses to build when two objects claim one id.
 *
 * The name matters beyond the label: `timelineOrder.ts` places this row by name, so the model's
 * spelling is what has to reach the chart.
 */
const LIGHTNING_SHIELD = registry.aura('lightning-shield');

/**
 * Lightning Shield's charge, as a bank like the Windwalker's brew.
 *
 * The same reading: it fills from something the player did, holds a ceiling, and Earth Shock spends it
 * whole — so it is drawn as a stepping curve against its own cap rather than as an on-or-off window
 * among the auras. `maxStacks` comes from the game model rather than from this pull's peak, which is
 * what lets a pull that never reached seven draw as the shortfall it was.
 *
 * Only the spends are labelled. The gains are every Lightning Bolt, so numbering them would bury the
 * one figure worth reading, which is what an Earth Shock unloaded.
 *
 * The ceiling is deliberately *not* shaded, unlike the brew bank's. Sitting at seven is the state this
 * rotation is trying to be in, and what the Lightning Shield section actually faults is time at the
 * ceiling past the reader's own leeway (`lightningShieldOvercapMs`) — a figure the chart's shading
 * helper has no leeway for. Reddening every stretch at seven would contradict the section beside it.
 *
 * No bank on a pull with no charge readings, and the absent-audit check is not paranoia about this
 * spec's own reports: a section rendered without a provider reads `SpecContext`'s fallback (see
 * `specContext.ts`), so a definition's member can be handed an analysis another spec produced. The
 * ceiling that used to be defaulted to seven here was never reached — an audit is either present with
 * its own `maxStacks` or absent altogether, so the row is drawn against the model's number or not at
 * all.
 */
export function timelineBanks(analysis: Analysis): TimelineBank[] {
	const shield: ElementalAuditResult['lightningShield'] | undefined = (analysis as ElementalAnalysis).lightningShield;
	if (shield === undefined || shield.points.length === 0) return [];
	return [
		{
			key: 'lightningShield',
			section: 'lightning-shield',
			// Copied rather than handed over: `ResourceCurve.points` is mutable and this array belongs to
			// the audit.
			curve: { max: shield.maxStacks, points: shield.points.map(([t, n]): [number, number] => [t, n]) },
			tone: 'kick',
			underline: 'kick',
			ceilingIsWaste: false,
			labelSpendsOnly: true,
		},
	];
}

/**
 * The same charge cut into the loads the shocks spent, for the summary timeline's one row per thing.
 *
 * The summary has no strip to put a curve in, so the counter is a row of bars like every other row and
 * each bar is one load: from the shield's last spend to the next, labelled with what that spend
 * unloaded. `counterLoads` owns the walk and the evidence behind it — in particular why a load closes
 * on a *decrease* rather than on zero, which is the bug this row shipped with.
 *
 * A row whenever the pull has charge readings at all, even if none of them ever fell: a shield that was
 * up all pull and never spent is a row with one unlabelled bar, which is the honest drawing of it.
 *
 * The absent-audit check is not paranoia about this spec's own reports, for the reason `timelineBanks`
 * gives above: a chart rendered without a provider reads `SpecContext`'s fallback, so a definition's
 * member can be handed an analysis another spec produced.
 */
export function timelineCounters(analysis: Analysis): TimelineCounter[] {
	const shield: ElementalAuditResult['lightningShield'] | undefined = (analysis as ElementalAnalysis).lightningShield;
	if (shield === undefined || shield.points.length === 0) return [];
	return [
		{
			name: LIGHTNING_SHIELD.name,
			id: LIGHTNING_SHIELD.ids[0]!,
			tone: 'kick',
			// The cap, so a load that ended short of it is drawn as the fault it is. Read off the aura rather
			// than written here: seven is Fulmination's ceiling and the game model is where that lives.
			loads: counterLoads(shield.points, analysis.durationMs, LIGHTNING_SHIELD.maxStacks),
			// The same three faults the section's own chart unifies into one red band: the shield gone, and
			// the shield sitting full. The third — a load spent below the ceiling — is `belowCap` on the load
			// itself, because that one *is* a property of a load.
			// `?? []` on both, for the reason the absent-audit check above exists rather than out of caution:
			// a stored `Analysis` predates whichever field was added after it was captured, and this file is
			// handed those. A counter with no fault windows draws its loads and claims nothing.
			faultWindows: [...(shield.downWindows ?? []), ...(shield.overcapWindows ?? [])].map(
				(w) => [w.start, w.end] as const,
			),
		},
	];
}

/**
 * Nothing, and a stable nothing.
 *
 * The Elemental's stacking lanes are drawn as their own charge by the engine's `stacks` field, so no
 * window on this spec's timeline needs a figure written into it. A fresh empty map per call would give
 * the chart a new identity every render and rebuild several hundred bars for it.
 */
export function timelineNotes(): TimelineNotes {
	return NO_NOTES;
}

/**
 * The declared row order for this spec's timeline: the shock, the raid cooldown, the off-GCD cooldowns,
 * the dot, the fire-and-forget totem, the two-piece, the summons, the filler, the proc and the button it
 * frees. Lightning Shield is not a row — it is a counter, drawn above the rows like the Tigereye Brew
 * bank, and reaches the chart through `timelineCounters`.
 *
 * Lives with the spec rather than in the shared chart, for the reason given on the Windwalker's copy of
 * this: the old table was keyed by `spec.key` inside `components/charts/`, which meant a third spec had
 * to edit a shared file.
 */
export const TIMELINE_ROW_ORDER: readonly string[] = [
	'Melee',
	'Earth Shock',
	'Stormlash Totem',
	'Ascendance',
	'Lightning Shield',
	'Elemental Mastery',
	'Flame Shock',
	'Searing Totem',
	'Elemental Discharge',
	'Fire Elemental',
	'Earth Elemental',
	'Lightning Bolt',
	'Lava Surge',
	'Lava Burst',
];

/**
 * The lanes the summary timeline ("the pull, end to end") shows.
 *
 * The summary is not the cast log: it is the handful of rows the pull actually turned on — the cooldowns,
 * the dot, and the procs that gated the rotation — so everything else is left out, presses included.
 * This spec's own counter, Lightning Shield, is not a lane; the section draws it beside them.
 */
export const SUMMARY_LANE_KEYS: readonly string[] | null = [
	'ascendance',
	'stormlash-totem',
	'flame-shock',
	'searing-totem',
	't16-2pc-debuff',
];
