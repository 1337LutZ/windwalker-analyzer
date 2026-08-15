import { useReportCopy } from '~/hooks/useReportCopy';
import { formatInteger, formatSeconds } from '~/lib/format';
import type { Analysis } from '~/lib/types';

import ChiBrewTrack from '../charts/ChiBrewTrack';
import { usageTone, wasteTone } from '~/lib/score/waste';

import { Note, Prose, Section, StatTile, StatTiles } from '../primitives';

/**
 * Chi Brew: two charges, forty-five seconds each, two chi and two brew stacks a press.
 *
 * The section exists because the button fails in two opposite directions and a single number cannot
 * hold both. Press it on a full bar and the chi it returns has nowhere to go; do not press it at all
 * and the charges sit at the ceiling, where they are not recharging. One is a mistake of timing and
 * the other of omission, so they get a card each rather than being summed into "wasted".
 *
 * Neither figure is inferred. The chi arrives as a `resourcechange` carrying both the amount and its
 * own `waste`, so the overcap is the log's own number; the charges are a standard two-charge walk
 * against the recharge time the sim states.
 *
 * Nothing here is graded. There is no number of seconds at two charges that the priority list calls
 * acceptable — it presses the button when it wants chi and holds it when it does not — and a
 * threshold would be inventing one.
 */
export default function ChiBrew({ analysis }: { analysis: Analysis }) {
	const { t } = useReportCopy(analysis);
	const brew = analysis.chiBrew;

	// A fixture captured before this audit existed carries nothing — `undefined`, not an empty audit —
	// and the heading still has to render, because `SectionNav` lists every section unconditionally.
	if (brew === undefined) {
		return (
			<Section id="chi-brew" title={t('chiBrew.title')}>
				<Prose>{t('chiBrew.intent')}</Prose>
				<div className="mt-5">
					<Note>{t('empty.section')}</Note>
				</div>
			</Section>
		);
	}

	// Three states, and the middle one is the reason `talented` is read from the talent list rather
	// than from whether the button was pressed. "Did not take it" and "took it and never used it" are
	// opposite findings; "cannot say" is a third and must not be rendered as either.
	if (brew.talented === false) {
		return (
			<Section id="chi-brew" title={t('chiBrew.title')}>
				<Prose>{t('chiBrew.intent')}</Prose>
				<div className="mt-5">
					<Note>{t('chiBrew.notTalented')}</Note>
				</div>
			</Section>
		);
	}

	if (brew.talented === null) {
		return (
			<Section id="chi-brew" title={t('chiBrew.title')}>
				<Prose>{t('chiBrew.intent')}</Prose>
				<div className="mt-5">
					<Note>{t('chiBrew.unknownTalent')}</Note>
				</div>
			</Section>
		);
	}

	return (
		<Section id="chi-brew" title={t('chiBrew.title')}>
			<Prose>{t('chiBrew.intent')}</Prose>

			<div className="mt-4.5">
				<StatTiles>
					{/* `pressed / possible`, the same shape the cast table uses, because a count of presses
					    cannot be read as good or bad without the ceiling beside it — seven is most of a short
					    pull and a third of a long one. The ceiling goes in `suffix`, which the tile already
					    draws smaller and muted, so the number a reader is judging stays the loud one. */}
					<StatTile
						value={formatInteger(brew.casts)}
						suffix={` / ${formatInteger(brew.possibleUses)}`}
						label={t('chiBrew.kpi.uses')}
						grade={usageTone(brew.casts, brew.possibleUses)}
					/>
					{/* Gross, not net. This used to be `gained - wasted` under the label "Chi kept", which is
					    two facts folded into one number a reader cannot take apart — and the overcap sits
					    beside it now, so netting it would also be subtracting the tile next door. */}
					<StatTile value={formatInteger(brew.chiGained)} label={t('chiBrew.kpi.chi')} />
					{/* Directly beside what it came out of: the overcap only means anything against the total
					    that produced it, and two chi lost reads differently on a pull that gained six than on
					    one that gained twenty. Graded on that same denominator for the same reason. */}
					<StatTile
						value={formatInteger(brew.chiWasted)}
						label={t('chiBrew.kpi.overcapped')}
						grade={wasteTone(brew.chiWasted, brew.chiGained)}
					/>
					{/* Graded against the clock the figure is measured on, which is the time the player had
					    something to hit — the same one `cappedPct` and the ceiling above are fractions of. The
					    pull's own length was the denominator here and is the wrong one twice over: idle charges
					    during an intermission are not a fault anybody committed, and dividing a number that no
					    longer counts them by a span that still does colours the tile from a fraction the report
					    prints nowhere. The clock is published on `debuff` because that is the section that owns
					    it; `durationMs` is the fixture fallback, which is what those pulls were graded on. */}
					<StatTile
						value={formatSeconds(brew.cappedMs)}
						label={t('chiBrew.kpi.capped')}
						grade={wasteTone(brew.cappedMs, analysis.debuff.contactMs || analysis.durationMs)}
					/>
				</StatTiles>
			</div>

			{/* The counter itself, shaded where both charges sat full. The two sentences below are the
			    same two facts in words, and a reader who can see the shape first reads them faster. */}
			<div className="mt-5">
				<ChiBrewTrack analysis={analysis} />
			</div>

			<div className="mt-5 flex flex-col gap-3.5">
				{/* What the button returned, and what the bar refused. Stated together because the second
				    is only legible against the first — two chi lost matters differently on a pull that
				    gained six than on one that gained twenty. */}
				<Prose>
					{brew.casts === 0
						? t('chiBrew.never', { possible: brew.possibleUses })
						: t('chiBrew.gained', {
								context: brew.chiWasted > 0 ? 'wasted' : 'clean',
								uses: brew.casts,
								possible: brew.possibleUses,
								gained: brew.chiGained,
								wasted: brew.chiWasted,
							})}
				</Prose>

				{/* The other half: a charge at the ceiling is not recharging, so this is cooldown that the
				    pull was never going to get back. */}
				<Prose>
					{t('chiBrew.capped', {
						context: brew.cappedMs > 0 ? 'some' : 'none',
						seconds: brew.cappedMs,
						pct: brew.cappedPct,
						chi: brew.chiLostToIdle,
					})}
				</Prose>
			</div>

			<div className="mt-4">
				<Note>{t('chiBrew.scope', { seconds: formatSeconds(45_000) })}</Note>
			</div>
		</Section>
	);
}
