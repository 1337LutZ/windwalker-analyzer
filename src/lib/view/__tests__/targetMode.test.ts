import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import i18n, { initI18n } from '~/lib/i18n/config';
import type { Analysis, FightDataset } from '~/lib/types';
import { analyse as analyseElemental } from '~/specs/elemental';

import {
	bandForMode,
	bandsInPull,
	type OfferedChoice,
	resolveBands,
	resolveTargetMode,
	targetModeChoices,
	TARGET_MODE_MIN_MS,
} from '../targetMode';

initI18n();
const t = i18n.getFixedT('en', 'report');

describe('resolveTargetMode', () => {
	it('follows the detection when the reader has not asked for anything', () => {
		expect(resolveTargetMode('multi', 'auto')).toEqual({ mode: 'multi', detected: 'multi', overridden: false });
	});

	/**
	 * The case the override exists for: a player who ignored the adds to parse played the single-target
	 * rotation, and the detection saying otherwise is a fact about the pull rather than about them.
	 */
	it('takes the reader’s word and keeps what was detected beside it', () => {
		expect(resolveTargetMode('multi', 'single')).toEqual({ mode: 'single', detected: 'multi', overridden: true });
	});

	/** Choosing what was already detected is not a disagreement, so nothing has to be said about it. */
	it('is not an override when the choice agrees with the detection', () => {
		expect(resolveTargetMode('single', 'single').overridden).toBe(false);
	});

	/**
	 * The half the widening added, and the one a literal comparison would have got wrong.
	 *
	 * The detection has two words and the reader has three, so `'cleave'` against a pull detected
	 * `'multi'` is not a contradiction — it is the reader saying which kind of spreading, about a
	 * measurement that never claimed to know. Reporting it as an override would put an amber switch and
	 * a "you are reading it as a cleave anyway" on a pull that agrees with them.
	 */
	it('does not call a finer answer a contradiction of the coarse one', () => {
		expect(resolveTargetMode('multi', 'cleave').overridden).toBe(false);
		expect(resolveTargetMode('multi', 'aoe').overridden).toBe(false);
		// And the disagreement that survives the fold is the one the override exists for, both ways round.
		expect(resolveTargetMode('single', 'cleave').overridden).toBe(true);
		expect(resolveTargetMode('single', 'aoe').overridden).toBe(true);
		expect(resolveTargetMode('multi', 'single').overridden).toBe(true);
	});

	/**
	 * An analysis captured before the counts existed has no detected mode, and this must not invent
	 * one: a caller handed `'single'` here would grade a pull against the single-target list on the
	 * strength of a guess.
	 */
	it('says nothing was detected rather than defaulting to one', () => {
		expect(resolveTargetMode(undefined, 'auto')).toEqual({ mode: null, detected: null, overridden: false });
		expect(resolveTargetMode(undefined, 'multi')).toEqual({ mode: 'multi', detected: null, overridden: false });
	});
});

/**
 * The control's own copy, enumerated here rather than checked by the key test — it reads its labels
 * out of a record keyed by the choice, and that test can only see literal keys.
 */
const OFFERED: readonly OfferedChoice[] = ['auto', 'single', 'cleave', 'aoe'];

describe('target mode copy', () => {
	it('names every choice a control can offer, long and short', () => {
		for (const choice of OFFERED) {
			expect(t(`targets.${choice}`), choice).not.toBe(`targets.${choice}`);
		}
		// The toolbar's own labels, which are separate keys rather than truncations of the ones above and
		// so can go missing on their own. Spelled out because the record that reads them is keyed by
		// choice, which the key test cannot see through.
		for (const key of ['shortAuto', 'shortSingle', 'shortCleave', 'shortAoe']) {
			expect(t(`targets.${key}`), key).not.toBe(`targets.${key}`);
		}
		expect(t('targets.onlyWhole')).not.toBe('targets.onlyWhole');
	});

	it('says what was detected, in both modes, and what an override contradicts', () => {
		// Two arms for the detection and three for the override, because the two answer different
		// questions: `TargetSummary.detected` only ever produces the coarse pair, and the override is the
		// reader's own finer word.
		for (const mode of ['single', 'multi'] as const) {
			expect(t('targets.detected', { context: mode, share: 40 })).toContain('40');
		}
		for (const mode of ['single', 'cleave', 'aoe'] as const) {
			expect(t('targets.overridden', { context: mode }), mode).not.toBe('targets.overridden');
		}
		expect(t('targets.detectedNone')).not.toBe('targets.detectedNone');
	});
});

