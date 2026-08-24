import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import i18n, { initI18n } from '~/lib/i18n/config';
import type { Analysis } from '~/lib/types';

import { SpecContext } from '~/components/report/specContext';
import { getSpec } from '~/lib/spec';

import EnergizingBrew from '../EnergizingBrew';

// Every fixture below is a Windwalker pull, so the section is rendered under the Windwalker's own
// scorer and copy. Named rather than left to `SpecContext`'s default, which is the build's pinned
// `DEFAULT_SPEC` — under `PUBLIC_SPEC=elemental` that scored these monk fixtures with the Shaman's
// thresholds.
const WINDWALKER_SPEC = getSpec('windwalker')!;
const asWindwalker = (node: ReactNode): ReactElement =>
	createElement(SpecContext.Provider, { value: WINDWALKER_SPEC }, node);

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
			asWindwalker(
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
			),
		);

		expect(html).toContain(t('energizingBrew.recommendation.title'));
		expect(html).toContain(t('energizingBrew.recommendation.body'));
		expect(html).toContain(t('energizingBrew.kpi.uses'));
		expect(html).toContain(t('energizingBrew.pairing.label'));
		expect(html).toContain(t('energizingBrew.pairing.missed'));
		expect(html).toContain(`>${energizing.casts}<em`);
		expect(html).toContain(`/ ${energizing.available}`);
	});

	// The summary used to repeat this as a card of its own, in the three-card "key improvements" list that
	// the scorecard grid replaced. The card is gone with the list; the recommendation is not, and the
	// assertions above are where it is now checked — its own section, which is where the card pointed.
});
