// One query cache per browser tab, held where a hot reload cannot throw it away.
//
// **The cache used to be built in `App`'s `useState`, and on the dev server that meant a refetch on
// almost every save.** `App` imports the spec registry, so a change anywhere under `lib/` or `specs/`
// re-executes `App.tsx`; the component that comes out is a different function object, React treats it as
// a different type and remounts the tree, and `useState` runs its initialiser again on a fresh
// `QueryClient`. The pull that had been fetched was gone, and the next render bought it again — about
// 440 WarcraftLogs points against an hourly budget, for editing a comment.
//
// Holding it here fixes that because this module imports nothing that changes. `App` may be re-executed
// and remounted as often as an edit demands; it re-imports this module, gets the instance that is
// already in it, and every report already fetched is still in the cache.
//
// ------------------------------------------------------------------ why not simply module scope
//
// A bare `export const client = new QueryClient()` would be built during Astro's prerender, which is the
// hazard the original `useState` was written to avoid: a cache constructed on the server, serialised
// into nothing, and shipped as a second dead instance. So the browser gets a singleton and the server
// gets a throwaway on every call — the server never reuses one, and nothing about SSR depends on it.

import { QueryClient, dehydrate, hydrate } from '@tanstack/react-query';

/**
 * The defaults, set once, because a query here is not measured in milliseconds.
 *
 * WarcraftLogs bills an hourly point budget per account, and a refetch triggered by tabbing back to the
 * window would spend it on data that cannot have changed. A finished report is immutable, so nothing is
 * refetched on its own — and nothing is retried, because every failure the client raises is the sign-in,
 * the report code, or WarcraftLogs itself, and none of the three is fixed by asking again a second later.
 */
function build(): QueryClient {
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

/**
 * Kept on the window rather than in a module variable, because a module variable was not enough.
 *
 * A module-scope singleton survives a *re-render*, and that is all. Astro's dev server answers a change
 * by re-importing the island's whole graph, so every module in it — this one included — is instantiated
 * again and its variables start empty. The cache went with them, and the open report was bought a third
 * time while this was being tested.
 *
 * `Symbol.for` reaches the same key across those instances, so the second copy of this module finds the
 * cache the first one made. The window is where a per-tab thing belongs anyway: that is exactly the
 * lifetime this cache is meant to have, and it is the lifetime the sign-in token already has.
 */
const CACHE_KEY = Symbol.for('windwalker-analyzer.queryClient');

type CacheHolder = { [CACHE_KEY]?: QueryClient };

/**
 * The tab's cache, or a fresh one when there is no tab.
 *
 * Safe to call from a `useState` initialiser, which is how `App` reads it: a remount asks again and is
 * handed the same instance rather than an empty one, so every report already fetched is still there.
 */
export function queryClient(): QueryClient {
	// No window, no tab to be per: a prerender gets a throwaway that nothing reuses, which is what keeps
	// a dead server-built cache out of the bundle.
	if (typeof globalThis.window === 'undefined') return build();
	const holder = globalThis as CacheHolder;
	if (holder[CACHE_KEY] === undefined) {
		const client = build();
		if (import.meta.env.DEV) reviveInDev(client);
		holder[CACHE_KEY] = client;
	}
	return holder[CACHE_KEY];
}

// ---------------------------------------------------------------- surviving the dev server's reloads

/**
 * Where a development snapshot of the cache lives, and why there is one at all.
 *
 * **Astro reloads the whole browser when anything in a page's module graph changes, and the analyser is
 * in it.** The page imports the island, the island imports the spec registry, and the registry reaches
 * every metric and the reference table — so editing a comment under `lib/` reloads the tab. That is not
 * a slow refresh: it discards the fetched pull and the next render buys it again, measured at about 210
 * WarcraftLogs points a save against an hourly budget of 9,000. Forty saves an hour and the budget is
 * gone.
 *
 * The reload itself could not be prevented from here. Moving `SPECS` out of the page frontmatter was not
 * enough, and neither was `client:only`: Astro still *imports* the island in the page, so the graph still
 * contains the engine whether or not it renders it. So the cache is made to survive the reload instead,
 * which is the outcome that was actually wanted.
 *
 * Development only. In production a reload is a reader deliberately reloading, and a stale snapshot of
 * somebody's pull sitting in their tab's storage is not something to add for no gain.
 */
const SNAPSHOT_KEY = 'windwalker-analyzer.queryCache';

/**
 * The most a snapshot may take of the tab's storage.
 *
 * Four megabytes against a five-megabyte quota. One fetched pull is about 0.65MB of raw events, so this
 * holds several and stops before the write that would throw — and a run that outgrows it silently keeps
 * the previous snapshot rather than losing the lot to a quota error.
 */
const SNAPSHOT_LIMIT = 4 * 1024 * 1024;

let saveTimer: ReturnType<typeof setTimeout> | undefined;

function reviveInDev(client: QueryClient): void {
	if (typeof sessionStorage === 'undefined') return;
	try {
		const saved = sessionStorage.getItem(SNAPSHOT_KEY);
		// Only successful queries are dehydrated, so nothing here can revive a failure as though it were
		// data. A snapshot this cannot parse is a snapshot from an older shape: drop it and fetch again.
		if (saved !== null) hydrate(client, JSON.parse(saved));
	} catch {
		sessionStorage.removeItem(SNAPSHOT_KEY);
	}

	client.getQueryCache().subscribe(() => {
		// Debounced because a single fetch moves the cache several times — pending, then settled — and
		// serialising a megabyte on each of those would be felt on the main thread.
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			try {
				const snapshot = JSON.stringify(dehydrate(client));
				if (snapshot.length > SNAPSHOT_LIMIT) return;
				sessionStorage.setItem(SNAPSHOT_KEY, snapshot);
			} catch {
				// A full quota, or a value that will not serialise. Neither is worth interrupting anyone
				// over: the cost is a refetch on the next reload, which is what happened before this
				// existed.
			}
		}, 400);
	});
}
