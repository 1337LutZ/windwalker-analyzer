// What is left of the WarcraftLogs hourly point budget, and how the app comes to know it.
//
// WarcraftLogs meters per API client, and every visitor here registers their own — so the budget on
// screen is theirs alone, and running it down is something they can actually do. `Query.rateLimitData`
// answers it directly: `limitPerHour`, `pointsSpentThisHour`, and `pointsResetIn` seconds.
//
// **Asking costs a point.** That is the constraint the whole of this file is shaped by: a readout
// that polled would spend the budget it claims to be protecting, and at one point a minute it would
// spend 60 an hour to report on 9000. So nothing here polls. The field is bundled into every
// document in this folder instead, which was measured against the live API and is free:
//
//   ReportFights alone .................. 1.01 points
//   ReportFights + rateLimitData ........ 1.01 points
//   FightEvents alone ................... 1.00 points
//   FightEvents + rateLimitData ......... 1.00 points
//   rateLimitData alone ................. 1.00 points
//
// WarcraftLogs prices a request by its heaviest resolver rather than by summing them, so the field
// adds nothing to a request that was going out anyway. It also means the figure refreshes exactly
// when the reader does something — the last page of a pull's events carries the number that pull
// finished on — which is the behaviour that was wanted, arrived at by not spending anything.
//
// The store below is module-scoped rather than React state because the values arrive from inside
// query functions, several layers under the components that display them, and there is exactly one
// budget per tab. `forget()` exists because the budget belongs to the token: signing out must drop
// it with everything else the token bought.

/**
 * One reading of the budget, as of the request that carried it.
 *
 * `resetAt` rather than the API's `pointsResetIn`: seconds-from-now is only true at the instant it
 * was received, and this value is displayed minutes later. Resolving it to a wall-clock time here
 * means a tooltip opened later says when the reset is, not when it was going to be.
 */
export interface ApiCredits {
	limit: number;
	spent: number;
	/** Epoch ms, derived from `pointsResetIn` at the moment the reading arrived. */
	resetAt: number;
}

export interface CreditsSnapshot {
	credits: ApiCredits | null;
	/**
	 * What one analysis actually cost, observed rather than assumed. Null until one has been watched
	 * end to end.
	 */
	analysisCost: number | null;
}

/**
 * What an analysis is assumed to cost before one has been watched.
 *
 * Measured, not guessed: a pull is a report query, an actor list, a damage table and one request per
 * page of events — five points for the two-page pull this was measured on, four for a short one that
 * pages once. It is deliberately the higher of the two, so the first estimate a reader sees errs
 * towards promising less than they have.
 *
 * It is only ever a seed. The moment an analysis completes, `analysisCost` holds what that pull
 * really cost and this constant stops being consulted — which matters, because the cost is not
 * constant: `fightEvents` pages, so a nine-minute Garrosh costs more than a three-minute one and no
 * single number is right for both.
 */
export const ASSUMED_ANALYSIS_COST = 5;

const EMPTY: CreditsSnapshot = { credits: null, analysisCost: null };

let snapshot: CreditsSnapshot = EMPTY;
const listeners = new Set<() => void>();

function publish(next: CreditsSnapshot): void {
	snapshot = next;
	for (const listener of listeners) listener();
}

export function subscribeCredits(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function readCredits(): CreditsSnapshot {
	return snapshot;
}

/** The prerender has never made a request, so it has nothing to show and must not invent one. */
export function readCreditsOnServer(): CreditsSnapshot {
	return EMPTY;
}

export function recordCredits(credits: ApiCredits): void {
	publish({ ...snapshot, credits });
}

/**
 * What the analysis that just finished cost, in points.
 *
 * Refused when it is not positive, which is the hour rolling over mid-analysis: `pointsSpentThisHour`
 * goes back to near zero, and the difference across the run comes out negative. A reset is not a
 * measurement, so it is dropped rather than recorded as a nonsensical cost.
 */
export function recordAnalysisCost(points: number): void {
	if (!(points > 0)) return;
	publish({ ...snapshot, analysisCost: points });
}

export function forgetCredits(): void {
	publish(EMPTY);
}

/**
 * The reading carried by a response, or null if it did not carry one.
 *
 * Parsed rather than asserted, and null on anything unexpected. Every consumer of this treats null
 * as "say nothing" — a credits display that read `0 remaining` because a field came back missing
 * would stop people using an app that is working perfectly well.
 */
export function readRateLimit(data: unknown, now: number = Date.now()): ApiCredits | null {
	if (typeof data !== 'object' || data === null) return null;
	const node = (data as Record<string, unknown>)['rateLimitData'];
	if (typeof node !== 'object' || node === null) return null;
	const { limitPerHour, pointsSpentThisHour, pointsResetIn } = node as Record<string, unknown>;
	if (typeof limitPerHour !== 'number' || !Number.isFinite(limitPerHour) || limitPerHour <= 0) return null;
	if (typeof pointsSpentThisHour !== 'number' || !Number.isFinite(pointsSpentThisHour)) return null;
	if (typeof pointsResetIn !== 'number' || !Number.isFinite(pointsResetIn)) return null;
	return {
		limit: limitPerHour,
		spent: pointsSpentThisHour,
		resetAt: now + pointsResetIn * 1000,
	};
}

/** A credits reading turned into the three things the UI says about it. */
export interface CreditsView {
	spent: number;
	limit: number;
	remaining: number;
	/** 0–100, how much of the hour's budget is left. */
	percentLeft: number;
	resetAt: number;
	/** Roughly how many more pulls fit in what is left, already rounded down. */
	pullsLeft: number;
	/** What one pull is being assumed to cost, and whether that came from watching one. */
	costPerPull: number;
	measured: boolean;
}

/**
 * The reading as the UI states it, or null when there is nothing honest to state.
 *
 * Null on an expired reading as well as on no reading at all. `resetAt` in the past means the hour
 * turned over since this was received, so the spend it reports is from a budget that no longer
 * exists — showing it would understate what the reader actually has left. It corrects itself on the
 * next request, and until then the display says nothing rather than something stale.
 */
export function viewCredits(snap: CreditsSnapshot, now: number = Date.now()): CreditsView | null {
	const { credits, analysisCost } = snap;
	if (credits === null || credits.resetAt <= now) return null;

	const remaining = Math.max(0, credits.limit - credits.spent);
	const costPerPull = analysisCost ?? ASSUMED_ANALYSIS_COST;
	return {
		spent: credits.spent,
		limit: credits.limit,
		remaining,
		percentLeft: (remaining / credits.limit) * 100,
		resetAt: credits.resetAt,
		pullsLeft: coarsen(Math.floor(remaining / costPerPull)),
		costPerPull,
		measured: analysisCost !== null,
	};
}

/**
 * Rounds a pull count down to as few digits as it deserves.
 *
 * The quotient is arithmetic on an estimate: the divisor is what *one* pull happened to cost, and
 * the next pull is a different length. Printing `1,783 pulls left` off that would be four digits of
 * confidence behind one measurement, so the tail is dropped — a hundred at a time in the thousands,
 * ten at a time in the hundreds.
 *
 * Below a hundred it is left exact, which is the one place the digits are worth having: a reader
 * with seven pulls left wants to know it is seven and not "about ten".
 */
function coarsen(pulls: number): number {
	if (pulls >= 1000) return Math.floor(pulls / 100) * 100;
	if (pulls >= 100) return Math.floor(pulls / 10) * 10;
	return pulls;
}
