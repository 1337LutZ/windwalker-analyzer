// One i18next instance, initialised synchronously with bundled resources.
//
// Two constraints shape this and neither is negotiable. The site is prerendered, so translations
// have to exist during the build as well as in the browser — a loader that fetches JSON at runtime
// would render the static HTML full of raw keys. And the production CSP is
// `connect-src 'self' https://classic.warcraftlogs.com`, so a translation CDN could not be reached
// even if we wanted one. Resources are therefore imported and compiled into the bundle.
//
// Numbers arriving through interpolation go through the same `lib/format` helpers the components
// use, wired in as i18next formatters. That is what stops a sentence rendering
// "9.714285714285714 stacks" while the tile beside it says "9.7" — the formatting lives in one
// place and the copy asks for it by name.

import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import {
	formatCompact,
	formatDecimal,
	formatInteger,
	formatPercentValue,
	formatSeconds,
	formatGap,
	formatSecondsValue,
} from '~/lib/format';
import { formatClock } from '~/lib/format';

import en from '~/locales/en';

export const DEFAULT_LOCALE = 'en';

/** Every locale bundled into the build. Adding one is an import and a line here. */
export const RESOURCES = { en } as const;

export type Locale = keyof typeof RESOURCES;

/** The namespaces the app splits copy across. `report` is the analysis; `ui` is the shell. */
export const NAMESPACES = ['report', 'ui'] as const;

/**
 * Formatters usable from any string as `{{value, name}}`.
 *
 * Named for the *unit* rather than the function, so the copy reads as copy: `{{pct, percent}}`,
 * `{{ms, clock}}`. A translator never has to know which helper is behind one.
 */
const FORMATTERS: Record<string, (value: unknown) => string> = {
	// A percentage already expressed 0–100, which is how the analysis carries them.
	percent: (v) => formatPercentValue(Number(v)),
	integer: (v) => formatInteger(Number(v)),
	decimal: (v) => formatDecimal(Number(v)),
	compact: (v) => formatCompact(Number(v)),
	// Milliseconds as a fight clock, `4:39`.
	clock: (v) => formatClock(Number(v)),
	// Milliseconds as a duration, `15s`.
	duration: (v) => formatSeconds(Number(v)),
	// Seconds that are already seconds.
	seconds: (v) => formatSecondsValue(Number(v)),
	// Milliseconds as a short gap, in whichever unit keeps it honest: `21ms`, `0.7s`. `duration`
	// rounds a miss by a fiftieth of a second to `0s`, which reads as no gap at all.
	gap: (v) => formatGap(Number(v)),
};

let started = false;

/**
 * Idempotent because both the prerender and each hydrating island reach for it, and i18next warns
 * (and rebinds React) if it is initialised twice.
 */
export function initI18n(locale: Locale = DEFAULT_LOCALE) {
	if (started) return i18next;
	started = true;

	void i18next.use(initReactI18next).init({
		lng: locale,
		fallbackLng: DEFAULT_LOCALE,
		ns: [...NAMESPACES],
		defaultNS: 'report',
		resources: RESOURCES,
		// Nothing here is user input, and React escapes its own output anyway; double-escaping turns
		// an apostrophe in "Rising Sun Kick's" into `&#39;` inside the rendered text.
		interpolation: { escapeValue: false },
		// A missing key must be loud in development and harmless in production: React renders the key
		// itself, which is ugly on screen but never a blank section or a thrown error.
		returnEmptyString: false,
		parseMissingKeyHandler: (key) => {
			if (import.meta.env.DEV) console.warn(`[i18n] missing key: ${key}`);
			return key;
		},
	});

	// Registered against the formatter service rather than passed as `interpolation.format`. That
	// option is silently ignored as of i18next 26 — it is not called and no warning is raised, so
	// `{{avg, decimal}}` renders the raw float and the sentence disagrees with the tile beside it.
	for (const [name, fn] of Object.entries(FORMATTERS)) {
		i18next.services.formatter?.add(name, (value) => fn(value));
	}

	return i18next;
}

export default i18next;
