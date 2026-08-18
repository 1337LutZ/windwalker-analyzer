import { useReportCopy } from '~/hooks/useReportCopy';
import type { Analysis } from '~/lib/types';
import { runeOfReOriginationEquipped } from '~/lib/view/rotationFlow';

import { Callout } from '../primitives';

/** Warnings about the Rune that change how the reference rotation should be read. */
export default function SummaryWarning({ analysis }: { analysis: Analysis }) {
	const { t } = useReportCopy(analysis);
	const fromGear = runeOfReOriginationEquipped(analysis.gear.slots);
	// A proc proves the Rune was equipped when gear was not reported. Otherwise keep the unknown state
	// quiet rather than turning a missing combatantinfo event into an equipment error.
	const rune = fromGear ?? (analysis.procs.procs > 0 ? true : null);

	if (rune === false) {
		return (
			<Callout title={t('summary.warning.runeMissing.title')}>
				<p className="m-0">{t('summary.warning.runeMissing.body')}</p>
			</Callout>
		);
	}

	const nonMasteryStats = (['Haste', 'Crit'] as const).filter((stat) => (analysis.procs.statMix[stat] ?? 0) > 0);
	if (
		rune !== true ||
		analysis.procs.procs === 0 ||
		nonMasteryStats.length === 0 ||
		(analysis.procs.statMix.Mastery ?? 0) > 0
	) {
		return null;
	}
	const stat = nonMasteryStats.join(' and ');

	return (
		<Callout title={t('summary.warning.runeNoMastery.title')}>
			<p className="m-0">{t('summary.warning.runeNoMastery.body', { count: analysis.procs.procs, stat })}</p>
		</Callout>
	);
}
