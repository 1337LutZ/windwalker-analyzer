// The multi-target *layout* case, and the only fixture that can reach it.
//
// `docs/conventions.md`'s Layout section says every section is to be checked at ~390px, and says how:
// a 390px iframe, `scrollWidth` against `clientWidth`, because a headless screenshot lies about a
// narrow viewport. `/preview` is the only route that renders a report without a WarcraftLogs token, so
// a pull that is not in that page's map cannot be measured at all — which is what
// `lib/game/__tests__/sharedFixtures.test.ts` already says about the haste band's overlap pull.
//
// This file says it about the target count, which is a separate claim and was separately unreachable.
// Both Elemental entries the page carried were single-target pulls, and not marginally: `counts.max` 1,
// `multiTargetMs` 0, one band in the pull. So three things on the report had never been rendered at any
// width by anyone without a token — the cast timeline's per-target lanes, `TargetModeControl` with more
// than one band to lay out, and every section that reads differently at three or more enemies.
//
// What this pins is therefore not a number in the report; it is the *reason* the third entry is on the
// page. A reader who finds three Elemental entries where the page's own comment argues that each costs
// ~375KB of serialised props will reasonably wonder whether one is spare. The answer is here: remove
// `cleave` and the multi-target reading leaves the token-free route with it.
//
// **Not a numeric guard.** Nothing here asserts a figure the report shows. The two `analyse()` calls
// exist to establish which reading each pull detects, and the detection is the whole subject.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { FightDataset } from '~/lib/types';
import { bandsInPull, resolveTargetMode } from '~/lib/view/targetMode';
import { analyse } from '~/specs/elemental/lib';

const raw = (name: string): FightDataset =>
	JSON.parse(
		readFileSync(resolve(import.meta.dirname, `../../../specs/elemental/__fixtures__/${name}.json`), 'utf8'),
	) as FightDataset;

const targetsOf = (name: string) => analyse(raw(name)).targets;

/** The page's map, read as text: it is a local in Astro frontmatter, so there is nothing to import. */
const previewFixtureNames = (): string[] => {
	const page = readFileSync(resolve(import.meta.dirname, '../../../pages/preview.astro'), 'utf8');
	const map = /const fixtures = \{([^}]*)\}/.exec(page);
	expect(map, 'preview.astro no longer declares a `fixtures` object literal').not.toBeNull();
	return map![1]!.split(',').map((n) => n.trim());
};

describe('the multi-target reading is reachable without a token', () => {
	/**
	 * The two entries that were already on the page, and why neither can stand in for the third.
	 *
	 * `detected` rather than `counts.max` alone, because the detection is what the report branches on:
	 * a pull with a single two-target moment would still render every single-target branch.
	 */
	it('neither single-target Elemental pull can render the multi-target branch', () => {
		for (const name of ['phased', 'unbroken']) {
			const targets = targetsOf(name);
			expect(targets?.counts.max, `${name}: counts.max`).toBe(1);
			expect(targets?.multiTargetMs, `${name}: multiTargetMs`).toBe(0);
			expect(bandsInPull(targets), `${name}: bands`).toEqual([1]);
			expect(resolveTargetMode(targets, 'auto').detected.detected, `${name}: detected`).toBe('single');
		}
	});

	/** And `cleave` does, by a wide margin rather than at the threshold. */
	it('cleave detects multi, with four bands and thirteen targets at its peak', () => {
		const targets = targetsOf('cleave');
		expect(targets?.counts.max).toBe(13);
		expect(targets?.multiTargetMs).toBe(148_865);
		// 57.3% of the pull against a 33% threshold — not a pull that could flip on a tuning change.
		expect(targets?.multiTargetPct).toBeGreaterThan(50);
		expect(bandsInPull(targets)).toEqual([1, 2, 3, 4]);
		expect(resolveTargetMode(targets, 'auto').detected.detected).toBe('multi');
	});

	/**
	 * The half no measurement can assert about itself: that a person can get to it.
	 *
	 * This is the case that fails without the `preview.astro` entry, and it is the whole point of the
	 * file — the two above it hold on `main` unchanged.
	 */
	it('and that pull is on the only token-free route', () => {
		expect(previewFixtureNames()).toContain('cleave');
	});

	/**
	 * Deliberate no-change guard: the entries the page already had must not be traded away for the new
	 * one. Each is on the page for a reason of its own, stated there — `phased` for the exempt-track
	 * submerge and the haste band, `unbroken` for the band's overlap composite.
	 */
	it('without displacing the two pulls that were already there', () => {
		const names = previewFixtureNames();
		expect(names).toContain('phased');
		expect(names).toContain('unbroken');
	});
});
