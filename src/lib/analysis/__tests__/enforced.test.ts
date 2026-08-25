// The rules a boss enforces, and the two things that must stay true of the table.
//
// The rules themselves were measured on two reference reports in the fork this came from, and those
// measurements cannot be re-run here — the reports are named logs and this repository captures from
// anonymous ones. What *can* be pinned is the shape: that the table says nothing about a boss it was
// not measured on, that a rule resolves to the windows the stream actually contains, and that two
// overlapping rules are not counted twice.
//
// Hand-built events rather than a fixture, and deliberately: no committed capture is a Protection
// pull, and the rules are about the encounter rather than about the spec, so a Windwalker fixture
// would only prove that the walk does not crash.

import { describe, expect, it } from 'vitest';

import { enforcedDowntime, enforcedProfile, phaseWindows, ENFORCED_PROFILES } from '../enforced';
import type { WclEvent } from '~/lib/types';
import type { FightPhase } from '~/lib/wcl/phases';

const T0 = 1_000_000;
const ACTOR = 7;

const aura = (type: string, id: number, atMs: number, targetID = ACTOR): WclEvent =>
	({ type, timestamp: T0 + atMs, sourceID: 99, targetID, abilityGameID: id }) as unknown as WclEvent;

const phase = (id: number, atMs: number): FightPhase => ({
	id,
	startTime: T0 + atMs,
	name: `Phase ${id}`,
	isIntermission: false,
});

const run = (events: WclEvent[], encounterID: number | undefined, phases: FightPhase[] = []) =>
	enforcedDowntime({
		encounterID,
		events,
		actorID: ACTOR,
		phases,
		t0: T0,
		endTime: T0 + 300_000,
		durationMs: 300_000,
	});

