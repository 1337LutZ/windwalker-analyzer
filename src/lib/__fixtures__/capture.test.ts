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
//
// Pass FIXTURE_PLAYER whenever the raid holds more than one of the spec. Without it the search below
// takes the *first* Windwalker the roster happens to list, which is not a stable choice: re-capturing
// `weave` silently swapped Player (25) for Player (5) — same fight, same length, a different monk —
// and turned a five-proc pull that weaves elixirs into a three-proc pull that does not. Three tests
// caught it, which is luck rather than design: the fixture would otherwise have kept its name while
// describing somebody else.
//
// The six committed fixtures and the arguments that produce them:
//
//   strong  FIXTURE_CODE=a:6MhZgjyAknFWrYfK FIXTURE_FIGHT=57
//   mixed   FIXTURE_CODE=a:YBQzrcgVJnAj7NMP FIXTURE_FIGHT=10
//   poor    FIXTURE_CODE=a:YBQzrcgVJnAj7NMP FIXTURE_FIGHT=30
//   waves   FIXTURE_CODE=a:6MhZgjyAknFWrYfK FIXTURE_FIGHT=10
//   cleave  FIXTURE_CODE=a:6MhZgjyAknFWrYfK FIXTURE_FIGHT=16
//   weave   FIXTURE_CODE=a:LhYtyq8xFR9pG6mg FIXTURE_FIGHT=11 FIXTURE_PLAYER='Player (25)'
//
// Each writes `analysis.json`, which is gitignored staging — rename it to the fixture's own name.

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
