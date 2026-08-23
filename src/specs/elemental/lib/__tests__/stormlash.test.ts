// Stormlash Totem: the raid's placements read together, and the overlaps that are the section's point.
//
// The buff does not stack, so a totem laid on top of a running one is a totem wasted — which is a fact
// about the *raid*, not about this player. It comes out of `raidStormlash`, a separate fetch, and the
// two committed pulls do not carry it: both shamans placed a totem (`120668` at 1.6s on
// `a:qHRAFwdGzaB6MPYC` #14 and at 31.0s on `a:xB3kh7v9pF2AHRtq` #16) and both report
// `{ shamans: [], overlaps: [], totems: 0 }`, because the field was never fetched into the fixture.
// So the raid view is synthetic here, and the real pulls are used for the one thing they can answer:
// the totem's row on the timeline, which comes off the *buff* the player was given rather than off the
// raid-wide placement fetch — the two sources answer different questions and only one of them was
// fetched. What the rows themselves say, on all three pulls and for Skull Banner beside them, is
// `raidBuffLanes.test.ts`.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { WclEvent } from '~/lib/events';
import { rawFixtures } from '~/lib/analysis/fixtures';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';
import { analyse } from '../index';
import { scoreAnalysis } from '../score';

const STORMLASH = 120_668;

/** Memoised: the rule-6 sweep reads every committed pull twice over and one of them is 4.4 MB. */
const analysedPulls = new Map<string, Analysis & ElementalAuditResult>();
const fx = (name: string): Analysis & ElementalAuditResult => {
	const hit = analysedPulls.get(name);
	if (hit !== undefined) return hit;
	const dataset = JSON.parse(
		readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8'),
	) as FightDataset;
	const el = analyse(dataset) as Analysis & ElementalAuditResult;
	analysedPulls.set(name, el);
	return el;
};

/** Every raw Elemental pull, found rather than listed — see rule 6's suite for why it had to change. */
const FIXTURES = rawFixtures('elemental').map(({ name }) => name.replace(/\.json$/, ''));

describe('a pull whose raid-wide placements were never fetched', () => {
	const el = fx('phased');

	/**
	 * The section reads `raidStormlash` and nothing else, so with the field absent it says nothing —
	 * rather than falling back to the player's own casts, which would draw a one-shaman raid and let a
	 * reader conclude nobody else brought a totem.
	 */
	it('says nothing about the raid rather than guessing', () => {
		// The three *placement* figures, asserted on their own rather than through a whole-object
		// `toEqual`. `received` sits beside them off a different source and is populated, so an equality
		// over the whole audit would have to restate four totems to say "the placements are empty" — and
		// the next field added to the audit would fail this for no reason connected to what it checks.
		expect([el.stormlash.shamans, el.stormlash.overlaps, el.stormlash.totems]).toEqual([[], [], 0]);
	});

	/**
	 * The player's own totem is still on the timeline with `raidStormlash` absent — but as the **buff**
	 * they got, not as their cast plus ten seconds.
	 *
	 * This assertion used to read `{ start: 1620, end: 11_620 }`: the press at 1.620s and the totem's
	 * fixed duration, from `castTimes(STORMLASH_TOTEM)`. It is now `{ start: 2427, end: 12_141 }`,
	 * which is when 120676 went on this shaman and came off again — 807ms later, because the summon
	 * lands before the totem gets its first pulse out. The section's own numbers are untouched by that
	 * (the test above), and the reason for the move is that this row now sits beside the *other*
	 * shamans' rows: `Player (7)`'s totem can only be read off the buff, so reading the player's own off
	 * the press would have put two different clocks in one block. The press is still marked — it keeps
	 * its own cast lane, exactly as the merge already does for a key several lanes share.
	 *
	 * One row per instance, so this is `filter` and not `find`: `phased` has two Stormlash totems on
	 * this player and `find` would have quietly answered for the first of them.
	 */
	it('draws the player’s own totem as the buff they got, not as the press', () => {
		const own = el.timeline?.lanes.filter((l) => l.key === 'stormlash-totem' && l.source?.id === 2) ?? [];
		expect(own.map((l) => l.windows)).toEqual([[{ start: 2427, end: 12_141 }]]);
	});
});

