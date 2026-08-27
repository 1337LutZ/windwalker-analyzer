import { useTranslation } from 'react-i18next';

import type { ReportSlot } from '~/hooks/useReportSlot';
import { useSession } from '~/lib/auth';

import { Callout, Skeleton } from '../primitives';
import { buttonClass } from '../primitives/controls';
import { describeFailure } from '../report/describeFailure';
import ReportInput from '../report/ReportInput';

import PullKey from './PullKey';

/**
 * One slot's report code, with the swatch that says which side of the comparison it becomes.
 *
 * The mark is on the field rather than only on the figures, because the reader picks the two pulls
 * before they see a single one of those figures. Whichever report goes in the first field wears the
 * filled mark everywhere below it, and saying so here is cheaper than saying it afterwards.
 */
export default function ReportField({
	slot,
	side,
	seedCode,
	label,
}: {
	slot: ReportSlot;
	side: 'a' | 'b';
	/** What a shared link named for this slot, so the field opens on it rather than empty. */
	seedCode: string | null;
	label: string;
}) {
	const { t } = useTranslation('ui');
	const { signOut } = useSession();

	return (
		<div className="flex flex-col gap-3">
			<PullKey side={side}>
				<span className="font-mono text-sm font-medium text-ink-2">{label}</span>
			</PullKey>
			<ReportInput
				busy={slot.fights.isFetching}
				initialReport={seedCode}
				onSubmit={(parsed) => {
					slot.setInput(parsed);
					slot.clearBelow();
				}}
				onDiverge={slot.clearBelow}
			/>
			{slot.fights.isFetching ? (
				<Skeleton className="h-5" />
			) : slot.fights.data ? (
				<p className="m-0 truncate text-sm text-muted">
					{slot.fights.data.title}
					{slot.fights.data.zoneName ? ` · ${slot.fights.data.zoneName}` : ''}
				</p>
			) : null}
			{slot.fights.error ? (
				<Callout
					title={describeFailure(slot.fights.error, t).title}
					action={
						describeFailure(slot.fights.error, t).tokenAtFault ? (
							<button type="button" className={buttonClass} onClick={signOut}>
								{t('errors.signOutAction')}
							</button>
						) : null
					}
				>
					<p className="m-0">{describeFailure(slot.fights.error, t).detail}</p>
				</Callout>
			) : null}
		</div>
	);
}
