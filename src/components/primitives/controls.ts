// Class strings rather than components, because there is nothing to wrap: a button in this app is a
// real `<button>` with these classes on it, so the caller keeps `type`, `form`, `disabled` and every
// other native attribute instead of having them proxied through a prop.
//
// Two rules run through all of them. Anything tappable is at least 44px tall (`min-h-11`), because
// the whole app has to be usable one-handed on a phone. And nothing here drops below 14px — under
// that it is a readability problem before it is a style choice, and an input under 16px makes iOS
// zoom the viewport on focus, which is how a form ends up scrolled sideways with no way back.

const controlBase =
	'inline-flex min-h-11 items-center justify-center gap-2 rounded-sm px-4 py-2 font-mono text-sm font-semibold tracking-[0.1em] uppercase transition-colors';

export const buttonClass = `${controlBase} border border-line bg-raised text-ink hover:bg-line disabled:cursor-not-allowed disabled:bg-raised disabled:text-muted`;

export const primaryButtonClass = `${controlBase} border border-kick bg-kick text-bg hover:opacity-90 disabled:cursor-not-allowed disabled:border-line disabled:bg-raised disabled:text-muted`;

export const fieldClass =
	'block min-h-11 w-full rounded-sm border border-line bg-bg px-3 py-2 font-mono text-base text-ink placeholder:text-muted';

export const labelClass = 'block font-mono text-sm font-medium tracking-[0.1em] uppercase text-muted';

/**
 * One option in a pick-one list. A list of these beats a `<select>` here because the choice carries
 * two lines of context — kill or wipe, how long, which class — that a native option row cannot show.
 */
export const choiceClass = (selected: boolean): string =>
	`flex min-h-11 w-full flex-col items-start justify-center gap-0.5 rounded-sm border px-3 py-2 text-left transition-colors ${
		selected ? 'border-kick bg-raised text-ink' : 'border-line bg-bg text-ink-2 hover:border-muted hover:bg-raised'
	}`;
