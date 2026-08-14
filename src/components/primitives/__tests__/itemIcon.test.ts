// `createElement` rather than JSX so this stays a `.ts` file and is picked up by the project's own
// vitest include patterns.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import ItemIcon from '../ItemIcon';

const render = (props: Partial<Parameters<typeof ItemIcon>[0]> = {}) =>
	renderToStaticMarkup(
		createElement(ItemIcon, {
			id: 95841,
			icon: 'inv_helm_leather_raidmonk_j_01.jpg',
			quality: 4,
			label: 'Head — open item 95841 on Wowhead',
			...props,
		}),
	);

describe('ItemIcon', () => {
	/**
	 * The set block is the whole point of the parameter: without it Wowhead draws the tier bonuses
	 * with every piece greyed and the counter at (0/5), which is wrong for anyone actually wearing it.
	 */
	it('tells the tooltip which pieces of the set are worn', () => {
		const html = render({ setPieceIds: [95841, 95842, 95843] });
		// Colon-separated, matching wowsims-mop ui/core/wowhead.ts:127-128.
		expect(html).toContain('data-wowhead="pcs=95841:95842:95843"');
	});

	/**
	 * A piece in no set must be left exactly as it was — and this is also the shape every fixture
	 * captured before `setID` was read comes back as, so it has to render rather than throw.
	 */
	it('leaves a piece that is in no set alone', () => {
		expect(render()).not.toContain('data-wowhead');
		expect(render({ setPieceIds: [] })).not.toContain('data-wowhead');
	});

	/**
	 * The hovered piece is part of its own set. Dropping it would under-count the set by one, because
	 * the widget fills in the "(0/5)" header by counting the ids in `pcs` it can match.
	 */
	it('counts the piece being hovered as one of the set', () => {
		expect(render({ id: 95841, setPieceIds: [95841, 95842] })).toContain('pcs=95841:95842');
	});

	/** The tooltip is an addition to the link, not a replacement for it. */
	it('still links to the item page', () => {
		expect(render({ setPieceIds: [95841] })).toContain('href="https://www.wowhead.com/mop-classic/item=95841"');
	});

	/** An empty slot is not an item, and a link to `item=0` is a page that does not exist. */
	it('renders nothing for an empty slot', () => {
		expect(render({ id: 0 })).toBe('');
	});
});