// ------------------------------------------------------------------ synthetic

const T0 = 900_000;
const DURATION = 60_000;
const ME = 4;
const OTHER = 6;
const BOSS = 13;

const LIGHTNING_BOLT = 403;
const LAVA_BURST = 51_505;

const e = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: T0 + t,
	type,
	abilityGameID: id,
	sourceID: ME,
	targetID: ME,
	...extra,
});

const contact: WclEvent[] = Array.from({ length: DURATION / 5000 + 1 }, (_, i) =>
	e(i * 5000, 'damage', LIGHTNING_BOLT, { targetID: BOSS, targetInstance: 1, amount: 1000, hitType: 1 }),
);

/** One placement, as the raid-wide fetch returns it: an absolute stamp and the shaman who laid it. */
const placed = (t: number, sourceID?: number): WclEvent => ({
	timestamp: T0 + t,
	type: 'cast',
	abilityGameID: STORMLASH,
	...(sourceID === undefined ? {} : { sourceID }),
	targetID: -1,
});

/**
 * Six placements from three shamans, arranged around the four things the overlap walk has to get right.
 *
 *   me     0s, 20s
 *   other  55s, 5s, 10s  — deliberately out of order, to prove the per-shaman sort
 *   nobody 52s          — a placement the actor list cannot name
 *
 * Concurrency: two totems from 5s (mine and the first of theirs) through 15s, via 10s where my totem
 * expires exactly as their second one lands. Then one apiece until 52s, and two again from 55s to the
 * end of the pull.
 */
const raidStormlash: WclEvent[] = [
	placed(0, ME),
	placed(20_000, ME),
	placed(55_000, OTHER),
	placed(5000, OTHER),
	placed(10_000, OTHER),
	placed(52_000),
];

const dataset: FightDataset = {
	code: 'ele-sl',
	fight: {
		id: 9,
		name: 'Iron Qon',
		encounterID: 1662,
		kill: true,
		difficulty: 4,
		size: 25,
		startTime: T0,
		endTime: T0 + DURATION,
	},
	actor: { id: ME, name: 'Sparkstorm', type: 'Player' },
	actors: [
		{ id: ME, name: 'Sparkstorm', type: 'Player' },
		{ id: OTHER, name: 'Thunderfist', type: 'Player' },
		{ id: BOSS, name: 'Iron Qon', type: 'NPC', subType: 'Boss' },
	],
	events: [...contact, e(500, 'cast', LAVA_BURST, { targetID: BOSS, targetInstance: 1 })],
	raidStormlash,
	table: {
		fight: {
			id: 9,
			name: 'Iron Qon',
			encounterID: 1662,
			kill: true,
			difficulty: 4,
			size: 25,
			startTime: T0,
			endTime: T0 + DURATION,
			enemyNPCs: [{ id: BOSS, gameID: 68_078 }],
		},
		damageDone: {
			entries: [
				{
					name: 'Sparkstorm',
					id: ME,
					type: 'Shaman',
					itemLevel: 553,
					total: 13_000,
					activeTime: DURATION,
					abilities: [{ guid: LIGHTNING_BOLT, name: 'Lightning Bolt', total: 13_000 }],
				},
			],
		},
	},
};

const el = analyse(dataset) as Analysis & ElementalAuditResult;
const { stormlash } = el;
const shaman = (id: number) => stormlash.shamans.find((s) => s.id === id);

