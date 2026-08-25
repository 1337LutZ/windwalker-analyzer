// Every aura the log put on the player has somewhere to be drawn, or a stated reason not to.
//
// **The opposite question to the coverage ledger, and the one nobody was asking.**
// `analysis/__tests__/fixtureCoverage.test.ts` asks "which declared aura never fires", which catches an
// id wired to a number the game does not write — the 144998 failure. It cannot catch this: an aura
// declared with the *right* id, firing on a committed pull, that no chart draws. Both of a reader's
// trinkets went missing that way. Purified Bindings of Immerseus (`expanded-mind`, 146046) and Kardris'
// Toxic Totem (`toxic-power`, 148906) were declared correctly, procced on `phased`, `unbroken` and
// `cleave` — `addsThenBoss`' shaman wears neither — and had no row in the timeline.
//
// It was invisible in the lane list too, because **three of the four** item lanes that were listed belong
// to trinkets these fixtures' players did not wear — `unerring-vision`, `chayes` and `wrath-of-darkspear`
// — so they are filtered out by `windows.length > 0` and the list looked as though it covered gear. The
// fourth, `breath-of-hydra`, was one of them until `addsThenBoss` landed: that pull's shaman wears it and
// it opens **nine** windows, which is the same lesson rather than a correction to it. The list read as
// though it covered gear precisely because every row in it was a row nothing filled.
//
// **And the fourth pull is how the mechanism was found as well as the sentence.** `FIXTURES` below was a
// literal `['phased', 'unbroken', 'cleave']` — a hardcoded list in the file whose whole subject is a
// guard with a hole in it — so `addsThenBoss` walked straight through the sweep. It reads
// `rawFixtures('elemental')` now, and the first run of that found two undrawn keys nothing else in the
// suite could see: `wushoolays-lightning`, which is worn on that pull and on none of the other three and
// now has a lane, and its counter `wushoolays-lightning-stacks`, ledgered below.
//
// **And it reads both halves of the stream now.** The sweep used to walk `targetID === actor.id` alone,
// which made an aura the player put on an *enemy* unreachable rather than merely unswept — see `firedOn`
// and the `essence-of-yulon` test below, which is where that cost was recorded before it could be paid.
//
// **The sweep is shared with the Windwalker's counterpart and used to be a second copy of it.** The
// reading now lives in `~/lib/analysis/drawnAuras`, which argues its own location; what matters here is
// what the copy had got wrong. This guard swept applications and refreshes only, so it could not see an
// aura whose only event on the pull is a removal — and that is not a corner case on this spec, it is the
// Fire Elemental on the three fixtures that pre-pull it and the pre-pull potion on `unbroken`.
// `addsThenBoss` is the fixture that does *not*: it summons twice inside the pull, so its
// `fire-elemental` events include a real `applybuff` and it is the control for that half. The test below
// names them.
// The Windwalker's copy counted removals and found its missing Bloodlust row that way, so this file was
// the half-blind one and the widening is the point of the merge rather than a side effect of it.

import { describe, expect, it } from 'vitest';

import { rawFixtures } from '~/lib/analysis/fixtures';
import {
	aurasPutOnEnemies,
	aurasPutOnPlayer,
	drawnLaneKeys,
	enemyAuraEvents,
	mergeCounts,
	redundantExcuses,
	selfAuraEvents,
	staleExcuses,
	undrawnAuras,
} from '~/lib/analysis/drawnAuras';
import type { Analysis, FightDataset } from '~/lib/types';
import { analyse, registry } from '~/specs/elemental/lib';

/**
 * Auras that fire and are deliberately not lanes, each with the reason.
 *
 * A ledger rather than a filter, for the reason `SILENT_AURAS` is one: "not drawn" and "forgotten" look
 * identical in a report and have to be told apart in the source.
 */
