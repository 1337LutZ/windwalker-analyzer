// Which graded sentences a committed pull has ever actually shown a reader — measured, and pinned.
//
// **Why this exists.** `keys.test.ts` holds `VERDICT_ARMS`, an explicit registry of every arm of every
// graded sentence, and it is a strong guard in the two directions it points: every stored arm is reached
// by *some* route in the source, and every grade a section can be handed has an arm stored for it.
// Neither of those is the question a reader's defect asks. A copy defect is a sentence that is wrong at
// the values it is rendered with, and the only thing that can see one is a render. Every copy defect
// found in this report to date — *"Earth Shock was never cast in this pull"* over a table of shocks,
// *"1 of 2 catchable procs taken (0%)"*, *"No proc window was offered in this pull"* above six listed
// windows — was in a sentence some fixture reached. That is not a coincidence about which sentences are
// bad; it is a fact about which sentences anyone has read.
//
// So the useful number is the complement: the arms **no committed pull renders**, which is the set
// nobody has ever read on a page. This file measures it and pins it.
//
// **A pinned set rather than a count, and rather than a floor.** A count in a comment rots — this
// project has watched one drift three times inside a day — and a floor ("at least 39 arms are reached")
// passes a fixture that goes missing as long as another arrives. The set moves visibly in both
// directions instead: commit a fixture that reaches a new arm and its name leaves the list; add an arm
// nothing renders and its name joins. Either way the diff names the sentence.
//
// **What the list is not.** It is not a list of untested sentences. Most of these are rendered by a
// hand-built audit somewhere under a `__tests__` directory — the whole `mana` family by `mana.test.ts`,
// the `flameShock` `_full` arms by `flameShock.test.ts`, the thin-sample arms by the two
// `thin*Sample.test.ts` files. Measured against the entire suite rather than against the fixtures, only
// a handful of arms had never been rendered by anything at all, and those are the ones
// `specs/elemental/components/sections/__tests__/unreadArms.test.ts` was written for. What being on this
// list means is narrower and still worth knowing: **no pull a reader can open reaches this sentence**, so
// whatever is true of it is true only of a state some test constructed by hand.
//
// Three kinds of entry are in here, and the distinction is the point of reading it:
//
//   - **Structurally unreachable.** The section can never be handed the grade the arm hangs off.
//     `karma.verdict_none` is byte-identical to `karma.none` and exists only because the arm test
//     requires the stem; the shield's plain arm was in that state until `LightningShield.tsx` began
//     reaching it by name. `lightningShield.verdict_ok_other` is the live one: the drop count is the
//     plural's `count`, nought takes the `_zero` arm, one takes the `_one` arm, and two or more grades
//     the metric `bad` — so the `ok` plural has no count left to be given.
//   - **Merely unfixtured.** True, correct, and waiting for a pull with the shape. Every `_full` Flame
//     Shock arm, the totem's overlap arms, the shield's second drop.
//   - **Never read by anyone, which is where the defects were.** `mana`'s un-narrowed plurals were on
//     this list and had never been rendered by any test either; at their only reachable count they
//     faulted a player for a press they had not passed over. See `unreadArms.test.ts`.
//
// **The instrument.** i18next resolves a graded sentence by trying the context- and plural-suffixed keys
// in order and keeping the one that hit, and it reports that key back as `exactUsedKey`. Nothing else in
// the render can tell you which arm was chosen — the rendered text has had its interpolations filled in,
// and two arms of the same section routinely differ by one clause. So `Translator.resolve` is wrapped
// for the length of the sweep. That is a reach into a dependency's internals, and it is guarded rather
// than trusted: `it('records the arm i18next actually chose')` resolves a key whose arm is known and
// fails if the wrapper saw anything else, so the day i18next stops reporting the suffixed key this file
// says so instead of quietly reporting every arm as unreached.
//
// **Anti-vacuity, which is the same trap `specVocabulary.test.ts` names.** A report that rendered to
// nothing would reach no arms and make this list as long as the registry. So the sweep asserts that each
// pull rendered a real page and that the reached set is a substantial part of the registry, before the
// list means anything.
//
// **Discovery is `lib/analysis/fixtures.ts`'s**, not a second walk of the same two directories. That
// module already classifies both committed shapes — the Elemental's raw `FightDataset`s and the
// Windwalker's captured `Analysis` objects — throws on a `.json` that is neither and on a directory with
// no `.json` at all, and its own header explains why a listed set of fixture names is the wrong thing to
// hold. A fixture added under this test joins the sweep by the fact of being committed.
//
// `createElement` rather than JSX so this stays a `.ts` file and is picked up by the project's own
// vitest include patterns.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { capturedAnalyses, rawFixtures } from '~/lib/analysis/fixtures';
import { SPECS, type SpecDefinition } from '~/lib/spec';
import type { Analysis } from '~/lib/types';
import type { TargetModeChoice } from '~/lib/view/targetMode';