describe('the raid’s placements, grouped by who laid them', () => {
	it('counts every totem in the raid, not only the player’s', () => {
		expect(stormlash.totems).toBe(6);
		expect(stormlash.shamans.map((s) => s.id)).toEqual([ME, OTHER, -1]);
	});

	it('names them from the actor list, and admits when it cannot', () => {
		expect(shaman(ME)?.name).toBe('Sparkstorm');
		expect(shaman(OTHER)?.name).toBe('Thunderfist');
		// A placement whose source the log did not carry is still a placement worth drawing: it buckets
		// under -1 with a null name rather than being dropped or credited to somebody.
		expect(shaman(-1)?.name).toBeNull();
		// Clamped to the pull, not 62 000: this totem was laid with eight seconds of fight left and did
		// not get to run its full ten. It read 62 000 while this walk was the one place in the section
		// that did not clamp, which put a bar two seconds past the end of its own axis.
		expect(shaman(-1)?.windows).toEqual([{ start: 52_000, end: 60_000 }]);
	});

	/** Each shaman's own windows come back in time order, whatever order the fetch returned them in. */
	it('puts each shaman’s totems in time order', () => {
		expect(shaman(OTHER)?.windows.map((w) => w.start)).toEqual([5000, 10_000, 55_000]);
		expect(shaman(ME)?.windows).toEqual([
			{ start: 0, end: 10_000 },
			{ start: 20_000, end: 30_000 },
		]);
	});
});

describe('the stretches two totems were up at once', () => {
	/**
	 * Two overlaps, and the shape of each is the argument.
	 *
	 * 5s-15s is one stretch and not two. My totem ends at 10s exactly as their second lands, so a walk
	 * that treated each pair of windows separately would report 5s-10s and 10s-15s as two wasted
	 * stretches — and the count on the tile is the number a reader is asked to act on.
	 *
	 * 55s-60s is the clamp. The unnamed shaman's totem runs to 62s and the other's to 65s, so the
	 * overlap between them runs past the kill; `intervalsAtLeast` closes it at the pull instead of
	 * reporting a wasted stretch longer than the fight it happened in.
	 */
	it('reports one stretch per run of two, closed at the kill', () => {
		expect(stormlash.overlaps).toEqual([
			{ start: 5000, end: 15_000 },
			{ start: 55_000, end: DURATION },
		]);
	});

	/**
	 * The moment two totems merely touch is not an overlap.
	 *
	 * My first ends at 10s as their second begins, and my second begins at 20s as their first ends.
	 * Both used to come out as zero-length stretches — a bar the chart still draws at its minimum width,
	 * and a number on the tile nobody could find on the timeline.
	 */
	it('emits nothing where one totem ends as the next begins', () => {
		for (const w of stormlash.overlaps) expect(w.end).toBeGreaterThan(w.start);
		expect(stormlash.overlaps.some((w) => w.start === 20_000 || w.end === 20_000)).toBe(false);
	});

	it('never reports an overlap past the pull', () => {
		for (const w of stormlash.overlaps) expect(w.end).toBeLessThanOrEqual(el.durationMs);
	});
});

// ------------------------------------------------------------------ §80 rule 6

/**
 * Plan §80 rule 6 — the row the user asked for, and **which of its two readings it asks.**
 *
 * Their words:
 *
 *   > Stormlash should ideally not be cast during Ascendance (can add as improvement in the Stormlash
 *   > section as a row in the table (doesnt exist yet, similar to Flame Shock usage label))
 *
 * Two things are settled by that sentence and are not re-opened here. It is **shown, not graded** —
 * "ideally", and "as an improvement" — which is §92's precedent applied per sentence rather than to
 * §80's block. And it belongs in the **Stormlash section's table**, in the shape the Flame Shock usage
 * label already has.
 *
 * ## The cast, not the overlap
 *
 * Lane F measured both readings. The player's own **cast** inside an Ascendance window is **0 of 4**
 * committed pulls; their own totem merely **overlapping** one is 1 of 4, `phased` at 7 136 of that
 * totem's 9 714 ms. The overlap has the bigger number and is the wrong question, for a reason no
 * amount of data settles: **an overlap is not a fault at all.** Stormlash pays out on what the raid
 * does while it is up, so a totem running through a burst window is worth more rather than less. What
 * costs something is the **global** — during Ascendance every one of them was wanted on Lava Beam,
 * which is the identical argument the Flame Shock ladder already makes about a refresh under
 * Ascendance. Reporting the overlap as an improvement would print a benefit as a problem.
 *
 * So the reading is the press, it fires on nothing committed, and that is the honest answer rather
 * than a hole: these four pulls did not make this mistake, and the table says so on the rows it does
 * have. `a press inside Ascendance` below is the proof it can fire.
 *
 * *** The counts above read "0 of 3" and "1 of 3" until now, and the suite below swept the literal
 * `['phased', 'unbroken', 'cleave']`. *** `addsThenBoss.json` is the fourth pull and it is the one this
 * rule most wanted asked, for two reasons: it lays **two** of its own totems rather than one, so the rule
 * has two presses to speak about instead of one, and it is the only committed pull that carries a
 * `raidStormlash` fetch at all — ten placements from five shamans — so it is the first pull on which the
 * placement audit and the received-buff audit are both populated. Neither of its own presses is inside any
 * of its four Ascendance windows, so the count is 0 of 4 rather than 0 of 3 and the conclusion is
 * unchanged; what changed is that it is now measured over the fixture directory instead of a list.
 */
