import { useReportCopy } from '~/hooks/useReportCopy';
import { formatInteger } from '~/lib/format';
import type { Analysis } from '~/lib/types';

import { BrewBankTrack } from '../charts';
import { usageTone } from '~/specs/windwalker/lib/score';

import { Note, Prose, Section, StatTile, StatTiles } from '~/components/primitives';

/** The bank counter over the pull, sharing its clock with the timeline above it. */
export default function BrewBankTimeline({ analysis }: { analysis: Analysis }) {
	const { brew } = analysis;
	const { t, card } = useReportCopy(analysis);

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

	/**
	 * The brews that went out with the bank under ten — the distribution the mean was hiding.
	 *
	 * `brewStacks` grades a *mean* of at least 9.5, so nineteen brews at ten and one at half a bank average
	 * 9.53 and grade `good`, and `verdict_good_other` said "near the cap every time" over the one that was
	 * nowhere near it. It was live on `mixed`: seven brews averaging 9.7, one of them spent at eight, with
	 * the chart drawing "8 stacks" directly above the sentence denying it.
	 *
	 * Read off `fullUses`, which the audit already publishes as the count of brews that spent the whole ten
	 * (`u.consumed >= TEB_DRAIN`), rather than re-derived from `useList` here — the same discipline the
	 * `gained` tile above states.
	 */
	const lean = brew.uses - brew.fullUses;

	/**
	 * How many of those short brews the pull had no reason for — and the reason this clause stopped
	 * reading the section's letter.
	 *
	 * `lean` counts *every* brew that went out under ten, and the priority list makes two of them on
	 * purpose: a Re-Origination proc on its last global, and the tail of the fight where banked stacks
	 * die with the boss. On `cleave` all three of its short brews are those presses, so a sentence keyed
	 * on `lean` would tell a reader "3 of them went out with the bank under ten" and then name that very
	 * excuse in the next breath. `brewShortUses` is the count that already honours both exceptions — see
	 * `shortBrews` in `lib/score.ts`, which takes them from the list's own two floorless arms.
	 *
	 * Keyed on the metric rather than on `gradeOf('brew')`, which is what the first version of this
	 * clause did. The letter cannot select this sentence, because the letter is now the *worst* of three
	 * metrics: `strong` letters `bad` off this very count and would have been handed
	 * `verdict_bad_other` — "averaging only 9.3 of 10 stacks" — where the mean is not the fault and the
	 * three short brews the sentence never names are.
	 *
	 * **`unmeasurable` has to be a guard, and the reason is a trap in the published shape.** `metricOf`
	 * returns `value: graded ?? 0`, so a metric too thin to grade reports **zero** rather than its own
	 * count. Reading that as a count would hand `weave` — five brews, two left after the exceptions,
	 * under `MIN_GRADED_SAMPLE` — the sentence congratulating a pull whose every short brew was the right
	 * press, off a zero the report never measured. Null here instead, and a null falls through to the
	 * graded sentence: "the gap is stacks you earned but never spent" claims neither excuse nor fault,
	 * which is the only honest register when the count cannot be read.
	 */
	const shortUses = card.sections.brew?.metrics.find((m) => m.key === 'brewShortUses');
	const faulted = shortUses === undefined || shortUses.unmeasurable ? null : shortUses.value;

	/**
	 * The grade for a sentence about the **mean**, which the section's letter is not.
	 *
	 * The letter is the worst of `brewStacks`, `brewCapWaste` and `brewShortUses` — so a pull that spent
	 * a full ten every time and let the bank sit at twenty letters `bad`, and `verdict_bad_other` told
	 * it "6 brews spent, averaging only 10 of 10 stacks". "Only" about a perfect mean, and the fault it
	 * was reaching for is named by the cap clause on the next line anyway. `verdict_ok_other` misses the
	 * same way one step milder: "the gap is stacks you earned but never spent" over a mean with no gap.
	 *
	 * This is the correction the `short` clause above already made, applied to the fall-through: the
	 * sentence is chosen by the number it is about.
	 *
	 * **Never `good`, and that is not a hedge.** This grade is only asked for on the arm where the short
	 * count cannot be read, and `lean > 0` is known there — a brew went out under ten — so
	 * `verdict_good_other`'s "near the cap every time" is a claim about a brew that was not at the cap.
	 * `ok` is the sentence that claims neither excuse nor fault, which is the register that arm's whole
	 * reason for existing asks for.
	 */
	const stacks = card.sections.brew?.metrics.find((m) => m.key === 'brewStacks');
	const meanGrade = stacks === undefined || stacks.unmeasurable || stacks.grade === 'good' ? 'ok' : stacks.grade;

	const summary = [
		!spent
			? t('brew.verdict', { context: 'none' })
			: // Every brew full is the only state that earns "near the cap every time", and it is now the
				// only state that reaches it: stacks are integers and a drain takes ten, so `lean === 0`
				// means the mean is exactly ten. Named rather than looked up by letter, which is what used
				// to let the other two sentences through this arm.
				lean === 0
				? t('brew.verdict', { context: 'good', count: brew.uses, avg: brew.avgConsumed })
				: faulted === null
					? t('brew.verdict', { context: meanGrade, count: brew.uses, avg: brew.avgConsumed })
					: faulted === 0
						? t('brew.verdict', { context: 'shortExcused', count: brew.uses, avg: brew.avgConsumed, lean })
						: t('brew.verdict', { context: 'short', count: brew.uses, avg: brew.avgConsumed, short: faulted }),
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
