// Spec-agnostic primitives: how to read a log, not what to conclude from one.
//
// Nothing here knows what a monk is. Every function that needs to know what a spell id means takes
// an `Ability`, an `Aura` or the whole `Registry` and asks it, which is what keeps the rules the
// spec declares (this is the tick id, this aura caps at 20, this button is chi-gated) in one place
// and lets these stay testable against a handful of synthetic events.
//
// Event narrowing lives in ~/lib/events, not here — parsing an event is not analysis.

export * from './auras';
export * from './counters';
export * from './search';
export * from './analyseCore';
export * from './casts';
export * from './cooldowns';
export * from './damage';
export * from './energy';
export * from './engagement';
export * from './format';
export * from './gear';
export * from './intervals';
export * from './links';
export * from './raidBuffs';
export * from './raidCasters';
export * from './stacks';
export * from './targets';