describe('rule 6: the player’s own press, inside their own Ascendance', () => {
	const pulls = FIXTURES;

	/**
	 * **Not a red against the old behaviour — a measurement of the fixtures**, and labelled so on the
	 * line, exactly as `ascendance.test.ts` labels its two. `received` did not exist before this change,
	 * so of course it fails; what earns the test its place is the *numbers*, which are what decide that
	 * the table has rows to show at all.
	 *
	 * **Both of the old universals in this test were wrong about the fourth pull.** It asserted
	 * `stormlash.totems === 0` "on all three, because the placement fetch is not in any fixture" —
	 * `addsThenBoss` fetches it, and reads 10. And it asserted "one own totem apiece, so the rule has
	 * exactly one press to speak about on each pull" — `addsThenBoss` lays two. Both are now per-pull
	 * figures rather than universals, and the sweep is the fixture directory.
	 */
	it('has rows on every pull, and the placement audit only where it was fetched', () => {
		// [received rows, own totems, placements fetched] — `rawFixtures` order.
		const expected: Record<string, [number, number, number]> = {
			addsThenBoss: [10, 2, 10],
			cleave: [4, 1, 0],
			phased: [2, 1, 0],
			unbroken: [4, 1, 0],
		};
		expect(Object.keys(expected).sort()).toEqual([...pulls].sort());
		for (const name of pulls) {
			const el = fx(name);
			const [received, own, totems] = expected[name]!;
			expect([name, el.stormlash.totems]).toEqual([name, totems]);
			expect([name, el.stormlash.received?.length]).toEqual([name, received]);
			// At least one own totem on every pull, so the rule has a press to speak about everywhere.
			expect([name, el.stormlash.received?.filter((r) => r.source.own).length]).toEqual([name, own]);
		}
	});

	/**
	 * Also a fixture measurement rather than a red: this is the 0 of **4**, stated as a number.
	 *
	 * `addsThenBoss` carries two own rows and both read `false`, which is what makes the count 0 of 4 and
	 * not 0 of 3 — and it is the only pull where the rule is asked twice.
	 */
	it('finds no press inside Ascendance on any committed pull', () => {
		const expected: Record<string, Array<boolean | null>> = {
			addsThenBoss: [null, null, false, null, null, null, null, false, null, null],
			cleave: [null, null, false, null],
			phased: [false, null],
			unbroken: [null, null, false, null],
		};
		for (const name of pulls) {
			const el = fx(name);
			// `false` on the player's own row, `null` on everybody else's — never `false` on a raid-mate's,
			// which would be a column of reassurance about a press this player did not make.
			expect([name, el.stormlash.received?.map((r) => r.duringAscendance)]).toEqual([name, expected[name]]);
		}
		// The count the docblock quotes, derived rather than restated: no `true` anywhere.
		expect(
			pulls.flatMap((name) => fx(name).stormlash.received ?? []).filter((r) => r.duringAscendance === true),
		).toEqual([]);
	});

	/**
	 * **The choice between the two readings, pinned from the data that separates them.**
	 *
	 * `phased` is the one pull where they disagree: the player's own totem is up for 7 136 of the
	 * opener's fifteen seconds — 73% of the totem's own 9 714 ms lifetime — and the press that laid it
	 * was 3 385 ms before the Ascendance press. So the overlap reading fires here and the cast reading
	 * does not, and the row reads `false`. A row built off the overlap could not pass this.
	 */
	it('reads false on the one pull of the four where the overlap reading would fire', () => {
		const el = fx('phased');
		const own = el.stormlash.received?.find((r) => r.source.own);
		expect([own?.t, own?.end]).toEqual([2427, 12_141]);
		expect(own!.end - own!.t).toBe(9714);
		// The opener's window, off the drawn lane rather than restated, so the arithmetic below is against
		// the same fifteen seconds every other section reads.
		const asc = el.timeline?.lanes.find((l) => l.key === 'ascendance')?.windows[0];
		expect(asc).toEqual({ start: 5005, end: 20_007 });
		const overlap = Math.min(own!.end, asc!.end) - Math.max(own!.t, asc!.start);
		expect(overlap).toBe(7136);
		expect(overlap / (own!.end - own!.t)).toBeGreaterThan(0.73);
		// And the row still says no press was made inside the window, because none was.
		expect(own?.duringAscendance).toBe(false);
	});
});

