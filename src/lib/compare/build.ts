// Two scored pulls in, one comparison out. Pure and synchronous, the way `analyseCore` is.

import type { BandView } from '~/lib/score/bands';
import type { Metric, Scorecard, SectionScore } from '~/lib/score/model';
import type { AbilityDamage, Analysis, CastRow } from '~/lib/types';

import { metricGap, TIE_BANDS } from './gap';
import type {
	AbilityGap,
	CastGap,
	Comparison,
	ComparabilityNote,
	MetricGap,
	PullFraming,
	SectionGap,
	Tally,
} from './model';

/**
 * One side of the comparison: a finished analysis, the scorecard taken from it, and the reading it
 * was scored at.
 *
 * The scorecard arrives already built rather than being derived here, because building it needs the
 * spec and nothing in this folder may import one. It is the caller that holds a `SpecDefinition`, and
 * `spec.score(analysis, view)` is a pure later pass over an analysis anyway.
 */
export interface Pull {
	analysis: Analysis;
	scorecard: Scorecard;
	view: BandView;
}

/**
 * How much longer one pull has to run than the other before the length is worth naming.
 *
 * A quarter again, and the reason is that several graded figures are shares of a pull whose ends are
 * a fixed size. `LostCastRow` carries an `openerSec` and a `tailSec`; a cooldown's drift accumulates
 * over the pull while the opener does not, so the same play reads differently at four minutes and at
 * nine. A ratio rather than a difference in seconds, because thirty seconds is most of a short pull
 * and a rounding error in a long one.
 */
const DURATION_RATIO = 1.25;

/**
 * The item-level gap at which gear is worth naming beside a damage difference.
 *
 * **A judgement, and the honest reading of it is narrow.** Nothing in this report models gear, so the
 * note makes no claim about how much damage the difference is worth. It exists so that a gap in DPS
 * is not read as a gap in technique when the two players were not carrying the same weapons. Ten
 * rather than one, because almost every pair of players differs by something and a note that fires on
 * every comparison is furniture rather than information.
 */
const ITEM_LEVEL_GAP = 10;

function framingOf({ analysis, scorecard, view }: Pull): PullFraming {
	return {
		player: analysis.player,
		code: analysis.code,
		fightID: analysis.fightID,
		encounter: analysis.encounter,
		difficultyName: analysis.difficultyName,
		kill: analysis.kill,
		durationMs: analysis.durationMs,
		itemLevel: analysis.itemLevel,
		rankPercent: analysis.rankPercent ?? null,
		dps: analysis.damage.dps,
		cpm: analysis.cpm.totalCpm,
		gcdUtilisationPct: analysis.cpm.gcdUtilisationPct,
		bands: view.bands,
		mode: view.mode,
		overall: scorecard.overall,
		judged: scorecard.judged,
	};
}

/** The same list of bands, whatever order each pull's reading put them in. */
function sameBands(a: readonly number[] | null, b: readonly number[] | null): boolean {
	if (a === null || b === null) return a === b;
	if (a.length !== b.length) return false;
	const left = [...a].sort();
	const right = [...b].sort();
	return left.every((band, at) => band === right[at]);
}

function notesFor(a: PullFraming, b: PullFraming): ComparabilityNote[] {
	const notes: ComparabilityNote[] = [];
	if (a.encounter !== b.encounter) notes.push({ kind: 'encounter', a: a.encounter, b: b.encounter });
	if (a.difficultyName !== b.difficultyName && a.difficultyName !== null && b.difficultyName !== null) {
		notes.push({ kind: 'difficulty', a: a.difficultyName, b: b.difficultyName });
	}
	// The two outcomes rather than the two lengths. Nothing in this note's sentence names either today,
	// and a note carrying values its copy does not read is a value nobody can check.
	if (a.kill !== b.kill) notes.push({ kind: 'outcome', a: String(a.kill), b: String(b.kill) });
	const longer = Math.max(a.durationMs, b.durationMs);
	const shorter = Math.min(a.durationMs, b.durationMs);
	if (shorter > 0 && longer / shorter > DURATION_RATIO) {
		notes.push({ kind: 'duration', a: a.durationMs, b: b.durationMs });
	}
	if (!sameBands(a.bands, b.bands)) {
		// The counts themselves, not the words for them: a reading is a set of target counts, and the
		// sentence has to be able to name which ones each pull reached.
		notes.push({ kind: 'bands', a: (a.bands ?? []).join(','), b: (b.bands ?? []).join(',') });
	}
	if (a.itemLevel !== null && b.itemLevel !== null && Math.abs(a.itemLevel - b.itemLevel) >= ITEM_LEVEL_GAP) {
		notes.push({ kind: 'itemLevel', a: a.itemLevel, b: b.itemLevel });
	}
	return notes;
}

/** A's order first, then anything only B holds, so a shared key is never listed twice. */
function unionKeys(a: readonly string[], b: readonly string[]): string[] {
	const seen = new Set(a);
	return [...a, ...b.filter((key) => !seen.has(key))];
}

