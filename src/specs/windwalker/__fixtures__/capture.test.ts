// TEMPORARY harness, not a test. Fetches one real pull and writes the **raw dataset** to disk so the
// engine can be run over real events without a token ever reaching the browser.
//
// Run: WCL_TOKEN=… npx vitest run src/specs/windwalker/__fixtures__/capture.test.ts
// Skips itself when the token is absent, so a normal `vitest run` is unaffected.
//
// **It writes `analyse()`'s input, not its output, and that is a change from the first six captures.**
// `rawFixtures('windwalker')` in ~/lib/analysis/fixtures classifies a `.json` by shape — a raw
// `FightDataset` has `events` and an `actor`, a captured `Analysis` has `casts` and an `actorID` and no
// events — and only a raw one can be handed to `analyse()` by a guard. A captured analysis is frozen at
// whatever the engine printed on the day it was taken, so a sweep that wants today's engine run over a
// real pull needs this half instead. The six captured analyses stay committed and stay useful for the
// assertions that are about a published figure; anything new belongs here as a dataset.
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
// The committed fixtures and the arguments that produce them. The first six are captured `Analysis`
// objects written by the earlier form of this file; the four below them are raw datasets. Every one of
// the ten is a boss kill.
//
//   strong  FIXTURE_CODE=a:6MhZgjyAknFWrYfK FIXTURE_FIGHT=57                               (analysis)
//   mixed   FIXTURE_CODE=a:YBQzrcgVJnAj7NMP FIXTURE_FIGHT=10                               (analysis)
//   poor    FIXTURE_CODE=a:YBQzrcgVJnAj7NMP FIXTURE_FIGHT=30                               (analysis)
//   waves   FIXTURE_CODE=a:6MhZgjyAknFWrYfK FIXTURE_FIGHT=10                               (analysis)
//   cleave  FIXTURE_CODE=a:6MhZgjyAknFWrYfK FIXTURE_FIGHT=16                               (analysis)
//   weave   FIXTURE_CODE=a:LhYtyq8xFR9pG6mg FIXTURE_FIGHT=11 FIXTURE_PLAYER='Player (25)'  (analysis)
//
//   dataset-ironJuggernaut  FIXTURE_CODE=a:6MhZgjyAknFWrYfK FIXTURE_FIGHT=12               (dataset)
//   sections   FIXTURE_CODE=a:kgt1BMqf3QrybpJR FIXTURE_FIGHT=12 FIXTURE_PLAYER='Player (15)'  (dataset)
//   idle       FIXTURE_CODE=a:XkDQJHaztfnCd9Yj FIXTURE_FIGHT=1  FIXTURE_PLAYER='Player (4)'   (dataset)
//   uncounted  FIXTURE_CODE=a:XkDQJHaztfnCd9Yj FIXTURE_FIGHT=29 FIXTURE_PLAYER='Player (4)'   (dataset)
//
// What the three raw pulls added on 2026-08-24 are for, since none of them is named after its boss:
//
//   - `sections` is Galakras, and it is the pull `dataset-ironJuggernaut` cannot be. Iron Juggernaut is
//     the one uniform Siege pull — one segment, 100% of contact at a single enemy — so before this the
//     Windwalker's only raw dataset could not exercise a segmented reading at all. Galakras cuts into
//     seventeen segments covering all five modes, and carries 33 Rushing Jade Wind presses, 6 of them
//     into fewer than three targets and 27 into three or more.
//   - `idle` is Immerseus, the downtime case: four of its ten segments are `idle`, 75s of a 255s pull,
//     which is the time `bandOf(0) === 1` used to file as single-target. Cheapest of the three, and it
//     carries a second, smaller two-sided Rushing Jade Wind sample (9 presses, 4 under three targets).
//   - `uncounted` is heroic Malkorok, and it is the only committed fixture from an encounter the
//     WarcraftLogs Siege parsing rules name. It was fetched because `Living Corruption` read `reach:
//     'both'` and `uncountedActorIDs` would therefore have something real to remove — and the fixture
//     then took the row off that reading: 63 of the monk's hits on 14 separate Living Corruption spawns
//     across 194s, one of them held past a target window, so the row is `'damage'` and nothing in the
//     tree is uncounted. The pull earned its place by disproving its own reason for being fetched. It
//     carries no Rushing Jade Wind at all.
//
// Each writes `analysis.json`, which is gitignored staging — rename it to the fixture's own name, then
// run `npx oxfmt` on the renamed file alone. **The staging file keeps that name because .gitignore names
// it**, and that entry is what stopped a 25k-line orphan reaching the history once; the name is the
// ignore rule's and no longer describes the contents.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'vitest';

import { analyse } from '~/specs/windwalker';
import { WclClient, fetchFightDataset } from '~/lib/wcl';

const token = process.env['WCL_TOKEN'] ?? '';
const CODE = process.env['FIXTURE_CODE'] ?? 'a:6MhZgjyAknFWrYfK';
const FIGHT = Number(process.env['FIXTURE_FIGHT'] ?? '57');
const PLAYER = process.env['FIXTURE_PLAYER'] ?? '';
/**
 * Which half of the engine to write: its input, or its output.
 *
 * `dataset` is the default and the one anything new should take — a raw pull a guard can hand to
 * today's `analyse()`. `FIXTURE_SHAPE=analysis` writes the *output* instead, which is the shape the
 * first six fixtures were captured in and the only reason this branch exists: those six are pinned
 * by dozens of assertions about published figures, and re-capturing them as datasets would be a
 * different change entirely. Use it to refresh one of the six, never to add a seventh.
 */
const SHAPE = process.env['FIXTURE_SHAPE'] === 'analysis' ? 'analysis' : 'dataset';

describe.skipIf(token === '')('capture', () => {
	it('writes a fixture', { timeout: 180_000 }, async () => {
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

		const out = resolve(import.meta.dirname, 'analysis.json');
		mkdirSync(dirname(out), { recursive: true });
		// Default settings on purpose, which is what the six captured analyses were taken under: a
		// fixture carrying somebody's tuned leeway is a fixture nobody else can reason about.
		writeFileSync(out, JSON.stringify(SHAPE === 'analysis' ? analyse(dataset) : dataset));
		console.log(
			`WROTE ${out} (${SHAPE}) — ${dataset.actor.name} ${dataset.fight.name} kill=${dataset.fight.kill} ` +
				`events=${dataset.events.length} enemyDeaths=${dataset.enemyDeaths.length}`,
		);
	});
});
