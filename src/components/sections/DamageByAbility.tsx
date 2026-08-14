import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatPercentValue } from '~/lib/format';
import type { Analysis } from '~/lib/types';

import { AbilityDamage } from '../charts';
import { Note, Pill, Prose, Section } from '../primitives';

/** Anything below this is a rounding artefact in a list of footnotes, not a contribution. */
const PASSIVE_FLOOR_PCT = 0.4;

/** Damage share per pressed button, with what no button produced listed separately underneath. */
export default function DamageByAbility({ analysis }: { analysis: Analysis }) {
	const { damage } = analysis;
	const { t } = useReportCopy(analysis);

	const passive = useMemo(() => {
		const byName = new Map<string, number>();
		for (const a of damage.abilities) {
			// Utility damage joins the passives: both are real damage that no damage decision produced.
			if (a.passive || a.utility) byName.set(a.name, (byName.get(a.name) ?? 0) + a.share);
		}
		return [...byName.entries()].filter(([, s]) => s >= PASSIVE_FLOOR_PCT).sort((a, b) => b[1] - a[1]);
	}, [damage.abilities]);

	// Rows arrive biggest first, so the leader is the first pressed one — the same row the chart puts
	// on top. Naming a passive here would credit the rotation for a trinket.
	const top = damage.abilities.find((a) => !a.passive && !a.utility && a.total > 0);

	return (
		<Section id="damage" title={t('damage.title')}>
			<Prose>{t('damage.intent')}</Prose>
			<div className="mt-5">
				{damage.abilities.length > 0 ? <AbilityDamage analysis={analysis} /> : <Note>{t('damage.none')}</Note>}
			</div>
			{damage.abilities.length > 0 ? (
				<div className="mt-5">
					{/* Raw numbers, not formatted ones: the sentence is copy, so the JSON decides how a total
					    and a share are written. */}
					<Prose>
						{t('damage.summary', {
							total: damage.eventTotal,
							dps: damage.dps,
							count: damage.abilities.length,
						})}
						{top ? ` ${t('damage.top', { name: top.name, share: top.share })}` : ''}
					</Prose>
				</div>
			) : null}
			{passive.length > 0 ? (
				<p className="mt-5 mb-0 max-w-[64ch] leading-relaxed text-ink-2">
					{t('damage.passive')}{' '}
					{passive.map(([name, s]) => (
						<Pill key={name}>
							{name} {formatPercentValue(s)}
						</Pill>
					))}
				</p>
			) : null}
		</Section>
	);
}
