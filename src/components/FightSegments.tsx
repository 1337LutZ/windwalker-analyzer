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
import { Tooltip } from '@base-ui/react/tooltip';

import SessionProvider from './auth/SessionProvider';
import SignInPanel from './auth/SignInPanel';
import { useSession } from '~/lib/auth';
import SegmentStrip from './sections/SegmentStrip';
import { DataGrid, Note, Prose, Section, Skeleton, type GridColumn, type GridRow } from './primitives';
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
 *
 * **Which is why an `idle` segment can still name an enemy, and that is not a contradiction.** The mode
 * comes from a count series taken over a trailing window and then held to a floor and a hysteresis; this
 * is the raw hits inside the bounds. A stretch with one hit at its edge reads idle by the derivation and
 * lists that one enemy here, and the pair is the most informative thing on the row — it is the evidence
 * for why the span went the way it did.
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
	/**
	 * True while the report's own fight list is still being fetched, before any pull is known.
	 *
	 * Distinct from a report with no fights yet *found*: one is a question still being asked and the other
	 * is an answer. The rail says "reading…" for the first and nothing for the second.
	 */
	listing: boolean;
	error: string | null;
}

/** A pull that has been named but not yet read. Derived, so it cannot disagree with the fields it reads. */
const isPending = (fight: FightRow): boolean => fight.analysis === null && fight.error === null;

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
 * The enemies cell: a button that opens the roster on hover or focus.
 *
 * A button rather than the names inline, because a busy segment names a dozen enemies and a cell that
 * wide pushes every other column off the screen. The count on the face means the row still says
 * something without hovering — a reader scanning for "which stretch had four things in it" never has to.
 *
 * **A real tooltip rather than a `title` attribute.** `title` is the browser's own: it waits about a
 * second, cannot be styled, never opens on keyboard focus, and on a touch screen does not open at all.
 * Base UI's is the same primitive this codebase already uses for its dialogs, menus and toolbars, and it
 * answers a pointer and a focus ring alike.
 */
