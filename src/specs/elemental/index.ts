// The spec as the registry sees it: its engine entry, registered in `registry.ts` beside Windwalker.
//
// The code lives under `~/specs/elemental`, the same spec-root rule the Windwalker files keep: one
// spec, one directory, and `registry.ts` is the only join the rest of the app uses.

export { analyse, registry, ELEMENTAL, ELEMENTAL_SETTINGS, ELEMENTAL_SPEC } from './lib';
