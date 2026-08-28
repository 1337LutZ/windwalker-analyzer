import { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';

import { queryClient } from '~/lib/query/client';
import { getSpec } from '~/lib/spec';

import Analyzer from './Analyzer';
import SessionProvider from './auth/SessionProvider';

/**
 * The island root, and nothing else.
 *
 * The whole page hangs off one session and one query cache, so both providers have to be above all
 * of it — which means App itself cannot read either. Everything that calls `useSession` or a query
 * hook lives inside `Analyzer`; anything added here would be outside the providers and would throw.
 *
 * The cache itself lives in `lib/query/client`, not here, and that is a development-server fix rather
 * than tidying: this module imports the registry, so any edit under `lib/` or `specs/` re-executes it
 * and React remounts the tree — which used to run a `useState` initialiser on a fresh `QueryClient` and
 * buy the open report again. That module imports nothing that changes, so the instance survives.
 */

export interface AppProps {
	/**
	 * The registry key of the spec this page is, from the route that built it.
	 *
	 * A key and not a `SpecDefinition`, because this is the island boundary: Astro serialises an
	 * island's props into the document, and most of a definition is functions that no serialiser can
	 * carry. So the route hands over the one part that survives and this resolves the rest, out of the
	 * same registry the route read it from. Everything below here takes the definition itself.
	 */
	specKey: string;
	/**
	 * Which page this island is: one pull read, or two put side by side.
	 *
	 * A string rather than a second island, and it crosses the boundary for the same reason `specKey`
	 * does. Both pages hang off one session and one query cache, and they are the same page down to
	 * the sign-in step, so splitting them here would duplicate every provider and — worse — give a
	 * reader who moves between the two a second, empty cache to refill at the API's expense.
	 */
	mode?: 'report' | 'compare';
}

export default function App({ specKey, mode = 'report' }: AppProps) {
	// Read through `useState` rather than called inline, so a re-render never reaches for it: the
	// initialiser runs once per mount, and on a remount it is handed back the same instance.
	const [client] = useState(queryClient);

	const spec = getSpec(specKey);
	// Thrown rather than defaulted to the first registered spec, which is the tempting shape and the
	// dangerous one: a pull scored against a spec the address did not name is a report that is
	// confidently wrong at every heading rather than one that is visibly broken.
	if (spec === undefined) throw new Error(`No spec is registered as "${specKey}".`);

	return (
		<QueryClientProvider client={client}>
			<SessionProvider>
				<Analyzer spec={spec} mode={mode} />
			</SessionProvider>
		</QueryClientProvider>
	);
}
