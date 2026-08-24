// Clearcasting / Elemental Focus (16246), the +20% damage multiplier this report could not see.
//
// The undeclared-aura sweep (`68671a5`, plan §82) found it with **728 events across the three committed
// pulls** — the busiest id it turned up — and nothing in the repository knew the number existed except
// `EXTRA_NAMES`, labelling a damage-table row. A school-wide +20% on a spec whose entire argument is
// snapshots was neither drawn nor named.
//
// What this file pins, in the order the finding was established:
//
//   1. the two numbers the sim states, against the log that has to agree with them;
//   2. what spends a stack, checked against the sim's own `canConsumeSpells` mask rather than a guess;
//   3. **that Flame Shock's snapshot captures it** — measured out of the fixture's own damage events, two
//      ways round, because that is the claim that changes what the report means and not just what it draws;
//   4. where it is drawn, and where it deliberately is not.
//
// It grades nothing, and that is asserted too: no rotation asks for this proc, so no figure here is a
// verdict on a press.

import { describe, expect, it } from 'vitest';

import { drawnLaneKeys } from '~/lib/analysis/drawnAuras';
import { rawFixtures } from '~/lib/analysis/fixtures';
import type { Analysis, FightDataset } from '~/lib/types';
import { SUMMARY_LANE_KEYS } from '~/specs/elemental/lib/view/timelineBanks';

import { analyse, registry } from '..';

/**
 * Every raw Elemental pull, found rather than listed.
 *
 * The literal this replaced was `['unbroken', 'phased', 'cleave']`, and the header two paragraphs up
 * still says "the three committed pulls" because that is what the sweep reported at the time. Every
 * claim below is of the form "on any committed pull" — the declared ceiling, the consume mask, the
 * drawn row, the absence of a published figure — so the moment `addsThenBoss.json` landed each of them
 * was being asked of three quarters of the evidence, and a list is the one input nobody re-reads when
 * the directory grows. The two pinned counts are keyed by name rather than positional for the same
 * reason: an array in `FIXTURES` order says nothing when the order is discovered, and an object makes
 * a fifth pull fail here instead of slipping past.
 */
type Fixture = string;
const FIXTURES: Fixture[] = rawFixtures('elemental').map(({ name }) => name.replace(/\.json$/, ''));

/**
 * The datasets and their analyses, both memoised.
 *
 * Not tidiness: `addsThenBoss.json` is 4.4 MB, `load` is called once per `raw()` and `raw()` runs inside
 * every event walk in this file, and three separate tests call `analyse` per pull. Parsing and analysing
 * once per pull is what keeps a four-pull grid cheaper than the three-pull one it replaced.
 */
const datasets = new Map<string, FightDataset>();
const load = (name: Fixture): FightDataset => {
	const hit = datasets.get(name);
	if (hit !== undefined) return hit;
	const found = rawFixtures('elemental').find((fixture) => fixture.name === `${name}.json`);
	if (found === undefined) throw new Error(`no raw Elemental fixture ${name}`);
	datasets.set(name, found.dataset);
	return found.dataset;
};

const analyses = new Map<string, Analysis>();
const analysed = (name: Fixture): Analysis => {
	const hit = analyses.get(name);
	if (hit !== undefined) return hit;
	const el = analyse(load(name));
	analyses.set(name, el);
	return el;
};

/** The raw shape, which is what an event-stream claim has to be made against. */
type Raw = {
	fight: { startTime: number; endTime: number };
	actor: { id: number };
	events: {
		timestamp: number;
		type: string;
		sourceID?: number;
		targetID?: number;
		abilityGameID?: number;
		stack?: number;
		tick?: boolean;
		amount?: number;
		unmitigatedAmount?: number;
	}[];
};

const raw = (name: Fixture) => load(name) as unknown as Raw;

const CLEARCASTING = 16_246;
const FLAME_SHOCK = 8050;