describe('what the fight enforced', () => {
	/**
	 * The default, and the one that matters most: a boss nobody measured is graded with no excuses.
	 *
	 * Silence has to mean "nothing known" rather than "nothing there". A stub profile with an empty
	 * rule list would read the same way to a caller and be a claim the table cannot support.
	 */
	it('knows nothing about a boss it was not measured on', () => {
		expect(enforcedProfile(1_000)).toBeNull();
		expect(enforcedProfile(undefined)).toBeNull();

		const nothing = run([aura('applydebuff', 144_396, 5_000)], 1_000);
		expect(nothing.profile).toBeNull();
		expect(nothing.rules).toEqual([]);
		expect(nothing.ms).toBe(0);
	});

	/**
	 * The Classic offset, which is the trap every per-encounter table in this repository shares.
	 *
	 * `1623`, `51623` and `101623` are all Garrosh, and a rule written against one has to hold for the
	 * other two. `baseEncounterID` is what does that, and this is the assertion that would catch it
	 * being dropped — a report from the classic re-release would otherwise match nothing at all.
	 */
	it('matches an encounter through the Classic re-registration offset', () => {
		const base = enforcedProfile(1_623);
		expect(base?.name).toBe('Garrosh Hellscream');
		expect(enforcedProfile(51_623)?.name).toBe('Garrosh Hellscream');
		expect(enforcedProfile(101_623)?.name).toBe('Garrosh Hellscream');
	});

	/** An aura on the player, opened and closed, is the window it says it is. */
	it('reads a player aura as the stretch it was up for', () => {
		const found = run([aura('applydebuff', 148_440, 60_000), aura('removedebuff', 148_440, 75_000)], 1_623);

		expect(found.rules).toHaveLength(1);
		expect(found.rules[0]?.rule.key).toBe('weak-minded');
		expect(found.rules[0]?.windows).toEqual([[60_000, 75_000]]);
		expect(found.ms).toBe(15_000);
	});

	/**
	 * The same aura on somebody else is not this player's excuse.
	 *
	 * The distinction the fork's own note is emphatic about: on Kor'kron Dark Shaman the boss casts
	 * Foul Geyser on the same cadence in both pulls and only one of the two tanks is taken away by it.
	 * A rule read off the boss's cast rather than the player's debuff would excuse both.
	 */
	it('excuses nothing for an aura that landed on another player', () => {
		const other = run([aura('applydebuff', 148_440, 60_000, 42), aura('removedebuff', 148_440, 75_000, 42)], 1_623);

		expect(other.rules).toHaveLength(1);
		expect(other.rules[0]?.windows).toEqual([]);
		expect(other.ms).toBe(0);
	});

	/**
	 * A rule that fired nowhere is kept rather than dropped, and the two are different reports.
	 *
	 * "This boss has a stun and it never landed on you" and "this boss has no stun" are not the same
	 * sentence, and a section that lists the encounter's rules has to be able to print the first.
	 */
	it('keeps a rule that never fired, with an empty window list', () => {
		const quiet = run([], 1_623);
		expect(quiet.profile?.name).toBe('Garrosh Hellscream');
		expect(quiet.rules.map((r) => r.rule.key)).toEqual(['weak-minded']);
		expect(quiet.rules[0]?.ms).toBe(0);
	});

	/** An aura still up at the end closes at the end, because the last window is often the question. */
	it('closes an aura that was still up when the pull ended', () => {
		const open = run([aura('applydebuff', 148_440, 290_000)], 1_623);
		expect(open.rules[0]?.windows).toEqual([[290_000, 300_000]]);
	});

	/**
	 * Two rules that overlap are one excuse, not two.
	 *
	 * Paragons is the encounter this is real on: Gene Splice opens within a second of a Shield Bash
	 * ending in both reference pulls. Counting the overlap twice would credit the same second to two
	 * excuses in every total built on `ms`.
	 */
	it('counts an overlap between two rules once', () => {
		const both = run(
			[
				aura('applydebuff', 143_974, 10_000),
				aura('removedebuff', 143_974, 16_000),
				aura('applybuff', 143_373, 14_000),
				aura('removebuff', 143_373, 44_000),
			],
			1_593,
		);

		// Each rule keeps its own windows — the section lists them separately.
		expect(both.rules.find((r) => r.rule.key === 'shield-bash')?.ms).toBe(6_000);
		expect(both.rules.find((r) => r.rule.key === 'gene-splice')?.ms).toBe(30_000);
		// The union is 10s to 44s, not 36s of rules added together.
		expect(both.windows).toEqual([[10_000, 44_000]]);
		expect(both.ms).toBe(34_000);
	});

	/**
	 * The phase branch, tested directly because no rule reaches it any more.
	 *
	 * Thok's Frenzy for Blood was the table's only `phase` rule and the press stream contradicted it, so
	 * it is gone — and these two assertions went with it, which would have left a live branch of
	 * `enforcedDowntime` with nothing exercising it. Keeping a rule the data refuses in order to keep a
	 * test green is the wrong way round, so `phaseWindows` is exported and tested for itself. The next
	 * phase rule inherits a mechanism that still works.
	 */
	it('reads a phase rule from the transitions the report carries', () => {
		expect(phaseWindows([phase(1, 0), phase(2, 40_000), phase(1, 105_000)], [2], T0, 300_000)).toEqual([
			[40_000, 105_000],
		]);
	});

	/** The last phase of a pull closes at the end of it rather than being dropped. */
	it('closes a phase that was still running at the kill', () => {
		expect(phaseWindows([phase(1, 0), phase(2, 250_000)], [2], T0, 300_000)).toEqual([[250_000, 300_000]]);
	});

	/** A phase the pull never reached covers nothing, which is how a rule stays silent on a short kill. */
	it('covers nothing for a phase the pull never entered', () => {
		expect(phaseWindows([phase(1, 0)], [2], T0, 300_000)).toEqual([]);
	});

	/**
	 * The table's own discipline, asserted rather than trusted.
	 *
	 * Every rule carries the evidence that put it there, and the two bases stay apart: a `lockout` was
	 * measured off the press stream and a `declared` is a judgement about a phase. A rule that lost its
	 * evidence line is a rule nobody can re-check, which is the state this whole file exists to avoid.
	 */
	it('carries evidence on every rule and a note on every empty encounter', () => {
		for (const profile of ENFORCED_PROFILES) {
			for (const rule of profile.rules) {
				expect(rule.evidence.length, `${profile.name} / ${rule.key}`).toBeGreaterThan(20);
				expect(['lockout', 'declared']).toContain(rule.basis);
				// An aura rule needs ids and a phase rule needs phase ids. Neither can resolve without them.
				if (rule.source === 'phase') expect(rule.phaseIds?.length, rule.key).toBeGreaterThan(0);
				else expect(rule.ids?.length, rule.key).toBeGreaterThan(0);
			}
		}
		// Four lockouts, and the count is worth pinning because of how few they are: the sweep that found
		// them took every aura the player carried over 1.5s more than once — fifty-two of them — and three
		// passed. Gene Splice is the fourth and was found by another route entirely, which is the whole
		// reason `player-buff` exists as a source.
		// **Every rule left in the table is a `lockout`.** Both `declared` ones were removed when a full
		// clear contradicted them: Foul Geyser's windows hold a *higher* press rate than the pull around
		// them, and Thok's phase 2 holds 84% of the player's own baseline against the 45% it was written
		// from. What survives is the half that was measured rather than judged, which is worth noticing
		// before anybody adds a `declared` rule again.
		expect(ENFORCED_PROFILES.flatMap((p) => p.rules).every((r) => r.basis === 'lockout')).toBe(true);

		const lockouts = ENFORCED_PROFILES.flatMap((p) => p.rules).filter((r) => r.basis === 'lockout');
		expect(lockouts.map((r) => r.key).sort()).toEqual([
			'gene-splice',
			'shield-bash',
			'vengeful-strikes',
			'weak-minded',
		]);
	});
});
