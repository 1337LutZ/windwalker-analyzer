import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { SPECS } from '~/lib/spec';
import { ELEMENTAL_SPEC } from '~/specs/elemental';
import { WW_SPEC } from '~/specs/windwalker';
import { scoreAnalysis } from '~/specs/windwalker/lib/score';
import type { Analysis } from '~/lib/types';

import i18n, { initI18n } from '../config';

initI18n();

function fixture(name: string): Analysis {
	return JSON.parse(
		readFileSync(resolve(import.meta.dirname, `../../../specs/windwalker/__fixtures__/${name}.json`), 'utf8'),
	);
}

const t = i18n.getFixedT('en', 'report');

/** The same call the sections make, so a broken key fails here rather than rendering raw on screen. */
function verdict(analysis: Analysis, section: string, values: Record<string, unknown> = {}) {
	const score = scoreAnalysis(analysis).sections[section];
	const context = score === undefined || score.unmeasurable ? 'none' : score.grade;
	return t(`${section}.verdict`, { context, ...values });
}

describe('report copy', () => {
	it('picks a different sentence for a strong pull than a poor one', () => {
		const strong = fixture('strong');
		const poor = fixture('poor');

		const a = verdict(strong, 'snapshots', { caught: 12, total: 16, rate: 75 });
		const b = verdict(poor, 'snapshots', { caught: 2, total: 9, rate: 22.2 });

		expect(a).not.toBe(b);
		expect(a).toContain('12 of 16');
		expect(b).toContain('2 of 9');
	});

	/** A key that does not resolve comes back as the key itself, which is the bug to catch. */
	it('resolves every section verdict in every grade', () => {
		const sections = ['snapshots', 'brew', 'casts', 'debuff', 'tigerPalm', 'karma'];
		for (const section of sections) {
			for (const context of ['good', 'ok', 'bad', 'none']) {
				const text = t(`${section}.verdict`, { context, count: 2, casts: 2 });
				expect(text, `${section}.verdict_${context}`).not.toContain('verdict');
				expect(text.length, `${section}.verdict_${context}`).toBeGreaterThan(10);
			}
		}
	});

	it('resolves every section intent', () => {
		for (const section of ['snapshots', 'brew', 'casts', 'debuff', 'tigerPalm', 'karma', 'damage', 'misses']) {
			const text = t(`${section}.intent`);
			expect(text, `${section}.intent`).not.toBe(`${section}.intent`);
		}
	});

	/** The bug that started this: a raw float rendered mid-sentence next to a formatted tile. */
	it('formats interpolated numbers through the shared helpers', () => {
		expect(t('brew.verdict', { context: 'good', count: 7, avg: 9.714285714285714 })).toContain('9.7');
		expect(t('brew.verdict', { context: 'good', count: 7, avg: 9.714285714285714 })).not.toContain('9.714');
		// One decimal, matching formatPercentValue — the same string the KPI tile prints.
		expect(t('casts.verdict', { context: 'good', used: 83.6, cpm: 31.59 })).toContain('83.6%');
		expect(t('casts.verdict', { context: 'good', used: 83.6, cpm: 31.59 })).toContain('31.6');
	});

	/**
	 * The Casts-per-minute prose, after both of its spans changed meaning under it.
	 *
	 * Three of these four sentences render side by side and each names a *different* stretch of the same
	 * pull, which is why the wording carries the weight here rather than the numbers:
	 *
	 *   - `activeTime` prints WarcraftLogs' own figure off the damage table — **92.62%** of `phased`. It
	 *     said "You were active for …", which is not what it measures: on `cleave` it equals the span from
	 *     the player's first damage to their last to the millisecond and swallows a 3 283ms gap, while on
	 *     `phased` it is 239 246ms against a 257 126ms span, 17 880ms *short* of it, with that pull's two
	 *     largest interior gaps at 13 131 and 8 318ms. So it forgives short pauses and drops long ones,
	 *     and it is nobody's measure of time on task. Plan §44 carries the correction and supersedes
	 *     `f6b8903`s commit message, which repeats an earlier overstatement that it is a pure
	 *     first-to-last span; the same message's claim that it counts dot ticks and pet damage is also
	 *     unconfirmed, because on all four fixtures the first and last damage events are the player's own
	 *     non-tick hits and the endpoints cannot discriminate. The copy therefore asserts neither.
	 *   - `presses` is handed the **contact** span since `f6b8903` — 79.97% of the same pull — so the
	 *     sentence had two spans called "active" printing two different numbers a paragraph apart.
	 *   - `verdict_*` end on a rate that is now per minute of contact, so "casts per minute" alone left a
	 *     reader who divides presses by pull length with a different number and no way to tell which was
	 *     wrong.
	 *
	 * The interpolation is still named `active` in all of these. Renaming it is a change to
	 * `windwalker/components/sections/CastsPerMinute.tsx`, which this lane does not own; the placeholder
	 * name is invisible to a reader and the sentence is not.
	 */
	it('says which span each Casts-per-minute figure is measured over', () => {
		const active = t('casts.activeTime', { active: 92.62 });
		expect(active).toContain('WarcraftLogs counts 92.62% of the pull as active time for you');
		// The claim that was wrong, gone — and the two it must not have picked up in exchange.
		expect(active).not.toContain('You were active for');
		expect(active).not.toContain('first');
		expect(active).not.toContain('tick');

		// The contact span, named as itself rather than as a second "active".
		const presses = t('casts.presses', { onGcd: 180, offGcd: 12, active: 207_000, total: 258_304 });
		expect(presses).toContain('you spent on a target in a');
		expect(presses).not.toContain('active');
		// Both clocks still printed: the gap between them is the signal, so neither may be dropped.
		expect(presses).toContain('3:27');
		expect(presses).toContain('4:18');

		// And the rate ties to the span the sentence under it names.
		for (const context of ['good', 'ok', 'bad']) {
			const text = t('casts.verdict', { context, used: 83.6, cpm: 31.59 });
			expect(text, context).toContain('31.6 casts per minute of the time you spent on a target');
		}
		expect(t('casts.intent')).toContain('the time you spent on a target');
	});

	/**
	 * The potion copy, whose whole job is to name the slot that went unfilled.
	 *
	 * The two variants have to resolve and have to be different sentences: the metric's value is `1 of
	 * 2` either way, and pointing a player who missed the in-combat potion at the pre-pull one is worse
	 * advice than none at all. `note_early` is the caption for that same slot filled from inside the
	 * fight, and the one thing it must not say is the base sentence's "no press above it" — that bar
	 * has a press above it.
	 */
	it('names each potion slot with its own sentence', () => {
		const both = { value: 1, target: 2 };
		const prepull = t('summary.takeaways.metric.potionsUsed.fix', { context: 'prepull', ...both });
		const combat = t('summary.takeaways.metric.potionsUsed.fix', { context: 'combat', ...both });
		expect(prepull).not.toBe(combat);
		expect(prepull).toContain('pre-pull one');
		expect(combat).toContain('in-combat one');

		const early = t('castLog.prePull.note', { context: 'early', aura: "Virmen's Bite", drunk: '92ms' });
		expect(early).toContain('92ms');
		expect(early).not.toContain('no press above it');
		expect(early).not.toBe(t('castLog.prePull.note', { aura: "Virmen's Bite" }));
	});

	it('agrees in number', () => {
		expect(t('snapshots.lastGcd', { count: 1 })).toContain('its proc');
		expect(t('snapshots.lastGcd', { count: 6 })).toContain('their procs');
		expect(t('misses.summary', { count: 1 })).toContain('thing');
		expect(t('misses.summary', { count: 30 })).toContain('things');
	});
});

