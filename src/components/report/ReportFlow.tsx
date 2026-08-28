import { DEFAULT_ANALYSIS_MODE, type AnalysisMode } from '~/lib/analysis/analysisMode';
import AnalysisModeControl from './AnalysisModeControl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import '~/lib/i18n';

import { useReportSlot } from '~/hooks/useReportSlot';
import { useSettings } from '~/hooks/useSettings';
import { shouldAutoRun, useInitialUrlSelection, useUrlSelectionWriter } from '~/hooks/useReportUrlState';

import type { SpecDefinition } from '~/lib/spec';
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
import SplitGroupCallout from './SplitGroupCallout';
import TargetModeControl from './TargetModeControl';
import { describeFailure } from './describeFailure';

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
 * button. The request doubles as the record of what the report below is about, and the divergence
 * effect drops it the moment the pickers move off it: a request that outlived its selection is a
 * previous fight's report sitting under the new fight's name.
 *
 * **The spec arrives as a prop and is fixed for the life of the page.** It used to be read out of the
 * address bar here — `getSpec(fromUrl.spec ?? '') ?? DEFAULT_SPEC` — which put a report's whole
 * identity behind a query key that anything could edit and that resolved to a default when it named
 * nothing. The route decides it now, so there is no default to fall back to and no second opinion for
 * the URL to hold: `/monk/windwalker` is the address, the page's own colour and title come from the
 * same value, and everything below reads one spec that cannot change under it.
 */
