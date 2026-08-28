// Segment breakdown for one or more reports, straight out of the analyser's own code path.
//
// **Why this boots Vite instead of just importing.** The analysis lives in TypeScript under `~/…`, and
// this repository carries no TypeScript runner — no `tsx`, no `vite-node`. Vite is already a dependency
// and its SSR loader resolves both the syntax and the alias, so `ssrLoadModule` gets the real modules
// with nothing new installed and no second copy of the analysis to drift from the first.
//
// **And it fetches through `fetchFightDataset` rather than assembling a dataset here.** A hand-built one
// looks right and is not: the first attempt at this produced an empty contact clock, so every figure
// derived from contact — segments included — came out zero while the event stream was plainly fine. The
// app's own fetch path is the only one that can be trusted to produce an `Analysis` worth reading.
//
// Usage:
//   WCL_TOKEN=… node scripts/segment-report.mjs --player <name> [--spec <key>] [--out <path>] <code…>
//
// The token is a WarcraftLogs bearer token, read from the environment and never written anywhere.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

// ------------------------------------------------------------------------ argv

function parseArgs(argv) {
	const codes = [];
	const opts = { out: 'segment-breakdown.md' };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--player' || arg === '--spec' || arg === '--out') {
			const value = argv[++i];
			if (value === undefined) throw new Error(`${arg} needs a value`);
			opts[arg.slice(2)] = value;
		} else if (arg.startsWith('--')) {
			throw new Error(`unknown flag ${arg}`);
		} else {
			codes.push(arg);
		}
	}
	return { codes, opts };
}

/** A report code, or the code out of a WarcraftLogs URL — people paste both. */
const codeOf = (input) => {
	const match = /reports\/([A-Za-z0-9:]+)/.exec(input);
	return match?.[1] ?? input;
};

// --------------------------------------------------------------------- format

const clock = (ms) => {
	const total = Math.max(0, Math.round(ms));
	const m = Math.floor(total / 60_000);
	const s = Math.floor((total % 60_000) / 1000);
	const rest = total % 1000;
	return `${m}:${String(s).padStart(2, '0')}.${String(rest).padStart(3, '0')}`;
};

