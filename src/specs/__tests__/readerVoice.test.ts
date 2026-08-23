// The voice both specs' sections speak in, asserted rather than agreed to.
//
// This sweep was written for the Elemental sections and lived under them, which made it
// Elemental-only by construction: its section list named thirteen Elemental locale roots and nothing
// else, so **every Windwalker string in `report.json` was unswept**. That is not a hypothetical gap.
// The lane that widened the Elemental sweep to reach graded sentences had to hand-check its own new
// Tiger Palm and Brew copy, because the guard could not see either — and the hand-check missed
// `tigerPalm.verdict_none` and `tigerPalm.verdict_exempt`, both of which this file now catches.
//
// It lives here, above both specs, because its two inputs are shared: the vocabulary below is a
// project standard rather than an Elemental one, and the file it reads is the single
// `locales/en/report.json`. A previous lane declined to build a shared helper with one caller, and
// that objection is spent — there are two callers now, and the alternative was two copies of
// `MODEL_WORDS` in two trees, drifting, guarding a defect whose whole history is that it recurs.
//
// What did *not* move is the Elemental render assertions on the two strings the original complaint
// named. Those are about two Elemental components and belong beside them; see
// `specs/elemental/components/sections/__tests__/readerVoice.test.ts`.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Words that name the audit rather than the game. `clock` is here because "pressed on the clock alone"
 * is the original complaint verbatim; the fight timeline is legitimately called a clock elsewhere in
 * the file, which is why neither spec's sweep runs across all 1182 strings.
 *
 * One list for both specs, and it went three lanes without being extended, for a reason that has now
 * been spent: widening the *vocabulary* and widening the *coverage* are two changes, and doing both at
 * once would make it impossible to say which of them a red run came from. The coverage work is
 * finished — every root in the file is in a scope, and the closure test at the foot holds it there — so
 * `exempt` is the first word added since, on its own and with nothing else moving.
 *
 * **`exempt` catches nothing today, and that is stated rather than discovered.** It appears in no value
 * anywhere in `report.json` or `ui.json`, only in five key *names* — `tigerPalm.verdict_exempt` and
 * four Elemental siblings — which a reader never sees. So it is prophylactic, and the test at the foot
 * of this file pins that it fires on nothing so the next lane knows it is a guard against a sentence
 * not yet written rather than a fix for one already there. It belongs in the list because it is our
 * word for a decision the report made about a rule's scope, and the five keys are exactly the route by
 * which it would arrive in the copy under them.
 */
const MODEL_WORDS = [
	'clock',
	'exempt',
	'the list',
	'p5',
	'branch',
	'predicate',
	'verdict',
	'judg',
	'gate',
	'band',
	'satisfied',
	'rule',
	'condition',
	'graded',
	'the section',
	'on offer',
	'opportunit',
];

/**
 * ***`counted` is deliberately not on that list, and the measurement is why.***
 *
 * It looks like it belongs. It is the word the last two rewrites in this file reached for when they dropped
 * `graded`, which is vocabulary laundering — a model word wearing plainer clothes, and worse than the
 * original because it hides. An audit recommended banning it on the strength of a count.
 *
 * Measured before acting: **41 in-scope leaves use the exact word**, 63 across the whole `count*` family.
 * Read rather than counted, almost all of them are ordinary English and correct — *"not counted against
 * you"* is how a reader actually talks, and it appears in the Mana, energy, chi, snapshot, brew and
 * priority copy in that exact idiomatic sense. **Banning the word would have reddened forty strings to fix
 * five, and the fix for the other thirty-five would have been to make them worse.**
 *
 * The five that really were laundering are rewritten instead: three `aoeNote` leaves reading "Two enemies
 * is still counted" (now "At two enemies the figure still holds you to it"), the Lightning Shield legend
 * key reading "AoE — not counted" (now "AoE — left out"), and one "counted time" in the multi-dot note.
 * Four of the five were written earlier in the same session that banned `graded`, which is the whole
 * mechanism on display: **a sweep that bans a word teaches the next writer a synonym.**
 *
 * So the guard against laundering is not a longer list. It is that a replacement has to say what happens
 * to the reader's figure — left out, still holds you to it — rather than name what we did to it.
 */

/**
 * The reader sees the rendered sentence, not the template, so the template's own names are not copy.
 *
 * `{{active, clock}}` renders as `4:39` and `{{rule, duration}}` as `15s`: `clock` there is a
 * registered i18next formatter and `rule` is a variable the section passes in. Matching the raw value
 * flags nine strings that a reader could never see the word in — `casts.presses`, `energy.summary`,
 * `brew.chartLabel`, `priority.summary` and the four `sef` sentences among them — and a sweep whose
 * reds are mostly noise gets narrowed by the next person rather than obeyed. Nothing is lost by
 * stripping: no placeholder in any scope's in-scope copy carries a banned word anywhere but in a
 * formatter or variable name, and the test below pins that.
 */
const prose = (value: string): string => value.replaceAll(/\{\{[^}]*\}\}/g, ' ');

const REPORT = resolve(import.meta.dirname, '../../locales/en/report.json');
const UI = resolve(import.meta.dirname, '../../locales/en/ui.json');

/** Every leaf string in one locale file, as `['ascendance.state.plain', 'Pressed …']`. */
const leaves = (file: string): [string, string][] => {
	const locale = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
	const out: [string, string][] = [];
	const walk = (node: unknown, path: string[]) => {
		if (typeof node === 'string') out.push([path.join('.'), node]);
		else if (node && typeof node === 'object')
			for (const [key, value] of Object.entries(node)) walk(value, [...path, key]);
	};
	walk(locale, []);
	return out;
};

/**
 * `report.json`, and the name every scope in this file already reads it by.
 *
 * Kept at its old name and its old signature on purpose. The walk is now parameterised because the
 * vocabulary sweep at the foot of this file needs a second file, and a rename would have put fourteen
 * unrelated call sites into a commit whose whole claim is that it changed the *vocabulary* and nothing
 * else — the same one-change-at-a-time rule the `MODEL_WORDS` docstring above states.
 */
const localeStrings = (): [string, string][] => leaves(REPORT);

/**
 * `ui.json` — the shell copy, under the roots named in `UI_ROOTS`.
 *
 * Read from the start by the three lists at the foot of this file, because asking whether a shell
 * string sounds machine-written needs no scope and no exemption. `MODEL_WORDS` was the other half, and
 * it was scoped, exempted and closed against `report.json` alone — the docstring here used to claim in
 * passing that the shell copy names no part of the model, and nothing executed the claim. **The scope
 * below executes it**, on its own and with no copy moving, which is the same one-change-at-a-time rule
 * the `MODEL_WORDS` docstring states.
 */
const uiStrings = (): [string, string][] => leaves(UI);

/**
 * Matched at a **left** word boundary, not as a bare substring.
 *
 * Every entry above is either a whole word, a phrase, or a stem meant to catch its own inflections
 * (`judg` for judged/judgement, `opportunit` for opportunity/opportunities), so a match that starts
 * mid-word is never our vocabulary — it is an ordinary English word that happens to end in one of
 * ours. Across all 1182 leaves in the file the boundary drops **exactly two** strings, and both are
 * the same word: `lavaBurst.note`'s "the crit is unconditional" and
 * `rotation.fork.risingSunKick.detail`'s "its unconditional rung". Neither is a claim about our model.
 *
 * No boundary on the right, deliberately — the inflections are the point, and `rule` has to keep
 * catching "rules" and "ruled".
 */
const namesTheModel = (value: string): boolean => {
	const text = prose(value).toLowerCase();
	return MODEL_WORDS.some((word) => new RegExp(`\\b${word}`).test(text));
};

const violations = (strings: [string, string][]): string[] =>
	strings.filter(([, value]) => namesTheModel(value)).map(([key, value]) => `${key}: "${value}"`);