// ------------------------------------------------ synthetic: the fault, and what it does not do

const ASC_CAST = 114_049;
const ASC_BUFF = 114_050;
const STORMLASH_BUFF = 120_676;

/**
 * The synthetic pull above with **no `raidStormlash` and no events**, for the suites below to fill in.
 *
 * The missing placement fetch is the point rather than an omission: `received` exists because it can be
 * read without one, and a shell that supplied placements would let a passing test prove nothing about
 * the pulls we actually hold.
 */
const shell: Omit<FightDataset, 'events' | 'raidStormlash'> = {
	code: dataset.code,
	fight: dataset.fight,
	actor: dataset.actor,
	actors: dataset.actors,
	table: dataset.table,
};

/**
 * A pull with one Ascendance and one Stormlash, with the Stormlash press movable.
 *
 * The player's own totem arrives as a **pet's** `applybuff`, which is what a real log carries — the
 * totem is its own actor — so this also exercises the `petOwner` resolution the row's `source` depends
 * on.
 */
function ascPull(pressAt: number, over: { ascendanceAt?: number } = {}) {
	const ascendanceAt = over.ascendanceAt ?? 10_000;
	const TOTEM = 40;
	const at = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
		timestamp: T0 + t,
		type,
		abilityGameID: id,
		sourceID: ME,
		targetID: ME,
		...extra,
	});
	const pull: FightDataset = {
		...shell,
		actors: [...shell.actors, { id: TOTEM, name: 'Stormlash Totem', type: 'Pet', petOwner: ME }],
		events: [
			...contact,
			at(ascendanceAt, 'cast', ASC_CAST),
			at(ascendanceAt, 'applybuff', ASC_BUFF),
			at(ascendanceAt + 15_000, 'removebuff', ASC_BUFF),
			at(pressAt, 'cast', STORMLASH),
			// The buff lands a global after the summon does, as it does on every real pull — 800ms here,
			// which is `phased`s own 807 rounded. This is the gap the reading has to see past.
			at(pressAt + 800, 'applybuff', STORMLASH_BUFF, { sourceID: TOTEM }),
			at(pressAt + 10_800, 'removebuff', STORMLASH_BUFF, { sourceID: TOTEM }),
		],
	};
	const analysed = analyse(pull) as Analysis & ElementalAuditResult;
	const own = analysed.stormlash.received?.find((r) => r.source.own);
	return { el: analysed, own };
}

