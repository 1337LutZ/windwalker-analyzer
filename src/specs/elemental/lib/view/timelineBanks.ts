// The Elemental's own counter on the cast log — the Lightning Shield charge.
//
// A view module, as the Windwalker's counterpart is: arithmetic over what `elementalAudit` already
// published, so the row and the Lightning Shield section cannot disagree about the pull.
//
// It lives here because the chart no longer does. `CastTimeline` is shared, and until this module
// existed it reached the charge by casting an `Analysis` to a shape with an optional `lightningShield`
// on it — this spec's audit read out of a chart that reads as though it takes any pull.

import type { Analysis, ElementalAuditResult } from '~/lib/types';
import type { TimelineBank, TimelineNotes } from '~/lib/view/timelineBanks';

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
 * Nothing, and a stable nothing.
 *
 * The Elemental's stacking lanes are drawn as their own charge by the engine's `stacks` field, so no
 * window on this spec's timeline needs a figure written into it. A fresh empty map per call would give
 * the chart a new identity every render and rebuild several hundred bars for it.
 */
export function timelineNotes(): TimelineNotes {
	return NO_NOTES;
}