/**
 * The reading a mode cannot give, measured on the pulls we hold.
 *
 * Both fixture families, because the two say different halves of it. The Windwalker's are pre-analysed
 * `Analysis` objects, so they cost nothing and there are six of them; the Elemental's are raw datasets
 * run through `analyse`, and they are the three pulls the exemption was designed against.
 */
const windwalker = (name: string): Analysis =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../specs/windwalker/__fixtures__/${name}.json`), 'utf8'));

const elemental = (name: string): Analysis =>
	analyseElemental(
		JSON.parse(
			readFileSync(resolve(import.meta.dirname, `../../../specs/elemental/__fixtures__/${name}.json`), 'utf8'),
		) as FightDataset,
	);

/** A timeline of nothing but mode durations, for the arithmetic the fixtures cannot pin on their own. */
const timelineOf = (runs: readonly [string, number][]): Parameters<typeof resolveBands>[2] => {
	let at = 0;
	return {
		floorMs: 8000,
		segments: runs.map(([mode, ms], index) => {
			const startMs = at;
			at += ms;
			return { index, startMs, endMs: at, mode, dominance: 1, bands: [], medianEnemies: 0, msByCount: {} };
		}),
	} as unknown as Parameters<typeof resolveBands>[2];
};

describe('resolveBands', () => {
	/**
	 * The bug, in one assertion. `strong` is detected single-target — and it spends time at two, three
	 * and four enemies. Every metric on it is graded today against whichever single list its one-word
	 * mode named, and the four bands are what says otherwise.
	 */
	it('reads a mixed pull as the several bands it was fought at', () => {
		expect(resolveBands(windwalker('strong').targets, 'auto')).toEqual({
			bands: [1, 2, 3, 4],
			// The lossy arm, carried beside the set rather than replaced by it: the mode is what the
			// whole-pull weights still ask for, and on this pull it is the reading the four bands contradict.
			mode: 'single',
			forced: false,
			// The default reading covers the whole pull, which is what `null` says — and deliberately not
			// an empty array, which would read as "no stretch qualifies" and empty every clock at once.
			spans: null,
		});
		expect(bandForMode('single')).toBe(1);
	});

	/** The Elemental pull the reported bug came off: eleven metrics, a hundred and twenty-one windows, all four bands. */
	it('reads the cleave pull as all four bands', () => {
		expect(resolveBands(elemental('cleave').targets, 'auto').bands).toEqual([1, 2, 3, 4]);
	});

	/**
	 * Deliberate no-change guards: neither `phased` nor `unbroken` ever exceeds one enemy, so band 1 is
	 * the whole of both pulls and no band declaration can move a metric on either. They are here to
	 * prove that, not as evidence that anything separates.
	 */
	it('reads the two single-target pulls as band 1 alone', () => {
		expect(resolveBands(elemental('phased').targets, 'auto').bands).toEqual([1]);
		expect(resolveBands(elemental('unbroken').targets, 'auto').bands).toEqual([1]);
		// Deliberate no-change guard, Windwalker side: `weave` is the one monk fixture that never cleaves.
		expect(resolveBands(windwalker('weave').targets, 'auto').bands).toEqual([1]);
	});

	/**
	 * The reader's override is a mode, so it narrows to one band — and it is marked `forced`, because a
	 * pull read at one band on the reader's word is a different fact from one that was fought at one.
	 */
	it('narrows to the one band the reader forced', () => {
		expect(resolveBands(windwalker('cleave').targets, 'single')).toEqual({
			bands: [1],
			mode: 'single',
			forced: true,
			// No segments handed over, so the forced reading still covers the whole pull. A caller that
			// wants the narrower one passes the timeline; every existing caller keeps what it had.
			spans: null,
		});
		expect(resolveBands(windwalker('cleave').targets, 'aoe')).toEqual({
			bands: [3],
			mode: 'aoe',
			forced: true,
			spans: null,
		});
		// The band the two-value vocabulary could not name. `cleave` used to arrive as band 3 and be
		// judged against a list holding Spinning Crane Kick, which the priority list does not contain
		// until three enemies.
		expect(resolveBands(windwalker('cleave').targets, 'cleave')).toEqual({
			bands: [2],
			mode: 'cleave',
			forced: true,
			spans: null,
		});
		expect([bandForMode('single'), bandForMode('cleave'), bandForMode('aoe'), bandForMode('multi')]).toEqual([
			1, 2, 3, 3,
		]);
	});

	/**
	 * A pull with no counts says nothing rather than defaulting, the same refusal `resolveTargetMode`
	 * makes. Never the empty array: empty would read as "no band applies" and exempt every banded rule
	 * at once.
	 */
	it('says nothing was detected rather than inventing a band', () => {
		expect(bandsInPull(undefined)).toBeNull();
		expect(resolveBands(undefined, 'auto')).toEqual({ bands: null, mode: null, forced: false, spans: null });
	});
});

/**
 * The menu, which is a claim about this pull and no longer a constant.
 *
 * Measured on the analysed fixtures rather than on a hand-built timeline, because the point of
 * deriving it is that real pulls disagree — a hand-built one would only prove the arithmetic.
 */
describe('the readings a pull offers', () => {
	it('offers the whole fight and nothing else when the pull has no timeline', () => {
		// Every committed `Analysis` capture predates `Analysis.segments`. Offering the three anyway
		// would offer the reading this whole mechanism removes: `spansForChoice` has no timeline to cut
		// with, so the bands would narrow and every clock would keep running over the whole pull.
		expect(targetModeChoices(undefined)).toEqual(['auto']);
		expect(windwalker('cleave').segments).toBeUndefined();
	});

	it('offers only single target on a pull that never left one enemy', () => {
		expect(targetModeChoices(elemental('unbroken').segments)).toEqual(['auto', 'single']);
		expect(targetModeChoices(elemental('phased').segments)).toEqual(['auto', 'single']);
	});

	/**
	 * ***The fixture named `cleave` does not offer Cleave, and that is the case for deriving the menu.***
	 * It spends 15.4s of 263s in a cleave segment against 67.5s of aoe: its multi-target time is an
	 * eight-target reading, not a two-target one, and a fixed list would have put a button on the page
	 * offering a letter earned over fifteen seconds.
	 */
	it('offers only what the pull held for long enough, not everything it touched', () => {
		expect(targetModeChoices(elemental('cleave').segments)).toEqual(['auto', 'single', 'aoe']);
		expect(targetModeChoices(elemental('addsThenBoss').segments)).toEqual(['auto', 'single', 'cleave', 'aoe']);
	});

	it('never offers a mode under the floor, and offers one exactly on it', () => {
		const at = (ms: number) => targetModeChoices(timelineOf([['cleave', ms]]));
		expect(at(TARGET_MODE_MIN_MS - 1)).toEqual(['auto']);
		expect(at(TARGET_MODE_MIN_MS)).toEqual(['auto', 'cleave']);
	});

	/**
	 * `mixed` and `idle` are never positions, however much of the pull they are. A `mixed` stretch is one
	 * no single rotation described, so the reading that keeps it is the whole fight; `idle` is time
	 * nothing was there to be hit. A pull that is all of those two offers the whole fight alone.
	 */
	it('offers no position for mixed or idle, whatever they add up to', () => {
		expect(
			targetModeChoices(
				timelineOf([
					['mixed', 200_000],
					['idle', 90_000],
				]),
			),
		).toEqual(['auto']);
	});

	it('always puts the whole fight first, then the readings in ascending enemy count', () => {
		const every = timelineOf([
			['aoe', 60_000],
			['single', 60_000],
			['cleave', 60_000],
		]);
		expect(targetModeChoices(every)).toEqual(['auto', 'single', 'cleave', 'aoe']);
	});
});

describe('the stretches a forced reading covers', () => {
	/** A pull that opens single, takes an add wave, goes quiet, then cleaves — one of each mode. */
	const timeline = {
		floorMs: 8000,
		segments: [
			{
				index: 0,
				startMs: 0,
				endMs: 30_000,
				mode: 'single',
				dominance: 1,
				bands: [1],
				medianEnemies: 1,
				msByCount: {},
			},
			{
				index: 1,
				startMs: 30_000,
				endMs: 50_000,
				mode: 'aoe',
				dominance: 1,
				bands: [3],
				medianEnemies: 4,
				msByCount: {},
			},
			{
				index: 2,
				startMs: 50_000,
				endMs: 70_000,
				mode: 'idle',
				dominance: 1,
				bands: [],
				medianEnemies: 0,
				msByCount: {},
			},
			{
				index: 3,
				startMs: 70_000,
				endMs: 90_000,
				mode: 'cleave',
				dominance: 1,
				bands: [2],
				medianEnemies: 2,
				msByCount: {},
			},
			{
				index: 4,
				startMs: 90_000,
				endMs: 99_000,
				mode: 'mixed',
				dominance: 0.5,
				bands: [1, 2],
				medianEnemies: 2,
				msByCount: {},
			},
		],
	} as unknown as Parameters<typeof resolveBands>[2];

	const targets = windwalker('cleave').targets;

	it('keeps only the stretches the reader asked for', () => {
		expect(resolveBands(targets, 'single', timeline).spans).toEqual([[0, 30_000]]);
	});

	/**
	 * The fold this widening exists to remove. Asking for the pack used to hand back every two-target
	 * stretch with it, so the clock a reader thought was about the pack ran through both.
	 */
	it('gives each offered reading its own stretches and nobody else’s', () => {
		expect(resolveBands(targets, 'cleave', timeline).spans).toEqual([[70_000, 90_000]]);
		expect(resolveBands(targets, 'aoe', timeline).spans).toEqual([[30_000, 50_000]]);
	});

	/**
	 * `mixed` changed sides and belongs to no narrowed reading now. It used to be filed with the
	 * multi-target half on the argument that a stretch which was not single-target must be the other
	 * thing; with three positions that argument is gone, and handing it to `cleave` or `aoe` would pick a
	 * winner the segmentation already declined to pick. The whole fight is what keeps it.
	 */
	it('leaves the mixed stretch to the whole fight and to nothing narrower', () => {
		const narrowed = (['single', 'cleave', 'aoe'] as const).flatMap(
			(choice) => resolveBands(targets, choice, timeline).spans ?? [],
		);
		expect(narrowed.some(([from, to]) => from < 99_000 && to > 90_000)).toBe(false);
	});

	it('keeps the old union under the coarse reading no control offers, and merges what abuts', () => {
		// Cleave, aoe and mixed together — `'multi'` means "two or more", which is what a caller holding
		// a detected mode is asking for. The two that touch at 90 000 come back as one span, not two.
		expect(resolveBands(targets, 'multi', timeline).spans).toEqual([
			[30_000, 50_000],
			[70_000, 99_000],
		]);
	});

	it('leaves idle out of every reading, because nothing was there to be hit', () => {
		const covered = (['single', 'cleave', 'aoe', 'multi'] as const)
			.flatMap((choice) => resolveBands(targets, choice, timeline).spans ?? [])
			.some(([from, to]) => from < 70_000 && to > 50_000);
		expect(covered).toBe(false);
	});

	it('says null rather than nothing-qualifies when the pull has no segments at all', () => {
		// The distinction is the whole guard: an empty array would read as "no stretch qualifies" and
		// empty every clock at once, which is the direction this mechanism exists to avoid. Every fixture
		// captured before segments existed arrives here.
		expect(resolveBands(targets, 'single', undefined).spans).toBeNull();
		expect(resolveBands(targets, 'single', { floorMs: 8000, segments: [] }).spans).toBeNull();
	});

	it('says null when the pull has segments but none of the asked-for mode', () => {
		const allSingle = {
			floorMs: 8000,
			segments: [timeline!.segments[0]],
		} as unknown as Parameters<typeof resolveBands>[2];
		expect(resolveBands(targets, 'aoe', allSingle).spans).toBeNull();
	});

	it('covers the whole pull on the default reading, whatever the segments say', () => {
		expect(resolveBands(targets, 'auto', timeline).spans).toBeNull();
	});
});
