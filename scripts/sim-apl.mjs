// Reading a wowsims APL into the one thing this repository can compare against: an ordered list of casts.
//
// The sim's `.apl.json` is a program. It has named groups, value variables, strict sequences, item swaps,
// conditions nested several levels deep, and rows the UI hides. None of that is knowable from a rotation
// section drawn for a reader, and trying to render it would be re-implementing the simulator.
//
// **What is comparable is the order buttons are pressed in.** Each spec's `lib/apl.ts` carries a ladder of
// rungs, each with a spell id, hand-written from the sim's priority list — and a hand-written copy of
// somebody else's list goes stale silently. So this flattens the program down to the sequence of casts it
// would attempt, and that sequence is a thing a diff can show and a test can pin.
//
// **It is a projection and it throws information away, deliberately.** Two rungs that differ only by
// condition collapse to one spell id here; a cast reachable only when a talent is taken looks like any
// other. That makes this useless as a rotation and exactly right as a drift alarm: if the sim adds a spell
// to its priority list, or drops one, or moves one past another, the flattened list changes and somebody
// is told. What it cannot tell you is whether the *reason* for a rung changed, and the header of the
// generated file says so.

/** A cast the APL attempts, in the order the program reaches it. */
const castOf = (node, via, hidden) => {
	const spell = node.spellId;
	if (spell === undefined) return null;
	// `otherId` is the sim's name for a cast that is not a spell — a potion, a racial, a profession use.
	// Kept as a string rather than dropped, because a priority list that gains a potion has changed.
	if (spell.spellId === undefined) {
		return spell.otherId === undefined ? null : { other: spell.otherId, via, hidden };
	}
	return { spellId: spell.spellId, via, hidden };
};

/**
 * Every cast an action tree reaches, in document order, with group references expanded where they appear.
 *
 * Conditions are walked through rather than around. They mention spells constantly — `spellCanCast`,
 * `auraIsActive`, `spellTimeToReady` — but never under a `castSpell` key, so collecting only that key
 * leaves them out without needing to know the shape of every condition the sim supports. That matters:
 * the condition grammar is the part of this format most likely to grow.
 */
export function castsFrom(node, { groups = new Map(), via = null, hidden = false, seen = new Set() } = {}) {
	if (Array.isArray(node)) {
		return node.flatMap((child) => castsFrom(child, { groups, via, hidden, seen }));
	}
	if (node === null || typeof node !== 'object') return [];

	const out = [];
	// `hide` marks a row the sim's UI folds away — the elixir and weapon-swap toggles. It is still an
	// action the program runs, so it is carried with a flag rather than dropped.
	const hiddenHere = hidden || node.hide === true;

	for (const [key, value] of Object.entries(node)) {
		if (key === 'hide') continue;
		if (key === 'castSpell') {
			const cast = castOf(value, via, hiddenHere);
			if (cast !== null) out.push(cast);
			continue;
		}
		if (key === 'groupReference') {
			const name = value?.groupName;
			// A group that references itself, directly or through another, would recurse for ever. The sim
			// does not write one, and a parser that trusted it not to would hang a scheduled job.
			if (name === undefined || seen.has(name)) continue;
			const group = groups.get(name);
			if (group === undefined) continue;
			out.push(...castsFrom(group, { groups, via: name, hidden: hiddenHere, seen: new Set([...seen, name]) }));
			continue;
		}
		out.push(...castsFrom(value, { groups, via, hidden: hiddenHere, seen }));
	}
	return out;
}

/** The named action groups, by name, so a `groupReference` can be resolved where it appears. */
export function groupsOf(apl) {
	return new Map((apl.groups ?? []).map((group) => [group.name, group.actions ?? []]));
}

/**
 * One APL file, flattened.
 *
 * `prepull` and `priority` stay separate because they answer different questions — an opener versus a
 * loop — and every rotation section in this repository draws them as different things.
 */
export function normaliseApl(apl) {
	const groups = groupsOf(apl);
	return {
		prepull: castsFrom(apl.prepullActions ?? [], { groups }),
		priority: castsFrom(apl.priorityList ?? [], { groups }),
		groups: [...groups.keys()],
	};
}

/**
 * The spell ids a flattened file casts, deduplicated, in first-seen order.
 *
 * Hidden rows are dropped here and only here: the elixir and weapon-swap toggles are equipment
 * bookkeeping rather than rotation, and a rotation section that listed them would be wrong. They stay in
 * the committed snapshot so the drop is visible rather than assumed.
 */
export function spellsOf(file) {
	const seen = new Set();
	const out = [];
	for (const cast of [...file.prepull, ...file.priority]) {
		if (cast.hidden || cast.spellId === undefined || seen.has(cast.spellId)) continue;
		seen.add(cast.spellId);
		out.push(cast.spellId);
	}
	return out;
}

/**
 * Where a spec's APLs live in the sim tree, derived rather than declared.
 *
 * `SpecDefinition` already carries WarcraftLogs' own spellings — `classKey` "Monk", `specName`
 * "Windwalker" — and the sim happens to lay its directories out the same way in lower case. So a spec
 * registered next year is picked up with no edit here, exactly as the reference sweep picks it up.
 *
 * **It is a guess that is checked, not a guarantee.** The caller lists the directory and reports what it
 * actually found, because the assumption has already been wrong once: `wowsims/mop@master` has no
 * `default.apl.json` for the Protection paladin at all, only three fight-specific ones.
 */
export function aplDirFor(spec) {
	return `ui/${spec.classKey.toLowerCase()}/${spec.specName.toLowerCase()}/apls`;
}

/**
 * What changed between two snapshots, as one line per difference.
 *
 * Per file rather than per spec, because a spec can gain and lose whole APLs — an `aoe.apl.json` appearing
 * is as much a signal as a spell moving inside one.
 */
export function driftOf(committed, fresh) {
	const lines = [];
	const specs = new Set([...Object.keys(committed.specs ?? {}), ...Object.keys(fresh.specs ?? {})]);
	for (const spec of [...specs].sort()) {
		const before = committed.specs?.[spec]?.files ?? {};
		const after = fresh.specs?.[spec]?.files ?? {};
		for (const name of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
			if (before[name] === undefined) {
				lines.push(`${spec} ${name} added`);
				continue;
			}
			if (after[name] === undefined) {
				lines.push(`${spec} ${name} removed`);
				continue;
			}
			const wasSpells = spellsOf(before[name]);
			const nowSpells = spellsOf(after[name]);
			if (wasSpells.join(',') !== nowSpells.join(',')) {
				const gained = nowSpells.filter((id) => !wasSpells.includes(id));
				const lost = wasSpells.filter((id) => !nowSpells.includes(id));
				const how =
					gained.length === 0 && lost.length === 0
						? 'reordered'
						: [gained.length > 0 ? `+${gained.join(' +')}` : '', lost.length > 0 ? `-${lost.join(' -')}` : '']
								.filter(Boolean)
								.join(' ');
				lines.push(`${spec} ${name} ${how}`);
			}
		}
	}
	return lines;
}
