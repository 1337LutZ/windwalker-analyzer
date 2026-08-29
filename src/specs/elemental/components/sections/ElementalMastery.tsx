import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatClock } from '~/lib/format';
import type { Analysis, ElementalAuditResult, JudgmentCause } from '~/lib/types';

import {
	CauseLegend,
	CauseTag,
	DataGrid,
	Note,
	Prose,
	Section,
	SpellIcon,
	type GridRow,
} from '~/components/primitives';

import { elementalMasteryTalented } from './gates';

/**
 * Elemental Mastery, and only for a player who took it.
 *
 * **It is a talent**, tier four against Ancestral Swiftness and Echo of the Elements —
 * `ui/core/talents/trees/shaman.json:87-93` (`"fieldName": "elementalMastery"`, `rowIdx: 3`,
 * `colIdx: 0`, `spellId: 16166`), `proto/shaman.proto:18`, and gated in the sim itself at
 * `sim/shaman/talents.go:37` (`if !shaman.Talents.ElementalMastery { return }`). Ascendance, directly
 * above, is not. So this is the section that has to be able to decline, and the section that was
 * shipping a table for a button the player never had: all three committed fixtures carry a
 * `combatantinfo` talent list without 16166 in it.
 *
 * **Three states, not two.** The empty table means one thing for a player who took the talent — a
 * cooldown left on the bar for the whole pull — and something else entirely on a log with no talent
 * list, where the report cannot say whether it was ever taken. `hasElementalMastery` removes the
 * heading only for the first case's opposite, positive evidence that the talent was not taken; the
 * unreadable case keeps the heading and says which of the two it cannot tell apart.
 */
export default function ElementalMastery({ analysis }: { analysis: Analysis }) {
	const el = analysis as Analysis & ElementalAuditResult;
	const { elementalMastery } = el;
	const { t } = useReportCopy(analysis);
	// `false` never reaches here — the section does not render at all — so this is "taken" against
	// "cannot say", and the two differ only in what an empty table is allowed to claim.
	const talented = elementalMasteryTalented(analysis);

	const rows = useMemo<(GridRow & { cause: JudgmentCause })[]>(
		() =>
			[...elementalMastery.presses]
				.sort((a, b) => a.t - b.t)
				.map((press, i) => ({
					key: `${press.t}-${i}`,
					// The four named reasons are all the list's: the opener, the pairing, the set's proc, and the
					// two readings where Ascendance is either close enough to overlap anyway or far enough that
					// holding a ninety-second cooldown for it would cost more than it bought. `null` is the one
					// press nothing in the list wanted, which is the player's own.
					cause: (press.reason === null ? 'player' : 'rotation') as JudgmentCause,
					cells: {
						at: formatClock(press.t),
						// `ascReady` is passed on every row and read only by the two `off-*` sentences, which are
						// the ones that need it: an interpolation an arm does not name is simply not printed,
						// and branching the call per reason would be a second copy of the reason table.
						state: (
							<span className="inline-flex items-baseline">
								<CauseTag cause={press.reason === null ? 'player' : 'rotation'} />
								<span>
									{press.reason === null
										? t('elementalMastery.state.plain')
										: t(`elementalMastery.state.${press.reason}`, { ascReady: press.ascReadySec })}
								</span>
							</span>
						),
					},
				})),
		[elementalMastery.presses, t],
	);

	return (
		<Section id="elemental-mastery" title={t('elementalMastery.title')}>
			<Prose>
				<span className="inline-flex items-center gap-2 align-middle">
					<SpellIcon id={16166} size="sm" />
				</span>{' '}
				{t('elementalMastery.intent')}
			</Prose>

			<div className="mt-5">
				<DataGrid
					caption={t('elementalMastery.caption')}
					columns={[
						{ key: 'at', label: t('elementalMastery.columns.at'), width: '96px' },
						{ key: 'state', label: t('elementalMastery.columns.state') },
					]}
					rows={rows}
					empty={talented === true ? t('elementalMastery.noneTalented') : t('elementalMastery.noneUnknown')}
				/>
			</div>

			<div className="mt-3.5">
				<CauseLegend causes={rows.map((row) => row.cause)} />
			</div>

			{talented === null && (
				<div className="mt-5">
					<Note>{t('elementalMastery.unreadable')}</Note>
				</div>
			)}
		</Section>
	);
}
