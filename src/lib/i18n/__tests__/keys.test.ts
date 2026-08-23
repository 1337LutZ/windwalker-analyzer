// Every translation key the components ask for must exist.
//
// A missing key is not a crash — i18next hands back the key itself — so the failure mode is a
// section rendering `snapshots.verdict_bad` at a reader in production. Nothing else in the suite
// would catch that, because the component rendered without throwing and the test that mounted it
// only checked that it rendered.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

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
 * halves are load-bearing — seven other helpers in the tree take a `key: string` and none of them is a
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
 * `report.json` is 1198 strings and it had no orphan guard at all, which is why four reader-facing
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
 * out-grown — but two of them resolve a *shape* and not a value, and that is the limit this block states
 * out loud in `it('names the families it can only resolve to a shape')` and in the arm list beside it.
 * A guard that resolves nothing passes an orphan hunt trivially, so the counts are asserted too.
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
	 * `${section}` and `${copyPrefix}` are expanded against the values the source gives them rather than
	 * folded to a `*`, which is the difference between a guard and a rubber stamp: `*.verdict` would
	 * accept a graded sentence under a section nothing grades, which is precisely the dead copy being
	 * hunted. `${s.tKey}` is dropped — those are the settings panel's, and they are `ui`.
	 */
	function patterns(): Pattern[] {
		const built: Pattern[] = [];
		const add = (path: string, route: Route) => built.push({ segments: path.split('.').map(segment), route });
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
				add(folded, 'computed');
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
	 * The families this hunt resolves to a shape and not to a value, listed so the blind spot has a size.
	 *
	 * Each of these is a `t(`-side template whose interpolation is a runtime string — a rule id, a metric
	 * key, a press reason. The guard holds that `rotation.entry.<something>.name` is a key the tree reads
	 * and that `rotation.entry.<something>.detail` is not; it cannot hold that any particular
	 * `<something>` is still a rule the spec declares, so a retired entry's three strings would survive
	 * here. Closing that would mean each family naming its own key source, which is thirty different
	 * modules and is not this test.
	 *
	 * Pinned as a list rather than a count because the list is the alarm: a fifth indirect route appearing
	 * in the tree is exactly the thing that would make this guard blind, and it cannot appear without
	 * showing up here.
	 */
	const SHAPE_ONLY = [
		'ascendance.read.fault.*',
		'ascendance.read.reason.*',
		'castLog.resource.*',
		'castLog.resourceAria.*',
		'castLog.target.*',
		'castLog.target.*Title',
		'casts.gate.*',
		'earthElemental.state.*',
		'earthShock.state.*',
		'elementalMastery.state.*',
		'fireElemental.state.*',
		'flameShock.state.*',
		'flameShockSnapshots.source.*',
		'overall.*',
		'priority.rule.*',
		'raidBuffs.effects.*',
		'raidBuffs.worth.*',
		'rotation.crossover.*',
		'rotation.entry.*.name',
		'rotation.entry.*.test',
		'rotation.entry.*.why',
		'rotation.fork.*.detail',
		'rotation.fork.*.title',
		'rotation.gate.*',
		'rotation.group.*',
		'rotation.rule.*.condition',
		'rotation.rule.*.name',
		'stormlash.state.*',
		'summary.takeaways.metric.*.fix',
		'summary.takeaways.metric.*.label',
	];

	/**
	 * Every section that stores a graded sentence, with the arms it stores.
	 *
	 * A count would pass a refactor that dropped `verdict_ok` from every section in the file, which is
	 * the failure mode this project has been bitten by before, so the arms are written out. Two things
	 * this list records rather than fixes:
	 *
	 *   - `brew` and `flameShock` are graded through a literal `t('brew.verdict', { context })` rather
	 *     than through `verdict()`, which is why they are here and not in `verdict()`'s own list.
	 *   - `mana` has no `verdict_none`, and `verdict()` falls back to the bare `<section>.verdict` for a
	 *     pull it cannot measure. That is a missing-key defect in the forward direction, not dead copy,
	 *     and it is left for the lane that owns the Mana section.
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
		mana: ['verdict_good', 'verdict_good_noRage', 'verdict_good_noThunderstorm', 'verdict_ok', 'verdict_bad'],
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
		// thing asserted first. The floors are well under the day's figures — 835, 27, 36, 284 — because
		// what has to fail here is a route going dark, not a section moving.
		expect(counts.written, 'written-out keys').toBeGreaterThan(700);
		expect(counts.verdict, 'keys reached through verdict()').toBeGreaterThan(20);
		expect(counts.copyPrefix, 'keys reached through a copyPrefix template').toBeGreaterThan(30);
		expect(counts.computed, 'keys reached through a computed template').toBeGreaterThan(200);
		// And the whole file, so a route going dark cannot be hidden by another that grew.
		expect(counts.written + counts.verdict + counts.copyPrefix + counts.computed).toBeGreaterThan(1150);
		// Rather more than half of it is reached exactly — the same leaf, by a written-out key. Asserted
		// because the two loose halves of the model are where a false green would come from.
		expect(leaves().length - shaped, 'leaves reached without a `*` or a suffix peel').toBeGreaterThan(600);
	});

	it('carries no key nothing asks for', () => {
		const all = patterns();
		const orphans = leaves().filter((path) => reached(path, all) === null);
		expect(orphans, `analysis copy nothing reads:\n${orphans.join('\n')}`).toEqual([]);
	});

	it('names the families it can only resolve to a shape', () => {
		const shapes = new Set<string>();
		for (const source of SOURCES) {
			for (const { raw, folded } of computedKeys(source)) {
				if (raw.startsWith('${copyPrefix}.') || raw.startsWith('${section}.') || raw.startsWith('${s.tKey}.')) continue;
				shapes.add(folded);
			}
		}
		expect([...shapes].sort()).toEqual([...SHAPE_ONLY].sort());
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
});
