import { useReportCopy } from '~/hooks/useReportCopy';
import { formatPercentValue, formatSecondsValue } from '~/lib/format';
import type { Analysis } from '~/lib/types';

import DebuffTimeline from '../charts/DebuffTimeline';
import { abilityCooldownMs } from '~/specs/windwalker/lib';
import { usageTone } from '~/specs/windwalker/lib/score';

import { Note, Prose, Section, SpellIcon, StatTile, StatTiles } from '~/components/primitives';

/**
 * Rising Sun Kick: the debuff, and every second it was not on the target.
 *
 * It earns a section because its cost is not its own damage. The debuff is a flat increase to
 * everything the player and their clones put into that target, so a drop is paid for by every other
 * button in the rotation — which is exactly what a row in a cast table cannot say.
 *
 * Uptime is measured against the time the player had something to hit, not pull length. A pull where
 * there was nothing in range for a phase is not a pull where the player let the debuff fall off, and
 * charging them for it would be the fabricated fault this report keeps refusing to print.
 *
 * The three tiles and the chart under them are now one measurement: uptime, its remainder and the cast
 * ceiling are all fractions of contact time, and the chart's three tracks are those same stretches
 * drawn. `uptime% + lost/contact` is 100% by construction. What is still the *primary target's* alone
 * is the drop count, the intermission note and the miss ledger's rows, and every sentence that quotes
 * one of them names that enemy — reading the two scopes as one is what let a two-boss pull print 1.4s
 * lost beside 59% uptime, and what let a Galakras pull call five minutes of add waves "out of reach".
 *
 * There is no table of drops. The miss ledger carries a linked row for each one, so a column of the
 * same timestamps here would be the same facts twice — and the chart above deliberately no longer
 * plots them, because they are one enemy's gaps and it is about every enemy the player touched.
 */
