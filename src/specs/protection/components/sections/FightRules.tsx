import { useReportCopy } from '~/hooks/useReportCopy';
import { formatClock, formatSeconds } from '~/lib/format';
import type { Analysis, ProtectionAudit } from '~/lib/types';

import { DataGrid, Note, Prose, Section, type GridRow } from '~/components/primitives';

/**
 * What the boss did, and which of its rules applied to this pull.
 *
 * The section exists because the report used to grade nine encounters against one model of a fight.
 * Every rule here was measured — see `lib/analysis/enforced`, which carries the evidence and the bar
 * an entry has to clear — and the two bases are kept apart on the page as well as in the table,
 * because they are not equally strong. A `lockout` is the press stream saying the player could not
 * act; a `declared` is a reader's judgement about a phase, and each carries what supports it.
 *
 * **A boss with no rules gets a sentence rather than an empty table**, and a rule that never fired
 * gets a row rather than being dropped: "this fight has a stun and it never landed on you" and "this
 * fight has no stun" are different reports.
 */
export default function FightRules({ analysis }: { analysis: Analysis }) {
	const { fight } = analysis as Analysis & ProtectionAudit;
	const { t } = useReportCopy(analysis);

	if (fight.encounter === null) {
		return (
			<Section id="fight" title={t('fight.title')}>
				<Prose>{t('fight.intent')}</Prose>
				<div className="mt-5">
					<Note>{t('fight.unknown')}</Note>
				</div>
			</Section>
		);
	}

	const rows: GridRow[] = fight.rules.map((rule) => ({
		key: rule.key,
		// Banded only where it actually applied. A rule that never fired is a fact about the encounter
		// rather than about this pull, and shading it would read as something having happened.
		band: rule.ms > 0 ? ('ok' as const) : undefined,
		cells: {
			rule: <b className="font-semibold text-ink">{rule.name}</b>,
			basis: <span className="text-ink-2">{t(`fight.basis.${rule.basis}`)}</span>,
			windows: (
				<span className="text-ink-2">
					{rule.windows.length === 0 ? t('fight.never') : rule.windows.map((w) => formatClock(w.start)).join(', ')}
				</span>
			),
			held: <b className="font-semibold text-ink-2">{rule.ms === 0 ? '—' : formatSeconds(rule.ms)}</b>,
		},
	}));

	return (
		<Section id="fight" title={t('fight.title')}>
			<Prose>{t('fight.intent')}</Prose>

			<div className="mt-5">
				<DataGrid
					caption={t('fight.caption', { encounter: fight.encounter })}
					columns={[
						{ key: 'rule', label: t('fight.columns.rule'), width: '180px' },
						{ key: 'basis', label: t('fight.columns.basis'), width: '110px' },
						{ key: 'windows', label: t('fight.columns.windows'), card: 'wide' },
						{ key: 'held', label: t('fight.columns.held'), align: 'right', width: '90px' },
					]}
					rows={rows}
					empty={t('fight.noRules')}
				/>
			</div>

			{fight.noteKey === null ? null : (
				<div className="mt-5 flex flex-col gap-3">
					<Note>{t(`fight.note.${fight.noteKey}`)}</Note>
					{/*
					 * The audit half, folded away by default.
					 *
					 * Six of these notes carried their own evidence inline: the pull counts, the press rates
					 * either side of a window, the comparison that rejected a candidate rule. That is what makes
					 * the call checkable six months later, and it is also most of the reading. Splitting it into
					 * `fight.audit.*` behind a disclosure keeps both — the verdict is the note, the measurement
					 * is one click away — rather than choosing between a short page and an auditable one.
					 *
					 * `<details>` rather than a controlled toggle: it needs no state, it is open to a find-in-page,
					 * and it prints expanded.
					 */}
					{t(`fight.audit.${fight.noteKey}`, { defaultValue: '' }) === '' ? null : (
						<details className="group">
							<summary className="cursor-pointer font-mono text-sm font-medium tracking-[0.1em] uppercase text-muted marker:content-none hover:text-ink-2">
								{t('fight.auditTrigger')}
							</summary>
							<div className="mt-2.5">
								<Note>{t(`fight.audit.${fight.noteKey}`)}</Note>
							</div>
						</details>
					)}
				</div>
			)}
		</Section>
	);
}