const NOT_LANES: Record<string, string> = {
	// The raid's two maximum-health buffs, declared for one reader and one reader only: Touch of Karma
	// absorbs a full health pool, so the pool a press was scored against is whatever these had done to
	// it — see `karmaCap` in `../index`. Somebody else presses both, neither changes what the rotation
	// wanted, and a lane for a health bar this report does not otherwise draw would be a row about
	// somebody else's cooldown. The number they move is printed where it matters, beside the press.
	'ancestral-vigor': "raises the health pool Touch of Karma's ceiling is read off; nothing rotational",
	'rallying-cry': "raises the health pool Touch of Karma's ceiling is read off; nothing rotational",
	// Drawn above the rows as its own counter, not among them — `timelineBanks`.
	'lightning-shield': 'drawn as the charge bank',
	// The player lived, moved or healed. None of it changes what the rotation wanted, and a row each
	// would push the rotation's own rows off the screen on a long pull.
	'astral-shift': 'defensive, no bearing on the rotation',
	'spiritwalkers-grace': 'movement, no bearing on the rotation',
	'ancestral-guidance': 'healing, no bearing on the rotation',
	// Wushoolay's Final Choice logs its ten-second window (138786) and a per-second counter that fills to
	// ten (138788) as separate ids. The window is a lane — `index.ts` argues for it at length — and the
	// counter is the fill underneath it: 13 cycles on `addsThenBoss` are 130 `refreshbuff`s of picket
	// fence for a fact the window already carries, and the one thing the counter is read *for* is the
	// snapshot audit's trigger series, which reaches the reader as a `Snapshot missed` row rather than as
	// a bar. This entry exists because the fixture that wears the trinket arrived after the sweep did.
	'wushoolays-lightning-stacks': "the same trinket's counter; the window beside it is the row",
};

/**
 * Every raw pull this spec has committed, discovered rather than listed.
 *
 * **This was `['phased', 'unbroken', 'cleave']`, and that literal is the reason this file needs a note
 * about itself.** The whole subject here is a guard that passed while unable to see the row it was
 * checking; a hardcoded fixture list is the same defect one level up, and it fired the same way. When
 * `addsThenBoss.json` was committed nothing in this file looked at it, so `wushoolays-lightning` — worn
 * on that pull and on none of the other three — fired 13 times and was drawn nowhere, with every
 * assertion below green. `lib/analysis/fixtures.ts` argues discovery over a shared literal for exactly
 * this reason and the Windwalker's copy of this file already used it.
 *
 * Read once at module level, like that copy: `rawFixtures` re-parses the directory on every call and one
 * of these files is 4.4MB.
 */
const RAW = rawFixtures('elemental');
const FIXTURES = RAW.map(({ name }) => name.replace(/\.json$/, ''));

/** The three that pre-pull the Fire Elemental, which is the half `addsThenBoss` is the control for. */
const PREPULLED = ['phased', 'unbroken', 'cleave'] as const;

const load = (name: string): FightDataset => {
	const found = RAW.find((fixture) => fixture.name === `${name}.json`);
	if (found === undefined) throw new Error(`no raw fixture elemental/${name}.json`);
	return found.dataset;
};

/**
 * Every declared aura the pull moved, by key, with how many events say so — **both halves**.
 *
 * The auras the log put on the player, plus the auras the player put on an enemy. The second half is the
 * change this file had been asking for in prose: `aurasPutOnPlayer` scopes to `targetID === actor.id`, so
 * an enemy debuff was not merely absent from the sweep but unreachable by it, and `essence-of-yulon` went
 * missing for exactly that reason — 18, 16, 13 and 40 applications on `phased`, `unbroken`, `cleave` and
 * `addsThenBoss`, drawn nowhere, with no guard in the family able to flag it and `staleExcuses` refusing
 * to let this ledger excuse it either.
 *
 * **The question stays "is this key drawn", and that is the decision rather than the default.** A debuff
 * is already drawn per enemy — several `AuraLane`s share one `key` and differ by `target` — so
 * `drawnLaneKeys` collapses them and a debuff on an add nobody selected cannot demand a row of its own.
 * What is still caught is an aura drawn on *no* enemy anywhere, and if a spec ever debuffs only
 * off-chart adds the answer is a `NOT_LANES` entry saying so, not a lane.
 *
 * The enemy half is source-filtered, which matters for the counts as well as the list: a second shaman
 * with the tier set writes 144999 onto the same boss, and an unsourced reading would report their
 * applications as this player's.
 */
const firedOn = (dataset: FightDataset): Map<string, number> =>
	mergeCounts(aurasPutOnPlayer(dataset, registry), aurasPutOnEnemies(dataset, registry));

const drawnOn = (dataset: FightDataset): Set<string> => drawnLaneKeys(analyse(dataset) as Analysis);

