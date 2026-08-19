import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import i18n, { initI18n } from '~/lib/i18n/config';
import type { Analysis } from '~/lib/types';

import EnergizingBrew from '../EnergizingBrew';
import Takeaways from '~/components/sections/Takeaways';

initI18n();
const t = i18n.getFixedT('en', 'report');

const fixture = (): Analysis =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../__fixtures__/strong.json'), 'utf8'));

describe('Energizing Brew section', () => {
	const withRecommendation = (): Analysis => {
		const analysis = fixture();
		return {
			...analysis,
			energizing: {
				...analysis.energizing!,
				rushingJadeWind: true,
				hasteRjwEligible: true,
				hasteRjwUses: 0,
			},
		};
	};

	it('shows the RJW haste recommendation in the section itself', () => {
		const analysis = withRecommendation();
		const energizing = analysis.energizing!;
		const html = renderToStaticMarkup(
			createElement(EnergizingBrew, {
				analysis: {
					...analysis,
					energizing: {
						...energizing,
						rushingJadeWind: true,
						hasteRjwEligible: true,
						hasteRjwUses: 0,
					},
				},
			}),
		);

		expect(html).toContain(t('energizingBrew.recommendation.title'));
		expect(html).toContain(t('energizingBrew.recommendation.body'));
		expect(html).toContain(t('energizingBrew.kpi.uses'));
		expect(html).toContain(t('energizingBrew.pairing.label'));
		expect(html).toContain(t('energizingBrew.pairing.missed'));
		expect(html).toContain(`>${energizing.casts}<em`);
		expect(html).toContain(`/ ${energizing.available}`);
	});

	it('shows the RJW haste recommendation in the Summary cards', () => {
		const html = renderToStaticMarkup(createElement(Takeaways, { analysis: withRecommendation() }));

		expect(html).toContain(t('summary.takeaways.metric.energizingBrewRjw.label'));
		expect(html).toContain(t('summary.takeaways.metric.energizingBrewRjw.fix'));
	});
});
