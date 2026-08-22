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
 * Literal keys only. A computed key — `t('overall.' + grade)` — cannot be checked this way, so those
 * are covered by the enumerated checks in copy.test.ts instead.
 */
function literalKeys(source: string): string[] {
	const keys: string[] = [];
	for (const match of source.matchAll(/\bt\(\s*'([a-zA-Z][\w.]*)'/g)) {
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
 * **`ui` only, and that is the honest scope.** Every key in the shell namespace is reached one of two
 * statically visible ways: a literal `t('steps.fight')`, or a spec schema's `tKey` joined to a suffix
 * the settings dialog writes. `report` is not like that — it is reached through `verdict()`, through
 * grade contexts and through `copyPrefix` templates — so an orphan hunt there would report most of the
 * file as dead. The equivalent check for the prefixed families it does have is
 * `copyPrefix.test.ts`'s third case.
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