// ================================================================= Elemental
//
// Unchanged in scope by the move: the same thirteen sections, the same key-kind selector, the same
// vacuity assertions. Only the file it sits in and the placeholder strip are new.

/** The Elemental sections. Every one of them had at least one string in this shape. */
const ELEMENTAL_SECTIONS = [
	'ascendance',
	'elementalMastery',
	'fireElemental',
	'earthElemental',
	'cooldownDrift',
	'flameShock',
	'flameShockSnapshots',
	'earthShock',
	'lavaBurst',
	'searingTotem',
	'lightningShield',
	'stormlash',
	// The Mana section joins the sweep with the section itself. Its `intent` had to be rewritten to get
	// in — the string this file's own banned list would have caught said mana "refills on a clock", which
	// is our vocabulary for a denominator and not a thing a reader presses.
	'mana',
];

// ---------------------------------------------------------------------------------------------------
// **This scope was a key-kind selector and is now the Windwalker's shape: everything under the
// sections, less the method notes.** The history is worth keeping, because the selector it replaced was
// not obviously wrong and the way it failed is the recurring failure of this whole file.
//
// It named six kinds — `state.*`, `kpi.*`, `caption`, `intent`, `read.*`, `verdict_*` — the kinds a
// reader is shown as prose or as a table cell, and it grew one name at a time as each new one was
// caught. `read` joined when the Ascendance verdict column landed. `verdict` needed its own alternative
// rather than a sixth name in the first, because a graded sentence stores its grade inside the same
// path segment (`verdict_good`, `verdict_ok_noOvercap`), so `verdict` in the alternation matched on
// neither a `.` nor an end of string and selected exactly nothing — which is how
// `earthShock.verdict_good` shipped telling a reader their shocks "matched the rule the list had for
// them", in the one sentence a section is judged by, past every green run of the suite.
//
// **That is the tell: a selector that has to be widened once per discovery is not a sweep, it is a list
// of the things somebody already found.** The Windwalker scope below was drawn wide for exactly this
// reason and its comment says so — a key-kind selector would have selected 25 of its 304 strings. The
// same arithmetic here: the six kinds selected **166** strings, the wide scope selects **292**, and the
// 126 it was blind to held **ten** violations. Two of them are the loudest kind there is:
//
//   - `lightningShield.key.aoe` was the two words **"AoE — not graded"** — a *chart legend key*, the
//     same shape as the two column headers reading "verdict" that the Windwalker scope was opened for.
//   - `earthShock.none` was "Every Earth Shock matched the sim's rule." — the sentence shown to a
//     reader who did it **perfectly**, and the only sentence that section has for them.
//
// The rest were chart labels and long notes: "the measured clock" twice, "the pull clock", a figure
// that "has a clock of its own", "the one case the list forbids", "the prepull press the list makes",
// and two more "graded"s in the Lightning Shield AoE note. None of them lived under a kind the selector
// named, and none of them could have.
//
// The exemption is the Windwalker's, unchanged in principle — a section explaining what it could and
// could not measure is allowed to name the measurement — and it is the same four leaves the old comment
// already named as out of scope. **Nothing new was exempted to make this pass**: across all thirteen
// sections the only method-note leaves that trip at all are `flameShockSnapshots.measurable` and the
// two `unreadable`s, which is why the list below is four names and not a growing tally.
/**
 * **The retired selector, kept as a control rather than deleted.**
 *
 * This was the Elemental scope until the widening above. It is now what **all three** spec scopes
 * measure against, to show that a key-kind selector would not have reached their strings: 25 of the
 * shared scope's 304, under 100 of the Windwalker's, and none at all of the ten reds above.
 *
 * Keeping the real regex means that argument is executed rather than asserted in a comment. It was the
 * one thing in this file that could rot silently — a comment quoting "25 of 304" stays convincing long
 * after the selector it describes has changed, and this selector has now changed.
 */
const KIND_SELECTOR = /(^|\.)(state|kpi|caption|intent|read)(\.|$)|(^|\.)verdict(_|\.|$)/;

const ELEMENTAL_METHOD_KEYS = ['unreadable', 'notGraded', 'measurable', 'resolution'];

const elementalStrings = (): [string, string][] =>
	localeStrings().filter(
		([key]) =>
			ELEMENTAL_SECTIONS.includes(key.split('.')[0]!) && !ELEMENTAL_METHOD_KEYS.includes(key.split('.').pop()!),
	);

describe('the Elemental copy is about the pull, not about the audit', () => {
	it('has reader-facing strings in every section, so the sweep is not vacuous', () => {
		const found = new Set(elementalStrings().map(([key]) => key.split('.')[0]!));
		expect([...found].sort()).toEqual([...ELEMENTAL_SECTIONS].sort());
		// The strings this widening was for, **listed rather than counted** — the same discipline the shared
		// scope below uses for its own reds, and for the same reason: a count survives a refactor that drops
		// the strings, and then the scope is dark again with the number still green. Every one of these was
		// invisible to the six-kind selector, and every one of them held a banned word until this landed.
		const ELEMENTAL_REDS = [
			'earthShock.none',
			'fireElemental.prepullYes',
			'flameShock.chart.uptimeLabel',
			'flameShock.multiDotNote',
			'flameShock.snapshotNote',
			'lightningShield.aoeNote',
			'lightningShield.key.aoe',
			'searingTotem.chart.uptimeLabel',
			'searingTotem.gate',
			'stormlash.chart.label',
		];
		const scoped = new Set(elementalStrings().map(([key]) => key));
		expect(ELEMENTAL_REDS.filter((key) => !scoped.has(key))).toEqual([]);
		// And none of them is reachable by a key-kind selector, which is the claim that justifies the shape
		// of this scope rather than a wider list of kind names. Asserted against the selector this replaced,
		// so the argument cannot rot into a comment nobody rechecks.
		expect(ELEMENTAL_REDS.filter((key) => KIND_SELECTOR.test(key))).toEqual([]);
		// **The floor is 280 against a scope of 292, and the gap is the point.** A count alone passes a
		// re-narrowing that loses a whole kind of copy, which is exactly what happened here: the selector
		// this replaced sat at 166 and read as coverage for as long as nobody counted what it left out. Set
		// close enough that a selector regressing to key kinds cannot pass, and loose enough that deleting a
		// retired string is not a test failure.
		expect(elementalStrings().length).toBeGreaterThan(280);
		// Each key kind the pattern claims to cover has to actually match something, or widening it is a
		// no-op that reads as coverage. `read` is the one this caught: the Ascendance verdict sentences are
		// the newest copy in the spec and were outside the sweep until the pattern named them.
		const kinds = new Set(elementalStrings().flatMap(([key]) => key.split('.')));
		for (const kind of ['state', 'kpi', 'caption', 'intent', 'read']) expect(kinds, kind).toContain(kind);
		expect(elementalStrings().filter(([key]) => key.startsWith('ascendance.read.')).length).toBe(14);
		// The graded sentences, counted separately because they cannot be counted the same way: the grade is
		// part of the segment, so `verdict` never appears in `kinds` and the loop above would pass whether
		// or not a single one of them was selected.
		//
		// Six of the thirteen sections carry one — the six whose section is graded as a whole. The other
		// seven grade per press and speak through a `state.*` cell on each row instead, which is why the
		// list is written out: a section that grows a verdict and is left off this line would be swept
		// anyway, but a section that *loses* its arms to a refactor would quietly leave the sweep with the
		// count still passing.
		const verdicts = elementalStrings().filter(([key]) => key.split('.')[1]?.startsWith('verdict'));
		expect(verdicts.length).toBeGreaterThan(30);
		expect([...new Set(verdicts.map(([key]) => key.split('.')[0]!))].sort()).toEqual([
			'earthShock',
			'flameShock',
			'flameShockSnapshots',
			'lightningShield',
			'mana',
			'searingTotem',
		]);
	});

	it('names no part of our own model in a state, tile, caption or intent', () => {
		expect(violations(elementalStrings())).toEqual([]);
	});
});

