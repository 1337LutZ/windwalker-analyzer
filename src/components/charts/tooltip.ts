// The tooltip card as markup, for the two callers that need a string rather than elements.
//
// **One renderer, two shapes.** `Tooltip.tsx` is the card; this renders that component to static
// markup. It used to be a hand-built string beside the component, and a hand-built string beside a
// component is two cards: a padding changed in one, a colour in the other, and a page with two
// tooltips that are almost the same. Rendering the component is what makes that impossible rather
// than merely tested for.
//
// It also takes the escaping off this module's hands. The string version carried its own `escape`
// for the values it interpolated; React escapes text by construction, and the one that got away —
// a quote inside an attribute — cannot happen when nothing is being concatenated into one.
//
// A string is still the right output here: ApexCharts' `custom` callback takes markup, and the
// imperative hit-test tooltips in `CastTimeline` and the two track lanes write into one node rather
// than mounting a component per mark. A caller that can hold its hovered mark in state should use
// `Tooltip` directly — the replay's map does.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { ChartTheme } from './theme';
import Tooltip from './Tooltip';
import type { TipContent } from './tooltipContent';

export type { TipContent, TipRow } from './tooltipContent';
export { TIP_MAX_WIDTH, titleTone } from './tooltipContent';

/**
 * Tooltip markup, built from the same component the replay renders.
 *
 * Exported because most of what raises this card cannot mount a component per mark: the cast
 * timeline has several hundred of them and writes one node, and ApexCharts asks for a string
 * outright. Both are handed the same `TipContent`, so every chart on the page draws one card.
 */
export function tooltip(theme: ChartTheme, content: TipContent): string {
	return renderToStaticMarkup(createElement(Tooltip, { theme, content }));
}
