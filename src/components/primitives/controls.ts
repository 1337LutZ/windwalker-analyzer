// Class strings rather than components, because there is nothing to wrap: a button in this app is a
// real `<button>` with these classes on it, so the caller keeps `type`, `form`, `disabled` and every
// other native attribute instead of having them proxied through a prop.
//
// Two rules run through all of them. Anything tappable is at least 44px tall (`min-h-11`), because
// the whole app has to be usable one-handed on a phone. And nothing here drops below 14px — under
// that it is a readability problem before it is a style choice, and an input under 16px makes iOS
// zoom the viewport on focus, which is how a form ends up scrolled sideways with no way back.

// `cursor-pointer` is on the base, not on each variant. Tailwind's preflight sets `cursor: default`
// on `button`, so a real `<button>` shows an arrow unless something says otherwise — which reads as
// "not clickable" on every control in the app. `disabled:cursor-not-allowed` below still wins, since
// it is the more specific state.
const controlBase =
	'inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-sm px-4 py-2 font-mono text-sm font-semibold tracking-[0.1em] uppercase transition-colors';

export const buttonClass = `${controlBase} border border-line bg-raised text-ink hover:bg-line disabled:cursor-not-allowed disabled:bg-raised disabled:text-muted`;

export const primaryButtonClass = `${controlBase} border border-kick bg-kick text-bg hover:opacity-90 disabled:cursor-not-allowed disabled:border-line disabled:bg-raised disabled:text-muted`;

/**
 * The middle weight: louder than a link, quieter than the one button a screen is steering towards.
 *
 * For a control that is worth finding but is not the point of the card it sits in — the jump from a
 * summary card to the section arguing it. A bordered, transparent surface reads as a button without
 * competing with `primaryButtonClass` for the eye, and it is deliberately shorter than the other two:
 * a 44px target inside a summary card would out-weigh the sentence above it.
 */
export const secondaryButtonClass =
	'inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-sm border border-line bg-transparent px-2.5 py-1.5 font-mono text-sm font-medium tracking-[0.06em] text-ink-2 transition-colors hover:border-muted hover:bg-raised hover:text-ink';

export const fieldClass =
	'block min-h-11 w-full rounded-sm border border-line bg-bg px-3 py-2 font-mono text-base text-ink placeholder:text-muted';

export const labelClass = 'block font-mono text-sm font-medium tracking-[0.1em] uppercase text-muted';

/**
 * What "picked" and "not picked" look like, shared by all three pick-one controls below.
 *
 * They differ in shape — how many lines each holds, whether it fills its row — and agree on colour,
 * which is the half a reader learns once and then reads everywhere. One palette rather than three
 * copies of it, because three copies is three places for it to drift apart.
 */
const selectionPalette = (selected: boolean): string =>
	selected ? 'border-kick bg-raised text-ink' : 'border-line bg-bg text-ink-2 hover:border-muted hover:bg-raised';

/**
 * One option in a pick-one list. A list of these beats a `<select>` here because the choice carries
 * two lines of context — kill or wipe, how long, which class — that a native option row cannot show.
 */
export const choiceClass = (selected: boolean): string =>
	`flex min-h-11 w-full cursor-pointer flex-col items-start justify-center gap-0.5 rounded-sm border px-3 py-2 text-left transition-colors ${selectionPalette(selected)}`;

/** One of a short row of switches, sharing the palette without the stacked two-line shape. */
export const compactChoiceClass = (selected: boolean): string =>
	`min-h-11 flex-1 cursor-pointer rounded-sm border px-3 py-2 font-mono text-sm font-semibold tracking-[0.1em] uppercase transition-colors ${selectionPalette(selected)}`;

/**
 * One of a short row of switches on the sticky toolbar's single line.
 *
 * `compactChoiceClass` cannot be used there: it is `flex-1`, so in a toolbar it would eat the width
 * the encounter name needs. This is the same palette at the same height with the padding cut to what
 * a 390px bar can spare, which is what makes three switches fit beside the pull's name.
 *
 * `min-w-11` as well as `min-h-11`, which the other pick-one classes get for free from `flex-1` or
 * `w-full`. Nothing stretches these, and without it the two short labels measure 29px and 37px wide
 * — a 44px-tall target you still cannot hit with a thumb.
 *
 * The third state is the one the full control spells out in prose and this row has no line for: an
 * `overridden` switch is the reader's choice contradicting what the pull detected, and it is amber
 * rather than green so that disagreement is visible from the bar rather than only from the block
 * above the report.
 */
export const toolbarChoiceClass = (selected: boolean, overridden: boolean): string =>
	`min-h-11 min-w-11 shrink-0 cursor-pointer rounded-sm border px-1.5 font-mono text-sm font-semibold uppercase transition-colors ${
		selected && overridden ? 'border-brew bg-raised text-brew' : selectionPalette(selected)
	}`;

/**
 * The one button that stands in for that row of switches where the row will not fit.
 *
 * Neutral rather than picked, unlike `toolbarChoiceClass` above: it sits beside the Change and
 * settings buttons and is a way in to a choice rather than the choice itself, so colouring it as
 * selected would have it shouting louder than either of its neighbours. It keeps only the amber,
 * which is not decoration — a reading that contradicts what the pull detected has to be visible from
 * the bar, and collapsing three switches into one button is exactly where that could have been lost.
 *
 * Written as one string per state rather than as overrides appended to `buttonClass`, for the reason
 * `max-sm:px-2` exists on the Change button: two classes setting the same property resolve by
 * stylesheet order, not by the order they were concatenated in, so an override tacked onto the end
 * is a coin toss.
 */
export const toolbarMenuClass = (overridden: boolean): string =>
	`inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-sm border px-2 font-mono text-sm font-semibold uppercase transition-colors ${
		overridden ? 'border-brew bg-raised text-brew' : 'border-line bg-bg text-ink-2 hover:border-muted hover:bg-raised'
	}`;

/** A full-width row holding a single name — the player picker, where the name is the whole choice. */
export const singleLineChoiceClass = (selected: boolean): string =>
	`flex min-h-11 w-full cursor-pointer items-center rounded-sm border px-3 py-2 text-left font-mono text-base font-medium transition-colors ${selectionPalette(selected)}`;
