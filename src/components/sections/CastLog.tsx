import { Dialog } from '@base-ui/react/dialog';

import { useReportCopy } from '~/hooks/useReportCopy';
import type { Analysis } from '~/lib/types';

import { CastTimeline } from '~/specs/windwalker/components/charts';
import { Section } from '../primitives';
import { buttonClass } from '../primitives/controls';

/**
 * Every press on a clock, with what was up underneath — inline, and full-width in a dialog.
 *
 * The dialog exists because the report column is about 45rem wide and a pull is four minutes long:
 * inline the reader sees a third of the fight at a legible zoom, and the whole point of the view is
 * reading a press against the bars beneath it. A Base UI `Dialog` for the usual reasons — it traps
 * focus, restores it to the trigger on close, handles Escape and writes the ARIA wiring — and the
 * trigger is an ordinary button, so it is reachable and operable without any of that being re-done
 * here.
 *
 * The timeline is mounted twice in the source and never twice at once: `Dialog.Portal` renders
 * nothing until the dialog opens, so the closed page carries one copy of several hundred marks
 * rather than two. The two copies keep their own zoom and toggles, which is the right answer for
 * state that describes what the reader is looking at rather than what they believe.
 */
export default function CastLog({ analysis }: { analysis: Analysis }) {
	const { t } = useReportCopy(analysis);
	// Truthiness, not a null check: on a fixture captured before the engine emitted this the field is
	// `undefined`, and `timeline.casts` on `undefined` is a crash rather than an empty report.
	const timeline = analysis.timeline;
	const hasTimeline = timeline !== undefined && (timeline.casts.length > 0 || timeline.lanes.length > 0);

	// No intent paragraph under the heading. The chart explains itself — every lane is labelled and
	// the toggles say what they toggle — and a paragraph restating that pushed the thing being
	// described below the fold on a laptop.
	return (
		<Section id="cast-log" title={t('castLog.title')}>
			{hasTimeline ? (
				<Dialog.Root>
					<div className="mt-5 flex flex-col gap-4">
						<div className="flex justify-end">
							<Dialog.Trigger className={`${buttonClass} px-4`}>{t('castLog.expand')}</Dialog.Trigger>
						</div>
						<CastTimeline analysis={analysis} />
					</div>
					<Dialog.Portal>
						<Dialog.Backdrop className="fixed inset-0 z-40 min-h-dvh bg-bg/80 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
						{/* Inset rather than centred and sized: what this view is short of is width, and a pull
						    reads better across a whole screen than inside a box in the middle of one. */}
						<Dialog.Popup className="fixed inset-2 z-50 flex flex-col gap-4 overflow-auto rounded-sm border border-line bg-surface p-4 text-ink transition-[scale,opacity] duration-150 data-ending-style:scale-[0.99] data-ending-style:opacity-0 data-starting-style:scale-[0.99] data-starting-style:opacity-0 sm:inset-4 sm:p-6">
							<div className="flex items-start justify-between gap-4">
								<Dialog.Title className="m-0 font-mono text-lg font-semibold tracking-[-0.01em] text-ink">
									{t('castLog.title')}
								</Dialog.Title>
								<Dialog.Close className={`${buttonClass} shrink-0 px-3`}>{t('castLog.close')}</Dialog.Close>
							</div>
							{/* Kept for the dialog's accessible description, which Base UI wires to the popup, but
							    not shown: in a full-screen view the width belongs to the pull. */}
							<Dialog.Description className="sr-only">{t('castLog.intent')}</Dialog.Description>
							<CastTimeline analysis={analysis} />
						</Dialog.Popup>
					</Dialog.Portal>
				</Dialog.Root>
			) : (
				<div className="mt-5">
					<CastTimeline analysis={analysis} />
				</div>
			)}
		</Section>
	);
}
