// What holds the reference table to the ladder, and the talent/equipment filters to their safe rules.
//
// The failure this file exists to catch is silent by construction: `Rotation.tsx` used to keep its
// own copy of the priority list with `// N` comments pointing at `apl.ts`, and nothing broke when the
// two disagreed — the page simply rendered a rung the audit above it had never modelled. Every
// assertion below is about that seam, or about the one rule that is allowed to remove a rung.

import { describe, expect, it } from 'vitest';

import i18n, { initI18n } from '~/lib/i18n/config';
import { LADDER_ENTRIES } from '~/lib/spec/apl';
import {
	CROSSOVERS,
	flowKeys,
	pressedButtons,
	rotationFlow,
	runeOfReOriginationEquipped,
	type FlowSlot,
} from '../rotationFlow';

initI18n();
const t = i18n.getFixedT('en', 'report');

const RUSHING_JADE_WIND = 116847;
const SPINNING_CRANE_KICK = 101546;
const INVOKE_XUEN = 123904;
const CHI_WAVE = 115098;
const ZEN_SPHERE = 124081;
const RISING_SUN_KICK = 107428;
const RUNE_OF_REORIGINATION = 96546;

/** Every button drawn, forks flattened — the question most of these tests are really asking. */
function ids(flow: readonly FlowSlot[]): number[] {
	return flow.flatMap((slot) => ('fork' in slot ? slot.branches.map((b) => b.id) : [slot.entry.id]));
}

function keys(flow: readonly FlowSlot[]): string[] {
	return flow.flatMap((slot) => ('fork' in slot ? slot.branches.map((b) => b.key) : [slot.entry.key]));
}

/** No evidence at all: the shape a fixture and a pre-counts report both arrive in. */
const nothing: ReadonlySet<number> = new Set();

describe('the reference flow against the ladder', () => {
	it('draws a rung for every rule the ladder models', () => {
		// The seam. `DISPLAY` is a `Record<AplRuleKey, …>` so the compiler already refuses a rule with no
		// rung, but nothing type-level stops a rung being filtered out of existence for every reader.
		const drawn = new Set(ids(rotationFlow({ band: null, pressed: nothing })));
		for (const entry of LADDER_ENTRIES) {
			expect(drawn.has(entry.id), `${entry.key} (${String(entry.id)}) is modelled but never drawn`).toBe(true);
		}
	});

	it('keeps the ladder in the ladder’s order', () => {
		// The rungs above the ladder are hand-written and come first; everything after them runs in the
		// sim's evaluation order, because "read down and press the first true thing" is the only
		// instruction this section gives and an order it does not have is an order it cannot give.
		//
		// Written out rather than derived, deliberately: a test that computed the expectation from the
		// same array the code walks would pass whatever that array said. This is the second reader.
		const flow = rotationFlow({ band: null, pressed: nothing });
		const rungs = flow.map((slot) => ('fork' in slot ? `fork:${slot.fork}` : slot.entry.key));
		expect(rungs).toEqual([
			'touchOfDeath', // 3
			'stormEarthAndFire', // 5
			'chiBrew', // 10
			'fork:tigereyeBrew', // 12, 13
			'energizingBrew', // 15
			'invokeXuen', // 16
			'rushingJadeWindMulti', // 17
			'fork:risingSunKick', // 18
			'tigerPalmRefresh', // 19
			'craneOverKick', // 20
			'risingSunKickMulti', // 21
			'spinningCraneKick', // 22
			'fork:talent', // 23, 26, 28, 30
			'comboBreakerKick', // 24
			'fistsOfFury', // 25
			'tigerPalmProc', // 27
			'jab', // 29
			'rushingJadeWind', // 31
			'fork:blackoutKick', // 32
		]);
		// Six rungs are hand-written above the ladder; the remaining thirteen are one per ladder rule.
		expect(rungs.length - 6).toBe(LADDER_ENTRIES.length);
	});

	it('has every drawn rung’s copy', () => {
		// A missing key renders as its own key path rather than throwing, and `keys.test.ts` cannot see
		// these — they are computed from the ladder, not literals in a component.
		for (const slot of rotationFlow({ band: null, pressed: nothing })) {
			const entries = 'fork' in slot ? slot.branches : [slot.entry];
			if ('fork' in slot) {
				for (const field of ['title', 'detail']) {
					const key = `rotation.fork.${slot.fork}.${field}`;
					expect(t(key), key).not.toBe(key);
				}
			}
			for (const entry of entries) {
				// `test` is the one-line condition the chart's node holds; `why` is the paragraph it discloses.
				// Both are required of every rung, because a node without its explanation is the one failure
				// mode the drawing could introduce that the old list could not.
				for (const field of ['name', 'test', 'why']) {
					const key = `rotation.entry.${entry.key}.${field}`;
					expect(t(key), key).not.toBe(key);
				}
				// A node label, not a paragraph. The whole design rests on this staying short: past about
				// sixty characters a box stops being a box at 390px and the chart is a column of cards again.
				expect(t(`rotation.entry.${entry.key}.test`).length, `${entry.key} test`).toBeLessThanOrEqual(64);
				if (entry.gated) {
					const key = `rotation.gate.${entry.key}`;
					expect(t(key), key).not.toBe(key);
				}
			}
		}
	});
});

