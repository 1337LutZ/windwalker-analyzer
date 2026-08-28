// How the segment modes are named and ordered — the words and the running order, kept away from the
// drawing.
//
// Lifted out of `SegmentStrip` when a second component wanted them. `FightReplay` mounts *inside* the
// strip's header and needs the same label for its mode chip, so leaving them there made the two modules
// import each other; a cycle that works today is a cycle that breaks the first time one of them reads
// the other at module scope. Nothing here renders — an order and two functions of a segment and a
// translator — which is why this is the half that moves.
//
// All three stay re-exported from `SegmentStrip` so existing callers are untouched.

import { type TFunction } from 'i18next';

import type { FightSegment, SegmentMode } from '~/lib/analysis/segments';

/**
 * The order the key names the modes in, and the only place that order is decided.
 *
 * Ascending by how many enemies were up, with the two that are not counts at the foot. That is the
 * order the ramp itself rises in, so the key reads as the scale it is describing rather than as the
 * order this pull happened to meet them.
 */
/**
 * The order the modes are named in, rising with the count and ending on the two that are not counts.
 *
 * Exported so the segment tool's summary tiles run in the same order as this chart's key. A reader
 * comparing the two should not have to re-find `aoe` in a different place.
 */
export const KEY_ORDER: readonly SegmentMode[] = ['single', 'cleave', 'aoe', 'mixed', 'idle'];

/**
 * What a segment is called, in words.
 *
 * **Exported so the segment tool's table says the same thing its strip does.** A reader who hovers a bar
 * and then hovers the row under it is asking one question twice, and two spellings of the answer — "aoe"
 * in one place and "Three or more enemies" in the other — is the page disagreeing with itself.
 *
 * The tooltip names the mix rather than repeating the key: a stretch that ran between one and three
 * enemies says so, which is the question a `mixed` bar raises and used not to answer. A mixed stretch
 * with no bands recorded cannot describe its own range, and `Math.min` of an empty list is `Infinity` —
 * so that case keeps the generic name rather than printing one.
 */
export function segmentLabel(segment: FightSegment, t: TFunction<'report'>): string {
	return segment.mode === 'mixed' && segment.bands.length > 0
		? t('summary.shape.rowMixed', {
				low: Math.min(...segment.bands),
				high: Math.max(...segment.bands),
				// Floored at one, for the same reason `shortOf` floors it: a stretch can hold enough zero-run
				// to median at nought without ever being idle — `spoils` opens with 13s of exactly that — and
				// "mostly 0 enemies" on a bar that is not the idle bar reads as a contradiction of the bar
				// beside it.
				median: Math.max(1, Math.round(segment.medianEnemies)),
			})
		: t('summary.shape.row', { context: segment.mode });
}

/** How long it ran, in the strip's own words. Exported beside `segmentLabel`, for the same reason. */
export function segmentLength(segment: FightSegment, t: TFunction<'report'>): string {
	return t('summary.shape.length', { seconds: Math.round((segment.endMs - segment.startMs) / 1000) });
}
