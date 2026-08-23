// The Windwalker scoring module: the bands, the weights and the whole-pull verdicts for this
// spec only.
//
// The generic shapes live in `lib/score` — a grade is a grade for any spec — but everything
// that says what a *Windwalker* number means lives here: the thresholds that turn measurements
// into judgements, the weights that turn judgements into a headline, and the reading aids
// (`wasteTone` and friends) that colour the tiles. A second spec brings its own module beside
// this one; the registry points each at its own.

import type { Analysis, BrewSummary, FillerAudit, ProcSummary, TargetSummary } from '~/lib/types';
import { countAt } from '~/lib/analysis/targets';
import { TEB_ACTIVE_MS, TEB_DRAIN } from '~/specs/windwalker/lib';
import {
	appliesAt,
	GRADE_ORDER,
	gradedOver,
	grader,
	gradeOf,
	overallOf,
	section,
	shareOf,
	sharePct,
	viewMode,
} from '~/lib/score';
import type { Grade, Measured, MetricRule, Scorecard, ScoreView, Threshold } from '~/lib/score';
import { bandOf } from '~/lib/spec/apl';

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
/**
 * The bands, as data.
 *
 * All three tones below are the same comparison — `gradeOf` in `./model`, which the graded metrics
 * already run on — differing only in where the lines sit and which direction is better. Writing that
 * comparison out three times invited the three copies to drift, and drift here is invisible: a band
 * off by a point still returns a plausible colour.
 *
 * They stay three named functions rather than one taking a band, because the reason they were split
 * is that a caller passing the wrong bands gets a believable answer instead of an error. The names
 * are the type check. What is shared is the arithmetic, not the choice.
 */
const BANDS = {
	// Lower is better: this is a share of something thrown away.
	waste: { good: 2, ok: 5, higherIsBetter: false },
	usage: { good: 90, ok: 70, higherIsBetter: true },
	defensiveUse: { good: 80, ok: 50, higherIsBetter: true },
} as const satisfies Record<string, Threshold>;

/** A share, or null when there is no denominator to take one of. */
function share(part: number, whole: number): number | null {
	return whole > 0 ? (part / whole) * 100 : null;
}

export function wasteTone(wasted: number, generated: number): Grade | null {
	// No denominator, no opinion. A pull that generated nothing has not wasted a share of anything.
	const pct = share(wasted, generated);
	return pct === null ? null : gradeOf(BANDS.waste, pct);
}

/**
 * The same reading aid, the other way up: a share of something that should have been taken.
 *
 * Separate from `wasteTone` rather than a flag on it, because the two answer different questions and
 * a caller passing the wrong one would get a plausible colour rather than an error. Same caveat
 * applies and applies harder — nothing says how many Chi Brew charges a pull is *supposed* to spend,
 * only that a charge sitting at the ceiling is not recharging. These bands are a hint at the size of
 * a number, not a verdict anybody earned.
 */
export function usageTone(used: number, possible: number): Grade | null {
	// A ceiling of zero is not a target anyone missed.
	const pct = share(used, possible);
	return pct === null ? null : gradeOf(BANDS.usage, pct);
}

/**
 * `usageTone` again, and much more forgiving, for a cooldown whose worth the *encounter* sets.
 *
 * Touch of Karma is the case. Its charges are counted the same way Chi Brew's are — the opener plus
 * one per recharge inside the pull — but the two are not the same claim. A Chi Brew charge is worth
 * pressing whenever it is up; a Karma charge is worth pressing only while something is hitting you,
 * and a pull that offers three recharges rarely offers three stretches of incoming damage. Grading
 * that against `usageTone`'s 90/70 calls two presses out of three a failure, which faults a player
 * for the shape of the fight rather than for anything they did.
 *
 * So: nearly every charge is `good`, at least half is `ok`, and below half is worth a reader's eye
 * rather than a verdict. Round numbers, and the same caveat as everything else in this file — a hint
 * at the size of a number, never a judgement, and never anything `lib/score` counts. The graded
 * question about Touch of Karma is what the presses *returned*, which is a different tile.
 */
export function defensiveUseTone(used: number, possible: number): Grade | null {
	const pct = share(used, possible);
	return pct === null ? null : gradeOf(BANDS.defensiveUse, pct);
}

// Turns one analysis into a scorecard: a grade per metric, a grade per section, one overall.
//
// Pure and total. Every metric that cannot be measured in a given pull is marked rather than
// defaulted, because a pull with no Re-Origination procs has not failed to snapshot them — and copy
// that says "0 of 0 caught, poor" about a fight that never offered the chance is worse than silence.

// `sharePct`, `section` and `overallOf` come from `~/lib/score` — they were identical to the Elemental
// module's copies once the comments were stripped. `grader` binds this spec's own thresholds *and* the
// pull's reading, which is the only part of the four that was ever spec-specific, and the reading is
// the half it would be easy to leave off exactly one metric.

