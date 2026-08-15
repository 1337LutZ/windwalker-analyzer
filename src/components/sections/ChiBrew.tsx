import { useReportCopy } from '~/hooks/useReportCopy';
import { formatDecimal, formatInteger, formatSeconds } from '~/lib/format';
import type { Analysis } from '~/lib/types';

import ChiBrewTrack from '../charts/ChiBrewTrack';
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

	const netChi = brew.chiGained - brew.chiWasted;

	return (
		<Section id="chi-brew" title={t('chiBrew.title')}>
			<Prose>{t('chiBrew.intent')}</Prose>

			<div className="mt-4.5">
				<StatTiles>
					<StatTile value={formatInteger(brew.casts)} label={t('chiBrew.kpi.uses')} />
					<StatTile value={formatInteger(netChi)} label={t('chiBrew.kpi.chi')} />
					<StatTile value={formatSeconds(brew.cappedMs)} label={t('chiBrew.kpi.capped')} />
					{/* Only once there is idle time to price. A tile reading "0 chi" on a pull that never let a
					    charge sit is a fault reported where there was none. */}
					{brew.cappedMs === 0 ? null : (
						<StatTile value={formatDecimal(brew.chiLostToIdle)} label={t('chiBrew.kpi.lost')} />
					)}
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
