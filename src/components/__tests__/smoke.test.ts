// `createElement` rather than JSX so this stays a `.ts` file and is picked up by the project's own
// vitest include patterns.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Analysis, ProcWindow } from '~/lib/types';

import i18n, { initI18n } from '~/lib/i18n/config';

import Report from '../Report';
import { parseReportInput } from '../report/parseReportInput';

initI18n();
const t = i18n.getFixedT('en', 'report');

const procWindow = (over: Partial<ProcWindow>): ProcWindow => ({
	stacksAvailable: 12,
	couldSnapshot: true,
	missedByMs: null,
	start: 10000,
	end: 20000,
	spellID: 139117,
	stat: 'Mastery',
	lengthMs: 10000,
	sameAsPrevious: false,
	snapshotAt: 18500,
	snapshotEnd: 33500,
	snapshotStacks: 10,
	brewEnd: 33500,
	remainingMs: 1500,
	depthPct: 85,
	grade: 'last-gcd',
	brewAlreadyUp: false,
	heldStat: null,
	redundant: false,
	brewCastInside: 1,
	stacksInside: 10,
	gapToNextMs: 30000,
	overlaps: [],
	devaluedMs: 0,
	wastedMs: 0,
	backToBack: false,
	backToBackWasted: false,
	b2bRole: null,
	b2bWaste: false,
	b2bWith: [],
	nextStat: 'Mastery',
	...over,
});

