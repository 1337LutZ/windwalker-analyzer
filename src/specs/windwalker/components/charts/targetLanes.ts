import { mergeIntervals, type Interval } from '~/lib/analysis/intervals';
import type { AuraLane, Window } from '~/lib/types';

/**
 * How the cast timeline decides what a per-target row is, and how it folds several of them into one.
 *
 * Their own module, not exports beside the chart: a component module has to export nothing but
 * components for React Fast Refresh to hot-swap it, and `CastTimeline` is the largest component in
 * the report — every edit to it was reloading the page rather than swapping the chart. They were
 * exported in the first place because the overrides they serve are held as view state with no prop
 * to set them from: the vitest environment is node, a static render cannot click a button, and these
 * two functions are where the claims worth testing actually live.
 */

/**
 * Whether a lane belongs to the per-enemy block at the foot of the chart.
 *
 * **This is a rule, not an accident.** The debuff rows and their target headings sat last because the
 * engine emits them last and an unlisted key keeps engine order — which is a fact about the order two
 * arrays were built in, not a decision, and would have quietly reversed the day either changed. So it
 * is stated here and sorted on before anything else.
 *
 * The reason it is worth stating: every row above this block is about the player — a button they
 * pressed, a buff they held — and reads the same whatever the fight was. These are the only rows
 * whose meaning depends on *which enemy* they are about, and a reader scanning down should reach the
 * per-enemy accounting once, at the end, rather than have it interleaved with their own rotation.
 * The debuff group is named as well as the target, so a collapsed row that has stopped naming an
 * enemy sinks with the block it came from rather than floating back up among the buffs.
 */
export const perTargetBlock = (lane: AuraLane): boolean => lane.group === 'debuff' || lane.target !== undefined;

/**
 * The per-target lanes of one aura, as a single lane.
 *
 * A union, and it has to be read as one: the bar says the debuff was on *something* at that moment,
 * which is a weaker claim than any of the rows it replaces and is emphatically not the uptime the
 * Rising Sun Kick section grades — that figure is measured against one enemy and stays that way,
 * whatever this chart is showing. `castLog.target.mergedNote` says so under the chart; this only
 * builds the row.
 *
 * `mergeIntervals` does the coalescing rather than a loop written here, because "which of these
 * overlapping windows join up" is the question it already answers for every uptime in the report.
 *
 * The row takes a key of its own, and two things follow from that which are both wanted. Nothing
 * merges a press into it — the press stream cannot say which enemy a Rising Sun Kick landed on, and
 * this row has stopped saying it too — and React cannot reconcile it with the per-enemy rows it
 * replaces, which share the aura's key between them.
 *
 * One enemy is left alone. Collapsing a single lane would rename a row that already says exactly
 * what it means, and every reference pull is that case.
 *
 * Exported, with `perTargetBlock` above it, because the overrides they serve are held as view state
 * with no prop to set them from — a static render cannot click a button, and these two functions are
 * where the claims worth testing actually live.
 */
export function collapseTargets(lanes: readonly AuraLane[], name: (aura: string) => string): AuraLane[] {
	const perKey = new Map<string, AuraLane[]>();
	for (const lane of lanes) {
		if (lane.target === undefined) continue;
		const bucket = perKey.get(lane.key);
		if (bucket === undefined) perKey.set(lane.key, [lane]);
		else bucket.push(lane);
	}

	const out: AuraLane[] = [];
	const done = new Set<string>();
	for (const lane of lanes) {
		const group = lane.target === undefined ? undefined : perKey.get(lane.key);
		if (group === undefined || group.length < 2) {
			out.push(lane);
			continue;
		}
		// The union takes the place of the first of its rows, so the block keeps the position the
		// engine's order gave it rather than jumping to the end of the list.
		if (done.has(lane.key)) continue;
		done.add(lane.key);
		const merged = mergeIntervals(group.flatMap((l) => l.windows.map(({ start, end }): Interval => [start, end])));
		out.push({
			key: `${lane.key}:any`,
			name: name(lane.name),
			id: lane.id,
			group: lane.group,
			windows: merged.map(([start, end]): Window => ({ start, end })),
		});
	}
	return out;
}