import Report from '~/components/Report';

import i18n, { initI18n } from '../config';

initI18n();

/**
 * Every reading a reader can put the report into, because a branch only one of them draws is still copy.
 *
 * Four since the vocabulary widened. `'multi'` is deliberately not among them — no control offers it,
 * so a sentence only it can reach is a sentence no reader can be shown. Every pull is asked for all
 * four whether or not its own menu offers them: this is a sweep for copy, and a branch that is
 * unreachable on one pull and reachable on the next still has to be written.
 */
const READINGS: TargetModeChoice[] = ['auto', 'single', 'cleave', 'aoe'];

/**
 * Every pull a spec has committed, analysed if it needs analysing, named by its file.
 *
 * Both shapes, because both are committed and a third spec will pick whichever suits it. The names are
 * carried so a failure can say which pull rendered nothing rather than only that one did.
 */
const pullsOf = (spec: SpecDefinition): [string, Analysis][] => [
	...rawFixtures(spec.key).map(({ name, dataset }): [string, Analysis] => [name, spec.analyse(dataset)]),
	...capturedAnalyses(spec.key).map(({ name, analysis }): [string, Analysis] => [name, analysis]),
];

/** Every arm of every graded sentence the locale file stores — the denominator, off the file itself. */
const storedArms = (): string[] => {
	const bundle = i18n.getResourceBundle('en', 'report') as Record<string, unknown>;
	const arms: string[] = [];
	for (const [section, node] of Object.entries(bundle)) {
		if (typeof node !== 'object' || node === null) continue;
		for (const key of Object.keys(node as Record<string, unknown>)) {
			if (key === 'verdict' || key.startsWith('verdict_')) arms.push(`${section}.${key}`);
		}
	}
	return arms.sort();
};

interface Resolution {
	exactUsedKey?: string;
	usedNS?: string;
	res?: unknown;
}

/**
 * Runs `sweep` with the translator reporting every arm it resolves, and puts it back afterwards.
 *
 * Restored in a `finally` because this module is one vitest file and the tests below share the
 * translator with each other — a wrapper left in place would make the self-test's own resolution part of
 * the sweep's evidence.
 */
function recording(sweep: () => void): Set<string> {
	const seen = new Set<string>();
	const translator = (i18n as unknown as { translator: { resolve: (...args: unknown[]) => unknown } }).translator;
	const original = translator.resolve.bind(translator);
	translator.resolve = (...args: unknown[]) => {
		const resolved = original(...args) as Resolution;
		// `res !== undefined` is what makes `exactUsedKey` the key that *answered* rather than the last one
		// tried: i18next assigns it on every attempt and only the successful attempt leaves a value behind.
		if (resolved?.exactUsedKey !== undefined && resolved.res !== undefined && resolved.usedNS === 'report') {
			seen.add(resolved.exactUsedKey);
		}
		return resolved;
	};
	try {
		sweep();
	} finally {
		translator.resolve = original;
	}
	return seen;
}

