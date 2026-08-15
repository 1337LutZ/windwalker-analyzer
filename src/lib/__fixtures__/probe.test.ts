// TEMPORARY probe, deleted before the change lands. Writes the Rising Sun Kick debuff numbers for the
// Kor'kron Dark Shaman pulls in the two anonymous reports, so the tile can be read before and after.
import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { analyse } from '~/lib/spec/windwalker';
import { WclClient, fetchFightDataset } from '~/lib/wcl';

const token = process.env['WCL_TOKEN'] ?? '';
const OUT = process.env['PROBE_OUT'] ?? '/tmp/probe.txt';
describe.skipIf(token === '')('probe', () => {
	it('prints the debuff numbers', { timeout: 900_000 }, async () => {
		const client = new WclClient({ token });
		const lines: string[] = [];
		for (const code of ['a:6MhZgjyAknFWrYfK', 'a:YBQzrcgVJnAj7NMP']) {
			const report = await client.fetchReport(code);
			lines.push(`FIGHTS ${code} ${JSON.stringify(report.fights.map((f) => [f.id, f.name, f.encounterID]))}`);
			for (const fight of report.fights.filter((f) => /Dark Shaman/i.test(f.name))) {
				const players = await client.fetchPlayerDetails(code, fight.id);
				for (const ww of players.filter((p) => p.playerClass === 'Monk' && p.specs.includes('Windwalker'))) {
					const a = analyse(await fetchFightDataset(client, { code, fightID: fight.id, playerName: ww.name }));
					const d = a.debuff;
					lines.push(
						`PROBE ${code.slice(2, 8)}#${fight.id} kill=${fight.kill} ${a.encounter} dur=${(a.durationMs / 1000).toFixed(1)}s ` +
							`engaged=${(d.engagedMs / 1000).toFixed(1)}s engagedUptime=${d.engagedUptimePct.toFixed(2)}% ` +
							`primaryUptime=${d.uptimePct.toFixed(2)}% secondsLost=${d.secondsLost} drops=${d.drops.length} ` +
							`intermission=${d.intermissionSec} share=${d.primaryDamageShare.toFixed(1)} single=${d.singleTarget} ` +
							`casts=${d.casts} sum=${(d.engagedUptimePct + (d.secondsLost * 1000 * 100) / d.engagedMs).toFixed(2)} ` +
							`misses=${a.misses.filter((m) => m.kind === 'RSK dropped').length}`,
					);
				}
			}
		}
		writeFileSync(OUT, lines.join('\n'));
	});
});
