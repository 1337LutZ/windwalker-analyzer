// No spec's report may speak another spec's vocabulary, swept over a rendered report per spec.
//
// **This file exists because the check it replaces could not fail.** The standing test for spec-leaked
// copy was a manual one: build with `PUBLIC_SPEC=elemental`, then grep `dist/` for the other spec's
// terms. It has been quoted in briefs and run repeatedly, and it is vacuous in both directions.
//
//   - **It renders no Elemental report to grep.** `/preview` is the only prerendered route that draws a
//     report at all, and the report it draws is whichever fixture `PreviewSwitcher` opens on —
//     `useState(names[0])`, the first key of the page's map, which is a *Windwalker* pull. The picker is
//     what makes the other six reachable and a picker needs a browser. So `dist/` has never contained a
//     rendered Elemental report under any value of `PUBLIC_SPEC`, and a grep for Elemental copy in it
//     passes on copy that was never rendered. Measured on a `PUBLIC_SPEC=elemental` build with the two
//     defects below reverted back in: the Elemental Snapshots intent appears **0 times** in every
//     `dist/**/*.html`, while both Windwalker method notes appear **once** — the leak was live in the
//     build and the Elemental page it was supposed to be found on did not exist.
//   - **And what it does hit is not a render.** `lib/i18n/config.ts` imports the whole of
//     `locales/en/report.json` into the bundle, because the site is prerendered and the CSP forbids
//     fetching translations — so **every spec's copy is in every build's JS and always will be**. On that
//     same build `confirmed by a Tigereye Brew cast` and the Elemental Snapshots intent sit in the *same
//     chunk*, `_astro/TargetModeControl.*.js`, one occurrence each, whichever spec built it.
//   - **And greping the HTML instead of the JS does not fix it either**, which is the trap worth naming
//     because it is the obvious correction. `client:load` serialises the whole `fixtures` map into the
//     island's props, so `dist/preview/index.html` carries every fixture's `abilities[].name` as
//     entity-encoded JSON: `&quot;name&quot;:[0,&quot;Lava Burst&quot;]` is in there at byte 1 710 476 of
//     3 334 286, and `Tigereye Brew` at 22 012. Both are data, neither is copy, and no grep can tell
//     them apart from a sentence.
//
// **So the sweep here reads rendered HTML — the text of a subtree it rendered itself — and never a
// built artefact.** Stated because the next person will re-derive the `dist/` version: it is the obvious
// idea, it looks like an end-to-end check, and by all three measurements above it is neither.
//
// A test rather than a fixed route, and the route was the other candidate: `preview.astro` could
// prerender a pull per spec so the grep had something to grep. That was declined. The page renders one
// report because it is an interactive switcher — a dev harness whose whole shape is "pick a fixture" —
// and that reason still holds; rendering seven reports into one document to satisfy a grep would inflate
// a page whose own comment already prices each entry at ~235–375KB of serialised props, and it would
// still leave the check needing a human to run a build and remember to grep. This runs in CI, needs no
// build, and covers eleven pulls where a prerender covers one.
//
// **What it is not.** It is not `specs/__tests__/readerVoice.test.ts`, which sweeps the *locale file* for
// words that name our model. Every sentence caught here is well-written English that is simply being
// read to the wrong reader, so nothing about the string itself is wrong and no file-level sweep can see
// it. Only rendering it under a spec can.
//
// `createElement` rather than JSX so this stays a `.ts` file and is picked up by the project's own
// vitest include patterns.

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { initI18n } from '~/lib/i18n/config';
import { SPECS, type SpecDefinition } from '~/lib/spec';
import type { Analysis, FightDataset } from '~/lib/types';
import type { TargetModeChoice } from '~/lib/view/targetMode';

import Report from '~/components/Report';

initI18n();