const rendered = (): { text: Map<string, string>; arms: Set<string> } => {
	const text = new Map<string, string>();
	const arms = recording(() => {
		for (const spec of SPECS) {
			for (const [name, analysis] of pullsOf(spec)) {
				let all = '';
				for (const targetChoice of READINGS) {
					all += renderToStaticMarkup(createElement(Report, { analysis, targetChoice, spec }));
				}
				text.set(`${spec.key}/${name}`, all);
			}
		}
	});
	return { text, arms };
};

const SWEEP = rendered();

/**
 * The arms no committed pull reaches, as they stand.
 *
 * Sorted, so the diff on a change is one line rather than a reordering. Every name here is asserted to
 * be a real stored arm below, which is what stops this decaying into a list of typos: an arm renamed in
 * the locale file leaves this list stale in both directions and both are reds.
 */
const UNREACHED: string[] = [
	// **Both `flameShock.verdict_goodSome` arms were here and have been read.** They arrived with the
	// reader's third position: at Cleave the Elemental's banded Flame Shock rules leave only the refresh
	// waste to grade, so a pull whose dot never dropped and whose refreshes clipped a few ticks lands on
	// `good` with something still to say. `phased` reaches the plain arm at that reading and `unbroken`
	// the `_full` one, and both say the right thing — *"the dot is not what is holding this pull back …
	// hold Flame Shock until the dot's last tick and that goes too"* is exactly the sentence a good
	// keep-up with clipped refreshes has earned.
	//
	// **What no reader sees on these two pulls is the reading itself**, and that is the derived menu
	// working rather than a hole in this sweep. Neither pull ever exceeds one enemy, so
	// `targetModeChoices` offers them the whole fight and Single Target and nothing else. The sweep asks
	// every pull for all four readings on purpose — a branch unreachable on one pull and reachable on the
	// next still has to be written — so an arm leaving this list means the copy exists and reads, not
	// that a button exists to reach it here.
	//
	// **`brew.verdict_bad_other` is back, and the reason is a threshold rather than a fixture.**
	// `idle.json` was its one reader — four brews spent averaging exactly 8.0 of 10, with `brewStacks`
	// grading `bad` and `brewShortUses` too thin a sample to grade. `brewStacks` moved to `good: 9`
	// on the user's ruling that nine stacks is a full brew's worth, and `ok` moved to 8 with it to hold
	// the band a stable mean needs (see `score.ts`). A mean of exactly 8.0 now lands on the `ok` line
	// rather than under it, so the arm has no pull behind it again.
	//
	// Worth stating plainly rather than filing: the sentence is not wrong, it is unreached. What it
	// needs is a committed pull averaging under 8, which none of the ten has — the worst is `idle` at
	// exactly the line. The paragraphs below are what it said while it was read, kept because they are
	// the evidence that the arm says the right thing when a pull does reach it.
	//
	// While it was read: a reader saw *"4 brews spent, averaging only 8 of 10 stacks."* and nothing else
	// about the presses.
	//
	// Read, and it says the right thing, which is not something the arm's own neighbours could take for
	// granted: `BrewBankTimeline.tsx` carries two long comments about this exact sentence going out over
	// the wrong number. It used to be selected by the section's *letter*, which is the worst of three
	// metrics — so "averaging only 10 of 10 stacks" was reachable, and `verdict_bad_other` was the arm it
	// came out of. `meanGrade` fixed that by keying the fall-through on `brewStacks`' own line, and this
	// pull is the first committed evidence that the fix lands: the mean really is the fault here, 8.0
	// against a cap of 10 over four presses, and the "only" is earned. The clause that would have named
	// the short presses instead is silent because it *cannot* be read at this sample size, which is the
	// state `faulted === null` exists for.
	'brew.verdict_bad_other',
	'brew.verdict_good_one',
	'brew.verdict_good_other',
	'brew.verdict_none',
	// The arm that replaced the singular `ok` and `bad` ones, both of which left this list by being
	// retired rather than by being reached. It joins for the same reason they were on it: every committed
	// Windwalker pull spends at least three brews, so no page a reader can open shows a single-brew
	// sentence at all. The three single-brew states are read by hand in `brewBankTimeline.test.ts`.
	'brew.verdict_oneShort',
	// **`casts.verdict_none` is back on this list, and the round trip is the point.** `gcdUtilisation` is
	// no longer graded against one fixed pair per spec: it resolves against the encounter's own p90 and
	// p50 from `src/generated/reference.json`, and three Siege fights — Immerseus, Galakras, Norushen —
	// are *suppressed* in that profile because they take the player out of reach by design (median
	// contact share 77.7 / 82.7 / 85.0% against 94% or better on the other eleven).
	//
	// That briefly put `verdict_none` on the page for the first time, on four committed pulls, and this
	// list is what surfaced it — which is the whole reason the list exists. **The sentence was wrong at
	// the values it rendered with.** It reads *"Too few globals passed to measure a rate."*, true of the
	// only state that could reach it before; `windwalker/idle` offers 130 global slots, fills 106, and the
	// figure being withheld is 69.53%. The cause is the *denominator*, not the sample.
	//
	// So the section gained `casts.verdict_suppressed`, which says that, and the four pulls take it
	// instead. `verdict_none` returns here: still real, still the right sentence for a pull with almost no
	// room in it, and still unreachable on anything committed.
	'casts.verdict_none',
	'debuff.verdict_noContact',
	'debuff.verdict_none',
	// `earthShock.verdict_good` and `verdict_ok` have left this list, and the reason is a defect rather
	// than a threshold: the tier-16 remaining check measured to the end of a *merged* Elemental Discharge
	// window — `auraWindows` does not split on a refresh — so shocks a player had held correctly were
	// charged as if the whole window were still ahead of them, and every committed pull read `bad`. Two
	// sentences that had never been rendered by a real log are rendered by three of the four now.
	'earthShock.verdict_none',
	'earthShock.verdict_tooFew',
	'flameShock.verdict_good',
	'flameShock.verdict_good_full',
	'flameShock.verdict_none',
	'flameShock.verdict_ok_full',
	'karma.verdict_bad',
	'karma.verdict_none',
	'lightningShield.verdict_bad_noOvercap',
	// **`verdict_bad_one` joined this list and `verdict_ok_one` left it when the exemption moved onto the
	// segmentation.** `cleave` is the one committed pull that drops its shield, and its overcap fell from
	// 21 864ms to 14 275ms once the clock stopped running through the stretches the pull was fought as
	// AoE — under the 15 000ms `ok` line, so the sentence it renders is the `ok` arm of the same pair.
	// `verdict_ok_zero` went the other way for the same reason: the pulls that never drop the shield now
	// read `good` on the overcap rather than `ok`, so nothing renders the zero-drop `ok` arm.
	'lightningShield.verdict_bad_one',
	'lightningShield.verdict_bad_other',
	'lightningShield.verdict_none',
	'lightningShield.verdict_ok_other',
	'lightningShield.verdict_ok_zero',
	'mana.verdict_bad_noRage',
	'mana.verdict_bad_noThunderstorm',
	'mana.verdict_bad_one',
	'mana.verdict_bad_other',
	'mana.verdict_bad_zero',
	'mana.verdict_good',
	'mana.verdict_good_noRage',
	'mana.verdict_good_noThunderstorm',
	'mana.verdict_none',
	'mana.verdict_ok_noRage',
	'mana.verdict_ok_one',
	'mana.verdict_ok_other',
	'mana.verdict_ok_zero',
	'searingTotem.verdict_bad_noUptime',
	'searingTotem.verdict_bad_one',
	'searingTotem.verdict_bad_other',
	'searingTotem.verdict_good_other',
	'searingTotem.verdict_good_zero',
	'searingTotem.verdict_ok_noUptime',
	'searingTotem.verdict_ok_one',
	'searingTotem.verdict_ok_other',
	'snapshots.verdict_none',
	'snapshots.verdict_tooFew',
	'tigerPalm.verdict_none',
];