// ================================================================= Windwalker
//
// The Windwalker's fifteen own sections — the locale roots only its own sections read. Everything the
// two specs share (`castLog`, `timeline`, `damage`, `misses`, `raidBuffs`, `gear`, `priority`, `kpi`,
// `summary` and the rest) is swept by the third scope below, which was opened for it; only `rotation`
// and `method` stay out, and the ruling that leaves them out is written there.

const WINDWALKER_SECTIONS = [
	'snapshots',
	'casts',
	'energy',
	'chi',
	'brew',
	'chiBrew',
	'energizingBrew',
	'xuen',
	'sef',
	'karma',
	'tigerPalm',
	'debuff',
	'blackoutKick',
	'fistsOfFury',
	'jadeWind',
];

/**
 * **Where the reader-facing line is drawn, and why it is drawn from the other side.**
 *
 * The Elemental sweep selects six key *kinds* and ignores the rest. Copying that here would have read
 * as coverage and swept almost nothing: of the 29 strings this sweep catches, an Elemental-style
 * key-kind selector sees **five**. The Windwalker's prose does not live under `state.*` — it lives at
 * ad-hoc leaves named for the sentence they are (`brew.cap_good`, `snapshots.givenAway`,
 * `tigerPalm.unpressed`, `jadeWind.overuse`, `blackoutKick.starveFollowed_one`), because these
 * sections grade a button rather than a table of presses. That is the Windwalker's version of the
 * `verdict_good` trap: a selector that looks right and selects a fifth of the copy.
 *
 * So the Windwalker's scope is every string under its fifteen sections *minus* the method notes, and
 * the exemption is the Elemental one, unchanged in principle: a section explaining what it could and
 * could not measure is allowed to name the measurement. Each name below is a key whose whole subject
 * is the report's own method —
 *
 *   - `caveat`, `barCaveat`, `depthCaveat`, `energyCaveat`, `tierCaveat` — what a figure does not check
 *   - `resolution`, `reconstructed` — how finely, or how indirectly, the log was read
 *   - `scope`, `notGraded`, `uptimeMeans` — what is graded, and what a number does not mean
 *   - `unknownTalent`, `ladderMissing`, `ladder_unjudged`, `starveMissing`, `starveUnbanded` — what
 *     this log could not tell us
 *   - `tradeMethod`, `tradeNoMastery` — how a comparison was weighed
 *
 * Everything else is swept, table headers and legend keys included. A column headed "verdict" is the
 * complaint this file exists for in its shortest possible form, and two of them were shipped.
 */
const WINDWALKER_METHOD_KEYS = [
	'caveat',
	'barCaveat',
	'depthCaveat',
	'energyCaveat',
	'tierCaveat',
	'resolution',
	'reconstructed',
	'scope',
	'notGraded',
	'uptimeMeans',
	'unknownTalent',
	'ladderMissing',
	'ladder_unjudged',
	'starveMissing',
	'starveUnbanded',
	'tradeMethod',
	'tradeNoMastery',
];

const windwalkerSection = ([key]: [string, string]) => WINDWALKER_SECTIONS.includes(key.split('.')[0]!);
const isMethodNote = ([key]: [string, string]) => WINDWALKER_METHOD_KEYS.includes(key.split('.').pop()!);

const windwalkerStrings = (): [string, string][] =>
	localeStrings().filter((entry) => windwalkerSection(entry) && !isMethodNote(entry));

describe('the Windwalker copy is about the pull, not about the audit', () => {
	it('sweeps every section, and far more of each than a key-kind selector would', () => {
		const found = new Set(windwalkerStrings().map(([key]) => key.split('.')[0]!));
		expect([...found].sort()).toEqual([...WINDWALKER_SECTIONS].sort());
		expect(windwalkerStrings().length).toBeGreaterThan(380);
		// The measurement behind the boundary note above. Borrowing the Elemental selector would leave
		// three quarters of this copy unread, and the number is pinned so that a later lane tempted to
		// "unify the two selectors" sees what unifying them costs.
		expect(windwalkerStrings().filter(([key]) => KIND_SELECTOR.test(key)).length).toBeLessThan(100);
		// Both label kinds the Elemental sweep never reached, and the ones two shipped violations were in.
		const kinds = new Set(windwalkerStrings().flatMap(([key]) => key.split('.')));
		for (const kind of ['intent', 'kpi', 'caption', 'columns', 'cells', 'key']) expect(kinds, kind).toContain(kind);
	});

	it('keeps the graded sentences of every section that has one, so a refactor cannot drop an arm', () => {
		// Counted apart from the loop above for the reason the Elemental block gives: the grade lives in
		// the same path segment, so `verdict` is never a segment and never appears in `kinds`. The section
		// list is written out rather than derived — a section that *loses* its arms would leave the sweep
		// with every count still passing.
		const verdicts = windwalkerStrings().filter(([key]) => key.split('.')[1]?.startsWith('verdict'));
		expect(verdicts.length).toBeGreaterThan(25);
		expect([...new Set(verdicts.map(([key]) => key.split('.')[0]!))].sort()).toEqual([
			'brew',
			'casts',
			'debuff',
			'karma',
			'snapshots',
			'tigerPalm',
		]);
	});

	it('exempts only the method notes it names, and only ones that exist', () => {
		// Both directions, because the exemption is the one place this guard can be quietly widened. A
		// name with no key behind it is a stale exemption or a pre-emptive one; the pinned count makes
		// adding a real one a visible edit with a reason next to it rather than a way to green a red run.
		const exempt = localeStrings().filter((entry) => windwalkerSection(entry) && isMethodNote(entry));
		expect(exempt.length).toBe(24);
		const withoutKeys = WINDWALKER_METHOD_KEYS.filter((name) => !exempt.some(([key]) => key.split('.').pop() === name));
		expect(withoutKeys).toEqual([]);
	});

	it('names no part of our own model in anything a reader is shown', () => {
		expect(violations(windwalkerStrings())).toEqual([]);
	});
});

// ================================================================= the shared copy
//
// The third scope, and the one that holds the first sentences anyone reads. `overall.*` is the single
// line under the player's name, `summary.judged` the line under that; both were unswept while the two
// spec scopes above covered 560 strings on either side of them.
//
// **The boundary, ruled rather than inherited.** The lane that swept the Windwalker left everything
// shared out and named `rotation` and `priority` as permanent exemptions. Half of that is kept and half
// is overturned, because the exemption is about the **sentence**, not the namespace:
//
//   - `rotation` stays exempt, and it is the only whole section in the file that is. It says nothing
//     about your pull — `rotation.intent` opens "None of it is about your pull" — because it *is* the
//     priority list, published so a reader can check a number above against it. Its whole subject is
//     the model, so it has to be able to name a rule, a condition, a gate and the list itself; a
//     section that exists to print the priority list cannot be forbidden from calling it one. That is
//     the method-note exemption of the two scopes above, applied at section scale because here the
//     whole section is the note. The test below asserts it is still carrying banned words, so the
//     exemption stays visibly load-bearing rather than becoming a no-op nobody dares delete.
//
//   - `method` was the obvious second candidate and is **not** exempted, because it does not need to
//     be: all eight of its strings pass the sweep as they stand. Exempting a section that passes is the
//     pre-emptive exemption the Windwalker block above refuses for leaf names, and the leaf-name
//     mechanism is already here — the day a method note genuinely has to say "gate", whoever writes it
//     names the leaf in `SHARED_METHOD_KEYS` with a reason beside it, which is an argued edit rather
//     than standing cover.
//
//   - `priority` is *not* a reference section, and exempting it by namespace was the mistake. It reads
//     the model down your pull and reports how your presses came out — `priority.summary` is a graded
//     sentence about you, in the same shape as any `verdict_*` the two scopes above sweep. It happens
//     to *sit* next to the ladder's own entry labels, and a namespace-shaped exemption cannot tell the
//     two apart. So `priority` is swept, and the concrete cost of not sweeping it was visible: the
//     eight `ladder_*` sentences were rewritten from "the presses the priority list could judge" to
//     "the presses this log could check against the priority list" — moving the limit onto the log,
//     where it belongs — while `priority.summary` and `priority.clean` kept the old phrasing, two
//     strings saying the thing eight others had just stopped saying. They now say it the same way.
//     Only `priority.scope` and `priority.reconstructed` stay out, by the leaf-name exemption the two
//     scopes above already use: both are literally about method, and `reconstructed` opens "Nothing
//     here is graded, and this is why".
//
// `MODEL_WORDS` was untouched by the lane that drew this scope, for the reason given above it:
// widening the vocabulary and widening the coverage are two changes. This scope is what finished the
// coverage half, which is what let `exempt` in as a change of its own.

