// The specs this app can analyse. The registry is the only list: a new spec is one entry here plus
// its own module in its own folder beside `windwalker/`.
//
// Only the registry — deliberately. This barrel used to re-export one spec's `analyse`, `registry`
// and `WINDWALKER` alongside it, which made a spec-agnostic path the shortest way to reach the
// Windwalker's engine: any consumer that took it would compile against one spec while reading as
// though it took any. Everything a caller needs about *a* spec is on its `SpecDefinition`, reached
// through `getSpec` or `DEFAULT_SPEC`; anything that genuinely wants the Windwalker's own module
// imports `~/specs/windwalker` by name, and says so.

export * from './registry';
