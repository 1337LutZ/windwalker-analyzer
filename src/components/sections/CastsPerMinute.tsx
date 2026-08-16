import { useMemo } from 'react';

import type { ReportCopy } from '~/hooks/useReportCopy';
import { useReportCopy } from '~/hooks/useReportCopy';
import { formatDecimal } from '~/lib/format';
import type { Analysis, CastRow } from '~/lib/types';

import { Bar, DataGrid, Prose, Section, SpellIcon, type GridRow } from '../primitives';

const gateLabel = (c: CastRow, t: ReportCopy['t']): string =>
	c.gate === 'cooldown'
		? // A cooldown-gated ability with no cooldown on record is the registry's business, not a
			// number to print: `${null}s` reads as a measurement.
			c.cooldownSec === null
			? t('casts.gate.cooldown')
			: t('casts.gate.cooldownSec', { seconds: c.cooldownSec })
		: // Named per resource rather than lumped together as "resource": a reader who knows the spec
			// knows that chi is what Jab *makes* and energy is what it spends, and the column is the one
			// place the report says which of the two holds a button back.
			c.gate === 'chi' || c.gate === 'energy' || c.gate === 'conditional'
			? t(`casts.gate.${c.gate}`)
			: '—';

/**
 * Pressed for something other than damage, and so kept out of the rate table.
 *
 * By cast id rather than by a flag on the row, because `CastRow` carries the gate rather than the
 * ability object. Flying Serpent Kick is the only one: a movement button whose cast rate is not a
 * decision anyone makes about damage.
 */
const UTILITY_IDS = new Set([101545]);

/** Tiger Palm, whose target this report can compute downwards rather than up. */
const TIGER_PALM_ID = 100787;

/** `Combo Breaker: Tiger Palm`, the buff that makes one free — matching the aura in the spec. */
const COMBO_BREAKER_TIGER_PALM_ID = 118864;

/**
 * What Tiger Palm was worth pressing in this pull, against what it actually was.
 *
 * `earned` counts every Combo Breaker proc that *happened*, not the ones that were taken. Building
 * it from presses instead was an inversion: a player who let procs expire had a smaller `onProc`,
 * so a smaller target, so a better-looking row — the table quietly advised them to keep ignoring
 * them. A proc is a free global whether or not anyone reached for it.
 *
 * `applied` and `refresh` are still what the player did, because there is no honest count of the
 * refreshes a pull *needed*: that depends on when the buff was allowed to lapse, which is what
 * Tiger Power uptime measures instead.
 */
interface TigerPalmBudget {
	casts: number;
	earned: number;
}

function tigerPalmBudget(analysis: Analysis): TigerPalmBudget {
	const { filler, comboBreaker } = analysis;
	const procs = comboBreaker.find((cb) => cb.id === COMBO_BREAKER_TIGER_PALM_ID)?.procs;
	return {
		casts: filler.casts,
		// Falling back to the presses is the old behaviour, and it is the right fallback: without the
		// proc aura in the log there is nothing better to say, and it never reads as more than it is.
		earned: (procs ?? filler.onProc) + filler.applied + filler.refresh,
	};
}

/**
 * Abilities that get a section of their own, by cast id.
 *
 * The cast table is a summary; these four are argued about at length further down, and a reader who
 * spots a bad row there should not have to go looking for where it is explained. Anything not in
 * here has no deeper page and stays plain text rather than becoming a link to nowhere.
 */
const DEEP_DIVE: Record<number, string> = {
	// `fof`, not `fists-of-fury`: this is the section's id, and the heading it addresses is
	// `fof-heading`. The other three in this map were right and this one silently linked nowhere.
	113656: 'fof',
	100787: 'tiger-palm',
	122470: 'karma',
	107428: 'debuff',
};

/**
 * The rate this ability could have run at, in the same units as `cpm` — casts per *active* minute.
 *
 * Only a cooldown gives an ability a ceiling. A chi spender has no rate it should be hitting: it is
 * limited by resources and by what the priority list wanted at that moment, and inventing a target
 * for it would be the same fabricated indictment the Fists of Fury note warns about. Those rows get
 * no bar rather than a made-up one.
 */
function optimalCpm(c: CastRow, budget: TigerPalmBudget): number | null {
	// Tiger Palm is a budget, not a ceiling: it earns its global only on a Combo Breaker proc or to
	// keep Tiger Power up, so its target is the presses that were worth making — below what was
	// observed whenever the button is being spammed. The gap is globals to give back, not casts to
	// add, which is the opposite of every cooldown in the table.
	if (c.id === TIGER_PALM_ID && budget.casts > 0) {
		return (c.cpm * budget.earned) / budget.casts;
	}
	// A cooldown is a ceiling whatever gates it. Fists of Fury and Touch of Karma are `conditional`
	// because *when* they go out is a judgement the log cannot second-guess — but both still have a
	// hard recharge, and "cast 3 times in a pull that allowed 9" is a fact rather than a verdict.
	// What the gate changes is how the shortfall is described, not whether it can be shown.
	return c.cooldownSec ? 60 / c.cooldownSec : null;
}

