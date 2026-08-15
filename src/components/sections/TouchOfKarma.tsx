import { useMemo } from 'react';

import { useReportCopy } from '~/hooks/useReportCopy';
import { formatClock, formatCompact, formatInteger, formatPercentValue } from '~/lib/format';
import { defensiveUseTone } from '~/lib/score/waste';
import type { Analysis } from '~/lib/types';

import { DataGrid, Note, Prose, Section, SpellIcon, StatTile, StatTiles, type GridRow } from '../primitives';

/**
 * Touch of Karma: the defensive that does damage.
 *
 * It redirects what the player takes onto the target for ten seconds, so an unused charge is damage
 * not done as well as damage not avoided — which is why it earns a section rather than a row in the
 * cast table.
 *
 * What it *could* have returned is shown on a pull that measured it, and only there. The redirect
 * absorbs at most a full health pool, and a use that drained its own states that pool exactly — so
 * on a pull with one of those the section can say how much of each press was left unspent. On a pull
 * with none it says so in as many words instead of estimating: a player's `maxHitPoints` reads 100,
 * and a pool derived from absolute damage against a percentage bar is good to about ±10%, which is
 * how the old column came to print 105% of a ceiling that cannot be exceeded. See `karmaCap` in the
 * engine for both measurements.
 *
 * The judgement it can always support is the one that matters most: a Karma pressed into a quiet
 * stretch returns nothing, and the per-use table shows that directly.
 *
 * The Fortifying Brew column is reported and pointedly not celebrated. It arrived as a request to
 * flag the pairing "for the extra damage done", and the sim does not support that reading — see the
 * engine, which carries the numbers. The copy says what the overlap is instead of what it was hoped
 * to be, and the column only exists on a pull that actually has one.
 */
