import { useReportCopy } from '~/hooks/useReportCopy';
import { formatInteger } from '~/lib/format';
import type { Analysis } from '~/lib/types';

import { BrewBankTrack } from '../charts';
import { usageTone } from '~/lib/score/waste';

import { Note, Prose, Section, StatTile, StatTiles } from '../primitives';

/** The bank counter over the pull, sharing its clock with the timeline above it. */
export default function BrewBankTimeline({ analysis }: { analysis: Analysis }) {
	const { brew } = analysis;
	const { t, card, verdict } = useReportCopy(analysis);

	// Cap waste is one of the two metrics behind the section's grade, so its clause reads the metric
	// rather than the section: a pull can spend full brews every time and still sit at the cap.
	const cap = card.sections.brew?.metrics.find((m) => m.key === 'brewCapWaste');

	// `uses` is what the graded sentence counts, so a pull that never spent a brew asks for the `none`
	// variant directly instead of trusting the section grade — stacks wasted at the cap keep the
	// section measurable, and the average of zero brews is not a thing to report.
	const spent = brew.uses > 0;

	/**
	 * Every stack the pull earned, or `undefined` on a fixture captured before the engine counted it.
	 *
	 * Read, never rebuilt. `totalConsumed + bankAtEnd + wastedAtCap` is the same number only while every
	 * drain paired to a brew window, and a tile that quietly disagreed with the chart beside it on the
	 * one pull where it did not would be worse than a tile that says nothing. `undefined` is "cannot
	 * say" and has to render as an uncoloured count rather than as a ratio out of zero.
	 */
	const gained = brew.stacksGained;

	/**
	 * The stacks this pull could fairly have been asked to spend.
	 *
	 * Everything it earned, less the ones given up on purpose to hold a brew through a Re-Origination
	 * proc. Those are already outside what `brewCapWaste` grades — see `wastedProtecting` — and a tone
	 * taken on the raw total would put them straight back in, faulting a player for a stack they traded
	 * away deliberately while the snapshot section separately praises the trade.
	 *
	 * The tile still *shows* the raw total, which is the same split the cap sentence below already
	 * makes: it prints every stack the cap refused and wears the grade of the avoidable ones, and the
	 * sentence after it names the difference. Two numbers for two questions — what happened, and what
	 * of it was yours — rather than a denominator the reader cannot find anywhere on the page.
	 */
	const spendable = gained === undefined ? null : gained - (brew.wastedProtecting ?? 0);

	const summary = [
		spent ? verdict('brew', { count: brew.uses, avg: brew.avgConsumed }) : t('brew.verdict', { context: 'none' }),
		// `count`, not `wasted`: the sentence has singular and plural forms, and i18next selects them
		// off `count` alone. One stack lost at the cap is reachable, so "1 stacks" was too.
		cap && !cap.unmeasurable ? t('brew.cap', { context: cap.grade, count: brew.wastedAtCap }) : null,
		// The count above is every stack the cap refused; the grade beside it is only the avoidable ones.
		// A reader shown a total that does not match the verdict will assume one of them is wrong, so the
		// difference is named rather than left to be inferred. `?? 0` because the fixtures predate it.
		(brew.wastedProtecting ?? 0) > 0 ? t('brew.capProtected', { count: brew.wastedProtecting ?? 0 }) : null,
		// An empty bank is only worth praising when brews were actually going out; on a pull with none
		// it would be congratulating a bank that never filled.
		brew.bankAtEnd > 0 ? t('brew.bankLeft', { count: brew.bankAtEnd }) : spent ? t('brew.bankLeftNone') : null,
	]
		.filter(Boolean)
		.join(' ');

	return (
		<Section id="bank" title={t('brew.title')}>
			<Prose>{t('brew.intent')}</Prose>
			{/* Gated on the same condition as the chart. A pull whose bank never moved has no stacks to
			    divide up, and three tiles of zero would read as a measurement rather than as its absence. */}
			{brew.bankTimeline.length > 0 ? (
				<div className="mt-4.5">
					<StatTiles>
						{/* `used / gained`, that way round because the stacks spent are what the player did and the
						    stacks earned are the size of the chance they had — the same shape, and the same reason,
						    as `casts / possible` on Rising Sun Kick. Inverting it would put the achievement in the
						    small muted half.

						    Deliberately not a tile of the shortfall. `gained - used` is two unrelated faults added
						    together — a bank left full and a bank never emptied — and only one of them is answered
						    by pressing the button sooner, which is why the next two tiles take them separately
						    instead. Together those two are exactly this tile's gap, so the row adds up on its
						    face. */}
						<StatTile
							value={formatInteger(brew.totalConsumed)}
							suffix={gained === undefined ? undefined : ` / ${formatInteger(gained)}`}
							label={t('brew.kpi.used')}
							grade={spendable === null ? null : usageTone(brew.totalConsumed, spendable)}
						/>
						{/* Stacks the pull earned and was still holding when the boss died — the half of the gap
						    above that a brew going out sooner would have spent.

						    Ungraded, and that is not an oversight. Nothing in `lib/score` says how empty a bank
						    should be at the end, and it cannot: a pull that dies with three stacks banked was
						    seconds from a brew it had no way to know it would not get. The tone the reader needs
						    is on the tile before it, which already counts these as unspent. */}
						<StatTile value={formatInteger(brew.bankAtEnd)} label={t('brew.kpi.banked')} />
						{/* The other half of the gap: stacks that never reached the bank at all because it was
						    full. Shown raw, and wearing `brewCapWaste`'s grade — the metric that already grades
						    this exact figure, on the avoidable stacks only. Not a share of `gained` scored fresh
						    here: that would be a second opinion about a number the sentence below already carries a
						    verdict on, and the two would sooner or later print different colours for one fact. */}
						<StatTile
							value={formatInteger(brew.wastedAtCap)}
							label={t('brew.kpi.capped')}
							grade={cap && !cap.unmeasurable ? cap.grade : null}
						/>
					</StatTiles>
				</div>
			) : null}
			<div className="mt-5">
				{brew.bankTimeline.length > 0 ? <BrewBankTrack analysis={analysis} /> : <Note>{t('empty.section')}</Note>}
			</div>
			<div className="mt-5">
				<Prose>{summary}</Prose>
			</div>
		</Section>
	);
}
