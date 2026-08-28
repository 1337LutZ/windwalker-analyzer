// The chart palette, read off the stylesheet, and the type every chart and tooltip is drawn from.
//
// Split out of `apex.ts` when the tooltip card moved to its own module. Both of them need the theme,
// and a tooltip importing it from `apex.ts` while `apex.ts` imports the tooltip is a runtime cycle
// between two modules that have no reason to know about each other — the card is not an ApexCharts
// thing, and has not been one since the cast timeline started drawing it.
//
// `apex.ts` re-exports everything here, so nothing that already imported `ChartTheme`, `readTheme` or
// `LABEL_FONT_SIZE` from it had to change.

/**
 * The semantic tokens from `src/styles/global.css`, read off the document at runtime.
 *
 * Read rather than duplicated on purpose: ApexCharts writes colours into SVG presentation
 * attributes, which do not accept `var(--color-brew)`, so the values have to be resolved in JS. A
 * second copy of the hexes here is a copy that would silently drift from the stylesheet.
 */
export interface ChartTheme {
	bg: string;
	surface: string;
	raised: string;
	line: string;
	ink: string;
	ink2: string;
	muted: string;
	brew: string;
	rune: string;
	kick: string;
	miss: string;
	missSoft: string;
	lust: string;
	track: string;
	mono: string;
	sans: string;
}

const TOKENS: Record<keyof ChartTheme, string> = {
	bg: '--color-bg',
	surface: '--color-surface',
	raised: '--color-raised',
	line: '--color-line',
	ink: '--color-ink',
	ink2: '--color-ink-2',
	muted: '--color-muted',
	brew: '--color-brew',
	rune: '--color-rune',
	kick: '--color-kick',
	miss: '--color-miss',
	missSoft: '--color-miss-soft',
	// Here for one caller: the cast timeline tints a Bloodlust band's tooltip title with the colour the
	// band itself is drawn in, which is the pairing rule `charts/tones.ts` exists to enforce.
	lust: '--color-lust',
	track: '--color-track',
	mono: '--font-mono',
	sans: '--font-sans',
};

export function readTheme(): ChartTheme {
	const style = getComputedStyle(document.documentElement);
	const out = {} as ChartTheme;
	for (const key of Object.keys(TOKENS) as Array<keyof ChartTheme>) {
		out[key] = style.getPropertyValue(TOKENS[key]).trim();
	}
	return out;
}

/**
 * The 14px floor the rest of the page keeps to, applied inside the charts as well.
 *
 * Chart text used to sit at 10–11px. ApexCharts writes a fixed pixel size into the SVG, so it does
 * not shrink with the viewport — it was simply small. Raising it costs plot width on a phone, which
 * is what the shorter opening window below and the shortened track names in the timeline pay for.
 */
export const LABEL_FONT_SIZE = '14px';
