// `createElement` rather than JSX so this stays a `.ts` file and is picked up by the project's own
// vitest include patterns.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { initI18n } from '~/lib/i18n/config';
import type { Analysis, GearSlot } from '~/lib/types';

import { SpecContext } from '~/components/report/specContext';
import { getSpec } from '~/lib/spec';

import GearSetup from '../GearSetup';

// Every fixture below is a Windwalker pull, so the section is rendered under the Windwalker's own
// scorer and copy. Named rather than left to `SpecContext`'s default, which is the build's pinned
// `DEFAULT_SPEC` — under `PUBLIC_SPEC=elemental` that scored these monk fixtures with the Shaman's
// thresholds.
const WINDWALKER_SPEC = getSpec('windwalker')!;
const asWindwalker = (node: ReactNode): ReactElement =>
	createElement(SpecContext.Provider, { value: WINDWALKER_SPEC }, node);

initI18n();

const fx = (name: string): Analysis =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../specs/windwalker/__fixtures__/${name}.json`), 'utf8'));

const slot = (over: Partial<GearSlot>): GearSlot => ({
	slot: 'Head',
	id: 99178,
	itemLevel: 553,
	quality: 4,
	icon: 'inv_helm_leather_raidmonk_o_01.jpg',
	gems: [],
	enchantID: null,
	enchantable: false,
	setID: null,
	...over,
});

/**
 * A real analysis with its gear swapped out.
 *
 * The section reads copy and settings off the whole `Analysis`, so a hand-built stub of just the
 * gear cannot render — the fixture supplies everything this test is not about.
 */
const render = (slots: GearSlot[]) =>
	renderToStaticMarkup(
		asWindwalker(
			createElement(GearSetup, {
				analysis: { ...fx('strong'), gear: { slots, averageItemLevel: 553, missingEnchants: [], gems: 0 } },
			}),
		),
	);

describe('Gear section set bonuses', () => {
	/** Two pieces of one set means each of them tells the tooltip about both. */
	it('gives every piece of a set the whole set it is wearing', () => {
		const html = render([
			slot({ slot: 'Head', id: 99178, setID: 1108 }),
			slot({ slot: 'Chest', id: 99179, setID: 1108 }),
		]);
		expect(html).toContain('data-wowhead="pcs=99178:99179"');
		// Both rows carry it, not just the first — the count is a property of the character.
		expect(html.match(/data-wowhead="pcs=99178:99179"/g)).toHaveLength(2);
	});

	/** Two different sets must not be pooled into one list. */
	it('keeps separate sets apart', () => {
		const html = render([
			slot({ slot: 'Head', id: 99178, setID: 1108 }),
			slot({ slot: 'Chest', id: 99179, setID: 1108 }),
			slot({ slot: 'Hands', id: 88888, setID: 1200 }),
		]);
		expect(html).toContain('data-wowhead="pcs=99178:99179"');
		expect(html).toContain('data-wowhead="pcs=88888"');
	});

	it('says nothing about a piece that is in no set', () => {
		expect(render([slot({ slot: 'Head', id: 99178, setID: null })])).not.toContain('data-wowhead');
	});

	/**
	 * The guard this pins is the one the type system cannot: fixtures are cast from JSON, so a report
	 * captured before `setID` was read has no such key and arrives as `undefined`, not `null`. Grouped
	 * on `=== null` that lands every fieldless piece under one shared key and hands each of them a
	 * "set" naming the entire wardrobe — a tooltip claiming a 4-piece bonus off four unrelated items.
	 */
	it('treats a piece with no set id at all as being in no set', () => {
		const missing = [slot({ slot: 'Head', id: 99178 }), slot({ slot: 'Chest', id: 99179 })].map(
			({ setID: _drop, ...rest }) => rest as GearSlot,
		);

		expect(render(missing)).not.toContain('data-wowhead');
	});

	/** And the same thing on the real fixtures, which is the shape actually shipping today. */
	it('renders the committed fixtures without inventing a set', () => {
		for (const name of ['strong', 'poor', 'mixed']) {
			const analysis = fx(name);
			// Guards the assertion below: if a re-captured fixture ever does carry set ids this test is
			// no longer testing the absent-field path and should be re-read rather than trusted.
			const hasSetIds = analysis.gear.slots.some((s) => s.setID != null);
			if (hasSetIds) continue;
			expect(renderToStaticMarkup(asWindwalker(createElement(GearSetup, { analysis }))), name).not.toContain(
				'data-wowhead',
			);
		}
	});
});
