// Blackout Kick, read off a finished analysis.
//
// A view module, not an engine audit: everything here is arithmetic over things `analyse()` already
// published, so nothing can disagree with the sections it borrows from.
//
// The list carries the button at two rungs, and they are different decisions. Entry 24 is the free
// press from a Combo Breaker proc; entry 32 is the chi dump, gated on the energy banked by the time
// Rising Sun Kick returns. `AplPress.wanted` names the rule even on a press that followed it, so the
// split is read rather than re-derived.
//
// That shape is also why the free kick needs no special case: `combo-breaker-kick` can never be the
// button a Blackout Kick press *skipped*, because a rule the press itself satisfies returns
// `followed`. Zero occurrences across all six fixtures.
//
// **Two claims, never added together.** "The list wanted something else here" is the ladder's, and
// moves with the reader's target count. "This press cost you a kick later" is about the chi bar,
// lands on a later global, and moves with nothing — enemy count does not change whether you had two
// chi. One number folding both would answer neither.

import { LADDER_ENTRIES, type AplAudit, type AplRuleKey } from '~/lib/spec/apl';
import { RSK_COOLDOWN_MS } from '~/lib/spec/windwalker';
import type { Analysis, StarvedKick } from '~/lib/types';

/** The button's cast id, which the ladder, the cast table and the icon all key on. */
export const BLACKOUT_KICK_CAST_ID = 100_784;

/** The Combo Breaker buff that makes one free — the aura's id, not the button's. */
const COMBO_BREAKER_KICK_AURA_ID = 116_768;

/** A button the list wanted at a global that went to a Blackout Kick instead. */
export interface WantedInstead {
	key: AplRuleKey;
	/** The cast id, so the row can draw the button's own icon rather than name it twice. */
	id: number;
	count: number;
}

/** What the priority list made of this button's presses, at the band the reader is reading. */
export interface BlackoutKickLadder {
	presses: number;
	/** Presses the ladder reached a verdict on: `followed + skipped`. */
	judged: number;
	/** Followed as entry 24 — a Combo Breaker proc spent. */
	free: number;
	/** Followed as entry 32 — a dump the list's energy reserve allowed. */
	dump: number;
	skipped: number;
	/** Presses sitting under a rule this log cannot read, and presses the list wanted nothing at. */
	unknown: number;
	offList: number;
	/**
	 * What the list wanted instead, most often first.
	 *
	 * Walked out of `presses` rather than read off `skippedBy`, and the difference is the whole point:
	 * `skippedBy` counts how often a button was passed over by *any* press, which answers a question
	 * about Tiger Palm rather than a question about this button. Every skipped Blackout Kick lands in
	 * exactly one row here.
	 */
	wantedInstead: WantedInstead[];
}

/** Rising Sun Kick waiting on a bar this button emptied. */
export interface BlackoutKickStarve {
	/** Time the kick sat ready and unpressed — the whole of it, whatever the reason. */
	driftMs: number;
	starvedMs: number;
	starvedWaits: number;
	chargedMs: number;
	charged: StarvedKick[];
	/** The charged time as kicks, floored: a cooldown's worth is the unit this report already loses in. */
	chargedKicks: number;
	/** Charged waits where the debuff was actually off the primary target for part of it. */
	debuffDrops: number;
	/**
	 * Charged presses the list itself wanted — the number saying "follow the list" is not the whole fix.
	 * Entry 32 guards the dump with an *energy* reserve; the failure is a *chi* one, so a press can clear
	 * the condition and starve the kick anyway. 43 of 175 charged presses did, across 52 pulls.
	 *
	 * The only figure in this half that moves with the reader's band, and correctly — it asks the ladder
	 * a question. The waits and seconds do not, because they ask the chi bar.
	 */
	followedList: number;
	/**
	 * How often the reconstructed chi bar predicted the next reading exactly; null when too few readings
	 * to score. Printed per pull rather than quoted from the ladder's 87–95%, which came off three pulls
	 * — over 52 it runs 56.8–94.5%, so each pull states its own.
	 */
	chiAccuracyPct: number | null;
}

