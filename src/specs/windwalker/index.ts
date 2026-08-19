// The spec as the registry sees it: its engine entry and its score module.
//
// This is the one surface a generic consumer imports — the registry, and shared code that needs a
// Windwalker number without knowing the spec's internals. Everything under `lib/` and `components/`
// is the spec's own; this file exists so `~/specs/windwalker` is a complete answer to "what is this
// spec". Spec-internal code imports from `./lib/...` and `./components/...` directly.

export { analyse, registry, WINDWALKER, WW_SETTINGS, WW_SPEC } from './lib';
export { scoreAnalysis } from './lib/score';