function byKey(section: SectionScore | undefined): Map<string, Metric> {
	return new Map((section?.metrics ?? []).map((metric) => [metric.key, metric]));
}

function sectionGap(key: string, a: SectionScore | undefined, b: SectionScore | undefined): SectionGap {
	const left = byKey(a);
	const right = byKey(b);
	const order = unionKeys(
		(a?.metrics ?? []).map((metric) => metric.key),
		(b?.metrics ?? []).map((metric) => metric.key),
	);
	const metrics = order.map((metricKey) =>
		metricGap(metricKey, left.get(metricKey) ?? null, right.get(metricKey) ?? null),
	);

	const measured = metrics.filter((gap): gap is MetricGap & { bands: number } => gap.bands !== null);
	if (measured.length === 0) return { key, metrics, bands: null };
	const widest = measured.reduce((worst, gap) => (Math.abs(gap.bands) > Math.abs(worst.bands) ? gap : worst));
	return { key, metrics, bands: widest.bands };
}

function tallyOf(sections: readonly SectionGap[]): Tally {
	const tally: Tally = { a: 0, b: 0, level: 0, incomparable: 0 };
	for (const section of sections) {
		for (const gap of section.metrics) {
			if (gap.bands === null) tally.incomparable += 1;
			else if (gap.leader === 'a') tally.a += 1;
			else if (gap.leader === 'b') tally.b += 1;
			else tally.level += 1;
		}
	}
	return tally;
}

function abilityGaps(a: readonly AbilityDamage[], b: readonly AbilityDamage[]): AbilityGap[] {
	const left = new Map(a.map((ability) => [ability.id, ability]));
	const right = new Map(b.map((ability) => [ability.id, ability]));
	const ids = unionKeys(
		a.map((ability) => String(ability.id)),
		b.map((ability) => String(ability.id)),
	).map(Number);
	return ids
		.map((id) => {
			const one = left.get(id) ?? null;
			const two = right.get(id) ?? null;
			// One of the two is always present, because the id came from one of the two lists.
			const name = one?.name ?? two?.name ?? '';
			return {
				id,
				name,
				a: one,
				b: two,
				sharePoints: (one?.share ?? 0) - (two?.share ?? 0),
				passive: (one?.passive ?? false) || (two?.passive ?? false),
				utility: (one?.utility ?? false) || (two?.utility ?? false),
			};
		})
		.sort((one, two) => Math.abs(two.sharePoints) - Math.abs(one.sharePoints));
}

function castGaps(a: readonly CastRow[], b: readonly CastRow[]): CastGap[] {
	const left = new Map(a.map((row) => [row.id, row]));
	const right = new Map(b.map((row) => [row.id, row]));
	const ids = unionKeys(
		a.map((row) => String(row.id)),
		b.map((row) => String(row.id)),
	).map(Number);
	return ids
		.map((id) => {
			const one = left.get(id) ?? null;
			const two = right.get(id) ?? null;
			const name = one?.name ?? two?.name ?? '';
			return {
				id,
				name,
				a: one,
				b: two,
				cpm: (one?.cpm ?? 0) - (two?.cpm ?? 0),
				gate: one !== null && two !== null && one.gate === two.gate ? one.gate : null,
			};
		})
		.sort((one, two) => Math.abs(two.cpm) - Math.abs(one.cpm));
}

/**
 * Two pulls of one spec, differenced.
 *
 * Order is load-bearing and is the caller's: `a` is named first in every figure the view draws, and
 * every sign in the result reads "positive means A". Swapping the arguments negates the comparison
 * rather than producing a different one.
 *
 * The sections come back in the scorecard's own order, which is the report's editorial order, because
 * that is what the metric detail is read in. Ranking them by gap is the chart's job and it sorts a
 * copy, so the two orderings cannot drift apart.
 */
export function compare(a: Pull, b: Pull): Comparison {
	const framingA = framingOf(a);
	const framingB = framingOf(b);
	const sections = unionKeys(Object.keys(a.scorecard.sections), Object.keys(b.scorecard.sections)).map((key) =>
		sectionGap(key, a.scorecard.sections[key], b.scorecard.sections[key]),
	);
	return {
		a: framingA,
		b: framingB,
		notes: notesFor(framingA, framingB),
		tally: tallyOf(sections),
		sections,
		abilities: abilityGaps(a.analysis.damage.abilities, b.analysis.damage.abilities),
		casts: castGaps(a.analysis.casts, b.analysis.casts),
	};
}

/** The sections a ranked chart draws, widest gap first, with the ones that compare to nothing last. */
export function ranked(sections: readonly SectionGap[]): SectionGap[] {
	return [...sections].sort((one, two) => Math.abs(two.bands ?? 0) - Math.abs(one.bands ?? 0));
}

export { TIE_BANDS };