/**
 * The roots both specs render. Written out rather than derived as "everything that is not a spec
 * section" so that a new root is a visible edit here, and closed by the last test in this file: every
 * root in `report.json` is in exactly one of the four lists, so nothing can be added outside a scope
 * again the way every Windwalker string once was.
 *
 * `grade` was the seventeenth and is gone with the copy: four labels — "Good", "Mixed", "Needs work",
 * "Not measured" — that arrived in the first commit and were never read by anything, at any point in
 * the file's history. The page draws a grade as a colour and says so (`primitives/grade.ts`: "the
 * words carry the judgement on their own"), and the closure test below is what turned deleting them
 * into this edit rather than a silent one.
 */
const SHARED_SECTIONS = [
	'castLog',
	'damage',
	'empty',
	'gear',
	'kpi',
	'method',
	'metric',
	'misses',
	'nav',
	'overall',
	'priority',
	'raidBuffs',
	'summary',
	'targets',
	'timeline',
];

/** The one section whose whole subject is the model. See the ruling above. */
const REFERENCE_SECTIONS = ['rotation'];

/**
 * The leaves inside the exempt section that are about the **reader's pull**, and so are swept anyway.
 *
 * The exemption above is argued from `rotation.intent`'s own opening — "None of it is about your
 * pull" — and two leaves broke that premise. `reading_multi` said the drawn flow was "the count every
 * press above is judged at", and `reading_single` that one enemy "is how the report is reading your
 * pull": both are claims about how *this* log was read, printed inside the one section that is exempt
 * for saying nothing about it.
 *
 * **In scope by leaf rather than moved out of the section**, and by leaf rather than by widening the
 * section, because the same mechanism is already here twice — `WINDWALKER_METHOD_KEYS` and
 * `SHARED_METHOD_KEYS` name leaves that are exceptions to their scope, and these name leaves that are
 * exceptions to an exemption. It reads in the same direction: the unit of the decision is the
 * sentence, which is the ruling the shared block above spent three paragraphs making about
 * `priority`.
 *
 * Both, not just the one with the banned word. They are one sentence at two readings, and scoping the
 * red one alone would leave the next lane's edit to its twin unswept — which is this whole file's
 * failure mode. Bringing them in also cost them the phrase "This is the list at …": once a sentence is
 * in scope it cannot name the model, so both now name what is drawn by its own heading, "the priority
 * flow". Nothing is lost by that — which reading the report took is already said in swept copy, by
 * `targets.detected_*` and `targets.overridden_*` beside the control that sets it.
 *
 * Note what this is *not*: an exception for the second person. Two dozen `rotation` strings say "you"
 * and "your" — "It deals a lump equal to your own maximum health" — and they stay exempt, because
 * that is reference material addressed to a reader rather than a claim about the pull in front of
 * them. These two made the claim.
 */
const REFERENCE_READER_KEYS = ['reading_single', 'reading_multi'];

const isReferenceReader = ([key]: [string, string]) => REFERENCE_READER_KEYS.includes(key.split('.').pop()!);

const referenceReaderStrings = (): [string, string][] =>
	localeStrings().filter((entry) => REFERENCE_SECTIONS.includes(entry[0].split('.')[0]!) && isReferenceReader(entry));

/** Method notes among the shared roots. Both are `priority`'s; no other shared root has one. */
const SHARED_METHOD_KEYS = ['scope', 'reconstructed'];

const sharedStrings = (): [string, string][] =>
	localeStrings().filter(
		([key]) => SHARED_SECTIONS.includes(key.split('.')[0]!) && !SHARED_METHOD_KEYS.includes(key.split('.').pop()!),
	);

/**
 * The strings this scope was opened for, listed rather than counted.
 *
 * A count passes a refactor that loses the arms — the reason both scopes above write their verdict
 * sections out — and it passes a rename that quietly drops a sentence out of the sweep. These are the
 * 27 keys that were at fault when the scope was drawn, so a later lane that moves `overall.*` under a
 * spec root, or renames `castLog.target.mergedNote`, gets told rather than getting a green run over 26.
 */
const SHARED_REDS = [
	'castLog.death.note',
	'castLog.empty',
	'castLog.phase.note',
	'castLog.target.mergedNote',
	'gear.intent',
	'misses.intent',
	'misses.none',
	'overall.bad',
	'overall.none',
	'overall.ok',
	'priority.clean',
	'priority.forced_multi',
	'priority.forced_single',
	'priority.noResources',
	'priority.rule.rising-sun-kick-filler',
	'priority.summary',
	'priority.unjudged',
	'summary.judged',
	'summary.judged_partial',
	'summary.takeaways.clean',
	'summary.takeaways.metric.earthShockGood.fix',
	'summary.takeaways.metric.flameShockUptime.fix',
	'summary.warning.runeMissing.body',
	'timeline.eleIntent',
	'timeline.empty',
	'timeline.intent',
	'timeline.lanes.empty',
];