function TargetsCell({ roster }: { roster: string | undefined }) {
	if (!roster) return <span className="text-ink-3">—</span>;
	const count = roster.split(', ').length;
	return (
		<Tooltip.Root>
			<Tooltip.Trigger
				render={
					<button
						type="button"
						// Still announced to a screen reader from the button itself: the popup is only rendered
						// while open, so a label that lived solely in there would be nothing to announce.
						aria-label={`Enemies in this segment: ${roster}`}
						className="cursor-help rounded-sm border border-line px-2 py-0.5 font-mono text-xs text-ink-2 hover:border-muted hover:text-ink"
					/>
				}
			>
				{`${count} enem${count === 1 ? 'y' : 'ies'}`}
			</Tooltip.Trigger>
			<Tooltip.Portal>
				<Tooltip.Positioner sideOffset={6}>
					<Tooltip.Popup className="max-w-80 rounded-sm border border-line bg-surface px-3 py-2 font-mono text-xs leading-relaxed text-ink shadow-lg">
						{roster}
					</Tooltip.Popup>
				</Tooltip.Positioner>
			</Tooltip.Portal>
		</Tooltip.Root>
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

/** The anchor a fight is reached at, shared by the nav and the heading so neither can invent one. */
const anchorOf = (code: string, fightID: number): string => `fight-${code}-${fightID}`;

function Fight({ code, fight }: { code: string; fight: FightRow }) {
	if (fight.error !== null) {
		return (
			<div id={anchorOf(code, fight.id)} className="flex scroll-mt-16 flex-col gap-2">
				<h3 className="font-mono text-sm text-ink">{`${fight.id} · ${fight.name}`}</h3>
				<Note>{fight.error}</Note>
			</div>
		);
	}
	if (isPending(fight)) {
		return (
			<div id={anchorOf(code, fight.id)} className="flex scroll-mt-16 flex-col gap-3.5">
				<h3 className="font-mono text-sm text-ink">
					{`${fight.id} · ${fight.name}`}
					<span className="ml-2 animate-pulse text-ink-3">reading…</span>
				</h3>
				{/* Shaped like what is coming — a strip, then a table — so the page does not resize under the
				    reader when it lands. The heights are the drawn ones: `SegmentLane` is `h-9`. */}
				<Skeleton className="h-9 w-full animate-pulse" />
				<Skeleton className="h-24 w-full animate-pulse" />
			</div>
		);
	}
	const analysis = fight.analysis;
	if (analysis === null) return null;
	const segments = analysis.segments?.segments ?? [];

	return (
		<div id={anchorOf(code, fight.id)} className="flex scroll-mt-16 flex-col gap-3.5">
			<h3 className="font-mono text-sm text-ink">
				{`${fight.id} · ${fight.name}`}
				<span className="ml-2 text-ink-3">
					{`${formatClock(fight.durationMs)} · ${fight.specName ?? 'unread'} · ${segments.length} segment${segments.length === 1 ? '' : 's'}`}
				</span>
			</h3>
			{/* `SegmentStrip` draws nothing for a pull it cannot divide — under two segments there is no
			    shape to show — so the table below is what carries such a pull. */}
			{/* Always a string, never `undefined`: a bar whose tooltip silently dropped its third line looks
			    exactly like one the feature does not work on, and the two are worth telling apart. A stretch
			    with nothing in it says so. */}
			<SegmentStrip analysis={analysis} detailOf={(segment) => fight.targets.get(segment.index) ?? 'no enemies hit'} />
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

/**
 * The reports and their kills, as a sticky rail.
 *
 * **Not `SectionNav`**, which is the tempting reuse and the wrong one: that component is built on
 * `ReportSection` — an id, a translation key and one of four declared groups — and everything here is a
 * report code or a boss name that no translation file knows. Forcing these through it would mean
 * inventing keys for data that arrives at runtime. The look is matched instead: the same rule, the same
 * indent for a child, the same sticky column the report page puts its nav in.
 *
 * Hidden below `lg` for the same reason the report's nav is. On a narrow screen the rail costs more width
 * than the jump is worth, and the headings are still in the document to scroll to.
 */
function ReportNav({ reports }: { reports: readonly ReportRows[] }) {
	if (reports.length === 0) return null;
	return (
		<nav
			aria-label="Reports and fights"
			// `self-start` is load-bearing: stretched to the row's height there would be no room left to
			// travel and `sticky` would do nothing. Same note as `SectionNav`, same reason.
			className="hidden lg:sticky lg:top-14 lg:block lg:max-h-[calc(100vh_-_5rem)] lg:self-start lg:overflow-y-auto"
		>
			<ol className="m-0 flex list-none flex-col p-0">
				{reports.map((report) => (
					<li key={report.code}>
						<a
							href={`#report-${report.code}-heading`}
							className="flex min-h-11 items-center border-l-2 border-line py-2 pr-2 pl-3 font-mono text-sm font-semibold tracking-[0.1em] text-muted uppercase transition-colors hover:border-muted hover:text-ink-2"
						>
							{report.code}
						</a>
						<ol className="m-0 flex list-none flex-col p-0">
							{report.listing ? (
								<li className="flex min-h-11 animate-pulse items-center border-l-2 border-line py-2 pr-2 pl-6 leading-snug text-ink-3">
									reading…
								</li>
							) : null}
							{report.fights.map((fight) => (
								<li key={fight.id}>
									<a
										href={`#${anchorOf(report.code, fight.id)}`}
										// A pull still being read is still a place to jump to — the heading is already in
										// the document — so it stays a link and says what it is rather than going inert.
										className={`flex min-h-11 items-center border-l-2 border-line py-2 pr-2 pl-6 leading-snug transition-colors hover:border-muted hover:text-ink-2 ${
											isPending(fight) ? 'animate-pulse text-ink-3' : 'text-muted'
										}`}
									>
										{fight.name}
									</a>
								</li>
							))}
						</ol>
					</li>
				))}
			</ol>
		</nav>
	);
}

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

	/**
	 * Two passes, and the split is the whole shape of the loading state.
	 *
	 * **Discovery first, for every report, before a single pull is read.** Listing a report's fights is one
	 * cheap call; reading a pull is a full event stream and an analysis. Interleaving them meant the second
	 * report's kills did not exist on the page until the first report had been read end to end — so the
	 * rail grew a few entries at a time and never told a reader how much was coming. Now the skeleton is
	 * complete before the expensive pass starts: every report, every kill, every one of them named and
	 * marked pending.
	 *
	 * The reading pass then walks the whole set in order, publishing after each pull. Each pass yields to
	 * the browser between items, because an analysis is a long synchronous block and React cannot paint the
	 * row it has just been handed while one is running.
	 */
	const run = useCallback(async () => {
		if (token === null) return;
		setBusy(true);
		const name = player.trim();
		const client = new WclClient({ token });
		// Every report is on the page from the first frame, listing, so the rail has its full height at once.
		const out: ReportRows[] = codes.map((code) => ({ code, fights: [], listing: true, error: null }));
		setReports(snapshot(out));
		const breathe = () => new Promise((resolve) => setTimeout(resolve, 0));

		try {
			for (const report of out) {
				setProgress(`Listing ${report.code}…`);
				try {
					const list = await listReportFights(client, report.code);
					const mine = list.fights.filter(
						(fight) =>
							fight.kill && (fight.roster ?? []).some((actor) => actor.name.toLowerCase() === name.toLowerCase()),
					);
					report.fights = mine.map((fight) => ({
						id: fight.id,
						name: fight.name,
						durationMs: fight.endTime - fight.startTime,
						analysis: null,
						specName: null,
						targets: new Map<number, string>(),
						error: null,
					}));
					if (mine.length === 0) report.error = `No kills in this report have ${name} in them.`;
				} catch (error) {
					report.error = error instanceof Error ? error.message : String(error);
				}
				report.listing = false;
				setReports(snapshot(out));
				await breathe();
			}

			const total = out.reduce((sum, report) => sum + report.fights.length, 0);
			let read = 0;
			for (const report of out) {
				for (const fight of report.fights) {
					read += 1;
					setProgress(`${report.code} · ${fight.name} · ${read} of ${total}`);
					try {
						const dataset = await fetchFightDataset(client, {
							code: report.code,
							fightID: fight.id,
							playerName: name,
						});
						// The spec the pull reads as. Every spec runs the same core, so segments would exist
						// whichever was used — but the target-count exclusions belong to the spec, and the wrong
						// one would quietly change them.
						const spec = SPECS.map((candidate) => ({ candidate, result: candidate.analyse(dataset) })).find(
							(pair) => pair.result.isSpec,
						);
						if (spec === undefined) {
							fight.error = 'No registered spec recognised this pull.';
						} else {
							fight.analysis = spec.result;
							fight.specName = spec.candidate.specName;
							fight.targets = targetsInSegments(dataset, spec.result.segments?.segments ?? []);
						}
					} catch (error) {
						fight.error = error instanceof Error ? error.message : String(error);
					}
					setReports(snapshot(out));
					await breathe();
				}
			}
		} finally {
			setBusy(false);
			setProgress(null);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [codesKey, player, token]);

	return (
		/* The rail only exists once there is something to list, and so does the column that holds it —
		   a grid whose first child is `null` puts the *content* in the 13rem track and squeezes the form
		   into a gutter. Before any results the page is one column, which is also the better shape for a
		   form nobody has filled in yet. */
		<div className={reports.length > 0 ? 'lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8' : 'flex flex-col'}>
			<ReportNav reports={reports} />
			<div className="flex flex-col gap-6">
				<Section id="fight-segments" title="Fight segments">
					<Prose>
						Every kill in the reports below, divided into segments the way the analyser divides them — one stretch of
						the pull per target-count mode, after the floor and the hysteresis have had their say. Segments are a
						reading of one player’s contact, so a name is required.
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
								<Fight key={fight.id} code={report.code} fight={fight} />
							))}
						</div>
					</Section>
				))}
			</div>
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
				{/* One provider for the page: it is what lets a second tooltip open instantly once the first
				    has, rather than each waiting out its own delay. */}
				<Tooltip.Provider>
					<Gate />
				</Tooltip.Provider>
			</SessionProvider>
		</QueryClientProvider>
	);
}
