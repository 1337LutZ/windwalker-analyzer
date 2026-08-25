// The spec's palette, resolved by the name the analysis itself carries.

import { SPECS } from '~/lib/spec';
import type { SpecColors } from '~/lib/game/classes';

/**
 * The palette a report draws in, resolved from the spec's own name.
 *
 * `analysis.specName` is the WarcraftLogs spelling (`'Windwalker'`), which is what the registry keys
 * a definition by as well, so this is the one lookup a view needs to colour its bars in the spec's
 * primary. A name that matches no definition falls back to the deployment default's palette — the
 * view never invents a colour, and an unmatched name is a programming error elsewhere rather than a
 * rendering decision to make here.
 */
export function specColorsOf(specName: string): SpecColors {
	return SPECS.find((spec) => spec.specName === specName)?.colors ?? SPECS[0]!.colors;
}

/**
 * What `--spec-primary` is set to on a page that is about no spec: the splash and the 404.
 *
 * Those two pages ask which spec you played, so they must not answer it themselves. `global.css`
 * derives eleven colours from `--spec-primary` — the ground, the lines, the two dim text colours and
 * the accent every link and focus ring is drawn in — and its default is the monk's green, so a splash
 * that took the default would be a monk-branded page offering a shaman.
 *
 * `#a1a9a4` is not a new colour. It is the untinted base `--color-muted` is already mixed from, so
 * feeding it back in as the primary leaves that colour exactly where it was and returns every other
 * derived one to the neutral it is a tint of. The accent comes out a light warm grey, which reads as
 * a colour nobody has to recognise — which is the point, because the two class colours are the ones
 * a reader is meant to recognise.
 *
 * `landingCopy.test.ts` holds it against `CLASS_COLOR`, so a value that collides with a class the app
 * ships is a red run rather than a page quietly advertising one.
 */
export const NEUTRAL_PRIMARY = '#a1a9a4';