/**
 * The spells that spend a stack, transcribed from `canConsumeSpells` in
 * `sim/shaman/talents_elemental.go:147`: Lightning Bolt, Chain Lightning, Lava Burst, Fire Nova, the
 * shocks less the Flame Shock **dot**, Elemental Blast, Unleash Elements, Earthquake and Lava Beam.
 *
 * The dot's exclusion is the interesting half — `SpellMaskShock & ^SpellMaskFlameShockDot` — and it is
 * what makes the snapshot below possible rather than self-cancelling: the dot ticking does not spend the
 * stack its own application captured.
 *
 * **`1535` is Fire Nova and this spec cannot press it — membership here is not a claim that it can.** The
 * mask is written on the shared `Shaman`, so it names every shaman spell a stack would discount, and
 * `shaman.FireNova` is registered in exactly two places, neither of them Elemental:
 * `sim/shaman/enhancement/firenova.go:10` (called from `enhancement.go:140`) and
 * `sim/shaman/fire_elemental_spells.go:37` for the pet. `sim/shaman/elemental/elemental.go:58-61`
 * registers four spells — Thunderstorm, Lava Burst, Earthquake, Lava Beam — and Fire Nova is not among
 * them. Recorded so the next reader who lands on this id does not re-open the question; the pet's copy is
 * already named separately as `117588: 'Fire Elemental: Fire Nova'` in the spec's `EXTRA_NAMES`, and the
 * `earthquake` entry in `../index.ts` carries the same finding beside the button it gets confused with.
 * **`61_882` is Earthquake's press id**, and this transcription is why it is: see that entry for the
 * argument against the sim's own reuse of 77478 for both halves.
 */
const CONSUMERS = new Set([403, 421, 51_505, 1535, 8042, FLAME_SHOCK, 8056, 117_014, 73_680, 61_882, 114_074]);

/** Every 16246 event the log put on this player, in order. */
const auraEvents = (name: Fixture) => {
	const r = raw(name);
	return r.events.filter((e) => e.abilityGameID === CLEARCASTING && e.targetID === r.actor.id);
};

/** The stretches Clearcasting was up, fight-relative. */
const windows = (name: Fixture): [number, number][] => {
	const r = raw(name);
	const out: [number, number][] = [];
	let on: number | null = null;
	for (const e of auraEvents(name)) {
		if (e.type === 'applybuff') on = e.timestamp;
		else if (e.type === 'removebuff' && on !== null) {
			out.push([on - r.fight.startTime, e.timestamp - r.fight.startTime]);
			on = null;
		}
	}
	if (on !== null) out.push([on - r.fight.startTime, r.fight.endTime - r.fight.startTime]);
	return out;
};

const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('Clearcasting is declared with the ceiling and duration the sim states', () => {
	// Read inside the test rather than at collection: an undeclared key makes the registry throw, and a
	// throw at module scope takes the whole file down as `no tests` — a crash that reads as green under
	// some reporters. Per-test, the same absence reads as the one failing assertion it is.
	const aura = () => registry.aura('clearcasting');

	it('is 16246, two stacks, fifteen seconds', () => {
		// `sim/shaman/talents_elemental.go`: `ActionID{SpellID: 16246}` and `Duration: time.Second * 15` on
		// the aura at :153, `maxStacks := int32(2)` at :150.
		expect(aura().ids).toEqual([CLEARCASTING]);
		expect(aura().maxStacks).toBe(2);
		expect(aura().durationMs).toBe(15_000);
		// A crit puts it up, so there is no press to attribute a window to — the field `lava-surge` also
		// leaves unset, and the reason the lane is drawn in the `proc` group.
		expect(aura().appliedBy).toBeUndefined();
	});

	/**
	 * The declared ceiling against the log's, which is the check the retired 144998 handle failed silently:
	 * a number written down in the model and never compared to the stream it claims to describe.
	 */
	it('never sees a third stack on any committed pull, so two is the log’s ceiling too', () => {
		for (const name of FIXTURES) {
			const stacks = auraEvents(name)
				.map((e) => e.stack)
				.filter((s): s is number => s !== undefined);
			expect(stacks.length, name).toBeGreaterThan(50);
			expect(Math.max(...stacks), name).toBe(2);
		}
	});

	/**
	 * 728, the figure the sweep reported — recounted here so the header is a measurement and not a memory,
	 * and now recounted over the pull the sweep never saw.
	 *
	 * Keyed rather than positional, because the grid is discovered: an array of three numbers said nothing
	 * about which pull each belonged to, and said nothing at all about a fourth. The 728 is kept as the
	 * three-pull subtotal it was reported as, beside the total the directory actually holds — a busiest-id
	 * claim that quietly re-based itself on a bigger corpus would stop being the sweep's finding.
	 */
	it('is the busiest id in the sweep, and stays the busiest as the corpus grows', () => {
		const counts = Object.fromEntries(FIXTURES.map((name) => [name, auraEvents(name).length]));
		expect(counts).toEqual({ addsThenBoss: 612, cleave: 299, phased: 219, unbroken: 210 });
		// The sweep's own figure, over the three pulls it swept.
		expect(counts.unbroken! + counts.phased! + counts.cleave!).toBe(728);
		expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(1340);
	});
});

