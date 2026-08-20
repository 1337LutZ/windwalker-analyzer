import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import '~/lib/i18n';

import { useFightAnalysis, type AnalysisRequest } from '~/hooks/useFightAnalysis';
import { useSettings } from '~/hooks/useSettings';
import { shouldAutoRun, useInitialUrlSelection, useUrlSelectionWriter } from '~/hooks/useReportUrlState';
import { useFightPlayers } from '~/hooks/useFightPlayers';
import { useReportFights } from '~/hooks/useReportFights';

import type { TargetModeChoice } from '~/lib/view/targetMode';
import { DEFAULT_SPEC, getSpec } from '~/lib/spec';
import { forgetCredits } from '~/lib/wcl';

import { useSession } from '../auth';
import Report from '../Report';
import { Callout, Skeleton, Step } from '../primitives';
import { buttonClass, primaryButtonClass } from '../primitives/controls';

import FetchProgress from './FetchProgress';
import FightSelector from './FightSelector';
import PlayerSelector from './PlayerSelector';
import ReportInput from './ReportInput';
import ReportSkeleton from './ReportSkeleton';
import SettingsDialog from './SettingsDialog';
import StickySelectionBar from './StickySelectionBar';
import TargetModeControl from './TargetModeControl';
import { defaultFightID, groupByEncounter } from './encounterGroups';
import { describeFailure } from './describeFailure';
import type { ResolvedReportInput } from './parseReportInput';

/**
 * Steps two to four, and the report they produce. Step one is the sign-in above it.
 *
 * The two selections are held as *overrides* rather than as the answer — a null `chosenFightID`
 * means "whatever the picker would default to", which is what makes the default follow a newly
 * loaded report without an effect racing the render that displays it. The same trick fixes the
 * player: a name chosen on the last pull that is not in this one simply falls through to the first
 * Windwalker who is.
 *
 * The analysis is driven by an explicit request, not by the selection. Fetching a pull is several
 * round trips and a real cost against the API's hourly point budget, so nothing starts it but the
 * button — and keeping the request separate is also what leaves a finished report on screen while
 * the next pull is being lined up.
 */