/**
 * The settings panel, whose hints are shell copy and were leaking one spec's buttons into the other's.
 *
 * `settings.cooldown` was pointed at by both specs' schemas and its hint ended with "— Rising Sun Kick,
 * Chi Wave, Xuen and the potion", so an Elemental reader was handed four Monk abilities as the examples
 * of what their own leeway applies to. Each spec now has its own key — `settings.ww.cooldown` and
 * `settings.ele.cooldown` — and the shared sentence stops at the claim that is true for
 * both, and the examples live on each spec's own namespaced key.
 *
 * The foreign-name set is derived from `gameData`, not from a list written here: "which abilities are
 * this spec's" is a fact about the game model, and a test that restated it would only be checking its
 * own restatement.
 */
describe('settings copy', () => {
	const tUi = i18n.getFixedT('en', 'ui');
	const namesOf = (spec: (typeof SPECS)[number]) => new Set(spec.gameData.abilities.map((a) => a.name));

	it('names no ability that belongs to another spec', () => {
		const leaks: string[] = [];
		for (const spec of SPECS) {
			const own = namesOf(spec);
			const foreign = SPECS.filter((other) => other.key !== spec.key)
				.flatMap((other) => [...namesOf(other)])
				.filter((name) => !own.has(name));
			expect(foreign.length, `${spec.key}: nothing to leak — is a second spec registered?`).toBeGreaterThan(0);

			for (const setting of spec.settings) {
				// The same call `SettingsDialog` makes, interpolation included, so a name that reached the
				// reader through a placeholder would be caught too.
				const hint = tUi(`${setting.tKey}.hint`, {
					min: setting.min,
					max: setting.max,
					default: setting.default,
				});
				for (const name of foreign) {
					if (hint.includes(name)) leaks.push(`${spec.key} → ${setting.tKey}.hint names ${name}`);
				}
			}
		}
		expect(leaks, `settings copy naming another spec's buttons:\n${leaks.join('\n')}`).toEqual([]);
	});

	/**
	 * And the leak was not closed by deleting the information: the Windwalker's own cooldown hint still
	 * lists the buttons the leeway applies to, on the key only its own schema points at.
	 */
	it('keeps the Windwalker’s own examples on the Windwalker’s own key', () => {
		const hint = tUi('settings.ww.cooldown.hint', { min: 1000, max: 2000, default: 1500 });
		expect(hint).toContain('Rising Sun Kick');
		expect(hint).toContain('Chi Wave');
	});
});

