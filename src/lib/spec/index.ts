// There is exactly one spec: Windwalker Monk, MoP Classic. No registry of specs, no plug-in
// interface — a second one would be a second file exporting its own `analyse`, and the indirection
// that used to sit here bought nothing but a level of misdirection between the UI and the engine.

export { analyse, registry, WINDWALKER } from './windwalker';
