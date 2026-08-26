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

const millisFormat = new Intl.NumberFormat('en-US', {
	style: 'unit',
	unit: 'millisecond',
	unitDisplay: 'narrow',
	maximumFractionDigits: 0,
});

const millisDeltaFormat = new Intl.NumberFormat('en-US', {
	style: 'unit',
	unit: 'millisecond',
	unitDisplay: 'narrow',
	maximumFractionDigits: 0,
	signDisplay: 'exceptZero',
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

/**
 * The same clock to the millisecond — `83456` → `1:23.456`. What a tooltip prints for the *moment*
 * something happened.
 *
 * **Why this is a sibling of `formatClock` rather than an option on it, and why the two must not be
 * merged later.** They are read in different places and answer different questions. `formatClock`
 * labels axis ticks, table columns and sentences in prose, where the reader is being pointed at
 * roughly when something was: three extra digits are noise on every one of a hundred table rows, and
 * on an axis they are wide enough to collide with the next tick. A tooltip is the opposite case — one
 * reading of one thing the reader deliberately pointed at, and the reason they pointed at it is to
 * find out exactly when it was.
 *
 * **Why three digits and not one.** The log's own resolution is a millisecond, and this report keeps
 * turning on facts at that scale: the two halves of a Spear Hand Strike landing 2ms apart, a weave
 * whose ordering is decided inside a 1ms band, off-GCD presses packed inside a single global. One
 * decimal rounds every one of those to the same number, and the ordering the reader came for is gone.
 *
 * **Why always, rather than only where the fraction is interesting.** These are two-column monospace
 * tooltips. A fraction that appears on some rows and not others, or that is one digit here and three
 * there, leaves the value column ragged and makes precision look like a property of the event rather
 * than of the clock. A fixed three digits keeps every stamp the same width.
 *
 * Floors rather than rounds, on the same value `formatClock` floors, so the two can never disagree
 * about which second a moment fell in — rounding would print `83999` as `1:24.000`.
 */
export function formatStamp(ms: number): string {
	const total = Math.max(0, ms);
	return `${formatClock(total)}.${String(Math.floor(total % 1000)).padStart(3, '0')}`;
}

/** Milliseconds as seconds with its unit, one decimal: `4200` → `4.2s`. */
export function formatSeconds(ms: number): string {
	return secondsFormat.format(ms / 1000);
}

/**
 * A duration to the millisecond, with its unit: `2890` → `2,890ms`.
 *
 * **The one case where `formatSeconds` and `formatGap` both round away the argument being made.**
 * Every figure the haste model produces is a millisecond figure that only means anything against
 * another millisecond figure: a Crusader Strike modelled at 2,900ms beside a shortest observed gap of
 * 2,890ms is the model being confirmed to a hundredth of a global, and both of those print `2.9s`.
 * The same collapse hides the global's own breakpoint — rating alone gives 1,015ms and the seal over
 * it gives 1,000ms, which is the difference between reaching the floor and not, and which
 * `formatSeconds` renders as `1.0s` twice.
 *
 * So this is for a *comparison* at the log's own resolution and nothing else. A duration a reader is
 * meant to feel rather than check — how long a stun held, how long a buff ran — stays
 * `formatSeconds`; six digits of a fifteen-second window is precision nobody asked for. `formatGap`
 * is the third case and sits between them: it picks its unit by size, which is right for a miss and
 * wrong here, because it would print two of the numbers above in seconds and the third in
 * milliseconds.
 */
export function formatMillis(ms: number): string {
	return millisFormat.format(ms);
}

/**
 * The same, as a difference: `-2146` → `-2,146ms`, `70` → `+70ms`.
 *
 * `Intl` writes both signs, which is the whole of what this adds — a column of margins where the
 * positives are unsigned reads as a column of two different quantities. `exceptZero` rather than
 * `always`, so an exact hit prints `0ms`: a margin of nothing is not a positive margin, and `+0ms`
 * would claim a headroom the gap does not have.
 *
 * The minus is `en-US`'s own, which is the ASCII hyphen rather than U+2212. Left as `Intl` writes it:
 * substituting the typographic minus by hand would be this file deciding a locale's punctuation, and
 * the two do not differ in a monospace column.
 */
export function formatMillisDelta(ms: number): string {
	return millisDeltaFormat.format(ms);
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
