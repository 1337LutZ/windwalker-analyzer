// The Protection report's own sections. Re-exports only — never put logic in here.
//
// Two entries, and that is the measure of how much of this report is already ours: every other
// section on the page is a shared component reading `AnalysisCore`. These are the two the audit adds.

export { default as Globals } from './Globals';
export { default as FightRules } from './FightRules';
