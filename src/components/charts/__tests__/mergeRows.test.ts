// A button and the buff it puts up are one row, including when no button owns the buff.
//
// The merge reads `Aura.appliedBy`, and for most auras that is the whole answer. **Bloodlust has no
// `appliedBy` and that is deliberate**: it is declared across five ids (2825 Bloodlust, 32182 Heroism,
// 80353 Time Warp, 90355 Ancient Hysteria, 146555 Drums of Rage) because the rotation only cares that
// raid haste is up, not which class brought it. No single button applies it, so the model has nothing to
// point at — and the press and the window drew as two rows carrying one name, which is what a reader
// reported.
//
// The fallback matches on the name, which is what the summary timeline has always done (`LanesTimeline`
// keys its row map by `lane.name`). So the two charts now answer the same way instead of one of them
// having a rule the other does not.

import { describe, expect, it } from 'vitest';

import type { AuraLane } from '~/lib/types';
import { mergeRows, type CastLane, type CastRow } from '../CastTimeline';

const press = (id: number, name: string): CastRow => ({
	lane: { id, name, casts: [], rows: 1, rowOf: new Map() } satisfies CastLane,
	nodes: null,
});

const lane = (key: string, name: string, id = 0): AuraLane =>
	({ key, name, id, group: 'buff', windows: [{ start: 0, end: 1000 }] }) as AuraLane;

describe('merging a press onto its aura row', () => {
	it('merges Bloodlust by name, with nothing in the model to point at', () => {
		const { into, loose } = mergeRows([press(2825, 'Bloodlust')], [lane('bloodlust', 'Bloodlust')], new Map());
		expect([...into.keys()]).toEqual(['bloodlust']);
		expect(loose).toEqual([]);
	});

	it('still merges by the model when it has an answer', () => {
		// Berserking *does* declare `appliedBy`, so the id route is the one that fires. Asserted so the
		// fallback cannot quietly become the only path that works.
		const { into, loose } = mergeRows(
			[press(26_297, 'Berserking')],
			[lane('berserking', 'Berserking')],
			new Map([[26_297, 'berserking']]),
		);
		expect([...into.keys()]).toEqual(['berserking']);
		expect(loose).toEqual([]);
	});

	it('prefers the model over the name when the two disagree', () => {
		// An `appliedBy` is the spec being explicit and it wins. The name here would have found the other
		// lane, so this fails if the fallback is ever consulted first.
		const { into } = mergeRows(
			[press(1, 'Tiger Palm')],
			[lane('tiger-power', 'Tiger Power'), lane('tiger-palm-lane', 'Tiger Palm')],
			new Map([[1, 'tiger-power']]),
		);
		expect([...into.keys()]).toEqual(['tiger-power']);
	});

	it('refuses a name two different auras claim', () => {
		// Ambiguity is the one case a name cannot settle, and merging onto either would be a coin toss the
		// reader could not see. The press keeps its own row.
		const { into, loose } = mergeRows(
			[press(7, 'Shared Name')],
			[lane('one', 'Shared Name'), lane('two', 'Shared Name')],
			new Map(),
		);
		expect([...into.keys()]).toEqual([]);
		expect(loose).toHaveLength(1);
	});

	it('refuses a name whose aura is drawn once per enemy', () => {
		// The per-target case the existing `lanesPerKey` guard exists for: the press stream cannot say which
		// add a given cast hit, so putting it on all of them would claim it hit every one. Same answer
		// whether the key arrived from the model or from the name.
		const { into, loose } = mergeRows(
			[press(8, 'Flame Shock')],
			[lane('flame-shock', 'Flame Shock', 1), lane('flame-shock', 'Flame Shock', 2)],
			new Map(),
		);
		expect([...into.keys()]).toEqual([]);
		expect(loose).toHaveLength(1);
	});
});
