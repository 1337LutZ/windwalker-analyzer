import { Toolbar } from '@base-ui/react/toolbar';
import { useTranslation } from 'react-i18next';

import '~/lib/i18n';

import { buttonClass } from '../primitives/controls';
import { pageWidthClass } from '../primitives/pageShell';

import PullKey from './PullKey';

/**
 * Which side is which player, held on screen for as long as the comparison is being read.
 *
 * **The one thing a reader of this page cannot afford to lose.** Every figure below is two marks and a
 * connector, and all of them mean nothing without knowing which mark is whom. On the report page the
 * equivalent bar exists so the reader remembers *which pull* they are looking at; here it carries the
 * legend itself, which is a stronger reason: scroll past the header on a phone and the names are gone,
 * while forty dumbbells that depend on them are not.
 *
 * The marks are the same two shapes every figure draws, filled and ringed, so this is a key rather
 * than a caption. `PullKey` is the single place that pairing is set.
 *
 * `fixed` rather than `sticky`, and the encounter between the two names: both are lifted from
 * `StickySelectionBar`, which argues the first at length — a sticky bar reserves its height in flow,
 * so mounting one mid-scroll jerks the page down by its own height every time.
 */
export default function CompareBar({
	a,
	b,
	encounter,
	onChange,
}: {
	a: string;
	b: string;
	encounter: string;
	onChange: () => void;
}) {
	const { t } = useTranslation('ui');

	return (
		<Toolbar.Root
			aria-label={t('selection.compareLabel')}
			className="fixed inset-x-0 top-0 z-30 border-b border-line bg-surface/90 backdrop-blur-sm transition-opacity duration-150 motion-reduce:transition-none starting:opacity-0"
		>
			<div className={`${pageWidthClass} flex items-center gap-2 py-1 sm:gap-3`}>
				{/* The two names take the row and the encounter yields first, because the encounter is the
				    same for both pulls by construction and is therefore the part that says least here. The
				    names truncate rather than wrap: the bar is one line at every width. */}
				<p className="m-0 flex min-w-0 flex-1 items-center gap-2 font-mono text-sm sm:gap-3">
					<PullKey side="a">
						<span className="truncate font-semibold text-ink">{a}</span>
					</PullKey>
					<span aria-hidden="true" className="shrink-0 text-muted">
						&middot;
					</span>
					<PullKey side="b">
						<span className="truncate font-semibold text-ink">{b}</span>
					</PullKey>
					<span className="hidden shrink-0 truncate text-muted lg:inline">&middot; {encounter}</span>
				</p>
				<Toolbar.Separator className="hidden h-6 w-px shrink-0 bg-line sm:block" />

				{/* `max-sm:px-2` rather than a second `px-*` in the string: two conflicting paddings resolve
				    by stylesheet order and `px-4` would win, while a variant is sorted after the plain
				    utility and takes the narrow width for certain. */}
				<Toolbar.Button className={`${buttonClass} shrink-0 max-sm:px-2`} onClick={onChange}>
					{t('common.change')}
				</Toolbar.Button>
			</div>
		</Toolbar.Root>
	);
}
