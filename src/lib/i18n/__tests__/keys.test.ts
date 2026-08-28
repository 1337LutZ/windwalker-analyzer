// Every translation key the components ask for must exist.
//
// A missing key is not a crash — i18next hands back the key itself — so the failure mode is a
// section rendering `snapshots.verdict_bad` at a reader in production. Nothing else in the suite
// would catch that, because the component rendered without throwing and the test that mounted it
// only checked that it rendered.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENFORCED_PROFILES } from '~/lib/analysis/enforced';
import { RAID_BUFF_EFFECT_KEYS } from '~/lib/analysis/raidBuffs';
import { GRADE_ORDER } from '~/lib/score/model';
import type { Analysis } from '~/lib/types';
import { ELEMENTAL_SPEC } from '~/specs/elemental';
import { LADDER_ENTRIES as ELE_LADDER } from '~/specs/elemental/lib/apl';
import { THRESHOLDS as ELE_THRESHOLDS } from '~/specs/elemental/lib/score';
import { ROTATION_FLOW as ELE_FLOW } from '~/specs/elemental/lib/view/rotationFlow';
import { LADDER_ENTRIES as PROT_LADDER } from '~/specs/protection/lib/apl';
import { THRESHOLDS as PROT_THRESHOLDS } from '~/specs/protection/lib/score';
import { ROTATION_FLOW as PROT_FLOW } from '~/specs/protection/lib/view/rotationFlow';
import { PROTECTION_SPEC } from '~/specs/protection';
import { timelineBanks as elementalBanks } from '~/specs/elemental/lib/view/timelineBanks';
import { flowKeys } from '~/lib/view/rotationFlow';
import { WW_SPEC } from '~/specs/windwalker';
import { LADDER_ENTRIES as WW_LADDER } from '~/specs/windwalker/lib/apl';
import { THRESHOLDS as WW_THRESHOLDS } from '~/specs/windwalker/lib/score';
import { CROSSOVERS, rotationFlow } from '~/specs/windwalker/lib/view/rotationFlow';
import { timelineBanks as windwalkerBanks } from '~/specs/windwalker/lib/view/timelineBanks';

import i18n, { initI18n } from '../config';

initI18n();

const SRC = resolve(import.meta.dirname, '../../..');

function walk(dir: string): string[] {
	return readdirSync(dir).flatMap((entry) => {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) return entry === 'node_modules' ? [] : walk(path);
		return /\.tsx?$/.test(entry) ? [path] : [];
	});
}

/**
 * Every local helper in one file that takes a copy key and hands it to the translator.
 *
 * `t(` is not the only call that reads a key, and assuming it was made five live keys invisible to
 * this file **in both directions**. Both Elemental tile rows go through a two-line local helper —
 * ``const tile = (key: string, metric: string) => (unasked(metric) ? `${t(key)} — …` : t(key))`` — and
 * `tile('kpi.flameShock', 'flameShockUptime')` contains no `t(` at all. So `kpi.flameShock`,
 * `kpi.snapshotRate`, `kpi.earthShock`, `flameShock.kpi.uptime` and `flameShock.kpi.multiDot` were
 * neither checked for existing nor counted as read by either orphan hunt below.
 *
 * Matched by shape rather than by name, so the next one is covered by the fact of being written: a
 * declaration that names its first parameter `key: string` **and** passes that same `key` to `t`. Both
 * halves are load-bearing — six other helpers in the tree take a `key: string` and none of them is a
 * translator, and one of those is `param('code')`, which as an asked key would fail the check below
 * over the name of a URL parameter.
 */