const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`;

const DIFFICULTY = { 1: 'LFR', 3: 'Normal', 4: 'Heroic', 5: 'Mythic' };

/** Share of the pull each mode holds, in the order a reader scans them. */
const MODES = ['single', 'cleave', 'aoe', 'mixed', 'idle'];

function modeTotals(segments, durationMs) {
	const held = new Map();
	for (const segment of segments) {
		held.set(segment.mode, (held.get(segment.mode) ?? 0) + (segment.endMs - segment.startMs));
	}
	return MODES.filter((mode) => held.has(mode)).map((mode) => {
		const ms = held.get(mode) ?? 0;
		return `${mode} ${seconds(ms)} (${durationMs > 0 ? ((ms / durationMs) * 100).toFixed(1) : '0.0'}%)`;
	});
}

// ----------------------------------------------------------------------- main

async function main() {
	const { codes, opts } = parseArgs(process.argv.slice(2));
	const token = process.env['WCL_TOKEN'];
	if (!token) throw new Error('WCL_TOKEN is not set — export a WarcraftLogs bearer token first');
	if (codes.length === 0) throw new Error('give at least one report code or URL');
	if (!opts.player) throw new Error('--player <name> is required: segments are a reading of one player’s contact');

	const server = await createServer({
		configFile: false,
		appType: 'custom',
		logLevel: 'warn',
		server: { middlewareMode: true },
		resolve: { alias: [{ find: '~', replacement: SRC }] },
	});

	try {
		const [{ WclClient }, { fetchFightDataset, listReportFights }, { SPECS, getSpec }, { initI18n }] =
			await Promise.all([
				server.ssrLoadModule('/src/lib/wcl/client.ts'),
				server.ssrLoadModule('/src/lib/wcl/fetchFight.ts'),
				server.ssrLoadModule('/src/lib/spec/registry.ts'),
				server.ssrLoadModule('/src/lib/i18n/config.ts'),
			]);
		// `fetchFightDataset` reports progress through the translator, so the bundle has to be loaded or
		// the first message throws on a missing key rather than on anything to do with the fetch.
		initI18n();

		let credits = null;
		const client = new WclClient({
			token,
			onCredits: (left) => {
				credits = left;
			},
		});

		const forced = opts.spec ? getSpec(opts.spec) : undefined;
		if (opts.spec && !forced)
			throw new Error(`unknown spec "${opts.spec}" — try one of ${SPECS.map((s) => s.key).join(', ')}`);

		const lines = [
			'# Segment breakdown',
			'',
			`Player **${opts.player}**, ${codes.length} report${codes.length === 1 ? '' : 's'}, kills only.`,
			'',
			'Segments come from `analyseCore`, the same derivation the report page draws — a stretch of the',
			'pull holding one target-count mode, after the floor and the hysteresis have had their say.',
			'`dominance` is the share of the segment actually spent in its own mode; a low one is why a span',
			'reads `mixed`.',
			'',
		];

		for (const raw of codes) {
			const code = codeOf(raw);
			lines.push(`## ${code}`, '');

			let list;
			try {
				list = await listReportFights(client, code);
			} catch (error) {
				lines.push(`Could not read this report: ${error.message}`, '');
				console.error(`${code}: ${error.message}`);
				continue;
			}

			const kills = list.fights.filter((fight) => fight.kill);
			const mine = kills.filter((fight) =>
				(fight.roster ?? []).some((actor) => actor.name.toLowerCase() === opts.player.toLowerCase()),
			);
			if (mine.length === 0) {
				const why = kills.length === 0 ? 'no kills in it' : `${opts.player} is in none of its ${kills.length} kills`;
				lines.push(`Nothing to read: ${why}.`, '');
				console.error(`${code}: ${why}`);
				continue;
			}

			for (const fight of mine) {
				const heading = [
					`### Fight ${fight.id} · ${fight.name}`,
					fight.size ? `${fight.size} ${DIFFICULTY[fight.difficulty] ?? `difficulty ${fight.difficulty}`}` : null,
					clock(fight.endTime - fight.startTime),
				]
					.filter(Boolean)
					.join(' · ');
				lines.push(heading, '');

				let dataset;
				try {
					dataset = await fetchFightDataset(client, { code, fightID: fight.id, playerName: opts.player });
				} catch (error) {
					lines.push(`Could not fetch this pull: ${error.message}`, '');
					console.error(`${code} #${fight.id}: ${error.message}`);
					continue;
				}

				// The spec the pull actually reads as, unless one was named. Every spec runs the same core, so
				// the segments would exist either way — but the target-count exclusions are the spec's, and a
				// wrong one would quietly change them.
				const candidates = forced ? [forced] : SPECS;
				let analysis = null;
				let used = null;
				for (const spec of candidates) {
					const result = spec.analyse(dataset);
					if (forced || result.isSpec) {
						analysis = result;
						used = spec;
						break;
					}
				}
				if (!analysis) {
					lines.push(`No registered spec recognised this pull, so no segments were derived.`, '');
					console.error(`${code} #${fight.id}: no spec matched`);
					continue;
				}

				const segments = analysis.segments?.segments ?? [];
				lines.push(
					`Read as **${used.specName}**. Floor ${seconds(analysis.segments?.floorMs ?? 0)}, ${segments.length} segment${segments.length === 1 ? '' : 's'}.`,
					'',
				);
				if (segments.length === 0) {
					lines.push('No segments: this pull produced no contact the derivation could divide.', '');
					continue;
				}

				lines.push(
					'| # | from | to | length | mode | dominance |',
					'| --: | --- | --- | --: | --- | --: |',
					...segments.map(
						(s) =>
							`| ${[
								s.index,
								clock(s.startMs),
								clock(s.endMs),
								seconds(s.endMs - s.startMs),
								s.mode,
								`${(s.dominance * 100).toFixed(0)}%`,
							].join(' | ')} |`,
					),
					'',
					`Totals: ${modeTotals(segments, analysis.durationMs).join(' · ')}`,
					'',
				);
				console.error(`${code} #${fight.id} ${fight.name}: ${segments.length} segments`);
			}
		}

		// `ApiCredits`, not a number: the last reading the client saw, so a reader can tell a run that ran
		// out of budget from one that simply found nothing.
		if (credits) {
			lines.push(
				'---',
				'',
				`WarcraftLogs points when this ran: ${credits.spent.toFixed(0)} spent of ${credits.limit}, ${(credits.limit - credits.spent).toFixed(0)} left.`,
				'',
			);
		}

		writeFileSync(opts.out, lines.join('\n'));
		console.error(`\nwrote ${opts.out}`);
	} finally {
		await server.close();
	}
}

main().catch((error) => {
	console.error(error.message ?? error);
	process.exitCode = 1;
});
