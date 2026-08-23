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
 * One list for both specs, and deliberately not extended by this lane: widening the *vocabulary* and
 * widening the *coverage* are two changes, and doing both at once would make it impossible to say
 * which of them a red run came from.
 */
const MODEL_WORDS = [
	'clock',
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
 * flags eight strings that a reader could never see the word in — `casts.presses`, `energy.summary`,
 * `brew.chartLabel` and the four `sef` sentences among them — and a sweep whose reds are mostly noise
 * gets narrowed by the next person rather than obeyed. Nothing is lost by stripping: no placeholder in
 * either spec's in-scope copy carries a banned word anywhere but in a formatter or variable name, and
 * the test below pins that.
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
// two specs share (`castLog`, `timeline`, `damage`, `misses`, `raidBuffs`, `gear`, `priority`,
// `rotation`, `method`, `kpi`, `summary`) is out of scope and stays out; see the note on the boundary
// below.

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

// ================================================================= the strip, pinned

describe('stripping the templates hides no violation', () => {
	/**
	 * The one way `prose()` could be a narrowing rather than a correction: a banned word inside a
	 * placeholder that a reader *does* see, which would be an interpolated value rather than a formatter
	 * or a variable name. There is no such thing in either spec's copy, and this says so — so the day
	 * someone writes `{{verdict}}` into a sentence, this fails instead of the sweep going quiet.
	 */
	it('leaves no banned word inside a placeholder in either spec', () => {
		const swept = [...elementalStrings(), ...windwalkerStrings()];
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
			'sef.justified: {{rule, duration}}',
			'sef.lanes.shortLived_one: {{rule, duration}}',
			'sef.lanes.shortLived_other: {{rule, duration}}',
			'sef.unjustified: {{rule, duration}}',
		]);
	});
});
