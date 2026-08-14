import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Analysis } from '~/lib/types';

import Report from '../Report';

const fx = (n: string): Analysis =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../lib/__fixtures__/${n}.json`), 'utf8'));

/**
 * The reported bug, end to end: a 10 Heroic pull was labelled "25 Normal".
 *
 * These fixtures were captured through the real pipeline after the fix, so they carry the API's own
 * `size` and difficulty name — which makes this a check on the whole chain (query → client → analysis
 * → header) rather than on the formatter alone, which `components/__tests__/format.test.ts` covers.
 */
describe('report header difficulty', () => {
	it('labels a 10 Heroic pull as 10 Heroic', () => {
		const html = renderToStaticMarkup(createElement(Report, { analysis: fx('poor') }));
		expect(html).toContain('10 Heroic');
		expect(html).not.toContain('25 Normal');
	});
	it('labels a 25 Heroic pull as 25 Heroic', () => {
		const html = renderToStaticMarkup(createElement(Report, { analysis: fx('strong') }));
		expect(html).toContain('25 Heroic');
	});
});
