import { createContext } from 'react';

import type { BandView } from '~/lib/score';

/**
 * The reading the whole report grades from.
 *
 * Context rather than a prop, and that is a reversal of what `Report.tsx` used to say. When the
 * reading had one consumer the note there read "one consumer does not justify putting every section
 * behind a provider", which was true then. It has many now: the reading reaches `spec.score`, so it
 * moves the scorecard, and the scorecard is what roughly twenty-five components read their copy and
 * their grades from. Threading it through all of them as a prop would be twenty-five signatures
 * changed to carry one value none of them use directly.
 *
 * **A `BandView` and no longer a `TargetMode`, which is the point of this module rather than a detail
 * of it.** A mode is a whole-pull binary and the pull this report gets wrong is not binary: add waves
 * and then a boss is one pull whose clocks run through stretches no priority list asked their button
 * of, and whichever of the two words won, one of those stretches was graded against a list that never
 * applied to it. The set can say that; the mode carries on beside it inside the view, for the one
 * question that genuinely is whole-pull — see `BandView.mode`.
 *
 * The sections that select *data* by target count still take a mode as a prop from `Report.tsx` and
 * deliberately do not read this: `PriorityLadder` judges at one band and `Rotation` prints the list at
 * one band, so a set is the wrong answer for them. `bandForMode` stays theirs.
 *
 * The default is the honest empty reading — no bands, no mode — and it grades everything, which is
 * what every caller did before bands existed. Null bands must never become "no band applies": that
 * would exempt every banded rule at once, which is the failure direction the whole mechanism is built
 * to avoid. A default that guessed `'single'` instead would let every section below grade against a
 * list this file chose.
 *
 * Kept in its own module because a context object is not a component, and a module that exports both
 * is one React Fast Refresh will not hot-swap — the same rule the rest of `components/` follows.
 */
export const ScoreViewContext = createContext<BandView>({ bands: null, mode: null, forced: false });
