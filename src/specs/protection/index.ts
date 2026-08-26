// The spec as the registry sees it: its engine entry, registered in `registry.ts` beside the other two.
//
// The code lives under `~/specs/protection`, the same spec-root rule the other two keep: one spec, one
// directory, and `registry.ts` is the only join the rest of the app uses.
//
// The Protection analysis is a port of `nspietz/prot-pala-analyzer` — the spell table, the priority
// ladder, the haste model and the boss rules are that author's measurements. See `lib/index.ts`.

export { analyse, registry, PROTECTION, PROTECTION_SETTINGS, PROTECTION_SPEC } from './lib';
