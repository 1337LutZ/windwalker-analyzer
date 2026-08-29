// The small set of pieces every screen is built out of, so that one set of type-scale, spacing and
// hit-target decisions lives in one place rather than being re-decided per screen.
//
// **Components only, and that is load-bearing.** React Fast Refresh can hot-swap a module only when
// every one of its exports is a component; a single plain value beside them makes the module
// ineligible, and the invalidation then propagates to everything that imported it. This barrel is
// imported by 36 files, so while it also re-exported `enchantById`, `spellIcon*` and the five
// className strings from `./controls`, it sat as a non-refreshable node between nearly every section
// and its primitives — and most edits under this directory reloaded the whole page instead of
// swapping a component.
//
// Types are fine here: they are erased before the plugin ever sees the module.
//
// The values that used to live here now come from their own modules, imported directly:
//   `./controls`   — buttonClass, primaryButtonClass, fieldClass, labelClass, choiceClass
//   `./spellIcon`  — spellIconName, spellIconUrl, iconUrl
//   `./enchants`   — enchantById, enchantIconUrl, Enchant
//   `./itemUrl`    — itemUrl
//
// Re-exports only — never put logic in here.

export { default as Bar } from './Bar';
export type { BarTone } from './Bar';
export { default as Callout } from './Callout';
export { default as CauseLegend } from './CauseLegend';
export { default as CauseTag } from './CauseTag';
export { default as ChartFigure } from './ChartFigure';
export { default as CopyField } from './CopyField';
export { default as DataGrid } from './DataGrid';
export { default as DialogShell } from './DialogShell';
export type { GridColumn, GridRow } from './DataGrid';
export { default as EnchantIcon } from './EnchantIcon';
export { default as Field } from './Field';
export { default as ItemIcon } from './ItemIcon';
export { default as NavLink } from './NavLink';
export { default as Note } from './Note';
export { default as Pill } from './Pill';
export { default as Progress } from './Progress';
export { default as Prose } from './Prose';
export { default as Section } from './Section';
export { default as Skeleton } from './Skeleton';
export { default as SpellIcon } from './SpellIcon';
export type { SpellIconSize } from './SpellIcon';
export { default as StatTile } from './StatTile';
export { default as StatTiles } from './StatTiles';
export { default as Step } from './Step';
export type { StepState } from './Step';
