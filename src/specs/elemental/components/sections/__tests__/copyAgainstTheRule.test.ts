// Two shipped sentences that said something untrue, and the guards that stop them coming back.
//
// Both were found by reading the copy against the code rather than against itself, which is the only way
// either could have been found: the suite rendered both sections, both assertions passed, and neither
// string was wrong in a way a renderer can see.
//
//   1. **The shield section contradicted itself on the same page.** `lightningShield.intent` said "Always
//      spend it at seven" while `lightningShield.aoeNote`, two paragraphs down, said the two-target list
//      "does spend the shield, just at six stacks instead of seven". The code is the second one:
//      `ES_CLEAVE_STACKS` is 6, and a band-2 press under six pushes `cleaveStacks` rather than
//      `belowFull`. The `intent` line was the pre-band sentence left standing after the band work landed,
//      so a reader got a hard rule in one paragraph and its correction in the next.
//
//   2. **The Lava Burst note named the wrong instant.** It ended "Only a press *committed* with no dot at
//      all is listed here; a dot that expires mid-cast is charged as a lost cast **instead**". The field
//      reads `inWindow(press.t, …)` — the **completion** — which was settled deliberately, with all three
//      instants argued in the field's own docblock. So a press committed onto a dot with under a cast time
//      left *is* in this table, and the ladder charges the choice **as well**: two charges, one for the
//      outcome and one for the decision, and the note said the first did not happen.
//
//      Both halves of that note were checked against the field before either was rewritten. The first —
//      "the bonus is settled when the cast goes out, not when the missile lands" — is correct as written:
//      the sim's `ApplyEffects` tests the dot at completion and only `DealDamage` waits for travel. It was
//      the second half that disagreed with it, not with the code alone.
//
// The behaviour behind (2) is already pinned in `lib/__tests__/lavaBurst.test.ts` ("reads the completion
// instant, so a dot that expires inside the cast is not credited", and the 39s press that joins the
// dot-less list because of it). What was missing was copy that agreed with it, so these are assertions
// about the sentences rather than a second reading of the audit.
//
// The literals are spelled out here rather than fetched with a second `t()` call, for the reason the
// sibling copy tests give: a test whose two sides both come out of the locale file passes whatever the
// locale file happens to say.
//
// `createElement` rather than JSX so this stays a `.ts` file and is picked up by the project's own vitest
// include patterns.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { initI18n } from '~/lib/i18n/config';
import { getSpec } from '~/lib/spec';
import type { Analysis, ElementalAuditResult, FightDataset } from '~/lib/types';

import { SpecContext } from '~/components/report/specContext';
import { analyse } from '~/specs/elemental/lib';

import LavaBurst from '../LavaBurst';
import LightningShield from '../LightningShield';

const ELEMENTAL_SPEC = getSpec('elemental')!;

initI18n();

type El = Analysis & ElementalAuditResult;

const cleave: El = analyse(
	JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../__fixtures__/cleave.json'), 'utf8')) as FightDataset,
) as El;

const render = (Component: (props: { analysis: Analysis }) => unknown, analysis: Analysis) =>
	renderToStaticMarkup(
		createElement(SpecContext.Provider, { value: ELEMENTAL_SPEC }, createElement(Component as never, { analysis })),
	);

describe('the shield section states one rule for both target counts', () => {
	/**
	 * The two numbers, in the paragraph that states the rule — not one number there and a correction later.
	 * `cleave` is the fixture that has both bands in it, so the section under test is one a reader could
	 * actually be holding when the two paragraphs disagree.
	 */
	it('names seven at one enemy and six at two', () => {
		const html = render(LightningShield, cleave);
		// Both numbers, both target counts, in one sentence. Asserted as a shape rather than a quotation:
		// a literal pin here made a shorter rewrite of the same rule fail for saying it in fewer words,
		// which is the failure `docs/labels-and-figures.md` names — "a test pinning the literal string is
		// worse than none". What must not change is that the sentence carries both.
		expect(html).toMatch(/seven[^.]{0,40}one enemy[^.]{0,40}six[^.]{0,40}two/);
		// The sentence that had to go, quoted so it cannot come back under a different rewrite.
		expect(html).not.toContain('Always spend it at seven');
	});

	/**
	 * And it is still a hard rule, which is the copy sweep's standard: six is not a preference or a
	 * suggestion, it is a different number. A sentence that softened into "prefer", "try to" or "usually"
	 * would satisfy the assertion above and lose the thing it was protecting.
	 */
	it('keeps both numbers hard rather than softening either', () => {
		const html = render(LightningShield, cleave);
		// The claim, not its phrasing: the rule says these are numbers and not preferences, however few
		// words it takes to say so.
		expect(html).toMatch(/hard numbers[^.]{0,20}not preferences/);
		for (const hedge of ['usually spend', 'try to spend', 'prefer to spend']) {
			expect(html, hedge).not.toContain(hedge);
		}
	});
});

describe('the Lava Burst note names the instant the field reads', () => {
	/**
	 * The completion, and the press the old sentence denied was here. The note renders on every pull, so
	 * `cleave` is only the pull it is read on and not evidence for it — see the last test in this block.
	 */
	it('says the completion decides the row, and that the mid-cast press is in it', () => {
		const html = render(LavaBurst, cleave);
		expect(html).toContain('So it is the completion that decides the row');
		expect(html).toContain('committed onto a dot with less than a cast time left');
		// The false claim, quoted so no rewrite reinstates it: that press is charged twice, not diverted.
		expect(html).not.toContain('Only a press committed with no dot at all is listed here');
		expect(html).not.toContain('charged as a lost cast instead');
	});

	/**
	 * The half of the note that was already right, kept: the bonus is banked at completion and the ~0.8s of
	 * travel cannot take it away. The two halves now name the same instant, which is what the rewrite was
	 * checked against rather than assumed.
	 */
	it('keeps the travel-time half, which named the same instant all along', () => {
		const html = render(LavaBurst, cleave);
		expect(html).toContain('The bonus is settled when the cast goes out, not when the missile lands');
	});

	/**
	 * And a fact worth stating beside the rewrite: **no committed fixture has a dot-less press at all** —
	 * zero across `cleave`, `phased` and `unbroken`, every one of their 133 presses committed with the dot
	 * up. Which is exactly why the old sentence survived. Commit and completion agree on every press the
	 * repo can check, so nothing rendered differently, nothing failed, and the only way to catch it was to
	 * read the string against the field. The instant is pinned on a synthetic pull in
	 * `lib/__tests__/lavaBurst.test.ts`; this is the assertion that the copy agrees with it.
	 */
	it('is a claim no fixture can exercise, which is why it went unnoticed', () => {
		expect(cleave.lavaBurst.presses.filter((press) => press.flameShock === false)).toEqual([]);
		expect(cleave.lavaBurst.presses.length).toBeGreaterThan(0);
	});
});
