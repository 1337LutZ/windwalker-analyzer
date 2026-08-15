import type { Grade } from './model';

/**
 * How a share of wasted resource reads as a colour.
 *
 * Deliberately *not* part of `lib/score`'s graded model, and the distinction matters. Nothing in the
 * simulator or the priority list says how much overflow is acceptable — the list spends a resource
 * when it has something worth spending it on and pools it when it does not — which is exactly why
 * neither energy nor chi carries a graded section. Inventing a threshold and calling it a verdict is
 * the failure this report is built to avoid.
 *
 * What this is instead: a reading aid on one tile, so a number a reader cannot calibrate carries some
 * hint of its own size. The bands are round numbers rather than quantiles of a sample, and they are
 * round on purpose — three reference pulls (1.4%, 2.4%, 3.4% of chi generated) is far too small to
 * derive a distribution from, and dressing three points up as percentiles would claim a precision
 * that does not exist.
 *
 * The copy beside it never says "good" or "bad". It states the number.
 */
export function wasteTone(wasted: number, generated: number): Grade | null {
	// No denominator, no opinion. A pull that generated nothing has not wasted a share of anything.
	if (!(generated > 0)) return null;
	const share = (wasted / generated) * 100;
	if (share < 2) return 'good';
	if (share < 5) return 'ok';
	return 'bad';
}
