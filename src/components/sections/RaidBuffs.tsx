import { useSpec } from '~/components/report/specContext';
import { useReportCopy } from '~/hooks/useReportCopy';
import { narrowRaidBuffs } from '~/lib/analysis/raidBuffs';
import { formatPercentValue } from '~/lib/format';
import type { Analysis, RaidBuffRow } from '~/lib/types';

import { DataGrid, Note, Pill, Prose, Section, SpellIcon } from '../primitives';

/**
 * The raid buffs this spec's damage rests on, one row per effect.
 *
 * Six rows and not sixteen, because the question is "did I have the spell power buff" and not "which
 * of four classes supplied it" — the simulator groups them the same way, into one exclusive effect
 * per stat, and two providers of one effect do not stack.
 *
 * **Which six is the spec's own answer**, taken from `spec.raidBuffEffects` rather than from the
 * engine's roster. The engine measures every effect the simulator groups, spec-neutrally; this narrows
 * that to the ones this spec's damage rests on, in the order it wants them, and takes the icon and the
 * "yours to fix" pill from the same declaration. That seam matters because the section reports *gaps*:
 * before it existed the Elemental report drew the Monk's list, and told a caster to chase a multiplier
 * on attack power while showing them no row at all for spell power.
 *
 * The copy is keyed on the spec for the same reason. What an effect is *worth* is a claim about a
 * rotation — five percent off the Fists of Fury channel, or off every cast in the pull — so the
 * sentences carry an i18next context, the mechanism `app.intro` and the Flame Shock verdicts use.
 *
 * Nothing here is graded. A missing raid buff is usually somebody else's to fix, and colouring a
 * reader's report red for their raid's composition would be scolding them for who logged on. The
 * self-provided rows carry a pill rather than a grade — for a monk Legacy of the Emperor and Legacy
 * of the White Tiger, for a shaman Burning Wrath, Elemental Oath and Grace of Air — so a gap in those
 * really is theirs.
 *
 * The important state is the one that is not a number. An effect the log said nothing about renders
 * "not reported" and never 0%, because those are different facts: a buff applied before the pull
 * that never drops emits no event for the entire fight, so silence is silence — see the module
 * comment in `~/lib/analysis/raidBuffs`.
 */
export default function RaidBuffs({ analysis }: { analysis: Analysis }) {
	const { t } = useReportCopy(analysis);
	const spec = useSpec();
	const { raidBuffs } = analysis;

	// Guarded on truthiness, not `!== undefined`: the committed fixtures are captured `analyse()`
	// output cast to `Analysis`, so on those this field simply is not there. The section still renders
	// its heading — the contents list is built from the same array that renders these sections, and a
	// nav entry pointing at a section that returned null is a link to nowhere.
	if (!raidBuffs) {
		return (
			<Section id="raid-buffs" title={t('raidBuffs.title')}>
				<Note>{t('raidBuffs.none')}</Note>
			</Section>
		);
	}

	// The spec's own rows, out of the engine's spec-neutral measurement — see the module comment.
	const { rows, deaths, selfGaps } = narrowRaidBuffs(raidBuffs, spec.raidBuffEffects);
	const unreported = rows.filter((row) => row.notReported);
	const selfMissing = rows.filter((row) => row.selfProvided && !row.notReported && row.gaps.length > 0);
	// `+5% Agility` to a monk and `+5% Intellect` to a shaman: one buff, and each spec reads the stat it
	// is paid in. The context falls back to the plain key for an effect whose name is the same either way.
	const nameOf = (row: RaidBuffRow): string => t(`raidBuffs.effects.${row.key}`, { context: spec.key });

	return (
		<Section id="raid-buffs" title={t('raidBuffs.title')}>
			<Prose>{t('raidBuffs.intent', { context: spec.key })}</Prose>

			<div className="mt-4.5">
				<DataGrid
					caption={t('raidBuffs.caption', { context: spec.key })}
					minWidth="720px"
					columns={[
						{ key: 'buff', label: t('raidBuffs.columns.buff'), width: '20rem' },
						{ key: 'uptime', label: t('raidBuffs.columns.uptime'), align: 'right', width: '7rem' },
						{ key: 'source', label: t('raidBuffs.columns.source') },
						{ key: 'state', label: t('raidBuffs.columns.state'), card: 'wide' },
					]}
					rows={rows.map((row) => ({
						key: row.key,
						// A band, not a grade. `warn` marks the rows that are not simply fine, and the two that
						// are the player's own are the ones the pill calls out — the colour says "look here",
						// the copy says whose it is.
						band: row.notReported ? undefined : row.gaps.length > 0 ? 'warn' : 'ok',
						cells: {
							buff: (
								<span className="inline-flex items-center gap-2.5">
									<SpellIcon id={row.iconId} size="sm" />
									<span>{nameOf(row)}</span>
									{row.selfProvided ? <Pill>{t('raidBuffs.yours')}</Pill> : null}
								</span>
							),
							// The whole point of the section: silence renders as words, never as a number that
							// would read as a fault the log never demonstrated.
							uptime: row.notReported ? (
								<span className="text-muted">{t('raidBuffs.notReported')}</span>
							) : (
								formatPercentValue(row.uptimePct)
							),
							source: row.notReported ? '—' : row.providers.join(', '),
							state: <State row={row} specKey={spec.key} t={t} />,
						},
					}))}
				/>
			</div>

			<div className="mt-5 flex flex-col gap-3.5">
				{/* Each caveat appears only when it is true of this pull, so a clean pull reads short. */}
				{selfGaps > 0 ? (
					<Prose>
						{t('raidBuffs.self', {
							count: selfMissing.length,
							buffs: selfMissing.map(nameOf).join(' and '),
						})}
					</Prose>
				) : null}
				{unreported.length > 0 ? (
					<Note>{t('raidBuffs.notReportedNote', { buffs: unreported.map(nameOf).join(', ') })}</Note>
				) : null}
				{deaths > 0 ? <Note>{t('raidBuffs.deaths', { count: deaths })}</Note> : null}
				<Note>{t('raidBuffs.excluded', { context: spec.key })}</Note>
				<Note>{t('raidBuffs.debuffs', { context: spec.key })}</Note>
			</div>
		</Section>
	);
}

/**
 * The sentence for one row: what it was worth, then what actually happened to it.
 *
 * The worth is stated even on a row that was up all pull, because a reader who has never had the
 * buff drop still needs to know which of the six to chase when one day it does.
 */
function State({ row, specKey, t }: { row: RaidBuffRow; specKey: string; t: ReturnType<typeof useReportCopy>['t'] }) {
	// What a buff is worth is a claim about a rotation, so it is keyed on the spec: five percent off the
	// Fists of Fury channel and five percent off every cast in the pull are not the same sentence.
	const worth = t(`raidBuffs.worth.${row.key}`, { context: specKey });
	if (row.notReported) return <span className="text-muted">{worth}</span>;

	const lost = row.gaps.reduce((sum, gap) => sum + gap.seconds, 0);
	const first = row.gaps[0];

	return (
		<span>
			{/* A buff that was not up at the pull is named by when it did go out, which is the actionable
			    half — "60 seconds in" is a thing to fix, "94% uptime" is not. */}
			{row.gaps.length === 0 || first === undefined
				? t('raidBuffs.covered')
				: row.fromPull
					? t('raidBuffs.fromPull')
					: t('raidBuffs.late', { seconds: first.seconds })}{' '}
			{row.gaps.length > 0 ? t('raidBuffs.gaps', { count: row.gaps.length, seconds: lost }) : null}{' '}
			<span className="text-muted">{worth}</span>
		</span>
	);
}
