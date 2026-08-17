import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatClock, formatSeconds } from '~/lib/format';
import type { Analysis } from '~/lib/types';

import { EnergizingBrewTrack } from '../charts';
import { Callout, DataGrid, Note, Prose, Section, StatTile, StatTiles, type GridRow } from '../primitives';
import LogLink from './LogLink';

/**
 * Every Energizing Brew, and whether the rotation would have pressed it there.
 *
 * The section grades one thing and declines to grade the other, which is the whole shape of it. The
 * sim's priority list wants the brew when energy is at least five seconds from filling *and* either
 * no haste cooldown is running or Rushing Jade Wind is selected — and a WarcraftLogs event stream can
 * answer the haste clause and not the energy clause. So the verdict column speaks only to haste, and
 * the caveat under the table says why there is no second column beside it.
 *
 * `lib/score` grades no `energizingBrew` section, so there is no `verdict()` to ask: this button is
 * gated on conditions rather than played off its cooldown, which leaves no rate for a threshold to
 * sit on. The one sentence that varies is decided here, from the two counts the audit carries.
 */
export default function EnergizingBrew({ analysis }: { analysis: Analysis }) {
	const { energizing } = analysis;
	const { t } = useReportCopy(analysis);

	const rows = useMemo<GridRow[]>(
		() =>
			// The clock, and stated here rather than inherited from the engine's array — the table sits
			// directly under a track drawn on the same timeline, and a row order that disagreed with the
			// chart above it would make the two read as two pulls.
			//
			// Deliberately not faulted-first. The faulted presses are already banded, the summary above
			// counts them, and the miss ledger lists them again; what only this table can give is the
			// presses in the order they were made.
			[...(energizing?.uses ?? [])]
				.sort((a, b) => a.t - b.t)
				.map((use, i) => {
					const bad = use.faults.length > 0;
					return {
						key: `${use.t}-${i}`,
						band: bad ? ('warn' as const) : undefined,
						cells: {
							at: <LogLink href={use.link}>{formatClock(use.t)}</LogLink>,
							held: <b className="font-semibold text-ink-2">{formatSeconds(use.lengthMs)}</b>,
							under: (
								<span className={bad ? 'text-brew' : 'text-ink-2'}>{use.haste ?? t('energizingBrew.cells.none')}</span>
							),
							// The channels are the Fists of Fury section's business and are not faulted twice; this
							// column only says where to look.
							channels: <span className="text-ink-2">{use.channels === 0 ? '—' : use.channels}</span>,
							// The loss this button exists to avoid: energy poured into a bar that was already full,
							// at the brew's own rate plus the regen underneath it. Zero is the good outcome and is
							// left quiet; a dash means the pull carried no readings, which is not the same as none.
							wasted:
								use.wasted === null ? (
									<span className="text-muted">{t('energizingBrew.cells.noReadings')}</span>
								) : (
									<b className={`font-semibold ${use.wasted > 0 ? 'text-miss' : 'text-ink-2'}`}>{use.wasted}</b>
								),
							// The fault text is the engine's, not the locale's: it names the haste cooldown that was
							// running and which half of the condition failed, so it is data about this pull.
							verdict: (
								<span className={bad ? 'text-miss' : 'text-ink-2'}>
									{bad ? use.faults.join('; ') : t('energizingBrew.cells.ok')}
								</span>
							),
						},
					};
				}),
		[energizing, t],
	);

	// A fixture captured before this audit existed has no `energizing` key at all — `undefined`, not
	// an empty audit — and the heading still has to render, because `SectionNav` lists every section
	// unconditionally and a link with no heading behind it is a jump to nowhere.
	if (!energizing) {
		return (
			<Section id="energizing" title={t('energizingBrew.title')}>
				<Note>{t('empty.section')}</Note>
			</Section>
		);
	}

	// Faulted first: a single press the rotation would have held is the thing worth saying, and it
	// outranks the fact that others went out under a haste cooldown legitimately.
	const hasteContext = energizing.faulted > 0 ? 'bad' : energizing.duringHaste > 0 ? 'ok' : 'good';

	return (
		<Section id="energizing" title={t('energizingBrew.title')}>
			{/* No standing explanation of the button. What it does is the rotation section's job; this one
			    reports what happened with it, and the chart under it shows the shape. */}
			<div className="flex flex-col gap-3.5">
				{energizing.casts > 0 ? (
					<Prose>
						{t('energizingBrew.summary', {
							casts: energizing.casts,
							available: energizing.available,
							uptime: energizing.uptimePct,
						})}{' '}
						{t('energizingBrew.haste', {
							context: hasteContext,
							casts: energizing.casts,
							faulted: energizing.faulted,
							duringHaste: energizing.duringHaste,
						})}{' '}
						{energizing.channelsInside > 0 ? t('energizingBrew.channels', { count: energizing.channelsInside }) : null}
					</Prose>
				) : null}
			</div>

			<div className="mt-4.5">
				<StatTiles>
					<StatTile
						value={`${energizing.casts}`}
						suffix={` / ${energizing.available}`}
						label={t('energizingBrew.kpi.uses')}
					/>
					{energizing.hasteRjwEligible ? (
						<StatTile
							value={
								energizing.hasteRjwUses > 0 ? t('energizingBrew.pairing.used') : t('energizingBrew.pairing.missed')
							}
							label={t('energizingBrew.pairing.label')}
							grade={energizing.hasteRjwUses > 0 ? 'good' : 'bad'}
						/>
					) : null}
				</StatTiles>
			</div>

			{energizing.hasteRjwEligible && energizing.hasteRjwUses === 0 ? (
				<div className="mt-4">
					<Callout tone="brew" title={t('energizingBrew.recommendation.title')}>
						<p className="m-0">{t('energizingBrew.recommendation.body')}</p>
					</Callout>
				</div>
			) : null}

			{energizing.casts === 0 ? (
				<div className="mt-5">
					<Note>{t('energizingBrew.none', { available: energizing.available })}</Note>
				</div>
			) : (
				<>
					{/* The clock first, the table under it. The shape — a bar climbing to full, a brew landing
					    on one already there — is what the section is about; the table is where a reader goes
					    once they have seen something worth asking about. */}
					<div className="mt-5">
						<EnergizingBrewTrack analysis={analysis} />
					</div>
					<div className="mt-3">
						<Note>{t('energizingBrew.resolution')}</Note>
					</div>

					<div className="mt-5">
						<DataGrid
							caption={t('energizingBrew.caption')}
							minWidth="560px"
							columns={[
								{ key: 'at', label: t('energizingBrew.columns.at'), width: '90px' },
								{ key: 'held', label: t('energizingBrew.columns.held'), align: 'right', width: '70px' },
								{ key: 'under', label: t('energizingBrew.columns.under'), align: 'right', width: '100px' },
								{ key: 'channels', label: t('energizingBrew.columns.channels'), align: 'right', width: '70px' },
								{ key: 'wasted', label: t('energizingBrew.columns.wasted'), align: 'right', width: '90px' },
								{ key: 'verdict', label: t('energizingBrew.columns.verdict'), card: 'wide' },
							]}
							rows={rows}
							empty={t('energizingBrew.none', { available: energizing.available })}
						/>
					</div>
					<div className="mt-4">
						<Note>{t('energizingBrew.energyCaveat')}</Note>
					</div>
				</>
			)}
		</Section>
	);
}
