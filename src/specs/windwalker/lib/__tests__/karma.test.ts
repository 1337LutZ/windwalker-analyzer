import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { MIN_GRADED_SAMPLE } from '~/lib/score';
import { scoreAnalysis, THRESHOLDS } from '~/specs/windwalker/lib/score';
import { WEIGHTS } from '~/specs/windwalker/lib/score';
import type { Analysis } from '~/lib/types';

const fixture = (name: string): Analysis =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8'));

/**
 * Touch of Karma redirects damage on a one-second tick, and the ticks run from about 2.8s after the
 * press through to 11.8s — past the ten seconds the tooltip advertises. A flat ten-second window
 * dropped the last two ticks and under-reported a use by a fifth, which also invented a wasted press
 * on a pull that had none.
 */
/**
 * A pull whose log reported no stamina, so no pool can be computed and none can be stated.
 *
 * The presses and what they returned are untouched — only the pool goes, which is the shape of a
 * legacy Mists report: those carry no `combatantinfo` at all, so there is no stamina to convert.
 * Built rather than borrowed, because every committed capture states a pool now and a fixture
 * reaching this branch would be pinning how old the capture is rather than what the engine does.
 */
const unmeasured = (name: string): Analysis => {
	const captured = fixture(name);
	return {
		...captured,
		karma: {
			...captured.karma,
			capPerUse: null,
			uses: captured.karma.uses.map((use) => ({ ...use, cap: null, exhausted: false, capPct: null })),
		},
	};
};

