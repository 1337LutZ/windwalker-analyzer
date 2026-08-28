import { DEFAULT_ANALYSIS_MODE, type AnalysisMode } from '~/lib/analysis/analysisMode';
import AnalysisModeControl from '../report/AnalysisModeControl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import '~/lib/i18n';

import { useReportSlot } from '~/hooks/useReportSlot';
import { useInitialUrlSelection, useUrlSelectionWriter } from '~/hooks/useReportUrlState';
import { useSettings } from '~/hooks/useSettings';

import { useSession } from '~/lib/auth';
import type { Pull } from '~/lib/compare';
import type { SpecDefinition } from '~/lib/spec';
import { resolveBands } from '~/lib/view/targetMode';
import { forgetCredits } from '~/lib/wcl';

import { Note, Prose, Step } from '../primitives';
import { primaryButtonClass } from '../primitives/controls';
import type { EncounterGroup } from '../report/encounterGroups';
import FetchProgress from '../report/FetchProgress';
import ReportSkeleton from '../report/ReportSkeleton';
import SettingsDialog from '../report/SettingsDialog';
import { SpecContext } from '../report/specContext';

import CompareBar from './CompareBar';
import CompareReport from './CompareReport';
import EncounterSelector from './EncounterSelector';
import PlayerPick from './PlayerPick';
import ReportField from './ReportField';
import { pullLabels } from './pullLabels';

/**
 * The bosses both reports pulled, in the first report's order.
 *
 * The intersection rather than the union, because the encounter is one selection for both slots and a
 * row naming a boss only one of them fought is a row that cannot be chosen. Where the two slots hold
 * the same report code this is simply that report's own list.
 */
function shared(a: readonly EncounterGroup[], b: readonly EncounterGroup[]): EncounterGroup[] {
	if (a.length === 0 || b.length === 0) return [];
	const inB = new Set(b.map((group) => group.key));
	return a.filter((group) => inB.has(group.key));
}

/**
 * Two pulls of one boss, picked and then compared.
 *
 * **Two slots of the same hook the report page uses one of.** Everything about a pull — which attempt
 * is the default, which player a stale name falls through to, dropping the analysis the moment the
 * pickers move off it — lives in `useReportSlot` and is therefore the same on both pages. What is here
 * is only what a page with two pulls has to decide for itself.
 *
 * **One encounter, chosen once.** The thresholds every figure below is graded against are calibrated
 * on a rotation being asked for the same things, and two different bosses ask for different ones. So
 * the encounter is a single control over both slots, and the comparison cannot be pointed at a
 * Garrosh pull and an add wave. Which *attempt* each report contributes stays a per-slot question:
 * there is no honest way to pair a seventh wipe with a second one, and a kill against the best wipe is
 * a comparison somebody may want.
 *
 * **The cost is said out loud before the button is pressed.** One analysis is several pages of events
 * and about five points of the reader's hourly WarcraftLogs budget, and this asks for two. Two players
 * from the same pull is the cheap case: the report and roster queries are keyed by report and fight,
 * so the second slot is handed the first slot's answers for nothing.
 */
