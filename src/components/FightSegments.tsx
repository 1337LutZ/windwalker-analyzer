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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Tooltip } from '@base-ui/react/tooltip';

import SessionProvider from './auth/SessionProvider';
import SignInPanel from './auth/SignInPanel';
import { useSession } from '~/lib/auth';
import SegmentStrip, { KEY_ORDER, segmentLabel, segmentLength } from './sections/SegmentStrip';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
	DataGrid,
	NavLink,
	Note,
	Prose,
	Section,
	Skeleton,
	StatTile,
	StatTiles,
	type GridColumn,
	type GridRow,
} from './primitives';
import { useCurrentAnchor } from '~/hooks/useCurrentAnchor';
import { formatClock, formatPercentValue, formatSeconds } from '~/lib/format';
import { SPECS } from '~/lib/spec';
import { fetchFightDataset, listReportFights } from '~/lib/wcl/fetchFight';
import { WclClient } from '~/lib/wcl/client';
import type { Analysis, FightDataset } from '~/lib/types';
import { instanceKey } from '~/lib/events/guards';
import type { FightSegment, SegmentMode } from '~/lib/analysis/segments';
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
 * **The bracketed number is a count of damage events, not damage dealt**, and the row is labelled `hits`
 * for that reason. Hits are what `targetCounts` reads to decide how many enemies were being fought, so
 * this is the evidence for the mode beside it: a segment reading `aoe` on three enemies with four hits
 * each is a different finding from one with forty, and neither is a claim about damage. Damage dealt is
 * the more interesting number for a different question and the wrong one for this.
 *
 * **Which is why an `idle` segment can still name an enemy, and that is not a contradiction.** The mode
 * comes from a count series taken over a trailing window and then held to a floor and a hysteresis; this
 * is the raw hits inside the bounds. A stretch with one hit at its edge reads idle by the derivation and
 * lists that one enemy here, and the pair is the most informative thing on the row — it is the evidence
 * for why the span went the way it did.
 */
