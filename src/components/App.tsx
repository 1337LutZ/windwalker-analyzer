import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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
 * The query defaults are set once, here, because the cost of a query in this app is not measured in
 * milliseconds: WarcraftLogs bills an hourly point budget per account, and a refetch triggered by
 * tabbing back to the window would spend it on data that cannot have changed. A finished report is
 * immutable, so nothing is ever refetched on its own — and nothing is retried either, because every
 * failure the client raises is the sign-in, the report code, or WarcraftLogs itself, and none of the
 * three is fixed by asking again a second later.
 */
function createQueryClient(): QueryClient {
	return new QueryClient({
		defaultOptions: {
			queries: {
				refetchOnWindowFocus: false,
				refetchOnReconnect: false,
				retry: false,
			},
		},
	});
}

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
}

export default function App({ specKey }: AppProps) {
	// Built on mount rather than at module scope: Astro prerenders this island, and a client created
	// during that pass would be a second, dead cache built into the bundle.
	const [queryClient] = useState(createQueryClient);

	const spec = getSpec(specKey);
	// Thrown rather than defaulted to the first registered spec, which is the tempting shape and the
	// dangerous one: a pull scored against a spec the address did not name is a report that is
	// confidently wrong at every heading rather than one that is visibly broken.
	if (spec === undefined) throw new Error(`No spec is registered as "${specKey}".`);

	return (
		<QueryClientProvider client={queryClient}>
			<SessionProvider>
				<Analyzer spec={spec} />
			</SessionProvider>
		</QueryClientProvider>
	);
}
