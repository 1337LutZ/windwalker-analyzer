// The Protection report's own sections. Re-exports only — never put logic in here.
//
// Everything else on the page is a shared component reading `AnalysisCore`; these are the ones the
// spec's own audit adds, and the count is the measure of how much of this port is already generic.

export { default as PullTimeline } from './PullTimeline';
export { default as Globals } from './Globals';
export { default as FightRules } from './FightRules';
export { default as Haste } from './Haste';
export { default as Vengeance } from './Vengeance';
export { default as Externals } from './Externals';
