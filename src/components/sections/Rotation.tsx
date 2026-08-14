import { useReportCopy } from '~/hooks/useReportCopy';
import type { Analysis } from '~/lib/types';

import { Note, Pill, Prose, Section, SpellIcon } from '../primitives';

/**
 * One entry of the priority list.
 *
 * The order is a decision and lives here; the words are copy and live in `locales/en/report.json`
 * under `rotation.entry.<key>`. Splitting them that way is what stops a reordering from turning into
 * a rewrite, and it keeps this file free of the prose the house rules put in one place.
 *
 * `id` is the ability's *cast* id — the same one `spec/windwalker.ts` declares and the cast table
 * keys on — so the icon beside a name is the icon beside that name everywhere else on the page.
 */
interface Entry {
	key: string;
	id: number;
	/**
	 * The list does not look at this rung at all unless `rotation.gate.<key>` is true — a target
	 * count, or a debuff already inside a global of dropping.
	 *
	 * Drawn as a chip rather than folded into the `when` sentence because it is what a reader
	 * arriving with a pack in front of them is scanning for. The gate decides whether the entry is
	 * read; `when` is the entry's own condition once it is.
	 */
	gated?: boolean;
}

/**
 * A rung of the flow: one entry, or a set of alternatives sharing the rung.
 *
 * A fork is not decoration. Two of the three below are literally a branch in the sim — one button
 * under two rule sets, and one entry holding two thresholds — and the third is a talent row, where
 * only one of three buttons can exist on a bar at all. A table has one row per button and therefore
 * has to state a choice three times or drop two thirds of it; a fork states it once.
 *
 * `rotation.fork.<key>.{title,detail}` says what decides. Each branch then says what it is, when it
 * is the one that fires, and what that condition is protecting.
 */
type Slot = { entry: Entry } | { fork: string; branches: readonly Entry[] };

/**
 * The whole priority list, one rung per entry, in the order the sim evaluates it.
 *
 * Transcribed from `ui/monk/windwalker/apls/default.apl.json`, whose 32 entries are numbered in the
 * comments below. It is one list and always was: there is no second rotation for packs, only target
 * counts gating rungs of this one, which is the thing two tables could not say and `gated` now does.
 *
 * Four kinds of entry are deliberately dropped, because none of them is a rotation decision a reader
 * can act on: the elixir and weapon swap groups (1, 2, 7, 8), which model a sim-only optimisation;
 * the Chi Sphere pickup and the Arcane Torrent chi return (9, 11); the tier-15 energy sphere (14);
 * and the potion, trinket and racial group (6), which the list fires under a running brew.
 *
 * What is no longer dropped is the Chi Wave talent row. Zen Sphere (26, 30) and Chi Burst (28) were
 * left out while this was a table, because three rows for one choice tripled the row without adding
 * a decision. A fork costs one rung and states the choice once, so they are back.
 *
 * Invoke Xuen (16) and Rushing Jade Wind (17) are the *other* talent row and are deliberately not a
 * fork, adjacent though they are. A fork asserts that one of its branches fires on that rung, and
 * with the wind talented at a single target neither does — Rushing Jade Wind waits for its own
 * unconditional rung at 31. `rotation.notes.talents` carries that pairing in prose instead.
 */
