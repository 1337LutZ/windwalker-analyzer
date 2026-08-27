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
 * `ceilingIsWaste` stays false, and the faults are handed over instead. Sitting at seven is the state
 * this rotation is trying to be in, so the chart's own helper — which reddens every reading at the
 * ceiling — would fault the thing the rotation is for. What the Lightning Shield section faults is
 * narrower and has judgement in it: time at the ceiling *past the reader's own leeway*
 * (`lightningShieldOvercapMs`), the stretches the shield was off entirely, and the shocks that spent
 * below full. Those three are already computed for that section's own chart, so they are passed
 * through here rather than re-derived, and the two drawings cannot disagree about the pull.
 *
 * The bad spends arrive as zero-length windows carrying the level they unloaded, exactly as the section
 * passes them, because a spend is an instant and not a stretch — and a mark an instant wide is invisible
 * on a pull this long without a number beside it. `labelSpendsOnly` writes every drop's level on the
 * curve already; this writes the bad ones again in the fault colour, which is what separates a shock
 * taken at seven from one taken at four.
 *
 * No bank on a pull with no charge readings, and the absent-audit check is not paranoia about this
 * spec's own reports — but it is no longer the context that makes it so. `SpecContext` has no fallback:
 * it defaults to `null`, `useSpec` throws rather than guessing, and `Report` keeps the wrong-spec
 * refusal inside the provider, so nothing renders a section against a spec nobody named.
 *
 * **What carries the check is the cast on the line below**, and it carries it today. `lightningShield`
 * is not on `Analysis` at all — `Analysis` is `AnalysisCore & SpecAuditResult` and `SpecAuditResult` is
 * the *Windwalker's* audit shape — so nothing type-checked this read, and a Windwalker analysis has no
 * such key at runtime. This file is one half of a definition the chart swaps by context, and
 * `components/charts/__tests__/lanesTimeline.test.ts` renders each definition against the other's pull
 * on purpose. That is a live case with a test on it, not a hypothetical.
 *
 * A stored `Analysis` captured before this audit existed would read `undefined` through the same cast,
 * and that is a real reason too — but **it has no committed instance on this spec, and this file is not
 * handed one.** The Elemental commits raw `FightDataset`s and no captured `Analysis` at all; the only
 * stored analyses in the repo are the Windwalker's, which reach this function through the cast rather
 * than through a stale field. So the cast is what makes the check earn its place now, and the stored
 * case is why it will still be right if this spec ever stores one.
 *
 * The ceiling that used to be defaulted to seven here was never reached — an audit is either present with
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
			// `?? []` on the two window lists, and **not** for the reason the check above it stands on: past
			// that early return the audit is present, so the cross-spec pull the cast lets through never
			// reaches this line. Both fields are declared non-optional on `LightningShieldAudit`, so the only
			// way either arrives `undefined` is a stored `Analysis` read back as `JSON.parse(...) as Analysis`
			// — a cast, not a check — that predates whichever field was added after it. That is the guard with
			// no committed instance on this spec, which stores no `Analysis` to be stale. Kept because the
			// alternative to a two-character fallback is a chart that throws on the first stored pull.
			// `badSpends` predates neither, so it is read straight.
			faultWindows: [
				...(shield.downWindows ?? []),
				...(shield.overcapWindows ?? []),
				...shield.badSpends.map((spend) => ({
					start: spend.t,
					end: spend.t,
					// `null` is the log not stamping a level on that press, and there is no number to write.
					...(spend.stacks === null ? {} : { text: `${spend.stacks}` }),
				})),
			],
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
 * The absent-audit check is not paranoia about this spec's own reports, and the reason that carries it is
 * the one `timelineBanks` gives above: `lightningShield` is reached through a cast nothing type-checked,
 * so a Windwalker analysis reads `undefined` here — the case `lanesTimeline.test.ts` renders on purpose.
 * A stored `Analysis` predating the audit would read `undefined` too, but this spec commits none, so that
 * half is the future reason and not this one. Neither is the reason this used to give — `SpecContext` has
 * no fallback spec any more; it defaults to `null` and `useSpec` throws.
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

/**
 * Every row this spec has, in `TIMELINE_ROW_ORDER`'s order — which is what `null` means.
 *
 * The name allowlist is Protection's cut and this spec does not make it: its summary is already the
 * shape a reader wants. See `specs/protection/lib/view/timelineBanks.ts` for the argument.
 */
export const SUMMARY_ROW_NAMES: readonly string[] | null = null;

/**
 * The order the cast lists put this spec's buttons in — see `lib/view/castOrder`.
 *
 * The shot the rotation is built around first, then what interrupts it: Lightning Bolt is what a
 * shaman presses when nothing else is due, Lava Burst and Flame Shock are the two that take priority
 * over it, and Earth Shock spends what they build. Chain Lightning closes the named set as the button
 * that replaces the filler once there is more than one thing to hit.
 *
 * Editorial, like the Windwalker's beside it, and deliberately short: everything else the spec owns
 * still sorts ahead of the racials and the consumables without being named here.
 */
export const CAST_ORDER: readonly string[] = [
	'lightning-bolt',
	'lava-burst',
	'flame-shock',
	'earth-shock',
	'chain-lightning',
	'unleash-elements',
];
