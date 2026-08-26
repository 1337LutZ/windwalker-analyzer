// The one cut the externals chart makes that the audit deliberately does not: who pressed it.
//
// `createElement` rather than JSX so this stays a `.ts` file and vitest's own include patterns pick it
// up — see `vitest.config.ts`, which collects only `.ts`.
//
// **What is observable in a node render.** `ApexChart` mounts inside an effect, so there are no bars in
// the server markup and `TrackLabels` is `hidden` until it has measured the grid. What *is* in the
// markup is the figure's caption — the key lines under the chart — and the section's own prose and
// table. So this file asserts the key lines and reads the tracks off the same split the component
// makes, rather than pretending to count bars that were never drawn.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { rawFixture } from '~/lib/analysis/fixtures';
import { initI18n } from '~/lib/i18n/config';
import { getSpec } from '~/lib/spec';
import report from '~/locales/en/report.json';
import { SpecContext } from '~/components/report/specContext';
import type { Analysis, ProtectionAudit } from '~/lib/types';
import { analyse } from '~/specs/protection/lib';
import Externals from '../Externals';

initI18n();

const PROTECTION = getSpec('protection')!;
const PULLS = ['garrosh.json', 'paragons.json', 'fallenProtectors.json', 'galakras.json', 'spoils.json'] as const;

const auditOf = (name: string): Analysis & ProtectionAudit =>
	analyse(rawFixture('protection', name)) as Analysis & ProtectionAudit;

const markup = (analysis: Analysis): string =>
	renderToStaticMarkup(
		createElement(SpecContext.Provider, { value: PROTECTION }, createElement(Externals, { analysis })),
	);

describe('the externals chart says which of them the reader pressed', () => {
	/**
	 * The complaint this exists for: a Devotion Aura the player pressed drew as though a healer had.
	 *
	 * A raid-wide external lands on its caster like anybody else, so it arrives in `received` under the
	 * player's own actor id — the same array the Pain Suppression beside it is in. The chart used to
	 * merge every caster's windows into one row, which is right for "what protected you" and loses the
	 * fact a reader came here to check: that the cooldown on their own bar was one of them.
	 */
	it('draws the player’s own press in its own tone, on every pull that carried one', () => {
		const own = (report['externals'] as { key: Record<string, string> }).key['own']!;
		for (const name of PULLS) {
			const analysis = auditOf(name);
			const row = analysis.externals.rows.find((entry) => entry.key === 'devotion-aura')!;
			expect(
				row.received.some((caster) => caster.id === analysis.actorID),
				name,
			).toBe(true);
			// The key line under the chart is what the tone's presence is observable as in a node render —
			// `TrackLabels` stays `hidden` until it has measured the grid, so the row's own label is not in
			// the markup at all. It appears only when a row is the reader's own or was given away, so on
			// the four pulls below that carry no `given` at all it can only be the self-cast half.
			expect(markup(analysis), name).toContain(own);
		}
	});

	/**
	 * Four of the five give nothing away at all, which is what makes the assertion above sharp.
	 *
	 * The key line appears for either half of the tone — pressed onto yourself, or put on somebody else —
	 * so on a pull with a `given` row it would have appeared before this change too. `garrosh` and
	 * `paragons` are those pulls; the other three carry no `given` anywhere, so the line on them can only
	 * be the self-cast half, and it was not there before.
	 */
	it('gives nothing away on three of the five, so the tone there is the reader’s own press', () => {
		const gave = PULLS.map((name): [string, number] => [
			name,
			auditOf(name).externals.rows.filter((row) => row.given.length > 0).length,
		]);
		expect(gave).toEqual([
			['garrosh.json', 1],
			['paragons.json', 1],
			['fallenProtectors.json', 0],
			['galakras.json', 0],
			['spoils.json', 0],
		]);
	});

	/**
	 * And the two key lines partition the chart rather than overlapping.
	 *
	 * They used to be "Landed on you" and "You put it on somebody else", which left a press of the
	 * reader's own that landed on the reader in neither sentence — the exact window the complaint was
	 * about. The pair is now "from somebody else" against "you pressed it yourself", which covers every
	 * bar the chart can draw and covers each of them once.
	 */
	it('prints a pair of key lines that between them cover every bar', () => {
		const copy = report['externals'] as { key: Record<string, string> };
		expect(copy.key['landed']).toContain('somebody else');
		expect(copy.key['own']).toContain('yourself');
		const html = markup(auditOf('garrosh.json'));
		expect(html).toContain(copy.key['landed']);
		expect(html).toContain(copy.key['own']);
	});

	/**
	 * The pressed-it key appears only where something was actually pressed.
	 *
	 * A key line for a tone no bar carries is a legend for an empty colour, and it is the shape a
	 * condition written on the wrong list produces: the old one gated on `given`, which is empty for every
	 * raid-wide external, so the line vanished on exactly the pulls this change is about. Read off a pull
	 * whose row list is emptied rather than a synthetic analysis, so the section is the thing under test.
	 */
	it('leaves the key line out when nothing on the chart is the reader’s own', () => {
		const analysis = auditOf('garrosh.json');
		const copy = report['externals'] as { key: Record<string, string> };
		const withoutMine = {
			...analysis,
			externals: {
				...analysis.externals,
				rows: analysis.externals.rows.map((row) => ({
					...row,
					received: row.received.filter((caster) => caster.id !== analysis.actorID),
					given: [],
				})),
			},
		} as Analysis;
		const html = markup(withoutMine);
		expect(html).toContain(copy.key['landed']);
		expect(html).not.toContain(copy.key['own']);
	});
});