/**
 * The Tiger Palm presses the rule was ever about, and the share of them that bought nothing.
 *
 * The count-metric counterpart of `Metric.gradedMs`, and the reason `bands: [1]` on this rule is a
 * control rather than a decoration. The declaration on its own only answers "did this pull ever enter
 * band 1", and on the fixtures we hold every pull did — all six visit band 1, the two the counts read
 * as multi-target included — so a band with nothing narrowing the sample behind it would exempt
 * nothing under the detected reading while presenting as an exemption. This is the narrowing: a press
 * made with three enemies up was never a press the single-target filler rule asked for, so it leaves
 * the numerator and the denominator together.
 *
 * Narrowed by the *rule's* bands and not by the reader's, deliberately. How many enemies were up is a
 * measurement rather than a reading — forcing the report to argue single-target does not retroactively
 * empty the room — so this cut is the same on every reading, exactly as the Elemental's audit cuts its
 * clocks at the regime boundaries whatever the reader asked for. What the reader's reading decides is
 * the *other* half: whether the rule applied to this pull at all, which is `metricOf`'s exemption.
 *
 * `castList` and `casts` are two views of one measurement, and the cut only applies where they agree.
 * Where they do not there is nothing trustworthy to narrow with, so the whole-pull share stands — what
 * this metric graded before bands existed, and the conservative direction: it judges too much rather
 * than excusing too much.
 */
function tigerPalmShare(filler: FillerAudit, targets: TargetSummary | undefined): Measured {
	if (filler.castList.length !== filler.casts) return shareOf(filler.wasted, filler.casts);
	// **`aplCounts` — the ladder's series — and not `counts` beside it.** This narrows a press sample by
	// band, so it is a question about which rung of the priority list applied, and that question reads
	// the series the ladder was handed. The difference is the spec's own area damage, which for this spec
	// is Rushing Jade Wind: on a pull whose only fan-out is the wind, the evidence series reads three and
	// the ladder reads none, and `bandOf(0)` is 1 — so the ladder spent that stretch in its single-target
	// branch, asking for exactly the filler this rule is about.
	//
	// **And the direction it was wrong in is the one that matters.** Read off `counts`, a press made
	// while the wind was fanning into a pack leaves the sample entirely — numerator and denominator — so
	// a monk who clipped a healthy Tiger Power all through an add wave has those presses excused and
	// grades on whatever is left. That is excusing more, not judging more: `targetSeries.aplBands.test.ts`
	// holds the pull where it is 0% waste under the old reading and 67% under this one, on one set of
	// events. The exclusion exists so the wind cannot justify *itself* on the ladder; it was never a
	// claim that the enemies stopped being there, and least of all a reason to stop counting presses.
	//
	// Falls back to `counts` when `aplCounts` is absent, and zero before the first counted hit with
	// `bandOf` reading zero as band 1 — so a pull with no counts at all (every fixture captured before
	// they existed) keeps every press, which is the reading that grades everything rather than the one
	// that excuses everything.
	const enemiesAt = countAt(targets?.aplCounts?.points ?? targets?.counts.points ?? []);
	const presses = filler.castList.filter((press) => appliesAt(THRESHOLDS.tigerPalmWaste, bandOf(enemiesAt(press.t))));
	return shareOf(presses.filter((press) => press.reason === 'wasted').length, presses.length);
}

/**
 * Brews that went out under a full ten with nothing in the pull asking them to, and the brews that
 * count as having been asked.
 *
 * The companion to `brewStacks`, and the reason it needs one: an average cannot bound its own worst
 * member. The `poor` fixture is the proof and it is committed — six brews, mean exactly 9.5, `good`,
 * with one of the six spent at seven. `mixed` is the same shape one step milder: mean 9.71, `good`,
 * over a use list of 8, 10, 10, 10, 10, 10, 10. Nineteen brews at ten and one at half a bank average
 * 9.53 and grade `good` as well. Nothing beside the mean says otherwise, and `brewCapWaste` — the only
 * other graded number in the section — is about the *bank's* ceiling and is silent on all three.
 *
 * **Why the ten is the sim's number and not a round one, and why it is not a hard floor.** The
 * priority list this report grades against holds one Tigereye Brew rule, in
 * `ui/monk/windwalker/apls/default.apl.json`, group `RoRo: TEB - Actions` (the branch that runs when
 * the Rune of Re-Origination is equipped, which every pull we hold is). Written out, it presses the
 * brew when any of these holds:
 *
 *   - `TEB: Stacks == 20` — the bank is at its cap. A drain there spends a full ten by arithmetic.
 *   - `TEB: Stacks > Current` and the fight has 15s or less left (25s with a proc running) — the
 *     end-of-fight dump. **No stack floor at all**: stacks that outlive the boss were never worth
 *     anything, so whatever is banked goes out.
 *   - the GCD is ready, a Rune proc is running with **one global or less left on it**, and either no
 *     brew is up inside the opener or the bank holds more than the running brew froze — the snapshot
 *     press. **No stack floor here either**: a proc about to expire is worth more than the stacks.
 *   - the GCD is ready, no proc is running, the bank holds more than the running brew froze, and
 *     `TEB: Stacks > 15`. Sixteen banked means the drain takes ten. **So the list never spends fewer
 *     than ten outside those two exceptions** — not as an aspiration, as its own output.
 *
 * That is the whole shape of the claim: ten is a floor on the brews the list would have required ten
 * of, and the two exceptions leave the sample rather than being forgiven inside it. A hard floor at
 * ten would fault the snapshot press and the tail dump, both of which are the list's own play.
 *
 * **The two exceptions, as the analysis already measures them.** The snapshot press is
 * `ProcWindow.grade === 'last-gcd'`, which is the same comparison against the reader's own
 * `snapshotLeewayMs` that decides how late a brew counts as the proc's final global — the same slop,
 * read once. The tail is `TEB_ACTIVE_MS` of fight remaining, which is the brew's own duration and the
 * list's own `Time: TEB seconds`: with less than that left, waiting for a tenth stack spends stacks
 * that would have died in the bank.
 *
 * **Three clauses deliberately not imported, so the omissions are readable rather than discoverable.**
 *
 *   - Entry 13 of the same list — the branch for a monk with **no** Rune — grants a standalone opener
 *     allowance: `Time: Opener` (`currentTime <= 10s`) with `TEB: Stacks >= 7`. It is not taken,
 *     because the Rune branch nests its own opener clause *inside* the proc arm and so licenses no
 *     sub-ten press without a proc, and because the window closes before any pull we hold reaches its
 *     first brew: those land at 10.2s, 10.4s, 10.8s, 11.5s, 12.4s and 12.8s. Imported literally it
 *     would fire on nothing, which is the failure this project has already shipped once — a
 *     declaration that presents as a control and controls nothing.
 *   - Entry 13 also allows eight stacks while every Agility trinket proc is up
 *     (`allTrinketStatProcsActive`, `statType1: 1`, `minIcdSeconds: 40`). Not taken because a capture
 *     does not carry which trinkets were procced when, and inventing that reading would forgive by
 *     guess. This is the forgiving direction left closed, so the metric can over-fault a brew taken
 *     under a stat proc on a pull with no Rune.
 *   - `SNAPSHOT_STACK_FLOOR`'s four stacks are not a floor here. That constant says when a proc was
 *     never a chance; this says when a brew was short. A proc the bank could not pay for produces no
 *     brew at all and so no member of this sample.
 *
 * **The sample is the brews the list required ten of, and it is published.** Zero short brews out of
 * zero required ones grades `good` if only the value is read — a free pass handed to the pull whose
 * every brew the exceptions excused, and the same free zero `Metric.gradedMs` exists to refuse. So
 * the count travels with its denominator and `MIN_GRADED_SAMPLE` applies: `weave` has five brews of
 * which two were last-global presses and one was a tail dump, so two remain, and this says "cannot
 * say" there rather than crediting it with a clean sheet.
 */
