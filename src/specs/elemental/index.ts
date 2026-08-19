// The spec as the registry will see it: its engine entry, ready for registration.
//
// Elemental is not yet registered — `registry.ts` still lists only Windwalker — but its code lives
// under `~/specs/elemental` so that registering it is one entry plus one line of imports, not a
// second home for the spec's files.

export { analyse, registry, ELEMENTAL, ELEMENTAL_SETTINGS, ELEMENTAL_SPEC } from './lib';
