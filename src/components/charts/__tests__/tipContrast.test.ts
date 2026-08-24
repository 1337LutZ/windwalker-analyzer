// The tooltip title has to be readable, and two tones were not.
//
// `tip()` tints its title line with the tone of the mark being hovered, so the heading names what the
// reader is pointing at. That works for the four judgements and fails for the two *grounds*: a ground
// is a colour picked to sit behind things, and the tooltip renders it as 14px text on `surface`.
// `track` — the exempt tone, the one behind "Dot up, not measured", "Nothing to hit" and "Three or
// more enemies" — came out at **1.31:1**, which is not dim but invisible. `missSoft` came out at
// 1.94:1. WCAG AA asks 4.5:1 at this size.
//
// **The fix was already written down elsewhere and simply not applied here.** `BAND.track.text` says
// `--color-track` written on `--color-track` is nothing at all and drops to `ink-2`. The tooltip is
// the second surface a tone becomes text on, and it kept the tone — the exact drift `tones.ts`'
// header exists to prevent. `TIP_TITLE` is that rule stated once for both.
//
// This file is the guard, and it is arithmetic rather than a pinned list of names: it resolves the
// real token values out of `styles/global.css` and computes the WCAG ratio. A tone added to a chart
// tomorrow, or a palette change that darkens an accent, fails here rather than in someone's eyes.
//
// The values are resolved rather than hard-coded because the palette is *derived* — every ground and
// both dim inks are `color-mix(in oklch, var(--spec-primary) N%, <base>)`, so a copy of the resolved
// hex in this file would be a second source of truth that silently stops matching the first.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { type ChartTheme, tip } from '../apex';
import { TIP_TITLE } from '../tones';

/**
 * WCAG AA for normal-weight text. The title is 600 weight but 14px, which is below the 18.66px the
 * large-text allowance starts at, so the normal threshold is the one that applies.
 */
const AA = 4.5;

const css = readFileSync(resolve(import.meta.dirname, '../../../styles/global.css'), 'utf8');

const token = (name: string): string => {
	const found = new RegExp(`--${name}:\\s*([^;]+);`).exec(css);
	if (found === null) throw new Error(`no --${name} in global.css`);
	return found[1]!.trim();
};

const hex = (value: string): [number, number, number] =>
	[1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16) / 255) as never;
const toHex = (rgb: number[]): string =>
	`#${rgb
		.map((v) =>
			Math.round(Math.min(1, Math.max(0, v)) * 255)
				.toString(16)
				.padStart(2, '0'),
		)
		.join('')}`;

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

/** sRGB to OKLab, per Björn Ottosson's published matrices — the space `color-mix(in oklch, …)` uses. */
function toOklab(value: string): [number, number, number] {
	const [r, g, b] = hex(value).map(toLinear) as [number, number, number];
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
	];
}

function fromOklab([L, a, b]: [number, number, number]): string {
	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
	return toHex(
		[
			4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
			-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
			-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
		].map(toGamma),
	);
}

/**
 * One `color-mix(in oklch, var(--spec-primary) N%, <base>)`, or a plain hex passed through.
 *
 * Mixed in OKLab rather than OKLCh. Every mix in this palette pairs the spec primary with a
 * near-neutral base, and a near-neutral has no meaningful hue angle to interpolate — CSS calls that a
 * powerless hue and falls back to the other colour's, which is what a cartesian lerp does anyway. The
 * lightness the ratio below is computed from is identical either way.
 */
function resolve1(value: string, primary: string): string {
	const mix = /color-mix\(in oklch,\s*var\(--spec-primary\)\s*([\d.]+)%,\s*([^)]+)\)/.exec(value);
	if (mix === null) return value;
	const share = Number(mix[1]) / 100;
	const base = mix[2]!.trim() === 'white' ? '#ffffff' : mix[2]!.trim();
	const a = toOklab(primary);
	const b = toOklab(base);
	return fromOklab(a.map((v, i) => v * share + b[i]! * (1 - share)) as [number, number, number]);
}

const PRIMARY = token('spec-primary');
const colour = (name: string): string => resolve1(token(`color-${name}`), PRIMARY);

const luminance = (value: string): number => {
	const [r, g, b] = hex(value).map(toLinear) as [number, number, number];
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string): number => {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
	return (hi + 0.05) / (lo + 0.05);
};

/** `ChartTheme` names the dim ink `ink2`; the CSS token is `--color-ink-2`. */
const CSS_NAME: Record<string, string> = { ink2: 'ink-2', missSoft: 'miss-soft' };
const themeColour = (key: string): string => colour(CSS_NAME[key] ?? key);