const FLOW: readonly Slot[] = [
	{ entry: { key: 'touchOfDeath', id: 115080 } }, // 3
	{ entry: { key: 'stormEarthAndFire', id: 138228, gated: true } }, // 5
	{ entry: { key: 'chiBrew', id: 115399 } }, // 10
	{
		// 12 and 13: the same button under two rule sets that share almost no condition, chosen by
		// `RoRo: Equipped` — a variable the sim declares at the bottom of the file precisely so it can
		// branch on it. The one fork on this page the whole report turns on.
		fork: 'tigereyeBrew',
		branches: [
			{ key: 'tigereyeBrewRune', id: 1247275, gated: true },
			{ key: 'tigereyeBrewBank', id: 1247275, gated: true },
		],
	},
	{ entry: { key: 'energizingBrew', id: 115288 } }, // 15
	{ entry: { key: 'invokeXuen', id: 123904 } }, // 16, via the unconditional autocast
	{ entry: { key: 'rushingJadeWindMulti', id: 116847, gated: true } }, // 17
	{ entry: { key: 'risingSunKick', id: 107428, gated: true } }, // 18
	{ entry: { key: 'tigerPalmRefresh', id: 100787 } }, // 19
	{ entry: { key: 'craneOverKick', id: 101546, gated: true } }, // 20
	// 21. The kick is checked twice and this is the rung with no condition on it at all, which is why
	// a pack delays it rather than dropping it: 18 stops firing on cooldown past two targets, and it
	// lands here instead, below the Tiger Palm refresh and below the four-target Crane Kick.
	{ entry: { key: 'risingSunKickMulti', id: 107428 } },
	{ entry: { key: 'spinningCraneKick', id: 101546, gated: true } }, // 22
	{
		// 23, then 26 and 30, then 28. One talent row, so the three are never on a bar together and
		// their order against each other is unobservable — which is the licence to draw them level.
		fork: 'talent',
		branches: [
			{ key: 'chiWave', id: 115098 },
			{ key: 'zenSphere', id: 124081 },
			{ key: 'chiBurst', id: 123986 },
		],
	},
	{ entry: { key: 'comboBreakerKick', id: 100784 } }, // 24
	{ entry: { key: 'fistsOfFury', id: 113656 } }, // 25
	{ entry: { key: 'tigerPalmProc', id: 100787 } }, // 27
	{ entry: { key: 'jab', id: 100780 } }, // 29
	{ entry: { key: 'rushingJadeWind', id: 116847 } }, // 31
	{
		// 32: a single entry whose condition is one energy reserve or the other, with the target count
		// picking between them. Two branches of one `or`, drawn as two branches.
		fork: 'blackoutKick',
		branches: [
			{ key: 'blackoutKick', id: 100784, gated: true },
			{ key: 'blackoutKickDump', id: 100784, gated: true },
		],
	},
];

/**
 * How many columns a fork's branches sit in once there is room for them.
 *
 * Written out per branch count rather than composed, because Tailwind reads class names as literal
 * strings and never sees a template. Below `md` the map is not consulted and the branches stack,
 * which is the whole degradation story: a fork here is a nested list, not a drawing.
 */
const FORK_COLUMNS: Record<number, string> = { 2: 'md:grid-cols-2', 3: 'md:grid-cols-3' };

/**
 * The rotation itself: what to press, in what order, what decides each fork, and what every
 * condition is there to prevent.
 *
 * The one section on the page that grades nothing. Every other section says what happened in this
 * pull; this one says what the pull was being measured against, so a reader who has just been told
 * their Tigereye Brew averaged six stacks has somewhere to go and find out what ten would have taken.
 * It renders identically for every log — it takes `analysis` only to reach the copy, which is why
 * there is no empty state and no verdict below.
 *
 * It sits second to last, above the method and below everything that judges the pull, because it is
 * reference rather than argument.
 */
