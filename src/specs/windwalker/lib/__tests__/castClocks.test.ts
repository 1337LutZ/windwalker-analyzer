import { describe, expect, it } from 'vitest';
import type { WclEvent } from '~/lib/events';
import type { Analysis, FightDataset } from '~/lib/types';
import { analyse } from '../index';

/**
 * Which of a press's two instants each Windwalker audit reads.
 *
 * `Handles` rules on this per consumer — a choice reads the commit, an effect reads the landing, a
 * join key reads whichever clock the other side is stamped on — and the audit behind that ruling
 * found that most call sites are correct only by accident: **every Windwalker button is an instant**,
 * so `begincast` and `cast` land in the same millisecond and the clock a site picked has never been
 * exercised. 0 of 394 presses on `dataset-ironJuggernaut` have `begin < t`.
 *
 * So these pulls are hand-built and every one of them is a hypothetical: they hand a Windwalker
 * button a cast bar the game does not give it. That is the only shape that can tell the two clocks
 * apart, and it is the shape that makes the difference between "this site states its clock" and "this
 * site's clock is pinned". `measureCastDurations` pairs the `begincast` with the `cast` and stamps
 * `CastPress.begin` from the gap, so a 2 500 ms gap here is what a 2 500 ms cast bar would be.
 *
 * Two sites are pinned below and two are not, and the reasons are worth stating:
 *
 *   - **Blackout Kick's starvation audit** has no clock to pin. Both halves read the landing on
 *     purpose — the chi left the bar at the completion, `chiAudit.walk.points` is keyed there, and
 *     `view/blackoutKick.ts` joins `pressAt` against `apl.presses[].t` by equality — so there is no
 *     verdict that moves with the clock, only a lookup that would start missing. A fixture-based
 *     guard on it could never fail while the button is an instant, and a synthetic that could would
 *     have to hand-build a chi bar, a drift window and a starved global to reach one assertion.
 *   - **`ascendanceSync`** takes one `readonly number[]`, so nothing inside it can see a second
 *     clock at all. The guard would have to sit on its caller's accessor, in a file this lane does
 *     not own.
 */

const T0 = 100_000;
const END = T0 + 120_000;
const ME = 5;
const BOSS = 20;

const e = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: T0 + t,
	type,
	abilityGameID: id,
	sourceID: ME,
	targetID: ME,
	...extra,
});

/** A pull carrying nothing but the events under test, plus the one hit that gives it a primary target. */
const pull = (events: readonly WclEvent[]): Analysis =>
	analyse({
		code: 'clocks',
		fight: {
			id: 1,
			name: 'Garrosh Hellscream',
			encounterID: 1623,
			kill: true,
			difficulty: 4,
			size: 10,
			startTime: T0,
			endTime: END,
		},
		actor: { id: ME, name: 'Bigdogmo', type: 'Player' },
		actors: [{ id: ME, name: 'Bigdogmo', type: 'Player' }],
		events: [e(1000, 'damage', 107428, { targetID: BOSS, amount: 50_000, hitType: 1 }), ...events],
		table: {
			fight: {
				id: 1,
				name: 'Garrosh Hellscream',
				encounterID: 1623,
				kill: true,
				difficulty: 4,
				size: 10,
				startTime: T0,
				endTime: END,
				enemyNPCs: [{ id: BOSS, gameID: 71_865 }],
			},
			damageDone: {
				entries: [
					{
						name: 'Bigdogmo',
						id: ME,
						type: 'Monk',
						itemLevel: 553,
						total: 50_000,
						activeTime: 100_000,
						abilities: [{ guid: 107428, name: 'Rising Sun Kick', total: 50_000 }],
					},
				],
			},
		},
	} satisfies FightDataset);

/** The Energizing Brew audit, which the analysis publishes as optional and this spec always fills. */
const energizing = (events: readonly WclEvent[]): NonNullable<Analysis['energizing']> => {
	const eb = pull(events).energizing;
	if (eb === undefined) throw new Error('the Windwalker audit published no Energizing Brew reading');
	return eb;
};

/**
 * Energizing Brew: the one site in the spec with a foot on each side of the ruling.
 *
 * Bloodlust runs 10 000 → 50 000. The brew is committed at 48 000, two seconds inside it, and lands
 * at 50 500, half a second after it ended. The buff it applies runs from the landing.
 *
 * So the two halves of this audit disagree about this press by construction, and each is right about
 * its own question. The APL's exception is about the *decision* — priority 14 holds this button
 * through raid haste unless Rushing Jade Wind is in the build — and this player decided inside
 * Bloodlust with no Rushing Jade Wind anywhere in the pull. The window the brew bought, and the
 * energy it poured into it, are about the *effect*, and none of that existed until the landing.
 */
