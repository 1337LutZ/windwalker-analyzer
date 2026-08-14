// TEMPORARY harness, not a test. Fetches one real pull and writes the analysis to disk so the UI can
// be rendered against real data without a token ever reaching the browser.
//
// Run: WCL_TOKEN=… npx vitest run src/lib/__fixtures__/capture.test.ts
// Skips itself when the token is absent, so a normal `vitest run` is unaffected.
//
// Capture from ANONYMOUS reports only (`a:` codes). The fixtures are committed, and a fixture built
// from an ordinary log would publish a named player's performance data in a public repo. Anonymous
// reports carry the same events with the roster reduced to `Player (17)`. The `a:` prefix is part of
// the code — the API answers "This report does not exist." without it.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'vitest';

import { analyse } from '~/lib/spec/windwalker';
import { WclClient, fetchFightDataset } from '~/lib/wcl';

const token = process.env['WCL_TOKEN'] ?? '';
const CODE = process.env['FIXTURE_CODE'] ?? 'a:6MhZgjyAknFWrYfK';
const FIGHT = Number(process.env['FIXTURE_FIGHT'] ?? '57');
const PLAYER = process.env['FIXTURE_PLAYER'] ?? '';

describe.skipIf(token === '')('capture', () => {
	it('writes an analysis fixture', { timeout: 180_000 }, async () => {
		const client = new WclClient({ token });

		let player = PLAYER;
		if (player === '') {
			const players = await client.fetchPlayerDetails(CODE, FIGHT);
			const ww = players.find((p) => p.playerClass === 'Monk' && p.specs.includes('Windwalker'));
			if (!ww) throw new Error(`No Windwalker in ${CODE} fight ${FIGHT}: ${JSON.stringify(players)}`);
			player = ww.name;
		}

		const dataset = await fetchFightDataset(client, {
			code: CODE,
			fightID: FIGHT,
			playerName: player,
			onProgress: ({ phase, message }) => console.log(`[${phase}] ${message}`),
		});
		const analysis = analyse(dataset);

		const out = resolve(import.meta.dirname, 'analysis.json');
		mkdirSync(dirname(out), { recursive: true });
		writeFileSync(out, JSON.stringify(analysis, null, '\t'));
		console.log(
			`WROTE ${out} — ${analysis.player} ${analysis.encounter} ` +
				`isSpec=${analysis.isSpec} events→ damage=${analysis.damage.abilities.length} ` +
				`casts=${analysis.casts.length} brewPoints=${analysis.brew.bankTimeline.length} ` +
				`procs=${analysis.procs.windows.length} misses=${analysis.misses.length}`,
		);
	});
});
