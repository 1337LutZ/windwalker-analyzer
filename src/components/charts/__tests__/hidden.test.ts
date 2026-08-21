// The curated hide table, and the one thing about it that is not a matter of taste.
//
// `HIDDEN_AURAS` and `HIDDEN_CASTS` are reading decisions and this file does not relitigate them. What
// it pins is the *completeness* of a row: the Capacitive Primal Diamond pays out under two ids, chosen
// by class rather than by anything a player does, and hiding one of them would have drawn a hunter a
// chart of payoff marks that a monk of the same gem does not get, for no reason a reader could see.
import { describe, expect, it } from 'vitest';

import type { AuraLane, CastMark } from '~/lib/types';
import { drawnCastsOf, drawnLanesOf, HIDDEN_AURAS, HIDDEN_CASTS, hiddenNames } from '../hidden';

const mark = (id: number): CastMark => ({ t: 0, id, name: `#${id}`, onGcd: false });
const lane = (key: string, name: string): AuraLane => ({ key, name, id: 0, group: 'proc', windows: [] });

describe('the meta gem pays out under two ids, one per class', () => {
	/**
	 * `sim/common/mop/metagems.go:48` is
	 * `ActionID{SpellID: core.TernaryInt32(isHunter, 141004, 137597)}` — one gem, one mechanic, two ids.
	 * 137597 was hidden and 141004 was declared nowhere in this app at all.
	 */
	it('hides the hunter id on the same terms as the melee one', () => {
		expect(HIDDEN_CASTS.has(137_597)).toBe(true);
		expect(HIDDEN_CASTS.has(141_004)).toBe(true);
	});

	it('drops both from a lane of marks and keeps everything else', () => {
		const kept = drawnCastsOf([mark(137_597), mark(141_004), mark(100_780)]);
		expect(kept.map((c) => c.id)).toEqual([100_780]);
	});

	/** And the table is still a *table*: it hides two ids, not every proc that happens to be an item. */
	it('does not hide the gem’s own counter as a cast', () => {
		expect(HIDDEN_CASTS.has(137_596)).toBe(false);
	});
});

describe('the two hidden lanes', () => {
	it('are the gem counter and the melee legendary cloak, by key', () => {
		expect([...HIDDEN_AURAS].sort()).toEqual(['capacitance', 'flurry-of-xuen']);
	});

	/**
	 * The newly declared item effects are **not** on this table, and that is a decision rather than an
	 * oversight: `essence-of-yulon` is the caster twin of the cloak above and would have the same
	 * argument made for it, but adding a row here is a reader-facing choice and a lane nobody has ever
	 * seen drawn cannot yet be argued to be in the way.
	 */
	it('does not silently absorb the newly declared cloak and enchant procs', () => {
		for (const key of ['essence-of-yulon', 'spirit-of-chi-ji', 'jade-spirit', 'dancing-steel', 'toxic-power']) {
			expect(HIDDEN_AURAS.has(key), key).toBe(false);
		}
	});

	it('names what it hid, once each, for the caption', () => {
		const lanes = [
			lane('capacitance', 'Capacitance'),
			lane('flurry-of-xuen', 'Flurry of Xuen'),
			lane('flurry-of-xuen', 'Flurry of Xuen'),
			lane('jade-spirit', 'Jade Spirit'),
		];
		expect(drawnLanesOf(lanes).map((l) => l.key)).toEqual(['jade-spirit']);
		expect(hiddenNames(lanes)).toEqual(['Capacitance', 'Flurry of Xuen']);
	});
});
