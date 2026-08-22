// Which of the Elemental's cooldown sections have anything to say about this pull.
//
// Two gates, and both are read from here rather than written into the section registry, because both
// are also needed *inside* the section they gate: `when` decides whether the heading exists and the
// component decides what the heading says, and those two must not be able to disagree about the same
// pull. The registry's own comment makes the other half of the argument — a component that quietly
// returned null would leave the nav pointing at a heading nobody rendered — so the predicate has to
// be callable from both ends.

import type { Analysis, ElementalAuditResult, LostCastRow } from '~/lib/types';

/**
 * The buttons whose verdict is a placement rather than a clock — they are judged by a section of
 * their own and are not in the held-cooldown ledger.
 *
 * Ascendance (114049) and Elemental Mastery (16166) have their own sections above; Fire Elemental
 * (2894) has one too. What is left over is the ledger's whole subject.
 */
const PLACEMENT_IDS = new Set([114_049, 16_166, 2_894]);

/**
 * Elemental Mastery's talent field, as the audit publishes it.
 *
 * Optional because the audit does not publish it yet: the field belongs in `elemental/lib/index.ts`
 * and this lane does not own that file. Absent therefore has to read as *the third answer* rather
 * than as `false` — see `elementalMasteryTalented` — which is also the correct reading if the field
 * is ever dropped again.
 */
type MaybeTalented = { talented?: boolean | null };

/**
 * Whether the player took Elemental Mastery: `true` taken, `false` proved not taken, `null` the log
 * cannot say.
 *
 * Three answers and not two, which is the entire reason `readTalents` exists rather than inferring a
 * talent from whether its button was ever cast — its own docstring says so. A player who did not take
 * Elemental Mastery must not read as one who took it and wasted it, and a pull whose log carried no
 * `combatantinfo` must not read as a pull with no talents at all.
 *
 * Read off the audit and nowhere else. A second talent read here — `readTalents` over the events, in
 * the components — would be a second answer to one question, free to disagree with the audit's; and
 * the report's `Analysis` does not carry the events to read anyway. So until the field is published,
 * every pull answers `null`: the section stays, and says the talent could not be read.
 */
export function elementalMasteryTalented(analysis: Analysis): boolean | null {
	const el = analysis as Analysis & ElementalAuditResult;
	return (el.elementalMastery as MaybeTalented).talented ?? null;
}

/**
 * Whether the Elemental Mastery section appears at all.
 *
 * Hidden only on positive evidence that the talent was not taken — the same rule the Windwalker's
 * Xuen and Rushing Jade Wind sections keep, and for the same reason: an unknown talent selection that
 * removed the section would hide a forgotten cooldown, which is the fault most worth reporting.
 */
export const hasElementalMastery = (analysis: Analysis): boolean => elementalMasteryTalented(analysis) !== false;

/**
 * The held-cooldown rows: every cooldown-gated button this pull pressed that is not judged on
 * placement somewhere above.
 *
 * Sorted by how long the button stood ready, because that is the column a reader is looking for.
 */
export const heldCooldowns = (analysis: Analysis): LostCastRow[] =>
	[...analysis.lostCasts]
		.filter((row) => row.cooldownSec > 0 && !PLACEMENT_IDS.has(row.id))
		.sort((a, b) => b.driftSec - a.driftSec);

/**
 * Whether the held-cooldown section appears at all.
 *
 * It has no verdict of its own — it is a ledger of whatever buttons are left over — so on a pull with
 * no such button it has nothing to report rather than a finding of "nothing". On all three committed
 * fixtures that is every pull: `lostCasts` holds Ascendance alone, and Ascendance is judged on
 * placement. A section whose only possible content is an empty table and a KPI reading zero is a
 * heading a reader opens for nothing.
 */
export const hasHeldCooldowns = (analysis: Analysis): boolean => heldCooldowns(analysis).length > 0;
