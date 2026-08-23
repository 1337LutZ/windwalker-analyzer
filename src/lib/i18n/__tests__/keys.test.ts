// Every translation key the components ask for must exist.
//
// A missing key is not a crash — i18next hands back the key itself — so the failure mode is a
// section rendering `snapshots.verdict_bad` at a reader in production. Nothing else in the suite
// would catch that, because the component rendered without throwing and the test that mounted it
// only checked that it rendered.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RAID_BUFF_EFFECT_KEYS } from '~/lib/analysis/raidBuffs';
import { GRADE_ORDER } from '~/lib/score/model';
import type { Analysis } from '~/lib/types';
import { ELEMENTAL_SPEC } from '~/specs/elemental';
import { LADDER_ENTRIES as ELE_LADDER, ROTATION } from '~/specs/elemental/lib/apl';
import { WEIGHTS as ELE_WEIGHTS } from '~/specs/elemental/lib/score';
import { timelineBanks as elementalBanks } from '~/specs/elemental/lib/view/timelineBanks';
import { WW_SPEC } from '~/specs/windwalker';
import { LADDER_ENTRIES as WW_LADDER } from '~/specs/windwalker/lib/apl';
import { MULTI_TARGET_WEIGHTS, WEIGHTS as WW_WEIGHTS } from '~/specs/windwalker/lib/score';
import { CROSSOVERS, flowKeys, rotationFlow } from '~/specs/windwalker/lib/view/rotationFlow';
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
			for (const key of literalKeys(source)) {
				// A section's verdict is stored per grade (`verdict_good`) and all four must exist, or a
				// pull of the missing grade renders a raw key. `<section>.verdict` only — a column
				// happens to be named `verdict` too, and `fistsOfFury.columns.verdict` is an ordinary
				// string, not a graded one.
				const graded = key.split('.').length === 2 && key.endsWith('.verdict');
				const exists = graded
					? ['good', 'ok', 'bad', 'none'].every((c) => resolves(`${key}_${c}`, ns))
					: resolves(key, ns);
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
	 * by a mode (`SectionNav`'s nav groups, `TargetModeControl`'s three labels) and a ternary chosen
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
	 * sentence under a section nothing grades, and `rotation.rule.*.name` a rule the Elemental list
	 * dropped, which is precisely the dead copy being hunted. `${section}` and `${copyPrefix}` were the
	 * first two; the thirty families in `FAMILY_SOURCE` are the rest, each against the declaration that
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
	const FLOW_BRANCHES = FLOW.flatMap((slot) => ('fork' in slot ? slot.branches : [slot.entry]));

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
	 * `*.verdict` would accept a graded sentence under a section nothing grades. `rotation.rule.*.name`
	 * would accept a rule the Elemental list dropped, and `summary.takeaways.metric.*.fix` a metric the
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
				'first-press-past-one-cooldown',
				'no-two-piece-evidence',
				'nothing-to-hit',
				'pull-ends-too-soon',
				't16-2pc-not-in-log',
			],
		},
		// The bars the cast log draws a lane for: each spec's own `resources`, and the counter row its
		// `timelineBanks` adds beside them. Both halves, because both halves reach the same copy.
		castLogBar: {
			where: 'both specs’ `SpecConfig.resources`, plus each spec’s `timelineBanks`',
			keys: () => [
				...Object.keys(WW_SPEC.resources ?? {}),
				...Object.keys(ELEMENTAL_SPEC.resources ?? {}),
				...bankKeys(),
			],
			pinned: ['brew', 'chi', 'energy', 'lightningShield', 'mana'],
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
			pinned: ['ascReady', 'belowFull', 'cleaveDot', 'cleaveStacks', 'fsLow', 'fsTail', 'twoPiece'],
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
			where: 'specs/windwalker/lib/view/rotationFlow.ts → rotationFlow at every band',
			keys: () => flowKeys(FLOW),
			pinned: [
				'blackoutKick',
				'blackoutKickDump',
				'chiBrew',
				'chiBurst',
				'chiWave',
				'comboBreakerKick',
				'craneOverKick',
				'energizingBrew',
				'fistsOfFury',
				'invokeXuen',
				'jab',
				'risingSunKickCooldown',
				'risingSunKickHold',
				'risingSunKickMulti',
				'rushingJadeWind',
				'rushingJadeWindMulti',
				'spinningCraneKick',
				'stormEarthAndFire',
				'tigerPalmProc',
				'tigerPalmRefresh',
				'tigereyeBrewBank',
				'tigereyeBrewRune',
				'touchOfDeath',
				'zenSphere',
			],
		},
		flowFork: {
			where: 'specs/windwalker/lib/view/rotationFlow.ts → the forks the unfiltered flow keeps',
			keys: () => FLOW.flatMap((slot) => ('fork' in slot ? [slot.fork] : [])),
			pinned: ['blackoutKick', 'risingSunKick', 'talent', 'tigereyeBrew'],
		},
		// The chips, and only the rungs that carry one. Not every rung in the flow: a gate chip on a rung
		// with nothing to gate is dead copy of exactly the kind being hunted, so the narrower set is used.
		flowGate: {
			where: 'specs/windwalker/lib/view/rotationFlow.ts → the gated branches of the unfiltered flow',
			keys: () => FLOW_BRANCHES.filter((entry) => entry.gated).map((entry) => entry.key),
			pinned: [
				'blackoutKick',
				'blackoutKickDump',
				'craneOverKick',
				'risingSunKickCooldown',
				'risingSunKickHold',
				'rushingJadeWindMulti',
				'spinningCraneKick',
				'stormEarthAndFire',
				'tigereyeBrewBank',
				'tigereyeBrewRune',
			],
		},
		gate: {
			where: 'lib/game/model.ts → Gate',
			keys: () => declaredArms('lib/game/model.ts', /export type Gate =/),
			pinned: ['chi', 'conditional', 'cooldown', 'energy', 'other'],
		},
		grade: {
			where: 'lib/score/model.ts → GRADE_ORDER',
			keys: () => GRADE_ORDER,
			pinned: ['bad', 'good', 'ok'],
		},
		// Both specs' ladders, because one shared `priority.rule.*` root holds both lists' rule ids.
		ladderRule: {
			where: 'both specs’ `LADDER_ENTRIES`',
			keys: () => [...WW_LADDER, ...ELE_LADDER].map((entry) => entry.key),
			pinned: [
				'blackout-kick',
				'chain-lightning',
				'chi-wave',
				'combo-breaker-kick',
				'combo-breaker-palm',
				'earth-shock',
				'elemental-blast',
				'fists-of-fury',
				'flame-shock',
				'jab',
				'lava-beam',
				'lava-burst',
				'lightning-bolt',
				'rising-sun-kick',
				'rising-sun-kick-filler',
				'rushing-jade-wind',
				'rushing-jade-wind-open',
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
		rotationGroup: {
			where: 'specs/elemental/lib/apl.ts → the groups ROTATION files its entries under',
			keys: () => [...new Set(ROTATION.map((entry) => entry.group))],
			pinned: ['cooldown', 'dot', 'filler'],
		},
		rotationRule: {
			where: 'specs/elemental/lib/apl.ts → ROTATION',
			keys: () => ROTATION.map((entry) => entry.key),
			pinned: [
				'ascendance',
				'chain-lightning',
				'earth-elemental',
				'earth-shock',
				'elemental-blast',
				'elemental-mastery',
				'fire-elemental',
				'flame-shock-asc-prep',
				'flame-shock-multidot',
				'flame-shock-snapshot',
				'jade-serpent-potion',
				'lava-beam',
				'lava-burst',
				'lightning-bolt',
				'searing-totem',
				'unleash-elements',
			],
		},
		snapshotSource: {
			where: 'lib/types.ts → ElementalSnapshotWindow.source',
			keys: () => declaredArms('lib/types.ts', /export interface ElementalSnapshotWindow \{[\s\S]*?\bsource:/),
			pinned: ['black-blood', 'unerring-vision', 'uvls-stacks'],
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
		takeawayMetric: {
			where: 'both specs’ `WEIGHTS`, minus the metrics weighted zero',
			keys: () => [
				// Through a set because both specs weigh `gcdUtilisation`, and the copy under it is one string.
				...new Set(
					[...Object.entries({ ...WW_WEIGHTS, ...MULTI_TARGET_WEIGHTS }), ...Object.entries(ELE_WEIGHTS)]
						.filter(([, weight]) => weight !== 0)
						.map(([key]) => key),
				),
			],
			pinned: [
				'brewCapWaste',
				'brewShortUses',
				'brewStacks',
				'earthShockGood',
				'fireElementalHasteUptime',
				'fireElementalPrepull',
				'flameShockMultiDot',
				'flameShockSnapshots',
				'flameShockUptime',
				'flameShockWaste',
				'gcdUtilisation',
				'lightningShieldFellOff',
				'lightningShieldOvercap',
				'potionsUsed',
				'rskUptime',
				'searingTotemOverlaps',
				'searingTotemUptime',
				'shamanisticRageMissed',
				'snapshotRate',
				'thunderstormMissed',
				'tigerPalmWaste',
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
	const FAMILY_SOURCE: Record<string, string> = {
		'ascendance.read.fault.*': 'ascendanceFault',
		'ascendance.read.reason.*': 'ascendanceReason',
		'castLog.resource.*': 'castLogBar',
		'castLog.resourceAria.*': 'castLogBar',
		'castLog.target.*': 'castLogGrouping',
		'castLog.target.*Title': 'castLogGrouping',
		'casts.gate.*': 'gate',
		'earthElemental.state.*': 'earthElementalState',
		'earthShock.state.*': 'earthShockReason',
		'elementalMastery.state.*': 'elementalMasteryReason',
		'fireElemental.state.*': 'fireElementalReason',
		'flameShock.state.*': 'flameShockKind',
		'flameShockSnapshots.source.*': 'snapshotSource',
		'overall.*': 'grade',
		'priority.rule.*': 'ladderRule',
		'raidBuffs.effects.*': 'raidBuffEffect',
		'raidBuffs.worth.*': 'raidBuffEffect',
		'rotation.crossover.*': 'crossover',
		'rotation.entry.*.name': 'flowEntry',
		'rotation.entry.*.test': 'flowEntry',
		'rotation.entry.*.why': 'flowEntry',
		'rotation.fork.*.detail': 'flowFork',
		'rotation.fork.*.title': 'flowFork',
		'rotation.gate.*': 'flowGate',
		'rotation.group.*': 'rotationGroup',
		'rotation.rule.*.condition': 'rotationRule',
		'rotation.rule.*.name': 'rotationRule',
		'stormlash.state.*': 'stormlashState',
		'summary.takeaways.metric.*.fix': 'takeawayMetric',
		'summary.takeaways.metric.*.label': 'takeawayMetric',
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
		'castLog.resource.*': 5,
		'castLog.resourceAria.*': 5,
		'castLog.target.*': 3,
		'castLog.target.*Title': 3,
		// Four and not five: `Gate` carries an `other` arm and no section prints a column for it.
		'casts.gate.*': 4,
		'earthElemental.state.*': 3,
		'earthShock.state.*': 7,
		'elementalMastery.state.*': 5,
		'fireElemental.state.*': 4,
		// Nine against seven press kinds: `snapshot` stores two narrowings, and the peel counts both.
		'flameShock.state.*': 9,
		'flameShockSnapshots.source.*': 3,
		'overall.*': 3,
		'priority.rule.*': 22,
		// More than the seven effects, on both: each is stored per spec where the two want different words.
		'raidBuffs.effects.*': 9,
		'raidBuffs.worth.*': 14,
		'rotation.crossover.*': 4,
		'rotation.entry.*.name': 24,
		'rotation.entry.*.test': 24,
		'rotation.entry.*.why': 24,
		'rotation.fork.*.detail': 4,
		'rotation.fork.*.title': 4,
		'rotation.gate.*': 10,
		'rotation.group.*': 3,
		'rotation.rule.*.condition': 16,
		'rotation.rule.*.name': 16,
		'stormlash.state.*': 2,
		// Twenty cards, two of which store a second wording for a number that needs different advice.
		'summary.takeaways.metric.*.fix': 23,
		'summary.takeaways.metric.*.label': 21,
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
		brew: [
			'verdict_good_one',
			'verdict_good_other',
			'verdict_short_other',
			'verdict_shortExcused_other',
			'verdict_ok_one',
			'verdict_ok_other',
			'verdict_bad_one',
			'verdict_bad_other',
			'verdict_none',
		],
		casts: ['verdict_good', 'verdict_ok', 'verdict_bad', 'verdict_none'],
		debuff: ['verdict_good', 'verdict_ok', 'verdict_bad', 'verdict_none'],
		earthShock: ['verdict_good', 'verdict_ok', 'verdict_bad', 'verdict_exempt', 'verdict_none'],
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
		flameShockSnapshots: ['verdict_good', 'verdict_ok', 'verdict_bad', 'verdict_exempt', 'verdict_none'],
		karma: ['verdict_good', 'verdict_ok', 'verdict_bad', 'verdict_none'],
		lightningShield: [
			'verdict_good',
			'verdict_ok',
			'verdict_bad',
			'verdict_good_noOvercap',
			'verdict_ok_noOvercap',
			'verdict_bad_noOvercap',
			'verdict_none',
		],
		mana: [
			'verdict_good',
			'verdict_good_noRage',
			'verdict_good_noThunderstorm',
			'verdict_ok',
			// The narrowed arms went from the `good` grade to all three when `addsThenBoss` landed and became
			// the first committed pull to answer one half and not the other: it strains once with the Rage
			// unpressed and never starves, so `verdict_ok` asserted a clean Thunderstorm it had not measured.
			'verdict_ok_noRage',
			'verdict_ok_noThunderstorm',
			'verdict_bad',
			'verdict_bad_noRage',
			'verdict_bad_noThunderstorm',
			'verdict_none',
		],
		searingTotem: [
			'verdict_good',
			'verdict_ok',
			'verdict_bad',
			'verdict_good_noUptime',
			'verdict_ok_noUptime',
			'verdict_bad_noUptime',
			'verdict_none',
		],
		snapshots: ['verdict_good', 'verdict_ok', 'verdict_bad', 'verdict_none'],
		tigerPalm: ['verdict_good', 'verdict_goodSome', 'verdict_ok', 'verdict_bad', 'verdict_none', 'verdict_exempt'],
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
