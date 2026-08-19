import { useState } from 'react';

import type { Analysis } from '~/lib/types';
import type { TargetModeChoice } from '~/lib/view/targetMode';
import { DEFAULT_SPEC } from '~/lib/spec';

import Report from './Report';
import TargetModeControl from './report/TargetModeControl';
import { compactChoiceClass } from './primitives/controls';

/** TEMPORARY dev harness — delete before shipping, along with src/pages/preview.astro. */
export default function PreviewSwitcher({ fixtures }: { fixtures: Record<string, Analysis> }) {
	const names = Object.keys(fixtures);
	const [name, setName] = useState(names[0] ?? '');
	// The report takes the reading as a prop now — the control that sets it lives on the sticky bar,
	// which this harness does not render — so previewing a fixture in both readings means holding it
	// here. `ReportFlow` puts it back to `auto` per pull; switching fixtures here does the same.
	const [targetChoice, setTargetChoice] = useState<TargetModeChoice>('auto');
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
					<TargetModeControl targets={analysis.targets} value={targetChoice} onChange={setTargetChoice} />
					<Report key={name} analysis={analysis} targetChoice={targetChoice} spec={DEFAULT_SPEC} />
				</>
			) : null}
		</div>
	);
}
