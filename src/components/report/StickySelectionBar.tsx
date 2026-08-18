import { Toolbar } from '@base-ui/react/toolbar';
import { useTranslation } from 'react-i18next';

import '~/lib/i18n';

import type { SettingsState } from '~/hooks/useSettings';
import type { TargetSummary } from '~/lib/types';
import type { TargetModeChoice } from '~/lib/view/targetMode';

import { ApiCreditsToolbar } from '../ApiCredits';
import { buttonClass } from '../primitives/controls';
import { pageWidthClass } from '../primitives/pageShell';
import SettingsDialog from './SettingsDialog';
import { TargetModeToolbar } from './TargetModeControl';

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
	/**
	 * Which reading the report is being graded at, when there is a report being graded.
	 *
	 * Optional for a sharper reason than `settings`: this bar can be on screen with no analysis behind
	 * it — while a pull is being fetched, where the skeleton is tall enough to scroll the pickers away
	 * — and on a report that refused the player as the wrong spec. Neither has a reading to change, so
	 * the caller withholds this and the switches are not rendered rather than rendered inert.
	 */
	targetMode?: {
		targets: TargetSummary | undefined;
		value: TargetModeChoice;
		onChange: (choice: TargetModeChoice) => void;
	};
}

/**
 * Which pull is being read, once the pickers that chose it have scrolled away.
 *
 * A `Toolbar` rather than a styled `div`, for what comes with it: the ARIA `toolbar` role and roving
 * focus, so the bar is one tab stop on the way down the page instead of adding a stop per control.
 * That is why the target-mode switches are `Toolbar.Button`s: three of them added as plain buttons
 * would have been three more stops between the report and everything under it.
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
export default function StickySelectionBar({
	encounter,
	kill,
	fightPercentage,
	player,
	onChange,
	settings,
	targetMode,
}: Props) {
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
			<div className={`${pageWidthClass} flex items-center gap-2 py-1 sm:gap-3`}>
				{/* The name first and the two suffixes by how much width there is for them, which is what
				    everything beside them costs. Re-measured once the credits readout joined the row, at
				    the four widths that decide it:

				      390  row 358, controls 276 (Change 72, Mode 78, settings 49, credits 47, gaps 32)
				           -> 82 for the name, ~10 of 20 characters
				      640  row 592, controls 440 (the switches replace Mode at `md`, so still Mode here)
				           -> 152 for the name, which is nearly all of it
				      768  row 704, controls 504 (switches 140 now, credits still compact)
				           -> 201, the whole name
				     1024  row 960, controls 550 -> 414, the name and both suffixes with room over

				    The docstring above names the encounter as the part a reader recognises, so the suffixes
				    are what yield, and both now yield to `lg`. The outcome used to return at `md`, where
				    its 131px left the name 26 — three characters — the moment anything else joined the
				    row. Neither is lost while hidden: both are on the pull's own row in the picker the
				    Change button goes back to. `shrink-0` on both, so what is shown is shown whole and only
				    the name truncates. */}
				<p className="m-0 flex min-w-0 flex-1 items-center gap-2 font-mono text-sm">
					<span className="truncate font-semibold text-ink">{encounter}</span>
					<span className="hidden shrink-0 text-muted lg:inline">&middot; {result}</span>
					{player !== null ? <span className="hidden shrink-0 text-ink-2 lg:inline">&middot; {player}</span> : null}
				</p>

				<Toolbar.Separator className="hidden h-6 w-px shrink-0 bg-line sm:block" />

				{/* `max-sm:px-2` rather than a second `px-*` in the string: two conflicting paddings resolve
				    by stylesheet order and `px-4` would win, while a variant is sorted after the plain
				    utility and takes the narrow width for certain. */}
				<Toolbar.Button className={`${buttonClass} shrink-0 max-sm:px-2`} onClick={onChange}>
					{t('common.change')}
				</Toolbar.Button>

				{/* After the selection it qualifies and before the settings, which is the order the two
				    kinds of control come in: this changes how the pull on the left is read, the gear
				    changes what every pull is measured with. Its copy stays in the `report` namespace
				    rather than joining the four strings above in `ui` — it is a reading of the analysis,
				    not part of the shell, and moving it here should not fork the wording it shares with
				    the block above the report. */}
				{targetMode === undefined ? null : (
					<>
						<Toolbar.Separator className="hidden h-6 w-px shrink-0 bg-line sm:block" />
						<TargetModeToolbar {...targetMode} />
					</>
				)}

				{settings === undefined ? null : (
					<>
						<Toolbar.Separator className="hidden h-6 w-px shrink-0 bg-line sm:block" />
						<SettingsDialog {...settings} />
					</>
				)}

				{/* Last, because it is the only thing here that is neither the pull nor a control on it —
				    it is what reading another one will cost, which is a status corner rather than a step
				    in the row.

				    It brings its own separator, unlike the two blocks above. Theirs are gated on a prop
				    this bar was handed, so the bar knows whether they exist; whether there is a budget to
				    report is known only inside the component, and a separator left out here would dangle
				    at the end of the row for everyone signed out. */}
				<ApiCreditsToolbar />
			</div>
		</Toolbar.Root>
	);
}
