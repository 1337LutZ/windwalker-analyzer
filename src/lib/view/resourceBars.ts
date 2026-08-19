// Reading a declared bar's curve across the two shapes a report can carry it in.

import { resourceColorOf } from '~/lib/game/resources';
import type { ResourceBarAudit, ResourceCurve } from '~/lib/types';

/**
 * The curve of a bar, whatever shape the report carried it in.
 *
 * A report from the engine carries the full audit — `{ kind, curve, … }` — and one from a fixture
 * captured before the audits existed carries the bare curve (`max`/`points`, no `kind`). A view
 * drawing the bar wants the curve in either case, so the shape is tested for here rather than at
 * every call site.
 */
export function curveOfBar(bar: ResourceBarAudit | ResourceCurve | undefined): ResourceCurve | undefined {
	if (bar === undefined) return undefined;
	return 'kind' in bar ? bar.curve : bar;
}

/**
 * The colour a bar draws in: the sim's own palette, falling back to the spec's when the sim has
 * none for it.
 *
 * A fixture predating the audits carries no `type`, so it draws in the fallback — which is what
 * those pulls were coloured before the bar knew its own name.
 */
export function barColor(bar: ResourceBarAudit | ResourceCurve | undefined, fallback: string): string {
	if (bar === undefined || !('kind' in bar)) return fallback;
	return resourceColorOf(bar.type) ?? fallback;
}
