// @ts-check
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'astro/config';
import { loadEnv } from 'vite';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

// `site` and `base` decide every asset URL in the build, and the right pair depends on where the
// site is served from — so they come from the environment rather than naming one host.
//
// The defaults are Cloudflare Pages, which serves at the root of its own domain and needs no path
// prefix. GitHub Pages serves a project site under `/<repo>/`, so a build for it must set both;
// getting `base` wrong there is not a subtle failure, every asset 404s.
//
// This reaches past assets: OAuth redirects back to `window.location`, and WarcraftLogs matches the
// registered redirect URI byte for byte. Moving where the site is served means registering the new
// URL with WarcraftLogs as well, or sign-in fails with a message that blames the client id instead.
/**
 * Whether this process is `astro dev`, read off the command rather than off `NODE_ENV`.
 *
 * `defineConfig` takes an object, not a function, so Astro never hands this file a `command` — and
 * `NODE_ENV` is not set by the CLI. The argument list is what actually distinguishes a dev server from a
 * build, and it is checked as an exact element so a path containing the word cannot pass for it.
 */
const isDev = process.argv.slice(2).includes('dev');

/**
 * A development-only token, so a local dev server can skip the sign-in panel.
 *
 * Null in every build. `loadEnv` is what reads `.env` here at all: Astro loads that file into
 * `import.meta.env` for the app, not into `process.env` for this config — the same distinction
 * `.env.example` draws about `SITE_URL`.
 */
const devToken = isDev ? (loadEnv('development', process.cwd(), '').WCL_TOKEN ?? null) : null;

const site = process.env.SITE_URL ?? 'https://windwalker-analyzer.pages.dev';
const base = process.env.BASE_PATH ?? '';

// A worktree links its `node_modules` to the main checkout's, which sits outside the worktree root —
// and Vite's dev-server allow-list is scoped to the project root, so every dependency resolves to a
// path it refuses to serve. Vite resolves the symlink, so the list has to name the *real* location;
// resolving it here keeps the config portable instead of hardcoding a machine path.
const nodeModules = realpathSync(fileURLToPath(new URL('./node_modules', import.meta.url)));

export default defineConfig({
	site,
	...(base === '' ? {} : { base }),
	// Static only: there is no server on Pages, and there must not be one — the WarcraftLogs token
	// stays in the visitor's browser and is sent straight to warcraftlogs.com, never to us.
	output: 'static',
	// One file per route rather than a directory with an `index.html` inside it, so `/monk/windwalker`
	// emits `dist/monk/windwalker.html` and the address a reader copies out of the bar carries no
	// trailing slash.
	//
	// The default would emit `dist/monk/windwalker/index.html`, whose canonical address is
	// `/monk/windwalker/`. That slash is not cosmetic on this site. It is the string a reader shares,
	// the string every link on the splash has to spell the same way, and one more spelling for the
	// redirect-URI comparison in `lib/auth/config.ts` to normalise away. Both hosts serve `/foo` from
	// `foo.html`, so nothing is lost by picking the shorter of the two.
	build: { format: 'file' },
	integrations: [react()],
	vite: {
		plugins: [tailwindcss()],
		server: { fs: { allow: ['.', nodeModules] } },
		/**
		 * A development-only shortcut past the sign-in panel.
		 *
		 * **Why it is a `define` and not a `PUBLIC_` variable.** Astro exposes `PUBLIC_`-prefixed values to
		 * the browser in *every* build, so naming the token that way would inline a live credential into
		 * whatever Cloudflare publishes. This is substituted only when the command is `dev`; a build
		 * substitutes the literal `null`, so there is nothing to inline and nothing to leak even if the
		 * variable is set in the environment that runs the build.
		 *
		 * `loadEnv` with an empty prefix is what reads `.env` at all here: Astro loads that file into
		 * `import.meta.env` for the app, not into `process.env` for this config, which is the same
		 * distinction `.env.example` draws about `SITE_URL`.
		 *
		 * `WCL_TOKEN` keeps its unprefixed name precisely so that forgetting this block cannot expose it.
		 */
		define: {
			'import.meta.env.DEV_WCL_TOKEN': JSON.stringify(devToken),
		},
	},
});