describe('what spends a stack is what the sim says spends one', () => {
	/**
	 * Every drop paired against the casts at its own instant. The point is not the ratio — it is that the
	 * set of spells found spending stacks is a **subset of `canConsumeSpells`** and nothing else, which is
	 * the log agreeing with the mask rather than this file asserting the mask twice.
	 */
	it('is spent only by spells on the sim’s consume mask, and falls off unspent otherwise', () => {
		const totals = { consumed: 0, unspent: 0 };
		for (const name of FIXTURES) {
			const r = raw(name);
			const castsAt = new Map<number, number[]>();
			for (const e of r.events)
				if (e.type === 'cast' && e.sourceID === r.actor.id && e.abilityGameID !== undefined) {
					const at = castsAt.get(e.timestamp) ?? [];
					at.push(e.abilityGameID);
					castsAt.set(e.timestamp, at);
				}
			const spenders = new Set<number>();
			let consumed = 0;
			let unspent = 0;
			for (const e of auraEvents(name)) {
				if (e.type !== 'removebuff' && e.type !== 'removebuffstack') continue;
				const spending = (castsAt.get(e.timestamp) ?? []).filter((id) => CONSUMERS.has(id));
				if (spending.length > 0) {
					consumed += 1;
					for (const id of spending) spenders.add(id);
				} else unspent += 1;
			}
			// Not vacuous, and not a superset: every id that ever took a stack is on the mask.
			expect(spenders.size, name).toBeGreaterThan(2);
			for (const id of spenders) expect(CONSUMERS.has(id), `${name}: ${id}`).toBe(true);
			totals.consumed += consumed;
			totals.unspent += unspent;
		}
		// The pull-level figures, so a change in the walk shows up as a number rather than as a shrug.
		expect(totals).toEqual({ consumed: 474, unspent: 199 });
	});
});

/**
 * **The claim that decides what this proc is: Flame Shock's snapshot captures the +20%.**
 *
 * The sim is unambiguous and the reading is a chain of four facts. `applyEffects` runs **before**
 * `OnCastComplete` (`sim/core/cast.go:329-332`), so the dot is applied while the aura still has the stack
 * the press is about to spend. Flame Shock's dot spell is registered at `sim/shaman/shocks.go:68` with
 * `SpellSchool: core.SpellSchoolFire`, and `shouldApply` matches a school mod by
 * `mod.School.Matches(spell.SpellSchool)` (`sim/core/spell_mod.go:179`, and `Matches` is a bitwise
 * intersection at `sim/core/flags.go:225`) — Fire is inside `SpellSchoolElemental`. The mod itself is
 * `spell.DamageMultiplier *= 1 + mod.floatValue` (`sim/core/spell_mod.go:499`). And `Dot.Snapshot` freezes
 * `dot.Spell.AttackerDamageMultiplier(attackTable, true)` (`sim/core/spell_result.go:504-513`), which
 * multiplies by exactly that `spell.DamageMultiplier`.
 *
 * So a Flame Shock applied under Clearcasting keeps +20% for the whole thirty seconds — long after the
 * fifteen-second aura is gone — and the two tests below are that claim measured off the fixtures instead
 * of read off the sim. They are a matched pair and only the pair is evidence: if the multiplier were
 * dynamic, grouping ticks by the aura's state *at the tick* would separate them and grouping by its state
 * *at the application* would not. The log says the opposite, both ways round.
 */
