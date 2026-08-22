import { defineConfig } from 'vitest/config';

/**
 * `@types/node` is not installed and this file is inside the `tsc --noEmit` include, so `process` has
 * to be declared here rather than imported — the same constraint the alias comment below explains.
 */
declare const process: { env: Record<string, string | undefined> };

export default defineConfig({
	// Vite's dependency cache, moved out of `node_modules` only when asked.
	//
	// **This exists for the isolated-worktree gate.** That gate runs the suite against a detached
	// worktree with `node_modules` *symlinked* to the main tree's, which is what makes it cheap — no
	// `npm ci`, and a run about as fast as in place. But the cache lives at `node_modules/.vite`, so two
	// gates running at once write the same directory through the same symlink, and a lane has already
	// reported a lone failure it could not reproduce in nine further runs with exactly that as the best
	// explanation.
	//
	// A gate that can fail for a reason unrelated to the commit is worse than a slow one: this project
	// has already been bitten once by a verification instrument that lied (the `RTK` wrapper rendering a
	// suite-level load failure as `PASS (0) FAIL (0)`), and the lesson taken was that the instrument has
	// to be trustworthy before its output means anything. `undefined` keeps the default in place, so
	// nothing changes for a normal run — only the gate sets this.
	cacheDir: process.env.VITEST_CACHE_DIR,
	resolve: {
		// Vitest does not read tsconfig `paths`, and every module imports through `~/lib/...`, so the
		// alias has to be restated here or nothing resolves. `new URL(...).pathname` rather than
		// `fileURLToPath` because @types/node is not installed and this file is inside the
		// `tsc --noEmit` include — a `node:url` import fails the type check.
		alias: { '~': new URL('./src', import.meta.url).pathname },
	},
	test: {
		// The analysis engine is pure functions over an already-fetched dataset: no DOM, no rendering.
		// A node environment keeps that honest — a stray `window` or `document` reference fails in the
		// test instead of quietly passing under jsdom and breaking somewhere else.
		environment: 'node',
		// Anything under `__tests__` counts as a test file, so shared fixtures belong next to the
		// module they describe (or in a `.json`), not in here — a helper `.ts` with no suite in it
		// fails the run.
		include: ['src/**/*.test.ts', 'src/**/__tests__/**/*.ts'],
	},
});