describe('the shared copy is about the pull, not about the audit', () => {
	it('sweeps every shared section, and reaches the strings a key-kind selector never would', () => {
		const found = new Set(sharedStrings().map(([key]) => key.split('.')[0]!));
		expect([...found].sort()).toEqual([...SHARED_SECTIONS].sort());
		// 300 and not 310: twelve of the shared roots' strings were dead copy, and went when `keys.test.ts`
		// gained an orphan hunt for `report.json` — three `method` notes nothing rendered, six `timeline`
		// track and legend labels, `castLog.caption` and the two `gear.pill.gems` plurals. A floor is a
		// non-vacuity guard rather than a budget, so it follows the file down when the file loses copy that
		// had no reader.
		//
		// **The floor stays at 300, and this comment no longer quotes the count.**
		//
		// It used to, and the number was wrong every time somebody checked: 311 when the sentence was first
		// written, 304 when a later lane rewrote it, 306 now. Worse, the *argument* was inverted. It read
		// that `summary.takeaways.metric.fireElementalHasteUptime.label` and `.fix` were "the two most
		// recent strings to go", dead copy the orphan hunt had deleted — and that every drop so far had
		// been a deletion of that kind, so the gap down to 300 was a budget for the next honest deletion.
		//
		// **Both those leaves are back.** `738f77f` gave the haste-cooldown rule its own card, so the
		// paired-guard rule demanded them again. The file has grown, not shrunk, and a floor justified
		// entirely as deletion headroom was defending against the wrong direction.
		//
		// What this line has to catch is the scope **going dark** — a selector that stops selecting, a root
		// that quietly leaves `SHARED_SECTIONS`. It catches that at 300 whatever the live count is, and the
		// gap is headroom in both directions rather than a deletion budget.
		expect(sharedStrings().length).toBeGreaterThan(300);
		// The measurement, done before the selector was chosen rather than after. Copying the Elemental
		// key-kind selector here would have selected 25 of these 304 strings and caught **three** of the
		// 27 below — the three that happen to be called `intent`. The other 24 are `note`, `empty`,
		// `body`, `fix`, `clean`, `mergedNote` and the six bare `priority` leaves: prose at ad-hoc names,
		// the same shape the Windwalker's turned out to be.
		expect(sharedStrings().filter(([key]) => KIND_SELECTOR.test(key)).length).toBeLessThan(30);
		const scoped = new Set(sharedStrings().map(([key]) => key));
		expect(SHARED_REDS.filter((key) => !scoped.has(key))).toEqual([]);
		expect(SHARED_REDS.filter((key) => KIND_SELECTOR.test(key))).toEqual([
			'gear.intent',
			'misses.intent',
			'timeline.intent',
		]);
	});

	it('exempts only the two method notes it names, and only ones that exist', () => {
		// Both directions, as the Windwalker block does: a name with no key behind it is a stale or
		// pre-emptive exemption, and the list is pinned so widening it is a visible edit.
		const exempt = localeStrings().filter(
			([key]) => SHARED_SECTIONS.includes(key.split('.')[0]!) && SHARED_METHOD_KEYS.includes(key.split('.').pop()!),
		);
		expect(exempt.map(([key]) => key).sort()).toEqual(['priority.reconstructed', 'priority.scope']);
	});

	it('exempts one whole section, and that exemption is still carrying the words that earned it', () => {
		expect(REFERENCE_SECTIONS).toEqual(['rotation']);
		// The exemption's own justification, asserted rather than stated. `rotation` names the list, its
		// rules, its conditions and its gates because printing them is what the section is for. If that
		// ever falls away, the exemption has become a no-op and should be deleted rather than left as
		// cover for whatever gets written there next.
		//
		// Taken over the section *less* its two in-scope leaves, so the figure that keeps the exemption
		// load-bearing is drawn from copy the exemption actually still covers.
		//
		// **It is 19, and 19 with the two leaves back in as well** — this comment said 20 for both, and
		// nothing executed it, which is the failure this whole file exists to name. It is asserted only as
		// `> 15`, so the drift was invisible. The equality across the two readings is the part that
		// matters: the carve-outs bought nothing past this line, because a leaf with no banned word left in
		// it adds nothing here.
		//
		// If a future reader needs the exact figure, derive it — do not read it here.
		const reference = localeStrings().filter(
			(entry) => entry[0].split('.')[0] === 'rotation' && !isReferenceReader(entry),
		);
		expect(reference.length).toBeGreaterThan(100);
		expect(violations(reference).length).toBeGreaterThan(15);
	});

	it('sweeps the two leaves of that section that are about the reader, and only leaves that exist', () => {
		// Both directions, as every other exception list in this file: a name with no key behind it is a
		// pre-emptive carve-out, and the keys are written out so that moving either sentence is a visible
		// edit here rather than a quiet exit from the sweep.
		expect(
			referenceReaderStrings()
				.map(([key]) => key)
				.sort(),
		).toEqual(['rotation.flow.reading_multi', 'rotation.flow.reading_single']);
		expect(violations(referenceReaderStrings())).toEqual([]);
	});

	it('names no part of our own model in anything a reader is shown', () => {
		expect(violations(sharedStrings())).toEqual([]);
	});
});

// ================================================================= the file, closed

describe('no string in report.json sits outside every scope', () => {
	/**
	 * The gap this file's whole history is about, made impossible rather than fixed again.
	 *
	 * The sweep was Elemental-only because its one section list named Elemental roots; the Windwalker
	 * scope fixed that for fifteen roots and left seventeen shared ones out; this closes the file. Every
	 * root belongs to exactly one of the four lists, so a new section — or a new spec — cannot be
	 * unswept without deleting a name from one of them, which is an edit somebody has to argue for.
	 */
	it('classifies every locale root into exactly one scope', () => {
		const roots = [...new Set(localeStrings().map(([key]) => key.split('.')[0]!))].sort();
		const classified = [
			...ELEMENTAL_SECTIONS,
			...WINDWALKER_SECTIONS,
			...SHARED_SECTIONS,
			...REFERENCE_SECTIONS,
		].sort();
		expect(new Set(classified).size).toBe(classified.length);
		expect(roots).toEqual(classified);
	});
});

// ================================================================= the shell
//
// `ui.json` under `MODEL_WORDS`, which is a coverage change and nothing else: every one of these leaves
// already passes, so this commit moves no copy and the run is green the first time it is made. That is
// the point of it. The claim that the shell copy names no part of the model was previously a sentence in
// a docstring above, written by hand and checked by nobody, and a hand-made claim about a file that four
// lanes have edited is a claim about the day it was typed.
//
// **No exemptions, and none of the four the report scopes carry transfer.** `WINDWALKER_METHOD_KEYS`,
// `SHARED_METHOD_KEYS`, `REFERENCE_SECTIONS` and `REFERENCE_READER_KEYS` all exist because naming the
// model is sometimes a section's job — printing the priority list, explaining how a threshold was read.
// The shell has no such job. It signs you in, takes a report code and draws a settings dialog, and there
// is no string in it that has to call anything a rule, a band or a verdict.

/**
 * Every root in `ui.json`, written out for the same reason the three report scopes write theirs out:
 * so that a new root is a visible edit here rather than a quiet exit from the sweep.
 *
 * Re-verified against the file as it stands rather than copied from the plan — `settings.intent` moved
 * between the two, and the roots are the thing a copy edit is least likely to change and most damaging
 * to get wrong. Seven when this scope was drawn, and the closure test below is what keeps the list
 * honest about how many there are.
 *
 * **`auth`, `errors` and `progress` are the three that arrived after it**, and adding them here is the
 * visible half of that change. They hold the copy that used to be typed into `src/components/auth/`,
 * `describeFailure.ts` and the two fetch-progress call sites — 561 words that no sweep in this file
 * could see, because `docs/conventions.md`'s own rule ("No English sentence belongs in a component")
 * was the only thing guarding them and nothing executed it. Bringing them into the locale brings them
 * under every list in this file **by construction**, which is why the move was worth more than the
 * scanner that was considered and rejected in its place.
 */
const UI_ROOTS = ['app', 'auth', 'chart', 'common', 'credits', 'errors', 'progress', 'selection', 'settings', 'steps'];

const shellStrings = (): [string, string][] => uiStrings().filter(([key]) => UI_ROOTS.includes(key.split('.')[0]!));

describe('the shell copy is about the pull, not about the audit', () => {
	it('sweeps every shell root, with nothing outside a scope', () => {
		const roots = [...new Set(uiStrings().map(([key]) => key.split('.')[0]!))].sort();
		expect(new Set(UI_ROOTS).size).toBe(UI_ROOTS.length);
		expect(roots).toEqual([...UI_ROOTS].sort());
		// Non-vacuity, in the shape the report scopes use: a floor rather than the live count, so an
		// honest deletion does not red it and a selector that stops selecting does.
		expect(shellStrings().length).toBeGreaterThan(40);
	});

	it('names no part of our own model in anything a reader is shown', () => {
		expect(violations(shellStrings())).toEqual([]);
	});
});

// ================================================================= the vocabulary, measured