function shortBrews(brew: BrewSummary, procs: ProcSummary, durationMs: number): Measured {
	const lastGlobal = new Set(
		procs.windows.flatMap((w) => (w.grade === 'last-gcd' && w.snapshotAt !== null ? [w.snapshotAt] : [])),
	);
	const required = brew.useList.filter((u) => !lastGlobal.has(u.t) && durationMs - u.t > TEB_ACTIVE_MS);
	return { value: required.filter((u) => u.consumed < TEB_DRAIN).length, sampleSize: required.length };
}

/**
 * Grades one pull.
 *
 * Section keys match the report's section ids, so a component asks for its own verdict by the name
 * it already has.
 */
export function scoreAnalysis(analysis: Analysis, view: ScoreView = null): Scorecard {
	const { procs, brew, debuff, filler, cpm, karma, potions } = analysis;
	// Bound once, so no metric below can be built outside the exemption. See `grader`.
	const metric = grader(THRESHOLDS, view);

	const gcdUtilisation = metric('gcdUtilisation', cpm.gcdSlots > 0 ? cpm.gcdUtilisationPct : null);
	// Against the procs the bank could actually have paid for, not every proc that fired. A pull opens
	// with an empty bank, so the raw count charges players for procs they were never offered.
	// `shareOf` rather than `sharePct`: the denominator is a count of procs, so the sample floor applies.
	// One or two affordable procs cannot separate a habit from a coin toss — see `MIN_GRADED_SAMPLE`.
	const snapshotRate = metric('snapshotRate', shareOf(procs.snapshotted, procs.opportunities));
	// Averaged over caught procs only, so with none caught there is nothing to average.
	const snapshotDepth = metric('snapshotDepth', procs.snapshotted > 0 ? procs.meanDepthPct : null);
	// Graded on every pull that cast it, add fight or not.
	//
	// It used to decline whenever the damage was spread, and that was the honest answer to a broken
	// measurement rather than a judgement about add fights: uptime was taken against a single inferred
	// primary target, which measured as low as 0.6% on a real kill. That 0.6% has since been traced —
	// see `primaryTargetID` — to the inference picking a Sha Puddle over Immerseus; against the boss the
	// same pull reads 93.6%. Both halves are fixed now, and `debuff.engagedUptimePct` asks whether the
	// debuff was on the enemy the player was hitting at each moment, which is a fair question on any
	// pull. Keeping the gate would leave the section silent on exactly the fights it can speak to.
	//
	// Over the clock the audit says it graded — `contactMs` when the capture has it, the narrower
	// `engagedMs` on the fixtures that predate it, which is what those were measured against. No band
	// cuts this clock (see the rule), so the guard only ever fires on a pull with presses and no contact
	// at all; it is published because a share of a clock should carry the clock it was a share of.
	const rskUptime = metric(
		'rskUptime',
		gradedOver(debuff.casts > 0 ? debuff.engagedUptimePct : null, debuff.contactMs ?? debuff.engagedMs),
	);
	const tigerPalmWaste = metric('tigerPalmWaste', tigerPalmShare(filler, analysis.targets));
	const brewStacks = metric('brewStacks', brew.uses > 0 ? brew.avgConsumed : null);
	// Graded on the stacks that were avoidable, not on every stack the cap refused. A stack lost while
	// holding a brew for a Re-Origination proc, on a proc where holding was the cheaper of the two
	// moves, was correctly spent — charging for it while separately faulting the early brew that would
	// have prevented it left a bank near its cap with no move the report called right. All of them are
	// still reported; only the avoidable ones are graded. `?? 0` because the committed fixtures predate
	// the field and carry `undefined`, which must read as "nothing forgiven" rather than as NaN.
	const avoidableCapWaste = Math.max(0, brew.wastedAtCap - (brew.wastedProtecting ?? 0));
	const brewCapWaste = metric('brewCapWaste', brew.uses > 0 || brew.maxStacks > 0 ? avoidableCapWaste : null);
	// Beside the mean rather than folded into it, and the argument is `karma`'s two tiles one section
	// down: an average that clears its line and one brew that did not are separate faults, and the
	// weaker of the two should carry the section rather than be averaged away by the other. Folding a
	// floor into `brewStacks` would also paint the headline tile — which prints `brew.avgConsumed` — a
	// colour no number on the page accounts for, which is the thing `BrewBankTimeline` already ruled on
	// for the cap count. See `shortBrews`.
	const brewShortUses = metric('brewShortUses', shortBrews(brew, procs, analysis.durationMs));

	// A press that redirected nothing, over the presses taken — never over the presses the cooldown
	// allowed. Holding Touch of Karma through a phase with nothing incoming is the correct play, and
	// billing it as a miss would be the fabricated fault this section exists to refuse.
	const karmaEmpty = metric(
		'karmaEmpty',
		sharePct(karma.uses.filter((use) => use.reflected === 0).length, karma.casts),
	);
	// Unmeasurable in two different ways, and both have to survive: no presses at all, and presses
	// whose ceiling the pull never demonstrated. `capPerUse` is null in the second case, which is the
	// "cannot say" the section prints rather than a share of a pool nobody measured. `absorbed` is
	// absent on fixtures captured before it existed, and reading it as zero would score those pulls as
	// having returned nothing — so an absent absorb is an unmeasurable metric, not a failing one.
	const karmaCeiling = karma.capPerUse === null || karma.casts === 0 ? null : karma.capPerUse * karma.casts;
	const karmaCapShare = metric(
		'karmaCapShare',
		karmaCeiling === null || karma.absorbed === undefined ? null : sharePct(karma.absorbed, karmaCeiling),
	);

	/**
	 * Potions drunk out of the two the pull allowed.
	 *
	 * Two separate reasons to answer null, and both have to survive as "cannot say" rather than as
	 * zero. `potions` is absent on every committed fixture captured before the audit existed — reading
	 * that as none drunk would score six real pulls as having brought nothing — and `measurable` is
	 * false on a pull too short to have offered both slots, which is the audit's own refusal to answer.
	 */
	const potionsUsed = metric(
		'potionsUsed',
		potions?.measurable === true ? potions.used : null,
		// Which slot to point at, when exactly one went unfilled and the number cannot say which. A pull
		// that drank neither needs no variant — the base wording covers both — and one that drank two
		// never reaches a card at all.
		potions?.measurable === true && potions.used === 1 ? (potions.prePull === null ? 'prepull' : 'combat') : undefined,
	);

	const all = [
		gcdUtilisation,
		snapshotRate,
		snapshotDepth,
		rskUptime,
		tigerPalmWaste,
		brewStacks,
		brewCapWaste,
		brewShortUses,
		karmaEmpty,
		karmaCapShare,
		potionsUsed,
	];

	// `overallOf` rather than `overall`: the denominator travels with the verdict, so a headline drawn
	// over a pull most of whose weight was exempted says so instead of reading as a whole-pull claim.
	const { grade, judged } = overallOf(all, weightsFor(view));

	return {
		overall: grade,
		judged,
		sections: {
			// Depth is deliberately secondary — see the note on SectionScore.
			snapshots: section([snapshotRate], [snapshotDepth]),
			// All three primary: the mean, the bank's ceiling and the worst brew are three faults and not
			// three readings of one, so the weakest carries the section. Same call as `karma` below.
			brew: section([brewStacks, brewCapWaste, brewShortUses]),
			casts: section([gcdUtilisation]),
			debuff: section([rskUptime]),
			tigerPalm: section([tigerPalmWaste]),
			// Both primary: an empty press and a press that half-filled are separate faults, and the
			// weaker of the two should carry the section rather than be averaged away by the other.
			karma: section([karmaEmpty, karmaCapShare]),
			// A section with one metric and no section of its own on the page. It is here because the
			// scorecard is the only route into the summary — `Takeaways` walks these sections — and a
			// potion nobody drank is worth a card. The report deliberately grows no section to argue it:
			// the count is a headline tile and its evidence is a bar on the timeline, which is where the
			// card points.
			potions: section([potionsUsed]),
		},
	};
}

