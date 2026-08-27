import { useTranslation } from 'react-i18next';

import type { EncounterGroup } from '../report/encounterGroups';

/**
 * The one encounter both pulls are read at.
 *
 * **One selection, not two, and that is a rule about what a comparison means rather than a saving in
 * clicks.** Every threshold the scorecard grades against is calibrated on a rotation being asked for
 * the same things: an add wave asks for different presses than a boss, and a fight with a submerge
 * gives back globals a patchwerk pull never offers. Two different bosses produce two honest reports
 * and a difference between them that is mostly the difference between the fights.
 *
 * **Offered only where both reports have the boss.** The intersection rather than the union, because a
 * row naming an encounter one of the two reports never pulled is a row that cannot be chosen, and a
 * disabled row asks the reader to work out which report is missing it. Where the two slots hold the
 * same report the intersection is simply that report's list.
 *
 * Which *attempt* of it each report contributes is still a per-slot question, and stays one: a night
 * with six wipes and a kill has an obvious answer for each report and no reason to force them to
 * match.
 */
export default function EncounterSelector({
	encounters,
	value,
	onChange,
}: {
	encounters: readonly EncounterGroup[];
	value: string | null;
	onChange: (key: string) => void;
}) {
	const { t } = useTranslation('ui');

	if (encounters.length === 0) {
		return <p className="m-0 max-w-[64ch] leading-relaxed text-ink-2">{t('steps.noSharedEncounter')}</p>;
	}

	return (
		<ul aria-label={t('steps.encounter')} className="m-0 flex list-none flex-wrap gap-2 p-0">
			{encounters.map((group) => {
				const selected = group.key === value;
				return (
					<li key={group.key}>
						<button
							type="button"
							aria-pressed={selected}
							onClick={() => onChange(group.key)}
							className={`min-h-11 cursor-pointer rounded-sm border px-3 py-2 text-left text-sm transition-colors ${
								selected ? 'border-kick bg-raised text-ink' : 'border-line bg-bg text-ink-2 hover:bg-raised'
							}`}
						>
							{group.name}
						</button>
					</li>
				);
			})}
		</ul>
	);
}