describe('the graded sentences a committed pull actually renders', () => {
	/**
	 * The instrument, checked before anything is measured with it.
	 *
	 * `brew.verdict` at the `ok` grade and a count of two resolves to `brew.verdict_ok_other`, and that
	 * suffixed name is what has to come back — not the key that was asked for. If i18next ever stops
	 * reporting the arm it chose, every arm in the file reads as unreached and the list below becomes the
	 * whole registry; this is the assertion that says so in one line instead.
	 */
	it('records the arm i18next actually chose, and not the key it was asked for', () => {
		const seen = recording(() => {
			i18n.t('brew.verdict', { ns: 'report', context: 'ok', count: 2, avg: 8, cap: 10 });
		});
		expect([...seen]).toContain('brew.verdict_ok_other');
		expect([...seen]).not.toContain('brew.verdict');
	});

	/** Every spec in the registry has a pull, so a third spec cannot be silently left out of the sweep. */
	it.each(SPECS.map((spec) => [spec.key] as const))('%s has a pull to sweep', (key) => {
		expect(pullsOf(SPECS.find((spec) => spec.key === key)!).length).toBeGreaterThan(0);
	});

	/**
	 * The anti-vacuity half. A report that rendered to nothing reaches no arm and would make the list
	 * below as long as the registry, passing for exactly the wrong reason.
	 */
	it.each([...SWEEP.text.keys()].map((name) => [name] as const))('%s rendered a real report', (name) => {
		expect(SWEEP.text.get(name)!.length, `${name} rendered almost nothing`).toBeGreaterThan(10_000);
	});

	/** And that the instrument saw a substantial part of the file, not one arm off one section. */
	it('reaches a real share of the registry, across more than one section', () => {
		const arms = storedArms();
		const reached = arms.filter((arm) => SWEEP.arms.has(arm));
		expect(reached.length, 'graded arms reached by a committed pull').toBeGreaterThan(25);
		expect(new Set(reached.map((arm) => arm.split('.')[0])).size, 'sections reached').toBeGreaterThan(8);
	});

	/** Every pinned name is a real arm, so a rename cannot leave this list quietly describing nothing. */
	it('pins nothing the locale file does not store', () => {
		const stored = new Set(storedArms());
		const ghosts = UNREACHED.filter((arm) => !stored.has(arm));
		expect(ghosts, `pinned arms that no longer exist:\n${ghosts.join('\n')}`).toEqual([]);
	});

	/**
	 * And the list itself.
	 *
	 * Both directions in one assertion because both are news. A name that leaves it is a sentence a
	 * reader can now reach — read it, because nobody has. A name that joins it is a sentence that has
	 * just stopped being reachable, or one that arrived with no pull behind it.
	 */
	it('leaves exactly these graded sentences with no pull behind them', () => {
		const arms = storedArms();
		const unreached = arms.filter((arm) => !SWEEP.arms.has(arm));
		const gained = unreached.filter((arm) => !UNREACHED.includes(arm));
		const lost = UNREACHED.filter((arm) => !unreached.includes(arm));
		expect(
			unreached,
			[
				'The set of graded sentences no committed pull renders has moved.',
				gained.length === 0 ? '' : `No longer reached by any pull:\n  ${gained.join('\n  ')}`,
				lost.length === 0 ? '' : `Now reached by a pull — read these, nobody has:\n  ${lost.join('\n  ')}`,
				'Update UNREACHED above once you have read what changed.',
			]
				.filter(Boolean)
				.join('\n'),
		).toEqual(UNREACHED);
	});
});