export default function RisingSunKick({ analysis }: { analysis: Analysis }) {
	const { debuff } = analysis;
	const { t, verdict, card } = useReportCopy(analysis);

	// Read off the metric rather than the section so the tile is coloured by the number it shows —
	// and stays neutral on a multi-target pull, where the report declines to grade it at all.
	const uptime = card.sections.debuff?.metrics.find((m) => m.key === 'rskUptime');

	/**
	 * The kicks went out and the pull recorded no time to measure them against. A fifth sentence, and not
	 * new wording under an existing one.
	 *
	 * `rskUptime` is handed its value together with the span it was measured over, and `metricOf` refuses
	 * an empty span outright — the same refusal that stops nought overcap over nought graded time reading
	 * as a perfect score. So a pull that cast the kick and recorded no contact has no uptime, `gradeOf`
	 * answers `none`, and `verdict()` reached for the arm that says the kick was never cast — printed
	 * beside a tile reading the casts and above a sentence counting the windows they dropped.
	 *
	 * The same defect the Elemental's Earth Shock had, arrived at by the other of `metricOf`'s two
	 * refusals: there a sample under the floor, here an empty span. Both leave one string doing the work
	 * of two facts, and this section had it worse than that one — the *same key* is printed by the
	 * nought-casts branch below, where it is exactly true, and by the graded slot, where it is not.
	 *
	 * **Two facts, so two sentences.** "You never pressed this" asks for the button; "you pressed it, and
	 * the pull gave nothing to measure the uptime against" is a statement about what the log carries and
	 * asks for nothing. The new arm names the cast count so a reader can check it against the tile, and is
	 * phrased so the numeral needs no agreement.
	 *
	 * Gated on the metric rather than on the span, so the refusal stays the scorer's to make: this
	 * component and `metricOf` read the span through different fallbacks — `contactMs || engagedMs` here
	 * against `contactMs ?? engagedMs` there — and a pull with nought contact and a live engaged span is
	 * refused by the scorer while this file's own ceiling is drawn off the wider one. Reading the metric is
	 * what keeps the sentence and the letter agreeing whichever of the two the pull has. Only reachable
	 * under the nought-casts branch's `else`, so the two arms cannot both be candidates for one pull.
	 */
	const noContact = debuff.casts > 0 && uptime?.unmeasurable === true;

	/**
	 * The clock every figure in this section is a fraction of: the time the player was in contact with
	 * an enemy, whichever enemy that was.
	 *
	 * Named once and read three times — uptime, the time without it and the cast ceiling — because three
	 * expressions of "what the fight allowed" is how they came to disagree. `engagedMs` is the fallback
	 * and not the default: it is the *boss's* clock, and on a heavy-adds pull it describes a different
	 * fight from the one the numerators followed. Only the committed fixtures reach for it, and only
	 * because they predate `contactMs`.
	 */
	const measuredMs = debuff.contactMs || debuff.engagedMs;
	// The cooldown is the sim's own eight seconds, cited where it is declared. Rounded down: a ceiling of
	// 27.6 casts is one nobody can hit, and asking for 28 is asking for a kick the pull had no room for.
	const possibleKicks = Math.floor(measuredMs / abilityCooldownMs('rising-sun-kick'));

	/**
	 * Which enemy the primary-scoped halves of this section are about — the drops, the chart, the
	 * intermission — as opposed to the two tiles, which follow whatever the player was hitting.
	 *
	 * The enemy's own name where the report has one, because "the boss" is exactly the ambiguity this
	 * exists to remove on a pull with two of them. The generic phrase is the fallback, and it is what
	 * every committed fixture gets: they were captured before the field existed.
	 */
	const target =
		analysis.primaryTarget.name ?? t('debuff.target', { context: analysis.primaryTarget.gameID ? 'boss' : undefined });

	return (
		<Section id="debuff" title={t('debuff.title')}>
			<Prose>{t('debuff.intent')}</Prose>

			{debuff.casts === 0 ? (
				<div className="mt-5">
					<Note>{t('debuff.verdict', { context: 'none' })}</Note>
				</div>
			) : (
				<>
					<div className="mt-4.5">
						<StatTiles>
							<StatTile
								value={formatPercentValue(debuff.engagedUptimePct)}
								label={t('debuff.kpi.uptime')}
								grade={uptime && !uptime.unmeasurable ? uptime.grade : null}
							/>
							{/* `cast / possible`, where possible is the contact time divided by the cooldown.

						    Contact time and not the pull, because a kick cannot go out with nothing in reach —
						    dividing the whole pull would set a target the fight itself made impossible and call
						    the player short of it. It is also not the boss's clock, which is what this shipped
						    with: on a Galakras pull where the boss is reachable for 66s of 434s that ceiling was
						    8 kicks against the 38 actually cast, a tile reading `38 / 10` that cannot be right on
						    its face. Against contact time the same pull allows 39. */}
							<StatTile
								value={`${debuff.casts}`}
								suffix={` / ${possibleKicks}`}
								label={t('debuff.kpi.casts')}
								grade={usageTone(debuff.casts, possibleKicks)}
							/>
							{/* The uptime tile's own remainder — contact time whose enemy was not carrying the
							    debuff — so it wears the uptime's grade rather than one of its own. A rule of
							    "anything above zero is bad" was fair when this counted a boss's dropped windows
							    and is not now: a 93% pull leaves half a minute over, and painting that red would
							    contradict the green tile beside it about the same measurement. */}
							<StatTile
								value={formatSecondsValue(debuff.secondsLost)}
								label={t('debuff.kpi.lost')}
								grade={uptime && !uptime.unmeasurable ? uptime.grade : null}
							/>
						</StatTiles>
					</div>

					<div className="mt-4.5">
						<DebuffTimeline analysis={analysis} target={target} />
					</div>

					<div className="mt-5 flex flex-col gap-3.5">
						<Prose>
							<span className="inline-flex items-center gap-2 align-middle">
								<SpellIcon id={107428} size="sm" />
							</span>{' '}
							{/* The no-contact arm is spelled out at the call rather than assembled, because
							    `useReportCopy` picks its arm off a grade and a refused metric has none to pick
							    from. Without it the fallback was the nought-casts sentence — "Rising Sun Kick was
							    never cast in this pull" — printed beside a tile reading the casts. */}
							{noContact
								? t('debuff.verdict', { context: 'noContact', casts: debuff.casts })
								: verdict('debuff', {
										uptime: debuff.engagedUptimePct,
										casts: debuff.casts,
										lost: debuff.secondsLost,
									})}{' '}
							{/* Both sentences name the enemy, because both count that one enemy's windows while the
							    verdict in front of them counts every enemy the player touched. */}
							{debuff.drops.length === 0
								? t('debuff.dropsNone', { target })
								: t('debuff.drops', { count: debuff.drops.length, target })}
						</Prose>

						{/* Two reasons the number may not mean what it looks like, each shown only when true. */}
						{debuff.intermissionSec > 0 ? (
							<Note>{t('debuff.intermission', { seconds: debuff.intermissionSec, target })}</Note>
						) : null}
						{debuff.singleTarget ? null : <Note>{t('debuff.multiTarget', { share: debuff.primaryDamageShare })}</Note>}
					</div>
				</>
			)}
		</Section>
	);
}