export { GRADE_ORDER };

// Where the lines sit, and why each one sits there.
//
// These are the only numbers in the app that turn a measurement into a judgement, so each carries
// the reasoning that put it where it is. A threshold nobody can argue with is a threshold nobody can
// correct — if one of these is wrong, the comment is what makes it possible to see that.
//
// All of them were checked against three real pulls spanning strong, mediocre and poor play, so
// none of them is a guess that happens to grade every pull the same colour.

export const THRESHOLDS = {
	/**
	 * Share of available globals actually used.
	 *
	 * Windwalker is energy-gated with real downtime, so 100% is not the target and never happens.
	 *
	 * Calibrated against 25 real kills rather than guessed: they run 65.5% to 92.0%, median 82.6%. The
	 * old 80/65 split put a *third* of that range below the bottom threshold, so no pull in the sample
	 * could score `bad` at all — a band nothing reaches is a weight that only ever flatters. These cut
	 * roughly at the sample's upper quartile and lower quartile, so the grade separates real pulls.
	 *
	 * What is measured beneath them has since narrowed: a global given to a Tiger Palm that bought
	 * nothing no longer counts as used, because crediting it made the report contradict itself — see
	 * `CpmSummary.gcdUtilisationPct`. The bands are unchanged and deliberately not re-cut, because the
	 * 25-kill sample that produced them predates the change and re-deriving quartiles from three
	 * fixtures would be a worse number than an honest old one. What the change does to those three is
	 * worth stating rather than discovering: strong is untouched at 83.6% with no wasted presses at
	 * all, mixed falls 87.4% → 79.9%, poor falls 90.2% → 78.3%. Both of the latter move from `good` to
	 * `ok`, which is the correction — a pull cannot be near the ceiling on globals while throwing away
	 * one press in eight.
	 */
	gcdUtilisation: { good: 85, ok: 75, higherIsBetter: true },

	/**
	 * Share of Re-Origination procs converted into a Tigereye Brew.
	 *
	 * The spec's whole payoff. A brew during a proc freezes the converted stats for the brew's full
	 * 15 seconds, so a missed proc is not a small loss. Catching most of them is the skill being
	 * measured; catching under half means the pairing is not being played at all.
	 *
	 * Measured against the procs the bank could have paid for. Procs that arrived with too few stacks
	 * to be worth a brew are not chances and never count against this.
	 */
	snapshotRate: { good: 70, ok: 45, higherIsBetter: true },

	/**
	 * How deep into the proc the brew landed, averaged over the procs that *were* caught.
	 *
	 * Descriptive only — its weight is zero, and the bands below exist to pick a sentence rather than
	 * to pass a judgement. The note here used to warn that "a player who catches two procs out of nine
	 * can post a better depth than one who catches twelve", and then graded it at full weight anyway.
	 * The three fixtures say the warning was not hypothetical:
	 *
	 *   strong  12 of 14 caught, mean depth 61.2%  →  bad
	 *   mixed    4 of 6  caught, mean depth 59.0%  →  bad
	 *   poor     2 of 8  caught, mean depth 86.1%  →  good
	 *
	 * The best snapshotter in the set graded worst on it and the worst graded best, because the
	 * average only ever sees the procs someone bothered to catch. A number conditional on another
	 * number cannot stand on its own, and no threshold fixes that — the inversion is in the shape of
	 * the average, not in where the lines sit. So the bands stay, the grade stops counting, and
	 * `snapshotRate` carries the section alone.
	 *
	 * The bands themselves are the recalibrated ones: the 25-kill sample runs 51.6% to 96.2%, so
	 * nothing could reach the old 45% floor either.
	 */
	snapshotDepth: { good: 80, ok: 65, higherIsBetter: true },

	/**
	 * Rising Sun Kick's debuff uptime against engaged time.
	 *
	 * A 15-second debuff on an 8-second cooldown, so the ceiling really is ~100% and the bar is
	 * correspondingly high. Measured against engaged time rather than pull time, so intermissions
	 * and target swaps do not read as mistakes.
	 *
	 * **The number underneath these bands has changed, and the bands have not.** It used to be the
	 * debuff on one inferred primary target, graded only on pulls concentrated on that target; it is
	 * now the debuff on whichever enemy the player was hitting at each moment, graded on every pull.
	 * That is a different population, so what it does to the same 25 real kills is worth stating rather
	 * than discovering:
	 *
	 *     graded before   13 of 25 pulls      good 9   ok 1   bad 3
	 *     graded now      25 of 25            good 5   ok 4   bad 16
	 *     spread          min 29.3  q25 71.3  median 84.3  q75 93.3  max 99.4
	 *
	 * The nine pulls the counts read as single-target still separate against these lines much as they
	 * always did (median 93.2, four of nine at or above 95). The sixteen the counts read as
	 * multi-target sit about fourteen points lower, and that is what puts two thirds of the sample in
	 * `bad`. How much of that gap is a fault is genuinely unresolved: on the Dark Shaman a 15s debuff
	 * and an 8s cooldown cover two bosses comfortably, so 59% there is a real miss, while on Spoils of
	 * Pandaria the adds die inside the cooldown and no amount of play reaches 95%. This sample cannot
	 * tell those apart, and a band cut from it would bake the mixture in.
	 *
	 * So they are deliberately left alone. Re-cutting them here would be tuning a new measurement to
	 * the sample that produced the old one, and doing it silently is how a threshold stops being
	 * arguable.
	 *
	 * **The mode-aware fix this note used to propose has since been measured, and the sample refuses
	 * it.** 92 Windwalker pulls across three anonymous reports, 81 of them long enough to grade — 60
	 * seconds of contact and eight kicks or more — read:
	 *
	 *     detected single   n=41   min 59.2  q25 88.5  median 94.0  q75 96.6  max 100.0
	 *     detected multi    n=40   min 56.2  q25 70.4  median 87.0  q75 93.3  max  98.8
	 *
	 * Seven points apart at the median, which looks like the band this note went looking for and is
	 * not one. The gap is composition rather than mode. Which *encounter* a pull was explains 80.0% of
	 * the variance in uptime across the fourteen encounters in it; the detected mode explains 12.6%,
	 * and adding mode on top of encounter moves 80.0% to 80.6%. In the five encounters that produced both
	 * readings the single pulls beat the multi ones by 1.4 points on average and two of the five run
	 * the other way; centre each encounter on its own mean and the two residual medians are 1.0 and
	 * 0.9. So `multi` is not a second mode — it is the same distribution with a handful of specific
	 * fights hanging off the bottom of it. Spoils of Pandaria medians 64.5, Galakras 69.3 and Fallen
	 * Protectors 79.0, while Kor'kron Dark Shaman (90.8), Siegecrafter Blackfuse (90.6) and General
	 * Nazgrim (95.6) are read multi too and sit exactly where the single-target pulls sit. 28 of the
	 * 40 multi pulls are at or above 80%, spread over nine encounters.
	 *
	 * And the worst-grading fight in the sample is read `single`: Immerseus, three pulls at
	 * 56.2/59.2/59.7, a contact-weighted mean of 1.1 enemies. Its puddles die inside the cooldown one
	 * at a time — the fault this note blamed on add fights — and no multi-target band would reach it.
	 *
	 * A band cut from the multi group's own quartiles would be 93.3/70.4. It grades that group good
	 * 10 / ok 21 / bad 9: a floor 31 of the 40 clear, which is exactly the `gcdUtilisation` failure
	 * three entries up — a line nothing reaches only ever flatters. And it still could not tell an
	 * 81.4% General Nazgrim, the *worst* pull on an encounter whose median is 95.6, from an 80.6%
	 * Galakras, the *best* pull on one whose median is 69.3. A point apart, opposite ends of their own
	 * fights, and identical under any band keyed on the mode. So the bands stay at 95/88 for every
	 * reading, and the split they would have keyed on is recorded here as measured and rejected rather
	 * than left standing as an open invitation.
	 */
	rskUptime: { good: 95, ok: 88, higherIsBetter: true },

	/**
	 * Share of Tiger Palm presses that bought nothing.
	 *
	 * Tiger Palm earns its global two ways: spending a free Combo Breaker proc, or refreshing Tiger
	 * Power before it drops. Anything else clips a healthy buff and takes a global that Jab or
	 * Blackout Kick wanted. A handful is noise; a third of them is a habit.
	 *
	 * **Band 1, because this is the one Windwalker rule only one target count's list contains.** Tiger
	 * Palm is the single-target filler; from two enemies up the list wants those globals on Rushing Jade
	 * Wind and Spinning Crane Kick, and the button is pressed to hold Tiger Power rather than as a
	 * filler at all. Grading a press made into a pack against a rule about the single-target filler is
	 * the reported bug in this spec's own shape.
	 *
	 * This is the *only* threshold in this table that gets a band, and the test the others fail is one
	 * sentence: the resource or the opportunity has to exist differently at different target counts.
	 * Snapshotting a proc, filling your globals, banking and spending brew stacks and drinking a potion
	 * are the same job however many enemies are in front of you, so they stay graded everywhere. Rising
	 * Sun Kick uptime is the near miss and is left alone on measurement rather than on argument — a band
	 * cut from the multi group's own quartiles over 92 pulls could not separate an 81.4% Nazgrim from an
	 * 80.6% Galakras; the derivation is above `rskUptime`.
	 *
	 * A band declaration alone would have changed nothing here, which is the failure this project has
	 * already shipped once: every committed fixture visits band 1, so the intersection is never empty
	 * under the detected reading and nothing would be exempted. `tigerPalmShare` is the other half — the
	 * presses made outside band 1 leave the sample — and it is what turns the declaration into a
	 * control. With the sample honest the weight no longer needs its whole-pull discount; see `WEIGHTS`.
	 */
	tigerPalmWaste: { good: 10, ok: 30, higherIsBetter: false, bands: [1] },

	/**
	 * Average stacks consumed per brew, out of the ten a full brew spends.
	 *
	 * This one grades tightly on purpose: brewing under a full ten is throwing away the difference,
	 * and even weak pulls tend to land near the cap, so the interesting range is narrow.
	 */
	brewStacks: { good: 9.5, ok: 8.5, higherIsBetter: true },

	/**
	 * Stacks lost to sitting at the twenty-stack cap.
	 *
	 * Every stack gained at cap is a stack that never existed. Zero is genuinely achievable — it
	 * only asks that a brew goes out before the bank fills — so anything above zero is a real miss
	 * rather than a rounding error.
	 */
	brewCapWaste: { good: 0, ok: 5, higherIsBetter: false },

	/**
	 * Brews that spent under ten with no proc expiring and fight left to spend the stacks in.
	 *
	 * **Zero is the list's own output rather than a target set here.** Outside its two exceptions the
	 * priority list will not press the brew below sixteen banked stacks, and a drain at sixteen takes
	 * ten — so a pull that never brews short is a pull that played the rule, not an exceptional one.
	 * The derivation, the two exceptions and the three clauses deliberately not imported are all on
	 * `shortBrews`; this entry is only where the line sits.
	 *
	 * `ok` at one, which is the shape this repository already uses for a count of omissions and for the
	 * reason it already wrote down beside `lightningShieldFellOff` and `shamanisticRageMissed`: zero is
	 * achievable on any pull, one is a lapse and two is a habit. It is not a quantile of a sample and
	 * does not pretend to be — a count of two to three across six pulls has no quantiles — but it is the
	 * one band shape in the app whose middle is a *reason* rather than a number, which is what a count
	 * of faults can honestly support. Lower is better.
	 *
	 * **A count, not the worst brew's own stack figure, and not a share.** The worst brew (`min` over the
	 * sample) is the shape the report of this defect asked for and it has no second line available: the
	 * list holds no partial tolerance anywhere — sixteen banked or a named exception — so `ok` would have
	 * to be a number invented here, and a two-band metric collapses to pass/fail on a mechanic where the
	 * middle is the normal case. A share of the sample flattens instead of separating: over the six
	 * committed pulls it reads 0%, 0%, 14.3%, 16.7%, 21.4% and 22.2%, four of them inside eight points of
	 * each other. The count separates all three ways; the figures are on the metric.
	 *
	 * **What it does not claim.** It counts brews, not damage. A brew at nine and a brew at five are one
	 * fault each here, and the difference between them is not graded anywhere — the list does not price
	 * it and neither does this. `brew.useList` carries every consumed figure and the bank chart draws
	 * them, so the reader can see which brew and how short; what this number says is how many times it
	 * happened with nothing asking for it.
	 *
	 * **No band.** Banking and spending brew stacks is the same job at every target count, which is the
	 * sentence `tigerPalmWaste` uses to say why it is the only entry in this table that carries one.
	 */
	brewShortUses: { good: 0, ok: 1, higherIsBetter: false },

	/**
	 * Share of Touch of Karma presses that redirected nothing at all.
	 *
	 * The one fault this section could always support, and the reason it exists: the redirect returns
	 * what was hitting the player, so a press into a quiet stretch is a global and a ninety-second
	 * cooldown spent on nothing. Zero is the target because it asks only that the button goes out
	 * while damage is coming in, not that it goes out on cooldown — how many charges a fight offers is
	 * the encounter's business and is deliberately not graded anywhere.
	 *
	 * Coarse by construction: a pull carries two or three presses, so the measurable values are 0, a
	 * third, a half. `ok` sits at a quarter, which is one empty press in four or more — a pull that
	 * pressed it six times and mistimed one is not the same fault as a pull that mistimed one of two.
	 */
	karmaEmpty: { good: 0, ok: 25, higherIsBetter: false },

	/**
	 * How full the presses that *were* taken got, as a share of what they could have returned.
	 *
	 * Measured against a health pool the pull itself demonstrated — see `karmaCap` in `spec/windwalker`
	 * — so it is unmeasurable, and says so, on a pull where no use drained one. That is not a
	 * formality: it is the whole reason this section carried no ceiling for so long.
	 *
	 * The bands are coarse on purpose and calibrated on three pulls rather than twenty-five, which is
	 * thin and is worth saying out loud. They read 50.0%, 64.4% and 95.8% — a press that drained its
	 * pool against one that returned 203,636 of a possible 629,585. `good` sits above the middle of
	 * that spread and `ok` below it, which separates the three; nothing finer is supportable, and a
	 * band claiming to tell 72% from 78% apart would be inventing precision the sample does not have.
	 */
	karmaCapShare: { good: 75, ok: 40, higherIsBetter: true },

	/**
	 * Potions drunk, out of the two a pull allows.
	 *
	 * **The one threshold in this file that is not cut from a sample, and the only one that does not
	 * need to be.** Every band above is an argument about where real pulls sit; this is the game's own
	 * ceiling, so the bands are the arithmetic and six fixtures never enter into it. Two is both, one is
	 * half, none is none.
	 *
	 * The ceiling is the simulator's: `sim/core/consumes.go:169-198` registers a pre-pull potion and a
	 * combat potion as two separately configured items carrying `SpellFlagPrepullPotion` and
	 * `SpellFlagCombatPotion`, both on one 60-minute shared timer, with the pre-pull press overriding
	 * that lock down to the item's own minute so exactly one more fits. See `POTION_SLOTS` in
	 * `spec/windwalker` for the code and the log measurement that agrees with it.
	 *
	 * `bad` here means "drank neither", never "the pull could not say". A fight shorter than the
	 * potion's own duration hides a pre-pull one entirely, and one that ended inside the potion
	 * cooldown never offered the second slot — both arrive as an unmeasurable metric rather than as a
	 * zero, which is the whole reason `Metric.unmeasurable` exists.
	 *
	 * Nothing else about the potions is graded. When it was drunk relative to the pull is measured and
	 * printed — a potion three seconds early spends three of its twenty-five outside the fight — and no
	 * band is cut for it, because the six fixtures spread over a second and a half and a line drawn
	 * across that would be invented precision.
	 */
	potionsUsed: { good: 2, ok: 1, higherIsBetter: true },
} as const satisfies Record<string, MetricRule>;

