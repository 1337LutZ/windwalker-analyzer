// The Protection priority list as a reader sees it, rather than as a verdict on a pull.
//
// `apl.ts` is the list, and this is the whole of what the reference is allowed to know about it: the
// order, the button on each rung, and whether the rung is one every Paladin has. Everything here is
// read off `LADDER_ENTRIES`, so there is no second copy of the order and no rung this section can show
// that the audit above it does not walk.
//
// ## Nothing is hand-written, which is the difference from the Windwalker's
//
// That spec's flow carries a prelude of six rungs its ladder refuses to model — cooldowns judged by
// sections of their own — and the seam between the two halves needs a test to hold it. This one has no
// prelude at all, and the reason is the fact `apl.ts` calls the most consequential thing about this
// spec: **both holy power spenders are off the global cooldown.** Shield of the Righteous and Eternal
// Flame cost the player nothing this list arbitrates, so they are not decisions about a global and
// there is no rung for them to be missing from. What is left is seventeen generators in one order, and
// one order is what `LADDER_ENTRIES` already is.
//
// The four `wait` actions the sim's own file carries are gone for the same reason they are gone from
// the audit: a wait is not a press, and this list is a list of presses.

import { ALL_BANDS } from '~/lib/spec/apl';
import { LADDER_ENTRIES } from '~/specs/protection/lib/apl';
import type { FlowSlot } from '~/lib/view/rotationFlow';

/**
 * The seventeen rungs, in the sim's evaluation order.
 *
 * `gated` is true for a rung a reader may not have, and this spec has both kinds. A talent rung is one
 * the player chose or did not — the two level-90 buttons, Sacred Shield, and the Judgment rung that
 * only pays inside Avenging Wrath if Sanctified Wrath was taken. A banded rung is one the pack decides:
 * the builder splits into a single-target half and a cleave half at the same position, and Consecration
 * appears twice at two heights, which is the only shape that can say a button moves *up* the list when
 * a second body arrives.
 *
 * Read off the entry rather than listed, so a band or a talent added to a rung in `apl.ts` puts a chip
 * on that rung here without anybody remembering to. The chip's words are `rotation.gate.<key>`, which
 * is where the difference between "2+ targets" and "Talent" is written down.
 */
export const ROTATION_FLOW: readonly FlowSlot[] = LADDER_ENTRIES.map((entry): FlowSlot => ({
	entry: { key: entry.key, id: entry.id, gated: entry.talent || entry.bands.length < ALL_BANDS.length },
}));
