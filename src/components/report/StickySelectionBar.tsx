import { Toolbar } from '@base-ui/react/toolbar';
import { useTranslation } from 'react-i18next';

import '~/lib/i18n';

import type { SettingsState } from '~/hooks/useSettings';

import { buttonClass } from '../primitives/controls';
import { pageWidthClass } from '../primitives/pageShell';
import SettingsDialog from './SettingsDialog';

interface Props {
	encounter: string;
	kill: boolean;
	/** How far a wipe got. Null on a kill, and on a pull WarcraftLogs declined to score. */
	fightPercentage: number | null;
	/** The Windwalker being read, or null when they were the only one in the pull. */
	player: string | null;
	/** Put the pickers back on screen and move focus into them. */
	onChange: () => void;
	/**
	 * The analysis thresholds, if this bar should offer them.
	 *
	 * Optional so the bar stays usable without them — and because the settings button belongs beside
	 * a report, not beside an empty page.
	 */
	settings?: SettingsState;
}

/**
 * Which pull is being read, once the pickers that chose it have scrolled away.
 *
 * A `Toolbar` rather than a styled `div`, for what comes with it: the ARIA `toolbar` role and roving
 * focus, so the bar is one tab stop on the way down the page instead of adding a stop per control.
 *
 * The caller decides when this exists — it appears only once a full selection has been made *and*
 * the selection block has left the viewport, so it never duplicates controls that are already on
 * screen. Nothing here observes scrolling: mounting is the signal.
 *
 * One line at every width, so the encounter name truncates rather than wrapping — it is the only
 * part that can be arbitrarily long, and it is also the part a reader can still recognise from its
 * first few characters. The player is named only when the pull had more than one Windwalker, for the
 * same reason `PlayerSelector` hides itself: naming the only candidate is noise.
 *
 * The negative margins undo the page container's padding so the bar spans the full width it pins to.
 * They track `Analyzer`'s `px-4 sm:px-6 md:px-8` — a bar inset from the edges leaves gaps for the
 * content to scroll through.
 */
export default function StickySelectionBar({ encounter, kill, fightPercentage, player, onChange, settings }: Props) {
	// `ui`, not `report`: this is the shell around the analysis rather than part of it. The four
	// strings below already existed under `common.*` and were being spelled out in English here
	// instead, which is the thing `docs/conventions.md` puts in the locale for.
	const { t } = useTranslation('ui');
	const result = kill
		? t('common.kill')
		: fightPercentage === null
			? t('common.wipe')
			: t('common.wipeAt', { pct: fightPercentage });

	return (
		<Toolbar.Root
			aria-label={t('selection.label')}
			// `fixed`, not `sticky`, and that is the whole trick.
			//
			// Sticky keeps the bar in normal flow, so it reserves its own height wherever it sits. This
			// bar mounts and unmounts mid-scroll as the pickers leave and re-enter view, and every one of
			// those reflowed the page by the bar's height — read as the content jerking downwards each
			// time it disappeared. Out of flow, nothing below it moves.
			//
			// It also makes full-bleed free: `inset-x-0` is the viewport's width by definition, with no
			// `100vw` (which counts the scrollbar and overhangs) and no negative-margin escape from the
			// centred container this lives inside.
			//
			// `starting:` gives the fade its from-state, so it plays on mount and nowhere else; under
			// prefers-reduced-motion the transition is dropped entirely and the bar simply appears.
			className="fixed inset-x-0 top-0 z-30 border-b border-line bg-surface/90 backdrop-blur-sm transition-opacity duration-150 motion-reduce:transition-none starting:opacity-0"
		>
			{/* The interior matches the page container exactly — same max width, same padding, same
			    centring — so the encounter name starts on the same line as the report beneath it. Taken
			    from `pageWidthClass` rather than restated, because the two must agree and a drift between
			    two copies would go unnoticed until the bar stopped lining up with the report. */}
			<div className={`${pageWidthClass} flex items-center gap-3 py-1`}>
				<p className="m-0 flex min-w-0 flex-1 items-center gap-2 font-mono text-sm">
					<span className="truncate font-semibold text-ink">{encounter}</span>
					<span className="shrink-0 text-muted">&middot; {result}</span>
					{player !== null ? <span className="shrink-0 text-ink-2">&middot; {player}</span> : null}
				</p>

				<Toolbar.Separator className="h-6 w-px shrink-0 bg-line" />

				<Toolbar.Button className={`${buttonClass} shrink-0`} onClick={onChange}>
					{t('common.change')}
				</Toolbar.Button>

				{settings === undefined ? null : (
					<>
						<Toolbar.Separator className="h-6 w-px shrink-0 bg-line" />
						<SettingsDialog {...settings} />
					</>
				)}
			</div>
		</Toolbar.Root>
	);
}