describe('the tooltip title is legible in every tone a chart can raise', () => {
	/** `tip()` draws its card on `theme.surface`, so that is the ground every title sits on. */
	const SURFACE = colour('surface');

	it('resolves the palette out of global.css rather than trusting a copy of it', () => {
		// Non-vacuity for the resolver itself: a regex that silently matched nothing would make every
		// ratio below a comparison of two identical strings, which passes and means nothing.
		expect(PRIMARY).toMatch(/^#[0-9a-f]{6}$/i);
		expect(SURFACE).toMatch(/^#[0-9a-f]{6}$/i);
		expect(SURFACE).not.toBe(PRIMARY);
		// The mix really was evaluated: `surface` is 10% of a vivid primary in near-black, so it must be
		// darker than the primary and not equal to the base it was mixed with.
		expect(luminance(SURFACE)).toBeLessThan(luminance(PRIMARY));
	});

	it.each(Object.entries(TIP_TITLE))('draws a %s title at AA or better', (_tone, drawnAs) => {
		expect(contrast(themeColour(drawnAs), SURFACE)).toBeGreaterThanOrEqual(AA);
	});

	/**
	 * The two the mapping exists for, asserted as *failing* — so this file records the defect rather
	 * than only its fix.
	 *
	 * **This much of the file guards the table and nothing else.** Every assertion above reads
	 * `TIP_TITLE` directly, so all of them stay green while `tip()` ignores the table entirely — which
	 * is exactly the state the bug was in. The call site is guarded at the bottom of this file, and
	 * that is the assertion that actually reds when the fix is reverted.
	 *
	 * If a palette change ever lifts one of these above the bar, this goes red and the entry in
	 * `TIP_TITLE` can be reconsidered on purpose instead of lingering as folklore.
	 */
	it.each([
		// `track` read 1.31 until the exempt ground was lifted out of the dark it was lost in — three keys
		// on one Flame Shock chart are this tone, and each was a dark grey chip on a dark grey surface. It
		// is 2.26 now and the entry stays: a ground legible as a *region* is nowhere near legible as
		// six-point text on that same region, which is the whole distinction `TIP_TITLE` encodes, and 2.26
		// is still half of AA.
		['track', 2.26],
		['missSoft', 1.94],
	])('would be unreadable if %s were used as its own title', (tone, expected) => {
		const ratio = contrast(themeColour(tone), SURFACE);
		expect(ratio).toBeCloseTo(expected, 1);
		expect(ratio).toBeLessThan(AA);
	});

	it('substitutes a colour that means the same thing, not merely a brighter one', () => {
		// `track` is the one tone that is not a judgement, so its title is plain ink.
		expect(TIP_TITLE.track).toBe('ink2');
		// `missSoft` decorates a `miss` bar and is `miss` mixed into the ground, so its title is `miss`.
		expect(TIP_TITLE.missSoft).toBe('miss');
		// And nothing else was quietly redirected while fixing those two.
		expect(
			Object.entries(TIP_TITLE)
				.filter(([tone, as]) => tone !== as)
				.map(([tone]) => tone),
		).toEqual(['missSoft', 'track']);
	});
});

/**
 * The call site, which is a separate thing to get wrong.
 *
 * Everything above proves the *table* says the right thing. None of it touches `tip()`, so all of it
 * stays green if `tip()` goes back to `theme[content.tone]` and draws the exempt title at 1.31:1
 * again — the defect was one interpolation in `apex.ts`, not a wrong number in `tones.ts`. The one
 * other test that calls `tip()` (`specs/windwalker/…/castTimeline.test.ts`) passes `tone: 'kick'`,
 * which `TIP_TITLE` maps to itself, so it cannot tell the two apart either.
 *
 * A synthetic theme rather than the real palette: each key is its own sentinel hex, so "was the
 * substitute used" is answered by which string reached the markup rather than by a contrast ratio,
 * and `not.toContain` can say the ground colour is nowhere in the card at all.
 */
describe('tip() draws the title in the substitute, not in the tone', () => {
	const THEME: ChartTheme = {
		bg: '#111101',
		surface: '#111102',
		raised: '#111103',
		line: '#111104',
		ink: '#111105',
		ink2: '#111106',
		muted: '#111107',
		brew: '#111108',
		rune: '#111109',
		kick: '#11110a',
		miss: '#11110b',
		missSoft: '#11110c',
		lust: '#11110d',
		track: '#11110e',
		mono: 'monospace',
		sans: 'sans-serif',
	};

	const title = (tone: keyof ChartTheme): string =>
		tip(THEME, { title: 'Nothing to hit', tone, rows: [['Window', '0:12 – 0:31']] });

	it('draws an exempt title in ink2, and never in the track ground', () => {
		const markup = title('track');
		expect(markup).toContain(`color:${THEME.ink2}">Nothing to hit</div>`);
		expect(markup).not.toContain(THEME.track);
	});

	it('draws a missSoft title in miss, and never in missSoft', () => {
		const markup = title('missSoft');
		expect(markup).toContain(`color:${THEME.miss}">Nothing to hit</div>`);
		expect(markup).not.toContain(THEME.missSoft);
	});

	it('leaves a tone that is its own substitute alone', () => {
		// The identity half of the mapping, so a `titleTone` that returned `ink2` for everything —
		// legible, and wrong — would red here rather than pass both cases above.
		expect(title('brew')).toContain(`color:${THEME.brew}">Nothing to hit</div>`);
		expect(title('kick')).toContain(`color:${THEME.kick}">Nothing to hit</div>`);
	});
});
