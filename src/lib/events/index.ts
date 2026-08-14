// Combat-log events: the one WarcraftLogs shape that is hand-written on purpose.
//
// `Report.events` is declared `[JSON]` in the schema, so codegen can only type it `unknown` — the
// API genuinely does not describe what comes back. ./model is the discriminated union that fills
// that gap, ./guards is the only sanctioned way to narrow it, and ./parse is the only place an
// `unknown` from the wire becomes a `WclEvent`.

export * from './guards';
export * from './model';
export * from './parse';