export default function ReportFlow() {
	// Step labels are shell copy, so they come from the `ui` namespace, not the report's.
	const { t } = useTranslation('ui');
	const { token, signOut } = useSession();
	// A link with a report in it should land on that report rather than an empty form. The URL is read
	// once on mount and then only written to; after the first render the app's state is the truth.
	const fromUrl = useInitialUrlSelection();
	const writeUrl = useUrlSelectionWriter();
	// The spec the URL names, or the registered default when it names none. `getSpec` returns the
	// registry's own stable reference, so the identity is safe for the memos and queries below.
	const spec = getSpec(fromUrl.spec ?? '') ?? DEFAULT_SPEC;
	// The whole page's theme follows the spec: every structural colour in `global.css` is derived from
	// `--spec-primary`, so setting it recolours the page to whatever the URL named (or the build's
	// default). The build's spec is painted before first paint in `index.astro`; this is the
	// hydration-time correction for a URL that names a different one.
	useEffect(() => {
		document.documentElement.style.setProperty('--spec-primary', spec.colors.primary);
	}, [spec]);
	// The thresholds the reader owns. Held here because this is where the analysis is derived. The
	// spec's schema drives the panel; the default is the registered spec until the URL names one.
	const settingsState = useSettings(spec.settings);
	const queryClient = useQueryClient();

	const [input, setInput] = useState<ResolvedReportInput | null>(null);
	const [chosenFightID, setChosenFightID] = useState<number | null>(null);
	/**
	 * Set only when the reader picks a pull themselves.
	 *
	 * The scroll to the player step has to follow a *choice*, not a selection: the fight id also
	 * changes when a report loads and the picker defaults to the last boss, and when a shared link
	 * seeds one. Scrolling on those would yank the page while someone is still reading the fight list
	 * they have not chosen from yet.
	 */
	const [fightJustChosen, setFightJustChosen] = useState(false);
	const [chosenPlayer, setChosenPlayer] = useState<string | null>(null);
	const [request, setRequest] = useState<AnalysisRequest | null>(null);
	const [selectionOffScreen, setSelectionOffScreen] = useState(false);
	/**
	 * Which reading the report is graded at.
	 *
	 * It lives here rather than in `Report` because the control that sets it is in the sticky bar, and
	 * the bar and the report are siblings — this is the nearest thing they share. It is still view
	 * state, and everything `lib/view/targetMode` says about not making it a setting still holds: it
	 * is not persisted, it is not an input to `analyse()`, and `requestPull` below puts it back to
	 * `auto` on every new pull so a reading forced on one fight cannot follow the reader to the next.
	 * That reset used to be free — `Report` unmounts when the analysis it is showing is dropped, and
	 * took the state with it — and lifting the state is what made it something to do on purpose.
	 */
	const [targetChoice, setTargetChoice] = useState<TargetModeChoice>('auto');
	/**
	 * Whether the selection carried in the URL has already been run.
	 *
	 * A ref rather than state: it must not cause a render, and it must flip *before* the effect that
	 * reads it can run a second time. Without it, restoring a link filled the form in and then sat
	 * there — the reader saw their own report code, fight and player already chosen and still had to
	 * press the button, which is not what a shared link is for.
	 */
	const autoRan = useRef(false);
	const resultRef = useRef<HTMLDivElement | null>(null);
	const playerStepRef = useRef<HTMLElement | null>(null);
	const selectionRef = useRef<HTMLDivElement | null>(null);
	const selectionEndRef = useRef<HTMLDivElement | null>(null);

	/**
	 * Every change of what is being read, in one place — including dropping it.
	 *
	 * The reading goes back to `auto` with the pull, and that is the whole reason this exists rather
	 * than three bare `setRequest` calls: a reader who forced single target on Immerseus and then
	 * analysed Galakras would otherwise have Galakras silently graded against the single-target list.
	 * `lib/view/targetMode` names that exact failure as the reason this is not an `AnalysisSettings`;
	 * it would have arrived anyway once the state outlived the report it belongs to.
	 */
	const requestPull = useCallback((next: AnalysisRequest | null) => {
		setRequest(next);
		setTargetChoice('auto');
	}, []);

	useEffect(() => {
		if (fromUrl.code === null) return;
		setInput({
			code: fromUrl.code,
			fightID: fromUrl.fightID,
			sourceID: null,
		});
		if (fromUrl.fightID !== null) setChosenFightID(fromUrl.fightID);
		if (fromUrl.player !== null) setChosenPlayer(fromUrl.player);
	}, [fromUrl]);

	const code = input?.code ?? null;
	const fights = useReportFights(token, code);
	const groups = useMemo(() => groupByEncounter(fights.data?.fights ?? []), [fights.data]);

	const fightID = chosenFightID ?? defaultFightID(groups, input?.fightID ?? null);
	const fight = fights.data?.fights.find((candidate) => candidate.id === fightID) ?? null;

	const players = useFightPlayers(token, code, fightID, spec.classKey, spec.specName);
	// Memoised for the auto-run effect below, which depends on it. `players.data ?? []` hands back a
	// fresh array on every render while the query is in flight, so that effect woke on every render
	// until the roster arrived — harmless only because a ref stops it from firing twice.
	const roster = useMemo(() => players.data ?? [], [players.data]);
	const playerName =
		roster.find((player) => player.name === chosenPlayer)?.name ??
		roster.find((player) => player.id === input?.sourceID)?.name ??
		roster[0]?.name ??
		null;

	const {
		analysis,
		error: analysisError,
		isFetching,
		progress,
	} = useFightAnalysis(token, request, settingsState.settings, spec);

	// Signing out drops the report with it. The analysis was fetched with that credential, and leaving
	// it on screen would make "sign out" look like less than it is. The budget goes for the same
	// reason and is not part of the query cache: it is a fact about the token that just left.
	useEffect(() => {
		if (token !== null) return;
		queryClient.clear();
		forgetCredits();
		setInput(null);
		setChosenFightID(null);
		setChosenPlayer(null);
		requestPull(null);
	}, [token, queryClient, requestPull]);

	// Picking a pull is the moment the player step becomes answerable, and on a phone it sits below
	// the whole fight list. Scroll it into view rather than leaving the reader to find it.
	useEffect(() => {
		if (!fightJustChosen) return;
		setFightJustChosen(false);
		const step = playerStepRef.current;
		if (step === null) return;
		const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		step.scrollIntoView({
			behavior: reduced ? 'auto' : 'smooth',
			block: 'start',
		});
	}, [fightJustChosen]);

	// The report lands below four steps of form, which on a phone is well past the fold.
	useEffect(() => {
		if (analysis === null) return;
		const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		resultRef.current?.scrollIntoView({
			behavior: reduced ? 'auto' : 'smooth',
			block: 'start',
		});
	}, [analysis]);

	// Whether the pickers have been scrolled past, watched at a sentinel that closes the selection
	// block. An observer rather than a scroll listener: it answers only when the answer changes
	// instead of on every frame, and it stays right when something above it reflows.
	//
	// "Not intersecting" alone is the wrong question. The selection block is taller than a phone, so
	// the sentinel is off screen both when it is above the viewport — scrolled past, which is what the
	// bar is for — and when it is below it, which is someone still working through the pickers. Only
	// the first is a reason to show the bar, and the sign of `top` is what separates them.
	useEffect(() => {
		const sentinel = selectionEndRef.current;
		if (sentinel === null) return;
		const observer = new IntersectionObserver((entries) => {
			const entry = entries[entries.length - 1];
			if (entry === undefined) return;
			setSelectionOffScreen(!entry.isIntersecting && entry.boundingClientRect.top <= 0);
		});
		observer.observe(sentinel);
		return () => observer.disconnect();
	}, []);

	// Mirrored out whenever the resolved selection changes — including the defaults the pickers chose,
	// so a link copied without touching anything still reproduces what is on screen.
	useEffect(() => {
		if (code === null) return;
		writeUrl({ code, fightID, player: playerName, spec: spec.key });
	}, [code, fightID, playerName, spec, writeUrl]);

	// The tab title follows the same selection the URL does, for the same reason: several tabs are
	// how several pulls get compared, and the spec's name times four in a tab strip names none of
	// them. Only named things go in — a pull or a player that has not resolved yet would put a
	// flash of " - <spec> analyzer" ahead of the answer, and the fallbacks (the last boss, the
	// first player of the spec) are the reader's, not the link's, so they are not asserted in the
	// title either. `fight` is the resolved pull behind `fightID`, so a stale id that matches nothing
	// leaves the title alone rather than naming a fight that is not on screen.
	useEffect(() => {
		const base = `${spec.displayName} analyzer`;
		if (fight === null || playerName === null) {
			document.title = base;
			return;
		}
		document.title = `${playerName} - ${fight.name} - ${base}`;
	}, [fight, playerName, spec]);

	// A link that names a report, a pull and a player is a request for that report, so run it. Once,
	// and only for the selection the URL supplied: after that the reader is driving, and re-running on
	// every change would refetch a pull per click.
	useEffect(() => {
		const ready = shouldAutoRun({
			fromUrl: fromUrl.code !== null,
			alreadyRan: autoRan.current,
			signedIn: token !== null,
			code,
			fightID,
			// The name the *link* asked for, not the one the picker settled on. `playerName` has already
			// fallen back to the first player of the spec in the pull, so handing that over asks the
			// roster whether it contains someone it just supplied — a guard that can never fail. A link
			// naming someone who was not in this pull has to stop here and leave the form for the
			// reader, rather than quietly spending a full event fetch on a different player and then
			// rewriting the URL to name them.
			playerName: fromUrl.player ?? playerName,
			roster: roster.map((player) => player.name),
		});
		if (!ready || code === null || fightID === null || playerName === null) return;
		autoRan.current = true;
		requestPull({ code, fightID, playerName });
	}, [fromUrl.code, fromUrl.player, token, code, fightID, playerName, roster, requestPull]);

	const signedIn = token !== null;
	const loaded = fights.data !== undefined;
	const hasFights = groups.length > 0;
	// Whether there is a reading to choose between: a report that was graded. Not the skeleton, which is
	// not a report yet, and not the wrong-spec refusal, which has nothing to grade either way. One
	// condition and two consumers below — the block above the sentinel and the bar's switches — because
	// the two must never disagree about whether the control exists at all.
	const gradeable = analysis !== null && analysis.isSpec;

	/**
	 * Drops everything that belonged to the previous report: the two picks and the analysis itself.
	 *
	 * `queryClient.removeQueries` is not needed — the queries are keyed by report code, so a new code
	 * simply misses the cache — but the *rendered* report is held in `request`, which is keyed by
	 * nothing and would otherwise survive the change.
	 */
	const clearBelow = useCallback(() => {
		setChosenFightID(null);
		setChosenPlayer(null);
		requestPull(null);
	}, [requestPull]);

	const analyse = () => {
		if (code === null || fightID === null || playerName === null) return;
		requestPull({ code, fightID, playerName });
	};

	// Focus follows the scroll, or the sticky bar's Change button leaves a keyboard user at the bottom
	// of the page having to tab back up through the whole report to reach what it just revealed.
	const changeSelection = () => {
		const block = selectionRef.current;
		if (block === null) return;
		const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		block.scrollIntoView({
			behavior: reduced ? 'auto' : 'smooth',
			block: 'start',
		});
		block.focus({ preventScroll: true });
	};

	const problem = (error: unknown) => {
		const failure = describeFailure(error);
		return (
			<div className="mt-4">
				<Callout
					title={failure.title}
					action={
						failure.tokenAtFault ? (
							<button type="button" className={buttonClass} onClick={signOut}>
								Sign out and try again
							</button>
						) : null
					}
				>
					<p className="m-0">{failure.detail}</p>
				</Callout>
			</div>
		);
	};

	return (
		<>
			{/* The three steps are one selection, so they are one block: what the sticky bar stands in
			    for, what its Change button returns to, and what takes focus when it does. The gaps
			    repeat the page container's, so wrapping them changes nothing on screen. */}
			<div ref={selectionRef} tabIndex={-1} className="flex scroll-mt-4 flex-col gap-4 sm:gap-5">
				<Step
					index={2}
					title={t('steps.report')}
					hint="report URL or code"
					state={!signedIn ? 'pending' : loaded ? 'done' : 'active'}
				>
					{signedIn ? (
						<>
							<ReportInput
								busy={fights.isFetching}
								initialReport={fromUrl.code}
								onSubmit={(parsed) => {
									setInput(parsed);
									clearBelow();
								}}
								// Typing a different code makes everything below stale, including the report
								// already on screen — which used to stay there, under a heading naming a
								// report it did not come from.
								onDiverge={clearBelow}
							/>
							{fights.data ? (
								<p className="mt-3 mb-0 truncate text-sm text-muted">
									{fights.data.title}
									{fights.data.zoneName ? ` · ${fights.data.zoneName}` : ''} · {fights.data.fights.length} boss pull
									{fights.data.fights.length === 1 ? '' : 's'}
								</p>
							) : null}
							{fights.error ? problem(fights.error) : null}
						</>
					) : (
						<p className="m-0 leading-relaxed text-muted">
							Once you are signed in: paste a report URL or code, pick the pull, pick the player, read the report.
						</p>
					)}
				</Step>

				<Step index={3} title={t('steps.fight')} state={loaded ? 'active' : 'pending'}>
					{/* The fetch comes first, because the step is otherwise a single line of copy that the
					    arriving list expands to several hundred pixels — the largest jump above the fold,
					    and one that happens while the reader is still looking at this step. */}
					{fights.isFetching ? (
						<FightListSkeleton />
					) : !fights.data ? (
						<p className="m-0 leading-relaxed text-muted">Load a report above and its boss pulls appear here.</p>
					) : hasFights ? (
						<FightSelector
							fights={fights.data.fights}
							difficultyNames={fights.data.difficultyNames}
							value={fightID}
							onChange={(next) => {
								setChosenFightID(next);
								setChosenPlayer(null);
								setFightJustChosen(true);
							}}
						/>
					) : (
						<p className="m-0 max-w-[64ch] leading-relaxed text-ink-2">
							That report loaded, but it has no boss encounters in it — only trash, or nothing at all.
						</p>
					)}
				</Step>

				<Step
					index={4}
					title={t('steps.player')}
					state={loaded && hasFights ? 'active' : 'pending'}
					ref={playerStepRef}
				>
					{!loaded || !hasFights ? (
						<p className="m-0 leading-relaxed text-muted">
							Then pick whose pull to read. Only {spec.displayName}s who were in that fight are listed.
						</p>
					) : (
						<div className="flex flex-col gap-4">
							{players.isLoading ? (
								<p className="m-0 leading-relaxed text-muted">Checking who was in that pull…</p>
							) : players.error ? (
								problem(players.error)
							) : (
								<PlayerSelector
									players={roster}
									value={playerName}
									onChange={setChosenPlayer}
									fightName={fight?.name ?? 'this pull'}
									specName={spec.displayName}
								/>
							)}

							<div className="flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center">
								<button
									type="button"
									className={`${primaryButtonClass} w-full sm:w-auto`}
									onClick={analyse}
									disabled={isFetching || playerName === null}
								>
									{isFetching ? 'Reading the fight…' : 'Analyse this pull'}
								</button>
								{/* The same settings button the sticky bar carries, for the reader who is still
							    here and has not scrolled past anything. Two triggers, one dialog each — a
							    shared open state would close one to open the other and move focus twice. */}
								<SettingsDialog {...settingsState} />
							</div>

							{progress ? <FetchProgress progress={progress} /> : null}
							{analysisError ? problem(analysisError) : null}
						</div>
					)}
				</Step>
			</div>

			{/* The target-mode control's other home, and the one the reader sees before the bar exists.
			    The switches themselves are on the bar; this block is the same control with the sentence
			    the bar has no line for — what the pull detected, and what overriding it means.

			    Directly *above* the sentinel, and that placement is the whole handoff. The bar appears
			    the moment the sentinel crosses the top of the viewport, and this sits immediately above
			    it, so it has left the screen at exactly the instant the bar's copy arrives: never two
			    controls at once, never a stretch of scrolling with none, and nothing unmounting inside
			    the viewport to jerk the page. Below the sentinel it would spend the handoff sitting
			    under a translucent bar showing a second copy of itself.

			    Gated on `gradeable`, the same condition the bar's own switches take. */}
			{gradeable && analysis !== null ? (
				<div className="mt-4 sm:mt-5">
					<TargetModeControl targets={analysis.targets} value={targetChoice} onChange={setTargetChoice} />
				</div>
			) : null}

			{/* Rendered unconditionally and never inside a branch, so the observer always has it to
			    watch. It sits above the bar in the document, which is what stops the bar's own height
			    from moving the thing that decides whether the bar exists. */}
			<div ref={selectionEndRef} aria-hidden="true" className="h-0" />

			{/* A selection is complete when there is a pull and someone in it to read. The player is
			    named only when the pull held more than one Windwalker — the rule PlayerSelector uses to
			    hide itself. */}
			{fight !== null && playerName !== null && selectionOffScreen ? (
				<StickySelectionBar
					settings={settingsState}
					encounter={fight.name}
					kill={fight.kill}
					fightPercentage={fight.fightPercentage ?? null}
					player={roster.length > 1 ? playerName : null}
					onChange={changeSelection}
					targetMode={
						gradeable && analysis !== null
							? {
									targets: analysis.targets,
									value: targetChoice,
									onChange: setTargetChoice,
								}
							: undefined
					}
				/>
			) : null}

			{/* The scroll margins are the sticky bar's height: an in-page jump that lands under the bar
			    hides the heading it was aimed at. */}
			<div ref={resultRef} className="scroll-mt-14 [&_h1]:scroll-mt-14 [&_h2]:scroll-mt-14">
				{analysis !== null ? (
					<div className="pt-6 md:pt-10">
						<Report analysis={analysis} targetChoice={targetChoice} spec={spec} />
					</div>
				) : isFetching ? (
					// A fetch with no analysis behind it is the first read of a pull *or* the read of a
					// different one — the query is keyed by the request, so asking for another pull drops the
					// report that was on screen. Either way the page is about to grow by several thousand
					// pixels; putting the shape up now means that growth happens once, in answer to the
					// click that caused it, rather than silently several seconds later.
					<div className="pt-6 md:pt-10">
						<ReportSkeleton />
					</div>
				) : null}
			</div>
		</>
	);
}

/**
 * How many boss rows to hold the fight step open with.
 *
 * The real count is not knowable before the report answers — it is the whole reason this exists —
 * so five is a plausible raid night rather than a promise. Being wrong by a row or two costs a row
 * or two of movement; not reserving anything costs the entire list's height.
 */
const FIGHT_ROWS = [1, 2, 3, 4, 5];

/**
 * `FightSelector`'s shape while the report's pulls are being fetched.
 *
 * The height is that selector's own row: two lines of type inside `py-2.5`, gathered at the same
 * `gap-2`, so what lands is close to the same size as what was reserved.
 */
function FightListSkeleton() {
	return (
		<div aria-hidden="true" className="flex flex-col gap-2 motion-safe:animate-pulse">
			{FIGHT_ROWS.map((row) => (
				<Skeleton key={row} className="h-[68px]" />
			))}
		</div>
	);
}
