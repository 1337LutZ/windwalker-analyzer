// Every spec's raid-buff declaration, held against the shared roster and against the locale.
//
// The raid-buff section reports **gaps**, which makes it the section whose mistakes read as
// accusations. Three of them are invisible to anything that merely renders it:
//
//   - a `key` the shared table does not group measures nothing and drops out of the report silently;
//   - an `iconId` that is not a provider of its own effect draws the wrong spell beside a row;
//   - a missing copy key renders `raidBuffs.worth.spellPower` at a reader — and since the spec-specific
//     sentences are stored only as `_windwalker` / `_elemental` contexts, with no neutral base for
//     several of them, a spec added without its own paragraph gets the raw key rather than another
//     spec's claims. That is the deliberate trade `app.intro` makes, and this is what makes it safe.
//
// Every spec in the registry is checked, so a third one is covered by the fact of being registered.

import { describe, expect, it } from 'vitest';

import { RAID_BUFF_EFFECT_KEYS, RAID_BUFF_PROVIDER_IDS } from '~/lib/analysis/raidBuffs';
import i18n, { initI18n } from '~/lib/i18n/config';

import { SPECS } from '../registry';

initI18n();

/** Whether the locale holds a real string for a key under one spec's context, not the key itself. */
function resolves(key: string, specKey: string): boolean {
	const value = i18n.t(key, { ns: 'report', context: specKey });
	return typeof value === 'string' && value !== key && value !== '';
}

describe('each spec declares its own raid-buff effects', () => {
	it('finds the specs to check, so a rename cannot quietly empty this suite', () => {
		expect(SPECS.map((spec) => spec.key)).toContain('windwalker');
		expect(SPECS.map((spec) => spec.key)).toContain('elemental');
	});

	for (const spec of SPECS) {
		describe(spec.key, () => {
			const effects = spec.raidBuffEffects;

			it('declares at least one effect and no key twice', () => {
				expect(effects.length).toBeGreaterThan(0);
				expect(new Set(effects.map((e) => e.key)).size).toBe(effects.length);
			});

			it('names only effects the shared roster groups', () => {
				const unknown = effects.map((e) => e.key).filter((key) => !RAID_BUFF_EFFECT_KEYS.includes(key));
				expect(unknown, `keys with no group in lib/analysis/raidBuffs: ${unknown.join(', ')}`).toEqual([]);
			});

			it('stands each effect behind one of its own providers', () => {
				const wrong = effects
					.filter((e) => !(RAID_BUFF_PROVIDER_IDS.get(e.key) ?? []).includes(e.iconId))
					.map((e) => `${e.key} → ${e.iconId}`);
				expect(wrong, `icons that supply a different effect: ${wrong.join(', ')}`).toEqual([]);
			});

			it('has a name and a worth sentence for every effect it draws', () => {
				const missing = effects.flatMap((e) =>
					[`raidBuffs.effects.${e.key}`, `raidBuffs.worth.${e.key}`].filter((key) => !resolves(key, spec.key)),
				);
				expect(missing, `copy nothing was written for:\n${missing.join('\n')}`).toEqual([]);
			});

			/**
			 * The four paragraphs that name a spec out loud, and the reason this file exists at all: the
			 * Elemental report shipped saying "Windwalker" three times, in copy a reader sees.
			 */
			it('has its own wording for the four paragraphs that name a spec', () => {
				const missing = ['raidBuffs.intent', 'raidBuffs.caption', 'raidBuffs.excluded', 'raidBuffs.debuffs'].filter(
					(key) => !resolves(key, spec.key),
				);
				expect(missing, `paragraphs with no wording for this spec:\n${missing.join('\n')}`).toEqual([]);
			});

			it('names no other spec in the copy it draws', () => {
				const others = SPECS.filter((s) => s.key !== spec.key);
				const keys = [
					'raidBuffs.intent',
					'raidBuffs.caption',
					'raidBuffs.excluded',
					'raidBuffs.debuffs',
					...effects.flatMap((e) => [`raidBuffs.effects.${e.key}`, `raidBuffs.worth.${e.key}`]),
				];
				const offences = keys.flatMap((key) => {
					const text = i18n.t(key, { ns: 'report', context: spec.key });
					return others
						.filter((other) => text.includes(other.specName) || text.includes(other.displayName))
						.map((other) => `${key} says "${other.specName}"`);
				});
				expect(offences, `copy naming another spec:\n${offences.join('\n')}`).toEqual([]);
			});
		});
	}
});