export function targetsInSegments(dataset: FightDataset, segments: readonly FightSegment[]): Map<number, string> {
	const names = new Map((dataset.actors ?? []).map((actor) => [actor.id, actor.name]));
	/**
	 * Tallied per **spawn**, not per actor id.
	 *
	 * WarcraftLogs gives one actor id to an NPC *type*, so every Congealed Sha in a pull arrives as the
	 * same `targetID` and they are told apart only by `targetInstance` — the distinction `instanceKey`
	 * exists for and the one this file has to keep, or a roster reads "Congealed Sha (127)" where three
	 * separate adds took forty each. Counting them apart is also what makes the tally agree with the
	 * target *count* beside it: a segment reading `aoe` on three copies of one add would otherwise name a
	 * single enemy.
	 */
	const tally = new Map<number, Map<string, { id: number; instance: number | undefined; hits: number }>>();
	/** Every instance seen per actor id, so a name is only numbered when there is more than one to tell apart. */
	const spawns = new Map<number, Set<number | undefined>>();
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
		(spawns.get(target) ?? spawns.set(target, new Set()).get(target)!).add(event.targetInstance);
		const bucket = tally.get(segment.index) ?? new Map();
		const key = instanceKey(target, event.targetInstance);
		const seen = bucket.get(key);
		if (seen) seen.hits += 1;
		else bucket.set(key, { id: target, instance: event.targetInstance, hits: 1 });
		tally.set(segment.index, bucket);
	}

	/**
	 * The name a spawn is shown under, numbered by WarcraftLogs' own index where the name is ambiguous.
	 *
	 * **Only when there is something to disambiguate.** A boss is one spawn and reads as its plain name;
	 * numbering it would be answering a question nobody asked. The count is taken across the whole pull
	 * rather than the segment, so a given add is "Congealed Sha #3" wherever it appears — a label that
	 * changed between two rows of the same table would be worse than no label.
	 */
	const label = (id: number, instance: number | undefined): string => {
		const name = names.get(id) ?? `Enemy ${id}`;
		const copies = spawns.get(id);
		return copies && copies.size > 1 && instance !== undefined ? `${name} #${instance}` : name;
	};

	return new Map(
		[...tally].map(([index, bucket]) => [
			index,
			// Newline separated, and therefore comma-free: every surface that shows this puts one name per
			// line, so a separator between them would be punctuation with nothing to separate.
			[...bucket.values()]
				.sort((a, b) => b.hits - a.hits)
				.map((spawn) => `${label(spawn.id, spawn.instance)} (${spawn.hits})`)
				.join('\n'),
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

/**
 * The form, mirrored into the address bar — so a refresh, a bookmark or a link to a colleague comes
 * back to the same reports and the same player instead of an empty form.
 *
 * Only what was typed. **Never the token**, for the reason `useReportUrlState` states at length: a URL is
 * the most leaked string in a browser, landing in history, in bookmarks, in a screenshot of the address
 * bar and in the next request's `Referer`. Report codes and a character name are public log identifiers
 * and belong there; the token lives in session storage and stays there.
 */
export function readParams(search: string): { reports: string; player: string } {
	const params = new URLSearchParams(search);
	return { reports: params.get('reports') ?? '', player: params.get('player') ?? '' };
}

/**
 * The href this form should be reachable at, with empty fields dropped rather than written blank.
 *
 * A parameter carrying nothing is worse than no parameter: it survives a copy-paste and looks like an
 * answer. Built off the current href so anything else in the query — a future flag, an anchor — survives
 * a run rather than being quietly dropped.
 */
export function nextHref(href: string, form: { reports: string; player: string }): string {
	const url = new URL(href);
	for (const [key, value] of Object.entries(form)) {
		if (value.trim().length > 0) url.searchParams.set(key, value.trim());
		else url.searchParams.delete(key);
	}
	return url.toString();
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
 * The enemies cell: a button that opens the same tooltip its bar does.
 *
 * A button rather than the names inline, because a busy segment names a dozen enemies and a cell that
 * wide pushes every other column off the screen. The count on the face means the row still says
 * something without hovering — a reader scanning for "which stretch had four things in it" never has to.
 *
 * **The content matches the strip's, deliberately.** Hovering a bar and then hovering the row under it is
 * one question asked twice, and two answers to it — a bare list here, a titled block there — is the page
 * disagreeing with itself. Same name for the mode, same length, same one-name-per-line roster, built from
 * the same `segmentLabel` and `segmentLength` the strip uses.
 *
 * **A real tooltip rather than a `title` attribute.** `title` waits about a second, cannot be styled,
 * never opens on keyboard focus, and on a touch screen does not open at all. Base UI's is the same
 * primitive this codebase already uses for its dialogs, menus and toolbars.
 */
function TargetsCell({
	segment,
	roster,
	t,
}: {
	segment: FightSegment;
	roster: string | undefined;
	t: TFunction<'report'>;
}) {
	if (!roster) return <span className="text-ink-3">—</span>;
	const names = roster.split('\n').filter(Boolean);
	return (
		<Tooltip.Root>
			<Tooltip.Trigger
				render={
					<button
						type="button"
						// Still announced from the button itself: the popup is only rendered while open, so a
						// label that lived solely in there would be nothing to announce.
						aria-label={`Enemies in this segment: ${names.join(', ')}`}
						className="cursor-help rounded-sm border border-line px-2 py-0.5 font-mono text-xs text-ink-2 hover:border-muted hover:text-ink"
					/>
				}
			>
				{`${names.length} enem${names.length === 1 ? 'y' : 'ies'}`}
			</Tooltip.Trigger>
			<Tooltip.Portal>
				<Tooltip.Positioner sideOffset={6}>
					<Tooltip.Popup className="min-w-52 max-w-80 rounded-sm border border-line bg-surface px-3 py-2.5 font-mono text-xs leading-relaxed text-ink shadow-lg">
						<div className="mb-1.5 font-semibold text-rune">{segmentLabel(segment, t)}</div>
						<div className="flex justify-between gap-3.5">
							<span className="text-muted">for</span>
							<span className="font-semibold">{segmentLength(segment, t)}</span>
						</div>
						{/* The label rides the first line only, so the rest read as continuations of it rather
						    than as new facts — the same shape the strip's tooltip takes. */}
						{names.map((name, i) => (
							<div key={name} className="flex justify-between gap-3.5">
								<span className="text-muted">{i === 0 ? 'hits' : ''}</span>
								<span className="text-right font-semibold">{name}</span>
							</div>
						))}
					</Tooltip.Popup>
				</Tooltip.Positioner>
			</Tooltip.Portal>
		</Tooltip.Root>
	);
}

function rowsOf(analysis: Analysis, targets: Map<number, string>, t: TFunction<'report'>): GridRow[] {
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
			targets: <TargetsCell segment={segment} roster={targets.get(segment.index)} t={t} />,
		},
	}));
}

/** The anchor a fight is reached at, shared by the nav and the heading so neither can invent one. */
const anchorOf = (code: string, fightID: number): string => `fight-${code}-${fightID}`;

/**
 * How the pull divided, as one row of tiles.
 *
 * **The question the strip answers in shape, answered in numbers.** A reader looking at a bar can see
 * that a pull was mostly busy; they cannot see whether that was 43% or 61% without measuring it against
 * the axis, and comparing two encounters that way is guesswork. The tiles make that comparison possible,
 * which is why they sit above the strip rather than under it.
 *
 * **Over the segments' own total rather than `durationMs`.** Segments tile the pull, so the two agree to
 * within a rounding — but only the first makes the shares sum to a hundred, and a split that does not is
 * one a reader will sit and re-add.
 *
 * Only the modes this pull actually held, which is the rule the chart's key already follows: a tile for a
 * bar the reader cannot find is a tile they will go looking for.
 */
