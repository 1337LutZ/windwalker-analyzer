import { createContext, useContext } from 'react';

import type { SpecDefinition } from '~/lib/spec';

/**
 * The spec the whole report argues from.
 *
 * Context rather than a prop, for the same reason the target-mode reading is context: the spec reaches
 * `useReportCopy`, which is roughly thirty components deep, and threading it through all of them as a
 * prop would be thirty signatures changed to carry one value none of them use directly.
 *
 * The default is `null`, and it used to be the build's pinned `DEFAULT_SPEC` on the argument that a
 * section rendered in isolation should still score rather than crash. The evidence went the other way.
 * Under `PUBLIC_SPEC=elemental` twelve test files silently rendered Windwalker sections through the
 * Elemental scorer and stayed green, because the fallback does not hand you "the spec this analysis
 * belongs to" — it hands you whichever spec the *build* was pinned to, which is only the right answer by
 * coincidence. A wrong grade that renders is worse than a missing provider that throws.
 *
 * React cannot make a context statically required: `createContext` demands a default and `useContext`
 * cannot see whether a provider is above it. So "required" can only mean a nullable value and a consumer
 * that refuses to guess — which is what `useSpec` below is.
 *
 * Kept in its own module because a context object is not a component, and a module that exports both is
 * one React Fast Refresh will not hot-swap — the same rule the rest of `components/` follows.
 */
export const SpecContext = createContext<SpecDefinition | null>(null);

/**
 * The spec, or a throw naming what is missing.
 *
 * Every consumer goes through this rather than reading the context directly, so the refusal lives in one
 * place and a new consumer cannot accidentally reintroduce a silent fallback.
 */
export function useSpec(): SpecDefinition {
	const spec = useContext(SpecContext);
	if (spec === null) {
		throw new Error(
			'No spec in context: this component scores or reads copy, so it has to be rendered inside a <SpecContext.Provider>. A report provides one from `Report`; a test or a preview should name the spec it means with `getSpec(...)` rather than leaving it to a default.',
		);
	}
	return spec;
}
