// The Fire Elemental section's note about the pre-pull, which is three claims and not two.
//
// The note used to be a ternary on `fireElemental.prepull`, so a pull that could not answer the
// question at all was told flatly that the elemental "was not out at the bell" — and on a fight shorter
// than the summon's own minute that is not something the log knows. Which note shows is now `lib/score`'s
// call, through the same `toneOf` seam the tiles colour themselves with, so the section and the summary
// card cannot make different claims about one pull.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { WclEvent } from '~/lib/events';
import i18n, { initI18n } from '~/lib/i18n/config';
import { getSpec } from '~/lib/spec';
import type { Analysis, FightDataset } from '~/lib/types';

import { SpecContext } from '~/components/report/specContext';
import { analyse } from '~/specs/elemental/lib';

import FireElemental from '../FireElemental';

const ELEMENTAL_SPEC = getSpec('elemental')!;

initI18n();
const t = i18n.getFixedT('en', 'report');

const T0 = 2_000_000;
const ME = 7;
const BOSS = 15;
const LIGHTNING_BOLT = 403;
const LAVA_BURST = 51_505;
/** The buff the press applies — see `firePrepull.test.ts` for why this is not 2894. */
const FIRE_ELEMENTAL_BUFF = 118_291;

const e = (t: number, type: string, id: number, extra: Record<string, unknown> = {}): WclEvent => ({
	timestamp: T0 + t,
	type,
	abilityGameID: id,
	sourceID: ME,
	targetID: ME,
	...extra,
});

const make = (durationMs: number, extra: readonly WclEvent[]): FightDataset => {
	const fight = {
		id: 5,
		name: 'Iron Qon',
		encounterID: 1662,
		kill: true,
		difficulty: 4,
		size: 25,
		startTime: T0,
		endTime: T0 + durationMs,
	};
	const contact: WclEvent[] = [];
	for (let at = 0; at <= durationMs; at += 5000) {
		contact.push(e(at, 'damage', LIGHTNING_BOLT, { targetID: BOSS, targetInstance: 1, amount: 1000, hitType: 1 }));
	}
	return {
		code: 'ele-fe-note',
		fight,
		actor: { id: ME, name: 'Sparkstorm', type: 'Player' },
		actors: [
			{ id: ME, name: 'Sparkstorm', type: 'Player' },
			{ id: BOSS, name: 'Iron Qon', type: 'NPC', subType: 'Boss' },
		],
		events: [...contact, e(0, 'cast', LAVA_BURST, { targetID: BOSS, targetInstance: 1 }), ...extra],
		table: {
			fight: { ...fight, enemyNPCs: [{ id: BOSS, gameID: 68_078 }] },
			damageDone: {
				entries: [
					{
						name: 'Sparkstorm',
						id: ME,
						type: 'Shaman',
						itemLevel: 553,
						total: 81_000,
						activeTime: durationMs,
						abilities: [{ guid: LIGHTNING_BOLT, name: 'Lightning Bolt', total: 81_000 }],
					},
				],
			},
		},
	};
};

const render = (dataset: FightDataset) =>
	renderToStaticMarkup(
		createElement(
			SpecContext.Provider,
			{ value: ELEMENTAL_SPEC },
			createElement(FireElemental, {
				analysis: analyse(dataset) as Analysis,
			}),
		),
	);

describe('the Fire Elemental pre-pull note', () => {
	it('says it was out when the bell went', () => {
		const html = render(make(200_000, [e(40_000, 'removebuff', FIRE_ELEMENTAL_BUFF)]));
		expect(html).toContain(t('fireElemental.prepullYes'));
		// And the table lists the summon as a use rather than standing empty. It used to assert a second
		// empty-state string here — the wording that papered over having no row at all — which became
		// unreachable the moment the prepull use became a row.
		expect(html).toContain(t('fireElemental.state.prepull'));
		expect(html).not.toContain(t('fireElemental.none'));
	});

	it('says it was not, and that the cooldown it may have been on is unreadable', () => {
		const html = render(make(200_000, []));
		expect(html).toContain(t('fireElemental.none'));
		expect(html).toContain(t('fireElemental.prepullNo'));
		expect(t('fireElemental.prepullNo')).toContain('not something this log can see');
	});

	/** The case the two-way read had no wording for: a pull too short to have left the expiry behind. */
	it('refuses to claim either way on a pull shorter than the summon', () => {
		const html = render(make(45_000, []));
		expect(html).toContain(t('fireElemental.prepullUnknown'));
		expect(html).not.toContain(t('fireElemental.prepullNo'));
	});
});
