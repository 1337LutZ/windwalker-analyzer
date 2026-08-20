// TEMPORARY refactor aid for the component steps (19-21). Renders every committed Windwalker fixture
// and writes a sha256 per fixture, so a component extraction can be checked for pixel drift. Delete
// when those steps land.
//
// **Read this before trusting it.** The fixtures are pre-analysed `Analysis` objects, so this covers the
// *render* path and nothing else: components, `useReportCopy`, and the scorecard that `spec.score()`
// computes from the fixture at render time. It does NOT call `windwalkerAudit`, so these hashes are
// invariant under any change to `specs/windwalker/lib/index.ts`. An audit change that leaves them
// identical has not been verified by them — `specs/windwalker/lib/__tests__/pull.test.ts` is the guard
// that runs the audit for real.
//
// Not committed as assertions, because a deliberate copy or layout change would then fail as an opaque
// hash mismatch. It writes a file; the caller diffs before against after.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it } from 'vitest';

import { initI18n } from '~/lib/i18n/config';
import { getSpec } from '~/lib/spec';
import type { Analysis } from '~/lib/types';
import Report from '../Report';

// Named rather than `DEFAULT_SPEC`: these fixtures are Windwalker pulls, so the spec they are
// scored and read against has to be the Windwalker whatever `PUBLIC_SPEC` pinned the build to.
const WINDWALKER_SPEC = getSpec('windwalker')!;

initI18n();

const OUT = process.env['RENDER_OUT'] ?? '/tmp/render-guard.txt';
const NAMES = ['strong', 'poor', 'mixed', 'cleave', 'waves', 'weave'];

const fx = (n: string): Analysis =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../specs/windwalker/__fixtures__/${n}.json`), 'utf8'));

describe('windwalker render guard', () => {
	it('hashes every fixture as rendered', () => {
		const rows = NAMES.map((n) => {
			const html = renderToStaticMarkup(
				createElement(Report, { analysis: fx(n), targetChoice: 'auto', spec: WINDWALKER_SPEC }),
			);
			const hash = createHash('sha256').update(html).digest('hex').slice(0, 16);
			return `${n.padEnd(8)} render=${hash} len=${String(html.length).padStart(8)}`;
		});
		writeFileSync(OUT, rows.join('\n') + '\n');
	});
});
