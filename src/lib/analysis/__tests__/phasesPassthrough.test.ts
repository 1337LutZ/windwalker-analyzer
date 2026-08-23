// What each shape of `timeline.phases` means, pinned so the next reader cannot re-derive the wrong
// reason from the merge in `analyseCore`.
//
// The merge is guarded — `dataset.phases === undefined ? {} : { phases: dataset.phases }` — and for a
// while its comment said the guard existed to keep "WarcraftLogs knows no phases for this encounter"
// out of the timeline as an empty array, on the grounds that an omitted field and an empty array are
// different facts. They are different facts. They are not *those* facts, and a re-capture of Kor'kron
// Dark Shaman is what showed it: `fetchFightDataset` always sets `phases`, because `resolveFightPhases`
// always returns an array, so the encounter the comment wanted omitted arrives as `[]` and is written
// as `[]`. Six of the fourteen Siege encounters are that case.
//
// What the shapes actually carry:
//
//   - `phases: [...]`  — fetched, and WarcraftLogs reported these transitions.
//   - `phases: []`     — fetched, and WarcraftLogs reported none.
//   - no `phases` key  — never fetched. Only the committed fixtures captured before the field existed,
//                        and datasets hand-built in tests.
//
// The guard still earns its place, for the other reason: an unconditional spread would write the key
// as `undefined` on a dataset that has none, and this object is spread over `audit.timeline`, so that
// would clobber a `phases` a spec's audit had put there. Nothing downstream separates `[]` from absent
// — `CastTimeline` gates both its gutter and its explanatory note on `phases.length` — so the two are
// distinct in the data and identical on screen, which is the whole of the distinction.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { analyseCore } from '~/lib/analysis/analyseCore';
import { defaultSettings } from '~/lib/settings/model';
import type { FightDataset } from '~/lib/types';
import { WW_SETTINGS, WW_SPEC } from '~/specs/windwalker/lib';

/**
 * `dataset-ironJuggernaut.json` — the one committed Windwalker fixture that is a raw `FightDataset`, so
 * the field travels the real path rather than being handed to the merge directly. Re-read per case
 * because each one edits it.
 */
const dataset = (): FightDataset =>
	JSON.parse(
		readFileSync(
			resolve(import.meta.dirname, '../../../specs/windwalker/__fixtures__/dataset-ironJuggernaut.json'),
			'utf8',
		),
	) as FightDataset;

const timelineOf = (from: FightDataset) => analyseCore(from, defaultSettings(WW_SETTINGS), WW_SPEC).timeline;

describe('the phases the fetch found, carried into the analysis', () => {
	it('passes the transitions through unchanged, re-entries and all', () => {
		const from = dataset();
		expect(from.phases?.map((phase) => phase.id)).toEqual([1, 2, 1]);
		expect(timelineOf(from)?.phases).toEqual(from.phases);
	});

	/**
	 * The case the old comment said could not exist. It is the ordinary one: 6 of the 14 Siege encounters
	 * answer `phaseTransitions` with `null`, and `resolveFightPhases` turns that into `[]` rather than
	 * into nothing, so this is what a Dark Shaman pull looks like after a fetch.
	 */
	it('writes an empty list, not an absent field, when the fetch found no transitions', () => {
		const timeline = timelineOf({ ...dataset(), phases: [] });
		expect(timeline && 'phases' in timeline).toBe(true);
		expect(timeline?.phases).toEqual([]);
	});

	/** And absent stays absent, which is the only thing a dataset that predates the field can mean. */
	it('leaves the key off entirely when the dataset never carried one', () => {
		const from = dataset();
		delete from.phases;
		const timeline = timelineOf(from);
		expect(timeline && 'phases' in timeline).toBe(false);
		expect(timeline?.phases).toBeUndefined();
	});
});