describe('the one prophylactic word in the vocabulary', () => {
	/**
	 * `exempt` was left out of `MODEL_WORDS` for three lanes under the standing rule that widening the
	 * vocabulary and widening the coverage are two changes. The coverage is finished, so this is the
	 * change on its own — and the measurement that says what it did.
	 *
	 * It caught nothing. That is fine and it is the reason this test exists: a word added to a sweep
	 * that fires on nothing is a guard against a sentence not yet written, and the next lane reading a
	 * green run needs to know which of the two it is looking at. What it is *not* is idle — it is our
	 * name for a decision the report makes about a rule's scope, and it already exists in the file as
	 * five key names whose own copy is the obvious place for it to leak into.
	 */
	it('fires on no string in the file, which is what makes it prophylactic', () => {
		expect(MODEL_WORDS).toContain('exempt');
		const anywhere = localeStrings()
			.filter(([, value]) => prose(value).toLowerCase().includes('exempt'))
			.map(([key]) => key);
		expect(anywhere).toEqual([]);
	});

	/** The five key names it is guarding the copy under, so "it appears nowhere" is not the whole claim. */
	it('is already our word, in five keys a reader never sees', () => {
		const keys = localeStrings()
			.map(([key]) => key)
			.filter((key) => key.toLowerCase().includes('exempt'))
			.sort();
		expect(keys).toEqual([
			'earthShock.verdict_exempt',
			'flameShock.verdict_exempt',
			'flameShockSnapshots.verdict_exempt',
			'mana.key.exempt',
			'tigerPalm.verdict_exempt',
		]);
	});
});

// ================================================================= the strip, pinned

describe('stripping the templates hides no violation', () => {
	/**
	 * The one way `prose()` could be a narrowing rather than a correction: a banned word inside a
	 * placeholder that a reader *does* see, which would be an interpolated value rather than a formatter
	 * or a variable name. There is no such thing in any of the four scopes' copy, and this says so — so
	 * the day someone writes `{{verdict}}` into a sentence, this fails instead of the sweep going quiet.
	 *
	 * The shell is the fourth, and it adds nothing to the list below: its ten placeholder shapes are
	 * `{{spec}}`, `{{default}}`, `{{min}}`, `{{max}}`, `{{when}}` and five formatted counts, none of
	 * which carries a word from the vocabulary. It is swept anyway, because the scope above leans on the
	 * same strip and an unpinned strip is the narrowing this test was written to refuse.
	 *
	 * `priority.summary: {{judged}}` is the ninth, and it came in with the shared scope rather than with
	 * a new string: it was always a variable name rendering a count, and was always unpinned because the
	 * namespace it lives in was outside every scope.
	 */
	it('leaves no banned word inside a placeholder in any of the four scopes', () => {
		const swept = [
			...elementalStrings(),
			...windwalkerStrings(),
			...sharedStrings(),
			...referenceReaderStrings(),
			...shellStrings(),
		];
		const inside = swept
			.flatMap(([key, value]) => (value.match(/\{\{[^}]*\}\}/g) ?? []).map((token) => [key, token] as const))
			.filter(([, token]) => MODEL_WORDS.some((word) => token.toLowerCase().includes(word)))
			.map(([key, token]) => `${key}: ${token}`);
		expect(inside.sort()).toEqual([
			'brew.chartLabel: {{duration, clock}}',
			'casts.presses: {{active, clock}}',
			'casts.presses: {{total, clock}}',
			'energy.summary: {{duration, clock}}',
			'energy.summaryNoRate: {{duration, clock}}',
			// The tenth, and it arrived the same way `priority.summary` did — not with a new string, but with
			// a scope widening to reach a string that was always there. `wasteSplit` renders a count of
			// presses; `judged` is the variable holding it, and a reader sees the number.
			'flameShock.wasteSplit: {{judged, integer}}',
			'priority.summary: {{judged}}',
			'sef.justified: {{rule, duration}}',
			'sef.lanes.shortLived_one: {{rule, duration}}',
			'sef.lanes.shortLived_other: {{rule, duration}}',
			'sef.unjustified: {{rule, duration}}',
		]);
	});
});

// ================================================================= the reader's ear
//
// A second vocabulary, and a second question. Everything above asks whether *our* jargon reached a
// reader; the three lists below ask whether the copy sounds like a person who plays this game.
//
// **They are separate lists rather than a longer `MODEL_WORDS`, and the exemptions decide it.**
// `MODEL_WORDS` is surrounded by four carve-outs — `WINDWALKER_METHOD_KEYS`, `SHARED_METHOD_KEYS`,
// `REFERENCE_SECTIONS` covering ~120 `rotation` strings, `REFERENCE_READER_KEYS` — because naming the
// model is *sometimes correct*: a section whose job is printing the priority list cannot be forbidden
// from calling it a list. None of that transfers. No section's job requires "it is worth noting".
// Merging the lists would hand every `rotation` string a permanent pass on AI vocabulary, and one of
// the reds below (`rotation.entry.tigerPalmProc.why`) sits inside exactly that exemption.
//
// |                 | `MODEL_WORDS`                                 | the three lists below                           |
// | --------------- | --------------------------------------------- | ----------------------------------------------- |
// | a red run means | internal jargon reached a reader              | the copy does not sound like a player           |
// | matcher         | `includes()` — `judg` catches judge/judgement | `\b`-anchored — `very` must not fire on `every` |
// | scope           | four scoped lists + exemptions + closure test | whole file, unscoped, no exemptions             |
// | files           | `report.json`                                 | both, from the start                            |
//
// The audience measurements quoted below come from `.claude/skills/tone-of-voice/references/
// audience-wow-players.md`: 18,889 words of Wowhead MoP guide prose, 12 pages, 6 authors. Rates are
// per 100,000 words, and the author spread matters more than the rate — a marker used by one author of
// six is that writer's tic, not the genre.

/**
 * Vocabulary that says a machine wrote it.
 *
 * Openers (`SKILL.md` §3), filler and hedges (§1–§2), formal connectors (§1), manufactured enthusiasm
 * (§6) and the corporate register words (§2). Every one of them has a plain replacement that always
 * works, which is what makes this list a floor rather than a preference.
 *
 * **Two entries are genre-*present* and banned anyway, and the reason has to sit here or it will be
 * relaxed by the next person who checks the corpus.**
 *
 *   - **`very`** — 243/100k across **6 of 6** authors. It is genuinely how these writers write. It
 *     stays banned because `SKILL.md` §1–§2 is a floor the audience register does not lower, and
 *     because the corpus's own default quality word is `strong` (312/100k, 6/6) with no intensifier in
 *     front of it. An earlier draft of the register file claimed `very` was absent from the genre; it
 *     is not, and that correction should not have to be made a second time.
 *   - **`however`** — 6 uses, **4 of 6** authors. Also present, also banned, same reason.
 *
 * Neither is an exemption, and neither gets one. `casts.verdict_good` said "Very little went unused"
 * and read better as "Almost nothing went unused" until that arm was priced against its own band and
 * reworded again; `lightningShield.verdict_good_noOvercap` said "it
 * pays however many enemies are in front of you" and reads the same with "no matter how many". An
 * exemption for an idiom is a hole in a list that has none, and both rewords lose nothing.
 */
const AI_WORDS = [
	// Openers — §3. "It is worth noting that X" is X with a machine in front of it.
	'worth noting',
	'worth knowing',
	// Filler and hedges — §1, §2.
	'simply',
	'very',
	'quite',
	'fairly',
	'arguably',
	'significantly',
	'crucial',
	// Formal connectors — §1's "Don't" list, verbatim.
	'however',
	'moreover',
	'furthermore',
	'additionally',
	// Manufactured enthusiasm — §6. The corpus reaches for `strong`, not for these.
	'amazing',
	'awesome',
	'insane',
	'incredible',
	// Corporate register — §2.
	'delve',
	'leverage',
	'robust',
	'seamless',
	'utilize',
	'unlock',
	'elevate',
	'ultimately',
	'in conclusion',
];

