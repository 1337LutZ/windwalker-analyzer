import { useState } from 'react';

import type { Analysis } from '~/lib/types';
import type { OfferedChoice } from '~/lib/view/targetMode';
import { DEFAULT_SPEC, SPECS } from '~/lib/spec';

import Report from './Report';
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
 * same string `SpecDefinition.specName` carries, so the two cannot name different specs. Still not
 * `DEFAULT_SPEC` first: which spec a *fixture* is has nothing to do with which spec the build serves.
 */
const specFor = (analysis: Analysis) => SPECS.find((spec) => spec.specName === analysis.specName) ?? DEFAULT_SPEC;

/** TEMPORARY dev harness — delete before shipping, along with src/pages/preview.astro. */
export default function PreviewSwitcher({ fixtures }: { fixtures: Record<string, Analysis> }) {
	const names = Object.keys(fixtures);
	const [name, setName] = useState(names[0] ?? '');
	// The report takes the reading as a prop now — the control that sets it lives on the sticky bar,
	// which this harness does not render — so previewing a fixture in both readings means holding it
	// here. `ReportFlow` puts it back to `auto` per pull; switching fixtures here does the same.
	const [targetChoice, setTargetChoice] = useState<OfferedChoice>('auto');
	const analysis = fixtures[name];

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
			{analysis ? (
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
