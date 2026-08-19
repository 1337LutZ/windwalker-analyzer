import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatClock, formatSeconds } from '~/lib/format';
import type { Analysis } from '~/lib/types';

import { DataGrid, Note, Prose, Section, type GridRow } from '~/components/primitives';
import LogLink from '~/components/sections/LogLink';

/**
 * Every Fists of Fury channel, and what — if anything — was wrong with where it went.
 *
 * The sentences are not written here: `intent` says what the section measures and never changes,
 * and which of the three `clean` variants renders is decided by the numbers. The fault text inside
 * a row is the exception — those strings come out of the analysis engine naming a specific spell
 * and a specific condition, so they are data rather than copy and are shown as it wrote them.
 */
export default function FistsOfFury({ analysis }: { analysis: Analysis }) {
	const { channel } = analysis;
	const { t } = useReportCopy(analysis);

	const rows = useMemo<GridRow[]>(
		() =>
			// The clock, and stated here rather than inherited from the engine's array. Not faults first,
			// which is the ordering this table keeps being asked for: a misplaced channel is already
			// banded, the sentence above counts them and the miss ledger lists them by kind, so ranking
			// here would spend the one thing the table uniquely carries — the channels in sequence, which
			// is what makes a run of three bad placements visible as a run rather than as three rows.
			[...channel.castList]
				.sort((a, b) => a.t - b.t)
				.map((c, i) => {
					const bad = c.faults.length > 0;
					return {
						key: `${c.t}-${i}`,
						band: bad ? ('warn' as const) : undefined,
						cells: {
							at: <LogLink href={c.link}>{formatClock(c.t)}</LogLink>,
							channel: <b className="font-semibold text-ink-2">{formatSeconds(c.channelMs)}</b>,
							brew: (
								<b className="font-semibold text-ink-2">
									{c.brewUp ? t('fistsOfFury.cells.yes') : t('fistsOfFury.cells.no')}
								</b>
							),
							rune: (
								<span className={bad && c.procRemainingMs !== null ? 'text-brew' : undefined}>
									{c.procRemainingMs === null ? '—' : formatSeconds(c.procRemainingMs)}
								</span>
							),
							// The fault text is the engine's, not the locale's: it names the spell and the number
							// that tripped the check, so it is data about this pull rather than copy about the spec.
							verdict: (
								<span className={bad ? 'text-miss' : 'text-ink-2'}>
									{bad ? c.faults.join('; ') : t('fistsOfFury.cells.ok')}
								</span>
							),
						},
					};
				}),
		[channel.castList, t],
	);

	// `lib/score` grades no `fistsOfFury` section, so there is no `verdict()` to ask: the priority list
	// gates this channel on conditions rather than playing it on cooldown, which leaves no rate for a
	// threshold to sit on. The context is therefore derived here, from the only two numbers there are.
	// `good` has to mean *none* faulted, because the copy behind it says all of them were placed
	// cleanly; the ok/bad line sits at a third, which is where `tigerPalmWaste` stops calling a
	// mistake a slip and starts calling it a habit.
	const cleanContext = channel.faulted === 0 ? 'good' : channel.faulted * 3 <= channel.casts ? 'ok' : 'bad';

	return (
		<Section id="fof" title={t('fistsOfFury.title')}>
			<div className="flex flex-col gap-3.5">
				<Prose>{t('fistsOfFury.intent')}</Prose>
				{channel.casts > 0 ? (
					<Prose>
						{t('fistsOfFury.summary', {
							count: channel.casts,
							casts: channel.casts,
							seconds: channel.channelSec,
						})}{' '}
						{t('fistsOfFury.withBrew', {
							context: channel.withBrew === channel.casts ? 'all' : 'some',
							withBrew: channel.withBrew,
							casts: channel.casts,
						})}{' '}
						{t('fistsOfFury.clean', {
							context: cleanContext,
							faulted: channel.faulted,
							casts: channel.casts,
						})}
					</Prose>
				) : null}
			</div>

			{/* Nothing to audit is a real answer here, and the copy for it says so rather than leaving a
			    blank: the priority list gates the channel, so zero channels is not zero effort. */}
			{channel.casts === 0 ? (
				<div className="mt-5">
					<Note>{t('fistsOfFury.none')}</Note>
				</div>
			) : (
				<>
					<div className="mt-5">
						<DataGrid
							caption={t('fistsOfFury.caption')}
							minWidth="560px"
							columns={[
								{ key: 'at', label: t('fistsOfFury.columns.at'), width: '90px' },
								{
									key: 'channel',
									label: t('fistsOfFury.columns.channel'),
									align: 'right',
									width: '80px',
								},
								{
									key: 'brew',
									label: t('fistsOfFury.columns.brew'),
									align: 'right',
									width: '70px',
								},
								{
									key: 'rune',
									label: t('fistsOfFury.columns.rune'),
									align: 'right',
									width: '90px',
								},
								{
									key: 'verdict',
									label: t('fistsOfFury.columns.verdict'),
									card: 'wide',
								},
							]}
							rows={rows}
							empty={t('fistsOfFury.none')}
						/>
					</div>
					<div className="mt-4">
						<Note>{t('fistsOfFury.energyCaveat')}</Note>
					</div>
				</>
			)}
		</Section>
	);
}