describe('the two clocks Energizing Brew is read on', () => {
	const HASTE_THEN_BREW: WclEvent[] = [
		e(10_000, 'applybuff', 2825),
		e(50_000, 'removebuff', 2825),
		// The press: committed under Bloodlust, landed after it.
		e(48_000, 'begincast', 115_288),
		e(50_500, 'cast', 115_288),
		e(50_500, 'applybuff', 115_288),
		e(56_500, 'removebuff', 115_288),
	];

	it('faults the press against the raid cooldown it was committed under', () => {
		const eb = energizing(HASTE_THEN_BREW);
		expect(eb.uses).toHaveLength(1);
		expect(eb.uses[0]?.haste).toBe('Bloodlust');
		expect(eb.uses[0]?.faults).toEqual([
			'used under Bloodlust without Rushing Jade Wind, which is what would allow it',
		]);
		expect(eb.rushingJadeWind).toBe(false);
		expect(eb.duringHaste).toBe(1);
		expect(eb.faulted).toBe(1);
		expect(eb.hasteRjwUses).toBe(1);
	});

	/** The fault reaches the ledger, which is where a reader actually meets it. */
	it('lists that press in the miss ledger', () => {
		expect(pull(HASTE_THEN_BREW).misses.map((m) => m.kind)).toContain('Energizing Brew held through');
	});

	/**
	 * The other half, on the same press: the buff join and the overcap arithmetic stay on the landing.
	 *
	 * **A guard rather than a change** — this half already read the landing and still does. It is here
	 * because the join is a 250 ms `SELF_EVENT_MS` reach backwards, which cannot absorb a cast bar: ask
	 * it at the commit and it does not shift the window, it loses it, and a six-second buff that
	 * plainly went up reports `lengthMs: 0` and `wasted: null`. That is the failure mode the ruling
	 * calls the map-key trap, one indirection shorter.
	 */
	it('still measures the window the press bought from the landing', () => {
		const use = energizing(HASTE_THEN_BREW).uses[0];
		expect(use?.t).toBe(50_500);
		expect(use?.lengthMs).toBe(6000);
	});
});

/**
 * Tiger Palm: a press committed into a live Combo Breaker proc that expired mid-cast.
 *
 * The proc runs 5 000 → 20 000, its own full fifteen seconds. Tiger Power went up at 10 000 and so
 * has eight and a half seconds left at the landing — comfortably past the two-second refresh window,
 * which is what makes the landing's verdict `wasted` rather than `refresh`.
 *
 * `wasted` is not a cosmetic label: it is counted into `cpm.wastedGcds`, which reaches `overall()`.
 * Reading the landing here would charge a player for clipping a healthy buff on a press they made
 * because the game had told them it was free.
 */
describe('the clock Tiger Palm is read on', () => {
	const PROC_EXPIRED_MID_CAST: WclEvent[] = [
		e(5000, 'applybuff', 118_864),
		e(20_000, 'removebuff', 118_864),
		e(10_000, 'applybuff', 125_359),
		e(19_000, 'begincast', 100_787, { targetID: BOSS }),
		e(21_500, 'cast', 100_787, { targetID: BOSS }),
	];

	it('reads the proc at the instant the player pressed', () => {
		const filler = pull(PROC_EXPIRED_MID_CAST).filler;
		expect(filler.castList).toHaveLength(1);
		expect(filler.castList[0]).toMatchObject({ t: 19_000, proc: true, reason: 'proc' });
		expect(filler.onProc).toBe(1);
		expect(filler.wasted).toBe(0);
	});

	it('charges no wasted global for it, and puts nothing in the ledger', () => {
		const analysis = pull(PROC_EXPIRED_MID_CAST);
		expect(analysis.cpm.wastedGcds).toBe(0);
		expect(analysis.misses.map((m) => m.kind)).not.toContain('Tiger Palm wasted');
	});

	/**
	 * **Deliberate contrast case, and it is the same verdict under either clock by construction** — the
	 * identical landing with no `begincast` at all is what every Windwalker press really looks like, and
	 * there the proc had genuinely gone before the player pressed. A wasted global is the right answer.
	 *
	 * It is here so the assertions above are a claim about the clock rather than about the reason
	 * ladder: same proc, same buff, same landing, and the invented mistake appears and disappears with
	 * nothing but the commit instant.
	 */
	it('would have called that same press a wasted global off the landing alone', () => {
		const instant = PROC_EXPIRED_MID_CAST.filter((ev) => ev.type !== 'begincast');
		const analysis = pull(instant);
		expect(analysis.filler.castList[0]).toMatchObject({ t: 21_500, proc: false, reason: 'wasted' });
		expect(analysis.filler.wasted).toBe(1);
		expect(analysis.cpm.wastedGcds).toBe(1);
		expect(analysis.misses.map((m) => m.kind)).toContain('Tiger Palm wasted');
	});
});