describe('reading the flow at a target count', () => {
	it('drops the rungs the list only reaches above one target', () => {
		const single = ids(rotationFlow({ band: 1, pressed: nothing }));
		// Rushing Jade Wind's *opener* rung (17) and both Spinning Crane Kick rungs (20, 22) are gone; the
		// wind's own rung at the bottom (31) is not, because it exists at every count — its condition is
		// the pull's length and the energy bar, neither of which is a band.
		expect(single).not.toContain(SPINNING_CRANE_KICK);
		expect(single).toContain(RUSHING_JADE_WIND);
		expect(keys(rotationFlow({ band: 1, pressed: nothing }))).not.toContain('rushingJadeWindMulti');
		expect(keys(rotationFlow({ band: 1, pressed: nothing }))).not.toContain('stormEarthAndFire');
		// Entry 18 opens with `Targets: More than 1`, so both of its branches are gone at one enemy too.
		expect(keys(rotationFlow({ band: 1, pressed: nothing }))).not.toContain('risingSunKickCooldown');
		expect(keys(rotationFlow({ band: 1, pressed: nothing }))).not.toContain('risingSunKickHold');
	});

	it('draws Rising Sun Kick once at one target, on the unconditional rung', () => {
		// Still once, but it is now the *other* rung. Entry 18 acquired a leading `Targets: More than 1`
		// and no longer exists at one enemy, so the kick falls through to entry 21 — which the ladder has
		// to admit to band 1 for it to be drawn at all. Both halves matter and neither is safe alone: two
		// rungs would show the same kick twice with nothing to tell them apart, and zero would take a
		// baseline button off a single-target reader's list entirely.
		const single = ids(rotationFlow({ band: 1, pressed: nothing }));
		expect(single.filter((id) => id === RISING_SUN_KICK)).toHaveLength(1);
		expect(keys(rotationFlow({ band: 1, pressed: nothing }))).toContain('risingSunKickMulti');
	});

	it('drops the single-target half of a split rung when read as multi', () => {
		const multi = keys(rotationFlow({ band: 3, pressed: nothing }));
		expect(multi).toContain('blackoutKickDump');
		expect(multi).not.toContain('blackoutKick');
		expect(multi).toContain('risingSunKickHold');
		expect(multi).not.toContain('risingSunKickCooldown');
		// Entry 20's Crane Kick is a raw `targets >= 4`, and three is not four.
		expect(multi).not.toContain('craneOverKick');
	});

	it('shows every band when nothing has said which reading to use', () => {
		const all = keys(rotationFlow({ band: null, pressed: nothing }));
		expect(all).toContain('blackoutKick');
		expect(all).toContain('blackoutKickDump');
		expect(all).toContain('craneOverKick');
	});

	it('collapses a fork the band has already decided', () => {
		// "How much the dump has to leave behind" over a single answer reads as a bug.
		const decided = rotationFlow({ band: 1, pressed: nothing });
		expect(decided.some((s) => 'fork' in s && s.fork === 'blackoutKick')).toBe(false);
		expect(rotationFlow({ band: null, pressed: nothing }).some((s) => 'fork' in s && s.fork === 'blackoutKick')).toBe(
			true,
		);
	});

	it('drops a target-count chip once the count is fixed, and keeps the others', () => {
		const chipped = (band: 1 | 3 | null) =>
			rotationFlow({ band, pressed: nothing })
				.flatMap((s) => ('fork' in s ? s.branches : [s.entry]))
				.filter((e) => e.gated)
				.map((e) => e.key);
		expect(chipped(null)).toContain('spinningCraneKick');
		// The Rune of Re-Origination has nothing to do with how many enemies there are.
		expect(chipped(1)).toEqual(['tigereyeBrewRune', 'tigereyeBrewBank']);
	});
});

