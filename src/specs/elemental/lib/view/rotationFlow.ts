// The Elemental priority list as a reader sees it: `apl.ts`' `ROTATION` table, in the three stages
// that table already files it under, shaped for the chart every spec's reference is drawn with.
//
// It is a module rather than a constant inside `Rotation.tsx` for the reason the Windwalker's own
// version gives: the value of deriving the rungs from the list is that the two cannot drift, and
// "cannot drift" is a property a test has to assert. A component cannot be asked how many rungs it
// would draw, or which of them carries a chip, without being mounted.
//
// ## The stages are kept, and the order is theirs rather than the file's
//
// `ROTATION` is written in the p5 list's own order and the three groups interleave through it, so
// filing the rungs under `cooldown`, `dot` and `filler` reorders them. That is not new: the column of
// cards this replaced already grouped them, and the grouping is real structure — the cooldowns are the
// presses that come off a long timer, the Flame Shock rules are the dot everything else is gated on,
// and the fillers are what a global goes to when neither of the first two wants it. A chart with three
// labelled stages is still one chart, so the three arrive as bands drawn across the line rather than
// as three charts stacked.

import { ROTATION, type RotationEntry } from '~/specs/elemental/lib/apl';
import type { FlowSlot } from '~/lib/view/rotationFlow';

/**
 * The stages, in the order the reference reads them, each with the copy its band prints.
 *
 * The copy key is a literal beside the group rather than `` `rotation.group.${group}` `` assembled at
 * the call site, and that is load-bearing rather than a style choice: `i18n/__tests__/keys.test.ts`
 * finds a computed key only inside a `t(...)` call, so a template built out here would take these three
 * leaves out of the orphan hunt's reach and leave them alive whether or not anything drew them.
 */
const STAGES: readonly { readonly group: RotationEntry['group']; readonly title: string }[] = [
	{ group: 'cooldown', title: 'rotation.group.cooldown' },
	{ group: 'dot', title: 'rotation.group.dot' },
	{ group: 'filler', title: 'rotation.group.filler' },
];

/**
 * The whole list as one chart, stage by stage.
 *
 * Every rung is a plain entry: this spec's list has no fork in it, because nothing in `ROTATION` is one
 * entry the reader's own build or the pack in front of them picks between. The Windwalker's four forks
 * are all of that shape, which is why the type carries the case and this list never reaches it.
 *
 * `gated` is the talent flag, so the two rungs a player may simply not have say so on their own box.
 * Neither of them is a band: `ROTATION` carries no target counts at all, and the two rungs that only
 * exist above one enemy — Lava Beam and Chain Lightning — say so in their own condition line rather
 * than through a chip.
 */
export const ROTATION_FLOW: readonly FlowSlot[] = STAGES.flatMap(({ group }) =>
	ROTATION.filter((entry) => entry.group === group).map((entry): FlowSlot => ({
		entry: { key: entry.key, id: entry.id, gated: entry.talent === true },
	})),
);

/**
 * Where each stage's heading is drawn, as the rung it sits above.
 *
 * A band across the line rather than a heading between two lists, which is `FlowChart`'s one mechanism
 * for a boundary and the same one the Windwalker's target-count crossovers use. The rung it names is
 * the first of its group in `ROTATION` rather than a hand-written key, so a row moved between groups
 * moves its band with it.
 *
 * A stage with no rows in it contributes nothing, which is the honest drawing for a group `ROTATION`
 * has emptied — the column of cards this replaced skipped an empty group the same way.
 */
export const STAGE_BANDS: ReadonlyMap<string, string> = new Map(
	STAGES.flatMap(({ group, title }) => {
		const first = ROTATION.find((entry) => entry.group === group);
		return first === undefined ? [] : [[first.key, title] as const];
	}),
);
