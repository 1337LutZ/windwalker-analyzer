import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { Analysis, ElementalAuditResult } from '~/lib/types';

import { ChartFigure } from '~/components/primitives';
import ChartEmpty from '~/components/charts/ChartEmpty';
import ChartKey from '~/components/charts/ChartKey';
import type { Track } from '~/components/charts/WindowTracks';
import WindowTracks from '~/components/charts/WindowTracks';

/**
 * The raid's Stormlash Totems on the pull clock: one row per shaman, and the overlap row on top.
 *
 * The same track chart the uptime graphs draw, with one difference worth naming — its rows are not
 * states of one thing but different people, so the labels come out of the log rather than out of the
 * locale. That is exactly why `Track.label` takes resolved text instead of a copy key.
 *
 * The buff does not stack, so the assignment is to stagger the totems and a totem laid on top of a
 * running one is a totem wasted. The overlap row is that fault drawn: it is the union of the shaman
 * rows with themselves, so a bar there always sits under two bars above it.
 */
export default function StormlashTotems({ analysis }: { analysis: Analysis }) {
	const { t } = useTranslation('report');
	const el = analysis as Analysis & ElementalAuditResult;
	const { stormlash } = el;

	/**
	 * A row per shaman, then the overlap row.
	 *
	 * Neither row is gated: `widen` stays on throughout, because the tile above counts the overlapping
	 * stretches one by one and a stretch drawn too small to see would contradict a number the reader
	 * can read. Nor do these rows fragment the way a contact-scoped complement does — a totem's window
	 * is its ten seconds, and an overlap is bounded by one, so there is no cloud of slivers for the
	 * gate to protect against. See `Track.widen`.
	 */
	const rows = useMemo(
		(): Track[] => [
			...stormlash.shamans.map((shaman): Track => ({
				// The log's own name for them, falling back to the id: an unnamed actor is still a row
				// worth drawing, and a blank label would silently merge it with the next one.
				label: shaman.name ?? `#${shaman.id}`,
				tone: 'kick',
				windows: shaman.windows.map((w): [number, number] => [w.start, w.end]),
				lengthLabel: 'totem up for',
			})),
			{
				label: t('stormlash.track.overlap'),
				tone: 'miss',
				windows: stormlash.overlaps.map((w): [number, number] => [w.start, w.end]),
				lengthLabel: 'two totems up for',
			},
		],
		[stormlash, t],
	);

	if (stormlash.totems === 0) {
		return <ChartEmpty>{t('stormlash.empty')}</ChartEmpty>;
	}

	return (
		<ChartFigure
			gap="wide"
			caption={
				<>
					<ChartKey tone="kick">{t('stormlash.key.totem')}</ChartKey>
					{stormlash.overlaps.length === 0 ? null : <ChartKey tone="miss">{t('stormlash.key.overlap')}</ChartKey>}
				</>
			}
		>
			{/* The description carries no counts, and that is deliberate: the two tiles directly above are
			    the totem and overlap counts in plain text, so a reader who cannot see the chart has them
			    already — and three independent numbers in one sentence is three pluralisation bugs waiting
			    to print "1 overlapping stretches". */}
			<WindowTracks
				tracks={rows}
				chartId="ele-stormlash"
				durationMs={analysis.durationMs}
				label={t('stormlash.chart.label')}
			/>
		</ChartFigure>
	);
}
