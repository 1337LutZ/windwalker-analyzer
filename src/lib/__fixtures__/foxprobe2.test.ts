// TEMPORARY probe, not a test. Dumps every player event around the Focus of Xuen removals that the
// first probe could not attribute to a chi spender.
import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';

import { abilityIdOf } from '~/lib/events';
import { WclClient, fetchFightDataset } from '~/lib/wcl';

const token = process.env['WCL_TOKEN'] ?? '';
const CASES: Array<[string, number, number]> = [
	['a:6MhZgjyAknFWrYfK', 12, 190309],
	['a:YBQzrcgVJnAj7NMP', 5, 291600],
	['a:YBQzrcgVJnAj7NMP', 7, 339438],
	['a:YBQzrcgVJnAj7NMP', 10, 72968],
	['a:6MhZgjyAknFWrYfK', 1, 185314],
];

describe.skipIf(token === '')('foxprobe2', () => {
	it('dumps the unattributed removals', { timeout: 600_000 }, async () => {
		const client = new WclClient({ token });
		const out: unknown[] = [];
		for (const [code, fightID, at] of CASES) {
			const players = await client.fetchPlayerDetails(code, fightID);
			const ww = players.find((p) => p.playerClass === 'Monk' && p.specs.includes('Windwalker'));
			if (ww === undefined) continue;
			const dataset = await fetchFightDataset(client, { code, fightID, playerName: ww.name });
			const t0 = dataset.fight.startTime;
			const me = dataset.actor.id;
			out.push({
				code,
				fightID,
				at,
				events: dataset.events
					.map((e) => ({ ...e, t: e.timestamp - t0 }))
					.filter((e) => Math.abs(e.t - at) <= 4000)
					.filter((e) => e.sourceID === me || e.targetID === me)
					.map((e) => ({
						t: e.t,
						type: e.type,
						id: abilityIdOf(e),
						src: e.sourceID,
						tgt: e.targetID,
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						res: (e as any).classResources,
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						stack: (e as any).stack,
					})),
			});
		}
		writeFileSync('/tmp/foxprobe2.json', JSON.stringify(out, null, '\t'));
		console.log('WROTE /tmp/foxprobe2.json');
	});
});
