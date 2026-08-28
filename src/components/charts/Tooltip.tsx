// The same tooltip card as elements, for a caller that would rather render than write markup.
//
// `tooltip()` beside this hands the same card to callers that need markup: ApexCharts' `custom`
// callback takes a string, and the hit-test tooltips write into one shared node rather than mounting
// a component per mark. A chart with few enough marks to hold the hovered one in state should render
// this directly — `dangerouslySetInnerHTML` on a value React could have rendered gives up every
// guarantee React was making.
//
// **This is the only card.** `tooltip()` does not draw a second one beside it — it renders this
// component to static markup, which is what a page cannot have two of by construction rather than by
// a test that hopes to notice.
//
// Inline styles rather than classes, matching the string version and for its reason: these cards are
// drawn from `ChartTheme`, whose values are resolved off the stylesheet at runtime because ApexCharts
// writes colours into SVG presentation attributes that will not take a `var()`.

import type { CSSProperties } from 'react';

import type { ChartTheme } from './theme';
import { LABEL_FONT_SIZE } from './theme';
import { TIP_MAX_WIDTH, type TipContent, titleTone } from './tooltipContent';

const card = (theme: ChartTheme): CSSProperties => ({
	// See `tooltip()`: the card follows the cursor closely enough to sit under it, and must never
	// become the element a hit test finds.
	pointerEvents: 'none',
	minWidth: 210,
	maxWidth: TIP_MAX_WIDTH,
	whiteSpace: 'normal',
	padding: '10px 12px',
	background: theme.surface,
	border: `1px solid ${theme.line}`,
	borderRadius: 3,
	fontFamily: theme.mono,
	fontSize: LABEL_FONT_SIZE,
	lineHeight: 1.6,
});

/**
 * One tooltip card.
 *
 * The caller owns where it goes — this draws the card and nothing else, exactly as the string version
 * does, so a chart that wants it pinned to a mark and one that wants it following the pointer both
 * get the same card.
 */
export default function Tooltip({ theme, content }: { theme: ChartTheme; content: TipContent }) {
	return (
		<div style={card(theme)}>
			<div style={{ marginBottom: 5, fontWeight: 600, color: theme[titleTone(content.tone)] }}>{content.title}</div>
			{content.rows.map(([label, value, iconUrl]) => (
				// The label never wraps and the value does — see `tooltip()`, where the same pair of flex
				// items exists for the same reason: sharing the shortfall in proportion breaks a two-word
				// label across two lines to buy four characters for a sentence that needs forty.
				<div key={label} style={{ display: 'flex', gap: 14, justifyContent: 'space-between' }}>
					<span style={{ whiteSpace: 'nowrap', color: theme.muted }}>{label}</span>
					<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: theme.ink, fontWeight: 600 }}>
						{iconUrl === undefined ? null : (
							<img
								src={iconUrl}
								alt=""
								width={14}
								height={14}
								// `flex:none` so the icon is never what gives way when the row is wider than the card:
								// a squeezed spell icon is unrecognisable, which is the whole reason a row carries art.
								style={{ flex: 'none', width: 14, height: 14, borderRadius: 2, border: `1px solid ${theme.line}` }}
							/>
						)}
						{value}
					</span>
				</div>
			))}
		</div>
	);
}