export default function CompareFlow({ spec }: { spec: SpecDefinition }) {
	const { t } = useTranslation('ui');
	const { token } = useSession();
	const fromUrl = useInitialUrlSelection();
	const writeUrl = useUrlSelectionWriter();
	const settingsState = useSettings(spec.settings);
	const queryClient = useQueryClient();
	const resultRef = useRef<HTMLDivElement | null>(null);
	const selectionRef = useRef<HTMLDivElement | null>(null);
	const selectionEndRef = useRef<HTMLDivElement | null>(null);
	const [selectionOffScreen, setSelectionOffScreen] = useState(false);

	/** The encounter both slots resolve a pull within, as `EncounterGroup.key`. Null until chosen. */
	const [chosenEncounter, setChosenEncounter] = useState<string | null>(null);

	const seedA = useMemo(() => ({ code: fromUrl.code, fightID: fromUrl.fightID, player: fromUrl.player }), [fromUrl]);
	// Passed straight through, identity and all: `fromUrl` changes only when the address is actually
	// read, so a slot seeded once is not re-seeded while the reader works on the other one.
	const seedB = fromUrl.second;

	// Both slots are given the encounter before it is chosen, which is null, and behave exactly as the
	// report page's slot does until it is.
	/**
	 * One mode for both pulls, for the reason the settings are one set for both: a comparison read under
	 * two different readings is not a comparison. See `lib/analysis/analysisMode`.
	 */
	const [analysisMode, setAnalysisMode] = useState<AnalysisMode>(DEFAULT_ANALYSIS_MODE);
	const a = useReportSlot({
		token,
		spec,
		settings: settingsState.settings,
		mode: analysisMode,
		seed: seedA,
		encounter: chosenEncounter,
	});
	const b = useReportSlot({
		token,
		spec,
		settings: settingsState.settings,
		mode: analysisMode,
		seed: seedB,
		encounter: chosenEncounter,
	});

	const resetA = a.reset;
	const resetB = b.reset;
	const encounters = useMemo(() => shared(a.groups, b.groups), [a.groups, b.groups]);

	/**
	 * The encounter a shared link named, taken from the first slot's own pull.
	 *
	 * A link carries fight ids rather than an encounter, because that is what a link to one report has
	 * always carried. The encounter is recovered from the first slot's fight and only while nothing has
	 * been chosen, so it seeds the picker without ever overriding the reader.
	 */
	useEffect(() => {
		if (chosenEncounter !== null || encounters.length === 0) return;
		const seeded = a.groups.find((group) => group.attempts.some((attempt) => attempt.id === fromUrl.fightID));
		const first = encounters.find((group) => group.key === seeded?.key) ?? encounters[encounters.length - 1];
		if (first !== undefined) setChosenEncounter(first.key);
	}, [chosenEncounter, encounters, a.groups, fromUrl.fightID]);

	// Signing out drops both reports with it, for the reason the report page gives: the analyses were
	// fetched with that credential, and leaving them on screen would make "sign out" look like less
	// than it is.
	useEffect(() => {
		if (token !== null) return;
		queryClient.clear();
		forgetCredits();
		resetA();
		resetB();
		setChosenEncounter(null);
	}, [token, queryClient, resetA, resetB]);

	// Both pulls, mirrored out whenever either resolves — including the defaults the pickers chose, so
	// a link copied without touching anything reproduces what is on screen.
	useEffect(() => {
		if (a.code === null && b.code === null) return;
		writeUrl({
			code: a.code,
			fightID: a.fightID,
			player: a.playerName,
			second: { code: b.code, fightID: b.fightID, player: b.playerName },
		});
	}, [a.code, a.fightID, a.playerName, b.code, b.fightID, b.playerName, writeUrl]);

	// Both names, because a strip of tabs full of comparisons is the reason somebody opened a second.
	useEffect(() => {
		const base = `${spec.displayName} analyzer`;
		document.title =
			a.playerName !== null && b.playerName !== null
				? `${a.playerName} against ${b.playerName} - ${base}`
				: `Compare - ${base}`;
	}, [a.playerName, b.playerName, spec]);

	// The comparison lands below three blocks of form, which on a phone is well past the fold.
	useEffect(() => {
		if (a.analysis === null || b.analysis === null) return;
		const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		resultRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
	}, [a.analysis, b.analysis]);

	// Whether the pickers have been scrolled past, watched at a sentinel that closes the selection
	// block. "Not intersecting" alone is the wrong question: the block is taller than a phone, so the
	// sentinel is off screen both above the viewport and below it, and only the first is a reason to
	// show the bar. The sign of `top` is what separates them.
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

	const signedIn = token !== null;
	const bothLoaded = a.fights.data !== undefined && b.fights.data !== undefined;
	const ready = a.playerName !== null && b.playerName !== null && a.fightID !== null && b.fightID !== null;
	const fetching = a.isFetching || b.isFetching;

	// Focus follows the scroll, or the bar's Change button leaves a keyboard user at the bottom of the
	// page having to tab back up through the whole comparison to reach what it just revealed.
	const changeSelection = () => {
		const block = selectionRef.current;
		if (block === null) return;
		const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		block.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
		block.focus({ preventScroll: true });
	};

	/**
	 * Each pull scored at its own reading, and that is deliberate.
	 *
	 * One boss does not make one reading. A raid can meet Galakras at one target and at five in the
	 * same pull, and two attempts at it can spend very different shares of their length in each. So a
	 * pull is graded against the rules that applied at the counts it was actually fought at, and where
	 * the two readings differ a rule that applies to one and not the other comes back as **not asked**
	 * rather than as a number.
	 */
	const pair = useMemo<{ a: Pull; b: Pull } | null>(() => {
		if (a.analysis === null || b.analysis === null) return null;
		// The wrong-spec refusal, twice. A pull this spec cannot read has nothing to compare, and
		// guessing is the thing `identify` exists to refuse.
		if (!a.analysis.isSpec || !b.analysis.isSpec) return null;
		const viewA = resolveBands(a.analysis.targets, a.targetChoice, a.analysis.segments);
		const viewB = resolveBands(b.analysis.targets, b.targetChoice, b.analysis.segments);
		return {
			a: { analysis: a.analysis, scorecard: spec.score(a.analysis, viewA), view: viewA },
			b: { analysis: b.analysis, scorecard: spec.score(b.analysis, viewB), view: viewB },
		};
	}, [a.analysis, b.analysis, a.targetChoice, b.targetChoice, spec]);

	const refused = a.analysis !== null && b.analysis !== null && pair === null;
	// The bar is the legend, so it has to name the two pulls the same way every figure below does —
	// including where two anonymous reports both call their monk `Player (10)`.
	const barNames = pair === null ? null : pullLabels(pair.a.analysis, pair.b.analysis);

	return (
		<SpecContext.Provider value={spec}>
			{/* The three steps are one selection, so they are one block: what the bar stands in for, what
			    its Change button returns to, and what takes focus when it does. */}
			<div ref={selectionRef} tabIndex={-1} className="flex scroll-mt-4 flex-col gap-4 sm:gap-5">
				<Step index={2} title={t('steps.reports')} state={!signedIn ? 'pending' : 'active'}>
					{signedIn ? (
						<div className="grid grid-cols-1 gap-5 md:grid-cols-2">
							<ReportField slot={a} side="a" seedCode={fromUrl.code} label={t('steps.firstLog')} />
							<ReportField slot={b} side="b" seedCode={fromUrl.second?.code ?? null} label={t('steps.secondLog')} />
						</div>
					) : (
						<p className="m-0 leading-relaxed text-muted">{t('steps.signInFirst')}</p>
					)}
				</Step>

				<Step index={3} title={t('steps.encounter')} state={bothLoaded ? 'active' : 'pending'}>
					{bothLoaded ? (
						<div className="flex flex-col gap-4">
							<Prose>{t('steps.encounterIntent')}</Prose>
							<EncounterSelector encounters={encounters} value={chosenEncounter} onChange={setChosenEncounter} />
						</div>
					) : (
						<p className="m-0 leading-relaxed text-muted">{t('steps.encounterHere')}</p>
					)}
				</Step>

				<Step index={4} title={t('steps.players')} state={chosenEncounter !== null ? 'active' : 'pending'}>
					{chosenEncounter === null ? (
						<p className="m-0 leading-relaxed text-muted">{t('steps.playersHere')}</p>
					) : (
						<div className="grid grid-cols-1 gap-5 md:grid-cols-2">
							<PlayerPick slot={a} side="a" spec={spec} label={t('steps.firstLog')} />
							<PlayerPick slot={b} side="b" spec={spec} label={t('steps.secondLog')} />
						</div>
					)}
				</Step>

				<Step index={5} title={t('steps.compare')} state={ready ? 'active' : 'pending'}>
					<div className="flex flex-col gap-4">
						<Prose>{t('steps.compareCost')}</Prose>
						<div className="flex flex-col gap-3 sm:flex-row sm:items-center">
							<button
								type="button"
								className={`${primaryButtonClass} w-full sm:w-auto`}
								onClick={() => {
									a.analyse();
									b.analyse();
								}}
								disabled={fetching || !ready}
							>
								{fetching ? t('progress.fight') : t('steps.compareAction')}
							</button>
							{/* The same dialog the report page carries. The thresholds are the reader's and apply to
							    both pulls, because a comparison read at two different sets of them is not one. */}
							<SettingsDialog {...settingsState} />
						</div>

						{/* Below the button rather than beside it, and applying to both pulls at once. Switching
						    re-reads what is already fetched, so a reader can compare the same two pulls under
						    either reading without spending a request. */}
						<AnalysisModeControl value={analysisMode} onChange={setAnalysisMode} />
						{a.progress ? <FetchProgress progress={a.progress} /> : null}
						{b.progress ? <FetchProgress progress={b.progress} /> : null}
					</div>
				</Step>
			</div>

			{/* Rendered unconditionally and never inside a branch, so the observer always has it to watch. */}
			<div ref={selectionEndRef} aria-hidden="true" className="h-0" />

			{/* The legend, once the header carrying it has scrolled away. Gated on a comparison actually
			    being on screen: a bar naming two pulls above an empty page names nothing the reader can
			    use. */}
			{pair !== null && barNames !== null && selectionOffScreen ? (
				<CompareBar a={barNames.a} b={barNames.b} encounter={pair.a.analysis.encounter} onChange={changeSelection} />
			) : null}

			{/* The scroll margins are the bar's height: an in-page jump that lands under the bar hides the
			    heading it was aimed at. */}
			<div ref={resultRef} className="scroll-mt-14 [&_h2]:scroll-mt-14 [&_h3]:scroll-mt-14">
				{pair !== null ? (
					<div className="pt-6 md:pt-10">
						<CompareReport a={pair.a} b={pair.b} />
					</div>
				) : refused ? (
					<div className="pt-6 md:pt-10">
						<Note>{t('steps.compareRefused')}</Note>
					</div>
				) : fetching ? (
					<div className="pt-6 md:pt-10">
						<ReportSkeleton />
					</div>
				) : null}
			</div>
		</SpecContext.Provider>
	);
}
