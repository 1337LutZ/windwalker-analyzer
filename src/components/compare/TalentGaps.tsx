import { useTranslation } from 'react-i18next';

import type { TalentGap } from '~/lib/compare';
import TALENTS from '~/generated/talents.json';

import { Note } from '../primitives';
import { iconUrl } from '../primitives/spellIcon';
import { useSpec } from '../report/specContext';

import PullKey from './PullKey';

/** The generated map's payload, keyed by class slug — see `scripts/build-talent-map.mjs`. */
const TREES = TALENTS.talents as Record<string, { id: number; name: string; icon?: string }[][]>;

/**
 * The whole talent tree, six rows of three, with the border on each choice saying who took it.
 *
 * **The tree rather than the picks, because the unpicked choices are the context.** A block listing
 * what the two players brought says they differ at row six; the tree says one took Rushing Jade Wind
 * and the other took Invoke Xuen *and neither took Chi Torpedo*, which is the shape of the decision.
 * Every figure further down the page is downstream of these rows, and until now the page reported
 * their consequences without ever naming them — a talent the other player took instead read as a
 * button this one declined to press.
 *
 * **Four states, carried by the border alone.** Both took it, so it is neutral; one of them took it,
 * so it wears that player's own colour, the same one every mark on the page uses for them; neither
 * did, so it recedes. Nothing else in the cell changes, which is what lets a reader take in six rows
 * at a glance and see only where the two builds part.
 *
 * **The data is generated, not written here.** `generated/spells.json` names ten of the monk's
 * eighteen talents — it is built from what the sim and the logs reference, and nobody references a
 * talent they did not take — so a tree drawn from it would have eight holes. `build-talent-map.mjs`
 * reads wowsims-mop's own talent picker data instead, which carries the rows, the columns and every
 * choice on them. Writing the missing eight out by hand was the alternative, and it is the kind of
 * unverifiable claim this repository refuses everywhere else.
 */
export default function TalentGaps({ gap, players }: { gap: TalentGap; players: { a: string; b: string } }) {
	const { t } = useTranslation('report');
	const spec = useSpec();
	const tree = TREES[spec.classSlug];

	// A pull that cannot say what was taken must not be drawn as a tree where nothing was.
	if (!gap.known) return <Note>{t('compare.talents.unknown')}</Note>;
	// A class the generated map has no tree for draws nothing rather than an empty grid claiming there
	// are no talents to choose between.
	if (tree === undefined) return null;

	const mine = new Set(gap.a);
	const theirs = new Set(gap.b);

	return (
		<div className="flex flex-col gap-3">
			<span className="font-mono text-sm font-medium tracking-[0.1em] uppercase text-ink-2">
				{t('compare.talents.title')}
			</span>
			<p className="m-0 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
				<span>{t('compare.talents.legend')}</span>
				<PullKey side="a">
					<span className="truncate">{players.a}</span>
				</PullKey>
				<PullKey side="b">
					<span className="truncate">{players.b}</span>
				</PullKey>
			</p>
			<ul className="m-0 grid list-none grid-cols-3 gap-2 p-0">
				{tree.flatMap((row, at) =>
					row.map((talent) => {
						const tookA = mine.has(talent.id);
						const tookB = theirs.has(talent.id);
						// Both, one, or neither — and nothing but the border says which.
						const edge =
							tookA && tookB
								? 'border-ink-2'
								: tookA
									? 'border-pull-a'
									: tookB
										? 'border-pull-b'
										: 'border-line opacity-70';
						return (
							<li
								key={talent.id}
								className={`flex min-w-0 items-center gap-2.5 rounded-sm border ${edge} p-2`}
								// The row this choice sits on, for anyone reading the grid without seeing it.
								aria-label={`${talent.name}, row ${at + 1}`}
							>
								{talent.icon === undefined ? null : (
									// A bare `img` rather than `SpellIcon`: that wraps each one in a link, and eighteen
									// links is eighteen tab stops through a block nobody navigates by keyboard.
									<img src={iconUrl(talent.icon)} alt="" aria-hidden="true" className="size-12 shrink-0 rounded-sm" />
								)}
								<span className={`min-w-0 truncate text-xs ${tookA || tookB ? 'text-ink-2' : 'text-muted'}`}>
									{talent.name}
								</span>
							</li>
						);
					}),
				)}
			</ul>
		</div>
	);
}