/**
 * First person. A report describes a pull; it is not a party to it.
 *
 * **Half of this list is the genre and half is this project's own stricter line, and the halves must
 * not be confused.**
 *
 *   - **`I` is genre.** Zero instances in 18,889 words, across all six authors. It is the strongest
 *     single finding in the corpus, and it is why `SKILL.md` §7 — which assigns `I` to the opening and
 *     the method block, and warns that too *little* first person is the commoner failure — is
 *     explicitly overridden for this register. §7 is written for personal long-form. Do not run
 *     `scripts/person-density.py` as a gate on this repo's copy: verified, it fails a clean
 *     second-person report draft with "no author present" and exits 1 under `--strict`. An agent that
 *     obeys it will insert an author into a report that must not have one. This list is that script's
 *     load-bearing claim — person is the axis, check it deterministically — kept, with its direction
 *     corrected.
 *   - **`we` and `our` are a house tightening, not a genre rule.** Editorial first-person plural runs
 *     349 and 269 per 100k across **all six** authors: "our great utility stays untouched" is normal
 *     guide prose. Banning it here is a decision about what a *report* is, and anyone who later checks
 *     the corpus will find `we` everywhere and read the ban as a mistake. It is not. It is stricter
 *     than the genre on purpose.
 *   - **`us`** is the one entry that is an outlier inside the genre too — 127/100k from a single
 *     author out of six.
 *
 * `I` catches nothing today and is pinned as prophylactic, in the same sense and for the same reason
 * as `exempt` in `MODEL_WORDS`: it is the word by which this defect would arrive, not one already
 * here.
 */
const AUTHOR_WORDS = ['we', 'us', 'our', 'ours', "we're", "let's", 'I'];

/**
 * Metaphor reaching outside the game.
 *
 * The register file §6 measured the audience's analogy domain as cross-class and cross-expansion
 * comparison, almost exclusively — a new mechanic explained by pointing at one the reader already
 * knows. **No picture from outside the game appears anywhere in 18,889 words**: no sport, cooking,
 * machinery, weather or business figure, from any of the six authors. Checked by name: `bell` 0, `on
 * the table` 0, `in the same breath` 0, `if anything` 0.
 *
 * **Four phrases cannot catch the next metaphor, and this list does not pretend otherwise.** A word
 * list finds words; a figure of speech is a construction. Every entry here was found by a human
 * reading the copy and naming one, after which a sweep found its siblings — never the other way
 * round. The durable half of this guard is the written rule in `docs/conventions.md` (comparisons come
 * from inside the game or from another spec's mechanics), and this list is the ratchet under it: when
 * the read-through in Phase 4b-ii names the fifth class, its literal is added here so it cannot come
 * back.
 *
 * The strongest single argument in the class is internal rather than register:
 * `summary.takeaways.metric.fireElementalPrepull.fix` said "was not out when the pull started" and "in
 * the last second before the bell" in adjacent sentences. Same referent, two registers, one string.
 *
 * `\bbell\b` needs no exemption. Ability, talent and item names reach the page from WCL's
 * `masterData`, never from the locale (`docs/conventions.md:288`), so no reader-facing string can be
 * forced to carry the word — and the right-hand boundary keeps `bellow` out.
 *
 * **Sequencing, recorded because the plan had it wrong.** `docs/tone-of-voice-migration.md` puts this
 * list in Phase 2 and the twelve locale strings it fires on in Phase 4b-i, which would have left the
 * Phase 2 + 3 pair red on landing — and CI blocks a red PR. Resolved by pulling 4b-i's *locale* half
 * forward into the Phase 3 commit: all twelve are in-place string edits, and three of them are the
 * plan's own worked examples 3, 4 and 5. 4b-i keeps the source-comment `bell` sites, which were always
 * a separate commit for a separate reason.
 *
 * **`what was wrong` joined in 4b-ii, and it is the same phrase as `if anything`.** Both come off
 * `fistsOfFury.caption`'s "what, if anything, was wrong with its placement", which 4b-i rewrote to
 * "where each one went wrong" — and then left the phrase standing in three more places it had not
 * looked: the `verdict` column head of the Fists of Fury table, the same head in Energizing Brew, and
 * `earthShock.caption`. All three now say "what went wrong", which is a verb where a copula was. It is
 * at **0** across the corpus, like the four above it, and it is in this list rather than in a register
 * note because a column head is the one place a rewrite is most likely to put it back.
 */
const OFF_DOMAIN = ['bell', 'on the table', 'in the same breath', 'if anything', 'what was wrong'];

/**
 * Anchored on **both** sides, which is the one place these lists deliberately differ from
 * `namesTheModel` above.
 *
 * `MODEL_WORDS` leaves the right side open so its stems catch their own inflections — `rule` has to
 * reach "rules" and "ruled". These lists cannot afford that: `we` would fire on "went", "well" and
 * "weapon", `us` on "used" and "usually", `bell` on "bellow", and the sweep would be noise inside a
 * day. The left boundary is the `very`/`every` case the plan names; the right boundary is the `we`
 * case, and it is the one that actually bites.
 *
 * The price is inflections — `crucially` and `leveraging` walk past a list holding `crucial` and
 * `leverage`. Measured before accepting it: across all 1,233 leaves of both files, dropping the right
 * boundary would flag **zero** additional strings. The trade costs nothing today, and the anchoring
 * test below is what will say so again tomorrow.
 *
 * Case-insensitive, and matched against `prose()` so a formatter or variable name inside `{{…}}`
 * cannot trip it — the same strip, for the same reason, as the sweeps above.
 */
const boundary = (word: string): RegExp => new RegExp(`\\b${word}\\b`, 'i');

/** Reds in the shape `violations()` uses, so a failing run prints the census rather than a count. */
const matching = (words: string[], strings: [string, string][]): string[] =>
	strings
		.filter(([, value]) => words.some((word) => boundary(word).test(prose(value))))
		.map(([key, value]) => `${key}: "${value}"`);

/** Both files, with the shell copy's keys marked so a red run says which file to open. */
const bothLocales = (): [string, string][] => [
	...localeStrings(),
	...uiStrings().map(([key, value]): [string, string] => [`ui:${key}`, value]),
];

