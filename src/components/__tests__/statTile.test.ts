// `createElement` rather than JSX so this stays a `.ts` file and is picked up by the project's own
// vitest include patterns — the same reason `smoke.test.ts` gives.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import StatTile from '../primitives/StatTile';

/**
 * The tile's caption, which six call sites used to spell out for themselves.
 *
 * Four sections wrote `` `${t(key)} — ${t('metric.notAsked')}` `` inline in the `label` prop and two
 * more — `elemental/KpiTiles.tsx` and `elemental/FlameShock.tsx` — each kept a local `tile()` helper
 * that did the identical join. Six copies of one em dash is six places for it to become an en dash,
 * a hyphen or a colon, and nothing would have caught that: the copy layer holds the clause but not
 * the punctuation between it and the label.
 *
 * So the tile owns the join and the caller supplies the clause. **This is an ergonomic change and
 * nothing a reader sees moves** — the rendered string was byte-for-byte what the concatenation
 * produced. The join later became a comma, when the em dash was retired from reader-facing copy on
 * 2026-08-28; `elemental/components/sections/__tests__/unaskedVerdict.test.ts` asserts
 * `Totem uptime, not measured at this many enemies` against the page.
 */
describe('StatTile caption', () => {
	const render = (props: Parameters<typeof StatTile>[0]) => renderToStaticMarkup(createElement(StatTile, props));

	it('joins the caption to the label with the comma the em-dash retirement left behind', () => {
		expect(render({ value: '68.2%', label: 'Totem uptime', caption: 'not measured at this many enemies' })).toContain(
			'Totem uptime, not measured at this many enemies',
		);
	});

	/**
	 * The half that decides whether this could be a silent copy change. An omitted caption has to leave
	 * the label exactly as it arrived: not `label, undefined`, and not a trailing comma on the several
	 * hundred tiles across both specs that never pass one.
	 */
	it('leaves the label untouched when there is no caption', () => {
		const html = render({ value: '68.2%', label: 'Totem uptime' });
		expect(html).toContain('>Totem uptime</span>');
		expect(html).not.toContain(','); // no-change guard
		expect(html).not.toContain('undefined');
	});

	/** The join is the tile's, so it is the same join whatever the caller is. */
	it('punctuates every caption identically', () => {
		for (const label of ['Overcapped', 'Good spends', 'Refreshed', 'Multi-dot uptime']) {
			expect(render({ value: '3', label, caption: 'not measured at this many enemies' }), label).toContain(
				`${label}, not measured at this many enemies`,
			);
		}
	});
});
