import { useReportCopy } from '~/hooks/useReportCopy';
import { formatInteger, formatSeconds } from '~/lib/format';
import type { Analysis } from '~/lib/types';

import { Note, Prose, Section, StatTile, StatTiles } from '~/components/primitives';
import { wasteTone } from '~/specs/windwalker/lib/score';

import ElixirWeaveTrack from '../charts/ElixirWeaveTrack';

/**
 * Elixir weaving: steering what the Rune returns once the brew has stopped listening.
 *
 * Tigereye Brew reads mastery once, in `OnGain`, and never again — `sim/monk/windwalker/
 * tigereye_brew.go:53`. So a brew that is up cannot use another point of mastery, while Rune of
 * Re-Origination has just converted crit and haste to nothing. Swapping onto a rival secondary after
 * the brew lands makes that stat the highest, so the next Rune proc comes back as something the player
 * can still spend.
 *
 * **Three things can go wrong and only one of them is "did not do it".** The swap can beat its own
 * brew, which lowers the very mastery the brew is about to freeze; it can come back too early, which
 * gives away weave time for nothing; or it can never happen. The first two are counted and drawn and
 * carry no weight in the headline, because both are conditional on having weaved at all — a monk who
 * never tried would score a clean nought on each.
 *
 * A pull without the Rune gets no section at all rather than a nought. The whole technique is a way of
 * steering that trinket, so without it there was nothing here to do, and saying otherwise would be a
 * claim about a player made out of their bag.
 */
export default function ElixirWeave({ analysis }: { analysis: Analysis }) {
	const { t } = useReportCopy(analysis);
	const weave = analysis.weave;

	// A capture from before this audit carries nothing at all — `undefined`, not an empty summary — and
	// the heading still renders, because `SectionNav` lists every section unconditionally.
	if (weave === undefined) {
		return (
			<Section id="elixir-weave" title={t('weave.title')}>
				<Prose>{t('weave.intent')}</Prose>
				<div className="mt-5">
					<Note>{t('empty.section')}</Note>
				</div>
			</Section>
		);
	}

	// Three answers, and the middle one is why `runeEquipped` is read from the gear rather than from
	// whether any proc fired. "Did not wear it", "wore it" and "the log did not say" are three findings,
	// and the third must not render as either of the others.
	if (weave.runeEquipped !== true) {
		return (
			<Section id="elixir-weave" title={t('weave.title')}>
				<Prose>{t('weave.intent')}</Prose>
				<div className="mt-5">
					<Note>{t(weave.runeEquipped === false ? 'weave.noRune' : 'weave.unknownGear')}</Note>
				</div>
			</Section>
		);
	}

	const tried = weave.taken > 0 || weave.early > 0;

	return (
		<Section id="elixir-weave" title={t('weave.title')}>
			<Prose>{t('weave.intent')}</Prose>

			{/* The prompt, and it is the whole section for a monk who has never done this. No tiles, no
			    track: three noughts and an empty chart would read as a poor attempt rather than as a
			    technique nobody has picked up, and the one sentence worth reading would be buried under
			    them. */}
			{!tried ? (
				<div className="mt-5 flex flex-col gap-3.5">
					<Note>{t('weave.never', { brews: weave.offered })}</Note>
					{/* A card rather than another paragraph. This is the one thing on the page a reader is meant
					    to walk away and do, and prose under a heading that already reads like prose is where an
					    instruction goes to be skimmed past. The card shape is `SectionGaps`', unchanged. */}
					<div className="flex flex-col gap-2 rounded-sm border border-line p-3.5">
						<span className="font-mono text-sm font-medium tracking-[0.1em] uppercase text-ink-2">
							{t('weave.howTitle')}
						</span>
						<Prose>{t('weave.how')}</Prose>
					</div>
				</div>
			) : (
				<>
					<div className="mt-4.5">
						<StatTiles>
							{/* `weaved / offered`, the same shape the cast tiles use: a count of weaves cannot be
							    read without the chances beside it, since three is most of a short pull and a
							    quarter of a long one. */}
							<StatTile
								value={formatInteger(weave.taken)}
								suffix={` / ${formatInteger(weave.offered)}`}
								label={t('weave.kpi.taken')}
								grade={wasteTone(weave.offered - weave.taken, Math.max(weave.offered, 1))}
							/>
							<StatTile
								value={formatInteger(weave.early)}
								label={t('weave.kpi.early')}
								grade={wasteTone(weave.early, Math.max(weave.taken + weave.early, 1))}
							/>
							<StatTile
								value={formatInteger(weave.lateReturn)}
								label={t('weave.kpi.late')}
								grade={wasteTone(weave.lateReturn, Math.max(weave.taken, 1))}
							/>
						</StatTiles>
					</div>

					<div className="mt-5">
						<ElixirWeaveTrack weave={weave} />
					</div>

					<div className="mt-5 flex flex-col gap-3.5">
						<Prose>
							{t('weave.read', {
								context: weave.taken === weave.offered ? 'all' : 'some',
								taken: weave.taken,
								offered: weave.offered,
							})}
						</Prose>
						{weave.early > 0 ? <Prose>{t('weave.diluted', { count: weave.early })}</Prose> : null}
						{weave.lateReturn > 0 ? (
							<Prose>
								{t('weave.backEarly', { count: weave.lateReturn, seconds: formatSeconds(weave.returnLeewayMs) })}
							</Prose>
						) : null}
					</div>
				</>
			)}

			<div className="mt-4">
				<Note>{t('weave.scope', { seconds: formatSeconds(weave.returnLeewayMs) })}</Note>
			</div>
		</Section>
	);
}
