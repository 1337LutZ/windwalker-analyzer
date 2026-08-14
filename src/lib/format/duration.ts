// Clocks and durations. Every timestamp the analysis emits is fight-relative milliseconds, so that
// is what these take.
//
// The formatters are built once, here, rather than inside a render: an `Intl.NumberFormat` built in
// a component is rebuilt on every pass, and two call sites that disagree about digit settings look
// like a bug in the numbers rather than a difference in setup.

import { formatDuration, intervalToDuration } from 'date-fns';

const secondsFormat = new Intl.NumberFormat('en-US', {
	style: 'unit',
	unit: 'second',
	unitDisplay: 'narrow',
	maximumFractionDigits: 1,
});

/**
 * Fight-relative milliseconds as `m:ss` — the clock every timestamp in the report is read on, and
 * the one WarcraftLogs' own replay shows.
 *
 * Deliberately not date-fns: this is a division and a pad, and routing it through a Date only adds
 * a timezone that a fight-relative offset does not have.
 */
export function formatClock(ms: number): string {
	const total = Math.max(0, ms);
	const minutes = Math.floor(total / 60000);
	const seconds = Math.floor((total % 60000) / 1000);
	return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Milliseconds as seconds with its unit, one decimal: `4200` → `4.2s`. */
export function formatSeconds(ms: number): string {
	return secondsFormat.format(ms / 1000);
}

/**
 * A short gap, in the unit that keeps it honest: `717` → `0.7s`, but `21` → `21ms`.
 *
 * One decimal of seconds cannot express a miss by a fiftieth of a second, and rounding it to `0s`
 * reads as "no gap at all" — which is the opposite of the point being made when the report says a
 * brew went out *after* the proc expired. Below a tenth of a second the milliseconds are the number
 * worth printing.
 */
export function formatGap(ms: number): string {
	return ms < 100 ? `${Math.round(ms)}ms` : formatSeconds(ms);
}

/**
 * A figure the analysis already stores in seconds, with its unit: `22.4` → `22.4s`. Separate from
 * `formatSeconds` because the mistake it prevents — dividing a seconds figure by a thousand — is
 * silent, and produces a plausible-looking number.
 */
export function formatSecondsValue(seconds: number): string {
	return secondsFormat.format(seconds);
}

/**
 * A span of time in words: `305000` → `5 minutes 5 seconds`. For prose, where `5:05` would read as
 * a timestamp rather than as a length.
 *
 * date-fns earns its place here — pluralisation and unit names are exactly what it is for — where
 * for `m:ss` above it would not.
 */
export function formatHumanDuration(ms: number): string {
	const duration = intervalToDuration({
		start: 0,
		end: Math.max(0, Math.round(ms)),
	});
	const words = formatDuration(duration, {
		format: ['hours', 'minutes', 'seconds'],
	});
	return words === '' ? '0 seconds' : words;
}
