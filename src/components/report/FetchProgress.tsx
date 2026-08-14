import type { FetchProgress as FetchState } from '~/lib/wcl';

import { Progress } from '../primitives';

/**
 * The event fetch is four-plus round trips over several seconds, so it gets a real bar rather than a
 * spinner: the page must never look like it has stopped.
 *
 * The bar is weighted rather than linear in requests because the page count is not knowable in
 * advance — the last page is the one that says it was the last — so the event phase creeps towards
 * a ceiling it never reaches on its own instead of pretending to know how far along it is.
 */
export default function FetchProgress({ progress }: { progress: FetchState }) {
	return <Progress pct={progressPct(progress)} label={progress.message} />;
}

function progressPct(progress: FetchState): number {
	switch (progress.phase) {
		case 'report':
			return 12;
		case 'table':
			return 26;
		case 'done':
			return 100;
		case 'events':
			return Math.min(92, 34 + (progress.page ?? 1) * 12);
	}
}
