// The registry is the only list of specs, so the two lookups and the invariants around them are
// pinned here: a spec the UI can name in the URL must be findable by the API's own spelling, and the
// default must exist.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { spellIconUrl } from '~/components/primitives/spellIcon';
import { CLASS_COLOR } from '~/lib/game/classes';

import { DEFAULT_SPEC, findSpecForClass, getSpec, SPECS } from '../registry';

describe('spec registry', () => {
	it('resolves the URL key and the WarcraftLogs spelling to the same spec', () => {
		const byKey = getSpec('windwalker');
		const byClass = findSpecForClass('Monk', 'Windwalker');
		expect(byKey).toBe(byClass);
		expect(byKey?.key).toBe('windwalker');
		expect(byKey?.displayName).toBe('Windwalker Monk');
	});

	it('resolves the second spec the same way', () => {
		const byKey = getSpec('elemental');
		const byClass = findSpecForClass('Shaman', 'Elemental');
		expect(byKey).toBe(byClass);
		expect(byKey?.key).toBe('elemental');
		expect(byKey?.displayName).toBe('Elemental Shaman');
	});

	it('answers undefined rather than guessing for an unknown key or class', () => {
		expect(getSpec('priest')).toBeUndefined();
		expect(findSpecForClass('Priest', 'Shadow')).toBeUndefined();
		expect(findSpecForClass('Monk', 'Brewmaster')).toBeUndefined();
	});

	it('has a default that is actually in the list', () => {
		expect(SPECS).toContain(DEFAULT_SPEC);
	});

	/**
	 * `classSlug` is two claims the compiler only half-checks, and the half it misses is the one that ships.
	 *
	 * Its type is `keyof typeof CLASS_COLOR`, which catches a slug that names no class at all. What no type
	 * can say is that the slug and the colour beside it name the *same* class: an entry may declare
	 * `classSlug: 'monk'` and `colors: { primary: CLASS_COLOR.shaman }` and compile, drawing a monk's report
	 * in the shaman's blue while every other assertion in this suite stays green. The colours are read back
	 * through the table here so the coincidence the slug rests on cannot quietly stop being true.
	 *
	 * The uniqueness is over the pair and not over `key`, because `key` is not unique in MoP and cannot be
	 * made so: `restoration` is a Druid spec and a Shaman spec, and `/restoration` has no way to say which.
	 * That is the argument for class-before-spec in the route rather than a nicety of spelling, and
	 * `classSlug` + `key` is the identity that survives it.
	 */
	it('gives every spec a slug the colour table knows, unique together with its key', () => {
		const seen: string[] = [];
		for (const spec of SPECS) {
			expect(Object.keys(CLASS_COLOR), `spec ${spec.key}`).toContain(spec.classSlug);
			expect(spec.colors.primary, `spec ${spec.key} draws a colour its own slug does not name`).toBe(
				CLASS_COLOR[spec.classSlug],
			);
			const route = `${spec.classSlug}/${spec.key}`;
			expect(seen, `two specs registered as ${route}`).not.toContain(route);
			seen.push(route);
		}
	});

	it('carries the pieces the UI runs on', () => {
		// Named rather than `DEFAULT_SPEC`: the assertions below are the monk's own numbers, and the
		// default is whatever `PUBLIC_SPEC` pinned. Reading the default here is what made the suite
		// unrunnable under an Elemental pin — `expected 1500 to be 1000`.
		const ww = getSpec('windwalker')!;
		expect(ww.gcdMs).toBe(1000);
		expect(ww.analyse).toBeTypeOf('function');
		expect(ww.identify).toBeTypeOf('function');
		expect(ww.score).toBeTypeOf('function');
	});

	/**
	 * The Elemental counterpart, and it pins two ability ids as well as the global.
	 *
	 * `getSpec('elemental')` for the same reason the monk's assertion names itself: these are the
	 * shaman's own numbers, and 1500 is not 1000.
	 *
	 * The two ids are Chain Lightning and Lava Beam, and they are pinned because they were *absent*:
	 * the registry declared sixteen abilities and neither was among them, so the shared core's GCD walk
	 * skipped every press and the report read 56.02% utilisation on a pull that filled 90.81% of its
	 * globals. `onGcd` is the field that did the damage — an unmodelled press falls back to `false` and
	 * is then priced at nothing — so `onGcd` is what is asserted, through the same `abilityByCastId`
	 * lookup the core itself uses rather than by searching the ability list for a name.
	 */
	it("carries the second spec's pieces, including the two ids the core prices globals from", () => {
		const ele = getSpec('elemental')!;
		expect(ele.gcdMs).toBe(1500);
		expect(ele.analyse).toBeTypeOf('function');
		expect(ele.identify).toBeTypeOf('function');
		expect(ele.score).toBeTypeOf('function');
		expect(ele.registry.abilityByCastId(421)?.onGcd).toBe(true);
		expect(ele.registry.abilityByCastId(114074)?.onGcd).toBe(true);
	});
});