describe('the index of crossovers', () => {
	it('names a rung that exists, for every chip', () => {
		// The chips are the contents page for the chart, and the failure they can hide is a chip naming a
		// rung nobody renamed *it* alongside. Checked against the unfiltered flow, because that is the
		// only reading in which all four are guaranteed to be drawable.
		const all = new Set(flowKeys(rotationFlow({ band: null, pressed: nothing })));
		for (const { copy, key } of CROSSOVERS) {
			expect(all.has(key), `${copy} points at ${key}, which no rung has`).toBe(true);
			const label = `rotation.crossover.${copy}`;
			expect(t(label), label).not.toBe(label);
		}
	});

	it('knows which of its chips the reading has taken off the page', () => {
		// The bug this pairing exists to fix: read at three enemies, the `4+` chip named a rung entry 20
		// only reaches at four, and a reader following it found nothing. The section marks a chip whose
		// rung is not drawn; this asserts the two answers it has to tell apart.
		const drawnAt = (band: 1 | 3) => new Set(flowKeys(rotationFlow({ band, pressed: nothing })));
		const multi = drawnAt(3);
		expect(multi.has('craneOverKick')).toBe(false);
		expect(multi.has('spinningCraneKick')).toBe(true);
		expect(multi.has('rushingJadeWindMulti')).toBe(true);
		// At one enemy the pack has changed nothing yet, so all four chips are outside the reading.
		const single = drawnAt(1);
		for (const { key } of CROSSOVERS) expect(single.has(key), `${key} at one target`).toBe(false);
	});
});