/**
 * A spec's own words, taken from its `gameData` and its pulls rather than from a list in this file.
 *
 * Off the registry deliberately: a hand-written list of Windwalker and Elemental terms is a list of the
 * leaks somebody already found, and the third spec is added to the registry by someone who will never
 * read this file. `gameData` is the spec's model of its own buttons and buffs, so a spec that ships an
 * ability ships the word for it here on the same commit.
 *
 * Resources come off the analyses rather than `gameData`, which does not carry them — `resources` on the
 * engine config is not re-exported onto `SpecDefinition`, and every pull's `Analysis` carries the keys
 * the engine actually filled in. This is the half that catches `method.energy`: "Energy" is a pool and
 * not an ability, so the names above would miss the sentence entirely.
 */
interface Vocabulary {
	/** Ability and aura names — proper nouns, matched with their own capitalisation. */
	names: Set<string>;
	/** Resource keys — `energy`, `chi`, `mana`. Ordinary words, so matched at word boundaries. */
	resources: Set<string>;
}

/**
 * Every pull committed for a spec, analysed if it needs analysing.
 *
 * The whole directory rather than a named pull, so a fixture added or renamed under this test joins the
 * sweep without a line here — the Windwalker fixtures are captured `Analysis` objects and the Elemental
 * ones are raw `FightDataset`s, which is the asymmetry `preview.astro` documents at length. Told apart by
 * shape (`specName` is on the analysis and not on the dataset), not by which spec they belong to, because
 * a third spec will pick whichever suits it.
 */
const pullsOf = (spec: SpecDefinition): [string, Analysis][] => {
	const dir = resolve(import.meta.dirname, `../../../specs/${spec.key}/__fixtures__`);
	return readdirSync(dir)
		.filter((file) => file.endsWith('.json'))
		.map((file) => {
			const raw = JSON.parse(readFileSync(resolve(dir, file), 'utf8')) as Record<string, unknown>;
			const analysis = 'specName' in raw ? (raw as unknown as Analysis) : spec.analyse(raw as unknown as FightDataset);
			return [file.replace(/\.json$/, ''), analysis];
		});
};

const PULLS = new Map(SPECS.map((spec) => [spec.key, pullsOf(spec)]));

const vocabularyOf = (spec: SpecDefinition): Vocabulary => ({
	names: new Set([...spec.gameData.abilities.map((a) => a.name), ...spec.gameData.auras.map((a) => a.name)]),
	resources: new Set(PULLS.get(spec.key)!.flatMap(([, analysis]) => Object.keys(analysis.resources ?? {}))),
});

/**
 * The words that belong to one spec **and to no other**.
 *
 * The exclusion is what keeps the sweep honest without an exemption list. Bloodlust, Stormlash and every
 * other shared raid buff are in both specs' `gameData`, so they fall out on their own; a Windwalker
 * report is free to name the shaman totem buffing it. What survives is the ~30 Windwalker and ~25
 * Elemental terms that only one spec can truthfully print.
 */
const EXCLUSIVE = new Map<string, Vocabulary>(
	SPECS.map((spec) => {
		const own = vocabularyOf(spec);
		const others = SPECS.filter((other) => other !== spec).map(vocabularyOf);
		return [
			spec.key,
			{
				names: new Set([...own.names].filter((n) => !others.some((o) => o.names.has(n)))),
				resources: new Set([...own.resources].filter((r) => !others.some((o) => o.resources.has(r)))),
			},
		];
	}),
);

/**
 * What a reader is actually read, which is the text and not the markup.
 *
 * Tags are stripped rather than matched through, because an icon's `src` is
 * `.../ability_monk_tigerpalm.jpg` and a wowhead link is `spell=100787` — neither is the string "Tiger
 * Palm", and neither is copy. `alt`, `title` and `aria-label` are pulled back in before the strip: they
 * are read aloud, so a leak in one is the same defect reaching a different reader.
 */
const readableText = (html: string): string => {
	const labels = [...html.matchAll(/\s(?:alt|title|aria-label)="([^"]*)"/g)].map((m) => m[1]!).join(' ');
	const body = html.replaceAll(/<[^>]*>/g, ' ');
	return `${body} ${labels}`.replaceAll('&#x27;', "'").replaceAll('&quot;', '"').replaceAll('&amp;', '&');
};

/** Every reading a reader can put the report into, because a branch only one of them draws is still copy. */
const READINGS: TargetModeChoice[] = ['auto', 'single', 'multi'];

