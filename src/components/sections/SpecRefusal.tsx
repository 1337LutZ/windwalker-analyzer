import type { Analysis } from '~/lib/types';

import { Callout } from '../primitives';

/**
 * A spec report for the wrong spec is worse than no report: every buff section would render as a row
 * of zeroes that reads like a damning verdict on someone playing their own spec correctly.
 */
export default function SpecRefusal({ analysis }: { analysis: Analysis }) {
	return (
		<Callout title={`${analysis.player} was not ${analysis.specName} in this fight`}>
			<p className="m-0">
				Not one Tigereye Brew was cast in {analysis.encounter}, and every section of this report is built on brews, the
				Re-Origination procs they snapshot, and the Windwalker priority list. Rendering it anyway would produce a page
				of zeroes that reads as a verdict on someone who may have been playing Brewmaster or Mistweaver perfectly well.
			</p>
			<p className="m-0">
				Nothing was wrong with the report or the fetch — pick another player, or another pull, in the steps above.
			</p>
		</Callout>
	);
}
