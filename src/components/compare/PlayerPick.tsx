import { useTranslation } from 'react-i18next';

import type { ReportSlot } from '~/hooks/useReportSlot';
import type { SpecDefinition } from '~/lib/spec';

import { Callout } from '../primitives';
import { describeFailure } from '../report/describeFailure';
import FightSelector from '../report/FightSelector';
import PlayerSelector from '../report/PlayerSelector';

import PullKey from './PullKey';

/**
 * One slot's attempt and player, once the encounter above has been chosen.
 *
 * **The attempt picker appears only where the report made more than one.** A night with a single pull
 * of a boss has no question to ask, and a picker with one row in it is furniture that the reader has
 * to read before they can ignore it. Where there are several, `FightSelector` draws them: handed one
 * encounter's attempts it renders exactly one group, which is the shape it already had for a boss
 * pulled repeatedly.
 *
 * The attempts are the two reports' own and are deliberately not forced to match. A kill in one report
 * and the best wipe in the other is a comparison somebody may well want, and there is no honest way to
 * pair a seventh pull with a second one.
 */
export default function PlayerPick({
	slot,
	side,
	spec,
	label,
}: {
	slot: ReportSlot;
	side: 'a' | 'b';
	spec: SpecDefinition;
	label: string;
}) {
	const { t } = useTranslation('ui');

	return (
		<div className="flex flex-col gap-3">
			<PullKey side={side}>
				<span className="font-mono text-sm font-medium text-ink-2">{label}</span>
			</PullKey>

			{slot.attempts.length > 1 ? (
				<FightSelector
					fights={slot.attempts}
					difficultyNames={slot.fights.data?.difficultyNames ?? {}}
					value={slot.fightID}
					onChange={slot.chooseFight}
				/>
			) : null}

			{slot.players.isLoading ? (
				<p className="m-0 leading-relaxed text-muted">{t('steps.checkingRoster')}</p>
			) : slot.players.error ? (
				<Callout title={describeFailure(slot.players.error, t).title}>
					<p className="m-0">{describeFailure(slot.players.error, t).detail}</p>
				</Callout>
			) : (
				<PlayerSelector
					players={slot.roster}
					value={slot.playerName}
					onChange={slot.choosePlayer}
					fightName={slot.fight?.name ?? 'this pull'}
					specName={spec.displayName}
				/>
			)}
			{slot.error ? (
				<Callout title={describeFailure(slot.error, t).title}>
					<p className="m-0">{describeFailure(slot.error, t).detail}</p>
				</Callout>
			) : null}
		</div>
	);
}
