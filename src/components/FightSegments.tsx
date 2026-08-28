// The segment derivation, read across whole reports rather than one pull at a time.
//
// **Why this page exists.** Segments are the thing every banded metric rests on — which rung of the
// priority list a stretch is judged against — and until now the only way to see one was to open a single
// pull. That is the wrong shape for the question they are usually asked about: whether the derivation
// agrees with what an encounter actually did. That question is about a raid night, so this takes a list
// of reports and walks every kill in them.
//
// **Unlisted on purpose.** Nothing links here. It reads a whole report's worth of pulls, which costs real
// API budget, and it is a tool for checking the engine rather than a page for reading a parse.
//
// It reuses the report page's own pieces throughout — the session, the fetch, the analysis, and
// `SegmentStrip` for the drawing. A second copy of any of them would be a second thing to drift.

import { useCallback, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import SessionProvider from './auth/SessionProvider';
import SignInPanel from './auth/SignInPanel';
import { useSession } from '~/lib/auth';
import SegmentStrip from './sections/SegmentStrip';
import { DataGrid, Note, Prose, Section, type GridColumn, type GridRow } from './primitives';
import { formatClock } from '~/lib/format';
import { SPECS } from '~/lib/spec';
import { fetchFightDataset, listReportFights } from '~/lib/wcl/fetchFight';
import { WclClient } from '~/lib/wcl/client';
import type { Analysis, FightDataset } from '~/lib/types';
import type { FightSegment } from '~/lib/analysis/segments';
import '~/lib/i18n';

/**
 * Which enemies a segment was spent on, and how many hits each took.
 *
 * **Computed here rather than read off the analysis, because the analysis does not carry it.**
 * `TargetSummary` publishes the count *curves* — how many enemies at each moment — and never which ones;
 * `landedHits` knows, and stays inside the engine. The page is the one place still holding the dataset the
 * analysis came from, so it is the only place that can answer without widening a published type for a
 * tool nothing else uses.
 *
 * Off the player's own damage: the same evidence the count series is built from, so a segment that reads
 * `aoe` lists the three enemies that made it so. Ticks and pets included exactly as they arrive — this is
 * a roster for a tooltip, not a second derivation to disagree with the first.
 */
export function targetsInSegments(dataset: FightDataset, segments: readonly FightSegment[]): Map<number, string> {
	const names = new Map((dataset.actors ?? []).map((actor) => [actor.id, actor.name]));
	const tally = new Map<number, Map<number, number>>();
	const t0 = dataset.fight.startTime;
	const sourceID = dataset.actor?.id;
	for (const event of dataset.events) {
		if (event.type !== 'damage' || event.sourceID !== sourceID) continue;
		const target = event.targetID;
		if (target === undefined) continue;
		const at = event.timestamp - t0;
		// Linear rather than a search: a pull holds a handful of segments, and the walk is over events.
		const segment = segments.find((candidate) => at >= candidate.startMs && at < candidate.endMs);
		if (segment === undefined) continue;
		const bucket = tally.get(segment.index) ?? new Map<number, number>();
		bucket.set(target, (bucket.get(target) ?? 0) + 1);
		tally.set(segment.index, bucket);
	}
	return new Map(
		[...tally].map(([index, bucket]) => [
			index,
			[...bucket]
				.sort((a, b) => b[1] - a[1])
				.map(([id, hits]) => `${names.get(id) ?? `#${id}`} (${hits})`)
				.join(', '),
		]),
	);
}

/** One kill, once it has been fetched and read — or the reason it could not be. */
interface FightRow {
	id: number;
	name: string;
	durationMs: number;
	analysis: Analysis | null;
	specName: string | null;
	/** Segment index to the enemies it was spent on, ready for a tooltip. */
	targets: Map<number, string>;
	error: string | null;
}

interface ReportRows {
	code: string;
	fights: FightRow[];
	error: string | null;
}

/**
 * A report code, or the code out of a pasted WarcraftLogs URL.
 *
 * People paste both, and a comma-separated field invites pasting several at once. Splitting on commas
 * *and* whitespace means a list copied out of a spreadsheet works as well as one typed by hand.
 */
export function parseCodes(input: string): string[] {
	return [
		...new Set(
			input
				.split(/[\s,]+/)
				.map((part) => part.trim())
				.filter(Boolean)
				.map((part) => /reports\/([A-Za-z0-9:]+)/.exec(part)?.[1] ?? part),
		),
	];
}

const COLUMNS: GridColumn[] = [
	{ key: 'index', label: '#', align: 'right', width: '56px' },
	{ key: 'from', label: 'from', width: '104px' },
	{ key: 'to', label: 'to', width: '104px' },
	{ key: 'length', label: 'length', align: 'right', width: '96px' },
	{ key: 'mode', label: 'mode', width: '96px' },
	{ key: 'dominance', label: 'dominance', align: 'right', width: '110px' },
	{ key: 'targets', label: 'targets', width: '120px' },
];

/**
 * The enemies cell: a button whose tooltip is the roster.
 *
 * A button rather than the names inline, because a busy segment names a dozen enemies and a table cell
 * that wide pushes every other column off the screen. `title` carries it on hover, and the count on the
 * face means the cell still says something without one — a reader scanning for "which stretch had four
 * things in it" does not have to hover at all.
 */
function TargetsCell({ roster }: { roster: string | undefined }) {
	if (!roster) return <span className="text-ink-3">—</span>;
	const count = roster.split(', ').length;
	return (
		<button
			type="button"
			title={roster}
			aria-label={`Enemies in this segment: ${roster}`}
			className="cursor-help rounded-sm border border-line px-2 py-0.5 font-mono text-xs text-ink-2"
		>
			{`${count} enem${count === 1 ? 'y' : 'ies'}`}
		</button>
	);
}

function rowsOf(analysis: Analysis, targets: Map<number, string>): GridRow[] {
	return (analysis.segments?.segments ?? []).map((segment) => ({
		key: `${segment.index}`,
		// The one mode that is not a count gets the warn band, because it is the row a reader scanning for
		// "why was this stretch judged that way" is looking for.
		...(segment.mode === 'mixed' ? { band: 'warn' as const } : {}),
		cells: {
			index: `${segment.index}`,
			from: formatClock(segment.startMs),
			to: formatClock(segment.endMs),
			length: `${((segment.endMs - segment.startMs) / 1000).toFixed(1)}s`,
			mode: segment.mode,
			dominance: `${Math.round(segment.dominance * 100)}%`,
			targets: <TargetsCell roster={targets.get(segment.index)} />,
		},
	}));
}

function Fight({ fight }: { fight: FightRow }) {
	if (fight.error !== null) {
		return (
			<div className="flex flex-col gap-2">
				<h3 className="font-mono text-sm text-ink">{`${fight.id} · ${fight.name}`}</h3>
				<Note>{fight.error}</Note>
			</div>
		);
	}
	const analysis = fight.analysis;
	if (analysis === null) return null;
	const segments = analysis.segments?.segments ?? [];

	return (
		<div className="flex flex-col gap-3.5">
			<h3 className="font-mono text-sm text-ink">
				{`${fight.id} · ${fight.name}`}
				<span className="ml-2 text-ink-3">
					{`${formatClock(fight.durationMs)} · ${fight.specName ?? 'unread'} · ${segments.length} segment${segments.length === 1 ? '' : 's'}`}
				</span>
			</h3>
			{/* `SegmentStrip` draws nothing for a pull it cannot divide — under two segments there is no
			    shape to show — so the table below is what carries such a pull. */}
			<SegmentStrip analysis={analysis} detailOf={(segment) => fight.targets.get(segment.index)} />
			<DataGrid
				caption={`Segments of ${fight.name}`}
				columns={COLUMNS}
				rows={rowsOf(analysis, fight.targets)}
				empty="This pull produced no contact the derivation could divide."
			/>
		</div>
	);
}

/**
 * A fresh copy of the walk so far, down to the fight arrays.
 *
 * React compares by identity, and the walk mutates the objects it is building — so handing the same
 * references back would render once at the start and never again. Copying a report's `fights` as well as
 * the list is what makes a pull appear as it lands rather than when the whole report finishes.
 */
const snapshot = (reports: readonly ReportRows[]): ReportRows[] =>
	reports.map((entry) => ({ ...entry, fights: [...entry.fights] }));

function Runner() {
	const { token } = useSession();
	const [input, setInput] = useState('');
	const [player, setPlayer] = useState('');
	const [busy, setBusy] = useState(false);
	const [progress, setProgress] = useState<string | null>(null);
	const [reports, setReports] = useState<ReportRows[]>([]);

	const codes = useMemo(() => parseCodes(input), [input]);
	// The list is rebuilt on every keystroke, so the run callback depends on its content rather than its
	// identity — otherwise it is a new function per character typed.
	const codesKey = codes.join(',');
	const ready = token !== null && codes.length > 0 && player.trim().length > 0 && !busy;

	const run = useCallback(async () => {
		if (token === null) return;
		setBusy(true);
		setReports([]);
		const name = player.trim();
		const client = new WclClient({ token });
		const out: ReportRows[] = [];
		try {
			for (const code of codes) {
				setProgress(`Reading ${code}…`);
				const report: ReportRows = { code, fights: [], error: null };
				out.push(report);
				try {
					const list = await listReportFights(client, code);
					const mine = list.fights.filter(
						(fight) =>
							fight.kill && (fight.roster ?? []).some((actor) => actor.name.toLowerCase() === name.toLowerCase()),
					);
					if (mine.length === 0) {
						report.error = `No kills in this report have ${name} in them.`;
					}
					for (const fight of mine) {
						setProgress(`${code} · ${fight.name}…`);
						const row: FightRow = {
							id: fight.id,
							name: fight.name,
							durationMs: fight.endTime - fight.startTime,
							analysis: null,
							specName: null,
							targets: new Map<number, string>(),
							error: null,
						};
						report.fights.push(row);
						try {
							const dataset = await fetchFightDataset(client, { code, fightID: fight.id, playerName: name });
							// The spec the pull reads as. Every spec runs the same core, so segments would exist
							// whichever was used — but the target-count exclusions belong to the spec, and the wrong
							// one would quietly change them.
							const spec = SPECS.map((candidate) => ({ candidate, result: candidate.analyse(dataset) })).find(
								(pair) => pair.result.isSpec,
							);
							if (spec === undefined) {
								row.error = 'No registered spec recognised this pull.';
							} else {
								row.analysis = spec.result;
								row.specName = spec.candidate.specName;
								row.targets = targetsInSegments(dataset, spec.result.segments?.segments ?? []);
							}
						} catch (error) {
							row.error = error instanceof Error ? error.message : String(error);
						}
						// Published as the walk goes, so a long report shows its early pulls rather than nothing.
						setReports(snapshot(out));
					}
				} catch (error) {
					report.error = error instanceof Error ? error.message : String(error);
				}
				setReports(snapshot(out));
			}
		} finally {
			setBusy(false);
			setProgress(null);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [codesKey, player, token]);

	return (
		<div className="flex flex-col gap-6">
			<Section id="fight-segments" title="Fight segments">
				<Prose>
					Every kill in the reports below, divided into segments the way the analyser divides them — one stretch of the
					pull per target-count mode, after the floor and the hysteresis have had their say. Segments are a reading of
					one player’s contact, so a name is required.
				</Prose>
				<div className="mt-4.5 flex flex-col gap-3">
					<label className="flex flex-col gap-1.5">
						<span className="font-mono text-xs tracking-wider text-ink-3 uppercase">Reports</span>
						<textarea
							value={input}
							onChange={(event) => setInput(event.target.value)}
							rows={3}
							spellCheck={false}
							placeholder="codes or URLs, separated by commas"
							className="w-full rounded-sm border border-line bg-surface p-3 font-mono text-sm text-ink"
						/>
					</label>
					<label className="flex flex-col gap-1.5">
						<span className="font-mono text-xs tracking-wider text-ink-3 uppercase">Player</span>
						<input
							value={player}
							onChange={(event) => setPlayer(event.target.value)}
							spellCheck={false}
							className="w-full rounded-sm border border-line bg-surface p-3 font-mono text-sm text-ink"
						/>
					</label>
					<div className="flex items-center gap-3">
						<button
							type="button"
							disabled={!ready}
							onClick={() => void run()}
							className="rounded-sm border border-line bg-surface px-4 py-2 font-mono text-sm text-ink disabled:opacity-50"
						>
							{busy ? 'Reading…' : `Read ${codes.length || ''} report${codes.length === 1 ? '' : 's'}`.trim()}
						</button>
						{progress !== null ? <span className="font-mono text-xs text-ink-3">{progress}</span> : null}
					</div>
				</div>
			</Section>

			{reports.map((report) => (
				<Section key={report.code} id={`report-${report.code}`} title={report.code}>
					{report.error !== null ? <Note>{report.error}</Note> : null}
					<div className="mt-4.5 flex flex-col gap-8">
						{report.fights.map((fight) => (
							<Fight key={fight.id} fight={fight} />
						))}
					</div>
				</Section>
			))}
		</div>
	);
}

function Gate() {
	const { token } = useSession();
	return token === null ? <SignInPanel /> : <Runner />;
}

export default function FightSegments() {
	const [queryClient] = useState(() => new QueryClient());
	return (
		<QueryClientProvider client={queryClient}>
			<SessionProvider>
				<Gate />
			</SessionProvider>
		</QueryClientProvider>
	);
}
