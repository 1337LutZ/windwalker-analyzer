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
