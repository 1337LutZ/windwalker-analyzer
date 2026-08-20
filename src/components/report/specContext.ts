import { createContext } from 'react';

import { DEFAULT_SPEC, type SpecDefinition } from '~/lib/spec';

/**
 * The spec the whole report argues from.
 *
 * Context rather than a prop, for the same reason the target-mode reading is context: the spec
 * reaches `useReportCopy`, which is roughly thirty components deep, and threading it through all of
 * them as a prop would be thirty signatures changed to carry one value none of them use directly.
 *
 * The default is the build's pinned spec (`DEFAULT_SPEC`) rather than `null`, so a section rendered
 * in isolation — a test, a preview — still scores and reads copy against the spec it actually
 * belongs to instead of crashing on a missing provider. A real report always provides its own, and
 * an `Analysis` is produced by exactly one spec's `analyse`, so the default only ever fires when
 * nothing provided one.
 *
 * Kept in its own module because a context object is not a component, and a module that exports both
 * is one React Fast Refresh will not hot-swap — the same rule the rest of `components/` follows.
 */
export const SpecContext = createContext<SpecDefinition>(DEFAULT_SPEC);