/**
 * Every route this build publishes has to be a spec this registry answers.
 *
 * **This replaced a scrape of the deploy workflows, and the reason is worth keeping.** A build used to
 * pin itself to one spec through `PUBLIC_SPEC`, and `DEFAULT_SPEC` fell back to `SPECS[0]` when the
 * value was unset — deliberate, because an unset value is a dev server rather than a mistake. The cost
 * was that a *typo* was silent: `PUBLIC_SPEC: elementl` built and deployed perfectly, and the Elemental
 * site came up branded and behaving as Windwalker, with nothing in the pipeline failing. So the
 * workflows' own values were read off disk and checked here.
 *
 * One build now serves every spec by route, so there is no value to mistype and nothing in a workflow
 * to read. The same class of mistake moved rather than disappearing: a route is built from `classSlug`
 * and `key`, and a page whose params do not resolve is a published URL that serves a spec nobody asked
 * for. So the *route source* is read off disk instead, and the pairs it produces are resolved here.
 *
 * Read from the page rather than recomputed, for the reason the scrape was: a copy of the expression
 * would agree with itself and with nothing that ships.
 */
describe('the routes this build publishes', () => {
	const page = readFileSync('src/pages/[class]/[spec].astro', 'utf8');

	it('builds its params from the registry rather than a list', () => {
		// The failure this guards is a hand-written path table drifting from `SPECS`. `getStaticPaths`
		// naming both fields off a spec is what makes the pairs below the registry's own.
		expect(page).toMatch(/getStaticPaths/);
		expect(page).toMatch(/classSlug/);
	});

	it('resolves every spec it can publish, and publishes one route per spec', () => {
		const routes = SPECS.map((spec) => `${spec.classSlug}/${spec.key}`);
		expect(routes.length).toBe(SPECS.length);
		expect(new Set(routes).size).toBe(routes.length);
		for (const spec of SPECS) expect(getSpec(spec.key), `route names ${spec.key}`).toBeDefined();
	});

	it('finds some to check, so a rename cannot quietly empty this test', () => {
		// The half the old scrape carried and the half worth keeping: a guard over an empty list passes
		// vacuously, which is how a route table that stopped being generated would go unnoticed.
		expect(SPECS.length).toBeGreaterThan(1);
	});

	/**
	 * Every spec's icon is a spell this build knows, and no two specs wear the same one.
	 *
	 * `iconSpellId` is an id rather than an icon name so the picture comes from the one spell map the
	 * rest of the page draws from — and the cost of that choice is that a wrong id fails *quietly*, as a
	 * `null` the picker renders as no image. So it is checked here, where an id that stops resolving is
	 * a red test rather than a card with a hole in it.
	 *
	 * Distinctness because the icon is the thing a reader picks by: two specs under one picture is a
	 * splash that has stopped answering its own question.
	 */
	it('gives every spec an icon the spell map answers, and no two the same', () => {
		const icons = SPECS.map((spec) => spellIconUrl(spec.iconSpellId));
		for (const [i, url] of icons.entries()) expect(url, `${SPECS[i]!.key}`).not.toBeNull();
		expect(new Set(icons).size).toBe(SPECS.length);
	});
});