export type MetricKey = keyof typeof THRESHOLDS;

/**
 * How much each metric moves the overall verdict.
 *
 * Snapshotting and globals carry the most because they are the two things a Windwalker most
 * controls and that most change the damage. Brew-stack economy is weighted lightly: it barely
 * separates good pulls from bad ones in practice, so letting it swing the headline would make the
 * headline noisy.
 */
export const WEIGHTS: Record<MetricKey, number> = {
	// The two things this spec is actually about, and the two that separate the sample most sharply:
	// catch rate spreads 25–100% and Tiger Palm waste is frankly bimodal — players either have the
	// habit or they do not.
	//
	// **Tiger Palm's three is now its weight on every reading**, where it used to fall to one whenever
	// the pull was read as multi-target. The discount was the right answer to a real problem stated the
	// only way it could be stated at the time: at full weight the metric "hands every add fight three
	// points of credit for a habit it never had the chance to show". But it charged the whole pull for
	// where part of it was fought, and it took the credit away from the single-target stretches where
	// the habit genuinely was on show — the mixed pull is detected `single`, wastes 17 of the 23 presses
	// it made at one enemy, and there is nothing about that worth discounting. `bands: [1]` plus the
	// sample narrowing says the same thing precisely instead: the presses made into a pack leave the
	// measurement, and a pull with too few in-band presses left to judge is not judged on it at all.
	// Three rather than higher because three is what the sample argued for and nothing here is new
	// evidence about how much the habit matters — only about which presses it was ever a claim over.
	snapshotRate: 4,
	tigerPalmWaste: 3,
	// Table stakes. Both are close to universally passed once the cast data is right, so they were
	// carrying five of thirteen weight while telling the reader almost nothing; a pull could post
	// three red sections and still come out `ok` on the strength of them.
	gcdUtilisation: 2,
	rskUptime: 2,
	// Measured, shown, and deliberately not counted. Zero rather than deletion so the metric keeps
	// existing for the copy to read a band off, and so the reason it does not count lives beside every
	// weight that does — see the note above `snapshotDepth` for the inversion that put it here.
	snapshotDepth: 0,
	brewStacks: 1,
	brewCapWaste: 1,
	// One, like the two beside it, and the light weight is the whole section's and not a discount on
	// this metric. Adding a third weight-1 metric moves every pull's `judged` denominator from 14 to 15
	// and dilutes each of the others by a fifteenth; that is the cost of the section saying a thing it
	// could not say before, and it is stated rather than absorbed. What it is *not* is a claim that a
	// short brew matters more than the mean it sits beside — the section's `worst` fold is what makes it
	// bite, and the weight only says how much the headline should care.
	brewShortUses: 1,
	// Real damage and genuinely free — nobody misses a potion for want of skill — but it is a thing you
	// bring rather than a thing you play, and this report is about the four minutes. At the same weight
	// as the brew economy it can put a card in the summary of a pull that skipped both potions without
	// ever outranking the two habits that actually separate Windwalkers.
	potionsUsed: 1,
	// Graded in its own section and deliberately not counted in the headline, for a different reason
	// than `snapshotDepth` above: these two are sound, but what they measure is not the player's alone.
	// The redirect returns what the fight was doing to them, so how much a press could ever be worth is
	// set by the encounter — a phase with nothing incoming caps a perfect press at nothing. Letting
	// that swing the verdict would grade the pull the player was handed. Zero rather than deletion, so
	// the section still reads a band off them and the reason lives beside the weights that do count.
	karmaEmpty: 0,
	karmaCapShare: 0,
};