export default function ReportFlow({ spec }: { spec: SpecDefinition }) {
	// Step labels are shell copy, so they come from the `ui` namespace, not the report's.
	const { t } = useTranslation('ui');
	const { token, signOut } = useSession();
	// A link with a report in it should land on that report rather than an empty form. The URL is read
	// once on mount and then only written to; after the first render the app's state is the truth.
	const fromUrl = useInitialUrlSelection();
	const writeUrl = useUrlSelectionWriter();
	// The thresholds the reader owns. Held here because this is where the analysis is derived, and the
	// spec's own schema is what the panel draws.
	const settingsState = useSettings(spec.settings);
	const queryClient = useQueryClient();

	/**
	 * Whether the selection carried in the URL has already been run.
	 *
	 * A ref rather than state: it must not cause a render, and it must flip *before* the effect that
	 * reads it can run a second time. Without it, restoring a link filled the form in and then sat
	 * there — the reader saw their own report code, fight and player already chosen and still had to
	 * press the button, which is not what a shared link is for.
	 */
	const autoRan = useRef(false);
	const [selectionOffScreen, setSelectionOffScreen] = useState(false);
	const resultRef = useRef<HTMLDivElement | null>(null);
	const playerStepRef = useRef<HTMLElement | null>(null);
	const selectionRef = useRef<HTMLDivElement | null>(null);
	const selectionEndRef = useRef<HTMLDivElement | null>(null);

	/**
	 * The selection the link supplied, as one stable object the slot can watch.
	 *
	 * `fromUrl` already changes identity only when the URL is actually read — once on mount, and once
	 * more after a sign-in restores the query — so this passes that identity straight through rather
	 * than minting a new object per render, which would re-seed the slot on every keystroke.
	 */
	const seed = useMemo(() => ({ code: fromUrl.code, fightID: fromUrl.fightID, player: fromUrl.player }), [fromUrl]);

	/**
	 * This page's one pull, held in the same hook the compare page holds two of.
	 *
	 * Everything about *a pull* is in there. What is left here is everything about *the page*: where it
	 * scrolls, what the tab is called, what the address bar says, and the sticky bar that stands in for
	 * the pickers once they are off screen. None of those is a question a slot can answer, and on a page
	 * with two of them none of those is a question two slots should both try to.
	 */
	/**
	 * Which question this report answers — see `lib/analysis/analysisMode`.
	 *
	 * Plain state rather than persisted: it changes what every figure on the page means, so a reader who
	 * opened a fresh tab should be told by the control which reading they are looking at rather than
	 * inheriting last week's choice invisibly. `parsing` is the default because it cannot overstate a
	 * pull.
	 */
	const [analysisMode, setAnalysisMode] = useState<AnalysisMode>(DEFAULT_ANALYSIS_MODE);
	const slot = useReportSlot({ token, spec, settings: settingsState.settings, mode: analysisMode, seed });
	// Destructured to the names the markup below already uses, so lifting the state out is not also a
	// rename of forty call sites.
	const {
		code,
		fights,
		groups,
		fightID,
		fight,
		players,
		roster,
		playerName,
		analysis,
		isFetching,
		progress,
		targetChoice,
		setTargetChoice,
		gradeable,
	} = slot;
	const analysisError = slot.error;

	// Signing out drops the report with it. The analysis was fetched with that credential, and leaving
	// it on screen would make "sign out" look like less than it is. The budget goes for the same
	// reason and is not part of the query cache: it is a fact about the token that just left.
	useEffect(() => {
		if (token !== null) return;
		queryClient.clear();
		forgetCredits();
		slot.reset();
	}, [token, queryClient, slot]);

	// Picking a pull is the moment the player step becomes answerable, and on a phone it sits below
	// the whole fight list. Scroll it into view rather than leaving the reader to find it.
	useEffect(() => {
		if (!slot.fightJustChosen) return;
		slot.clearFightJustChosen();
		const step = playerStepRef.current;
		if (step === null) return;
		const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		step.scrollIntoView({
			behavior: reduced ? 'auto' : 'smooth',
			block: 'start',
		});
	}, [slot]);

	/**
	 * The report lands below four steps of form, which on a phone is well past the fold.
	 *
	 * **Once per pull, not once per analysis.** `analysis` is a fresh object every time the pull is read
	 * again, and it is read again whenever the analysis mode or a setting changes — so keying the scroll on
	 * the object dragged the page back to the top of the report each time a reader flicked a switch, which
	 * is the one moment they are certainly already looking at the part they care about. The pull is what
	 * this is about: arriving at one is worth a scroll, re-reading the same one is not.
	 */
	const scrolledForPull = useRef<string | null>(null);
	useEffect(() => {
		if (analysis === null) return;
		const pull = `${analysis.code}|${String(analysis.fightID)}|${String(analysis.actorID)}`;
		if (scrolledForPull.current === pull) return;
		scrolledForPull.current = pull;
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
	//
	// The spec is not in it. The path already names it, and a link carrying it in both places is a link
	// whose two answers can disagree; `nextHref` drops the key rather than leaving it to the reader to
	// notice which one the page obeyed.
	useEffect(() => {
		if (code === null) return;
		writeUrl({ code, fightID, player: playerName });
	}, [code, fightID, playerName, writeUrl]);

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
		slot.analyse();
	}, [fromUrl.code, fromUrl.player, token, code, fightID, playerName, roster, slot]);

	const signedIn = token !== null;
	const loaded = fights.data !== undefined;
	const hasFights = groups.length > 0;

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
		const failure = describeFailure(error, t);
		return (
			<div className="mt-4">
				<Callout
					title={failure.title}
					action={
						failure.tokenAtFault ? (
							<button type="button" className={buttonClass} onClick={signOut}>
								{t('errors.signOutAction')}
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
									slot.setInput(parsed);
									slot.clearBelow();
								}}
								// Typing a different code makes everything below stale, including the report
								// already on screen — which used to stay there, under a heading naming a
								// report it did not come from.
								onDiverge={slot.clearBelow}
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
						<p className="m-0 leading-relaxed text-muted">{t('steps.fightsHere')}</p>
					) : hasFights ? (
						<FightSelector
							fights={fights.data.fights}
							difficultyNames={fights.data.difficultyNames}
							value={fightID}
							onChange={slot.chooseFight}
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
								<p className="m-0 leading-relaxed text-muted">{t('steps.checkingRoster')}</p>
							) : players.error ? (
								problem(players.error)
							) : (
								<PlayerSelector
									players={roster}
									value={playerName}
									onChange={slot.choosePlayer}
									fightName={fight?.name ?? 'this pull'}
									specName={spec.displayName}
								/>
							)}

							<div className="flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center">
								<button
									type="button"
									className={`${primaryButtonClass} w-full sm:w-auto`}
									onClick={slot.analyse}
									disabled={isFetching || playerName === null}
								>
									{isFetching ? t('progress.fight') : t('steps.analyse')}
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
				<div className="mt-4 flex flex-col gap-4 sm:mt-5">
					{/* First in the block, because it is the fact the two controls under it are chosen against:
					    a reader about to force a reading on a Dark Shaman pull should already know they only ever
					    fought one of the two bosses. Renders nothing on a pull the raid fought together, which is
					    every pull on eleven of the fourteen Siege encounters. */}
					<SplitGroupCallout split={analysis.splitGroup} />
					{/* Beside the target mode because both are re-readings of a pull already fetched: neither
					    touches the network, so both belong where a reader is looking at the report rather
					    than back at the form. They still answer different questions — this one changes what
					    was measured, that one changes which stretch of the pull is read — which is what the
					    two labels and the two hints are for. */}
					<AnalysisModeControl value={analysisMode} onChange={setAnalysisMode} />
					<TargetModeControl
						targets={analysis.targets}
						segments={analysis.segments}
						value={targetChoice}
						onChange={setTargetChoice}
					/>
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
									segments: analysis.segments,
									value: targetChoice,
									onChange: setTargetChoice,
								}
							: undefined
					}
					// Gated on the same pair as the target mode above: a bar over a skeleton or over a refused
					// player has nothing to re-read, and offering the switch there would re-run an analysis
					// that does not exist. The state itself lives here either way — the block control above
					// the report is the same `analysisMode`/`setAnalysisMode`, so the two cannot disagree.
					analysisMode={gradeable && analysis !== null ? { value: analysisMode, onChange: setAnalysisMode } : undefined}
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
