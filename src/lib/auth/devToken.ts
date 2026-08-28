/**
 * The development-only token that lets a local dev server skip the sign-in panel.
 *
 * **Substituted at build time, and only by `astro dev`.** `astro.config.mjs` defines
 * `import.meta.env.DEV_WCL_TOKEN` from `.env`'s `WCL_TOKEN` when the command is `dev`, and defines the
 * literal `null` for every build — so a published bundle has no credential in it to leak, whatever is set
 * in the environment that built it. The variable keeps its unprefixed name for the same reason: Astro
 * exposes `PUBLIC_`-prefixed values to the browser in every build, and this must never be one of those.
 *
 * The `import.meta.env.DEV` guard is the second lock rather than the first. It is statically replaced, so
 * the whole branch is dead code a production build drops — but the `define` above has already made the
 * value `null` by then, and either alone would be enough.
 */
export function devToken(): string | null {
	if (!import.meta.env.DEV) return null;
	const token = (import.meta.env as unknown as { DEV_WCL_TOKEN?: string | null }).DEV_WCL_TOKEN;
	return typeof token === 'string' && token.length > 0 ? token : null;
}
