// Sharing a WarcraftLogs link with a fight in it should land on that fight.
//
// The chain has three links and each was worth pinning: the URL is parsed, the parsed id becomes the
// default selection if the report really has that fight, and the picker shows it on the collapsed
// row even when it is a wipe buried inside an encounter group. The middle and last links already
// worked; the first silently dropped `?fight=`, which made the whole feature look unimplemented.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { initI18n } from '~/lib/i18n/config';
import type { FightWithRoster } from '~/lib/wcl';

import FightSelector from '../FightSelector';
import { defaultFightID, groupByEncounter } from '../encounterGroups';
import { parseReportInput } from '../parseReportInput';

// `FightSelector` reads its outcome words from `ui.common`, so the picker and the report header
// cannot disagree about what a wipe is called. Without this the translator returns the key.
initI18n();

const fight = (over: Partial<FightWithRoster> & { id: number; encounterID: number }): FightWithRoster => ({
	name: 'Malkorok',
	kill: false,
	difficulty: 4,
	size: 10,
	fightPercentage: 12.3,
	startTime: 0,
	endTime: 120_000,
	friendlyPlayers: [],
	enemyNPCs: [],
	roster: [],
	...over,
});

/** Two bosses: the first has a kill, the second is three wipes and a kill. */
const FIGHTS: FightWithRoster[] = [
	fight({ id: 10, encounterID: 51600, name: 'Iron Juggernaut', kill: true }),
	fight({ id: 28, encounterID: 51595 }),
	fight({ id: 30, encounterID: 51595 }),
	fight({ id: 32, encounterID: 51595, kill: true }),
];

const NAMES = { 3: 'Normal', 4: 'Heroic' };
const groups = groupByEncounter(FIGHTS);

describe('pre-selecting a fight from a shared link', () => {
	it('selects the fight named in a ?fight= link', () => {
		const parsed = parseReportInput('https://classic.warcraftlogs.com/reports/ExampleCode12345?fight=30');
		expect(defaultFightID(groups, parsed.fightID)).toBe(30);
	});

	it('selects it from the #fight= form too', () => {
		const parsed = parseReportInput('https://classic.warcraftlogs.com/reports/ExampleCode12345#fight=28');
		expect(defaultFightID(groups, parsed.fightID)).toBe(28);
	});

	/** Without a fight in the link, the last boss worked on, at its kill — not the shared pull. */
	it('falls back to the last encounter when the link names no fight', () => {
		expect(defaultFightID(groups, parseReportInput('reports/ExampleCode12345').fightID)).toBe(32);
	});

	/** A link from a different report must not silently select an unrelated pull of the same number. */
	it('ignores a fight id this report does not have', () => {
		expect(defaultFightID(groups, 999)).toBe(32);
	});

	/**
	 * The shared pull here is a wipe, and its group's representative is the kill — so this is the case
	 * where the picker could show the right selection state against the wrong pull.
	 */
	it('shows the shared wipe on the collapsed row rather than the group kill', () => {
		const html = renderToStaticMarkup(
			createElement(FightSelector, { fights: FIGHTS, difficultyNames: NAMES, value: 30, onChange: () => {} }),
		);
		// Sentence case, and from `ui.common.wipeAt` rather than a string built in the component — the
		// picker and the report header now print the same three outcome words.
		expect(html).toContain('Wipe at 12.3%');
		expect(html).toContain('10 Heroic');
		// `aria-pressed` is what tells a screen-reader user which pull is live.
		expect(html).toContain('aria-pressed="true"');
	});
});
