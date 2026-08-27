// One pull's worth of state: the report, the fight, the player, and the analysis they add up to.
//
// **Lifted out of `ReportFlow` rather than written for the compare page.** Two pulls side by side need
// exactly what one pull needed, twice, and the alternative was a second copy of the selection logic —
// the fall-through in `resolvePlayerName`, the fight id held as an override rather than an answer, the
// request dropped the moment the pickers move off it. Each of those is a fix for a specific wrong
// behaviour, and a copy would have carried the code and not the reasons.
//
// What stays outside: everything that is about the *page* rather than about a pull. The scroll
// targets, the sticky bar's sentinel, the document title, the address bar, the sign-out sweep. One
// slot has no opinion about any of them, and on the compare page two slots would fight over all of
// them.

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useFightAnalysis, type AnalysisRequest } from '~/hooks/useFightAnalysis';
import { useFightPlayers } from '~/hooks/useFightPlayers';
import { useReportFights } from '~/hooks/useReportFights';

import type { AnalysisSettings } from '~/lib/settings';
import type { SpecDefinition } from '~/lib/spec';
import type { Analysis } from '~/lib/types';
import type { OfferedChoice } from '~/lib/view/targetMode';
import type { FetchProgress, FightPlayer, FightWithRoster, ReportFightList } from '~/lib/wcl';

import { defaultFightID, groupByEncounter, type EncounterGroup } from '~/components/report/encounterGroups';
import type { ResolvedReportInput } from '~/components/report/parseReportInput';
import { resolvePlayerName } from '~/components/report/resolvePlayer';
import { selectionDiverged } from '~/components/report/selectionDiverged';

/** What a link or a paste supplies before the reader has touched anything. */
export interface SlotSeed {
	code: string | null;
	fightID: number | null;
	player: string | null;
}

export interface ReportSlot {
	input: ResolvedReportInput | null;
	setInput: (next: ResolvedReportInput | null) => void;
	code: string | null;

	/** The report's pull list, straight from the query, so a caller can show its own loading shape. */
	fights: {
		data: ReportFightList | undefined;
		error: unknown;
		isFetching: boolean;
	};
	groups: EncounterGroup[];
	/**
	 * Every attempt this report made at the chosen encounter, in pull order.
	 *
	 * Empty when no encounter is chosen or this report has none. The compare page draws an attempt
	 * picker only where there is more than one, because a report with a single pull of a boss has
	 * nothing to ask about.
	 */
	attempts: EncounterGroup['attempts'];
	/** The resolved pull: the reader's override where there is one, the picker's default otherwise. */
	fightID: number | null;
	fight: FightWithRoster | null;
	chooseFight: (next: number) => void;
	/**
	 * True from a fight the reader actually chose until the caller clears it.
	 *
	 * A choice and not a selection: the fight id also moves when a report loads and the picker defaults
	 * to the last boss, and when a link seeds one. Only the first is a reason to scroll a page.
	 */
	fightJustChosen: boolean;
	clearFightJustChosen: () => void;

	players: { error: unknown; isLoading: boolean };
	roster: FightPlayer[];
	playerName: string | null;
	choosePlayer: (next: string | null) => void;

	/** What the report below is about, and the record that it is still what the pickers say. */
	request: AnalysisRequest | null;
	analysis: Analysis | null;
	error: unknown;
	isFetching: boolean;
	progress: FetchProgress | null;

	targetChoice: OfferedChoice;
	setTargetChoice: (next: OfferedChoice) => void;

	/** Fetch and read the pull the pickers currently describe. Does nothing until they describe one. */
	analyse: () => void;
	/** Drops both picks and the report, for a new report code. */
	clearBelow: () => void;
	/** Drops everything, including the report code. What signing out does to a slot. */
	reset: () => void;
	/** Whether this slot has a report on screen that was graded, so a reading can be chosen for it. */
	gradeable: boolean;
}

export interface SlotInput {
	token: string | null;
	spec: SpecDefinition;
	settings: AnalysisSettings;
	/**
	 * The selection a link supplied, or null for a slot nothing seeded.
	 *
	 * Seeded through an effect on identity rather than as an initial value, because on the report page
	 * the URL is read once *after* mount and arrives as a new object when it does. A slot handed a
	 * seed twice with the same contents must not re-seed, or it would undo the reader's own picks; the
	 * caller passes a stable object and this watches that object.
	 */
	seed: SlotSeed | null;
	/**
	 * The encounter this slot must resolve a pull within, as `EncounterGroup.key`.
	 *
	 * Null on the report page, which lets a reader read any pull in a report. The compare page sets it,
	 * and the constraint is the point rather than a convenience: two pulls of different bosses are two
	 * different questions, and every threshold below is calibrated on a rotation being asked for the
	 * same things. Held here rather than filtered by the caller because the *fall-through* has to know
	 * about it — a fight the reader chose before the encounter moved is not a pull in the new one, and
	 * it has to be dropped rather than silently kept.
	 */
	encounter?: string | null;
}