const render = (spec: SpecDefinition, analysis: Analysis, targetChoice: TargetModeChoice): string =>
	readableText(renderToStaticMarkup(createElement(Report, { analysis, targetChoice, spec })));

/** Which of a vocabulary's words appear in a rendered report. */
const found = (text: string, vocabulary: Vocabulary): string[] => [
	...[...vocabulary.names].filter((name) => text.includes(name)),
	...[...vocabulary.resources].filter((resource) => new RegExp(`\\b${resource}\\b`, 'i').test(text)),
];

describe('a report speaks its own spec and no other', () => {
	/**
	 * The two sentences this file was written for, named so a reader knows what the sweep is worth.
	 *
	 * Both shipped. `method.energy` told every Elemental reader that "Energy is read from the
	 * classResources snapshot ..." — a spec whose only pool is mana — and `method.spec` told them their
	 * spec was "confirmed by a Tigereye Brew cast", which no shaman makes. `c95fb4c` gave both an
	 * i18next context off `spec.key`; revert those two keys to their uncontexted form and the sweep below
	 * reddens on `elemental` with both sentences quoted.
	 */
	it('derives the words the two shipped defects were made of', () => {
		expect(EXCLUSIVE.get('windwalker')!.names).toContain('Tigereye Brew');
		expect(EXCLUSIVE.get('windwalker')!.resources).toContain('energy');
		expect(EXCLUSIVE.get('elemental')!.names).toContain('Lava Burst');
		expect(EXCLUSIVE.get('elemental')!.resources).toContain('mana');
	});

	/**
	 * Every spec in the registry, and every spec has a pull — which is the half that makes a third spec
	 * impossible to forget. A spec whose fixtures directory is empty is not swept, and a sweep that
	 * silently covers two of three specs is the same vacuity as the grep this file replaces.
	 */
	it.each(SPECS.map((spec) => [spec.key, spec] as const))('%s has a pull to sweep', (_key, spec) => {
		expect(PULLS.get(spec.key)!.length).toBeGreaterThan(0);
	});

	/**
	 * The anti-vacuity assertion, and the reason this file is not another check that cannot fail: a report
	 * that rendered to nothing would satisfy "the other spec's words are absent" perfectly. So each pull
	 * has to be a real report in its own voice before its silence about the other spec means anything.
	 */
	it.each(SPECS.flatMap((spec) => PULLS.get(spec.key)!.map(([name]) => [spec.key, name, spec] as const)))(
		'%s/%s renders a real report in its own voice',
		(_key, name, spec) => {
			const text = render(spec, PULLS.get(spec.key)!.find(([n]) => n === name)![1], 'auto');
			expect(text.length, `${spec.key}/${name} rendered almost nothing`).toBeGreaterThan(10_000);
			expect(found(text, EXCLUSIVE.get(spec.key)!).length, `${spec.key}/${name} names none of its own`).toBeGreaterThan(
				0,
			);
		},
	);

	/** And the sweep. */
	it.each(SPECS.flatMap((spec) => PULLS.get(spec.key)!.map(([name]) => [spec.key, name, spec] as const)))(
		'%s/%s says nothing that belongs to another spec',
		(_key, name, spec) => {
			const analysis = PULLS.get(spec.key)!.find(([n]) => n === name)![1];
			for (const reading of READINGS) {
				const text = render(spec, analysis, reading);
				for (const other of SPECS) {
					if (other === spec) continue;
					const leaked = found(text, EXCLUSIVE.get(other.key)!);
					// The sentence, not just the word — a bare "Tigereye Brew" tells the next reader nothing
					// about which key to go and fix.
					const sentences = leaked.map((word) => {
						const at = text.search(new RegExp(`\\b${word}\\b`, 'i'));
						return `${word} — "${text
							.slice(Math.max(0, at - 90), at + 110)
							.replaceAll(/\s+/g, ' ')
							.trim()}"`;
					});
					expect(
						leaked,
						`${spec.key}/${name} (${reading}) reads ${other.key} copy:\n  ${sentences.join('\n  ')}`,
					).toEqual([]);
				}
			}
		},
	);
});