describe('no string in either locale sounds machine-written', () => {
	it('reaches into both files, so neither is silently unswept', () => {
		// Non-vacuity of the *scope*, in the shape the three scopes above use for theirs. A sweep that
		// reads one file and asserts nothing about the other is the exact failure this whole file
		// documents: `report.json` was Elemental-only for three lanes and every green run said so.
		expect(localeStrings().length).toBeGreaterThan(1100);
		expect(uiStrings().length).toBeGreaterThan(40);
		expect(new Set(uiStrings().map(([key]) => key.split('.')[0]!))).toContain('settings');
	});

	it('uses no AI vocabulary, in either file', () => {
		expect(matching(AI_WORDS, bothLocales())).toEqual([]);
	});

	it('puts no author in a report, in either file', () => {
		expect(matching(AUTHOR_WORDS, bothLocales())).toEqual([]);
	});

	it('reaches for no picture from outside the game, in either file', () => {
		expect(matching(OFF_DOMAIN, bothLocales())).toEqual([]);
	});

	it('has no entry that fires on nothing at all, so a typo cannot green a list forever', () => {
		// The failure this test exists for is silent and permanent: `'furthermoree'` in the list above
		// greens its whole block, and no run ever says otherwise. So every entry is executed against a
		// synthetic string built from itself — not against the locale, which would only prove the copy
		// is clean.
		//
		// `matching` is used rather than `boundary` directly, so what is exercised is the matcher the
		// three tests above call, including the `prose()` strip.
		const dead = [...AI_WORDS, ...AUTHOR_WORDS, ...OFF_DOMAIN].filter(
			(word) =>
				matching([word], [['synthetic', `A sentence that says ${word} in the middle of it.`]] as [string, string][])
					.length === 0,
		);
		expect(dead).toEqual([]);
	});

	it('anchors on both sides, so an ordinary word that contains a banned one is not a red', () => {
		// The other half of the same guard. A list that fires on everything is as useless as one that
		// fires on nothing, and this is the shape that mistake takes: `very` inside `every`, `we` inside
		// `went`, `bell` inside `bellow`. Every pair below is a real word that appears in this repo's
		// copy or its comments.
		const innocent = [
			'You used every press you had.',
			'The window went by and the bar was well under it.',
			'A weapon proc is usually worth using.',
			'It is an hour into the pull.',
			'Bellowing Rage was up.',
			'Four presses in total.', // `our` must not fire on `four`
		];
		const asPairs = (values: string[], label: string): [string, string][] =>
			values.map((value, i) => [`${label}.${i}`, value]);
		expect(matching([...AI_WORDS, ...AUTHOR_WORDS, ...OFF_DOMAIN], asPairs(innocent, 'innocent'))).toEqual([]);
		// And the whole-word forms of the same six do fire, so the line above is drawn at the boundary
		// rather than at the words being absent.
		const guilty = [
			'It is very close.',
			'We measured it.',
			'The press is ours.',
			'It took us an hour.',
			'Nothing was out at the bell.',
			'That is damage left on the table.',
		];
		expect(matching([...AI_WORDS, ...AUTHOR_WORDS, ...OFF_DOMAIN], asPairs(guilty, 'guilty')).length).toBe(
			guilty.length,
		);
	});

	it('keeps the em-dash under the ceiling the house style was granted', () => {
		// **The em-dash is kept, and this is the condition it was kept on.**
		//
		// 240 of them in `report.json`, 19.7% of prose sentences, and they do real appositive work:
		// defining a measurement mid-sentence, where a following sentence would put the definition after
		// the claim that needed it. It is house punctuation — present in `ui.json`, the README, every
		// code comment and this file's own prose — and a sweep against a rule the repo breaks in every
		// file is theatre.
		//
		// It is an override of `SKILL.md` §15.5 **and** of the audience corpus, not a register-native
		// choice: the genre uses 6 em-dashes in 18,889 words, none of them a spaced appositive pair, and
		// reaches for parentheses instead (317/100k). Recorded that way rather than as genre support,
		// because a false claim of support does not survive the next reviewer.
		//
		// What survives the override is the ceiling. Two in a string is an aside; three is a sentence
		// built out of asides, and the third one is where the punctuation stops carrying the argument
		// and starts replacing it.
		//
		// **This was written as prophylactic and it was not.** The plan measured a ceiling of 2 with
		// nothing at 3; `earthShock.verdict_tooFew` arrived between that measurement and this commit
		// carrying three, and its last dash — introducing an instruction rather than defining a term —
		// became a full stop.
		const stacked = bothLocales()
			.filter(([, value]) => (value.match(/—/g) ?? []).length >= 3)
			.map(([key, value]) => `${key}: "${value}"`);
		expect(stacked).toEqual([]);
	});
});

// ================================================= the magnitude a grade cannot carry
//
// **A word list cannot find this one either, and a scoped list of survivors can.**
//
// `docs/conventions.md`'s honesty rule — "never hard-code a finding into report prose; derive the
// claim from the numbers or omit it" — has a shape the plan named once and then missed twice. A
// graded arm renders across a whole band, so a frequency or magnitude word inside it is a claim about
// every value the band can take, not about the value in front of the reader. `casts.verdict_bad`
// appended "Nearly a third of the pull produced nothing useful" to a band starting at 75% used, and
// Phase 3 deleted it. The same defect was still live in two more arms, and one of them contradicted a
// number nine words earlier:
//
//   - `tigerPalm.verdict_bad` ended "This happened repeatedly, not just once." `tigerPalmWaste` is
//     `ok: 30, higherIsBetter: false` and `MIN_GRADED_SAMPLE` is 3, so three presses with one wasted
//     is 33% and reaches this arm — printing "1 of them bought nothing … This happened repeatedly."
//   - `earthShock.verdict_bad` ended "— most went out early." `earthShockGood` is `ok: 65`, so the arm
//     starts at 64% good, where 36% went out early and "most" is false.
//
// Neither is a word this file could ban outright: `most` is exactly right in the one arm below whose
// band guarantees it. So the guard is the **survivors**, written out. Adding a magnitude claim to a
// graded arm means adding its key here with the arithmetic beside it, which is the same shape every
// other exception list in this file takes.
const MAGNITUDE = /\b(most|repeatedly|almost|nearly|hardly|barely|the majority|effectively never)\b/i;

describe('a graded sentence claims no magnitude its own band cannot carry', () => {
	it('carries only the three whose arithmetic is written out here', () => {
		const claims = localeStrings()
			.filter(([key, value]) => key.includes('verdict') && MAGNITUDE.test(prose(value)))
			.map(([key]) => key);
		// `snapshots.verdict_bad` — "most of it was missed". `snapshotRate` is `ok: 45`, so the arm ends
		//   below 45% caught and more than half was missed at every value it can take. Sound.
		// `debuff.verdict_good` — "Effectively never off the enemy in front of you". `rskUptime` is
		//   `good: 95`, so the arm is at most 5% off. Sound.
		// `casts.verdict_good` was the third and is gone. It ended "Almost nothing went unused" on a band
		//   that opens at `good: 85` for the Windwalker and **80** for the Elemental — one global in five
		//   at worst — and the string is shared, so any claim in it has to hold at the looser of the two.
		//   The sentence already prints the exact share, which is what made the trailing claim both
		//   redundant and wrong at the low end. It now closes on something true at 80: "The globals left
		//   over are the ones hardest to fill." Dropping the clause outright was not available — it would
		//   have left `verdict_good` word-for-word identical to `verdict_bad`, so a reader could not tell
		//   the two apart.
		expect(claims.sort()).toEqual(['debuff.verdict_good', 'snapshots.verdict_bad']);
	});

	it('fires on the two that were removed, so the list is not passing on a broken pattern', () => {
		// Non-vacuity, in the shape the block above uses: the pattern is executed against the two
		// sentences this guard exists because of, rather than only against copy that is already clean.
		const removed: [string, string][] = [
			['tigerPalm.verdict_bad@2026-08-23', 'This happened repeatedly, not just once.'],
			['earthShock.verdict_bad@2026-08-23', 'most went out early'],
			['casts.verdict_bad@phase-3', 'Nearly a third of the pull produced nothing useful.'],
		];
		expect(removed.filter(([, value]) => !MAGNITUDE.test(value)).map(([key]) => key)).toEqual([]);
	});

	/**
	 * The one claim that is carried by arm selection rather than by a band, named so it is not read as
	 * an omission from the list above.
	 *
	 * `brew.verdict_good_other` ends "near the cap every time", which no band could guarantee — a mean
	 * of 9.5 grades `good` with one brew of six spent at seven, and the sentence was live over exactly
	 * that. `BrewBankTimeline` now reaches this arm only on `lean === 0`, where stacks are integers and
	 * a drain takes ten, so the mean is exactly ten. The argument is written at the call site; this
	 * assertion is here so that deleting the gate reddens the voice guard as well as the render tests.
	 */
	it('leaves the one claim a call site guards where its call site can be checked', () => {
		expect(value_of('brew.verdict_good_other')).toContain('near the cap every time');
	});
});

/** One leaf by key, for the two assertions above that name a string rather than sweep for one. */
function value_of(key: string): string {
	const hit = localeStrings().find(([name]) => name === key);
	expect(hit, `no such key: ${key}`).toBeDefined();
	return hit?.[1] ?? '';
}