describe('the fault rule 6 can find, which no committed pull contains', () => {
	it('marks a press made inside the window', () => {
		// Ascendance at 10s, Stormlash at 14s: four seconds into the fifteen, and a global that was
		// wanted on Lava Beam.
		const { own } = ascPull(14_000);
		expect([own?.t, own?.duringAscendance]).toEqual([14_800, true]);
	});

	it('leaves a press before the window alone', () => {
		const { own } = ascPull(6000);
		expect([own?.t, own?.duringAscendance]).toEqual([6800, false]);
	});

	it('leaves a press after the window alone', () => {
		const { own } = ascPull(26_000);
		expect([own?.t, own?.duringAscendance]).toEqual([26_800, false]);
	});

	/**
	 * **The press, not the bar — the 800ms straddle, from both sides.**
	 *
	 * A press at 9 400 with Ascendance opening at 10 000 puts the *press* 600ms outside the window and
	 * the *bar* 200ms inside it. The global was spent before the button, so the row reads `false`. A
	 * reading off `w.start` — which is the field the row prints in its `at` column, and therefore the
	 * tempting one — answers `true` here and charges the player for a totem they laid first.
	 */
	it('reads the press even where the bar it opened starts inside the window', () => {
		const { own } = ascPull(9400);
		expect(own?.t).toBe(10_200);
		expect(own?.duringAscendance).toBe(false);
	});

	/** And the mirror: the press inside, the bar's start also inside. No disagreement, still true. */
	it('agrees with the bar where the two are on the same side', () => {
		expect(ascPull(10_400).own?.duringAscendance).toBe(true);
	});

	/**
	 * **Shown, not graded** — the half of §92's precedent that keeps this a preference.
	 *
	 * Two whole analyses, scored independently, differing only in when the Stormlash went down. Every
	 * section's grade and the overall grade are identical, so a `true` here cannot cost a player
	 * anything. Not a tautology: the two cards come out of two separate `analyse` + `scoreAnalysis`
	 * runs over two different event streams, and one of the two rows really does read `true`.
	 */
	it('moves no grade when it fires', () => {
		const inside = ascPull(14_000);
		const outside = ascPull(6000);
		expect([inside.own?.duringAscendance, outside.own?.duringAscendance]).toEqual([true, false]);
		const cardOf = (a: Analysis) => {
			const card = scoreAnalysis(a);
			return [card.overall, Object.fromEntries(Object.entries(card.sections).map(([k, v]) => [k, v.grade]))];
		};
		expect(cardOf(inside.el)).toEqual(cardOf(outside.el));
	});
});

describe('a totem somebody else laid', () => {
	it('gets a row with no reading on it rather than a passing one', () => {
		const OTHER_TOTEM = 41;
		const pull = {
			...shell,
			actors: [...shell.actors, { id: OTHER_TOTEM, name: "Thunderfist's Totem", type: 'Pet', petOwner: OTHER }],
			events: [
				...contact,
				e(10_000, 'cast', ASC_CAST),
				e(10_000, 'applybuff', ASC_BUFF),
				e(25_000, 'removebuff', ASC_BUFF),
				// Inside the window, and laid by somebody else — so the *overlap* reading would fire on a
				// press this player had no part in.
				e(12_000, 'applybuff', STORMLASH_BUFF, { sourceID: OTHER_TOTEM }),
				e(22_000, 'removebuff', STORMLASH_BUFF, { sourceID: OTHER_TOTEM }),
			],
		} satisfies FightDataset;
		const other = (analyse(pull) as Analysis & ElementalAuditResult).stormlash.received;
		expect(other?.map((r) => [r.t, r.source.id, r.source.own, r.duringAscendance])).toEqual([
			[12_000, OTHER, false, null],
		]);
	});

	it('says nothing at all on a pull no totem reached', () => {
		const bare = { ...shell, events: [...contact] } satisfies FightDataset;
		expect((analyse(bare) as Analysis & ElementalAuditResult).stormlash.received).toEqual([]);
	});
});
