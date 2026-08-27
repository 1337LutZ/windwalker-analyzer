// The shape a rotation reference is drawn from, and the one copy convention it is written in.
//
// `components/rotation/FlowChart` draws every spec's priority list, so the structure it draws and the
// keys it reads have to be a repository fact rather than a Windwalker one. The structure was already
// generic when it lived under `specs/windwalker/lib/view/rotationFlow.ts` — a rung is a button or a
// set of alternatives, and neither half of that names a spec — so what moved here is the declaration
// and nothing else. Each spec still builds its own `FlowSlot[]`: the Windwalker's is filtered by
// target count and by talent evidence, the Elemental's is its `ROTATION` table in three labelled
// stages, the Protection's is its `LADDER` in the sim's own order.
//
// ## The copy convention, and why it is `rotation.entry.*`
//
// Two conventions were in the tree and the shared chart can only read one:
//
//   - `rotation.entry.<key>.name` / `.test` / `.why`, with `rotation.gate.<key>` for the chip — the
//     Windwalker's, and the shape `FlowNode` is built around.
//   - `rotation.rule.<key>.name` / `.condition` — the Elemental's, written for the column of cards
//     that section used to be.
//
// **`rotation.entry.*` wins, and the reason is the third leaf rather than the count of specs using
// it.** A card can hold one sentence per row because a card is as tall as it wants to be; a node in a
// chart cannot, and the whole of `FlowNode`'s design argument is the split between the short line that
// names the condition and the paragraph a reader opens when they want the reason. A convention with
// only `condition` in it has nowhere to put the second half, so migrating the Elemental keys the other
// way would have meant deciding, once and for every spec, that the chart has no disclosures. The
// migration therefore ran `rule.<key>.name` → `entry.<key>.name` and `rule.<key>.condition` →
// `entry.<key>.test`, which is a rename and moves no words.
//
// `why` is **optional**, and that is the honest reading of what the Elemental copy turned out to be.
// Its `condition` strings are the whole rule in one line, so there is nothing behind them to disclose,
// and a chart that offered a **why** button opening a panel repeating the box above it would be worse
// than one that offers none. `FlowChart` takes `details` for that: true where the spec has written the
// paragraphs, false where the rung says everything it has to say on its face.
//
// The gate chip stays `rotation.gate.<key>` for all three, so one key names one rung's chip whether it
// carries a target count, a talent row or a trinket.

/**
 * One button on a rung.
 *
 * `key` names the copy — `rotation.entry.<key>`, and `rotation.gate.<key>` when it is gated — and
 * `id` is the ability's cast id, which resolves the icon and is also the evidence a talent row is
 * read from. The words stay in the locale; only the structure is here.
 */
export interface FlowEntry {
	key: string;
	id: number;
	gated: boolean;
}

/** A rung: one button, or the alternatives that share it. */
export type FlowSlot = { entry: FlowEntry } | { fork: string; branches: readonly FlowEntry[] };

/**
 * What a rung is addressed by, which is the fork's own name where it has one.
 *
 * A fork holds two or three keys and none of them names the rung, so a caller wanting to point at one
 * `<li>` — a band drawn across the line above it, a React key — needs the one string that is the same
 * whichever branch the reader turns out to have.
 */
export function slotKey(slot: FlowSlot): string {
	return 'fork' in slot ? slot.fork : slot.entry.key;
}

/** Every button a drawn flow holds, forks flattened. What the chart opens, and what an index checks against. */
export function flowKeys(flow: readonly FlowSlot[]): string[] {
	return flow.flatMap((slot) => ('fork' in slot ? slot.branches.map((b) => b.key) : [slot.entry.key]));
}
