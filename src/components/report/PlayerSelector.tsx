import type { FightPlayer } from '~/lib/wcl';

interface Props {
	/** Already narrowed to the Windwalkers in this pull. */
	players: FightPlayer[];
	value: string | null;
	onChange: (name: string) => void;
	fightName: string;
}

/**
 * Which Windwalker to read — and usually not a control at all.
 *
 * One Windwalker is the ordinary case, and asking someone to pick from a list of one is a step that
 * only exists to be clicked through, so it is shown as a sentence instead. None means the pull is
 * the wrong pull, which is worth saying plainly rather than rendering an empty picker that looks
 * broken.
 */
export default function PlayerSelector({ players, value, onChange, fightName }: Props) {
	if (players.length === 0) {
		return (
			<p className="m-0 max-w-[64ch] leading-relaxed text-ink-2">
				No Windwalker monk was in {fightName}. Pick another pull above — this reads one spec, and there is nothing in
				this fight for it to read.
			</p>
		);
	}

	if (players.length === 1) {
		return (
			<p className="m-0 max-w-[64ch] leading-relaxed text-ink-2">
				<span className="font-mono font-semibold text-ink">{players[0]!.name}</span> was the only Windwalker in{' '}
				{fightName}.
			</p>
		);
	}

	return (
		<ul
			aria-label={`Windwalkers in ${fightName}`}
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
							className={`flex min-h-11 w-full items-center rounded-sm border px-3 py-2 text-left font-mono text-base font-medium transition-colors ${
								selected ? 'border-kick bg-raised text-ink' : 'border-line bg-bg text-ink-2 hover:bg-raised'
							}`}
						>
							<span className="w-full truncate">{player.name}</span>
						</button>
					</li>
				);
			})}
		</ul>
	);
}