export const base: Analysis = {
	player: 'Testmonk',
	code: 'aBcD1234',
	fightID: 7,
	actorID: 12,
	encounter: 'Test Boss',
	difficulty: 4,
	size: 10,
	difficultyName: 'Heroic',
	kill: true,
	durationMs: 305000,
	itemLevel: 522,
	isSpec: true,
	specName: 'Windwalker',
	primaryTarget: { id: 44, gameID: 71543 },
	damage: {
		wclTotal: 90000000,
		eventTotal: 90000000,
		dps: 295000,
		abilities: [
			{
				id: 1,
				name: 'Blackout Kick',
				total: 20000000,
				hits: 90,
				crits: 40,
				share: 22.2,
				critPct: 44.4,
				avgHit: 222222,
				passive: false,
				utility: false,
			},
			{
				id: 2,
				name: 'Melee',
				total: 15000000,
				hits: 200,
				crits: 80,
				share: 16.6,
				critPct: 40,
				avgHit: 75000,
				passive: true,
				utility: false,
			},
			{
				id: 3,
				name: 'Trinket Proc',
				total: 400000,
				hits: 10,
				crits: 2,
				share: 0.5,
				critPct: 20,
				avgHit: 40000,
				passive: true,
				utility: false,
			},
		],
	},
	cpm: {
		totalCpm: 41.2,
		onGcdCasts: 180,
		offGcdCasts: 22,
		gcdSlots: 200,
		gcdUtilisationPct: 90.1,
		channelSec: 40,
		activeMs: 290000,
		activePct: 95.1,
	},
	casts: [
		{
			id: 1,
			name: 'Jab',
			count: 60,
			onGcd: true,
			gate: 'other',
			cpm: 11.8,
			cooldownSec: null,
			medianGapSec: 3,
			longestGapSec: 9,
			times: [],
		},
		{
			id: 2,
			name: 'Rising Sun Kick',
			count: 30,
			onGcd: true,
			gate: 'cooldown',
			cpm: 5.9,
			cooldownSec: 8,
			medianGapSec: 8.4,
			longestGapSec: 14,
			times: [],
		},
	],
	lostCasts: [
		{
			id: 2,
			name: 'Rising Sun Kick',
			cooldownSec: 8,
			casts: 30,
			driftSec: 22.4,
			lostCasts: 2,
			openerSec: 3,
			tailSec: 4,
			worst: [
				{
					at: 120000,
					seconds: 6.2,
					link: 'https://classic.warcraftlogs.com/reports/x#fight=7',
				},
			],
		},
	],
	brew: {
		uses: 8,
		castCount: 9,
		totalConsumed: 74,
		avgConsumed: 9.25,
		fullUses: 6,
		refreshUses: 1,
		wastedAtCap: 0,
		maxStacks: 20,
		bankAtEnd: 4,
		uptimePct: 39.4,
		windows: [{ start: 18500, end: 33500 }],
		useList: [
			{
				t: 18500,
				before: 20,
				consumed: 10,
				refresh: false,
				window: { start: 18500, end: 33500 },
			},
			{
				t: 90000,
				before: 7,
				consumed: 7,
				refresh: false,
				window: { start: 90000, end: 105000 },
			},
		],
		bankTimeline: [
			[0, 0],
			[12000, 10],
			[18400, 20],
			[18500, 10],
			[90000, 7],
		],
	},
	procs: {
		procs: 3,
		snapshotted: 2,
		narrowlyMissed: 0,
		opportunities: 3,
		unaffordable: 0,
		stackFloor: 4,
		lastGcd: 1,
		late: 0,
		early: 1,
		unsnapshotted: 1,
		redundant: 1,
		sameAsPrevious: 2,
		backToBack: 1,
		backToBackWasted: 1,
		devaluedSec: 4.2,
		medianRemainingSec: 1.5,
		meanDepthPct: 74.5,
		secondsGivenAway: 12.8,
		brewsOutsideProc: 2,
		uptimePct: 9.8,
		statMix: { Mastery: 2, Haste: 1 },
		lastGcdMs: 1500,
		lateMs: 3000,
		windows: [
			procWindow({}),
			procWindow({
				start: 90000,
				end: 100000,
				snapshotAt: 90000,
				remainingMs: 10000,
				depthPct: 0,
				grade: 'early',
				snapshotStacks: 7,
				b2bRole: 'source',
				b2bWaste: true,
				devaluedMs: 4200,
				backToBack: true,
			}),
			procWindow({
				start: 100000,
				end: 110000,
				stat: 'Haste',
				snapshotAt: null,
				snapshotStacks: null,
				remainingMs: null,
				depthPct: null,
				grade: 'none',
				redundant: true,
				brewAlreadyUp: true,
				b2bRole: 'follow-up',
				overlapOfIndex: 1,
				overlapOfMs: 4200,
			}),
		],
	},
	debuff: {
		casts: 30,
		uptimeMs: 280000,
		uptimePct: 91.8,
		engagedMs: 290000,
		engagedUptimePct: 96.5,
		secondsLost: 9.4,
		intermissionSec: 15.2,
		drops: [{ at: 150000, seconds: 4.2 }],
		windows: [
			{ start: 3000, end: 150000 },
			{ start: 154200, end: 305000 },
		],
		primaryDamageShare: 98,
		singleTarget: true,
		engagedSegments: [[0, 305000]],
	},
	channel: {
		casts: 2,
		channelSec: 8,
		avgChannelSec: 4,
		withBrew: 1,
		inProc: 1,
		clean: 1,
		faulted: 1,
		energyCheckable: false,
		castList: [
			{
				t: 20000,
				channelMs: 4000,
				ticks: 5,
				energizingBrew: false,
				rjwCovers: false,
				brewUp: true,
				procRemainingMs: 3000,
				faults: [],
				link: 'https://classic.warcraftlogs.com/reports/x#fight=7',
			},
			{
				t: 140000,
				channelMs: 3800,
				ticks: 4,
				energizingBrew: true,
				rjwCovers: false,
				brewUp: false,
				procRemainingMs: null,
				faults: ['overlapped Energizing Brew'],
				link: 'https://classic.warcraftlogs.com/reports/x#fight=7',
			},
		],
	},
	karma: {
		casts: 1,
		available: 3,
		reflected: 250_000,
		sharePct: 1.2,
		capPerUse: null,
		uses: [{ t: 40_000, reflected: 250_000, hits: 6, capPct: null }],
	},
	filler: {
		casts: 3,
		onProc: 1,
		applied: 0,
		refresh: 1,
		wasted: 1,
		refreshWindowSec: 1,
		buffUptimePct: 97.2,
		castList: [
			{ t: 5000, proc: true, buffLeftMs: 12000, reason: 'proc' },
			{ t: 40000, proc: false, buffLeftMs: 800, reason: 'refresh' },
			{ t: 70000, proc: false, buffLeftMs: 14000, reason: 'wasted' },
		],
	},
	comboBreaker: [{ id: 116768, label: 'Blackout Kick', procs: 9, wasted: 1 }],
	misses: [
		{
			kind: 'Tiger Palm wasted',
			at: 70000,
			detail: 'Tiger Power had 14.0s left',
			link: 'https://classic.warcraftlogs.com/reports/x#fight=7',
		},
		{
			kind: 'RSK dropped',
			at: 150000,
			detail: '4.2s without the debuff',
			link: 'https://classic.warcraftlogs.com/reports/x#fight=7',
		},
	],
};

