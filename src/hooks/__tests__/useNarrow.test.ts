// The viewport must not reach a server render, and no component may read it during one.
//
// Three charts shipped `typeof window !== 'undefined' && window.matchMedia(NARROW_QUERY).matches` in the
// component body. On the server that is `false`; on a narrow client it is `true`; and both the label
// column's width and — in the Windwalker timeline — the label *text* were rendered from it. React then
// discards the server HTML and re-renders the island, and it does so **only on the viewport the report is
// hardest to lay out on**, which is also the viewport `docs/conventions.md` asks to be measured.
//
// Two claims, because one of them is about a value and the other about a habit. The value is testable
// directly; the habit needs a sweep, because the next component to want the breakpoint will reach for
// `matchMedia` exactly like these three did.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { useNarrow } from '../useNarrow';

const Probe = () => createElement('i', { 'data-narrow': String(useNarrow()) });

describe('useNarrow', () => {
	it('answers false on a server render, whatever the viewport would say', () => {
		// The stub is the point: even with a `window` that reports a match, the *first* render must agree
		// with the HTML a server with no window produced. The effect adopts the real answer afterwards, and
		// an effect does not run during `renderToStaticMarkup`.
		const original = (globalThis as { window?: unknown }).window;
		(globalThis as { window?: unknown }).window = { matchMedia: () => ({ matches: true }) };
		try {
			expect(renderToStaticMarkup(createElement(Probe))).toContain('data-narrow="false"');
		} finally {
			if (original === undefined) delete (globalThis as { window?: unknown }).window;
			else (globalThis as { window?: unknown }).window = original;
		}
	});
});

/** Every `.ts`/`.tsx` under `src/`, so the sweep cannot be narrowed by moving a file. */
const sources = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return sources(path);
		return /\.tsx?$/.test(entry.name) ? [path] : [];
	});

describe('no component reads the viewport during a render', () => {
	it('leaves matchMedia to the two places that may call it', () => {
		// **The rule is "never during a render", and a textual sweep cannot see call context** — so the
		// allowlist carries the reason each file is allowed, and a new entry has to justify itself the way
		// `SILENT_AURAS` and the `NOT_LANES` ledgers do. Every one of these was read and is inside an effect
		// or an event handler:
		//
		//   ApexChart.tsx    the draw effect, handing `narrow` to `build` — and ApexCharts is never
		//                    server-rendered, so a value read at draw time cannot mismatch anything
		//   useNarrow.ts     an effect, which is the whole point of the hook
		//   jump.ts          a click handler, reading the reduced-motion preference
		//   ReportFlow.tsx   two effects, same preference, before scrolling a step into view
		//   CompareFlow.tsx  the same two calls for the same reason — one effect scrolling the comparison
		//                    into view when both pulls land, one click handler behind the bar's Change
		//                    button. Neither runs during a render, and the compare page is server-rendered
		//                    exactly as the report page is.
		const allowed = new Set(['ApexChart.tsx', 'useNarrow.ts', 'jump.ts', 'ReportFlow.tsx', 'CompareFlow.tsx']);
		const root = resolve(import.meta.dirname, '../..');
		const offenders = sources(root)
			.filter((path) => !path.includes('__tests__'))
			.filter((path) => !allowed.has(path.split('/').pop() ?? ''))
			.filter((path) => /\bmatchMedia\b/.test(readFileSync(path, 'utf8')))
			.map((path) => path.slice(root.length + 1));
		expect(offenders).toEqual([]);
	});

	it('sweeps a real tree, so the assertion above is not vacuous', () => {
		const root = resolve(import.meta.dirname, '../..');
		expect(sources(root).length).toBeGreaterThan(100);
		// And every allowed file really does call it, so an entry cannot outlive the call it excuses — the
		// failure mode `redundantExcuses` was added for on the aura ledgers.
		for (const path of [
			'components/charts/ApexChart.tsx',
			'hooks/useNarrow.ts',
			'components/jump.ts',
			'components/report/ReportFlow.tsx',
			'components/compare/CompareFlow.tsx',
		]) {
			expect(readFileSync(resolve(root, path), 'utf8'), path).toContain('matchMedia');
		}
	});
});
