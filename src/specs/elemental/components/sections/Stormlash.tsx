import { useReportCopy } from '~/hooks/useReportCopy';
import type { Analysis, ElementalAuditResult } from '~/lib/types';

import { Note, Prose, Section, SpellIcon, StatTile, StatTiles } from '~/components/primitives';
import StormlashTotems from '../charts/StormlashTotems';

/**
 * The raid's Stormlash Totems, read together.
 *
 * The buff does not stack, so the assignment is to stagger the totems — first, then second, then
 * third — and a totem laid on top of a running one is a totem wasted. Each shaman gets a row; the
 * overlap row on top marks where two ran at once.
 *
 * The chart is `StormlashTotems`, next door, rather than built here. This was the one section in
 * either spec that assembled an ApexCharts option object in-file, and it paid for it by carrying its
 * own copies of the row grid, the span floor and the whole rangeBar skeleton — 62 lines that were
 * identical to the Flame Shock chart's, and that drifted from them the moment either was fixed.
 */
export default function Stormlash({ analysis }: { analysis: Analysis }) {
	const el = analysis as Analysis & ElementalAuditResult;
	const { t } = useReportCopy(analysis);

	return (
		<Section id="stormlash" title={t('stormlash.title')}>
			<Prose>
				<span className="inline-flex items-center gap-2 align-middle">
					<SpellIcon id={120668} size="sm" />
				</span>{' '}
				{t('stormlash.intent')}
			</Prose>

			<div className="mt-4.5">
				<StatTiles>
					<StatTile value={`${el.stormlash.totems}`} label={t('stormlash.kpi.totems')} />
					<StatTile value={`${el.stormlash.overlaps.length}`} label={t('stormlash.kpi.overlaps')} />
				</StatTiles>
			</div>

			<div className="mt-5">
				<StormlashTotems analysis={analysis} />
			</div>

			<div className="mt-5">
				<Note>{t('stormlash.note')}</Note>
			</div>
		</Section>
	);
}
