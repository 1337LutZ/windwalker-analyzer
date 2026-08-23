// The one home for "which items grant which effect", and the guards that keep it the only one.
//
// `SHARED_AURAS` says what an effect logs as. It cannot say who owned it: an effect is identified by an
// aura id, ownership is a question about an **item** id, and until `SHARED_ITEM_SOURCES` there was no
// non-test place in this repository for the second fact. So the two readers that need it each wrote the
// ids out — `elemental/lib/apl.ts` for Breath of the Hydra, `windwalker/lib/view/rotationFlow.ts` for
// Rune of Re-Origination — and `sharedFixtures.test.ts`' gear census wrote both out a second time. Four
// hand-maintained lists of the same two facts, none able to see the others.
//
// **The failure that made it worth fixing is silent.** A narrowed or mistyped variant list throws
// nothing: the Elemental ladder simply stops demanding Flame Shock and the pull reads as compliant, and
// the Windwalker reference simply stops warning that the Rune is missing. Neither reader has anything to
// notice. So the guards here are the noticing.

import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createRegistry } from '~/lib/game/registry';
import { SHARED_ABILITIES, SHARED_AURAS, SHARED_ITEM_SOURCES, type ItemSourcedAura } from '~/lib/game/shared';
import { runeOfReOriginationEquipped } from '~/specs/windwalker/lib/view/rotationFlow';

const registry = createRegistry({ abilities: SHARED_ABILITIES, auras: SHARED_AURAS });

/**
 * The same two rows, transcribed a second time and by hand — the pin, and the only side of this file
 * that is not derived from the constant under test.
 *
 * A test that read the ids out of `SHARED_ITEM_SOURCES` and compared them to themselves would go green
 * on any narrowing at all, which is the exact failure the constant exists to stop. So these five-id
 * lists are written here from the same source the declaration cites — the simulator's
 * `assets/database/db.json`, `items[].itemEffects[].buffId` 138898 for the trinket, and the Rune's five
 * item versions, which `db.json` cannot source and which are named by hand in both places. Dropping a
 * variant from the declaration now takes a second, deliberate edit in this file, and it is the edit a
 * reviewer would ask about.
 */
const TRANSCRIBED: Record<ItemSourcedAura, readonly number[]> = {
	'breath-of-hydra': [94_521, 95_711, 96_083, 96_455, 96_827],
	're-origination': [94_532, 95_802, 96_174, 96_546, 96_918],
};

const ascending = (ids: readonly number[]): number[] => [...ids].sort((a, b) => a - b);

describe('the declaration itself', () => {
	it('carries exactly the rows this file transcribed, id for id', () => {
		expect(Object.keys(SHARED_ITEM_SOURCES)).toEqual(Object.keys(TRANSCRIBED));
		for (const [key, ids] of Object.entries(SHARED_ITEM_SOURCES)) {
			expect(ascending(ids), key).toEqual(ascending(TRANSCRIBED[key as ItemSourcedAura]));
		}
	});

	it('names an aura that is actually declared, so the join resolves', () => {
		// The key is the join. A row keyed on a string no `SHARED_AURAS` entry uses would be an item list
		// pointing at nothing, and `registry.aura` is what says so.
		for (const key of Object.keys(SHARED_ITEM_SOURCES)) {
			expect(registry.aura(key).key, key).toBe(key);
		}
	});
});

describe('the readers agree with it', () => {
	// The Elemental ladder's half of this lives in `spec/__tests__/aoeFlameShockGear.test.ts`, where the
	// rung can be walked with a kit; this is the Windwalker one, which needs nothing but a slot list.
	it('reads the Rune as owned on every variant the list declares, and on nothing else', () => {
		for (const id of SHARED_ITEM_SOURCES['re-origination']) {
			expect(runeOfReOriginationEquipped([{ id }]), `item ${String(id)}`).toBe(true);
		}
		// One number away from the id the committed monk wears: not a variant, and not the Rune.
		expect(runeOfReOriginationEquipped([{ id: 96_545 }])).toBe(false);
	});
});

/**
 * *** And the guard that stops a fifth copy being written. ***
 *
 * Every check above would stay green if a reader stopped importing the constant and wrote the ids out
 * again — which is how the four copies happened in the first place, each one reasonable on its own. The
 * only thing that catches that is looking: outside a test, these ids may appear in `game/shared.ts` and
 * nowhere else.
 *
 * Comments are stripped before the scan, because prose is allowed to name a number — `elemental/lib/
 * apl.ts` explains that its fixture wears 96455 and three upgrade steps above 94521, and that sentence
 * is the reason the list has five entries rather than a reason to fail. Tests are out of scope
 * deliberately: `elemental/lib/__tests__/aoeDotUnscored.test.ts` keeps its own copy on purpose, so that
 * the rung is not asked whether it agrees with itself, and the transcription at the top of this file is
 * the same kind of independent witness.
 */
describe('and nothing outside `shared.ts` writes these ids', () => {
	const SRC = resolve(import.meta.dirname, '../../..');

	const sources = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
		.filter((f) => /\.tsx?$/.test(f) && !f.includes('__tests__') && !/\.test\.tsx?$/.test(f))
		.map((f) => resolve(SRC, f));

	/** Source with block and line comments removed; `https://` is not a comment. */
	const code = (file: string): string =>
		readFileSync(file, 'utf8')
			.replaceAll(/\/\*[\s\S]*?\*\//g, ' ')
			.replaceAll(/(^|[^:])\/\/.*$/gm, '$1');

	/** `94521` and `94_521` are one literal to the compiler, so a scan has to accept both spellings. */
	const grouped = (id: number): string => String(id).replace(/\B(?=(\d{3})+$)/g, '_');

	it('finds each variant in the declaration and in no other module', () => {
		expect(sources.length).toBeGreaterThan(100);
		expect(sources).toContain(resolve(SRC, 'lib/game/shared.ts'));

		for (const [key, ids] of Object.entries(SHARED_ITEM_SOURCES)) {
			for (const id of ids) {
				const literal = new RegExp(String.raw`(?<!\w)(?:${String(id)}|${grouped(id)})(?!\w)`);
				const writers = sources.filter((file) => literal.test(code(file))).map((file) => relative(SRC, file));
				expect(writers, `${key} ${String(id)}`).toEqual(['lib/game/shared.ts']);
			}
		}
	});
});
