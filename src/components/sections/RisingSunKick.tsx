import { useReportCopy } from '~/hooks/useReportCopy';
import { formatPercentValue, formatSecondsValue } from '~/lib/format';
import type { Analysis } from '~/lib/types';

import { DebuffTimeline } from '../charts';
import { Note, Prose, Section, SpellIcon, StatTile, StatTiles } from '../primitives';

/**
 * Rising Sun Kick: the debuff, and every second it was not on the target.
 *
 * It earns a section because its cost is not its own damage. The debuff is a flat increase to
 * everything the whole raid does to that target, so a drop is a raid-wide loss — which is exactly
 * what a row in a cast table cannot say.
 *
 * Uptime is measured against *engaged* time, not pull length. A pull where the boss is untargetable
 * for a phase is not a pull where the player let the debuff fall off, and charging them for it would
 * be the fabricated fault this report keeps refusing to print.
 *
 * There is no table of drops. The timeline below already plots every one of them against the clock
 * and names its length on hover, so a list underneath would be the same facts a second time, in the
 * form that shows the least — a column of timestamps cannot show that three drops were the same
 * phase transition.
 */
export default function RisingSunKick({ analysis }: { analysis: Analysis }) {
	const { debuff } = analysis;
	const { t, verdict, card } = useReportCopy(analysis);

	// Read off the metric rather than the section so the tile is coloured by the number it shows —
	// and stays neutral on a multi-target pull, where the report declines to grade it at all.
	const uptime = card.sections.debuff?.metrics.find((m) => m.key === 'rskUptime');

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
							<StatTile value={`${debuff.casts}`} label={t('debuff.kpi.casts')} />
							<StatTile
								value={formatSecondsValue(debuff.secondsLost)}
								label={t('debuff.kpi.lost')}
								grade={debuff.secondsLost > 0 ? 'bad' : 'good'}
							/>
						</StatTiles>
					</div>

					<div className="mt-4.5">
						<DebuffTimeline analysis={analysis} />
					</div>

					<div className="mt-5 flex flex-col gap-3.5">
						<Prose>
							<span className="inline-flex items-center gap-2 align-middle">
								<SpellIcon id={107428} size="sm" />
							</span>{' '}
							{verdict('debuff', {
								uptime: debuff.engagedUptimePct,
								casts: debuff.casts,
								lost: debuff.secondsLost,
							})}{' '}
							{debuff.drops.length === 0 ? t('debuff.dropsNone') : t('debuff.drops', { count: debuff.drops.length })}
						</Prose>

						{/* Two reasons the number may not mean what it looks like, each shown only when true. */}
						{debuff.intermissionSec > 0 ? (
							<Note>{t('debuff.intermission', { seconds: debuff.intermissionSec })}</Note>
						) : null}
						{debuff.singleTarget ? null : <Note>{t('debuff.multiTarget', { share: debuff.primaryDamageShare })}</Note>}
					</div>
				</>
			)}
		</Section>
	);
}
