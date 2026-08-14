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
 */
function namespaceOf(source: string): Namespace {
	if (/useTranslation\(\s*'ui'\s*\)/.test(source)) return 'ui';
	if (/useTranslation\(\s*'report'\s*\)/.test(source) || /useReportCopy/.test(source)) return 'report';
	return 'both';
}

describe('translation keys', () => {
	const files = walk(join(SRC, 'components')).concat(walk(join(SRC, 'hooks')));

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
});