describe('an aura that fired has somewhere to be drawn', () => {
	it.each(FIXTURES)('%s draws or accounts for everything the player was given', (name) => {
		const dataset = load(name);
		const fired = firedOn(dataset);
		// Not vacuous: these pulls really do buff the player with a dozen declared auras or more.
		expect(fired.size).toBeGreaterThan(10);

		expect(undrawnAuras(fired, drawnOn(dataset), NOT_LANES)).toEqual([]);
	});

	it('counts removals, because two of these auras have no application on the pull at all', () => {
		// **The blind spot this guard used to share with the bug it guards against.** Sweeping applications
		// and refreshes only, it could not see an aura the player took before the pull — and on this spec
		// that is not a hypothetical. The Fire Elemental is pre-pulled on **three of the four** fixtures:
		// its only event there is a single `removebuff` of 118291 when the summon expires just short of a
		// minute in, with no `applybuff` anywhere, so the narrow reading missed the spec's own signature
		// cooldown on every committed pull it had. `unbroken`'s Jade Serpent Potion is the same shape — and
		// it is the sharper case, because the other two pulls drink a second one later and the narrow sweep
		// saw the key *there*, so this was a hole that closed and reopened depending on the pull.
		//
		// **`addsThenBoss` is why "all three" is now "three of the four", and it is the control rather than
		// an exception.** That shaman does not pre-pull: the summon goes out at 173 290ms and again at
		// 479 923ms, so its `fire-elemental` stream carries real `applybuff`s and the narrow reading would
		// have found the key there. The hole was invisible for three pulls precisely because every pull we
		// held pressed the button before the pull, which is the shape of accident this whole file is about.
		//
		// Both are drawn — the engine recovers them with `auraWindows`' `openAtPull`, which is what the
		// `preexisting` flag on the window records — so the widening added no orphan here. That is the
		// finding rather than a let-off: an apply-only guard was passing on three pulls while unable to see
		// the row it was supposed to be checking, and would have gone on passing if the row disappeared.
		const NARROW = ['applied', 'refreshed', 'stacked'] as const;
		const removalOnly: Record<string, readonly string[]> = {
			'fire-elemental': PREPULLED,
			'jade-serpent-potion': ['unbroken'],
		};

		for (const [key, pulls] of Object.entries(removalOnly)) {
			const ids = new Set(registry.aura(key).ids);
			for (const name of pulls) {
				const dataset = load(name);
				// One bare removal and nothing else — no application, no refresh, no stack event.
				const events = selfAuraEvents(dataset).filter((e) => ids.has(e.abilityGameID ?? -1));
				expect(
					events.map((e) => e.type),
					`${name} ${key}`,
				).toEqual(['removebuff']);

				// The narrow reading does not have the key at all; the wide one does.
				expect(aurasPutOnPlayer(dataset, registry, NARROW).has(key), `${name} ${key} narrow`).toBe(false);
				expect(firedOn(dataset).get(key), `${name} ${key} wide`).toBe(1);

				// And it is drawn, as a window opened at the pull rather than at an application.
				const lane = analyse(dataset).timeline?.lanes.find((l) => l.key === key);
				expect(lane?.windows.length, `${name} ${key} lane`).toBe(1);
				expect(lane?.windows[0]?.start).toBe(0);
				expect(lane?.windows[0]?.preexisting).toBe(true);
			}
		}
	});

	it('draws the two trinkets that were missing, on every pull that procced them', () => {
		// Named rather than left to the sweep above, because these two are the report: a reader saw them in
		// their own log and could not find them here. `expanded-mind` is Purified Bindings of Immerseus and
		// `toxic-power` is Kardris' Toxic Totem.
		//
		// **Three pulls and not four, and the assertion says which way round that is.** `addsThenBoss`'
		// shaman wears Throne of Thunder trinkets — Wushoolay's Final Choice and Breath of the Hydra —
		// so neither of these procs there at all, and the pull is asserted to proc *zero* of them rather
		// than skipped. That keeps the test two-sided: a re-capture that put these trinkets on that
		// player, or a filter that started attributing another raider's procs to them, both go red here.
		let procced = 0;
		for (const name of FIXTURES) {
			const dataset = load(name);
			const fired = firedOn(dataset);
			const drawn = drawnOn(dataset);
			for (const key of ['expanded-mind', 'toxic-power'] as const) {
				const count = fired.get(key) ?? 0;
				if (name === 'addsThenBoss') {
					expect(count, `${name} wears neither trinket, so ${key} cannot fire`).toBe(0);
					continue;
				}
				expect(count, `${name} should proc ${key}`).toBeGreaterThan(0);
				expect(drawn.has(key), `${name} should draw ${key}`).toBe(true);
				procced++;
			}
		}
		// Not vacuous in the direction that matters: six pull/key pairs really were checked.
		expect(procced).toBe(6);
	});

	it('gives the haste racials and Bloodlust rows of their own, not just the wash', () => {
		// These were excused as "drawn as the haste band" and that was wrong. The band is one full-height
		// shade behind everything: it cannot say which of the two was up, cannot be hovered for a duration,
		// and does not exist for a buff that is not haste. Both are kept — the wash is the region, the row
		// is the aura — so this asserts the row, which is the half that was missing.
		for (const name of FIXTURES) {
			const dataset = load(name);
			const fired = firedOn(dataset);
			const drawn = drawnOn(dataset);
			for (const key of ['bloodlust', 'berserking'] as const) {
				// Not every pull brings a troll, so this asserts the pairing rather than the presence.
				if ((fired.get(key) ?? 0) === 0) continue;
				expect(drawn.has(key), `${name} should draw ${key}`).toBe(true);
			}
			// Every pull has a raid haste cooldown of some kind, so the loop above is never a no-op.
			expect(fired.get('bloodlust') ?? 0).toBeGreaterThan(0);
		}
	});

	it('declares Blood Fury with a lane, though no fixture exercises it', () => {
		// **Stated rather than asserted as drawn.** Blood Fury is an orc racial and none of the four
		// fixture players is an orc, so `windows.length > 0` drops the lane and there is nothing to see. It
		// is the case with the strongest claim of the group all the same: it grants spell power, so it was
		// not in the haste wash either and had no representation anywhere in the report.
		//
		// What can be checked without a fixture is that the id is declared and reachable, which is what the
		// lane needs to work the first time an orc is analysed.
		expect(registry.aura('blood-fury').ids).toContain(33_697);
		for (const name of FIXTURES) expect(firedOn(load(name)).get('blood-fury') ?? 0).toBe(0);
	});

	/**
	 * **The class of aura this guard could not see, and the assertions that close it.**
	 *
	 * `essence-of-yulon` (146198) is the caster legendary cloak's proc, and it fires on every committed
	 * pull — 18, 16, 13 and 40 `applydebuff` on `phased`, `unbroken`, `cleave` and `addsThenBoss`, pinned
	 * for the first three in `lib/game/__tests__/sharedFixtures.test.ts`. For a
	 * long stretch it had no row and no entry above, and that was not an oversight anybody could have
	 * caught here: the proc lands on the **enemy**, and every reading in this file walked
	 * `aurasPutOnPlayer`. An enemy debuff was not merely absent from the sweep, it was *unreachable* by it.
	 * The undeclared-id ledger had the identical hole for the identical reason, so two of the three guards
	 * in the family were blind to the whole class and only `analysis/__tests__/fixtureCoverage.test.ts`,
	 * which reads every id in the file with no scope at all, could see one.
	 *
	 * **And this ledger had no slot for it either, which was the part worth proving.** The obvious repair
	 * for a firing-but-undrawn aura is a `NOT_LANES` entry with a reason, and that was not available:
	 * `staleExcuses` fails any entry whose key fires on no pull's sweep, and this key fired on none of
	 * them, so writing the reason down would have broken the guard that keeps reasons honest.
	 *
	 * What closes it is `aurasPutOnEnemies`, half of `firedOn` above. The three claims below are the three
	 * halves of that: the sweep now has the key, the *player-scoped* half still does not — which is what
	 * says the new half is doing the work rather than something else having changed — and the dead end has
	 * turned into the ordinary failure. An entry for this key is no longer rejected as stale; it is
	 * rejected as **redundant**, because the aura is drawn, which is the same answer this ledger gives for
	 * any other drawn key and the one a reader can act on.
	 */
	it('sees the enemy debuff its player-scoped half cannot, and can now judge a ledger entry for it', () => {
		for (const name of FIXTURES) {
			const dataset = load(name);
			// Fires, plainly: the player's own applications of 146198 on whatever they were hitting.
			const applies = dataset.events.filter(
				(e) => e.abilityGameID === 146_198 && e.type === 'applydebuff' && e.sourceID === dataset.actor.id,
			);
			expect(applies.length, `${name} applies`).toBeGreaterThan(10);
			// Reachable now, and reachable *only* through the enemy half — the player-scoped sweep this file
			// used to be is still blind to it, which is what makes the widening the cause.
			expect(firedOn(dataset).has('essence-of-yulon'), `${name} sweep`).toBe(true);
			expect(aurasPutOnPlayer(dataset, registry).has('essence-of-yulon'), `${name} self half`).toBe(false);
			// Every kind of evidence, so more than the applications: 39, 37, 26 and 83 events against 18, 16,
			// 13 and 40 applications on `phased`, `unbroken`, `cleave` and `addsThenBoss`.
			expect(aurasPutOnEnemies(dataset, registry).get('essence-of-yulon') ?? 0, `${name} enemy half`).toBeGreaterThan(
				applies.length,
			);
			// And drawn, which is why it needs no entry above.
			expect(drawnOn(dataset).has('essence-of-yulon'), `${name} lane`).toBe(true);
		}

		// The dead end is gone, demonstrated on a copy of the ledger rather than described: an entry for this
		// key used to be rejected as stale by the check that keeps `NOT_LANES` from rotting, which left no
		// way to write the reason down at all. It is now rejected as redundant instead — the ordinary answer
		// for a key that is drawn, and one that names what to do.
		const withEntry = { ...NOT_LANES, 'essence-of-yulon': 'an enemy debuff, so this sweep cannot see it' };
		expect(
			staleExcuses(
				withEntry,
				FIXTURES.map((name) => firedOn(load(name))),
			),
		).toEqual([]);
		expect(redundantExcuses(withEntry, drawnOn(load('phased')))).toEqual(['essence-of-yulon']);
	});

	/**
	 * The enemy half is non-empty on every pull, pinned as keys rather than as a size.
	 *
	 * **A guard that sweeps nothing passes**, and the total in the first test cannot tell the halves
	 * apart: a target filter that stopped matching, or an `actors` list that lost its `type` field and
	 * took every target into the friendly set, would drop this half to nothing and leave every other
	 * assertion in the file green. The keys are the point — 8050, 144999 and 146198, all declared and all
	 * drawn. `enemyAuraEvents` is asserted beside them so the reading is pinned as events too: a sweep can
	 * only be as wide as the stream behind it.
	 *
	 * **`addsThenBoss` has two of the three and not all three, which is a fact about its gear.** This
	 * asserted a flat three-key list until that pull arrived: its shaman has no T16 two-piece — no `setID`
	 * on the capture *and* no window of 144999 anywhere — so `t16-2pc-debuff` cannot appear, and the row
	 * count in `pulls.test.ts` (8, 5, 8 and 0) says the same thing from the other side. Written as a set
	 * per pull rather than as a subset check, so a key going missing on a pull that should have it is
	 * still a failure.
	 */
	it('reads the enemy half of every pull', () => {
		const expected: Record<string, string[]> = {
			addsThenBoss: ['essence-of-yulon', 'flame-shock'],
		};
		for (const name of FIXTURES) {
			const dataset = load(name);
			expect([...aurasPutOnEnemies(dataset, registry).keys()].sort(), name).toEqual(
				expected[name] ?? ['essence-of-yulon', 'flame-shock', 't16-2pc-debuff'],
			);
			expect(enemyAuraEvents(dataset).length, `${name} events`).toBeGreaterThan(50);
			// Nothing of somebody else's, which is the source filter rather than an accident of these pulls.
			expect(
				enemyAuraEvents(dataset).every((e) => e.sourceID === dataset.actor.id),
				`${name} sources`,
			).toBe(true);
		}
	});

	it('keeps the ledger honest — nothing excused that no longer fires, nothing excused that is drawn', () => {
		// A reason for an aura that stopped appearing is a reason nobody will ever check. Asserted across
		// all four pulls together, because a defensive is not pressed on every one — and
		// `wushoolays-lightning-stacks` fires on exactly one of them, which is what this check has to
		// tolerate and `redundantExcuses` below is what stops it from being tolerated too far.
		expect(
			staleExcuses(
				NOT_LANES,
				FIXTURES.map((name) => firedOn(load(name))),
			),
		).toEqual([]);

		// And the other direction, which is the one that bites here: `earth-elemental` is on this ledger
		// saying it has no row *yet*, and gaining one is the change most likely to be made next. An entry
		// that survives the lane it was excusing tells the next reader not to look, and nothing else in this
		// file notices — a drawn key satisfies the sweep, and a firing key satisfies the check above. So when
		// this fails naming `earth-elemental`, the lane landed and the entry above is what to delete.
		for (const name of FIXTURES) {
			expect(redundantExcuses(NOT_LANES, drawnOn(load(name))), `${name}`).toEqual([]);
		}
	});
});
