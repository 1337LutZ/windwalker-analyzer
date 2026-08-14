// The boundary where an untyped API blob becomes a `WclEvent`, plus the two ways the engine scopes
// a stream to one actor.

import type { WclEvent } from './model';

/**
 * The only conversion from what the API sent into `WclEvent`.
 *
 * Rows without a numeric `timestamp` and a string `type` are dropped rather than trusted: they can
 * be placed on no timeline and narrowed to nothing, so keeping them only pushes the failure
 * somewhere further from its cause. Everything else is kept, unmodelled types included — the
 * catch-all variant exists so a new event type the API starts emitting cannot break a parse.
 */
export function parseEvents(data: unknown): WclEvent[] {
	if (!Array.isArray(data)) return [];
	return data.filter(isEventShape);
}

function isEventShape(value: unknown): value is WclEvent {
	if (typeof value !== 'object' || value === null) return false;
	const row = value as Record<string, unknown>;
	return typeof row['timestamp'] === 'number' && typeof row['type'] === 'string';
}

/** Events that landed on one actor — how every self-buff window is scoped. */
export function eventsOn(events: readonly WclEvent[], targetID: number): WclEvent[] {
	return events.filter((e) => e.targetID === targetID);
}

/** Events one actor produced. */
export function eventsFrom(events: readonly WclEvent[], sourceID: number): WclEvent[] {
	return events.filter((e) => e.sourceID === sourceID);
}
