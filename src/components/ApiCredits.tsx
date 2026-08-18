import { Toolbar } from '@base-ui/react/toolbar';
import { Tooltip } from '@base-ui/react/tooltip';
import { formatDistanceToNowStrict } from 'date-fns';
import { useTranslation } from 'react-i18next';

import '~/lib/i18n';

import { useApiCredits } from '~/hooks/useApiCredits';
import { useSession } from '~/lib/auth';
import { formatCompact } from '~/lib/format';
import type { CreditsView } from '~/lib/wcl';

/**
 * What is left of the reader's WarcraftLogs hourly budget, in the sign-in step.
 *
 * **Two renderings, one readout**, the same arrangement `TargetModeControl` uses and for the same
 * reason: this one has a paragraph to spend, `ApiCreditsToolbar` below has the width the sticky bar
 * can spare. Both read the same hook, so they cannot come to disagree about a budget.
 *
 * **Everything is written out here, and that is deliberate.** The toolbar's figure explains itself
 * through a tooltip, and a tooltip is a pointer and a keyboard — Base UI drives it from
 * `useHover({ mouseOnly: true })`, so a tap does not open it and nothing on a phone would. This
 * rendering is the reason that is acceptable rather than a gap: it states the same three facts as
 * plain text at every width and on every input, so the reset time is never reachable by mouse alone.
 * It is also not interactive, and so costs no tab stop.
 *
 * **Nothing is ever shown as a zero.** `useApiCredits` answers null for every case where a figure
 * would be a lie — signed out, nothing fetched yet, the query refused, the field missing, a reading
 * older than the hour it describes — and null renders nothing at all. A credits display reading
 * `0 left` because a query failed would stop people using an app that works.
 *
 * The pull count is an estimate and is written as one. It divides what is left by what the reader's
 * last pull actually cost, and that cost is not a constant: `fightEvents` pages, so a nine-minute
 * fight costs more than a three-minute one. `lib/wcl/rateLimit.ts` rounds the quotient down to as
 * few digits as one measurement can support, and `Detail` names the divisor rather than leaving the
 * reader to trust a number whose basis is invisible.
 */
export default function ApiCredits() {
	const { token, status } = useSession();
	const { t } = useTranslation('ui');
	const credits = useApiCredits(token);

	// Before sign-in there is no budget to report — it belongs to the token, and there is no token.
	// Saying so beats both a blank space and a zero, and the reader is standing in the step that fixes
	// it. `unknown` is the first paint, before storage has been read, where asserting either state
	// would flicker.
	if (credits === null) {
		return status === 'signed-out' ? (
			<p className="m-0 max-w-[64ch] text-sm leading-relaxed text-muted">{t('credits.signedOut')}</p>
		) : null;
	}

	return (
		<div className="flex max-w-[64ch] flex-col gap-1">
			<p className="m-0 flex flex-wrap items-baseline gap-x-2 font-mono text-sm">
				<span className="font-semibold tracking-[0.1em] text-ink-2 uppercase">{t('credits.label')}</span>
				<span className="tabular text-muted">
					{t('credits.summary', { count: credits.pullsLeft, percent: credits.percentLeft })}
				</span>
			</p>
			<Detail view={credits} className="m-0 text-sm leading-relaxed text-muted" />
		</div>
	);
}

/**
 * The same figure on the sticky bar's single line.
 *
 * A `Toolbar.Button` and not a `<span>`, which is the opposite of what "it is not interactive" would
 * suggest and is still the right way round. The bar is a Base UI `Toolbar`: its items are reached
 * with arrow keys inside a single tab stop, so a focusable item here costs no tab stop at all — and
 * focus is what opens a tooltip without a mouse. A `<span>` would have made the detail hover-only for
 * anyone on this bar; a plain `<button>` outside the toolbar's roving focus would have cost the stop
 * the bar exists to avoid. Neither trade had to be made, so the trigger is focusable.
 *
 * The unit is dropped below `lg` and the number never is. Measured on this row, spelling `pulls` out
 * costs 42px — the button is 89px wide with the word and 46 without — and the encounter name is the
 * only thing on the row that pays for it. `lg` is where the row stops being the constraint; below it
 * the name is worth more than a unit that the button's accessible name states anyway, at every width,
 * so a screen reader loses nothing to the trade.
 *
 * The separator belongs to this component rather than to the bar, which is the opposite of how the
 * bar's other blocks are put together. Theirs are gated on a prop the bar was handed, so the bar
 * knows whether they are there; whether there is a budget to report is known only here, and a
 * separator left to the bar would dangle at the end of the row for everyone signed out.
 */
export function ApiCreditsToolbar() {
	const { token } = useSession();
	const { t } = useTranslation('ui');
	const credits = useApiCredits(token);

	if (credits === null) return null;

	return (
		<>
			<Toolbar.Separator className="hidden h-6 w-px shrink-0 bg-line sm:block" />
			{/* Uncontrolled, so the two ways Base UI opens a tooltip are the only two: a pointer resting
			    on it, and focus arriving from the keyboard. Nothing here toggles it on click — a figure
			    that is not a control should not behave like one, and the detail is on the page in full
			    either way. */}
			<Tooltip.Root>
				<Tooltip.Trigger
					render={<Toolbar.Button />}
					aria-label={t('credits.summary', { count: credits.pullsLeft, percent: credits.percentLeft })}
					className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-sm px-1 font-mono text-sm text-muted transition-colors hover:text-ink-2"
				>
					<span aria-hidden="true" className="tabular">
						~{formatCompact(credits.pullsLeft)}
					</span>
					<span aria-hidden="true" className="hidden lg:inline">
						{t('credits.unit', { count: credits.pullsLeft })}
					</span>
				</Tooltip.Trigger>
				<Tooltip.Portal>
					{/* `z-40` clears the sticky bar's own `z-30`, which this trigger lives inside. */}
					<Tooltip.Positioner className="z-40" side="bottom" sideOffset={8} collisionPadding={12}>
						<Tooltip.Popup className={popupClass}>
							<p className="m-0 font-mono text-sm font-semibold tracking-[0.1em] text-ink uppercase">
								{t('credits.label')}
							</p>
							<Detail view={credits} className="m-0" />
						</Tooltip.Popup>
					</Tooltip.Positioner>
				</Tooltip.Portal>
			</Tooltip.Root>
		</>
	);
}

const popupClass =
	'flex max-w-[min(38ch,calc(100vw-2rem))] flex-col gap-2 rounded-sm border border-line bg-surface p-3 text-sm leading-relaxed text-ink-2 transition-opacity duration-150 motion-reduce:transition-none data-ending-style:opacity-0 data-starting-style:opacity-0';

/**
 * What the budget actually says, in one place so the two renderings cannot drift.
 *
 * The reset is worked out when this renders rather than when the reading arrived. The API answers
 * with seconds-from-then, which stops being true the moment it is stored — a panel left open for
 * twenty minutes would otherwise still be promising the reset it was promising then. `resetAt` is
 * that instant resolved to a wall clock, so this counts down on its own.
 */
function Detail({ view, className }: { view: CreditsView; className: string }) {
	const { t } = useTranslation('ui');

	return (
		<p className={className}>
			<span className="tabular">{t('credits.used', { spent: view.spent, limit: view.limit })}</span>{' '}
			{t('credits.resets', { when: formatDistanceToNowStrict(view.resetAt) })}
		</p>
	);
}
