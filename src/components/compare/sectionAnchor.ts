// The id a compare page's per-section heading carries, and the only place it is spelled.
//
// The ranked chart links to these and the metric detail renders them, and the two are in different
// files. A convention agreed by two `\`compare-${key}-heading\`` templates is a convention that holds
// until somebody edits one of them.
//
// **They are the compare page's own ids, not the report's.** The scorecard's `anchors` map points at
// the sections of a *report* — `#snapshots-heading`, `#bank-heading` — and none of those headings is
// on this page. Linking to them was the first thing tried here and it went nowhere, silently: the
// jump helper answers `false` for a heading that is not on the page, and a button that does nothing
// looks exactly like a button whose section is already in view.

/** The heading id for one scored section on the compare page. */
export const sectionAnchor = (key: string): string => `compare-${key}-heading`;