export default function Rotation({ analysis }: { analysis: Analysis }) {
	const { t } = useReportCopy(analysis);

	// One card per entry, whether it holds a rung alone or shares one with its alternatives. `when` is
	// the condition the priority list actually tests; `why` is what that condition is protecting,
	// which is the half a transcription of the APL leaves out and the half a reader needs. Labels sit
	// above their values rather than opposite them: "what the condition is for" is wider than any
	// label column worth giving up on a phone, and stacked it needs no column at all.
	const card = (entry: Entry, heading: 'h4' | 'h5') => {
		const Heading = heading;
		return (
			<>
				<Heading className="m-0 flex items-center gap-2 font-mono text-base font-semibold text-ink">
					<SpellIcon id={entry.id} size="sm" />
					{t(`rotation.entry.${entry.key}.name`)}
				</Heading>
				{entry.gated ? (
					<p className="m-0 mt-2">
						<Pill>{t(`rotation.gate.${entry.key}`)}</Pill>
					</p>
				) : null}
				<dl className="m-0 mt-2 flex flex-col gap-2.5">
					<div className="flex flex-col gap-0.5">
						<dt className="font-mono text-sm font-medium tracking-[0.1em] uppercase text-muted">
							{t('rotation.field.when')}
						</dt>
						<dd className="m-0 max-w-[70ch] text-base leading-relaxed text-ink-2">
							{t(`rotation.entry.${entry.key}.when`)}
						</dd>
					</div>
					<div className="flex flex-col gap-0.5">
						<dt className="font-mono text-sm font-medium tracking-[0.1em] uppercase text-muted">
							{t('rotation.field.why')}
						</dt>
						<dd className="m-0 max-w-[70ch] text-base leading-relaxed text-muted">
							{t(`rotation.entry.${entry.key}.why`)}
						</dd>
					</div>
				</dl>
			</>
		);
	};

	return (
		<Section id="rotation" title={t('rotation.title')}>
			<div className="flex flex-col gap-3.5">
				<Prose>{t('rotation.intent')}</Prose>
				<Prose>{t('rotation.economy')}</Prose>
			</div>

			<h3 className="m-0 mt-7 mb-3 font-mono text-sm font-semibold tracking-[0.1em] uppercase text-muted">
				{t('rotation.flow.title')}
			</h3>
			<Prose>{t('rotation.flow.intent')}</Prose>
			{/* The four target counts collected above the flow rather than only as chips inside it. They
			    are the answer to the question a reader arrives with — at how many does the button change
			    — and nineteen rungs is too far to scan for "three" when the list has already been read
			    once. Down in the flow the same counts are gates; up here they are an index. */}
			<p className="m-0 mt-3.5">
				<Pill>{t('rotation.crossover.rjw')}</Pill>
				<Pill>{t('rotation.crossover.sef')}</Pill>
				<Pill>{t('rotation.crossover.sck')}</Pill>
				<Pill>{t('rotation.crossover.sckOverRsk')}</Pill>
			</p>

			{/* The rail beside the rungs is the only drawing in the section, and it is two borders.
			    `charts/ResourceTrack.tsx` records why an SVG flow would have to be text-free — under
			    `preserveAspectRatio="none"` a `<text>` stretches with the box — and every node here is a
			    paragraph, so the SVG would be left drawing nothing but straight lines. A line is a
			    border, and a border is the only one of the two that stays attached to a card that has
			    just wrapped to six lines at 360px: a viewBox would need those heights measured after
			    layout, on every resize. `role="list"` because `list-style: none` drops list semantics in
			    WebKit, and the order is the entire point of an ordered list. */}
			<ol role="list" aria-label={t('rotation.flow.caption')} className="m-0 mt-5 flex list-none flex-col p-0">
				{FLOW.map((slot, index) => {
					const last = index === FLOW.length - 1;
					return (
						<li
							key={'fork' in slot ? slot.fork : slot.entry.key}
							className="grid grid-cols-[1.75rem_1fr] gap-x-3 sm:gap-x-4"
						>
							{/* Decorative: the number repeats the list's own counter and the line repeats the
							    fact that one `<li>` follows another. */}
							<div aria-hidden="true" className="flex flex-col items-center">
								<span className="flex h-7 w-7 items-center justify-center rounded-full border border-line bg-surface font-mono text-sm text-muted">
									{index + 1}
								</span>
								{last ? null : <span className="mt-1 w-px flex-1 bg-line" />}
							</div>
							<div className={last ? undefined : 'pb-4'}>
								{'fork' in slot ? (
									// Dashed, and a shade below the branches inside it, so the rung reads as a
									// container of choices rather than as a fourth kind of card.
									<div className="rounded-sm border border-dashed border-line bg-surface p-3 sm:p-3.5">
										<h4 className="m-0 font-mono text-base font-semibold text-ink">
											{t(`rotation.fork.${slot.fork}.title`)}
										</h4>
										<p className="m-0 mt-1.5 max-w-[70ch] text-base leading-relaxed text-muted">
											{t(`rotation.fork.${slot.fork}.detail`)}
										</p>
										<ul
											role="list"
											className={`m-0 mt-3 grid list-none gap-3 p-0 ${FORK_COLUMNS[slot.branches.length] ?? ''}`}
										>
											{slot.branches.map((branch) => (
												<li key={branch.key} className="rounded-sm border border-line bg-raised p-3">
													{card(branch, 'h5')}
												</li>
											))}
										</ul>
									</div>
								) : (
									<div className="rounded-sm border border-line bg-surface p-3 sm:p-3.5">{card(slot.entry, 'h4')}</div>
								)}
							</div>
						</li>
					);
				})}
			</ol>

			{/* The five things a rung cannot carry: why the brew is spent where it is, why the channel
			    needs three conditions, why one kick matters to everyone, which talents the list assumes,
			    and one correction the spec's own name invites. Separate notes rather than a closing
			    paragraph, because a reader checking one should not have to read past four. */}
			<div className="mt-6 flex flex-col gap-2.5">
				<Note>{t('rotation.notes.snapshot')}</Note>
				<Note>{t('rotation.notes.channel')}</Note>
				<Note>{t('rotation.notes.debuff')}</Note>
				<Note>{t('rotation.notes.talents')}</Note>
				<Note>{t('rotation.notes.mastery')}</Note>
			</div>
		</Section>
	);
}