function keyTakers(source: string): string[] {
	const names = ['t'];
	for (const match of source.matchAll(/\b(?:const|let)\s+(\w+)\s*=\s*\(\s*key:\s*string[^;]*?\bt\(\s*key\b/gs)) {
		if (match[1] !== undefined) names.push(match[1]);
	}
	return names;
}

/**
 * Literal keys only. A computed key — `t('overall.' + grade)` — cannot be checked this way, so those
 * are covered by the enumerated checks in copy.test.ts instead.
 */
function literalKeys(source: string): string[] {
	const keys: string[] = [];
	const call = new RegExp(String.raw`\b(?:${keyTakers(source).join('|')})\(\s*'([a-zA-Z][\w.]*)'`, 'g');
	for (const match of source.matchAll(call)) {
		if (match[1] !== undefined) keys.push(match[1]);
	}
	return keys;
}

/**
 * Keys a call sends to a namespace other than the file's own, by passing `{ ns: … }` to `t`.
 *
 * **`namespaceOf` answers per file, and a per-call override is the one thing it cannot see.** A chart
 * bound to `useTranslation('report')` may still reach one shell string — the tooltip length-labels do,
 * because the words are chart furniture rather than analysis and belong in `ui.json` beside the rest of
 * the shell. Checked against `report` those keys are missing, and the file's own report keys would be
 * missing if it were answered `'ui'`; neither answer is right for a file that reads both by call.
 *
 * So the override is read where it is written. The pair is returned rather than the key alone, because
 * the whole point of this file's namespace handling is that a key existing in the *wrong* namespace is
 * the failure, not a pass — which is what searching both would give.
 */
function overriddenKeys(source: string): Array<[key: string, ns: 'report' | 'ui']> {
	const out: Array<[string, 'report' | 'ui']> = [];
	const call = new RegExp(
		String.raw`\b(?:${keyTakers(source).join('|')})\(\s*'([a-zA-Z][\w.]*)'[^)]*?\bns:\s*'(report|ui)'`,
		'g',
	);
	for (const match of source.matchAll(call)) {
		if (match[1] !== undefined && match[2] !== undefined) out.push([match[1], match[2] as 'report' | 'ui']);
	}
	return out;
}

/**
 * The settings panel's keys, which are computed and so invisible to `literalKeys`.
 *
 * `SettingsDialog` renders whatever schema the spec declares and reaches its copy through the
 * entry's own ``t(`${s.tKey}.label`)`` — so the key that has to exist is a `tKey` value from a spec's
 * schema joined to a suffix from the component. Neither half is a literal key anywhere, which is why
 * renaming a `tKey` without moving the copy renders `settings.ww.leeway.label` at a reader with the
 * whole suite green.
 *
 * Both halves are scanned rather than listed: a fourth suffix added to the dialog, or a threshold
 * added to a spec, is checked by the fact of being written.
 */
function settingsKeys(sources: readonly string[]): string[] {
	const roots = new Set<string>();
	const suffixes = new Set<string>();
	for (const source of sources) {
		for (const match of source.matchAll(/\btKey:\s*'([a-zA-Z][\w.]*)'/g)) {
			if (match[1] !== undefined) roots.add(match[1]);
		}
		for (const match of source.matchAll(/\$\{[\w.]*\btKey\}\.([a-zA-Z][\w.]*)`/g)) {
			if (match[1] !== undefined) suffixes.add(match[1]);
		}
	}
	return [...roots].flatMap((root) => [...suffixes].map((suffix) => `${root}.${suffix}`));
}

/**
 * Whether a key resolves in either namespace, in any of the forms i18next looks for at runtime.
 *
 * A key is legitimately stored only as its suffixed variants: `summary_one` / `summary_other` for a
 * counted string, `verdict_good` / … for a graded one, `withBrew_all` / `_some` for an arbitrary
 * context, and combinations of those. `exists('misses.summary')` is false for all of them, so
 * checking the bare key alone reports working code as broken.
 *
 * Rather than whitelist the suffixes — which silently rots the moment someone invents a new context
 * — this asks whether any leaf under the parent starts with the key's last segment plus `_`.
 */
function siblings(key: string, namespaces: readonly ('report' | 'ui')[]): string[] {
	const parts = key.split('.');
	const leaf = parts.pop() ?? '';
	for (const ns of namespaces) {
		const bundle = i18n.getResourceBundle('en', ns) as Record<string, unknown> | undefined;
		let node: unknown = bundle;
		for (const part of parts) {
			node = typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[part] : undefined;
		}
		if (typeof node === 'object' && node !== null) {
			const hits = Object.keys(node).filter((k) => k === leaf || k.startsWith(`${leaf}_`));
			if (hits.length > 0) return hits;
		}
	}
	return [];
}

function resolves(key: string, ns: Namespace): boolean {
	const namespaces = ns === 'both' ? (['report', 'ui'] as const) : ([ns] as const);
	return namespaces.some((n) => i18n.exists(key, { ns: n })) || siblings(key, namespaces).length > 0;
}

type Namespace = 'report' | 'ui' | 'both';

/**
 * Which namespace a file reads, so a key is checked where the component will actually look for it.
 *
 * Searching both namespaces passes a key that exists in the wrong one — which is exactly how the
 * section nav shipped rendering the literal text `nav.label` at readers while this test stayed
 * green. `useReportCopy` is a wrapper around the `report` namespace.
 *
 * **A file can read both, and then the question is which of the two owns the bare name.** `literalKeys`
 * only ever captures `t(`, so a file that renames the shell translator out of the way — `ReportHeader`
 * destructures it as `tUi` for exactly that reason — has report keys under `t(` and nothing of the
 * `ui` namespace to check. Answering `'ui'` on the strength of the hook call alone reported two live
 * `report` keys as missing; answering `'both'` would have passed them for the wrong reason, which is
 * the failure this function's first paragraph is about. So the alias decides, and every file that reads
 * one namespace is answered exactly as before.
 */
const UI_HOOK = /useTranslation\(\s*'ui'\s*\)/;
/** `const { t: tUi } = useTranslation('ui')` — renamed, so a bare `t(` in this file is not the shell's. */
const UI_RENAMED = /\bt:\s*\w+\s*\}\s*=\s*useTranslation\(\s*'ui'\s*\)/;

function namespaceOf(source: string): Namespace {
	if (UI_HOOK.test(source) && !UI_RENAMED.test(source)) return 'ui';
	if (/useTranslation\(\s*'report'\s*\)/.test(source) || /useReportCopy/.test(source)) return 'report';
	return UI_HOOK.test(source) ? 'ui' : 'both';
}

describe('translation keys', () => {
	// `specs` as well as `components`, because that is where most of a report's sections now live: a
	// spec's own sections and charts sit under `src/specs/<key>/components`, and while this walked only
	// the two generic folders every key they ask for went unchecked — which is the whole failure this
	// test exists to catch, in the half of the tree that grew after it was written.
	const files = walk(join(SRC, 'components')).concat(walk(join(SRC, 'hooks')), walk(join(SRC, 'specs')));

	it('finds the components to check', () => {
		expect(files.length).toBeGreaterThan(10);
	});

	it('every literal key used in a component exists in the locale', () => {
		const missing: string[] = [];
		for (const file of files) {
			const source = readFileSync(file, 'utf8');
			const ns = namespaceOf(source);
			// A key the call sends elsewhere is checked there and nowhere else — see `overriddenKeys`.
			const sentElsewhere = new Map(overriddenKeys(source));
			for (const key of literalKeys(source)) {
				// A section's verdict is stored per grade (`verdict_good`) and all four must exist, or a
				// pull of the missing grade renders a raw key. `<section>.verdict` only — a column
				// happens to be named `verdict` too, and `fistsOfFury.columns.verdict` is an ordinary
				// string, not a graded one.
				const graded = key.split('.').length === 2 && key.endsWith('.verdict');
				const where = sentElsewhere.get(key) ?? ns;
				const exists = graded
					? ['good', 'ok', 'bad', 'none'].every((c) => resolves(`${key}_${c}`, where))
					: resolves(key, where);
				if (!exists) missing.push(`${file.replace(SRC, 'src')} → ${key}`);
			}
		}
		expect(missing, `missing translation keys:\n${missing.join('\n')}`).toEqual([]);
	});

	it('every key the settings panel computes from a spec schema exists in the locale', () => {
		const keys = settingsKeys(files.map((file) => readFileSync(file, 'utf8')));
		expect(
			keys.length,
			'no `tKey` roots or no `${tKey}.…` suffixes found — has the settings panel changed?',
		).toBeGreaterThan(10);
		const missing = keys.filter((key) => !resolves(key, 'ui'));
		expect(missing, `missing settings keys:\n${missing.join('\n')}`).toEqual([]);
	});
});

/**
 * The other direction: copy nothing reads.
 *
 * The suite above proves every key a component asks for exists. It says nothing about the reverse, and
 * that gap shipped: `settings.ele.flameShock` sat in `ui.json` for the length of a migration after the
 * setting it belonged to was retired, because the only thing that would have noticed was a human
 * reading the file. Dead copy is not harmless — it is the thing a translator translates and the thing
 * the next person copies when adding a fourth spec's threshold.
 *
 * **`ui` here, `report` in the block after it.** Every key in the shell namespace is reached one of two
 * statically visible ways: a literal `t('steps.fight')`, or a spec schema's `tKey` joined to a suffix
 * the settings dialog writes, so this hunt needs no model of anything. `report` is not like that — it is
 * reached through `verdict()`, through grade contexts and through `copyPrefix` templates — and for the
 * whole life of the project that was taken as a reason not to hunt it at all, on the argument that a
 * "is this literal string present" sweep would report hundreds of live keys as dead. The argument was
 * right about the sweep and wrong about the conclusion: `grade.good`, `grade.ok`, `grade.bad` and
 * `grade.unmeasured` arrived in the initial commit, were never read at any point in the file's history,
 * and survived every green run until a human read the file. The block at the bottom of this file models
 * the three routes instead of giving up in front of them.
 */
describe('shell copy with no reader', () => {
	const UI = JSON.parse(readFileSync(join(SRC, 'locales/en/ui.json'), 'utf8')) as Record<string, unknown>;

	/** Every leaf as a dotted path, with any `_context` / `_plural` suffix taken back off. */
	function leaves(): string[] {
		const out = new Set<string>();
		const visit = (node: unknown, path: string) => {
			if (typeof node !== 'object' || node === null) {
				out.add(path.replace(/_[a-z]+$/, ''));
				return;
			}
			for (const [key, value] of Object.entries(node)) visit(value, path === '' ? key : `${path}.${key}`);
		};
		visit(UI, '');
		return [...out].sort();
	}

	it('carries no key nothing asks for', () => {
		// `lib` and `layouts` as well, because a key is a key wherever it is asked for: the credits
		// summary is built outside `components/`, and an orphan hunt that cannot see its reader would
		// report live copy as dead.
		const sources = walk(join(SRC, 'components'))
			.concat(walk(join(SRC, 'hooks')), walk(join(SRC, 'specs')), walk(join(SRC, 'lib')), walk(join(SRC, 'layouts')))
			.map((file) => readFileSync(file, 'utf8'));

		const asked = new Set(sources.flatMap((source) => literalKeys(source)).concat(settingsKeys(sources)));
		expect(asked.size, 'no keys found in the source — has the `t(...)` call shape changed?').toBeGreaterThan(20);

		const orphans = leaves().filter((key) => !asked.has(key));
		expect(orphans, `shell copy nothing reads:\n${orphans.join('\n')}`).toEqual([]);
	});
});

/**
 * The same question asked of the analysis namespace, which the hunt above declined to ask.
 *
 * `report.json` is 1182 strings and it had no orphan guard at all, which is why four reader-facing
 * grade labels — `grade.good`, `grade.ok`, `grade.bad`, `grade.unmeasured` — sat in it from the initial
 * commit to the day a human read the file. `git log --all -S"grade.good"` over the components is empty:
 * nothing ever read them, at any point, and nothing in a suite of two thousand tests noticed.
 *
 * The reason there was no guard is real, and it is not defeated by loosening the pattern until the reds
 * go away. A key in this namespace is reached four ways, and only the first is a string you can grep
 * for:
 *
 *   1. **Written out.** `t('snapshots.title')`, `tile('kpi.earthShock', …)`, and — the route a `t(`-anchored
 *      scan misses — a key held in a table or a ternary and handed to the translator elsewhere:
 *      `` core: 'nav.groups.core' `` in `SectionNav`, `t(cond ? 'castLog.tip.spentOpen' : 'castLog.tip.spentNone')`
 *      in `CastTimeline`. So the whole source is read for quoted key paths, not just the argument of a
 *      `t(`. Comments cost nothing here: this project quotes keys in backticks when it talks about them,
 *      so a mention in prose does not look like a string literal.
 *   2. **`verdict()`.** `useReportCopy` turns `verdict('snapshots', …)` into
 *      `t('snapshots.verdict', { context: <grade> })`, and its `exempt` arm into an explicit key list. The
 *      section name is the literal at the call site and the arm is appended at runtime, so the pair is
 *      recovered from both halves: every `verdict('<name>')` in the tree, joined to every `${section}.…`
 *      template inside the hook.
 *   3. **Contexts.** i18next appends `_<context>` — and then `_one` / `_other` on top of that — to a stem
 *      it was never given in the source. So a stored leaf is read if *any* of its stems is asked:
 *      `brew.verdict_good_one` is read because `brew.verdict` is.
 *   4. **`copyPrefix` templates.** ``t(`${copyPrefix}.title`)`` in a generic section, with the prefix
 *      arriving as a prop. Both halves are scanned, the same way `copyPrefix.test.ts` scans them.
 *
 * Every one of those is derived from the source rather than listed here, so the guard cannot be quietly
 * out-grown. Two of them used to resolve a *shape* and not a value — `rotation.entry.<anything>.name` was
 * read and `<anything>.detail` was not, so a retired rule id's strings survived — and that blind spot is
 * closed by `KEY_SOURCES` below: every interpolation is now expanded against the declaration that owns
 * its keys. It found two, and the reason it could is written above `it('holds a card for every metric
 * that can lead the summary')`. A guard that resolves nothing passes an orphan hunt trivially, so each
 * source's own values, each family's reach, and the model's totals are all asserted too.
 */
describe('report copy with no reader', () => {
	const REPORT = JSON.parse(readFileSync(join(SRC, 'locales/en/report.json'), 'utf8')) as Record<string, unknown>;

	/**
	 * Production sources only, and `__tests__` deliberately left out.
	 *
	 * A key whose only reader is a test is dead copy with an alibi. The `ui` hunt above reads the test
	 * files as well, because there its looser scope costs nothing; here it would keep a string alive
	 * because one assertion mentions it. Nothing is lost — every one of the sixteen orphans this found
	 * on the day it was written was unmentioned in the tests too.
	 */
	const SOURCES = walk(join(SRC, 'components'))
		.concat(walk(join(SRC, 'hooks')), walk(join(SRC, 'specs')), walk(join(SRC, 'lib')), walk(join(SRC, 'layouts')))
		.filter((file) => !file.includes('__tests__'))
		.map((file) => readFileSync(file, 'utf8'));

	/** What an interpolation folds down to. One `*` stands for one whole path segment's worth of runtime value. */
	const HOLE = '*';
	/** A dotted path of at least two segments, `*` allowed where an interpolation was. */
	const KEY_PATH = /^[A-Za-z*][\w.*-]*\.[\w.*-]+$/;

	/**
	 * The argument text of every `t(...)` call, found by counting parentheses.
	 *
	 * Anchoring the template scan to the call rather than reading every backtick in the file is what
	 * keeps a comment out of the model: `SectionNav`'s own note says it uses literal keys "rather than
	 * `nav.groups.${group}` assembled at the call site", and a scan of all backticks takes that sentence
	 * as a live route and would then accept a dead `nav.groups.*` for ever.
	 */
	function translatorCalls(source: string): string[] {
		const calls: string[] = [];
		for (const match of source.matchAll(/\bt\(/g)) {
			let depth = 1;
			let index = match.index + match[0].length;
			const start = index;
			while (index < source.length && depth > 0) {
				if (source[index] === '(') depth++;
				else if (source[index] === ')') depth--;
				index++;
			}
			calls.push(source.slice(start, index - 1));
		}
		return calls;
	}

	/** Every key-shaped template inside a `t(...)`, kept in both forms: as written, and folded to a shape. */
	function computedKeys(source: string): { raw: string; folded: string }[] {
		const found: { raw: string; folded: string }[] = [];
		for (const call of translatorCalls(source)) {
			for (const match of call.matchAll(/`([^`]*\$\{[^`]*)`/g)) {
				const raw = match[1];
				if (raw === undefined) continue;
				const folded = raw.replaceAll(/\$\{[^}]*\}/g, HOLE);
				if (KEY_PATH.test(folded)) found.push({ raw, folded });
			}
		}
		return found;
	}

	/**
	 * Every quoted key path anywhere in a file, not only the ones sitting in a `t(`.
	 *
	 * Two live routes put the string somewhere else and hand it over later — a `Record` of keys indexed
	 * by a mode (`SectionNav`'s nav groups, `TargetModeControl`'s four labels) and a ternary chosen
	 * inside the call (`CastTimeline`'s six tooltips). Both are as statically visible as `t('x.y')`; only
	 * the regex was narrower than they are. At least one dot, so `'auto'` and `'S256'` are not keys.
	 */
	function quotedKeys(source: string): string[] {
		const keys: string[] = [];
		for (const match of source.matchAll(/'([A-Za-z][\w.-]*\.[\w.-]+)'/g)) {
			if (match[1] !== undefined) keys.push(match[1]);
		}
		return keys;
	}

	/** The sections `verdict()` is asked for, which is the half of a graded key that is written down. */
	function verdictSections(): string[] {
		const sections = new Set<string>();
		for (const source of SOURCES) {
			for (const match of source.matchAll(/\bverdict\(\s*'(\w+)'/g)) {
				if (match[1] !== undefined) sections.add(match[1]);
			}
		}
		return [...sections].sort();
	}

	/**
	 * Every section the scorecard can draw a card for, which is not the same set as `verdictSections`.
	 *
	 * Read off each spec's own `section([...])` calls rather than listed here, so a section added to a
	 * spec is covered by the fact of being added. `potions` is why this exists: it scores one metric,
	 * stores no graded sentence, and its heading is drawn by `Scorecard` off the same computed template
	 * every other section's is.
	 */
	function scoreSections(): string[] {
		const sections = new Set<string>();
		for (const source of SOURCES) {
			for (const match of source.matchAll(/^\s*(\w+): section\(/gm)) {
				if (match[1] !== undefined) sections.add(match[1]);
			}
		}
		return [...sections].sort();
	}

	/** The prefixes a `copyPrefix` is given. Same two spellings `copyPrefix.test.ts` looks for. */
	function copyPrefixes(): string[] {
		const prefixes = new Set<string>();
		for (const source of SOURCES) {
			for (const match of source.matchAll(/\bcopyPrefix(?::\s*|=)'(\w+)'/g)) {
				if (match[1] !== undefined) prefixes.add(match[1]);
			}
			for (const match of source.matchAll(/\bcopyPrefix="(\w+)"/g)) {
				if (match[1] !== undefined) prefixes.add(match[1]);
			}
		}
		return [...prefixes].sort();
	}

	type Route = 'written' | 'verdict' | 'copyPrefix' | 'computed';

	interface Pattern {
		readonly segments: readonly (string | RegExp)[];
		readonly route: Route;
		/** The folded shape this came from, on the computed patterns only, so a family's reach can be counted. */
		readonly family?: string;
	}

	/** One path segment: itself, or a pattern for the segment a runtime value will fill in. */
	function segment(text: string): string | RegExp {
		if (!text.includes(HOLE)) return text;
		const literals = text.split(HOLE).map((part) => part.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`));
		// `[\w-]` and not `\w`: half the computed families are keyed by a hyphenated rule id —
		// `priority.rule.rising-sun-kick`, `ascendance.read.fault.opener-late`.
		return new RegExp(`^${literals.join(String.raw`[A-Za-z][\w-]*`)}$`);
	}

	/**
	 * Every route, as a list of patterns to match a stored path against.
	 *
	 * **Every** interpolation is expanded against the values the source gives it rather than folded to a
	 * `*`, which is the difference between a guard and a rubber stamp: `*.verdict` would accept a graded
	 * sentence under a section nothing grades, and `rotation.entry.*.name` a rung no spec's list still
	 * draws, which is precisely the dead copy being hunted. `${section}` and `${copyPrefix}` were the
	 * first two; the families in `FAMILY_SOURCE` are the rest, each against the declaration that
	 * owns its keys. `${s.tKey}` is dropped — those are the settings panel's, and they are `ui`.
	 *
	 * A family with no source, or one holding two interpolations, still falls back to the shape. There are
	 * none of either today and `SHAPE_ONLY` says so; the fallback is what keeps the next one visible
	 * instead of unreachable.
	 */
	function patterns(): Pattern[] {
		const built: Pattern[] = [];
		const add = (path: string, route: Route, family?: string) =>
			built.push({ segments: path.split('.').map(segment), route, family });
		const computed = new Map<string, string>();
		for (const source of SOURCES) {
			for (const key of quotedKeys(source)) add(key, 'written');
			for (const { raw, folded } of computedKeys(source)) computed.set(folded, raw);
		}
		for (const [folded, raw] of computed) {
			// `folded.slice(1)` drops the leading `*`, leaving `.verdict` / `.title` to join to each value.
			if (raw.startsWith('${copyPrefix}.')) {
				for (const prefix of copyPrefixes()) add(`${prefix}${folded.slice(1)}`, 'copyPrefix');
			} else if (raw.startsWith('${section}.')) {
				for (const section of verdictSections()) add(`${section}${folded.slice(1)}`, 'verdict');
				// `Scorecard` reads `${section}.title` for every *scored* section, and a scored section need
				// not store a verdict: `potions` grades one metric and has no graded sentence, so its heading
				// was reported as copy nothing reads while the card was rendering it. Only `.title` is widened
				// — a verdict arm really is stored by the verdict sections and nobody else.
				if (folded === '*.title') for (const section of scoreSections()) add(`${section}.title`, 'computed');
			} else if (!raw.startsWith('${s.tKey}.')) {
				const source = KEY_SOURCES[FAMILY_SOURCE[folded] ?? ''];
				const live = source === undefined ? [] : source.keys();
				// One hole, so `folded.replace` puts the value where the interpolation was — which is inside a
				// segment and not always the whole of one: `castLog.target.*Title` is one of those.
				if (live.length > 0 && folded.split(HOLE).length === 2) {
					for (const key of live) add(folded.replace(HOLE, key), 'computed', folded);
				} else add(folded, 'computed', folded);
			}
		}
		return built;
	}

	/** Every leaf in `report.json`, as a dotted path with its suffixes left on. */
	function leaves(): string[] {
		const out: string[] = [];
		const visit = (node: unknown, path: string) => {
			if (typeof node !== 'object' || node === null) {
				out.push(path);
				return;
			}
			for (const [key, value] of Object.entries(node)) visit(value, path === '' ? key : `${path}.${key}`);
		};
		visit(REPORT, '');
		return out;
	}

	/**
	 * Every stem a stored leaf could have been asked for by, longest first.
	 *
	 * `verdict_good_one` is reached by asking for `verdict` and letting i18next append the grade and then
	 * the plural, so all three of `verdict_good_one`, `verdict_good` and `verdict` have to count. Peeled
	 * rather than matched against a list of known contexts, for the reason the `siblings` helper above
	 * gives: a whitelist of suffixes rots the moment someone invents a context.
	 */
	function stems(leaf: string): string[] {
		const out = [leaf];
		let stem = leaf;
		while (stem.includes('_')) {
			stem = stem.slice(0, stem.lastIndexOf('_'));
			out.push(stem);
		}
		return out;
	}

	/** How a stored path is reached, or null if nothing reaches it. `shape` is true where a `*` was involved. */
	function reached(path: string, all: readonly Pattern[]): { route: Route; shape: boolean } | null {
		const parts = path.split('.');
		const leaf = parts.pop() ?? '';
		for (const stem of stems(leaf)) {
			const full = [...parts, stem];
			for (const pattern of all) {
				if (pattern.segments.length !== full.length) continue;
				let shape = false;
				const hit = full.every((part, i) => {
					const want = pattern.segments[i];
					if (want === undefined) return false;
					if (typeof want === 'string') return want === part;
					shape = true;
					return want.test(part);
				});
				if (hit) return { route: pattern.route, shape: shape || stem !== leaf };
			}
		}
		return null;
	}

	/**
	 * A module read for one declaration, with its comments taken out first.
	 *
	 * The prose in this project quotes example values, and `AscendanceReason`'s own arms are documented
	 * one doc-comment each — so a scan that read the comments would take "the sim's own rule" for two
	 * arms named `s own rule` and `nothing-to-hit` would arrive beside a dozen fragments of English.
	 */
	function declaringModule(path: string): string {
		return readFileSync(join(SRC, path), 'utf8').replaceAll(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
	}

	/**
	 * The string literals of one declaration, from the head this finds it by to the `;` that ends it.
	 *
	 * For the sources that are a **type** rather than a value, which is most of the press-reason families:
	 * `AscendanceFault` and `EarthShockReason` are unions, and a union has nothing to import. Read out of
	 * the module that declares it, so a retired arm takes its copy with it in the same commit or fails
	 * here — which is the whole point of the exercise and cannot be had from a second list kept in a test.
	 */
	function declaredArms(path: string, head: RegExp, pick = /'([\w-]+)'/g): string[] {
		const source = declaringModule(path);
		const at = head.exec(source);
		if (at === null) return [];
		const rest = source.slice(at.index + at[0].length);
		const end = rest.indexOf(';');
		return [...(end < 0 ? rest : rest.slice(0, end)).matchAll(pick)].map((match) => match[1] ?? '');
	}

	/** The unfiltered flow: every rung of the Windwalker's priority list, at every band, either side of the fork. */
	const FLOW = rotationFlow({ band: null, pressed: new Set<number>(), rune: null });

	/**
	 * Every rung of every spec's rotation reference, forks flattened.
	 *
	 * `rotation.entry.*` and `rotation.gate.*` stopped being the Windwalker's families when the flowchart
	 * moved to `components/rotation` and the Elemental's `rotation.rule.*` was migrated onto them: one
	 * chart reads one convention, so one namespace holds all three specs' rungs the way `priority.rule.*`
	 * already holds all three ladders' labels. A source that still named only the Windwalker's would have
	 * marked thirty-three live rungs as copy nothing asks for.
	 */
	const ALL_FLOWS = [...FLOW, ...ELE_FLOW, ...PROT_FLOW];
	const FLOW_BRANCHES = ALL_FLOWS.flatMap((slot) => ('fork' in slot ? slot.branches : [slot.entry]));

	/**
	 * The literals a family's own interpolation writes down — `${totem.duringAscendance ? 'x' : 'y'}`.
	 *
	 * One family's key source is the call site itself: a ternary inside the template chooses between two
	 * spellings, so the folded `*` has a live set of exactly two and both are already in the tree. Read
	 * from the call rather than listed here for the same reason as everything else in this table.
	 */
	function selfNamed(shape: string): string[] {
		const out = new Set<string>();
		for (const source of SOURCES) {
			for (const { raw, folded } of computedKeys(source)) {
				if (folded !== shape) continue;
				for (const hole of raw.matchAll(/\$\{([^}]*)\}/g)) {
					for (const literal of (hole[1] ?? '').matchAll(/'([\w-]+)'/g)) out.add(literal[1] ?? '');
				}
			}
		}
		return [...out];
	}

	/**
	 * A minimal audit, for the one source that is a function rather than a declaration.
	 *
	 * Each spec's counter row is named by its own `timelineBanks`, which takes an `Analysis` and returns
	 * nothing at all for a pull that never carried the bar. So the key is asked of the live function with
	 * the least the function reads, and a rename inside it moves this test rather than escaping it. The
	 * cast is deliberate: an `Analysis` is a whole pull and none of the rest of it is read here.
	 */
	function bankKeys(): string[] {
		const brew = { brew: { bankTimeline: [[0, 1]] } } as unknown as Analysis;
		const shield = { lightningShield: { maxStacks: 7, points: [[0, 1]], badSpends: [] } } as unknown as Analysis;
		return [...windwalkerBanks(brew), ...elementalBanks(shield)].map((bank) => bank.key);
	}

	/** A live set of values one `*` can stand for, and the declaration it is read from. */
	interface KeySource {
		/** Where the values live, so the next reader can go and check the claim rather than trusting it. */
		readonly where: string;
		readonly keys: () => readonly string[];
		/**
		 * The values, written out.
		 *
		 * A count survives a refactor that keeps the shape and loses half the arms — the failure
		 * `VERDICT_ARMS` below is written out against, and the one an orphan hunt cannot see, because
		 * fewer live keys means fewer reds rather than more. The list is the alarm.
		 */
		readonly pinned: readonly string[];
	}

	/**
	 * Every key source a computed family resolves against, so the `*` is a live set and not a wildcard.
	 *
	 * The blind spot this closes: the guard could hold that `rotation.entry.<x>.name` is read and
	 * `rotation.entry.<x>.detail` is not, but **not that any particular `<x>` is still something a spec
	 * declares** — so a retired rule id's or metric key's strings survived it. That is the shape that let
	 * four `grade.*` labels sit unread from the first commit until a human read the file.
	 *
	 * It is the same argument the `${section}` expansion above already makes and for the same reason:
	 * `*.verdict` would accept a graded sentence under a section nothing grades. `rotation.entry.*.name`
	 * would accept a rung dropped from a spec's list, and `summary.takeaways.metric.*.fix` a metric the
	 * model stopped weighing — which is exactly what it was sheltering. See the reds in `it('carries no
	 * key nothing asks for')`.
	 */
	const KEY_SOURCES: Record<string, KeySource> = {
		ascendanceFault: {
			where: 'lib/types.ts → AscendanceFault',
			keys: () => declaredArms('lib/types.ts', /export type AscendanceFault =/),
			pinned: ['discharge-too-short', 'late-into-haste', 'no-banner', 'opener-late', 'window-past-the-kill'],
		},
		ascendanceReason: {
			where: 'specs/elemental/lib/ascendance.ts → AscendanceReason',
			keys: () => declaredArms('specs/elemental/lib/ascendance.ts', /export type AscendanceReason =/),
			pinned: [
				'ascendance-up-at-the-pull',
				'no-two-piece-evidence',
				'nothing-to-hit',
				'pressed-in-aoe',
				'pull-ends-too-soon',
				't16-2pc-not-in-log',
			],
		},
		// The bars the cast log draws a lane for: each spec's own `resources`, the counter row its
		// `timelineBanks` adds beside them, and the bars a spec computes for itself rather than declaring.
		//
		// **All three halves, because all three reach the same copy.** `extraResources` is the last of
		// them and the one a key list cannot discover: a declared bar is a `resources` entry that can be
		// read off the config, while an extra one is built inside a function at analysis time. Naming its
		// keys here is the price of the seam — see `SpecConfig.extraResources`.
		castLogBar: {
			where: 'every spec’s `SpecConfig.resources`, its `extraResources`, and its `timelineBanks`',
			keys: () => [
				...Object.keys(WW_SPEC.resources ?? {}),
				...Object.keys(ELEMENTAL_SPEC.resources ?? {}),
				...Object.keys(PROTECTION_SPEC.resources ?? {}),
				...EXTRA_RESOURCE_KEYS,
				...bankKeys(),
			],
			pinned: ['brew', 'chi', 'energy', 'holyPower', 'lightningShield', 'mana', 'vengeance'],
		},
		castLogGrouping: {
			where: 'components/charts/CastTimeline.tsx → GROUPINGS',
			keys: () => declaredArms('components/charts/CastTimeline.tsx', /const GROUPINGS: readonly Grouping\[\] =/),
			pinned: ['auto', 'off', 'on'],
		},
		crossover: {
			where: 'specs/windwalker/lib/view/rotationFlow.ts → CROSSOVERS',
			keys: () => CROSSOVERS.map((crossover) => crossover.copy),
			pinned: ['rjw', 'sck', 'sckOverRsk', 'sef'],
		},
		earthElementalState: {
			where: 'specs/elemental/components/sections/EarthElemental.tsx → STATE_KEY',
			keys: () =>
				declaredArms(
					'specs/elemental/components/sections/EarthElemental.tsx',
					/const STATE_KEY: Record<EarthElementalVerdict, string> =/,
					// The record's values and not its keys: the copy is filed under the spelling the component
					// hands the translator, and the verdict names on the left are the audit's own.
					/:\s*'([\w-]+)'/g,
				),
			pinned: ['nearEnd', 'offRule', 'unknown'],
		},
		earthShockReason: {
			where: 'lib/types.ts → EarthShockReason',
			keys: () => declaredArms('lib/types.ts', /export type EarthShockReason =/),
			pinned: [
				'ascActive',
				'ascReady',
				'belowFull',
				'cleaveDot',
				'cleaveStacks',
				'fsLow',
				'fsTail',
				'twoPiece',
				'twoPieceEarly',
			],
		},
		elementalMasteryReason: {
			where: 'lib/types.ts → ElementalMasteryPress.reason',
			keys: () => declaredArms('lib/types.ts', /export interface ElementalMasteryPress \{[\s\S]*?\breason:/),
			pinned: ['off-far', 'off-near', 'opener', 'sync', 't15'],
		},
		fireElementalReason: {
			where: 'lib/types.ts → FireElementalPress.reason',
			keys: () => declaredArms('lib/types.ts', /export interface FireElementalPress \{[\s\S]*?\breason:/),
			pinned: ['early', 'near-end', 'prepull', 'sync'],
		},
		flameShockKind: {
			where: 'lib/types.ts → FlameShockPressKind',
			keys: () => declaredArms('lib/types.ts', /export type FlameShockPressKind =/),
			pinned: ['apply', 'ascPrep', 'early', 'late', 'reapply', 'snapshot', 'windowed'],
		},
		flowEntry: {
			where:
				'every spec’s rotation flow — windwalker `rotationFlow` at every band, elemental and protection `ROTATION_FLOW`',
			keys: () => flowKeys(ALL_FLOWS),
			pinned: [
				'ascendance',
				'avengers-shield',
				'avengers-shield-grand-crusader',
				'blackoutKick',
				'blackoutKickDump',
				'chain-lightning',
				'chiBrew',
				'chiBurst',
				'chiWave',
				'comboBreakerKick',
				'consecration',
				'consecration-multi',
				'craneOverKick',
				'crusader-strike',
				'crusader-strike-holy-avenger',
				'earth-elemental',
				'earth-shock',
				'elemental-blast',
				'elemental-mastery',
				'energizingBrew',
				'execution-sentence',
				'fire-elemental',
				'fistsOfFury',
				'flame-shock-asc-prep',
				'flame-shock-multidot',
				'flame-shock-snapshot',
				'hammer-of-the-righteous',
				'hammer-of-the-righteous-holy-avenger',
				'hammer-of-wrath',
				'holy-prism',
				'holy-wrath',
				'invokeXuen',
				'jab',
				'jade-serpent-potion',
				'judgment',
				'judgment-sanctified-wrath',
				'lava-beam',
				'lava-burst',
				'lightning-bolt',
				'lights-hammer',
				'risingSunKickCooldown',
				'risingSunKickHold',
				'risingSunKickMulti',
				'rushingJadeWind',
				'rushingJadeWindMulti',
				'sacred-shield',
				'sacred-shield-refresh',
				'searing-totem',
				'spinningCraneKick',
				'stormEarthAndFire',
				'tigerPalmProc',
				'tigerPalmRefresh',
				'tigereyeBrewBank',
				'tigereyeBrewRune',
				'touchOfDeath',
				'unleash-elements',
				'zenSphere',
			],
		},
		// Forks, from all three flows and found only in one: neither the Elemental's `ROTATION` nor the
		// Protection's `LADDER` holds an entry the reader's build or the pack in front of them picks
		// between, so all four of these are the Windwalker's. Read from the union anyway, so the day a
		// second spec grows one it is covered by the fact of being written.
		flowFork: {
			where: 'the forks every spec’s unfiltered rotation flow keeps',
			keys: () => ALL_FLOWS.flatMap((slot) => ('fork' in slot ? [slot.fork] : [])),
			pinned: ['blackoutKick', 'risingSunKick', 'talent', 'tigereyeBrew'],
		},
		// The chips, and only the rungs that carry one. Not every rung in the flow: a gate chip on a rung
		// with nothing to gate is dead copy of exactly the kind being hunted, so the narrower set is used.
		flowGate: {
			where: 'the gated rungs of every spec’s unfiltered rotation flow',
			keys: () => FLOW_BRANCHES.filter((entry) => entry.gated).map((entry) => entry.key),
			pinned: [
				'blackoutKick',
				'blackoutKickDump',
				'consecration',
				'consecration-multi',
				'craneOverKick',
				'crusader-strike',
				'crusader-strike-holy-avenger',
				'elemental-blast',
				'execution-sentence',
				'hammer-of-the-righteous',
				'hammer-of-the-righteous-holy-avenger',
				'holy-prism',
				'judgment-sanctified-wrath',
				'lights-hammer',
				'risingSunKickCooldown',
				'risingSunKickHold',
				'rushingJadeWindMulti',
				'sacred-shield',
				'sacred-shield-refresh',
				'spinningCraneKick',
				'stormEarthAndFire',
				'tigereyeBrewBank',
				'tigereyeBrewRune',
				'unleash-elements',
			],
		},
		/**
		 * The two kinds of excuse a boss rule can carry, and they are not equally strong — a `lockout` was
		 * measured off the press stream and a `declared` is a reader's judgement about a phase. The report
		 * prints which one it applied rather than flattening them, so both need a word.
		 */
		enforcedBasis: {
			where: 'lib/analysis/enforced.ts → EnforcedRule.basis',
			keys: () => ['lockout', 'declared'],
			pinned: ['declared', 'lockout'],
		},
		/**
		 * The encounters whose profile has something to say that its rules do not, one note apiece.
		 *
		 * A live set and not a wildcard for the reason the block above gives: these notes are mostly
		 * about rules that were *refused*, and a boss that later earns a real rule loses its note. Left
		 * as `*` the retired paragraph would sit in the tree unread, which is the exact shape the four
		 * unread `grade.*` labels had.
		 */
		enforcedNote: {
			where: 'lib/analysis/enforced.ts → EnforcedProfile.noteKey',
			keys: () => ENFORCED_PROFILES.map((profile) => profile.noteKey).filter((key) => key !== undefined),
			pinned: [
				'fallen-protectors',
				'galakras',
				'garrosh-hellscream',
				'general-nazgrim',
				'immerseus',
				'iron-juggernaut',
				'kor-kron-dark-shaman',
				'malkorok',
				'norushen',
				'paragons-of-the-klaxxi',
				'sha-of-pride',
				'siegecrafter-blackfuse',
				'spoils-of-pandaria',
				'thok-the-bloodthirsty',
			],
		},
		gate: {
			where: 'lib/game/model.ts → Gate',
			keys: () => declaredArms('lib/game/model.ts', /export type Gate =/),
			pinned: ['chi', 'conditional', 'cooldown', 'energy', 'holy-power', 'other'],
		},
		grade: {
			where: 'lib/score/model.ts → GRADE_ORDER',
			keys: () => GRADE_ORDER,
			pinned: ['bad', 'good', 'ok'],
		},
		// Both specs' ladders, because one shared `priority.rule.*` root holds both lists' rule ids.
		ladderRule: {
			where: 'all three specs’ `LADDER_ENTRIES`',
			keys: () => [...WW_LADDER, ...ELE_LADDER, ...PROT_LADDER].map((entry) => entry.key),
			pinned: [
				'avengers-shield',
				'avengers-shield-grand-crusader',
				'blackout-kick',
				'chain-lightning',
				'chi-wave',
				'combo-breaker-kick',
				'combo-breaker-palm',
				'consecration',
				'consecration-multi',
				'crusader-strike',
				'crusader-strike-holy-avenger',
				'earth-shock',
				'elemental-blast',
				'execution-sentence',
				'fists-of-fury',
				'flame-shock',
				'hammer-of-the-righteous',
				'hammer-of-the-righteous-holy-avenger',
				'hammer-of-wrath',
				'holy-prism',
				'holy-wrath',
				'jab',
				'judgment',
				'judgment-sanctified-wrath',
				'lava-beam',
				'lava-burst',
				'lightning-bolt',
				'lights-hammer',
				'rising-sun-kick',
				'rising-sun-kick-filler',
				'rushing-jade-wind',
				'rushing-jade-wind-open',
				'sacred-shield',
				'sacred-shield-refresh',
				'searing-totem',
				'spinning-crane-kick',
				'spinning-crane-kick-heavy',
				'tiger-palm-refresh',
				'unleash-elements',
			],
		},
		raidBuffEffect: {
			where: 'lib/analysis/raidBuffs.ts → RAID_BUFF_EFFECT_KEYS',
			keys: () => RAID_BUFF_EFFECT_KEYS,
			pinned: ['attackPower', 'crit', 'mastery', 'meleeHaste', 'spellHaste', 'spellPower', 'stats'],
		},
		stormlashState: {
			where: 'the ternary inside the call in specs/elemental/components/sections/Stormlash.tsx',
			keys: () => selfNamed('stormlash.state.*'),
			pinned: ['duringAscendance', 'yours'],
		},
		/**
		 * The metrics that can lead the summary, which is **not** every metric either spec grades.
		 *
		 * `Takeaways` skips a metric whose weight is zero — "a metric the model does not count cannot lead
		 * the summary either" — so `THRESHOLDS` is the wrong source here by three keys, and the difference is
		 * the point: all three (`snapshotDepth`, `karmaEmpty`, `karmaCapShare`) have no card copy at all.
		 * Both of the Windwalker's readings, because a multi-target pull weighs one metric the single-target
		 * reading does not.
		 *
		 * **It was four, and the fourth was `fireElementalHasteUptime`** — the metric this file's
		 * `holds a card for every metric that can lead the summary` was written for. Its weight has since
		 * gone from 0 to 1 (see `specs/elemental/lib/score.ts`' `WEIGHTS`), so it is now a metric that can
		 * deal a card and it is pinned below as one. That is the guard doing exactly what it was left here
		 * to do: it asks for the two deleted strings back rather than letting a computed key print at a
		 * reader.
		 */
		/**
		 * Every metric either spec grades — the row headings the scorecard grid draws.
		 *
		 * Wider than `takeawayMetric` below by exactly the metrics weighted zero: `snapshotDepth`,
		 * `karmaEmpty` and `karmaCapShare` never lead the summary and so never need a `fix`, but the grid
		 * draws them under their section like any other number and a row without a heading would print a
		 * computed key at a reader.
		 */
		scorecardMetric: {
			where: 'both specs’ `THRESHOLDS`',
			keys: () => [
				...new Set([...Object.keys(WW_THRESHOLDS), ...Object.keys(ELE_THRESHOLDS), ...Object.keys(PROT_THRESHOLDS)]),
			],
			pinned: [
				'ascendanceBanner',
				'ascendanceIntoHaste',
				'ascendanceLatePresses',
				'ascendanceOpener',
				'brewCapWaste',
				'brewShortUses',
				'brewStacks',
				'cooldownsMissed',
				'earthShockWaste',
				'elementalDischargeUptime',
				'externalsMissed',
				'fireElementalHasteUptime',
				'hasteToBreakpoint',
				'globalsMissed',
				'fireElementalPrepull',
				'flameShockMultiDot',
				'flameShockUptime',
				'flameShockWaste',
				'gcdUtilisation',
				'karmaCapShare',
				'karmaEmpty',
				'lightningShieldFellOff',
				'lightningShieldOvercap',
				'potionsUsed',
				'rskUptime',
				'searingTotemOverlaps',
				'searingTotemUptime',
				'shamanisticRageMissed',
				'snapshotDepth',
				'snapshotRate',
				'thunderstormMissed',
				'tigerPalmWaste',
				'weaveEarly',
				'weaveLateReturn',
				'weaveRate',
			],
		},
	};

	/**
	 * Every computed family in the tree, against the source that decides what its `*` can be.
	 *
	 * The keys of this map are the folded shapes exactly as the scan above collects them, and
	 * `it('names the families it resolves and the ones it cannot')` holds that the two sides agree — so a
	 * fifth indirect route, or a family whose source has been renamed out from under it, cannot arrive
	 * without showing up here.
	 */
	/**
	 * Bars a spec builds in `extraResources` rather than declaring in `resources`.
	 *
	 * Listed by hand because there is nothing to enumerate: the seam hands back a map built at analysis
	 * time, so its keys exist only inside a closure. A spec that adds one and forgets this line fails the
	 * orphan check on its own copy, which is the intended way to find out.
	 */
	const EXTRA_RESOURCE_KEYS = ['vengeance'] as const;

	const FAMILY_SOURCE: Record<string, string> = {
		'ascendance.read.fault.*': 'ascendanceFault',
		'ascendance.read.reason.*': 'ascendanceReason',
		'castLog.resource.*': 'castLogBar',
		'castLog.resourceAria.*': 'castLogBar',
		'castLog.target.*': 'castLogGrouping',
		'castLog.target.*Title': 'castLogGrouping',
		'casts.gate.*': 'gate',
		'earthElemental.state.*': 'earthElementalState',
		'fight.basis.*': 'enforcedBasis',
		'fight.note.*': 'enforcedNote',
		'earthShock.state.*': 'earthShockReason',
		'elementalMastery.state.*': 'elementalMasteryReason',
		'fireElemental.state.*': 'fireElementalReason',
		'flameShock.state.*': 'flameShockKind',
		'overall.*': 'grade',
		'priority.rule.*': 'ladderRule',
		'raidBuffs.effects.*': 'raidBuffEffect',
		'raidBuffs.worth.*': 'raidBuffEffect',
		'rotation.crossover.*': 'crossover',
		// **`rotation.group.*` and `rotation.rule.*` were here and are not any more**, and the two left for
		// different reasons. `rotation.rule.*` was the Elemental's own copy convention for the column of
		// cards it used to draw; the shared flowchart reads one convention, so its leaves were renamed onto
		// `rotation.entry.*` and the family stopped existing. `rotation.group.*` is still live copy — the
		// three stage headings the Elemental's chart draws across the line — but it stopped being
		// *computed*: the keys are literals beside the group they name in
		// `specs/elemental/lib/view/rotationFlow.ts`, because a band's copy key travels to `FlowChart` as a
		// prop rather than through a template inside a `t(...)` call, and only a template is a family. The
		// written-key route reaches all three, and `elemental/lib/view/__tests__/rotationFlow.test.ts`
		// holds the forward half a `KEY_SOURCES` entry used to: that each band names a group `ROTATION`
		// still files rows under, and that all three resolve to real copy rather than to their own key.
		'rotation.entry.*.name': 'flowEntry',
		'rotation.entry.*.test': 'flowEntry',
		'rotation.entry.*.why': 'flowEntry',
		'rotation.fork.*.detail': 'flowFork',
		'rotation.fork.*.title': 'flowFork',
		'rotation.gate.*': 'flowGate',
		'stormlash.state.*': 'stormlashState',
		// **The label reaches further than the fix now, which is why the two families differ.** A `fix`
		// sentence is only ever written on a takeaway card, so its source stays the weighted metrics — a
		// metric the model does not count cannot lead the summary. A `label` is also the row heading on
		// every card of the scorecard grid, which draws *every* metric a section grades including the
		// zero-weighted ones, so its source is the thresholds table itself.
		'summary.takeaways.metric.*.label': 'scorecardMetric',
	};

	/**
	 * How many stored leaves each family accounts for, so no family can resolve its keys and reach nothing.
	 *
	 * The second half of the non-vacuity argument, and the one a per-source list cannot make: `flowEntry`
	 * could hold all twenty-four rung names and still match nothing at all, if the copy under them were
	 * renamed a segment deeper. Counted per family rather than in total, because a total is what hides one
	 * family going to zero behind another that grew.
	 */
	const FAMILY_LEAVES: Record<string, number> = {
		'ascendance.read.fault.*': 5,
		'ascendance.read.reason.*': 6,
		'castLog.resource.*': 7,
		'castLog.resourceAria.*': 7,
		'castLog.target.*': 3,
		'castLog.target.*Title': 3,
		// Five and not six: `Gate` carries an `other` arm and no section prints a column for it.
		'casts.gate.*': 5,
		'earthElemental.state.*': 3,
		'fight.basis.*': 2,
		'fight.note.*': 14,
		'earthShock.state.*': 9,
		'elementalMastery.state.*': 5,
		'fireElemental.state.*': 4,
		// Nine against seven press kinds: `snapshot` stores two narrowings, and the peel counts both.
		'flameShock.state.*': 9,
		'overall.*': 3,
		'priority.rule.*': 39,
		// More than the seven effects, on both: each is stored per spec where the two want different words.
		'raidBuffs.effects.*': 9,
		'raidBuffs.worth.*': 14,
		'rotation.crossover.*': 4,
		// Fifty-seven rungs across the three specs' lists, and forty-one of them with a paragraph behind
		// the box. The gap is the Elemental's sixteen: its rules are one line each with nothing to
		// disclose, which is what `FlowChart`'s `details={false}` says out loud — see the copy-convention
		// note in `lib/view/rotationFlow`.
		'rotation.entry.*.name': 57,
		'rotation.entry.*.test': 57,
		'rotation.entry.*.why': 41,
		'rotation.fork.*.detail': 4,
		'rotation.fork.*.title': 4,
		'rotation.gate.*': 24,
		'stormlash.state.*': 2,
		// Twenty-one cards, three of which store a second wording for a number that needs different
		// advice. The third is `lightningShieldFellOff`'s `fix_neverUp`. A shield never worn grades on a
		// mark standing for "the buff was never up" rather than on a count of drops, so the base card —
		// which prints that mark as a number of drops — is the one wording it must never be handed.
		'summary.takeaways.metric.*.label': 35,
	};

	/**
	 * The families still resolved to a shape and not to a value, listed so the blind spot has a size.
	 *
	 * It was thirty and is none: every family above names a live set, and the ones whose source is a type
	 * rather than a value are read out of the declaring module. Kept as an empty list rather than deleted,
	 * because the next indirect route to arrive in the tree lands here — `it('names the families it
	 * resolves and the ones it cannot')` fails until whoever wrote it either names its key source or names
	 * it here with the reason its source cannot be enumerated.
	 */
	const SHAPE_ONLY: string[] = [];

	/**
	 * Every section that stores a graded sentence, with the arms it stores.
	 *
	 * A count would pass a refactor that dropped `verdict_ok` from every section in the file, which is
	 * the failure mode this project has been bitten by before, so the arms are written out. Two things
	 * this list records rather than fixes:
	 *
	 *   - `brew` and `flameShock` are graded through a literal `t('brew.verdict', { context })` rather
	 *     than through `verdict()`, which is why they are here and not in `verdict()`'s own list.
	 *   - `mana` had no `verdict_none`, and `verdict()` falls back to the bare `<section>.verdict` for a
	 *     pull it cannot measure — a missing-key defect in the forward direction rather than dead copy, and
	 *     the one this list recorded without failing on. `it('holds a sentence for every grade a section
	 *     can be handed')` below is the forward half, so the next section to arrive an arm short fails here
	 *     rather than getting a line in this comment.
	 */
	const VERDICT_ARMS: Record<string, string[]> = {
		// **Two arms retired and one added, and the count is not the news — the reason is.** The singular
		// `ok` and `bad` arms were byte-identical to each other and to `verdict_good_one`, so at one brew
		// all three letters printed one string and a pull that spent five stacks read what a pull that
		// spent ten read. They are gone, and `verdict_oneShort` is the single arm every short single-brew
		// pull now reaches, chosen by `BrewBankTimeline` off the brew count rather than off a letter.
		//
		// The argument for one arm instead of two is in that component and is a refusal: `brewShortUses`
		// is the only metric that knows the two presses the priority list takes under ten on purpose, its
		// sample is at most one on a single-brew pull, and `MIN_GRADED_SAMPLE` refuses it there every
		// time — so nothing in the spec can tell a short brew that was the right press from one that was
		// not, and two sentences claiming to would both be claiming it.
		//
		// `verdict_ok_other` and `verdict_bad_other` still carry the `ok` and `bad` stems, so
		// `it('holds a sentence for every grade a section can be handed')` below is untouched by the
		// retirement — which is the check that would have caught it had the singulars been the only arms.
		brew: [
			'verdict_good_one',
			'verdict_oneShort',
			'verdict_good_other',
			'verdict_short_other',
			'verdict_shortExcused_other',
			'verdict_ok_other',
			'verdict_bad_other',
			'verdict_none',
		],
		// `verdict_suppressed` is the fifth arm and it is not a grade. An encounter that puts the player
		// out of reach by design has its letter withheld, and the sentence that used to cover that state
		// — `verdict_none`, "too few globals passed to measure a rate" — was false of it: Immerseus
		// offers 130 global slots and fills 106. Two opposite findings, two sentences.
		casts: ['verdict_good', 'verdict_ok', 'verdict_bad', 'verdict_none', 'verdict_suppressed'],
		// **`verdict_noContact` is the fifth arm, and it is the same defect `earthShock.verdict_tooFew` was
		// added for, reached by the other of `metricOf`'s two refusals.** `rskUptime` carries the span it
		// was measured over, and `metricOf` refuses an empty one — so a pull that cast the kick and
		// recorded no contact has no letter, `gradeOf` answers `none`, and `verdict()` reached
		// `verdict_none`. That key is the never-cast sentence, and this section had the fold worse than
		// Earth Shock did: `RisingSunKick`'s own nought-casts branch prints the *same key*, where it is
		// exactly true, so one string was serving both facts in one file. The new arm is reached by name
		// and not through `verdict()`, which picks its arm off a grade a refused metric does not have. It
		// names the cast count, phrased so the numeral needs no agreement, and claims nothing about the
		// uptime — there is none.
		debuff: ['verdict_good', 'verdict_ok', 'verdict_bad', 'verdict_noContact', 'verdict_none'],
		// **No plural arm on any of the six, and the measurement is why rather than an oversight.** The
		// three graded arms open on a fraction of the shocks a list had an opinion about, and `shareOf`
		// hands that share its denominator as a sample size, which `metricOf` refuses below
		// `MIN_GRADED_SAMPLE` — so a pull with one or two of them is unmeasurable and never reaches a graded
		// sentence at all. The exempt arm has no sample floor and names the *total* instead, one and nought
		// both included, so it is written so the count needs no agreement: a plural arm there would have
		// grown the five key names `readerVoice.test.ts` pins as the only places our word for a scope
		// appears, in a file this lane does not own.
		//
		// `verdict_tooFew` is what that refusal now prints, and it is the sixth arm rather than a rewording
		// of `verdict_none` because the two facts are different ones: nothing pressed, against pressed and
		// too thin to read. It is reached from `EarthShock` by name and not through `verdict()`, which picks
		// its arm off the grade — and a thin sample has no grade to pick from. Both its counts are written
		// so the numeral needs no agreement either, for the reason the exempt arm gives.
		earthShock: ['verdict_good', 'verdict_ok', 'verdict_bad', 'verdict_exempt', 'verdict_tooFew', 'verdict_none'],
		flameShock: [
			'verdict_good',
			'verdict_goodSome',
			'verdict_ok',
			'verdict_bad',
			'verdict_good_full',
			'verdict_goodSome_full',
			'verdict_ok_full',
			'verdict_bad_full',
			'verdict_exempt',
			'verdict_none',
		],
		// **`verdict_tooFew` is the fifth arm, and it closes the sample floor's last hole rather than a
		// sentence that quoted one.** `karmaEmpty` was built with `sharePct`, which declines only at a
		// denominator of nought, so a single empty Touch of Karma press graded the pull `bad` off a
		// denominator of one — the grade the scorer should have refused and did not. It goes through
		// `shareOf` now, which is the floor everything else already has, and a ninety-second cooldown puts
		// most real pulls under it: five of the six committed captures take one or two presses.
		//
		// A fifth arm and not a rewording of the plain one, for the reason its two siblings give: "you
		// never pressed this" asks for the button, "you pressed it and there are too few to read" asks for
		// the table to be read a press at a time. It repeats the opening clause every graded arm here
		// shares — the presses, the charges the cooldown allowed, the damage returned and its share of the
		// pull are all facts the refusal does not touch — and then declines the share of them. Written so
		// no numeral needs agreement, at one press as at two.
		//
		// Reached from `TouchOfKarma` by name, and here that is load-bearing in *both* directions, which
		// the two earlier arms only had one of each. This section holds a second metric, so the letter and
		// the refusal come apart either way round: with no ceiling demonstrated the section is
		// unmeasurable too and `gradeOf` said `none`, printing "Touch of Karma was never pressed" over a
		// table of presses; with one demonstrated the ceiling share supplies a letter on its own, and
		// `verdict_good` at it claims every press ran while damage was coming in — the exact reading the
		// scorer had refused. `weave`, at one press, is that second pull.
		// `verdict_none` here is **structural and unreachable**, and its string is byte-identical to
		// `karma.none`. Recorded so the duplication is not rediscovered as dead copy and "fixed": the
		// section short-circuits on `casts === 0` and renders `karma.none` instead, so `verdict()` is never
		// called at a grade of `none`, and `verdict_tooFew` covers every path where `gradeOf` could return
		// one. The key exists because the test below requires a `verdict_none` stem on every section that
		// stores arms at all — the same judged-and-left case as `tigerPalm.verdict_none` below, for the same
		// reason: removing it means reaching the section by name and carrying a second guard, to delete a
		// string no reader can reach.
		karma: ['verdict_good', 'verdict_ok', 'verdict_bad', 'verdict_tooFew', 'verdict_none'],
		// Three arms each on the un-narrowed pair, and none on the narrowed three, which is the shape a
		// measurement left rather than a preference. The drop count is one of two metrics here, so an
		// un-narrowed sentence can be handed nought, one or many of them whatever its letter — `cleave`
		// prints one and the other three print nought. Narrowed, the letter *is* the drop count, so each of
		// those three arms has exactly one count it can carry and says it in words.
		lightningShield: [
			'verdict_good',
			'verdict_ok_zero',
			'verdict_ok_one',
			'verdict_ok_other',
			'verdict_bad_zero',
			'verdict_bad_one',
			'verdict_bad_other',
			'verdict_good_noOvercap',
			'verdict_ok_noOvercap',
			'verdict_bad_noOvercap',
			'verdict_none',
		],
		mana: [
			'verdict_good',
			'verdict_good_noRage',
			'verdict_good_noThunderstorm',
			// **Three arms, and the nought one is here because the plural arm above it can be handed nothing
			// else.** This comment used to say there were two and that nought "reads correctly — English takes
			// the plural arm for it". English does; the sentence does not. What the un-narrowed plural arms
			// print at nought is *"let Shamanistic Rage come back to a pool already under 70% 0 times without
			// pressing it"* and then, in the same breath, the instruction to fix it — a fault the pull did not
			// commit and advice for a habit it already has. That is the identical defect the `searingTotem` and
			// `lightningShield` comments below call a false fault and give a nought arm to; only this section
			// had the reading judged the other way.
			//
			// And on the `ok` letter nought is not one of the counts that arm can be given, it is the *only*
			// one. `shamanisticRageMissed` is `good` at nought and `ok` at exactly one, so two or more presses
			// passed over makes the section `bad` outright — while exactly one takes the singular arm. So the
			// un-narrowed `ok` plural was reachable at a count of nought and at no other, which is to say every
			// reader it could ever have had would have been read a fault they did not commit.
			//
			// `bad` takes the same arm for the same reason from the other side: there the letter can come off
			// the Thunderstorm's clock alone, so a pull with a clean Rage reaches it and printed the same
			// nought. Both nought arms say what the Rage actually did — no stretch went by unpressed — and drop
			// the instruction, which is the wording `verdict_good` already uses for that half.
			'verdict_ok_zero',
			'verdict_ok_one',
			'verdict_ok_other',
			// The narrowed arms went from the `good` grade to all three when `addsThenBoss` landed and became
			// the first committed pull to answer one half and not the other: it strains once with the Rage
			// unpressed and never starves, so `verdict_ok` asserted a clean Thunderstorm it had not measured.
			//
			// Neither narrowed arm carries a plural, and that is the same measurement made twice. With the
			// Thunderstorm unread the letter is the Rage's metric alone, `ok` at exactly one press passed over
			// and `bad` at two or more — so the `ok` arm says "once" in words and the `bad` arm can never be
			// handed a one. `addsThenBoss` is the pull that reaches the first of those, and the sentence it
			// used to be given read "1 times".
			'verdict_ok_noRage',
			'verdict_ok_noThunderstorm',
			'verdict_bad_zero',
			'verdict_bad_one',
			'verdict_bad_other',
			'verdict_bad_noRage',
			'verdict_bad_noThunderstorm',
			'verdict_none',
		],
		// Clipping is not one of this section's two graded metrics, so the un-narrowed *three* can print any
		// count under any letter — `phased` grades `ok` with nothing clipped and printed "0 presses
		// clipped a healthy totem, throwing away 0s of its dot". The narrowed three name the overlap count
		// instead and print no clipped figure at all.
		//
		// **`good` gained the same three arms its siblings had, and it is the same defect the other way up.**
		// A pull is handed `good` on the uptime and the Fire Elemental slot, neither of which is the clipped
		// count — so the one sentence stored under that letter claimed no press landed over a live totem on
		// pulls where one did. `cleave` is that pull: 88.5% uptime, no overlap, one clip, `good`. The `zero`
		// arm is the sentence as it was, now reached only where it is true.
		searingTotem: [
			'verdict_good_zero',
			'verdict_good_one',
			'verdict_good_other',
			'verdict_ok_zero',
			'verdict_ok_one',
			'verdict_ok_other',
			'verdict_bad_zero',
			'verdict_bad_one',
			'verdict_bad_other',
			'verdict_good_noUptime',
			'verdict_ok_noUptime',
			'verdict_bad_noUptime',
			'verdict_none',
		],
		// **`verdict_tooFew` is the fifth arm, and it is the Elemental's Earth Shock defect a spec over,
		// arrived at by the same one of `metricOf`'s two refusals.** `snapshotRate` is a share over the procs
		// the bank could actually have paid for, and `shareOf` hands that share its denominator as a sample
		// size, which `metricOf` refuses under `MIN_GRADED_SAMPLE`. So a pull offered one or two affordable
		// procs has no rate, and what a reader got was the sentence written for a pull that was never offered
		// a proc it could pay for — printed over a chart of the ones it was.
		//
		// A fifth arm and not a rewording of the plain one, because the two are different facts and a reader
		// acts on them differently: "nothing ever arrived you could have caught" asks for the bank to be kept
		// fuller, "some arrived and there are too few of them to read" asks for the chart to be read a proc at
		// a time. Both counts are written so the numeral needs no agreement, for the reason the Elemental's
		// exempt arm gives, and the arm is named for the thinness rather than for the excusing so the five key
		// names `readerVoice.test.ts` pins as the only places our word for a scope appears do not grow.
		//
		// Reached from `SnapshotTable` by name and not through `verdict()`, which picks its arm off a grade a
		// refused metric does not have — and here that is load-bearing twice over. Depth is *secondary*, so a
		// pull that caught one of two affordable procs still has a section letter, through `section()`'s
		// nothing-decided fallback, and printed the `ok` arm at it: a share of nought beside a numerator of
		// one, chosen off a letter no metric produced. Reading the metric catches that pull too.
		snapshots: ['verdict_good', 'verdict_ok', 'verdict_bad', 'verdict_tooFew', 'verdict_none'],
		tigerPalm: [
			'verdict_good',
			'verdict_goodSome',
			'verdict_ok',
			'verdict_bad',
			// Named `none` and holding the *thin-sample* sentence, which `f832015` left behind when it moved
			// the plain never-pressed wording out to `tigerPalm.unpressed`. Judged and left, so the next
			// reader need not re-open it: the name is not a label anyone chose, it is what `verdict()`
			// assembles from a grade of `none`, and the test below requires a `verdict_none` stem on every
			// section that stores arms at all. Renaming it therefore means reaching it by name from
			// `TigerPalm` and carrying a second guard, to change a key no reader ever sees — the sentence
			// under it is already the right one and `cleave` prints it correctly today. The two arms added
			// beside it (`snapshots`, `debuff`) are reached by name because their sections needed a *sixth*
			// state their letter could not express; this one does not.
			'verdict_none',
			'verdict_exempt',
		],
	};

	it('resolves the analysis copy through four routes, and none of them is empty', () => {
		const all = patterns();
		const counts: Record<Route, number> = { written: 0, verdict: 0, copyPrefix: 0, computed: 0 };
		let shaped = 0;
		for (const path of leaves()) {
			const hit = reached(path, all);
			// Whether anything is left over is the next test's question, not this one's.
			if (hit === null) continue;
			counts[hit.route]++;
			if (hit.shape) shaped++;
		}
		// A guard that resolves nothing passes the orphan hunt below, so the model's own reach is the
		// thing asserted first. The floors are well under the day's figures — 836, 28, 36, 282 — because
		// what has to fail here is a route going dark, not a section moving.
		expect(counts.written, 'written-out keys').toBeGreaterThan(700);
		expect(counts.verdict, 'keys reached through verdict()').toBeGreaterThan(20);
		expect(counts.copyPrefix, 'keys reached through a copyPrefix template').toBeGreaterThan(30);
		expect(counts.computed, 'keys reached through a computed template').toBeGreaterThan(200);
		// And the whole file, so a route going dark cannot be hidden by another that grew.
		expect(counts.written + counts.verdict + counts.copyPrefix + counts.computed).toBeGreaterThan(1150);
		// Five sixths of the file is reached at a named key — the whole path, no `*` anywhere in it, no
		// suffix peeled off the leaf. It was **694** while the computed families resolved to a shape, and
		// rose past 960 once each one resolved against its own key source; the remainder are leaves reached
		// only by peeling an i18next context off the end, and that peel is the last loose half of the model.
		//
		// **Deliberately no total quoted.** The earlier version of this comment read "963 of 1182" and
		// "the remaining 219", and both were stale within a day of being written — the file gains leaves
		// whenever a section gains copy. A number in a comment that nothing executes is the failure mode
		// this file exists to prevent, so the live claim is the assertion below and the only figure kept in
		// prose is the historic one, which cannot rot because it is the past.
		expect(leaves().length - shaped, 'leaves reached at a named key, with no suffix peeled').toBeGreaterThan(900);
	});

	it('carries no key nothing asks for', () => {
		const all = patterns();
		const orphans = leaves().filter((path) => reached(path, all) === null);
		expect(orphans, `analysis copy nothing reads:\n${orphans.join('\n')}`).toEqual([]);
	});

	/** Every folded shape in the tree that is neither `${section}`, `${copyPrefix}` nor the settings panel's. */
	function familyShapes(): string[] {
		const shapes = new Set<string>();
		for (const source of SOURCES) {
			for (const { raw, folded } of computedKeys(source)) {
				if (raw.startsWith('${copyPrefix}.') || raw.startsWith('${section}.') || raw.startsWith('${s.tKey}.')) continue;
				shapes.add(folded);
			}
		}
		return [...shapes].sort();
	}

	it('names the families it resolves and the ones it cannot', () => {
		// Both directions. A shape in the tree with no entry on either list is a family nothing has decided
		// about; an entry with no shape behind it is a source kept alive for a call site that has gone.
		expect(familyShapes()).toEqual([...Object.keys(FAMILY_SOURCE), ...SHAPE_ONLY].sort());
		expect(SHAPE_ONLY, 'families with no key source, each needing its reason beside it').toEqual([]);
		// Every family names a source that exists, and every source is named by a family.
		const named = new Set(Object.values(FAMILY_SOURCE));
		expect(Object.values(FAMILY_SOURCE).filter((name) => KEY_SOURCES[name] === undefined)).toEqual([]);
		expect(Object.keys(KEY_SOURCES).filter((name) => !named.has(name))).toEqual([]);
	});

	it('resolves every family against a live set, and none of them is empty', () => {
		// A guard that resolves nothing passes an orphan hunt trivially, and a source that has quietly gone
		// empty resolves nothing — so each one's own values are asserted before anything is hunted with them.
		for (const [name, source] of Object.entries(KEY_SOURCES)) {
			expect([...source.keys()].sort(), `${name} — ${source.where}`).toEqual([...source.pinned].sort());
			expect(source.pinned.length, `${name} — ${source.where}`).toBeGreaterThan(1);
		}
	});

	it('accounts for the copy of every family, and says how much each one holds', () => {
		// What each family actually reaches in the file, which is the other half of non-vacuity: a source can
		// hold its values and still match nothing, if the copy under it was filed somewhere else.
		const all = patterns();
		const held: Record<string, number> = {};
		for (const family of Object.keys(FAMILY_SOURCE)) {
			const mine = all.filter((pattern) => pattern.family === family);
			held[family] = leaves().filter((path) => reached(path, mine) !== null).length;
		}
		expect(held).toEqual(FAMILY_LEAVES);
	});

	/**
	 * The forward direction of the one family whose copy this tightening deleted.
	 *
	 * `summary.takeaways.metric.fireElementalHasteUptime.label` and `.fix` were the reds the sources above
	 * found: the Elemental weighs that metric at zero, `Takeaways` skips a zero-weight metric outright, and
	 * two written sentences had no reader from the day they landed. Deleting them is only safe with this
	 * beside it — the key is computed, so the missing-key check at the top of this file cannot see it, and
	 * raising the weight would otherwise print `summary.takeaways.metric.fireElementalHasteUptime.label` at
	 * a reader. The note above `fireElementalHasteUptime` in `specs/elemental/lib/score.ts` says the weight
	 * is to be revisited when a pull actually fails the rule; this is what makes that revisit ask for the
	 * copy back rather than ship without it.
	 */
	it('holds a card for every metric that can lead the summary', () => {
		const missing: string[] = [];
		for (const key of KEY_SOURCES['takeawayMetric']?.keys() ?? []) {
			for (const part of ['label', 'fix']) {
				if (!resolves(`summary.takeaways.metric.${key}.${part}`, 'report')) {
					missing.push(`summary.takeaways.metric.${key}.${part}`);
				}
			}
		}
		expect(missing, `weighted metrics with no summary card:\n${missing.join('\n')}`).toEqual([]);
	});

	it('holds every arm of every graded sentence', () => {
		const stored: Record<string, string[]> = {};
		for (const [section, node] of Object.entries(REPORT)) {
			if (typeof node !== 'object' || node === null) continue;
			const arms = Object.keys(node).filter((key) => key === 'verdict' || key.startsWith('verdict_'));
			if (arms.length > 0) stored[section] = arms;
		}
		expect(stored).toEqual(VERDICT_ARMS);
		// And that each of them is actually reached, by one of the two routes a graded section has.
		const graded = new Set(verdictSections());
		for (const source of SOURCES) {
			for (const key of quotedKeys(source)) {
				if (key.endsWith('.verdict')) graded.add(key.slice(0, -'.verdict'.length));
			}
		}
		const unreached = Object.keys(VERDICT_ARMS).filter((section) => !graded.has(section));
		expect(unreached, `graded sentences no section asks for:\n${unreached.join('\n')}`).toEqual([]);
	});

	/**
	 * The forward direction of the same question, which nothing was asking: every grade a section can be
	 * handed has a sentence stored for it.
	 *
	 * The test above holds that every stored arm is *reached*. This one holds the reverse — that every arm
	 * a reader can reach is *stored* — and the two are not the same guard. `mana` stored five arms, all of
	 * them reached, and had no `verdict_none`; `verdict()` resolves a `none` grade to
	 * `t('mana.verdict', { context: 'none' })`, i18next resolves a missing context to the bare
	 * `mana.verdict`, no section stores that, and the reader gets the dotted key where the sentence
	 * belongs. That is the same defect shape as `flameShock`'s `exempt_full` — see
	 * `specs/elemental/components/sections/__tests__/unaskedVerdict.test.ts` — and it shipped a second
	 * time because the only thing looking at the arms was a hand-written list this file could add a
	 * comment to.
	 *
	 * Four grades and not five: `verdict()` resolves `exempt` through an explicit key list ending in
	 * `verdict_none`, so a section with no band declaration needs no `verdict_exempt` and one with bands
	 * degrades to the "cannot say" wording rather than to a key. Matched by stem, because the grade shares
	 * its path segment with a plural or a narrowing — `brew` stores `verdict_good_one` and never a bare
	 * `verdict_good`, and both are the `good` arm.
	 */
	it('holds a sentence for every grade a section can be handed', () => {
		const missing: string[] = [];
		for (const [section, node] of Object.entries(REPORT)) {
			if (typeof node !== 'object' || node === null) continue;
			const arms = Object.keys(node).filter((key) => key === 'verdict' || key.startsWith('verdict_'));
			if (arms.length === 0) continue;
			for (const grade of ['good', 'ok', 'bad', 'none']) {
				const stem = `verdict_${grade}`;
				if (!arms.some((arm) => arm === stem || arm.startsWith(`${stem}_`))) missing.push(`${section}.${stem}`);
			}
		}
		expect(missing, `grades with no sentence behind them:\n${missing.join('\n')}`).toEqual([]);
	});
});
