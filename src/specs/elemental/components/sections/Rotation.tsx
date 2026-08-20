import { useReportCopy } from '~/hooks/useReportCopy';
import type { Analysis } from '~/lib/types';
import { ROTATION } from '~/specs/elemental/lib/apl';

import { Note, Prose, Section, SpellIcon } from '~/components/primitives';

/**
 * The Elemental priority list itself: what to press, in what order, and what each fork is there to
 * prevent.
 *
 * The one section on the page that grades nothing. Every other section says what happened in this
 * pull; this one says what the pull was measured against, so a reader told their Earth Shock went
 * out early has somewhere to read the rule it missed. It is the full list — the fillers the Priority
 * section walks *and* the off-GCD cooldowns between them — because a list with the cooldowns left
 * out is not the list a player follows.
 */
export default function Rotation({ analysis }: { analysis: Analysis }) {
	const { t } = useReportCopy(analysis);

	const groups = ['cooldown', 'dot', 'filler'] as const;

	return (
		<Section id="rotation" title={t('rotation.title')}>
			<Prose>{t('rotation.intent')}</Prose>

			{groups.map((group) => {
				const entries = ROTATION.filter((entry) => entry.group === group);
				if (entries.length === 0) return null;
				return (
					<div key={group} className="mt-6">
						<h3 className="m-0 mb-3 font-mono text-sm font-semibold tracking-[0.1em] uppercase text-muted">
							{t(`rotation.group.${group}`)}
						</h3>
						<ol className="m-0 flex list-none flex-col gap-2.5 p-0">
							{entries.map((entry) => (
								<li key={entry.key} className="flex flex-col gap-1.5 rounded-sm border border-line bg-surface p-3.5">
									<span className="flex items-center gap-2">
										<SpellIcon id={entry.id} size="sm" />
										<span className="font-mono text-sm font-semibold tracking-[0.02em] text-ink">
											{t(`rotation.rule.${entry.key}.name`)}
										</span>
										{entry.talent ? (
											<span className="rounded-sm border border-line px-1.5 py-px font-mono text-xs text-muted">
												{t('rotation.talent')}
											</span>
										) : null}
									</span>
									<span className="text-sm leading-relaxed text-ink-2">
										{t(`rotation.rule.${entry.key}.condition`)}
									</span>
								</li>
							))}
						</ol>
					</div>
				);
			})}

			<div className="mt-6 flex flex-col gap-2.5">
				<Note>{t('rotation.notes.cooldowns')}</Note>
				<Note>{t('rotation.notes.raid')}</Note>
			</div>
		</Section>
	);
}
