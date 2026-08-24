import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import i18n, { initI18n } from '~/lib/i18n/config';
import type { Analysis, FightDataset } from '~/lib/types';
import { analyse as analyseElemental } from '~/specs/elemental';

import { bandForMode, bandsInPull, resolveBands, TARGET_MODE_CHOICES, resolveTargetMode } from '../targetMode';

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
describe('target mode copy', () => {
	it('names every choice', () => {
		for (const choice of TARGET_MODE_CHOICES) {
			expect(t(`targets.${choice}`)).not.toBe(`targets.${choice}`);
		}
	});

	it('says what was detected, in both modes, and what an override contradicts', () => {
		for (const mode of ['single', 'multi'] as const) {
			expect(t('targets.detected', { context: mode, share: 40 })).toContain('40');
			expect(t('targets.overridden', { context: mode })).not.toBe('targets.overridden');
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
		expect(resolveBands(windwalker('cleave').targets, 'multi')).toEqual({
			bands: [3],
			mode: 'multi',
			forced: true,
			spans: null,
		});
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

	it('reads everything that was not single-target as the other half, and merges what abuts', () => {
		// Cleave, aoe and mixed together — a mixed stretch is by construction one no single mode
		// described, which makes it part of this reading and not part of the single-target one. The two
		// that touch at 90 000 come back as one span rather than two.
		expect(resolveBands(targets, 'multi', timeline).spans).toEqual([
			[30_000, 50_000],
			[70_000, 99_000],
		]);
	});

	it('leaves idle out of both readings, because nothing was there to be hit', () => {
		const single = resolveBands(targets, 'single', timeline).spans ?? [];
		const multi = resolveBands(targets, 'multi', timeline).spans ?? [];
		const covered = [...single, ...multi].some(([from, to]) => from < 70_000 && to > 50_000);
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
		expect(resolveBands(targets, 'multi', allSingle).spans).toBeNull();
	});

	it('covers the whole pull on the default reading, whatever the segments say', () => {
		expect(resolveBands(targets, 'auto', timeline).spans).toBeNull();
	});
});