export interface BlackoutKickReading {
	casts: number;
	/** Combo Breaker procs, and how many expired unspent. Null when the analysis carried no row. */
	procs: { procs: number; wasted: number } | null;
	/** Null when the ladder did not run — no resource readings, or an analysis captured before it. */
	ladder: BlackoutKickLadder | null;
	/** Null on an analysis captured before the audit existed. Never a zeroed audit standing in for one. */
	starve: BlackoutKickStarve | null;
}

/** The cast id behind a rule key, from the ladder's own published projection rather than a second table. */
function idOf(key: AplRuleKey): number {
	return LADDER_ENTRIES.find((entry) => entry.key === key)?.id ?? 0;
}

function ladderOf(apl: AplAudit | null | undefined): BlackoutKickLadder | null {
	if (apl === null || apl === undefined) return null;
	const mine = apl.presses.filter((p) => p.pressed === BLACKOUT_KICK_CAST_ID);
	const followed = mine.filter((p) => p.verdict === 'followed');
	const skipped = mine.filter((p) => p.verdict === 'skipped');

	const counts = new Map<AplRuleKey, number>();
	for (const press of skipped) {
		if (press.wanted === null) continue;
		counts.set(press.wanted, (counts.get(press.wanted) ?? 0) + 1);
	}

	return {
		presses: mine.length,
		judged: followed.length + skipped.length,
		free: followed.filter((p) => p.wanted === 'combo-breaker-kick').length,
		dump: followed.filter((p) => p.wanted === 'blackout-kick').length,
		skipped: skipped.length,
		unknown: mine.filter((p) => p.verdict === 'unknown').length,
		offList: mine.filter((p) => p.verdict === 'off-list').length,
		wantedInstead: [...counts]
			.map(([key, count]) => ({ key, id: idOf(key), count }))
			// Ties break on the list's own order, so two buttons passed over equally often appear in the
			// order the list would have reached them.
			.sort(
				(a, b) =>
					b.count - a.count ||
					LADDER_ENTRIES.findIndex((e) => e.key === a.key) - LADDER_ENTRIES.findIndex((e) => e.key === b.key),
			),
	};
}

function starveOf(analysis: Analysis, apl: AplAudit | null | undefined): BlackoutKickStarve | null {
	const audit = analysis.blackoutKick;
	if (audit === undefined) return null;
	const verdictAt = (t: number): string | undefined => apl?.presses.find((p) => p.t === t)?.verdict;
	return {
		driftMs: audit.driftMs,
		starvedMs: audit.starvedMs,
		starvedWaits: audit.starvedWaits,
		chargedMs: audit.chargedMs,
		charged: audit.charged,
		chargedKicks: Math.floor(audit.chargedMs / RSK_COOLDOWN_MS),
		debuffDrops: audit.charged.filter((c) => c.debuffDown).length,
		followedList: audit.charged.filter((c) => verdictAt(c.pressAt) === 'followed').length,
		chiAccuracyPct: audit.chiPredicted > 0 ? (audit.chiExact / audit.chiPredicted) * 100 : null,
	};
}

/**
 * The whole reading.
 *
 * `apl` is passed in rather than taken off the analysis for the same reason `readJadeWind` takes it:
 * the reader's target-count override chooses between five precomputed walks, and that choice is
 * `bandForMode`'s. A section picking its own band would contradict the section that lists the skips.
 *
 * The starvation half is handed the same audit only to look up what the list made of a press it has
 * already identified — never to decide whether the press starved anything. That decision is the chi
 * bar's and is the same at every band.
 */
export function readBlackoutKick(analysis: Analysis, apl: AplAudit | null | undefined): BlackoutKickReading {
	const row = analysis.comboBreaker.find((cb) => cb.id === COMBO_BREAKER_KICK_AURA_ID);
	return {
		casts: analysis.blackoutKick?.casts ?? analysis.casts.find((c) => c.id === BLACKOUT_KICK_CAST_ID)?.count ?? 0,
		procs: row === undefined ? null : { procs: row.procs, wasted: row.wasted },
		ladder: ladderOf(apl),
		starve: starveOf(analysis, apl),
	};
}
