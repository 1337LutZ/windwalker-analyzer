import { useState } from 'react';

import type { Analysis } from '~/lib/types';

import Report from './Report';

/** TEMPORARY dev harness — delete before shipping, along with src/pages/preview.astro. */
export default function PreviewSwitcher({ fixtures }: { fixtures: Record<string, Analysis> }) {
	const names = Object.keys(fixtures);
	const [name, setName] = useState(names[0] ?? '');
	const analysis = fixtures[name];

	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-wrap gap-2" data-testid="fixture-picker">
				{names.map((n) => (
					<button
						key={n}
						type="button"
						onClick={() => setName(n)}
						className={`min-h-11 rounded-sm border px-4 py-2 font-mono text-sm uppercase ${
							n === name ? 'border-kick bg-raised text-ink' : 'border-line bg-bg text-muted'
						}`}
					>
						{n}
					</button>
				))}
			</div>
			{analysis ? <Report key={name} analysis={analysis} /> : null}
		</div>
	);
}
