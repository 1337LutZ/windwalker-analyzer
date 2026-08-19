import type { SpecDefinition } from '~/lib/spec';
import type { Analysis } from '~/lib/types';

import { Callout } from '../primitives';

/**
 * A spec report for the wrong spec is worse than no report: every buff section would render as a row
 * of zeroes that reads like a damning verdict on someone playing their own spec correctly.
 *
 * The refusal names the spec from its definition — the page this rendered under is that spec's page,
 * so the reader's question "what did I open?" has one answer, and it is the registered one.
 */
export default function SpecRefusal({ analysis, spec }: { analysis: Analysis; spec: SpecDefinition }) {
	return (
		<Callout title={`${analysis.player} was not ${spec.displayName} in this fight`}>
			<p className="m-0">
				Nothing in this pull's events matches {spec.displayName}: every section of this report is built on the spec's
				buttons and its priority list, so rendering it anyway would produce a page of zeroes that reads as a verdict on
				someone who may have been playing a different spec perfectly well.
			</p>
			<p className="m-0">
				Nothing was wrong with the report or the fetch — pick another player, or another pull, in the steps above.
			</p>
		</Callout>
	);
}
