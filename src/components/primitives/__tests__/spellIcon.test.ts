import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import SpellIcon from '../SpellIcon';
import { spellIconName } from '../spellIcon';

const render = (id: number) => renderToStaticMarkup(createElement(SpellIcon, { id }));

describe('SpellIcon', () => {
	it('resolves a known spell to its Wowhead icon', () => {
		// Rising Sun Kick. Names come from the build-time map, not from a request at render time.
		expect(spellIconName(107428)).toBe('ability_monk_risingsunkick');
		expect(render(107428)).toContain('https://wow.zamimg.com/images/wow/icons/large/ability_monk_risingsunkick.jpg');
	});

	/**
	 * Trinket and enchant procs turn up in real logs that no icon map will ever fully cover, and a
	 * row of broken-image glyphs beside them would be worse than no icons at all.
	 */
	it('renders nothing for an id it does not know', () => {
		expect(spellIconName(999_999)).toBeNull();
		expect(render(999_999)).toBe('');
	});

	/** The ability's name is always beside it, so announcing the icon reads the same thing twice. */
	it('is decorative, not announced', () => {
		const html = render(107428);
		expect(html).toContain('alt=""');
		expect(html).toContain('aria-hidden="true"');
	});

	/** Every rendered size is at least 24px, which is the floor the icons were asked to hold. */
	it('never draws below 24px', () => {
		for (const size of ['sm', 'md', 'lg'] as const) {
			const html = renderToStaticMarkup(createElement(SpellIcon, { id: 107428, size }));
			const px = Number(/h-(\d+)/.exec(html)?.[1] ?? 0) * 4;
			expect(px, `${size} renders at ${px}px`).toBeGreaterThanOrEqual(24);
		}
	});

	/** A late icon must not reflow the table it sits in. */
	it('reserves its box', () => {
		const html = render(107428);
		expect(html).toContain('width="56"');
		expect(html).toContain('height="56"');
		expect(html).toContain('loading="lazy"');
	});

	it('covers the whole kit, not just the ones that happened to be in a fixture', () => {
		// Every ability the report can name in a cast or lost-cast table.
		for (const id of [100787, 100784, 107428, 113656, 116847, 101546, 115098, 115288, 115399, 1247275]) {
			expect(spellIconName(id), `no icon for ${id}`).not.toBeNull();
		}
	});

	/**
	 * The presses that are not abilities — a flask, a battle elixir, a potion, a profession on-use, a
	 * racial — which are the ones the map keeps losing, because none of them is discovered the way a
	 * spell in the rotation is. All four elixir ids reached `ABILITIES` and not one of them reached
	 * this map, so the timeline drew a bare tick beside a press it could already name.
	 *
	 * Written out rather than derived from the generator's own sources: a test that read the list the
	 * generator reads could only ever agree with it, and agreeing was never the failure.
	 */
	it('covers the off-GCD kit and the presses only a live log carries', () => {
		for (const id of [6262, 33697, 105682, 105684, 105688, 105689, 105697, 121279, 122278, 126734]) {
			expect(spellIconName(id), `no icon for ${id}`).not.toBeNull();
		}
	});
});

/**
 * The tooltip, and the label that shares it.
 *
 * `power.js` raises the card off the href, so what these assert is the link — there is no client-side
 * behaviour to drive here, and asserting the widget's own output would be testing Wowhead.
 *
 * The two shapes differ on purpose and the difference is the interesting part: a bare icon is
 * decoration beside a name already on screen, so it stays out of the accessibility tree and out of the
 * tab order; an icon with a label *is* the name, so it is neither.
 */
describe('SpellIcon, linked to Wowhead', () => {
	const RSK = 107428;
	const withLabel = (label: string) => renderToStaticMarkup(createElement(SpellIcon, { id: RSK, label }));

	it('links the icon to the spell page, which is what raises the tooltip', () => {
		expect(render(RSK)).toContain('href="https://www.wowhead.com/mop-classic/spell=107428"');
	});

	it('opens off-site links in a new tab without handing over the referrer', () => {
		const html = render(RSK);
		expect(html).toContain('target="_blank"');
		expect(html).toContain('rel="noreferrer noopener"');
	});

	it('keeps a bare icon out of the accessibility tree and out of the tab order', () => {
		// The name is already rendered as text beside it, so announcing the icon reads it twice — the same
		// reason `alt` is empty. And a link with no accessible name is worse than no link.
		const html = render(RSK);
		expect(html).toContain('aria-hidden="true"');
		expect(html).toContain('tabindex="-1"');
	});

	it('puts the label inside the same link, so the tooltip covers the name too', () => {
		const html = withLabel('Rising Sun Kick');
		expect(html).toContain('href="https://www.wowhead.com/mop-classic/spell=107428"');
		expect(html).toContain('Rising Sun Kick');
		// One anchor, not an anchor beside a span: the pair cannot drift apart when a table reflows.
		expect(html.match(/<a /g)).toHaveLength(1);
	});

	it('makes a labelled icon reachable, because there the link is the name', () => {
		expect(withLabel('Rising Sun Kick')).not.toContain('tabindex="-1"');
	});

	it('still renders nothing for an id with no icon, label or not', () => {
		expect(renderToStaticMarkup(createElement(SpellIcon, { id: 999_999, label: 'Nonesuch' }))).toBe('');
	});
});