export default function TouchOfKarma({ analysis }: { analysis: Analysis }) {
	const { karma } = analysis;
	const { t, verdict, card } = useReportCopy(analysis);
	// Fixtures captured before this was measured carry no `fortifyingBrew` on a use and no count at
	// all, so both read `undefined` rather than `0` — hence the truthiness guard rather than a
	// comparison, which is the exact shape of a bug this file has already had once.
	const withFortifying = karma.withFortifyingBrew ?? 0;
	// Read off the metrics rather than the section, so each tile is coloured by the number it shows
	// and stays neutral on a pull that could not answer it.
	const empties = card.sections.karma?.metrics.find((m) => m.key === 'karmaEmpty');
	const capShare = card.sections.karma?.metrics.find((m) => m.key === 'karmaCapShare');
	const emptyPresses = karma.uses.filter((use) => use.reflected === 0).length;

	const rows = useMemo<GridRow[]>(
		() =>
			karma.uses.map((use, i) => ({
				key: `${use.t}-${i}`,
				// Both ends of the table are marked, and only the two that are facts rather than opinions.
				// A use that redirected nothing is the fault this section exists to show. A use that drained
				// its pool is the opposite and is the only row here that cannot be faulted — it returned
				// everything it was worth, which is measured rather than judged against a threshold.
				// Everything between them is unbanded on purpose: how much a Karma returns is mostly what
				// the fight was doing to the player, and a middling row is not a middling decision.
				band: use.reflected === 0 ? ('warn' as const) : use.exhausted ? ('ok' as const) : undefined,
				cells: {
					at: formatClock(use.t),
					reflected: (
						<b className={`font-semibold ${use.reflected === 0 ? 'text-miss' : 'text-ink'}`}>
							{formatCompact(use.reflected)}
						</b>
					),
					// Only when a ceiling is known. A dash would imply a number that could not be computed;
					// the column simply is not there on a pull where no use drained its pool.
					//
					// A use that drained one is marked rather than left to be inferred from a hundred: it is
					// the one row in the table that cannot be faulted — it returned everything it was worth —
					// and that is the actionable half of the section for a reader skimming it.
					...(use.capPct === null
						? {}
						: {
								capPct: (
									<span className={use.exhausted ? 'text-kick' : 'text-ink-2'}>
										{formatPercentValue(use.capPct)}
										{use.exhausted ? ` ${t('karma.cells.capped')}` : ''}
									</span>
								),
							}),
					hits: formatInteger(use.hits),
					// Neutral weight on purpose: an overlap is a fact about the pull, not a fault and not
					// an achievement, so it is neither banded nor coloured.
					...(withFortifying === 0
						? {}
						: {
								fortifying: <span className="text-ink-2">{use.fortifyingBrew ? t('karma.cells.yes') : '—'}</span>,
							}),
				},
			})),
		[karma.uses, withFortifying, t],
	);

	return (
		<Section id="karma" title={t('karma.title')}>
			<Prose>{t('karma.intent')}</Prose>

			{karma.casts === 0 ? (
				<div className="mt-5">
					<Note>{t('karma.none', { available: karma.available })}</Note>
				</div>
			) : (
				<>
					<div className="mt-4.5">
						<StatTiles>
							{/* Uses taken over uses the cooldown allowed, on `defensiveUseTone`'s deliberately wide
							    bands rather than `usageTone`'s — see the note there. A tone and not a graded metric:
							    how many charges a fight offers something to redirect is the encounter's business, so
							    this hints at the size of the number and `lib/score` never counts it. */}
							<StatTile
								value={`${karma.casts}`}
								suffix={`/${karma.available}`}
								label={t('karma.kpi.uses')}
								grade={defensiveUseTone(karma.casts, karma.available)}
							/>
							<StatTile value={formatCompact(karma.reflected)} label={t('karma.kpi.reflected')} />
							<StatTile
								value={formatCompact(karma.casts > 0 ? karma.reflected / karma.casts : 0)}
								label={t('karma.kpi.perUse')}
							/>
							{/* Counts the presses that *landed*, not the ones that did not, while taking its colour
							    from the empty-press metric — the two are complements, so the grade is identical.

							    It was the other way round and read "0/2 Returned nothing" in green, which is the one
							    thing a tile must never do: a label naming a fault, a zero that could be the good half
							    or the bad half, and a colour contradicting both. Stating the good half puts the
							    number, the label and the colour in agreement.

							    A tile of its own rather than a colour on the damage total, which is what it would
							    otherwise have to borrow: 845k returned is not a bad number, and painting it red
							    because one *other* press landed on nothing states a verdict about the wrong figure. */}
							<StatTile
								value={`${karma.casts - emptyPresses}`}
								suffix={`/${karma.casts}`}
								label={t('karma.kpi.landed')}
								grade={empties && !empties.unmeasurable ? empties.grade : null}
							/>
							{/* Only on a pull that measured its own ceiling. Everywhere else this figure would be
							    a share of a pool nobody stated, which is the number this section refuses to print. */}
							{capShare && !capShare.unmeasurable ? (
								<StatTile
									value={formatPercentValue(capShare.value)}
									label={t('karma.kpi.ofCap')}
									grade={capShare.grade}
								/>
							) : null}
						</StatTiles>
					</div>

					<div className="mt-5">
						<DataGrid
							caption={t('karma.caption')}
							columns={[
								{ key: 'at', label: t('karma.columns.at'), width: '96px' },
								{
									key: 'reflected',
									label: t('karma.columns.reflected'),
									align: 'right',
									width: '120px',
								},
								...(karma.capPerUse === null
									? []
									: [
											{
												key: 'capPct',
												label: t('karma.columns.capPct'),
												align: 'right' as const,
												width: '96px',
											},
										]),
								{ key: 'hits', label: t('karma.columns.hits'), align: 'right', width: '96px' },
								// Only on a pull that had one. A column of dashes would imply the overlap is
								// something to aim for, which is the opposite of what the note under it says.
								...(withFortifying === 0
									? []
									: [
											{
												key: 'fortifying',
												label: t('karma.columns.fortifying'),
												align: 'right' as const,
												width: '96px',
											},
										]),
							]}
							rows={rows}
							empty={t('karma.none', { available: karma.available })}
						/>
					</div>

					<div className="mt-5 flex flex-col gap-3.5">
						<Prose>
							<span className="inline-flex items-center gap-2 align-middle">
								<SpellIcon id={122470} size="sm" />
							</span>{' '}
							{verdict('karma', {
								casts: karma.casts,
								available: karma.available,
								reflected: karma.reflected,
								share: karma.sharePct,
							})}{' '}
							{/* Counted here rather than named in the verdict, because the verdict follows the
							    section's grade and that grade can come from either metric — a sentence that
							    asserted empty presses would be wrong on a pull graded down for half-filled ones. */}
							{emptyPresses > 0 ? t('karma.empty', { count: emptyPresses }) : null}
						</Prose>
						{/* Two situations, and the copy has to say which one the reader is looking at. A pull
						    where a use drained its pool states that pool and what the presses left unspent; a
						    pull where none did says it cannot tell, rather than estimating one. */}
						{karma.capPerUse === null ? (
							<Note>{t('karma.capUnknown')}</Note>
						) : (
							<Prose>
								{t('karma.capSummary', {
									health: karma.capPerUse,
									casts: karma.casts,
									possible: karma.capPerUse * karma.casts,
									absorbed: karma.absorbed ?? 0,
									pct: capShare?.value ?? 0,
									count: karma.exhausted ?? 0,
								})}
							</Prose>
						)}
						{/* Only when it happened, and stated as a correction rather than as a credit: the
						    overlap raises the redirect's ceiling and lowers what fills it at the same time. */}
						{withFortifying > 0 ? (
							<Note>
								{t('karma.fortifying', { count: withFortifying })} {t('karma.fortifyingNote')}
							</Note>
						) : null}
					</div>
				</>
			)}
		</Section>
	);
}
