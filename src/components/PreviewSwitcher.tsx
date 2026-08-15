import { useState } from 'react';

import type { Analysis } from '~/lib/types';

import Report from './Report';
import { compactChoiceClass } from './primitives/controls';

/** TEMPORARY dev harness — delete before shipping, along with src/pages/preview.astro. */
export default function PreviewSwitcher({ fixtures }: { fixtures: Record<string, Analysis> }) {
	const names = Object.keys(fixtures);
	const [name, setName] = useState(names[0] ?? '');
	const analysis = fixtures[name];

	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-wrap gap-2" data-testid="fixture-picker">
				{names.map((n) => (
					<button key={n} type="button" onClick={() => setName(n)} className={compactChoiceClass(n === name)}>
						{n}
					</button>
				))}
			</div>
			{analysis ? <Report key={name} analysis={analysis} /> : null}
		</div>
	);
}
