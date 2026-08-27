// The rotation reference this spec did not have, rendered against a real pull.
//
// `createElement` rather than JSX so this stays a `.ts` file and vitest's own include patterns pick it
// up — see `vitest.config.ts`, which collects only `.ts`.
//
// **What a type check cannot catch here, and what this is for.** A section that renders an empty
// `<div>` satisfies every signature in the tree: the props are right, the flow is a valid array, and
// an `<ol>` with nothing in it is valid HTML. The port shipped nine shared sections and three of its
// own, and the way a tenth goes wrong is not a crash — it is a heading in the sidebar with nothing
// under it, or seventeen boxes with `rotation.entry.judgment.name` written on them, because i18next
// answers a missing key with the key itself. Both are asserted below.
//
// The flow's derivation from `apl.ts` is held in `lib/view/__tests__/rotationFlow.test.ts` and the
// chart's own drawing in `components/rotation/__tests__/flowChart.test.ts`; what is left for this file
// is the section — that it is registered where a reader will find it, and that everything it wraps the
// chart in actually reaches the page.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { rawFixture } from '~/lib/analysis/fixtures';
import i18n, { initI18n } from '~/lib/i18n/config';
import { getSpec } from '~/lib/spec';
import { flowKeys } from '~/lib/view/rotationFlow';
import { SpecContext } from '~/components/report/specContext';
import { SPEC_SECTIONS } from '~/components/report/specSections';
import { analyse } from '~/specs/protection/lib';
import { LADDER_ENTRIES } from '~/specs/protection/lib/apl';
import { ROTATION_FLOW } from '~/specs/protection/lib/view/rotationFlow';

import Rotation from '../Rotation';

initI18n();
const t = i18n.getFixedT('en', 'report');

const PROTECTION = getSpec('protection')!;

/** React escapes an apostrophe to `&#x27;`, and half this spec's buttons carry one. */
const markup = (): string =>
	renderToStaticMarkup(
		createElement(
			SpecContext.Provider,
			{ value: PROTECTION },
			createElement(Rotation, { analysis: analyse(rawFixture('protection', 'galakras.json')) }),
		),
	).replaceAll('&#x27;', "'");

describe('the Protection rotation section', () => {
	it('is registered in the reference group, directly under the ladder it is the list for', () => {
		const sections = SPEC_SECTIONS['protection']!;
		const at = sections.findIndex((section) => section.id === 'rotation');
		expect(at).toBeGreaterThan(0);
		expect(sections[at]?.group).toBe('reference');
		expect(sections[at]?.titleKey).toBe('rotation.title');
		// The adjacency is the argument the entry beside it makes: the heading above says what the list
		// wanted at each of your globals, and this is the list.
		expect(sections[at - 1]?.id).toBe('priority');
		// It takes no mode. Both other specs' references filter by target count and this one draws the
		// banded rungs with a chip instead, so a `modeProps` here would be a prop nothing reads.
		expect(sections[at]?.modeProps).toBeUndefined();
	});

	it('draws a heading a reader can jump to', () => {
		const html = markup();
		expect(html).toContain('id="rotation-heading"');
		expect(html).toContain(t('rotation.title'));
	});

	/**
	 * The paragraph without which the list reads as broken.
	 *
	 * Both holy power spenders are off the global cooldown for this spec, so a reader scanning seventeen
	 * rungs for Shield of the Righteous will not find it. `protEconomy` is the sentence that explains
	 * that, and it is above the chart rather than in a note under it for exactly that reason.
	 */
	it('says where the spenders went, above the chart and again beneath it', () => {
		const html = markup();
		expect(html).toContain(t('rotation.intent'));
		expect(html).toContain(t('rotation.protEconomy'));
		expect(html).toContain(t('rotation.notes.spenders'));
		expect(html.indexOf(t('rotation.protEconomy'))).toBeLessThan(html.indexOf(t('rotation.notes.spenders')));
	});

	it('draws the chart, with every rung of the ladder on it', () => {
		const html = markup();
		expect(html).toContain(t('rotation.flow.title'));
		expect(html).toContain(t('rotation.flow.caption'));
		expect(html.split('animate-rung-in').length - 1).toBe(LADDER_ENTRIES.length);
		for (const key of flowKeys(ROTATION_FLOW)) {
			expect(html, key).toContain(t(`rotation.entry.${key}.name`));
		}
	});

	it('prints its four notes under the chart', () => {
		const html = markup();
		for (const note of ['spenders', 'counts', 'execute', 'protTalents']) {
			expect(html, note).toContain(t(`rotation.notes.${note}`));
		}
	});

	/**
	 * Nothing on the page is a key, which is the failure mode i18next is built to be quiet about.
	 *
	 * The legend keys reach `FlowChart` as a prop, so they never sit inside a `t(...)` and
	 * `i18n/__tests__/keys.test.ts` cannot check that they exist. A typo in one of them renders the key
	 * at a reader with every other guard in the tree green.
	 */
	it('renders no locale key at a reader', () => {
		expect(markup()).not.toContain('rotation.');
	});
});
