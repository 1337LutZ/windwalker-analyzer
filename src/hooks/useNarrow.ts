import { useEffect, useState } from 'react';

import { NARROW_QUERY } from '~/components/charts/apex';

/**
 * Whether the viewport is the narrow one, in a way that survives hydration.
 *
 * **The obvious version of this is a hydration bug**, and three charts shipped it: reading
 * `window.matchMedia(NARROW_QUERY).matches` in the component body. On the server `window` is undefined so
 * the expression is `false`; on a narrow client it is `true`; and anything rendered from it — a label
 * column's width, or in the Windwalker timeline the label *text* itself — differs between the two passes.
 * React then discards the server HTML and re-renders the whole island, which is most of the value of
 * prerendering, and it does it only on the viewport the report is hardest to lay out on.
 *
 * So this starts at the server's answer and adopts the real one in an effect. The first client render
 * matches the HTML by construction, and the second is a normal state update.
 *
 * **Not the same job as `ChartEnv.narrow`.** That one is computed inside `ApexChart`'s draw effect and
 * handed to `build`, which is correct for the canvas: ApexCharts is never server-rendered, so a value read
 * at draw time cannot mismatch anything. This hook is for the DOM *around* the canvas, which is. The two
 * agree because they read the same query, and the duplication is the point rather than an oversight — one
 * of them has an SSR pass to answer to and the other does not.
 */
export function useNarrow(): boolean {
	// False, not `matchMedia(...)`, and not a lazy initialiser either: the initial value has to be the one
	// the server produced, whatever the client's viewport is.
	const [narrow, setNarrow] = useState(false);

	useEffect(() => {
		const query = window.matchMedia(NARROW_QUERY);
		setNarrow(query.matches);
		const onChange = (event: MediaQueryListEvent) => setNarrow(event.matches);
		query.addEventListener('change', onChange);
		return () => query.removeEventListener('change', onChange);
	}, []);

	return narrow;
}
