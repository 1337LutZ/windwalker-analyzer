import type { FightPlayer } from '~/lib/wcl';

import { Prose } from '../primitives';
import { singleLineChoiceClass } from '../primitives/controls';

interface Props {
	/** Already narrowed to this spec's players in the pull. */
	players: FightPlayer[];
	value: string | null;
	onChange: (name: string) => void;
	fightName: string;
	/** The spec's display name, so the copy names it instead of hardcoding a class. */
	specName: string;
}

/**
 * Which player of this spec to read — and usually not a control at all.
 *
 * One player is the ordinary case, and asking someone to pick from a list of one is a step that only
 * exists to be clicked through, so it is shown as a sentence instead. None means the pull is the
 * wrong pull, which is worth saying plainly rather than rendering an empty picker that looks broken.
 */
export default function PlayerSelector({ players, value, onChange, fightName, specName }: Props) {
	if (players.length === 0) {
		return (
			<Prose>
				No {specName} was in {fightName}. Pick another pull above — this reads one spec, and there is nothing in this
				fight for it to read.
			</Prose>
		);
	}

	if (players.length === 1) {
		return (
			<Prose>
				<span className="font-mono font-semibold text-ink">{players[0]!.name}</span> was the only {specName} in{' '}
				{fightName}.
			</Prose>
		);
	}

	return (
		<ul
			aria-label={`${specName}s in ${fightName}`}
			className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2 lg:grid-cols-3"
		>
			{players.map((player) => {
				const selected = player.name === value;
				return (
					<li key={player.id}>
						<button
							type="button"
							aria-pressed={selected}
							onClick={() => onChange(player.name)}
							className={singleLineChoiceClass(selected)}
						>
							<span className="w-full truncate">{player.name}</span>
						</button>
					</li>
				);
			})}
		</ul>
	);
}
