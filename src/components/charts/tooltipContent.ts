// What a tooltip says, and the two rules about how it is drawn that both renderers need.
//
// Split from the card itself so the string and the component can share them without importing each
// other: `tooltip()` renders `Tooltip`, so anything `Tooltip` needs has to sit below them both. That
// is also why this is not in `Tooltip.tsx` — a module exporting a component and a constant is one
// React Fast Refresh will not hot-swap, the same rule `report/specContext.ts` follows.

import type { ChartTheme } from './theme';
import { TIP_TITLE } from './tones';

/**
 * One line of a tooltip: a label, its value, and optionally an icon drawn before the value.
 *
 * The third slot exists for the rows whose value is a *spell* — the cast timeline names the press
 * that spent a buff, and a reader recognises a spell by its art before they read its name, exactly as
 * they do on the chart itself. It stays a URL rather than a spell id because this module knows about
 * drawing and not about the game, and it stays optional because every other row on every other chart
 * is a number or a clock and has no art to carry.
 */
export type TipRow = [label: string, value: string, iconUrl?: string];

/**
 * The widest a tooltip card may draw, and therefore the point at which a long value stops making the
 * card wider and starts wrapping inside it.
 *
 * Every value on these charts is a number or a clock and fits in the 210px floor below — except the
 * verdicts, which are sentences. `channelled through Energizing Brew with no Rushing Jade Wind
 * covering it` measured the Fists of Fury card at 648px against a 210–330px family, because
 * ApexCharts' own `.apexcharts-tooltip` is `white-space: nowrap` and a card with a floor and no
 * ceiling simply grows to whatever it is handed. Wrapping rather than truncating, because the
 * sentence is the explanation — a reader who cannot finish it has lost the row.
 *
 * The viewport term is the same rule the cast timeline's tip node already keeps (`max-w-[calc(100vw
 * -28px)]`), stated once here for both: a card that has to shrink is one being read on a phone, and
 * the 28px is the two gutters that timeline's placement leaves. Written as one `min()` rather than as
 * a second mechanism on top of that one.
 */
export const TIP_MAX_WIDTH = 'min(380px, calc(100vw - 28px))';

export interface TipContent {
	title: string;
	tone: keyof ChartTheme;
	rows: TipRow[];
}

/**
 * Which theme colour a title tinted for `tone` is actually drawn in.
 *
 * Almost always the tone itself. The exceptions are the two *grounds* — see `TIP_TITLE` in `tones.ts`
 * for the contrast numbers and for why each substitute is the semantically right colour and not just
 * a legible one. The fallback is the tone, so a `TipContent` naming a theme key that is not a mark
 * tone at all keeps its current behaviour.
 */
export const titleTone = (tone: keyof ChartTheme): keyof ChartTheme =>
	(TIP_TITLE as Partial<Record<keyof ChartTheme, keyof ChartTheme>>)[tone] ?? tone;
