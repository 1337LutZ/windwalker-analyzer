import { createContext } from 'react';

import type { TargetMode } from '~/lib/types';

/**
 * The reading the whole report argues from.
 *
 * Context rather than a prop, and that is a reversal of what `Report.tsx` used to say. When the mode
 * had one consumer the note there read "one consumer does not justify putting every section behind a
 * provider", which was true then. It has many now: the mode reaches `scoreAnalysis`, so it moves the
 * scorecard, and the scorecard is what roughly twenty-five components read their copy and their
 * grades from. Threading it through all of them as a prop would be twenty-five signatures changed to
 * carry one value none of them use directly.
 *
 * `null` is the honest default and the reason this is not a plain `TargetMode`: a pull whose counts
 * detected nothing has no reading, and a provider handing back `'single'` would let every section
 * below it grade against a guess this file made.
 *
 * Kept in its own module because a context object is not a component, and a module that exports both
 * is one React Fast Refresh will not hot-swap — the same rule the rest of `components/` follows.
 */
export const TargetModeContext = createContext<TargetMode | null>(null);