/**
 * How close a row ran to its target, in either direction.
 *
 * Overshooting is a fault too — for Tiger Palm it is the whole fault — so anything meaningfully past
 * the target reads as a miss rather than as a full bar. Nothing reaches exactly 100% on a cooldown:
 * the last cast before the boss dies has nowhere to go, and a cooldown that comes up mid-channel
 * waits, so four fifths and up is "played on cooldown".
 */
function rateTone(achieved: number): 'kick' | 'brew' | 'miss' {
	if (achieved > OVERSHOT) return 'miss';
	return achieved >= 80 ? 'kick' : achieved >= 55 ? 'brew' : 'miss';
}

/**
 * Past this, a row is overshooting rather than merely off its target.
 *
 * One number, because the bar and the two numeric cells beside it are three views of one verdict.
 * They were 115 and 130, so a row at 120% drew a red bar next to amber numbers and left the reader
 * deciding which of the two the report meant.
 */
const OVERSHOT = 130;

/**
 * The ability's name, linked to its own section when it has one.
 *
 * A real anchor rather than a click handler: it is a jump to a place on this page, so it should
 * middle-click, right-click and keyboard like every other link. `scroll-mt` on the headings already
 * keeps the landing clear of the sticky bar.
 */
function nameCell(c: CastRow) {
	const section = DEEP_DIVE[c.id];
	const label = (
		<>
			<SpellIcon id={c.id} size="sm" />
			<span>{c.name}</span>
		</>
	);
	return section === undefined ? (
		<span className="flex items-center gap-2">{label}</span>
	) : (
		<a
			href={`#${section}-heading`}
			className="flex items-center gap-2 rounded-sm underline decoration-line underline-offset-4 transition-colors hover:decoration-kick hover:text-ink"
		>
			{label}
		</a>
	);
}

/**
 * How to colour a `found / target` pair.
 *
 * Landing on the target is the good outcome, so both halves go green there — colouring only the
 * observed number would leave the reader checking which of the two the colour belonged to. Off the
 * target, the observed number carries the verdict and the target stays quiet: the target is not the
 * thing that went wrong.
 *
 * The band is deliberately wide. Nothing lands exactly on a cooldown's ceiling — the last cast
 * before the boss dies has nowhere to go — so within a tenth either way is "on it", and only a
 * clear miss in either direction goes red.
 */
function pairTone(achieved: number | null): { found: string; target: string } {
	if (achieved === null) return { found: 'text-ink', target: 'text-muted' };
	if (Math.abs(achieved - 100) <= 10) return { found: 'text-kick', target: 'text-kick' };
	if (achieved < 55 || achieved > OVERSHOT) return { found: 'text-miss', target: 'text-muted' };
	return { found: 'text-brew', target: 'text-muted' };
}

/**
 * What was pressed against what should have been, as a percentage, or null when there is no target.
 *
 * A target of zero is not "on target". It is Tiger Palm on a pull that earned nothing with it — no
 * Combo Breaker proc, no Tiger Power application, no refresh — so every press was waste. Reading
 * that as 100% painted the worst row on the table green beside a cell reading `41 / 0`. Anything
 * pressed against a budget of nothing is unbounded overshoot, which every band below already sends
 * to `miss`; only a row that was never pressed either is genuinely on its target of zero.
 */
function achievedPct(c: CastRow, budget: TigerPalmBudget): number | null {
	const optimal = optimalCpm(c, budget);
	if (optimal === null) return null;
	if (optimal > 0) return (c.cpm / optimal) * 100;
	return c.cpm > 0 ? Number.POSITIVE_INFINITY : 100;
}

/**
 * The count cell, in the same `found / target` shape as the rate beside it — whole casts, because
 * "eleven presses too many" is the unit a reader can act on in a way "3.2 cpm too many" is not.
 */
function castsCell(c: CastRow, budget: TigerPalmBudget, activeMin: number) {
	const optimal = optimalCpm(c, budget);
	const tone = pairTone(achievedPct(c, budget));
	return (
		<span className="tabular whitespace-nowrap">
			<b className={`font-semibold ${tone.found}`}>{c.count}</b>
			{optimal === null ? null : <span className={tone.target}> / {Math.round(optimal * activeMin)}</span>}
		</span>
	);
}

/**
 * The rate cell: what was pressed, and what should have been, in one place.
 *
 * `11.9 / 13.0` reads as a shortfall and `21.4 / 6.0` reads as a surplus without the reader having
 * to know which abilities work which way. A row with no target shows the rate alone rather than a
 * dash against nothing.
 */
function rateCell(c: CastRow, budget: TigerPalmBudget) {
	const optimal = optimalCpm(c, budget);
	const tone = pairTone(achievedPct(c, budget));
	return (
		<span className="tabular whitespace-nowrap">
			<b className={`font-semibold ${tone.found}`}>{formatDecimal(c.cpm)}</b>
			{optimal === null ? null : <span className={tone.target}> / {formatDecimal(optimal)}</span>}
		</span>
	);
}

/**
 * The bar for one row: how much of its own ceiling the ability reached, or nothing when it has none.
 *
 * The share is shown as text beside the bar as well, because the bar's meaning changed — a reader
 * who saw the old chart would otherwise still read it as "relative to the biggest row".
 */
