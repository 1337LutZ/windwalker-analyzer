// @ts-check
import { defineConfig } from 'astro/config';
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
const site = process.env.SITE_URL ?? 'https://windwalker-analyzer.pages.dev';
const base = process.env.BASE_PATH ?? '';

export default defineConfig({
	site,
	...(base === '' ? {} : { base }),
	// Static only: there is no server on Pages, and there must not be one — the WarcraftLogs token
	// stays in the visitor's browser and is sent straight to warcraftlogs.com, never to us.
	output: 'static',
	integrations: [react()],
	vite: { plugins: [tailwindcss()] },
});