describe('parseReportInput', () => {
	it('pulls the code, fight and source out of a pasted URL', () => {
		expect(parseReportInput('https://classic.warcraftlogs.com/reports/aBcD1234efGH5678#fight=12&source=5')).toEqual(
			{
				code: 'aBcD1234efGH5678',
				fightID: 12,
				sourceID: 5,
			},
		);
	});

	it('accepts a bare code', () => {
		expect(parseReportInput('  aBcD1234efGH5678 ').code).toBe('aBcD1234efGH5678');
	});

	it('rejects nonsense', () => {
		expect(parseReportInput('hello').code).toBeNull();
	});

	/**
	 * Anonymous reports carry an `a:` prefix that is part of the code, not decoration — the API
	 * answers "This report does not exist." for the same code without it. The pattern used to allow
	 * only letters and digits, so pasting one of these URLs captured a bare `a` and then failed as a
	 * mistyped code.
	 */
	it('keeps the a: prefix of an anonymous report', () => {
		expect(parseReportInput('https://classic.warcraftlogs.com/reports/a:6MhZgjyAknFWrYfK').code).toBe(
			'a:6MhZgjyAknFWrYfK',
		);
		expect(parseReportInput('a:6MhZgjyAknFWrYfK').code).toBe('a:6MhZgjyAknFWrYfK');
	});

	/**
	 * The form WarcraftLogs actually produces today. Reading only the `#fragment` meant a link copied
	 * straight from the address bar pre-selected nothing, which looked like the picker ignoring it.
	 */
	it('reads the fight from a ?fight= query string', () => {
		const parsed = parseReportInput('https://classic.warcraftlogs.com/reports/aBcDeFgH12345678?fight=30');
		expect(parsed.code).toBe('aBcDeFgH12345678');
		expect(parsed.fightID).toBe(30);
	});

	/**
	 * The reason the bare-code branch runs before `new URL`: `a:CODE` is a valid absolute URL whose
	 * scheme is `a`, so parsing it as one truncates the code to the part after the colon. Deleting
	 * that branch as redundant would break anonymous codes and pass every other test here.
	 */
	it('does not mistake an anonymous code for a URL scheme', () => {
		expect(new URL('a:6MhZgjyAknFWrYfK', 'https://classic.warcraftlogs.com/').protocol).toBe('a:');
		expect(parseReportInput('a:6MhZgjyAknFWrYfK').code).toBe('a:6MhZgjyAknFWrYfK');
	});

	it('tolerates surrounding whitespace and a trailing slash', () => {
		expect(parseReportInput('  https://classic.warcraftlogs.com/reports/aBcDeFgH12345678?fight=30  ')).toEqual({
			code: 'aBcDeFgH12345678',
			fightID: 30,
			sourceID: null,
		});
	});

	it('reads a source from either form', () => {
		expect(parseReportInput('reports/abcd1234efgh5678?fight=3&source=12').sourceID).toBe(12);
		expect(parseReportInput('reports/abcd1234efgh5678#fight=3&source=12').sourceID).toBe(12);
	});

	/** The fragment is rewritten as you click around a report, so it is the fresher of the two. */
	it('prefers the fragment when a URL carries both', () => {
		expect(parseReportInput('reports/abcd1234efgh5678?fight=30#fight=12').fightID).toBe(12);
	});

	it('does not mistake the query string for part of the code', () => {
		expect(parseReportInput('https://classic.warcraftlogs.com/reports/a:6MhZgjyAknFWrYfK?fight=57').code).toBe(
			'a:6MhZgjyAknFWrYfK',
		);
	});

	it('still reads the fight out of an anonymous report URL', () => {
		const parsed = parseReportInput('https://classic.warcraftlogs.com/reports/a:6MhZgjyAknFWrYfK#fight=57');
		expect(parsed.code).toBe('a:6MhZgjyAknFWrYfK');
		expect(parsed.fightID).toBe(57);
	});
});

describe('Report', () => {
	it('renders every section', () => {
		const html = renderToStaticMarkup(createElement(Report, { analysis: base }));
		// Asserted through the locale rather than as literal headings. Section titles are copy now, so
		// spelling them out here would mean every wording change breaks a test that is really about
		// whether all the sections mounted — and the obvious "fix" would be to paste the new wording
		// back in, which tests nothing.
		for (const section of [
			'snapshots',
			'brew',
			'casts',
			'debuff',
			'fistsOfFury',
			'tigerPalm',
			'damage',
			'misses',
			'method',
			'timeline',
		]) {
			expect(html, `${section}.title missing from the report`).toContain(t(`${section}.title`));
		}
		expect(html).toContain('295k');
		expect(html).toContain('Testmonk');
	});

	it('refuses to render for the wrong spec', () => {
		const html = renderToStaticMarkup(createElement(Report, { analysis: { ...base, isSpec: false } }));
		expect(html).toContain('was not Windwalker');
		expect(html).not.toContain('Miss ledger');
	});

	it('survives an empty fight', () => {
		const empty: Analysis = {
			...base,
			damage: { ...base.damage, abilities: [] },
			casts: [],
			lostCasts: [],
			misses: [],
			brew: { ...base.brew, bankTimeline: [], useList: [] },
			procs: {
				...base.procs,
				windows: [],
				statMix: {},
				procs: 0,
				lastGcd: 0,
				early: 0,
				unsnapshotted: 0,
				medianRemainingSec: null,
			},
			channel: { ...base.channel, castList: [] },
			filler: { ...base.filler, castList: [] },
			comboBreaker: [],
		};
		expect(() => renderToStaticMarkup(createElement(Report, { analysis: empty }))).not.toThrow();
	});
});