describe('the talent filter', () => {
	it('never drops a button just because it was never pressed', () => {
		// The rule this section lives or dies by. A log with no presses at all is a log with no evidence,
		// and no evidence is not evidence of absence — it is the shape a player who forgot the button
		// arrives in, which is the reader this section exists for.
		expect(ids(rotationFlow({ band: null, pressed: nothing }))).toEqual(
			ids(rotationFlow({ band: null, pressed: new Set([RISING_SUN_KICK]) })),
		);
	});

	it('drops Spinning Crane Kick for a monk the log shows took Rushing Jade Wind', () => {
		// `registerSpinningCraneKick` returns early when the wind is talented, so this monk has no
		// Spinning Crane Kick on the bar at all — listing it would be a rung they cannot press.
		const flow = ids(rotationFlow({ band: null, pressed: new Set([RUSHING_JADE_WIND]) }));
		expect(flow).not.toContain(SPINNING_CRANE_KICK);
		expect(flow).toContain(RUSHING_JADE_WIND);
		// Same row as the wind, so one press settles the other way too.
		expect(flow).not.toContain(INVOKE_XUEN);
	});

	it('drops Rushing Jade Wind for a monk the log shows took Spinning Crane Kick', () => {
		// The converse, which the audit never needs and a reference does: one Spinning Crane Kick in the
		// log is proof the wind was not talented.
		const flow = ids(rotationFlow({ band: 3, pressed: new Set([SPINNING_CRANE_KICK]) }));
		expect(flow).not.toContain(RUSHING_JADE_WIND);
		expect(flow).toContain(SPINNING_CRANE_KICK);
	});

	it('settles the three-way row on one press and draws the survivor as a plain rung', () => {
		const flow = rotationFlow({ band: null, pressed: new Set([CHI_WAVE]) });
		expect(ids(flow)).toContain(CHI_WAVE);
		expect(ids(flow)).not.toContain(ZEN_SPHERE);
		expect(flow.some((s) => 'fork' in s && s.fork === 'talent')).toBe(false);
	});

	it('says nothing when the log contradicts itself', () => {
		// Two members of one row cannot both have been on a bar. A log that shows both is a log this rule
		// cannot read, and a coin toss between them would be worse than saying nothing.
		const flow = ids(rotationFlow({ band: null, pressed: new Set([CHI_WAVE, ZEN_SPHERE]) }));
		expect(flow).toContain(CHI_WAVE);
		expect(flow).toContain(ZEN_SPHERE);
	});

	it('never removes a baseline rotational button', () => {
		// The guarantee behind the rule, asserted against the ladder rather than against a list written
		// here: a button the ladder models, does not mark as a talent, and does not say is replaced by
		// something else, is baseline — and no evidence of any kind may take it off this page.
		const baseline = LADDER_ENTRIES.filter((e) => !e.talent && e.replacedBy === undefined).map((e) => e.id);
		expect(baseline).toContain(RISING_SUN_KICK);
		// Every button in the game pressed at once: the most evidence a log could possibly carry.
		const everything = new Set([
			...baseline,
			RUSHING_JADE_WIND,
			SPINNING_CRANE_KICK,
			INVOKE_XUEN,
			CHI_WAVE,
			ZEN_SPHERE,
		]);
		const drawn = new Set(ids(rotationFlow({ band: null, pressed: everything })));
		for (const id of baseline) expect(drawn.has(id), `baseline ${String(id)} was filtered out`).toBe(true);
	});
});

describe('the Rune filter', () => {
	it('keeps only the Rune branch when the gear shows the Rune equipped', () => {
		const flow = rotationFlow({ band: null, pressed: nothing, rune: true });
		expect(keys(flow)).toContain('tigereyeBrewRune');
		expect(keys(flow)).not.toContain('tigereyeBrewBank');
		expect(flow.some((s) => 'fork' in s && s.fork === 'tigereyeBrew')).toBe(false);
	});

	it('keeps only the bank branch when the gear shows no Rune', () => {
		const flow = rotationFlow({ band: null, pressed: nothing, rune: false });
		expect(keys(flow)).not.toContain('tigereyeBrewRune');
		expect(keys(flow)).toContain('tigereyeBrewBank');
		expect(flow.some((s) => 'fork' in s && s.fork === 'tigereyeBrew')).toBe(false);
	});

	it('keeps both branches when gear was not reported', () => {
		const flow = rotationFlow({ band: null, pressed: nothing, rune: null });
		expect(keys(flow)).toContain('tigereyeBrewRune');
		expect(keys(flow)).toContain('tigereyeBrewBank');
		expect(flow.some((s) => 'fork' in s && s.fork === 'tigereyeBrew')).toBe(true);
	});

	it('recognises the Rune item versions and preserves an unknown gear state', () => {
		expect(runeOfReOriginationEquipped([{ id: RUNE_OF_REORIGINATION }])).toBe(true);
		expect(runeOfReOriginationEquipped([{ id: 12345 }])).toBe(false);
		expect(runeOfReOriginationEquipped([])).toBeNull();
	});
});

describe('pressedButtons', () => {
	it('reads a press as evidence and a zero count as none', () => {
		const row = (id: number, count: number) => ({
			id,
			name: `#${id}`,
			count,
			onGcd: true,
			gate: 'other' as const,
			cpm: 0,
			cooldownSec: null,
			medianGapSec: 0,
			longestGapSec: 0,
			times: [],
		});
		const pressed = pressedButtons([row(RUSHING_JADE_WIND, 3), row(SPINNING_CRANE_KICK, 0)]);
		expect(pressed.has(RUSHING_JADE_WIND)).toBe(true);
		expect(pressed.has(SPINNING_CRANE_KICK)).toBe(false);
	});
});