/**
 * The haste-band legend describes a different mechanic per spec, so it must not hand one spec another's.
 *
 * Haste shortens every spec's globals — that part is shared. What it does *besides* that is not: a
 * Windwalker's energy comes back faster, and a caster's mana does not work that way at all, while their
 * casts shorten and their dots tick quicker. The legend used to state the energy clause to everyone.
 *
 * Asserted against the strings rather than through a rendered chart because that is where the claim lives,
 * and because the rendered version is already pinned on the Windwalker side by
 * `specs/windwalker/components/charts/__tests__/castTimeline.test.ts`.
 */
describe('the haste band legend', () => {
	/**
	 * A spec's own resources, read off its config rather than listed here, so a spec that gains one does not
	 * need this test edited. `resources` is on the spec *config* and not on `SpecDefinition`, which is why
	 * these are imported directly — the same reason this file already imports a spec's scorer.
	 */
	const OWN: Record<string, string[]> = {
		windwalker: Object.keys(WW_SPEC.resources),
		elemental: Object.keys(ELEMENTAL_SPEC.resources),
	};
	const ALL = [...new Set(Object.values(OWN).flat())];

	for (const spec of SPECS) {
		it(`does not tell a ${spec.key} reader about another spec's resource`, () => {
			const own = OWN[spec.key] ?? [];
			expect(own.length, `no resources known for ${spec.key}; the map above needs it`).toBeGreaterThan(0);
			for (const count of [1, 2]) {
				const note = t('castLog.lust.note', { count, context: spec.key, names: 'Bloodlust' });
				expect(note, `${spec.key} legend resolved to a raw key`).not.toContain('castLog.lust');
				for (const other of ALL.filter((r) => !own.includes(r))) {
					expect(note.toLowerCase(), `${spec.key} legend names ${other}`).not.toContain(other);
				}
			}
		});
	}

	it('still tells a Windwalker about their energy, rather than closing the leak by deleting the claim', () => {
		expect(t('castLog.lust.note', { count: 1, context: 'windwalker', names: 'Heroism' })).toContain(
			'energy comes back faster',
		);
	});
});