function barCell(c: CastRow, budget: TigerPalmBudget, t: ReportCopy['t']) {
	const optimal = optimalCpm(c, budget);
	if (optimal === null) {
		return <span className="text-sm text-muted">{t('casts.noCeiling')}</span>;
	}
	// Not `share`, which clamps to 100 — overshooting has to stay visible as overshooting. Read
	// through `achievedPct` so the bar, the percentage beside it and the two numeric cells cannot
	// disagree about what this row achieved.
	const achieved = achievedPct(c, budget) ?? 100;
	return (
		<span className="flex items-center gap-2">
			<span className="min-w-0 flex-1">
				<Bar pct={Math.min(achieved, 100)} tone={rateTone(achieved)} />
			</span>
			<span className="tabular shrink-0 font-mono text-sm text-muted">
				{Number.isFinite(achieved) ? `${Math.round(achieved)}%` : '—'}
			</span>
		</span>
	);
}

/**
 * Cast rate per ability, with what limits each button.
 *
 * The graded sentence is `verdict`'s, not this component's: how much of the pull was spent pressing
 * something is a threshold question, and the threshold lives in `lib/score`.
 */
export default function CastsPerMinute({ analysis }: { analysis: Analysis }) {
	const { cpm } = analysis;
	const { t, verdict, gradeOf } = useReportCopy(analysis);

	// Utility presses are left out for the same reason they are left out of the damage comparison:
	// Flying Serpent Kick is a movement button, and a cast rate for it invites a judgement about a
	// rate nobody was aiming for.
	const gcdCasts = useMemo(
		() => analysis.casts.filter((c) => c.count > 1 && c.onGcd && !UTILITY_IDS.has(c.id)),
		[analysis.casts],
	);
	// `cpm` is per active minute, so a target count has to be converted back through the same clock.
	const activeMin = analysis.cpm.activeMs / 60_000;
	const budget = useMemo(() => tigerPalmBudget(analysis), [analysis]);

	const rows = useMemo<GridRow[]>(
		() =>
			gcdCasts.map((c) => ({
				key: String(c.id),
				cells: {
					name: nameCell(c),
					// Each row against its own ceiling, not against the fastest row in the table: Jab at 21
					// cpm and Rising Sun Kick at 6 are not competing, and barring them on one scale said
					// only that Jab is pressed more often — which the rate column already said.
					bar: barCell(c, budget, t),
					// Observed against its target in one cell, so the gap is read without crossing columns.
					rate: rateCell(c, budget),
					casts: castsCell(c, budget, activeMin),
					gate: gateLabel(c, t),
				},
			})),
		[gcdCasts, budget, activeMin, t],
	);

	// Built as a list and joined rather than laid out in JSX: two of these sentences only exist on
	// some pulls, and a conditional sitting between two text nodes eats the space between them.
	// A pull with no globals to measure gets the graded sentence's `none` variant and nothing else —
	// "Active for 0% of the pull" is the "0 of 0" this layer exists to stop.
	const sentences = [
		verdict('casts', { used: cpm.gcdUtilisationPct, cpm: cpm.totalCpm }),
		...(gradeOf('casts') === 'none'
			? []
			: [
					t('casts.activeTime', { active: cpm.activePct }),
					t('casts.presses', {
						onGcd: cpm.onGcdCasts,
						offGcd: cpm.offGcdCasts,
						active: cpm.activeMs,
						total: analysis.durationMs,
					}),
				]),
		// The deduction behind the figure, shown rather than silently applied — a reader who counts the
		// presses in the table below and divides will otherwise get a different number and trust that
		// one. Only on a pull that has some: nothing deducted needs no explanation. `?? 0` because a
		// captured fixture predates the field and carries `undefined`.
		...((cpm.wastedGcds ?? 0) > 0 ? [t('casts.wastedGcds', { count: cpm.wastedGcds ?? 0 })] : []),
		...(cpm.channelSec > 0 ? [t('casts.channel', { seconds: cpm.channelSec })] : []),
		t('casts.barCaveat'),
		t('casts.caveat'),
	];

	return (
		<Section id="cpm" title={t('casts.title')}>
			<div className="mb-5">
				<Prose>{t('casts.intent')}</Prose>
			</div>
			<DataGrid
				caption={t('casts.caption')}
				columns={[
					{ key: 'name', label: t('casts.columns.name'), width: '150px' },
					{ key: 'bar', label: t('casts.columns.bar'), hideLabel: true },
					{
						key: 'rate',
						label: t('casts.columns.rate'),
						align: 'right',
						width: '104px',
					},
					{
						key: 'casts',
						label: t('casts.columns.casts'),
						align: 'right',
						width: '64px',
					},
					{
						key: 'gate',
						label: t('casts.columns.gate'),
						align: 'right',
						width: '120px',
					},
				]}
				rows={rows}
				empty={t('casts.empty')}
			/>
			<div className="mt-5">
				<Prose>{sentences.join(' ')}</Prose>
			</div>
		</Section>
	);
}