describe('Touch of Karma', () => {
	for (const name of ['strong', 'mixed', 'poor']) {
		it(`attributes every redirect tick on the ${name} pull`, () => {
			const analysis = fixture(name);
			const row = analysis.damage.abilities.find((a) => a.id === 124280);
			const attributed = analysis.karma.uses.reduce((sum, use) => sum + use.reflected, 0);

			expect(row, 'no redirect damage in this fixture').toBeDefined();
			// Every point of redirect damage belongs to exactly one press: none lost to a short window,
			// none counted twice by two overlapping ones.
			expect(attributed).toBe(row?.total);
			expect(analysis.karma.reflected).toBe(row?.total);
			expect(analysis.karma.uses).toHaveLength(analysis.karma.casts);
		});
	}

	it('counts the uses the cooldown allowed, not just the ones taken', () => {
		const strong = fixture('strong');
		// A 535s pull on a 90s cooldown: the opener plus five recharges.
		expect(strong.karma.available).toBe(6);
		expect(strong.karma.casts).toBe(2);
	});

	/** The judgement this section can actually support: a press into a quiet stretch returns nothing. */
	it('shows a press that returned nothing as exactly that', () => {
		const empty = fixture('strong').karma.uses.filter((use) => use.reflected === 0);
		expect(empty).toHaveLength(1);
		expect(empty[0]?.hits).toBe(0);
	});

	/**
	 * The ceiling is measured from a use that drained its pool, and claimed nowhere else.
	 *
	 * These fixtures are captured `analyse()` output from before the absorb was measured, so they
	 * carry no `absorbed` and no `exhausted` and read here as the pull that could not answer it —
	 * which is exactly the case worth pinning. **They need re-capturing.** The live numbers, and the
	 * before-and-after on the same three pulls, are in `~/specs/windwalker/__fixtures__/karmacap.test.ts`.
	 */
	it('claims no ceiling on a pull where no use drained its pool', () => {
		// Built rather than borrowed. Every reference pull now drains a pool on at least one use, which
		// re-capturing revealed — so a test that reached this branch through a fixture was pinning how
		// old the capture was, not what the engine does.
		const karma = unmeasured('poor').karma;
		expect(karma.capPerUse).toBeNull();
		expect(karma.uses.every((use) => use.capPct === null)).toBe(true);
	});

	/**
	 * "Cannot say" has to reach the scorecard as *unmeasurable*, not as zero.
	 *
	 * A pull that never demonstrated its ceiling has not failed to fill it, and a metric defaulting to
	 * 0% would grade every such pull as the worst possible use of the cooldown — the fabricated fault
	 * this section exists to refuse. The presses are gradable either way, so the section still speaks;
	 * only the share of the ceiling goes quiet.
	 */
	it('grades what it can and stays silent on what it cannot', () => {
		const karma = scoreAnalysis(unmeasured('poor')).sections.karma;
		const capShare = karma?.metrics.find((m) => m.key === 'karmaCapShare');
		const empty = karma?.metrics.find((m) => m.key === 'karmaEmpty');

		expect(capShare?.unmeasurable).toBe(true);
		expect(empty?.unmeasurable).toBe(false);
		expect(karma?.unmeasurable).toBe(false);
	});

	/**
	 * A press that returned nothing is a fault; a charge held through a quiet phase is not.
	 *
	 * So the empty share is taken over the presses *taken*, never over the presses the cooldown
	 * allowed — `poor` took three of a possible three and `waves` one of a possible five, and neither
	 * denominator is the cooldown's.
	 */
	it('faults the presses taken, not the charges left on the cooldown', () => {
		const empty = (analysis: Analysis) =>
			scoreAnalysis(analysis).sections.karma?.metrics.find((m) => m.key === 'karmaEmpty');

		const poor = fixture('poor');
		expect(poor.karma.available).toBe(3);
		expect(empty(poor)?.sampleSize).toBe(3);
		expect(empty(poor)?.value).toBe(0);
		expect(empty(poor)?.grade).toBe('good');

		// The charges left on the cooldown are not in the denominator, which is what this pull shows: one
		// press of a possible five, and the sample the metric publishes is the one press.
		const waves = fixture('waves');
		expect(waves.karma.available).toBe(5);
		expect(empty(waves)?.sampleSize).toBe(1);
	});

	/**
	 * And a share of the presses taken is only worth grading over three of them.
	 *
	 * `karmaEmpty` was built with `sharePct`, which declines only at a denominator of nought, so it was
	 * the one share in the spec with no sample floor under it. At two presses the reachable values are
	 * nought, fifty and a hundred, and `strong` sat on the fifty: two presses, one of them into a quiet
	 * stretch, graded `bad` and printed as a habit. A ninety-second cooldown makes that the ordinary
	 * shape rather than the exceptional one — four of the six committed pulls press it once or twice.
	 *
	 * The press count is untouched by this and stays on the page; what is withdrawn is the share.
	 */
	it('declines to read a habit off one or two presses', () => {
		const empty = (name: string) =>
			scoreAnalysis(fixture(name)).sections.karma?.metrics.find((m) => m.key === 'karmaEmpty');

		expect(MIN_GRADED_SAMPLE).toBe(3);
		for (const name of ['strong', 'cleave', 'waves', 'weave']) {
			const karma = fixture(name).karma;
			expect(karma.casts, `${name} clears the floor, so it does not belong here`).toBeLessThan(MIN_GRADED_SAMPLE);
			expect(empty(name)?.unmeasurable, name).toBe(true);
		}
		// `strong` is the one that was reading `bad`: one empty press of the two it took.
		expect(fixture('strong').karma.uses.filter((use) => use.reflected === 0)).toHaveLength(1);
	});

	/**
	 * And the ceiling that replaced it, which owes the numerator nothing.
	 *
	 * `use.cap` comes from the character's stamina — see `karmaCap` in `../index` — so a press that
	 * redirected nothing reads nought, which is the exact value the old arithmetic could not produce at
	 * any press count. That is the whole of the argument for dropping this metric's sample floor: the
	 * floor existed because the bad end of the scale was unreachable, and it is reachable now.
	 *
	 * Built rather than borrowed, on the same terms as `unmeasured` above: the committed captures predate
	 * the field, so a fixture reaching this branch would be pinning how old the capture is.
	 */
	it('reaches the bottom of the scale at one press', () => {
		const POOL = 742_145;
		const withPool = (name: string, absorbed: number[]): Analysis => {
			const captured = fixture(name);
			return {
				...captured,
				karma: {
					...captured.karma,
					casts: absorbed.length,
					absorbed: absorbed.reduce((sum, a) => sum + a, 0),
					capPerUse: POOL,
					uses: absorbed.map((a, i) => ({
						...(captured.karma.uses[0] as (typeof captured.karma.uses)[number]),
						t: i * 90_000,
						absorbed: a,
						cap: POOL,
						capPct: (a / POOL) * 100,
					})),
				},
			};
		};
		const capShare = (analysis: Analysis) =>
			scoreAnalysis(analysis).sections.karma?.metrics.find((m) => m.key === 'karmaCapShare');

		// One press that redirected nothing: nought, graded, at a sample the old floor refused outright.
		const wasted = capShare(withPool('weave', [0]));
		expect(wasted?.unmeasurable).toBe(false);
		expect(wasted?.value).toBe(0);
		expect(wasted?.grade).toBe('bad');

		// And one press that drained its pool still reads a hundred — the top of the scale is where it was.
		const drained = capShare(withPool('weave', [POOL]));
		expect(drained?.value).toBe(100);
		expect(drained?.grade).toBe('good');

		// The steps are the ones this metric always had; only the ceiling under them moved.
		expect(THRESHOLDS.karmaCapShare.good).toBe(75);
		expect(THRESHOLDS.karmaCapShare.ok).toBe(40);
	});

	/**
	 * And the share is stated on every committed pull now, which is the change re-capturing published.
	 *
	 * All six used to go quiet here: the ceiling is summed from each use's own pool, and the captures
	 * predated that field. They carry it, so the section's second metric speaks on every one of them —
	 * including the two that never drained a pool and therefore had no ceiling at all under the old
	 * measurement.
	 */
	it('states the share on every committed pull', () => {
		const capShare = (name: string) =>
			scoreAnalysis(fixture(name)).sections.karma?.metrics.find((m) => m.key === 'karmaCapShare');

		for (const name of ['strong', 'mixed', 'poor', 'waves', 'weave', 'cleave']) {
			expect(
				fixture(name).karma.uses.every((use) => typeof use.cap === 'number'),
				name,
			).toBe(true);
			expect(capShare(name)?.unmeasurable, name).toBe(false);
			expect(capShare(name)?.value ?? -1, name).toBeGreaterThanOrEqual(0);
			expect(capShare(name)?.value ?? 101, name).toBeLessThanOrEqual(100);
		}
	});

	/**
	 * Two of the three are measured, shown and deliberately not counted: the encounter decides what a
	 * press can be worth, so letting either swing the headline would grade the pull the player was
	 * handed. The third is the one thing here the encounter cannot excuse, and it is counted.
	 *
	 * Pinned so that moving any of the three is a decision rather than a side effect.
	 */
	it('counts only the rule the encounter cannot excuse', () => {
		expect(WEIGHTS.karmaEmpty).toBe(0);
		expect(WEIGHTS.karmaCapShare).toBe(0);
		expect(WEIGHTS.karmaInBrew).toBe(0.5);
	});

	/**
	 * And the weight is only ever spent on a pull that pressed the button.
	 *
	 * A monk who held a ninety-second defensive through a fight with nothing incoming made no decision
	 * about where to put it, so there is nothing to grade: `metricOf` refuses the absent value and
	 * `overallOf` leaves it out of the mean. The point stays in `judged.total`, which is the same
	 * accounting `weaveRate` gets: the line under the headline says a point was offered and not
	 * answered rather than quietly shrinking the denominator.
	 */
	it('spends its weight only on a pull that pressed the button', () => {
		const never = scoreAnalysis(pressedInBrew('weave', []));
		const pressed = scoreAnalysis(pressedInBrew('weave', [true, true]));
		const faultless = scoreAnalysis(pressedInBrew('weave', [false, false]));

		// The point leaves the numerator on a pull with no presses and stays in the denominator, which
		// is the whole of what "only if they used it" costs a reader: one line saying so.
		expect(never.judged?.measured).toBe(pressed.judged!.measured - WEIGHTS.karmaInBrew);
		expect(never.judged?.total).toBe(pressed.judged!.total);
		expect(never.judged?.total).toBe(faultless.judged!.total);
		// Having pressed it, the point is read either way and the grade on it is what moves.
		expect(pressed.judged?.measured).toBe(faultless.judged!.measured);
		expect(inBrew(pressedInBrew('weave', [true, true]))?.grade).toBe('bad');
		expect(inBrew(pressedInBrew('weave', [false, false]))?.grade).toBe('good');
	});

	/**
	 * The one thing this section grades that the fight cannot excuse: a press inside a Tigereye Brew.
	 *
	 * A count and not a share, which is `karmaEmpty`'s own sample argument turned around. One press
	 * inside a brew is a whole fault by itself and does not become a smaller one because the pull had
	 * room for three charges. See `duringBrew` in `../index` for what the fault is and, more to the
	 * point, what it refuses to claim: the simulator does not model Touch of Karma at all, so the cost
	 * being named is the global and never the redirect.
	 *
	 * Built rather than borrowed for the same reason `unmeasured` above is built: every committed
	 * capture predates the field, so a fixture reaching these branches would pin how old the capture is.
	 */
	const inBrew = (analysis: Analysis) =>
		scoreAnalysis(analysis).sections.karma?.metrics.find((m) => m.key === 'karmaInBrew');
	const pressedInBrew = (name: string, flags: boolean[]): Analysis => {
		const captured = fixture(name);
		return {
			...captured,
			karma: {
				...captured.karma,
				casts: flags.length,
				duringBrew: flags.filter(Boolean).length,
				uses: flags.map((duringBrew, i) => ({
					...(captured.karma.uses[0] as (typeof captured.karma.uses)[number]),
					t: i * 90_000,
					duringBrew,
				})),
			},
		};
	};

	it('reads one press inside a brew as a slip and two as a habit', () => {
		expect(inBrew(pressedInBrew('weave', [false, false]))?.value).toBe(0);
		expect(inBrew(pressedInBrew('weave', [false, false]))?.grade).toBe('good');
		expect(inBrew(pressedInBrew('weave', [true, false]))?.grade).toBe('ok');
		expect(inBrew(pressedInBrew('weave', [true, true]))?.value).toBe(2);
		expect(inBrew(pressedInBrew('weave', [true, true]))?.grade).toBe('bad');
		expect(THRESHOLDS.karmaInBrew.good).toBe(0);
		expect(THRESHOLDS.karmaInBrew.ok).toBe(1);
	});

	/**
	 * And it is graded at one press, where `karmaEmpty` is not.
	 *
	 * The two refusals are about different things and must not be made to agree. A share of one press
	 * is nought or a hundred and neither is a habit; a count of one press inside a brew is one global
	 * that went into the most expensive window in the pull, which is true whatever the sample.
	 */
	it('grades a single press, unlike the share beside it', () => {
		const one = pressedInBrew('weave', [true]);
		expect(inBrew(one)?.unmeasurable).toBe(false);
		expect(inBrew(one)?.grade).toBe('ok');
		expect(
			scoreAnalysis(one).sections.karma?.metrics.find((m) => m.key === 'karmaEmpty')?.unmeasurable,
			'the share still declines at one press',
		).toBe(true);
	});

	/**
	 * Two silences, both of which have to survive as "cannot say" rather than as a clean sheet.
	 *
	 * A pull that never pressed the button was never asked the question, which is the shape the weave
	 * rules take, and a capture from before the field existed has not been measured. Reading either as
	 * nought would print `good` over six committed pulls nobody has checked.
	 */
	/**
	 * The rule is secondary, so it reads a band and never carries the section's letter.
	 *
	 * `verdict('karma', …)` picks its sentence off that letter and every arm of it is about what the
	 * redirect *returned*: "only part of their potential came back", "time it for when damage is
	 * coming in". A press that landed full, drained its pool and went out inside a brew would pull the
	 * letter down and print one of those over a pull they are false of, which is the shape of the
	 * `tooFew` bug on `karmaEmpty` above with a third metric instead of a second. `snapshots` and
	 * `weave` put their fault counts in the secondary slot for the same reason.
	 */
	it('reads a band without moving the section letter', () => {
		const clean = pressedInBrew('weave', [false, false]);
		const faulted = pressedInBrew('weave', [true, true]);
		// Non-vacuity: the metric itself has to move, or the claim below is about nothing.
		expect(inBrew(clean)?.grade).toBe('good');
		expect(inBrew(faulted)?.grade).toBe('bad');
		expect(scoreAnalysis(faulted).sections.karma?.grade).toBe(scoreAnalysis(clean).sections.karma?.grade);
		expect(scoreAnalysis(faulted).overall).toBe(scoreAnalysis(clean).overall);
		// Secondary, so it is out of `primary` and still in `metrics`: the grid draws it, the letter does not.
		const section = scoreAnalysis(faulted).sections.karma;
		expect(section?.metrics.map((m) => m.key)).toContain('karmaInBrew');
		expect(section?.primary.map((m) => m.key)).not.toContain('karmaInBrew');
	});

	/**
	 * The figure the threshold was cut from, derived here rather than quoted at it.
	 *
	 * Every committed capture predates `duringBrew`, so the metric declines on all six, but they carry
	 * the two things it is built from, the press times and the brew windows, so the answer is
	 * recoverable and the band above can be checked instead of believed. It is also the evidence for
	 * the claim that this is not a rare slip: half of these pulls make it.
	 */
	it('derives the same figure the threshold was cut from', () => {
		const insideBrewCount = (analysis: Analysis) =>
			analysis.karma.uses.filter((use) => analysis.brew.windows.some((w) => w.start <= use.t && w.end >= use.t)).length;

		expect(
			['strong', 'poor', 'mixed', 'cleave', 'waves', 'weave'].map((name) => insideBrewCount(fixture(name))),
		).toEqual([1, 1, 2, 0, 0, 0]);
		// The ladder separates all three ways on that spread, which is what `ok: 1` rests on.
		expect(THRESHOLDS.karmaInBrew.ok).toBe(1);
	});

	it('says nothing about a pull that never pressed it, or one nobody measured', () => {
		const never = pressedInBrew('weave', []);
		expect(never.karma.casts).toBe(0);
		expect(inBrew(never)?.unmeasurable).toBe(true);

		for (const name of ['strong', 'mixed', 'poor', 'waves', 'weave', 'cleave']) {
			expect(fixture(name).karma.duringBrew, `${name} was captured before the rule existed`).toBeUndefined();
			expect(inBrew(fixture(name))?.unmeasurable, name).toBe(true);
		}
	});
});
