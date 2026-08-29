// What `detectSplitGroup` says about real pulls, straight out of the analyzer's own code path.
//
// **This is the reproduction path for every figure in `lib/game/splitGroups.ts`.** That module's
// thresholds are argued from shares measured on named reports — 83 to 100% on the belt, 50.3 to 62.0%
// on a stacked Dark Shaman, 99.0% on a split one — and a number nobody can re-take is a number that
// quietly stops being true. Nothing here is committed and nothing is asserted: it prints, and the
// pinning happens in `game/__tests__/splitGroups.test.ts` against fixtures that are.
//
// It boots Vite and fetches through `fetchFightDataset` for the two reasons `segment-report.mjs` gives
// beside its own copy of this bootstrap: the analysis is TypeScript under `~/…` and this repository
// carries no TypeScript runner, and a hand-built dataset looks right and is not.
//
// Usage:
//   WCL_TOKEN=… node scripts/split-report.mjs "<player>@<code>:<fightID,…>" …
//
// The token is a WarcraftLogs bearer token, read from the environment and never written anywhere.
//
//   node scripts/split-report.mjs "Player (17)@a:6MhZgjyAknFWrYfK:10,16,38,39,40"

import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

/** `<player>@<code>:<fights>`. Split at the **last** colon: an anonymous code carries one of its own. */
function parseJob(arg) {
	const at = arg.indexOf('@');
	if (at < 0) throw new Error(`${arg}: expected <player>@<code>:<fightID,…>`);
	const rest = arg.slice(at + 1);
	const colon = rest.lastIndexOf(':');
	if (colon < 0) throw new Error(`${arg}: no fight ids — an anonymous code still needs :<fightID,…> after it`);
	return {
		player: arg.slice(0, at),
		code: rest.slice(0, colon),
		fights: rest
			.slice(colon + 1)
			.split(',')
			.map(Number),
	};
}

const clock = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

async function main() {
	const token = process.env['WCL_TOKEN'];
	if (!token) throw new Error('WCL_TOKEN is not set — export a WarcraftLogs bearer token first');
	const jobs = process.argv.slice(2).map(parseJob);
	if (jobs.length === 0) throw new Error('give at least one <player>@<code>:<fightID,…>');

	const server = await createServer({
		configFile: false,
		appType: 'custom',
		logLevel: 'warn',
		server: { middlewareMode: true },
		resolve: { alias: [{ find: '~', replacement: SRC }] },
	});
	try {
		const [{ WclClient }, { fetchFightDataset }, { SPECS }, { initI18n }] = await Promise.all([
			server.ssrLoadModule('/src/lib/wcl/client.ts'),
			server.ssrLoadModule('/src/lib/wcl/fetchFight.ts'),
			server.ssrLoadModule('/src/lib/spec/registry.ts'),
			server.ssrLoadModule('/src/lib/i18n/config.ts'),
		]);
		// `fetchFightDataset` reports progress through the translator, so the bundle has to be loaded or
		// the first message throws on a missing key rather than on anything to do with the fetch.
		initI18n();
		const client = new WclClient({ token });

		for (const job of jobs) {
			for (const fightID of job.fights) {
				let dataset;
				try {
					dataset = await fetchFightDataset(client, { code: job.code, fightID, playerName: job.player });
				} catch (error) {
					console.log(`${job.code} #${fightID} ${job.player}: could not fetch — ${error.message}`);
					continue;
				}
				// The spec the pull reads as. Every spec runs the same core and the rules take no spec at all,
				// but `analyse` is how the finding is reached, so one has to answer for the pull.
				const read = SPECS.map((spec) => ({ spec, analysis: spec.analyse(dataset) })).find(
					(candidate) => candidate.analysis.isSpec,
				);
				if (read === undefined) {
					console.log(`${job.code} #${fightID} ${job.player}: no registered spec recognised this pull`);
					continue;
				}
				const label = `${job.code} #${fightID} ${dataset.fight.name} · ${job.player} · ${read.spec.key}`;
				const split = read.analysis.splitGroup;
				if (!split) {
					console.log(`${label}\n    fought together`);
					continue;
				}
				const windows = split.windows.map(([from, to]) => `${clock(from)}–${clock(to)}`).join(', ');
				console.log(
					`${label}\n    ${split.kind}  share ${(split.share * 100).toFixed(1)}%` +
						`  away ${(split.awayMs / 1000).toFixed(1)}s` +
						`${split.partedYards ? `  parted ${split.partedYards}y` : ''}${split.name ? `  ${split.name}` : ''}${windows ? `  ${windows}` : ''}`,
				);
			}
		}
	} finally {
		await server.close();
	}
}

await main();
