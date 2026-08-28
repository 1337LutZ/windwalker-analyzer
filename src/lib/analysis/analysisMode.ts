// Which question the report is answering: what your parse saw, or what you actually fought.
//
// WarcraftLogs strikes a list of NPCs from its damage rankings so nobody can pad a parse on adds that
// respawn, heal to full, or never die. Every figure in this report that touches damage or target count
// has had to decide what to do about that list, and until now it decided once, for everybody.
//
// **The two readings are both right, for different readers.** Somebody comparing a pull against the
// ladder wants the ruleset applied exactly, because a number built on hits the site refuses to count is
// not a number they can compare. Somebody working through a progression fight wants the opposite: the
// Foul Slimes were twenty-two real bodies they pressed Rushing Jade Wind into, the decision to press it
// was correct, and a report that pretends they were not there is describing a fight nobody had.
//
// So the reader chooses, and the report says which choice it is under. `parsing` is the default because
// it is the conservative one: it never credits a stretch of pull the ruleset would refuse.
//
// ------------------------------------------------------------------ what the choice actually moves
//
// Everything, or nothing — see `rankingExclusions`. In `parsing` every row of the Siege table is struck
// from both damage attribution and the target count, and the fight-evaluated rules are applied too. In
// `progression` none of them are, and the pull reads as it was fought.
//
// ***This is a coarser rule than the table's own `reach` field, and it replaces it.*** That field was a
// per-row judgement about whether an NPC was a body the rotation had to react to, argued one measured row
// at a time. It answered a real question, but not this one: a reader in `parsing` does not want a body
// the ruleset struck counted toward their AoE scoring however genuinely they fought it, and a reader in
// `progression` wants every body counted whatever the ruleset says. Neither reading consults `reach`, so
// the field is kept as recorded evidence and no longer drives the count. `rankingExclusions.ts` says the
// same beside the field itself.

/** Which of the two questions a report answers. */
export type AnalysisMode = 'parsing' | 'progression';

/**
 * `parsing`, because it is the reading that cannot overstate a pull.
 *
 * A reader who has not chosen gets the ruleset applied, so nothing in the report rests on hits
 * WarcraftLogs would refuse. Progression is the deliberate opt-in.
 */
export const DEFAULT_ANALYSIS_MODE: AnalysisMode = 'parsing';

/** Whether WarcraftLogs' exemptions apply at all under this mode. Every call site asks exactly this. */
export function appliesExemptions(mode: AnalysisMode | undefined): boolean {
	return (mode ?? DEFAULT_ANALYSIS_MODE) === 'parsing';
}

/** The two modes in the order a control offers them, default first. */
export const ANALYSIS_MODES: readonly AnalysisMode[] = ['parsing', 'progression'];
