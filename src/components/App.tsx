import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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

export default function App() {
	// Built on mount rather than at module scope: Astro prerenders this island, and a client created
	// during that pass would be a second, dead cache built into the bundle.
	const [queryClient] = useState(createQueryClient);

	return (
		<QueryClientProvider client={queryClient}>
			<SessionProvider>
				<Analyzer />
			</SessionProvider>
		</QueryClientProvider>
	);
}