function ModeSplit({ analysis, t }: { analysis: Analysis; t: TFunction<'report'> }) {
	const segments = analysis.segments?.segments ?? [];
	if (segments.length === 0) return null;
	const held = new Map<SegmentMode, number>();
	for (const segment of segments) {
		held.set(segment.mode, (held.get(segment.mode) ?? 0) + (segment.endMs - segment.startMs));
	}
	const total = [...held.values()].reduce((sum, ms) => sum + ms, 0);
	if (total <= 0) return null;
	const present = KEY_ORDER.filter((mode) => held.has(mode));

	return (
		<StatTiles>
			{present.map((mode) => {
				const ms = held.get(mode) ?? 0;
				return (
					<StatTile
						key={mode}
						value={formatPercentValue((ms / total) * 100)}
						label={t('summary.shape.row', { context: mode })}
						// The clock behind the share, so a tile is a length as well as a proportion: 12% of a
						// three-minute pull and 12% of a seven-minute one are not the same finding.
						caption={formatSeconds(ms)}
					/>
				);
			})}
		</StatTiles>
	);
}

function Fight({ code, fight }: { code: string; fight: FightRow }) {
	const { t } = useTranslation('report');
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
			<ModeSplit analysis={analysis} t={t} />
			{/* Hoverable here and nowhere else: a roster can name twenty-two adds, and a tip that follows the
			    pointer cannot be moved onto to read them — reaching for it moves it. */}
			<SegmentStrip
				analysis={analysis}
				interactive
				detailOf={(segment) => fight.targets.get(segment.index) ?? 'no enemies hit'}
			/>
			<DataGrid
				caption={`Segments of ${fight.name}`}
				columns={COLUMNS}
				rows={rowsOf(analysis, fight.targets, t)}
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
	const anchors = reports.flatMap((report) => report.fights.map((fight) => anchorOf(report.code, fight.id)));
	// The rail's highlight, from the shared observer. It rebuilds as the discovery pass fills the rail in,
	// so every heading that exists is watched.
	const [current] = useCurrentAnchor(anchors);

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
								// Not a `NavLink`: there is nothing to jump to yet. Same rule, same indent, same
								// spinner, so it sits in the column the pulls will fill rather than beside it.
								<li className="flex min-h-11 items-center gap-2 border-l-2 border-line py-2 pr-2 pl-6 leading-snug text-muted">
									<span className="min-w-0 flex-1">reading…</span>
									<svg
										aria-hidden="true"
										viewBox="0 0 16 16"
										className="size-3 shrink-0 animate-spin text-ink-3 motion-reduce:animate-none"
									>
										<circle
											cx="8"
											cy="8"
											r="6"
											fill="none"
											stroke="currentColor"
											strokeOpacity="0.25"
											strokeWidth="2"
										/>
										<path
											d="M14 8a6 6 0 0 0-6-6"
											fill="none"
											stroke="currentColor"
											strokeWidth="2"
											strokeLinecap="round"
										/>
									</svg>
								</li>
							) : null}
							{report.fights.map((fight) => (
								<li key={fight.id}>
									{/* A pull still being read is still a place to jump to — its heading is already in the
									    document — so it stays a link and shows a spinner rather than going inert. */}
									<NavLink
										href={`#${anchorOf(report.code, fight.id)}`}
										current={current === anchorOf(report.code, fight.id)}
										indented
										pending={isPending(fight)}
									>
										{fight.name}
									</NavLink>
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
	/**
	 * Read once, on mount, rather than in a lazy state initialiser.
	 *
	 * The island is prerendered, so `window` does not exist when the initialiser would run — the same
	 * constraint `SessionProvider` works under, and the same answer.
	 *
	 * **The form is filled, not submitted.** The report page auto-runs from its URL because a complete
	 * selection there is one pull; a link here can name five reports and seventy kills, and spending that
	 * much of somebody's API budget because they opened a bookmark is not a decision a page should make
	 * for them. The button is one press away and now says how many reports it would read.
	 */
	useEffect(() => {
		const params = readParams(window.location.search);
		if (params.reports) setInput(params.reports);
		if (params.player) setPlayer(params.player);
	}, []);
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
		// Written at the run rather than on every keystroke: the address bar should describe a reading that
		// was actually asked for, and a `replaceState` per character is a lot of noise for a half-typed code.
		// `replaceState`, not `pushState`, for the reason `useReportUrlState` gives — filling a form is not
		// navigation, and pushing would bury whatever the reader arrived from.
		window.history.replaceState(null, '', nextHref(window.location.href, { reports: input, player }));
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
	}, [codesKey, input, player, token]);

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
				{/*
				 * One provider for the page, opening on contact.
				 *
				 * **`delay={0}` because the strip's tooltip has none.** The two now say the same thing about
				 * the same segment, so a reader moving between the bar and the row under it should not find
				 * one instant and the other hesitant. Base UI's default groups its delays — the first tooltip
				 * waits it out and the next few open at once — which is why the pause showed up *sometimes*
				 * and not every time, the hardest kind of lag to trust.
				 *
				 * The pause is what a tooltip normally buys: it stops labels flashing at a pointer merely
				 * crossing the page. These are cells in a table a reader is already scanning deliberately,
				 * and the trigger is a button rather than the whole row, so there is nothing to cross by
				 * accident.
				 */}
				<Tooltip.Provider delay={0}>
					<Gate />
				</Tooltip.Provider>
			</SessionProvider>
		</QueryClientProvider>
	);
}
