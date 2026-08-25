// What the splash does with the address it was opened at.
//
// Two behaviours, and they are the two halves of one ruling: never guess a spec, and never make a
// reader retype a report. A link that names a registered spec is forwarded to that spec's route with
// everything else it was carrying; a link that names none — or names one this build does not have —
// falls through to the picker, whose links carry the report on so that one click finishes it.
//
// The pure halves are tested here rather than through a render, because what can go wrong is the
// string: a route without the deployment's base path in front of it is a dead link on GitHub Pages, a
// dropped fragment demotes a link to a paragraph into a link to the top of a page, and a `?spec=`
// carried through the forward puts the answer in the address twice.

import { describe, expect, it } from 'vitest';

import { migrationTarget, specHref, specRoute } from '~/components/SpecPicker';
import { getSpec, SPECS } from '~/lib/spec';

const WINDWALKER = getSpec('windwalker')!;
const ELEMENTAL = getSpec('elemental')!;

describe('a spec route', () => {
	it('is the class slug then the registry key', () => {
		expect(specRoute(WINDWALKER)).toBe('/monk/windwalker');
		expect(specRoute(ELEMENTAL)).toBe('/shaman/elemental');
	});

	/**
	 * The prefix every link on this page needs, and the one nothing in `src/` read before the routes
	 * existed.
	 *
	 * `import.meta.env.BASE_URL` is `/` under vitest and under a root deployment, which is why the
	 * assertions above read as though there were no prefix at all. On GitHub Pages it is
	 * `/windwalker-analyzer/`, and a link written without it resolves against the origin — a link to
	 * somebody else's site. Asserted as "starts with the base" rather than against a second literal, so
	 * this case says something under either value.
	 */
	it('is written under the deployment’s own base path', () => {
		for (const spec of SPECS) expect(specRoute(spec).startsWith(import.meta.env.BASE_URL)).toBe(true);
	});
});

describe('a link the picker offers', () => {
	it('carries the report, the pull and the player on to the route', () => {
		expect(specHref(WINDWALKER, '?report=a%3A6MhZgjyAknFWrYfK&fight=57&player=Player+%2817%29', '')).toBe(
			'/monk/windwalker?report=a%3A6MhZgjyAknFWrYfK&fight=57&player=Player+%2817%29',
		);
	});

	/** The fragment is `useSectionAnchor`'s, and it is what makes a shared link point at a paragraph. */
	it('carries the fragment too', () => {
		expect(specHref(ELEMENTAL, '?report=AbCd1234', '#bank-heading')).toBe(
			'/shaman/elemental?report=AbCd1234#bank-heading',
		);
	});

	it('leaves a bare route bare', () => {
		expect(specHref(WINDWALKER, '', '')).toBe('/monk/windwalker');
	});

	/** The path answers this now, so passing it on would put the answer in the address twice. */
	it('drops the ?spec= it was migrated from', () => {
		expect(specHref(ELEMENTAL, '?report=AbCd1234&spec=elemental', '')).toBe('/shaman/elemental?report=AbCd1234');
	});
});

describe('an old ?spec= link', () => {
	it('forwards to the route that spec now lives at, keeping everything else', () => {
		expect(migrationTarget('?report=AbCd1234&fight=57&spec=elemental', '#mana-heading')).toBe(
			'/shaman/elemental?report=AbCd1234&fight=57#mana-heading',
		);
	});

	/**
	 * Both halves of "never guess", stated as the cases they are.
	 *
	 * No spec named is the ordinary shared link, and it must land on the picker with the report intact
	 * rather than on a report scored against whichever spec happens to be first in the registry. A spec
	 * named that nothing answers is the louder of the two — a typo, or a key retired since the link was
	 * written — and resolving it to a neighbour is how an Elemental log gets read as a monk.
	 */
	it('forwards nothing when the address names no spec this build has', () => {
		expect(migrationTarget('?report=AbCd1234&fight=57', '')).toBeNull();
		expect(migrationTarget('?report=AbCd1234&spec=brewmaster', '')).toBeNull();
		expect(migrationTarget('?report=AbCd1234&spec=', '')).toBeNull();
		expect(migrationTarget('', '')).toBeNull();
	});
});
