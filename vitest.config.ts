import { defineConfig } from 'vitest/config';

export default defineConfig({
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
