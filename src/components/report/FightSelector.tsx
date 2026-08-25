import { Collapsible } from '@base-ui/react/collapsible';
import { useTranslation } from 'react-i18next';

import type { FightWithRoster } from '~/lib/wcl';

import { difficultyLabel, fmt } from '../format';
import { groupByEncounter } from './encounterGroups';

interface Props {
	fights: FightWithRoster[];
	/**
	 * The zone's difficulty names by id. Passed in rather than looked up from a table here, because
	 * the ids mean different things per game flavour and only the zone knows which.
	 */
	difficultyNames: Record<number, string>;
	value: number | null;
	onChange: (fightID: number) => void;
}

/**
 * Which pull to read.
 *
 * Two rules do most of the work here. The list is grouped by encounter, one row per boss rather than
 * one per pull, which is both how a raid night is actually remembered and what keeps the picker
 * short enough to need no scrolling box of its own — a nested scroller on a phone swallows the
 * gesture that was meant to scroll the page. And expanding a group is inspection, not choosing: the
 * expander is a separate control from the row that selects, so opening a boss to look at its wipes
 * never moves the selection out from under you.
 */
export default function FightSelector({ fights, difficultyNames, value, onChange }: Props) {
	const { t } = useTranslation('ui');
	const groups = groupByEncounter(fights);

	return (
		<ul aria-label={t('app.fightList')} className="m-0 flex list-none flex-col gap-2 p-0">
			{groups.map((group) => {
				// The row stands for whatever is selected inside it, so a specific attempt picked out of
				// the expander is still what the group reports once it is closed again.
				const shown = group.attempts.find((attempt) => attempt.id === value) ?? group.representative;
				const selected = shown.id === value;

				return (
					<li key={group.key}>
						<Collapsible.Root
							className={`overflow-hidden rounded-sm border ${selected ? 'border-kick' : 'border-line'}`}
						>
							<div className="flex flex-col sm:flex-row sm:items-stretch">
								<button
									type="button"
									aria-pressed={selected}
									onClick={() => onChange(shown.id)}
									className={`flex min-h-11 flex-1 flex-col items-start justify-center gap-1 px-3 py-2.5 text-left transition-colors ${
										selected ? 'bg-raised' : 'bg-bg hover:bg-raised'
									}`}
								>
									<span className={`font-mono text-base font-semibold ${selected ? 'text-ink' : 'text-ink-2'}`}>
										{group.name}
									</span>
									<span className="font-mono text-sm text-muted">{attemptSummary(shown, difficultyNames, t)}</span>
								</button>

								{group.attempts.length > 1 ? (
									<Collapsible.Trigger className="flex min-h-11 items-center justify-between gap-2 border-t border-line bg-bg px-3 py-2 font-mono text-sm text-ink-2 transition-colors hover:bg-raised sm:w-40 sm:border-t-0 sm:border-l">
										<span>
											{group.attempts.length} pulls
											{/* Out of context, "4 pulls" names nothing; the visible text still leads, so
											    voice control matches on it. */}
											<span className="sr-only"> of {group.name}</span>
										</span>
										<span aria-hidden="true" className="transition-transform data-[panel-open]:rotate-180">
											&#9662;
										</span>
									</Collapsible.Trigger>
								) : null}
							</div>

							<Collapsible.Panel>
								<ul
									aria-label={`Every attempt at ${group.name}`}
									className="m-0 flex list-none flex-col gap-1 border-t border-line bg-surface p-2"
								>
									{group.attempts.map((attempt, index) => {
										const picked = attempt.id === value;
										return (
											<li key={attempt.id}>
												<button
													type="button"
													aria-pressed={picked}
													onClick={() => onChange(attempt.id)}
													className={`flex min-h-11 w-full flex-col items-start justify-center gap-0.5 rounded-sm border px-3 py-2 text-left transition-colors ${
														picked ? 'border-kick text-ink' : 'border-transparent text-ink-2 hover:border-line'
													}`}
												>
													<span className="font-mono text-base font-medium">Pull {index + 1}</span>
													<span className="font-mono text-sm text-muted">
														{attemptSummary(attempt, difficultyNames, t)}
													</span>
												</button>
											</li>
										);
									})}
								</ul>
							</Collapsible.Panel>
						</Collapsible.Root>
					</li>
				);
			})}
		</ul>
	);
}

/**
 * How a pull ended, how long it lasted, and at what size and mode.
 *
 * A wipe carries the percentage the encounter had left, because "wiped at 3%" and "wiped at 80%" are
 * different pulls to look at and the duration alone does not separate them.
 */
/**
 * One attempt, in a line: how it ended, how long it ran, and which mode.
 *
 * `t` is threaded in rather than reached for, because this is a plain function called from inside the
 * render and cannot hold a hook. The outcome words come from `ui.common` — the same three the report
 * header prints once a pull is open, so the picker and the header cannot disagree about what a wipe
 * is called.
 */
function attemptSummary(
	fight: FightWithRoster,
	difficultyNames: Record<number, string>,
	t: ReturnType<typeof useTranslation>['t'],
): string {
	const result = fight.kill
		? t('common.kill')
		: typeof fight.fightPercentage === 'number'
			? t('common.wipeAt', { pct: fight.fightPercentage })
			: t('common.wipe');
	return `${result} · ${fmt(fight.endTime - fight.startTime)} · ${difficultyLabel(fight.difficulty, fight.size, difficultyNames)}`;
}