describe('Flame Shock snapshots it, which the fixtures say as loudly as the sim does', () => {
	/**
	 * Every Flame Shock tick, bucketed onto the application it belongs to — **on its own enemy**.
	 *
	 * **The target key is the correction, and the fourth pull is what made it visible.** This walk used to
	 * own a tick to the latest Flame Shock cast at or before it, full stop, with no regard for who was
	 * being ticked. On a pull with one dot target that is the same thing; on `cleave`, with two, it is
	 * nearly the same thing. On `addsThenBoss` the player dots **nine distinct enemies**, so a tick from
	 * the dot on one add was routinely credited to the most recent cast on a *different* add — and since
	 * the two casts sit on either side of the proc as often as not, that shuffles snapshotted ticks across
	 * the very partition this walk exists to draw.
	 *
	 * It is a measurement fault and not a report fault: nothing the audit publishes goes through here. But
	 * it cost the file's central claim most of its signal. Bucketed globally, `addsThenBoss` reads **1.1500**
	 * — *below* the 1.15 bar two lines down, on the pull with the most evidence in the directory — and the
	 * grid that would have said so was three names long. Keyed by target it reads **1.2082**, which is the
	 * +20% the mod grants, and `cleave` firms from 1.2621 to 1.3399. The two single-target pulls are
	 * bit-for-bit unmoved, which is what says the change is the target key and nothing else.
	 */
	const dots = (name: Fixture) => {
		const r = raw(name);
		const up = windows(name).map(([a, b]): [number, number] => [a + r.fight.startTime, b + r.fight.startTime]);
		const upAt = (t: number) => up.some(([a, b]) => t >= a && t <= b);
		const out = r.events
			.filter((e) => e.type === 'cast' && e.sourceID === r.actor.id && e.abilityGameID === FLAME_SHOCK)
			.map((e) => ({ t: e.timestamp, target: e.targetID, underProc: upAt(e.timestamp), ticks: [] as number[] }));
		for (const e of r.events) {
			if (e.abilityGameID !== FLAME_SHOCK || e.type !== 'damage' || e.tick !== true) continue;
			if (e.sourceID !== r.actor.id) continue;
			let owner: (typeof out)[number] | undefined;
			for (const dot of out)
				if (dot.target === e.targetID && dot.t <= e.timestamp && (owner === undefined || dot.t > owner.t)) owner = dot;
			owner?.ticks.push(e.unmitigatedAmount ?? e.amount ?? 0);
		}
		return out.filter((d) => d.ticks.length > 0);
	};

	/** A pull can be asked the ratio question only if it applied the dot under the proc more than once. */
	const CAN_COMPARE = 2;

	/**
	 * Grouped by the aura's state at **application**. Pulls with applications on both sides land within a
	 * couple of points of the +20% the mod grants; a pull with a single application under the proc is
	 * stated as one that cannot answer, rather than averaged in as though it could.
	 *
	 * **The gate is the sample and not the name.** It read `ratios.get('unbroken')` and
	 * `ratios.get('cleave')` with `phased` excused by name, which is a claim about which files exist
	 * rather than about which pulls have the evidence. Written that way, a new fixture with one lone
	 * application under the proc would either be asserted to clear 1.15 off a sample of one, or — if it
	 * were simply left out of the two named lines — contribute nothing at all and say so nowhere. Now the
	 * partition is derived and pinned, so a fifth pull has to fall on one side of `CAN_COMPARE` and the
	 * pin is what tells the reader which.
	 */
	it('separates dots by whether the proc was up when they were applied', () => {
		const ratios = new Map<Fixture, number>();
		const under = new Map<Fixture, number>();
		for (const name of FIXTURES) {
			const all = dots(name);
			const on = all.filter((d) => d.underProc).map((d) => mean(d.ticks));
			const off = all.filter((d) => !d.underProc).map((d) => mean(d.ticks));
			expect(on.length + off.length, name).toBeGreaterThan(5);
			under.set(name, on.length);
			ratios.set(name, mean(on) / mean(off));
		}

		// Which pulls carry the evidence, derived — and pinned, so a fifth cannot join either side quietly.
		const comparable = FIXTURES.filter((name) => (under.get(name) ?? 0) >= CAN_COMPARE);
		expect(comparable).toEqual(['addsThenBoss', 'cleave', 'unbroken']);
		expect(FIXTURES.filter((name) => (under.get(name) ?? 0) < CAN_COMPARE)).toEqual(['phased']);

		// Every pull that can answer, does — rather than the two that were named.
		for (const name of comparable) expect(ratios.get(name)!, name).toBeGreaterThan(1.15);
		// And the pull that cannot say, named by its sample rather than hidden: one application under the proc.
		expect(Object.fromEntries(FIXTURES.map((name) => [name, under.get(name)]))).toEqual({
			addsThenBoss: 20,
			cleave: 7,
			phased: 1,
			unbroken: 3,
		});
	});

	/**
	 * **The discriminator.** The same ticks grouped by the aura's state at the tick instead, where a
	 * dynamic +20% would show up and a snapshotted one cannot. All three pulls sit at ~1.05, and the
	 * residual is the ordinary correlation between "a proc is up" and "the other procs are up" — nowhere
	 * near the 1.2 the mod would produce if it were re-read per tick.
	 */
	it('does not separate the same ticks by the proc’s state at the tick', () => {
		for (const name of FIXTURES) {
			const r = raw(name);
			const up = windows(name).map(([a, b]): [number, number] => [a + r.fight.startTime, b + r.fight.startTime]);
			const upAt = (t: number) => up.some(([a, b]) => t >= a && t <= b);
			const ticks = r.events.filter(
				(e) => e.abilityGameID === FLAME_SHOCK && e.type === 'damage' && e.tick === true && e.sourceID === r.actor.id,
			);
			const amount = (e: (typeof ticks)[number]) => e.unmitigatedAmount ?? e.amount ?? 0;
			const inside = ticks.filter((e) => upAt(e.timestamp)).map(amount);
			const outside = ticks.filter((e) => !upAt(e.timestamp)).map(amount);
			expect(inside.length, `${name} inside`).toBeGreaterThan(20);
			expect(outside.length, `${name} outside`).toBeGreaterThan(20);
			expect(mean(inside) / mean(outside), name).toBeLessThan(1.1);
		}
	});
});

