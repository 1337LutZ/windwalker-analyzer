// TEMPORARY probe, not a test. Measures how a Focus of Xuen removal lines up with the chi spender
// that consumed it, across every Windwalker boss pull in the two anonymous reference reports.
//
// Run: WCL_TOKEN=… npx vitest run src/lib/__fixtures__/foxprobe.test.ts
import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';

import { abilityIdOf, isCast } from '~/lib/events';
import { WclClient, fetchFightDataset } from '~/lib/wcl';

const token = process.env['WCL_TOKEN'] ?? '';
const FOX = 145024;
const SPENDERS = new Map<number, string>([
	[100784, 'Blackout Kick'],
	[113656, 'Fists of Fury'],
	[107428, 'Rising Sun Kick'],
]);
const TEB = 116740; // Tigereye Brew cast
const OUT = process.env['PROBE_OUT'] ?? '/tmp/foxprobe.json';

describe.skipIf(token === '')('foxprobe', () => {
	it('measures removal-to-consumer gaps', { timeout: 1_800_000 }, async () => {
		const client = new WclClient({ token });
		const rows: unknown[] = [];
		for (const code of ['a:6MhZgjyAknFWrYfK', 'a:YBQzrcgVJnAj7NMP']) {
			const report = await client.fetchReport(code);
			for (const fight of report.fights.filter((f) => f.encounterID !== 0)) {
				let players;
				try {
					players = await client.fetchPlayerDetails(code, fight.id);
				} catch {
					continue;
				}
				for (const ww of players.filter((p) => p.playerClass === 'Monk' && p.specs.includes('Windwalker'))) {
					let dataset;
					try {
						dataset = await fetchFightDataset(client, { code, fightID: fight.id, playerName: ww.name });
					} catch {
						continue;
					}
					const t0 = dataset.fight.startTime;
					const me = dataset.actor.id;
					const mine = dataset.events.filter((e) => e.sourceID === me || e.targetID === me);
					const auraEvents = mine
						.filter((e) => abilityIdOf(e) === FOX && (e.targetID === me || e.sourceID === me))
						.map((e) => ({ t: e.timestamp - t0, type: e.type }));
					const casts = dataset.events
						.filter((e) => isCast(e) && e.sourceID === me)
						.map((e) => ({ t: e.timestamp - t0, id: abilityIdOf(e) ?? 0 }))
						.sort((a, b) => a.t - b.t);
					const spends = casts.filter((c) => SPENDERS.has(c.id));
					const brews = casts.filter((c) => c.id === TEB);

					// Windows, apply→remove, exactly as `auraWindows` builds them.
					const windows: Array<{ start: number; end: number }> = [];
					let open: number | null = null;
					for (const e of auraEvents) {
						if (e.type === 'applybuff' && open === null) open = e.t;
						else if (e.type === 'removebuff' && open !== null) {
							windows.push({ start: open, end: e.t });
							open = null;
						}
					}
					if (open !== null) windows.push({ start: open, end: dataset.fight.endTime - t0 });

					rows.push({
						code,
						fight: fight.id,
						boss: fight.name,
						kill: fight.kill,
						durationMs: dataset.fight.endTime - t0,
						types: [...new Set(auraEvents.map((e) => e.type))],
						brews: brews.length,
						spends: spends.length,
						windows: windows.map((w) => {
							// Every chi spender within a wide net of the removal, signed: negative is before it.
							const near = spends
								.map((s) => ({ id: s.id, d: s.t - w.end }))
								.filter((s) => Math.abs(s.d) <= 3000)
								.sort((a, b) => Math.abs(a.d) - Math.abs(b.d));
							return {
								start: w.start,
								end: w.end,
								len: w.end - w.start,
								near: near.slice(0, 4),
							};
						}),
					});
				}
			}
		}
		writeFileSync(OUT, JSON.stringify(rows, null, '\t'));
		console.log(`WROTE ${OUT} — ${rows.length} pulls`);
	});
});
