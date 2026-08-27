import { useMemo, useState } from 'react';

import type { Pull } from '~/lib/compare';
import type { Analysis } from '~/lib/types';
import type { OfferedChoice } from '~/lib/view/targetMode';
import { resolveBands } from '~/lib/view/targetMode';
import { SPECS } from '~/lib/spec';

import CompareReport from './compare/CompareReport';
import Report from './Report';
import { SpecContext } from './report/specContext';
import TargetModeControl from './report/TargetModeControl';
import { compactChoiceClass } from './primitives/controls';

/**
 * The spec each fixture is read against — taken from the pull rather than pinned.
 *
 * This was `getSpec('windwalker')`, pinned so the harness ignored the build's `PUBLIC_SPEC`. That was
 * right while every fixture was a Windwalker one, and it is what kept the Elemental sections off the
 * only token-free route in the app: `preview.astro` carries an Elemental pull now, and a pinned spec
 * would have rendered it through the Windwalker's section list and scorecard.
 *
 * Off `analysis.specName`, which is `analyseCore`'s copy of the engine config's own spelling and the
 * same string `SpecDefinition.specName` carries, so the two cannot name different specs. Still not the
 * build's pinned default first: which spec a *fixture* is has nothing to do with which spec the build
 * serves.
 *
 * A name no definition answers falls to `SPECS[0]` rather than to that default, which is what
 * `lib/view/specColors` already does with the same lookup. The pin is a deployment's answer to "which
 * spec is this site", and a fixture whose spelling matches nothing is a bug in the fixture: reading the
 * pin there would let the harness render one spec's pull through another's sections and call it the
 * configuration working.
 */
const specFor = (analysis: Analysis) => SPECS.find((spec) => spec.specName === analysis.specName) ?? SPECS[0]!;

/** One fixture as the compare page wants it: scored, at the reading the pull itself detected. */
function pullOf(analysis: Analysis): Pull {
	const spec = specFor(analysis);
	const view = resolveBands(analysis.targets, 'auto', analysis.segments);
	return { analysis, scorecard: spec.score(analysis, view), view };
}

/** TEMPORARY dev harness — delete before shipping, along with src/pages/preview.astro. */
export default function PreviewSwitcher({ fixtures }: { fixtures: Record<string, Analysis> }) {
	const names = Object.keys(fixtures);
	const [name, setName] = useState(names[0] ?? '');
	// The report takes the reading as a prop now — the control that sets it lives on the sticky bar,
	// which this harness does not render — so previewing a fixture in both readings means holding it
	// here. `ReportFlow` puts it back to `auto` per pull; switching fixtures here does the same.
	const [targetChoice, setTargetChoice] = useState<OfferedChoice>('auto');
	/**
	 * The second pull, and the whole reason this harness grew a mode.
	 *
	 * **The compare page is unreachable without a WarcraftLogs token, and this is the only token-free
	 * route in the app.** Every other page can be looked at from a fixture; that one needed two live
	 * reports, an OAuth round trip and about ten points of somebody's hourly budget before a single row
	 * of it could be seen. That put the narrow-viewport sweep `docs/conventions.md` requires out of
	 * reach for the one page in the tree built entirely out of layout nothing else uses.
	 *
	 * It costs nothing to carry. The fixtures are already serialised into this island's props for the
	 * report mode, so a second pull adds no bytes to `dist/preview.html` at all — unlike the three
	 * Elemental entries above, each of which had to argue its own weight.
	 */
	const [against, setAgainst] = useState(names[1] ?? '');
	const [comparing, setComparing] = useState(false);

	const analysis = fixtures[name];
	const other = fixtures[against];

	/**
	 * Same spec only, which is the compare page's own rule rather than a limit of this harness.
	 *
	 * Metric keys align within a spec and not across one, so a Windwalker against an Elemental has
	 * nothing to difference. The picker offers only what can actually be drawn, instead of rendering an
	 * empty page and leaving whoever is looking at it to work out why.
	 */
	const pairable = useMemo(
		() => (analysis === undefined ? [] : names.filter((n) => fixtures[n]?.specName === analysis.specName)),
		[names, fixtures, analysis],
	);

	const pair = useMemo(() => {
		if (!comparing || analysis === undefined || other === undefined) return null;
		if (analysis.specName !== other.specName) return null;
		return { a: pullOf(analysis), b: pullOf(other), spec: specFor(analysis) };
	}, [comparing, analysis, other]);

	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-wrap gap-2" data-testid="fixture-picker">
				{names.map((n) => (
					<button
						key={n}
						type="button"
						onClick={() => {
							setName(n);
							setTargetChoice('auto');
						}}
						className={compactChoiceClass(n === name)}
					>
						{n}
					</button>
				))}
			</div>
			<div className="flex flex-wrap items-center gap-2" data-testid="compare-picker">
				<button type="button" onClick={() => setComparing(!comparing)} className={compactChoiceClass(comparing)}>
					compare against
				</button>
				{comparing
					? pairable.map((n) => (
							<button key={n} type="button" onClick={() => setAgainst(n)} className={compactChoiceClass(n === against)}>
								{n}
							</button>
						))
					: null}
			</div>

			{pair !== null ? (
				<SpecContext.Provider value={pair.spec}>
					<CompareReport key={`${name}-${against}`} a={pair.a} b={pair.b} />
				</SpecContext.Provider>
			) : analysis ? (
				<>
					<TargetModeControl
						targets={analysis.targets}
						segments={analysis.segments}
						value={targetChoice}
						onChange={setTargetChoice}
					/>
					<Report key={name} analysis={analysis} targetChoice={targetChoice} spec={specFor(analysis)} />
				</>
			) : null}
		</div>
	);
}