describe('where the proc is drawn, and where it is not', () => {
	it('has a row on every pull, so the drawn-aura ledger needs no excuse for it', () => {
		for (const name of FIXTURES) expect(drawnLaneKeys(analysed(name)).has('clearcasting'), name).toBe(true);
	});

	/**
	 * One row with forty-odd windows on it, which is why it belongs on the cast log and not on the summary.
	 * The counts are stated rather than bounded: this is the figure the "picket fence" argument rests on,
	 * and a change in the walk should have to restate it.
	 */
	it('carries forty-odd windows on every pull, none of them a summary-sized count', () => {
		const counted = Object.fromEntries(
			FIXTURES.map((name) => {
				const lanes = analysed(name).timeline?.lanes ?? [];
				return [name, lanes.find((l) => l.key === 'clearcasting')?.windows.length ?? 0];
			}),
		);
		expect(counted).toEqual({ addsThenBoss: 110, cleave: 46, phased: 38, unbroken: 40 });
	});

	/** And stays off the summary timeline, which draws an allow-list this key is deliberately not on. */
	it('is not a summary lane', () => {
		expect(SUMMARY_LANE_KEYS).not.toBeNull();
		expect(SUMMARY_LANE_KEYS).not.toContain('clearcasting');
	});
});

describe('nothing grades it, because no rotation asks for it', () => {
	/**
	 * The rung ladder and the audit are both checked for a Clearcasting condition, because "we did not
	 * build one" and "the rotation has none" are different claims and only the second is a reason. None of
	 * the five `ui/shaman/elemental/apls/*.apl.json` lists mentions 16246, "Clearcasting" or "Elemental
	 * Focus" — including the three this spec reads, `p5`, `cleave` and `aoe`.
	 */
	it('publishes no Clearcasting figure on any pull', () => {
		for (const name of FIXTURES) {
			const analysis = analysed(name) as Analysis & Record<string, unknown>;
			expect(Object.keys(analysis), name).not.toContain('clearcasting');
			const drawn = JSON.stringify(analysis.timeline);
			// It reaches the report as a drawn row and as nothing else.
			expect(drawn.includes('clearcasting'), name).toBe(true);
		}
	});
});