export function useReportSlot({ token, spec, settings, seed, encounter = null }: SlotInput): ReportSlot {
	const [input, setInput] = useState<ResolvedReportInput | null>(null);
	const [chosenFightID, setChosenFightID] = useState<number | null>(null);
	const [fightJustChosen, setFightJustChosen] = useState(false);
	const [chosenPlayer, setChosenPlayer] = useState<string | null>(null);
	const [request, setRequest] = useState<AnalysisRequest | null>(null);
	/**
	 * Which reading this slot's report is graded at.
	 *
	 * Per slot rather than per page, and on the compare page that is load-bearing: two pulls fought at
	 * different target counts are read at different lists, and one control over both would grade one of
	 * them against a list that never applied to it. `requestPull` puts it back to `auto` on every new
	 * pull, so a reading forced on one fight cannot follow the reader to the next.
	 */
	const [targetChoice, setTargetChoice] = useState<OfferedChoice>('auto');

	/** Every change of what this slot is reading, in one place — including dropping it. */
	const requestPull = useCallback((next: AnalysisRequest | null) => {
		setRequest(next);
		setTargetChoice('auto');
	}, []);

	useEffect(() => {
		if (seed === null || seed.code === null) return;
		setInput({ code: seed.code, fightID: seed.fightID, sourceID: null });
		if (seed.fightID !== null) setChosenFightID(seed.fightID);
		if (seed.player !== null) setChosenPlayer(seed.player);
	}, [seed]);

	const code = input?.code ?? null;
	const fights = useReportFights(token, code);
	const groups = useMemo(() => groupByEncounter(fights.data?.fights ?? []), [fights.data]);

	/**
	 * The pulls this slot may resolve within: one encounter's, or the whole report's.
	 *
	 * With no encounter set this is every group and the resolution below is exactly what it always was,
	 * which is what keeps the report page unchanged.
	 */
	const scoped = useMemo(() => {
		if (encounter === null) return groups;
		const group = groups.find((candidate) => candidate.key === encounter);
		return group === undefined ? [] : [group];
	}, [groups, encounter]);
	const attempts = useMemo(() => scoped.flatMap((group) => group.attempts), [scoped]);

	// The reader's pick survives only while it names a pull still on offer. Scoped to one encounter
	// that matters: a pull chosen before the encounter moved belongs to a boss nobody is looking at,
	// and keeping it would compare two different fights under one heading.
	const heldFight =
		encounter !== null && chosenFightID !== null && !attempts.some((attempt) => attempt.id === chosenFightID)
			? null
			: chosenFightID;
	const fightID = heldFight ?? defaultFightID(scoped, input?.fightID ?? null);
	const fight = fights.data?.fights.find((candidate) => candidate.id === fightID) ?? null;

	const players = useFightPlayers(token, code, fightID, spec.classKey, spec.specName);
	// Memoised because effects depend on it. `players.data ?? []` hands back a fresh array on every
	// render while the query is in flight, which woke those effects on every render until it arrived.
	const roster = useMemo(() => players.data ?? [], [players.data]);
	const playerName = resolvePlayerName(roster, chosenPlayer, input?.sourceID ?? null);

	const { analysis, error, isFetching, progress } = useFightAnalysis(token, request, settings, spec);

	// What is on screen belongs to a request, and the moment the selection stops matching that request
	// it belongs to a pull nobody is looking at. Only the request is dropped — the picks *are* the new
	// selection. The fetch already in the air still lands in the cache, where asking again is free.
	useEffect(() => {
		if (!selectionDiverged(request, { code, fightID, playerName })) return;
		requestPull(null);
	}, [request, code, fightID, playerName, requestPull]);

	const chooseFight = useCallback((next: number) => {
		setChosenFightID(next);
		// The reader's player choice deliberately survives a change of pull: following one person
		// through a night is what swapping encounters is for, and `resolvePlayerName` falls through
		// rather than selecting someone this pull has nobody by.
		setFightJustChosen(true);
	}, []);

	const clearFightJustChosen = useCallback(() => setFightJustChosen(false), []);

	const clearBelow = useCallback(() => {
		setChosenFightID(null);
		setChosenPlayer(null);
		requestPull(null);
	}, [requestPull]);

	const reset = useCallback(() => {
		setInput(null);
		setChosenFightID(null);
		setChosenPlayer(null);
		requestPull(null);
	}, [requestPull]);

	const analyse = useCallback(() => {
		if (code === null || fightID === null || playerName === null) return;
		requestPull({ code, fightID, playerName });
	}, [code, fightID, playerName, requestPull]);

	return {
		input,
		setInput,
		code,
		fights: { data: fights.data, error: fights.error, isFetching: fights.isFetching },
		groups,
		attempts,
		fightID,
		fight,
		chooseFight,
		fightJustChosen,
		clearFightJustChosen,
		players: { error: players.error, isLoading: players.isLoading },
		roster,
		playerName,
		choosePlayer: setChosenPlayer,
		request,
		analysis,
		error,
		isFetching,
		progress,
		targetChoice,
		setTargetChoice,
		analyse,
		clearBelow,
		reset,
		// A report that was graded. Not the skeleton, which is not a report yet, and not the wrong-spec
		// refusal, which has nothing to grade either way.
		gradeable: analysis !== null && analysis.isSpec,
	};
}
