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
 * the file, which is why neither spec's sweep runs across all 1109 strings.
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

const LOCALE = resolve(import.meta.dirname, '../../locales/en/report.json');

/** Every leaf string in `report.json`, as `['ascendance.state.plain', 'Pressed …']`. */
const localeStrings = (): [string, string][] => {
	const locale = JSON.parse(readFileSync(LOCALE, 'utf8')) as Record<string, unknown>;
	const out: [string, string][] = [];
	const walk = (node: unknown, path: string[]) => {
		if (typeof node === 'string') out.push([path.join('.'), node]);
		else if (node && typeof node === 'object')
			for (const [key, value] of Object.entries(node)) walk(value, [...path, key]);
	};
	walk(locale, []);
	return out;
};

const violations = (strings: [string, string][]): string[] =>
	strings
		.filter(([, value]) => MODEL_WORDS.some((word) => prose(value).toLowerCase().includes(word)))
		.map(([key, value]) => `${key}: "${value}"`);

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

// Scoped to these sections' own `state.*`, `kpi.*`, `caption`, `intent`, `read.*` and `verdict_*` keys
// — the kinds a reader is shown as prose or as a table cell. Method notes (`unreadable`, `notGraded`,
// `measurable`, `resolution`) are deliberately about our method and are *not* in scope: a hedge has to
// be allowed to explain itself.
//
// `read` joined the four when the Ascendance verdict column landed: those sentences are the newest
// reader-facing copy in the spec and the most tempting place to name a rule arm.
//
// **`verdict` is the sixth, and it needed its own alternative rather than a sixth name in the first
// one.** A graded sentence is stored with its grade inside the same path segment — `verdict_good`,
// `verdict_ok_noOvercap` — so `verdict` in the alternation above matches on neither a `.` nor an end of
// string and selects exactly nothing. That is not a small bug in this pattern: it is why the loudest
// remaining instance of the complaint this file was written about survived every green run of the
// suite. `earthShock.verdict_good` told a reader their shocks "matched the rule the list had for them"
// — our own model's vocabulary, in the one sentence a section is judged by — and no guard could see it.
const ELEMENTAL_READER_KEYS = /(^|\.)(state|kpi|caption|intent|read)(\.|$)|(^|\.)verdict(_|\.|$)/;

const elementalStrings = (): [string, string][] =>
	localeStrings().filter(([key]) => ELEMENTAL_SECTIONS.includes(key.split('.')[0]!) && ELEMENTAL_READER_KEYS.test(key));

describe('the Elemental copy is about the pull, not about the audit', () => {
	it('has reader-facing strings in every section, so the sweep is not vacuous', () => {
		const found = new Set(elementalStrings().map(([key]) => key.split('.')[0]!));
		expect([...found].sort()).toEqual([...ELEMENTAL_SECTIONS].sort());
		expect(elementalStrings().length).toBeGreaterThan(60);
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
		expect(windwalkerStrings().filter(([key]) => ELEMENTAL_READER_KEYS.test(key)).length).toBeLessThan(100);
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
// spec scopes above covered 716 strings on either side of them.
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
		expect(sharedStrings().length).toBeGreaterThan(300);
		// The measurement, done before the selector was chosen rather than after. Copying the Elemental
		// key-kind selector here would have selected 25 of these 311 strings and caught **three** of the
		// 27 below — the three that happen to be called `intent`. The other 24 are `note`, `empty`,
		// `body`, `fix`, `clean`, `mergedNote` and the six bare `priority` leaves: prose at ad-hoc names,
		// the same shape the Windwalker's turned out to be.
		expect(sharedStrings().filter(([key]) => ELEMENTAL_READER_KEYS.test(key)).length).toBeLessThan(30);
		const scoped = new Set(sharedStrings().map(([key]) => key));
		expect(SHARED_REDS.filter((key) => !scoped.has(key))).toEqual([]);
		expect(SHARED_REDS.filter((key) => ELEMENTAL_READER_KEYS.test(key))).toEqual([
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
		// Taken over the section *less* its two in-scope leaves, so the count that keeps the exemption
		// load-bearing is a count of copy the exemption actually still covers. It was 22 with them in and
		// is 20 without, so the two carve-outs did not buy their way past this line either.
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
	 * or a variable name. There is no such thing in any of the three scopes' copy, and this says so — so
	 * the day someone writes `{{verdict}}` into a sentence, this fails instead of the sweep going quiet.
	 *
	 * `priority.summary: {{judged}}` is the ninth, and it came in with the shared scope rather than with
	 * a new string: it was always a variable name rendering a count, and was always unpinned because the
	 * namespace it lives in was outside every scope.
	 */
	it('leaves no banned word inside a placeholder in any of the three scopes', () => {
		const swept = [...elementalStrings(), ...windwalkerStrings(), ...sharedStrings(), ...referenceReaderStrings()];
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
			'priority.summary: {{judged}}',
			'sef.justified: {{rule, duration}}',
			'sef.lanes.shortLived_one: {{rule, duration}}',
			'sef.lanes.shortLived_other: {{rule, duration}}',
			'sef.unjustified: {{rule, duration}}',
		]);
	});
});