/**
 * What changes when the pull is read as multi-target.
 *
 * One metric moves, and because the *question* changes rather than because add fights deserve an
 * easier mark. Everything absent from this map is mode-independent and stays where it is: snapshotting
 * a proc and filling your globals are the same job however many enemies are in front of you.
 *
 * **`tigerPalmWaste` used to be the other entry and is no longer here.** It carries a band now, which
 * is a strictly more honest statement of the same finding — see the note beside its weight and the one
 * above its threshold. A whole-pull discount and a band declaration doing the same job would be two
 * mechanisms disagreeing about one rule, and the discount is the one that cannot tell a press made at
 * one enemy from a press made into six.
 *
 * A whole-pull weight is still the right shape for what is left, which is why this map survives rather
 * than every entry becoming a band. `bands` answers "was this rule in the list at this count", and the
 * priority list contains Rising Sun Kick at every count — the claim below is about how much a
 * one-target *number* should matter when the job is spreading, which is a claim about the pull and not
 * about the rungs.
 *
 * **`rskUptime` drops from 2 to 1, and its thresholds are deliberately left alone.** Uptime on one
 * target is a smaller part of the story when the player is correctly spreading damage, so it should
 * count for less. Re-banding it is the tempting second move and is still not taken — no longer for
 * want of a sample. The sweep this note asked for has been run, over 92 pulls in three anonymous
 * reports, and it says the mode is not the axis; the derivation is above `rskUptime`. The two
 * fixtures that made the case for a lower band turn out to have been drawn from opposite ends of
 * their own encounters: 80.6% is the *best* of four Galakras pulls (63.2/68.3/70.4/80.6) and 87.0% is
 * below the median of four Dark Shaman ones (61.7/87.0/94.5/95.3), so the pair bracketed a line that
 * neither fight's own distribution supports. The weight stays at 1 regardless — it is a claim about
 * how much a one-target number should matter when the job is spreading, not a claim about where add
 * fights land, and nothing in the sweep touches it.
 */
export const MULTI_TARGET_WEIGHTS: Partial<Record<MetricKey, number>> = {
	rskUptime: 1,
};

/**
 * The weights for a reading: the base set, unless the pull is being read as multi-target.
 *
 * Takes the whole `ScoreView` and reads the mode off it rather than being handed a mode, so the
 * weights and the grades come off one object and cannot be arguing about different pulls. `viewMode`
 * is the half of the view a band set cannot supply and the half this function needs — see
 * `BandView.mode` for why both readings travel together.
 */
export function weightsFor(view: ScoreView): Record<MetricKey, number> {
	return viewMode(view) === 'multi' ? { ...WEIGHTS, ...MULTI_TARGET_WEIGHTS } : WEIGHTS;
}
