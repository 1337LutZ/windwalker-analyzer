// TEMPORARY calibration sweep. Scores every Windwalker kill in the two anonymous reports, with the
// engine as it now stands, so thresholds and weights are judged against a population.
import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { scoreAnalysis } from '~/lib/score';
import { analyse } from '~/lib/spec/windwalker';
import { WclClient, fetchFightDataset } from '~/lib/wcl';

const token = process.env['WCL_TOKEN'] ?? '';
describe.skipIf(token === '')('sweep', () => {
	it('scores every WW kill', { timeout: 1_800_000 }, async () => {
		const client = new WclClient({ token });
		const rows: string[] = [];
		for (const code of ['a:YBQzrcgVJnAj7NMP', 'a:6MhZgjyAknFWrYfK']) {
			const report = await client.fetchReport(code);
			for (const fight of report.fights.filter((f) => f.encounterID !== 0 && f.kill)) {
				try {
					const players = await client.fetchPlayerDetails(code, fight.id);
					for (const ww of players.filter(
						(p) => p.playerClass === 'Monk' && p.specs.includes('Windwalker'),
					)) {
						const a = analyse(
							await fetchFightDataset(client, { code, fightID: fight.id, playerName: ww.name }),
						);
						if (!a.isSpec) continue;
						const c = scoreAnalysis(a);
						rows.push(
							[
								c.overall,
								((100 * a.procs.snapshotted) / Math.max(a.procs.opportunities, 1)).toFixed(1),
								a.procs.meanDepthPct.toFixed(1),
								a.cpm.gcdUtilisationPct.toFixed(1),
								a.debuff.singleTarget ? a.debuff.engagedUptimePct.toFixed(1) : '',
								((100 * a.filler.wasted) / Math.max(a.filler.casts, 1)).toFixed(1),
								a.brew.avgConsumed.toFixed(1),
								String(a.brew.wastedAtCap),
								`${code.slice(2, 8)}#${fight.id}`,
								a.encounter,
							].join('\t'),
						);
					}
				} catch {
					/* unreadable pull */
				}
			}
		}
		writeFileSync(
			'/tmp/sweep2.tsv',
			['overall\tsnap\tdepth\tgcd\trsk\ttpW\tbrewAvg\tcap\tpull\tboss', ...rows].join('\n'),
		);
	});
});
